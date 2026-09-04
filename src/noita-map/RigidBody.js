// ── 像素刚体(Noita 的 box2d 道具:PhysicsImageShapeComponent 一张图 = 形状 + 材质)──
// 原作:图里每个像素是世界里一格该材质的"物理格",随刚体整体运动(可挖 / 可烧 / 可融),刚体睡了就是普通世界像素。
// 这里:
//   醒着:自己积分(重力 / 阻尼 / 边缘像素撞地形 → 冲量 + 摩擦 + 扭矩),画在世界之上,对玩家 / 弹丸按像素判定;
//   睡着(速度小 + 有支撑 0.5s):把像素按整数位置写进 chunk.mat(材质 = shape.material),之后元胞自动机接管——木箱会烧、
//         被挖掉的像素 = 刚体缺损(物理体损毁比例 → ExplodeOnDamage 的 physics_body_destruction_required);
//   被炸 / 被推 / 支撑没了 → 醒:从 mat 里把自己的像素收回来(缺的就真缺了),再落。
// 单位:1 像素 = 1 格,质量 = 像素数,惯量 = Σr²;重力同角色 pixel_gravity 量级。

const K_STATIC = 1, K_SAND = 2, K_LIQUID = 3

export class RigidBody {
  /**
   * @param {object} d   entities.json 的 prop 定义(shape/body/damage/explode/inventory/light)
   * @param {{width:number,height:number,data:Uint8Array,image:ImageBitmap}} png  形状图
   * @param {number} matId  shape.material 的材质 id
   */
  constructor(d, png, x, y, matId) {
    this.d = d; this.png = png; this.mat = matId
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.rot = 0; this.w = 0
    this.w0 = png.width; this.h0 = png.height
    // 像素表:相对图中心的偏移(centered=1;非 centered 的 lantern 之类也当中心,差 1px 无所谓)
    const N = png.width * png.height
    const px = [], py = [], edge = []
    this.mask = new Uint8Array(N) // 1 = 该像素存在(缺损后清 0)
    const a = (i, j) => (i < 0 || j < 0 || i >= png.width || j >= png.height ? 0 : png.data[(j * png.width + i) * 4 + 3])
    for (let j = 0; j < png.height; j++) for (let i = 0; i < png.width; i++) {
      if (!a(i, j)) continue
      this.mask[j * png.width + i] = 1
      px.push(i - png.width / 2 + 0.5); py.push(j - png.height / 2 + 0.5)
      if (!a(i - 1, j) || !a(i + 1, j) || !a(i, j - 1) || !a(i, j + 1)) edge.push(px.length - 1)
    }
    this.px = Float32Array.from(px); this.py = Float32Array.from(py); this.edge = Int32Array.from(edge)
    this.n = px.length; this.alive = px.length
    this.m = Math.max(1, px.length)
    let I = 0; for (let k = 0; k < px.length; k++) I += px[k] * px[k] + py[k] * py[k]
    this.I = Math.max(1, I)
    this.r = Math.hypot(png.width, png.height) / 2
    const B = d.body || {}
    this.friction = B.friction ?? 0.5; this.restitution = B.restitution ?? 0.15
    this.linDamp = B.linear_damping ?? 0; this.angDamp = B.angular_damping ?? 0
    this.hp = d.damage?.hp ?? Infinity; this.maxHp = this.hp
    this.inventory = d.inventory ? d.inventory.materials.map(([m, c]) => ({ m, left: c })) : null
    this.asleep = false; this.restT = 0; this.cells = null // 睡着时写进世界的格子 [x,y,x,y,...]
    this.dead = false; this.age = 0; this.checkT = Math.random() * 0.5
    this.light = d.light || null
    // PhysicsJointComponent nail_to_wall:钉在世界上只转不动(挖掘场的轮子,马达 mMotorSpeed rad/s)
    this.nailed = !!d.joint?.nail; this.motor = d.joint?.motor || 0
  }

  /** 像素 k 的世界坐标 */
  worldOf(k, out) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot)
    out[0] = this.x + this.px[k] * c - this.py[k] * s
    out[1] = this.y + this.px[k] * s + this.py[k] * c
    return out
  }

  /** 世界点是否落在(醒着的)刚体像素上 */
  contains(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y
    if (dx * dx + dy * dy > (this.r + 1) * (this.r + 1)) return false
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot)
    const lx = dx * c - dy * s + this.w0 / 2, ly = dx * s + dy * c + this.h0 / 2
    const i = Math.floor(lx), j = Math.floor(ly)
    if (i < 0 || j < 0 || i >= this.w0 || j >= this.h0) return false
    return this.mask[j * this.w0 + i] === 1
  }

  /**
   * 醒着时的一步:子步进到每步位移 ≤1px;边缘像素撞到实心 → 推出 + 冲量(恢复系数 / 摩擦 / 扭矩)。
   * @param {(x:number,y:number)=>boolean} solid  世界实心查询(含别的睡着刚体)
   * @param {(x:number,y:number)=>number} liquidDensity  0 = 不是液体,否则液体密度
   */
  step(dt, gravity, solid, liquidDensity, myDensity) {
    this.age += dt
    if (this.nailed) {
      // 钉住:不受重力 / 碰撞 / 推动,只按马达匀速转,永不入睡
      this.vx = this.vy = 0; this.w = this.motor; this.rot += this.motor * dt; this.restT = 0
      return false
    }
    // 浮力:泡在液体里的像素比例 × 密度差
    let wet = 0
    const P = [0, 0]
    for (let k = 0; k < this.edge.length; k += 3) { this.worldOf(this.edge[k], P); if (liquidDensity(Math.floor(P[0]), Math.floor(P[1])) > 0) wet++ }
    const wetF = this.edge.length ? wet / Math.ceil(this.edge.length / 3) : 0
    if (wetF > 0) {
      const ld = liquidDensity(Math.floor(this.x), Math.floor(this.y)) || 3
      const buoy = (ld / Math.max(1, myDensity)) * 1.6 // 木(6)在水(4)里 ≈ 1.07 → 漂;金属(8) ≈ 0.8 → 慢沉
      this.vy -= gravity * buoy * wetF * dt
      this.vx *= Math.pow(0.35, dt * wetF); this.vy *= Math.pow(0.35, dt * wetF); this.w *= Math.pow(0.3, dt * wetF)
    }
    this.vy += gravity * dt
    if (this.linDamp) { const f = Math.exp(-this.linDamp * dt); this.vx *= f; this.vy *= f }
    if (this.angDamp) this.w *= Math.exp(-this.angDamp * dt)
    this.w *= Math.exp(-0.4 * dt) // 一点空气阻尼,别转个没完
    const sp = Math.hypot(this.vx, this.vy) + Math.abs(this.w) * this.r
    const sub = Math.max(1, Math.min(24, Math.ceil(sp * dt)))
    const h = dt / sub
    let touching = false
    for (let s = 0; s < sub; s++) {
      this.x += this.vx * h; this.y += this.vy * h; this.rot += this.w * h
      if (this._resolve(solid)) touching = true
      if (this.ropes) this._ropes()
    }
    // 睡眠判定:慢 + 贴着东西 0.5s
    // 静止:一帧重力 ≈ 6px/s,接触后弹回 ≈ 0~1,所以阈值给 8
    // (悬在地面上方半像素的帧也算,入睡前由 supported() 再确认脚下有东西)
    // vy 阈值给到 3 帧重力(推出半像素后会悬空几帧再落回,那几帧 vy 能到 12~18)
    if (Math.abs(this.vx) < 6 && Math.abs(this.vy) < 20 && Math.abs(this.w) < 0.35) this.restT += dt
    else this.restT = 0
    return touching
  }

  /** 接触处理:返回 true 表示有接触 */
  _resolve(solid) {
    const P = [0, 0]
    let cx = 0, cy = 0, n = 0
    const cs = this._cs || (this._cs = new Float32Array(this.edge.length * 2))
    for (let e = 0; e < this.edge.length; e++) {
      this.worldOf(this.edge[e], P)
      if (!solid(Math.floor(P[0]), Math.floor(P[1]))) continue
      cs[n * 2] = P[0]; cs[n * 2 + 1] = P[1]
      n++; cx += P[0]; cy += P[1]
    }
    if (!n) return false
    cx /= n; cy /= n
    // 法线 = 接触点质心 → 刚体中心(平放在地上 = 正上;靠墙 = 水平;斜面 ≈ 斜面法线)。
    // 比数 3×3 实心格稳:陷进去的接触像素周围全是实心,梯度法会给出噪声法线,箱子就一边抖一边自己转。
    let nx = this.x - cx, ny = this.y - cy
    let l = Math.hypot(nx, ny)
    if (l < 0.5) { nx = 0; ny = -1; l = 1 }
    nx /= l; ny /= l
    // 推出:沿法线主轴 1px 一步(斜面上沿斜法线推会产生"无速度的横向蠕动",箱子自己爬坡;按主轴推没有这个问题),最多 5px
    const ax = Math.abs(ny) >= Math.abs(nx) ? 0 : Math.sign(nx), ay = ax ? 0 : Math.sign(ny) || -1
    for (let k = 0; k < 12; k++) {
      this.x += ax * 0.5; this.y += ay * 0.5 // 半像素一步,别一下顶出去太多又落回来(那就是抖)
      let still = false
      for (let e = 0; e < this.edge.length; e++) { this.worldOf(this.edge[e], P); if (solid(Math.floor(P[0]), Math.floor(P[1]))) { still = true; break } }
      if (!still) break
    }
    this.w *= 0.92 // 贴着东西时角速度快速耗散(接触摩擦),免得躺在地上还在微微转
    // 慢速贴地:额外耗散,让它真的停下来(单接触点冲量法在斜面上天然有点蠕动)
    if (Math.abs(this.vx) < 12 && Math.abs(this.vy) < 12) { this.vx *= 0.85; this.w *= 0.85 }
    // 接触面宽度(接触点沿切向的跨度):一整个面贴地 → 当"面接触",冲量不产生扭矩(单点模型会让平放的箱子来回摇);
    // 只有一角/一边挨着才算点接触,允许翻倒
    const tx = -ny, ty = nx
    let tmin = Infinity, tmax = -Infinity
    for (let i = 0; i < n; i++) { const t = (cs[i * 2] - cx) * tx + (cs[i * 2 + 1] - cy) * ty; if (t < tmin) tmin = t; if (t > tmax) tmax = t }
    const face = tmax - tmin > Math.min(this.w0, this.h0) * 0.6
    // 冲量(接触点 C,法线 N)
    const rx = cx - this.x, ry = cy - this.y
    const vrx = this.vx - this.w * ry, vry = this.vy + this.w * rx
    const vn = vrx * nx + vry * ny
    if (vn < 0) {
      const rn = face ? 0 : rx * ny - ry * nx
      const e = -vn < 25 ? 0 : this.restitution // 慢速接触不弹(box2d 的 velocity threshold),否则永远在地上小幅弹跳
      const j = (-(1 + e) * vn) / (1 / this.m + (rn * rn) / this.I)
      this.vx += (j / this.m) * nx; this.vy += (j / this.m) * ny; this.w += (rn * j) / this.I
      // 摩擦:切向冲量,上限 μ·j(+ 静摩擦兜底,别在斜面上无限溜)
      const vt = vrx * tx + vry * ty
      const rt = face ? 0 : rx * ty - ry * tx
      let jt = -vt / (1 / this.m + (rt * rt) / this.I)
      const mu = this.friction * Math.abs(j) + 0.08 * this.m // 库仑摩擦 μ·N + 一点静摩擦底(慢速时归零,别永远蠕动)
      jt = Math.max(-mu, Math.min(mu, jt))
      this.vx += (jt / this.m) * tx; this.vy += (jt / this.m) * ty; this.w += (rt * jt) / this.I
      if (face) this.w *= 0.6 // 面贴地:转动直接被地面吃掉
    }
    return true
  }

  /**
   * 链 / 钉(chain_to_ceiling.lua 的 REVOLUTE 链、PhysicsJointComponent nail_to_wall):
   * ropes = [{ax, ay 世界锚点, lx, ly 刚体局部挂点, len 链长(钉 = 0), broken}]。原作是 box2d 一节 16px 的链体串起来;
   * 这里当不可伸长的绳:挂点离锚点超过 len 就沿绳方向给冲量(含转动惯量)并把位置拉回,多绳迭代两遍;
   * 一次要拉回的距离太大(爆炸 / 被砸)= 超过 break_distance → 断链掉下来。
   */
  _ropes() {
    for (let it = 0; it < 2; it++) {
      for (const r of this.ropes) {
        if (r.broken) continue
        const c = Math.cos(this.rot), s = Math.sin(this.rot)
        const px = this.x + r.lx * c - r.ly * s, py = this.y + r.lx * s + r.ly * c
        let dx = px - r.ax, dy = py - r.ay
        const d = Math.hypot(dx, dy)
        const pen = d - r.len
        if (pen <= 0) continue
        if (pen > r.breakDist) { r.broken = true; continue }
        const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1
        const rx = px - this.x, ry = py - this.y
        const vrx = this.vx - this.w * ry, vry = this.vy + this.w * rx
        const vn = vrx * nx + vry * ny
        const rn = rx * ny - ry * nx
        const k = 1 / this.m + (rn * rn) / this.I
        // 冲量消掉沿绳的分离速度(不弹),位置直接拉回(位置式约束,多绳迭代收敛)
        const j = -Math.max(0, vn) / k
        this.vx += (j / this.m) * nx; this.vy += (j / this.m) * ny; this.w += (rn * j) / this.I
        this.x -= nx * pen; this.y -= ny * pen
      }
    }
    // 挂着的东西会慢慢停下来(链摩擦)
    this.w *= 0.995
  }
  /** 还有没断的链(睡觉 / 支撑判定把它当"有支撑") */
  get hanging() { return !!this.ropes && this.ropes.some((r) => !r.broken) }

  /** 是否有支撑(底下贴着实心);给睡着的刚体定期查 */
  supported(solid) {
    if (this.hanging) return true
    const P = [0, 0]
    for (let e = 0; e < this.edge.length; e++) { this.worldOf(this.edge[e], P); if (solid(Math.floor(P[0]), Math.floor(P[1] + 1))) return true }
    return false
  }

  /** 入睡:像素写进世界(只覆盖空气 / 液体 / 气体),记下格子 */
  sleep(sim) {
    this.asleep = true; this.vx = this.vy = this.w = 0
    const cells = []
    const P = [0, 0]
    for (let k = 0; k < this.n; k++) {
      if (!this.mask[this._idx(k)]) continue
      this.worldOf(k, P)
      const ix = Math.floor(P[0]), iy = Math.floor(P[1])
      const m = sim.get(ix, iy)
      if (m < 0) continue
      const kd = m ? sim.kind[m] : 0
      if (m === 0 || kd === K_LIQUID || kd > K_LIQUID) { sim.set(ix, iy, this.mat, 0); cells.push(ix, iy) }
    }
    this.cells = cells
  }

  /** 醒来:把还属于自己的格子收回(变空气);已经不是自己材质的 = 被挖/被烧掉的像素 → 标缺损 */
  wake(sim) {
    if (!this.asleep) return 0
    this.asleep = false; this.restT = 0
    let lost = 0
    if (this.cells) {
      const P = [0, 0]
      // 按像素回收:每个像素看自己那格还在不在
      for (let k = 0; k < this.n; k++) {
        const idx = this._idx(k)
        if (!this.mask[idx]) continue
        this.worldOf(k, P)
        const ix = Math.floor(P[0]), iy = Math.floor(P[1])
        const m = sim.get(ix, iy)
        if (m === this.mat) sim.set(ix, iy, 0, 0)
        else if (m >= 0 && !(m > 0 && sim.kind[m] <= K_STATIC)) { this.mask[idx] = 0; lost++ } // 变成空气/液体/火 = 被挖/烧掉;埋在别的实心里的不算
      }
      this.cells = null
    }
    if (lost) { this.alive -= lost; this._rebuildEdge() }
    return lost
  }

  /** 睡着时清点:自己的格子还剩多少(被挖 / 烧掉的算缺损),返回本次新缺的像素数 */
  audit(sim) {
    if (!this.asleep) return 0
    const P = [0, 0]
    let lost = 0
    for (let k = 0; k < this.n; k++) {
      const idx = this._idx(k)
      if (!this.mask[idx]) continue
      this.worldOf(k, P)
      const m = sim.get(Math.floor(P[0]), Math.floor(P[1]))
      if (m !== this.mat && m >= 0 && !(m > 0 && sim.kind[m] <= K_STATIC)) { this.mask[idx] = 0; lost++ }
    }
    if (lost) { this.alive -= lost; this._rebuildEdge() }
    return lost
  }

  _idx(k) { return Math.round(this.py[k] + this.h0 / 2 - 0.5) * this.w0 + Math.round(this.px[k] + this.w0 / 2 - 0.5) }

  _rebuildEdge() {
    const edge = []
    const has = (i, j) => (i < 0 || j < 0 || i >= this.w0 || j >= this.h0 ? 0 : this.mask[j * this.w0 + i])
    let m = 0, I = 0
    for (let k = 0; k < this.n; k++) {
      const i = Math.round(this.px[k] + this.w0 / 2 - 0.5), j = Math.round(this.py[k] + this.h0 / 2 - 0.5)
      if (!has(i, j)) continue
      m++; I += this.px[k] * this.px[k] + this.py[k] * this.py[k]
      if (!has(i - 1, j) || !has(i + 1, j) || !has(i, j - 1) || !has(i, j + 1)) edge.push(k)
    }
    this.edge = Int32Array.from(edge); this.m = Math.max(1, m); this.I = Math.max(1, I)
    this.canvasDirty = true
  }

  /** 缺损比例(ExplodeOnDamage.physics_body_destruction_required 用) */
  get destroyed() { return 1 - this.alive / this.n }

  /** 自己的位图(缺损像素抠掉) */
  _canvas() {
    if (this.canvas && !this.canvasDirty) return this.canvas
    if (!this.canvas) this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.w0, this.h0) : Object.assign(document.createElement('canvas'), { width: this.w0, height: this.h0 })
    const id = new ImageData(new Uint8ClampedArray(this.png.data), this.w0, this.h0)
    for (let i = 0; i < this.mask.length; i++) if (!this.mask[i]) id.data[i * 4 + 3] = 0
    this.canvas.getContext('2d').putImageData(id, 0, 0)
    this.canvasDirty = false
    return this.canvas
  }

  /** 画(醒着才画;睡着的已经在 chunk 位图里) */
  draw(ctx, ox, oy) {
    ctx.save()
    ctx.translate(Math.round(this.x - ox), Math.round(this.y - oy))
    ctx.rotate(this.rot)
    // skin:显示用的另一张图(药水 = 上色的瓶子,形状图是法线图;心/法术刷新 = 精灵本身)
    const img = this.skin || this._canvas()
    ctx.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2))
    ctx.restore()
  }
}
