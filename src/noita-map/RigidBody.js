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
    this.vy += gravity * (this.gravScale || 1) * dt
    if (this.linDamp) { const f = Math.exp(-this.linDamp * dt); this.vx *= f; this.vy *= f }
    if (this.angDamp) this.w *= Math.exp(-this.angDamp * dt)
    this.w *= Math.exp(-0.4 * dt) // 一点空气阻尼,别转个没完
    this.w = Math.max(-12, Math.min(12, this.w)) // box2d 默认 max angular velocity 也就这个量级,别转成螺旋桨
    if (this.fixedRot) { this.w = 0; this.rot = 0 } // SimplePhysics 类道具(心 / 法术刷新):只掉不转
    const sp = Math.hypot(this.vx, this.vy) + Math.abs(this.w) * this.r
    const sub = Math.max(1, Math.min(24, Math.ceil(sp * dt)))
    const h = dt / sub
    let touching = false
    for (let s = 0; s < sub; s++) {
      this.x += this.vx * h; this.y += this.vy * h; this.rot += this.w * h
      if (this._resolve(solid)) touching = true
      if (this.ropes) this._ropes()
    }
    // 挂着的东西(灯笼的铰链 / 吊链):关节摩擦把摆动耗掉,不然 50 盏灯笼永远在墙上晃、永远醒着
    if (this.ropes && this.hanging) { const f = Math.pow(0.15, dt); this.vx *= f; this.vy *= f; this.w *= Math.pow(0.1, dt) }
    // 快停下来的东西"坐实":慢速贴地时角速度再多耗一点;角度离最近的正放(0 / 90°)不到 4° 且几乎不转 → 直接摆正。
    // 不然长凳 / 崩塌的石块这种细长件只有一条腿挨地时按点接触给扭矩,另一条腿落地又反过来,永远左右摇(用户反馈的板凳 / 石块被打后来回晃)
    if (touching && Math.abs(this.vx) < 10 && Math.abs(this.vy) < 14 && !this.fixedRot) {
      this.w *= 0.7
      if (Math.abs(this.w) < 0.2) {
        const Q = Math.PI / 2, q = Math.round(this.rot / Q) * Q
        if (Math.abs(this.rot - q) < 0.07) { this.rot += (q - this.rot) * 0.35; this.w = 0 }
      }
    }
    // 睡眠判定:慢 + 贴着东西 0.5s
    // 静止:一帧重力 ≈ 6px/s,接触后弹回 ≈ 0~1,所以阈值给 8
    // (悬在地面上方半像素的帧也算,入睡前由 supported() 再确认脚下有东西)
    // vy 阈值给到 3 帧重力(推出半像素后会悬空几帧再落回,那几帧 vy 能到 12~18)
    if (Math.abs(this.vx) < 6 && Math.abs(this.vy) < 28 && Math.abs(this.w) < 0.35) this.restT += dt
    else this.restT = 0
    return touching
  }

  /** 接触处理:返回 true 表示有接触 */
  _resolve(solid) {
    const P = [0, 0]
    let cx = 0, cy = 0, n = 0, ex = 0, ey = 0
    const cs = this._cs || (this._cs = new Float32Array(this.edge.length * 2))
    for (let e = 0; e < this.edge.length; e++) {
      this.worldOf(this.edge[e], P)
      ex += P[0]; ey += P[1]
      if (!solid(Math.floor(P[0]), Math.floor(P[1]))) continue
      cs[n * 2] = P[0]; cs[n * 2 + 1] = P[1]
      n++; cx += P[0]; cy += P[1]
    }
    if (!n) return false
    cx /= n; cy /= n; ex /= this.edge.length; ey /= this.edge.length
    // 全埋进去了(≥ 6 成边缘像素都在实心里):方向没意义,当作从上面掉进去的 —— 往上顶、速度清零,别按噪声法线往下推
    // (桌子这种"桌面一排像素多、桌腿少"的形状,接触质心天然偏上,按"质心→刚体中心"算会算出朝下的法线,一路把桌子推穿地面)
    const buried = n >= this.edge.length * 0.6
    // 法线 = 接触点质心 → 边缘像素质心(不是刚体中心:边缘像素分布不对称时用刚体中心会偏;平放在地上 = 正上;靠墙 = 水平;斜面 ≈ 斜面法线)。
    // 比数 3×3 实心格稳:陷进去的接触像素周围全是实心,梯度法会给出噪声法线,箱子就一边抖一边自己转。
    let nx = ex - cx, ny = ey - cy
    let l = Math.hypot(nx, ny)
    // 几个像素的小块没有"形状",质心法线是噪声:看接触点四周哪边实心多(±2px 采样),法线背着实心那边;四周都一样(卡缝里)才按来向(速度反方向)退
    if (this.n < 12 && !buried) {
      const X = Math.floor(cx), Y = Math.floor(cy)
      const sx = (solid(X + 2, Y) ? 1 : 0) + (solid(X + 2, Y - 1) ? 1 : 0) - (solid(X - 2, Y) ? 1 : 0) - (solid(X - 2, Y - 1) ? 1 : 0)
      const sy = (solid(X, Y + 2) ? 1 : 0) + (solid(X + 1, Y + 2) ? 1 : 0) - (solid(X, Y - 2) ? 1 : 0) - (solid(X + 1, Y - 2) ? 1 : 0)
      if (sx || sy) { nx = -sx; ny = -sy; l = Math.hypot(nx, ny) }
      else { const sp = Math.hypot(this.vx, this.vy); if (sp > 1) { nx = -this.vx / sp; ny = -this.vy / sp; l = 1 } }
    }
    if (buried || l < 0.5) { nx = 0; ny = -1; l = 1 }
    nx /= l; ny /= l
    if (buried) { this.vx *= 0.5; this.vy = Math.min(this.vy, 0); this.w *= 0.5 }
    // 推出:沿法线主轴 1px 一步(斜面上沿斜法线推会产生"无速度的横向蠕动",箱子自己爬坡;按主轴推没有这个问题),最多 5px
    const ax = Math.abs(ny) >= Math.abs(nx) ? 0 : Math.sign(nx), ay = ax ? 0 : Math.sign(ny) || -1
    for (let k = 0, K = buried ? (this.softPush ? 6 : 48) : 12; k < K; k++) {
      this.x += ax * 0.5; this.y += ay * 0.5 // 半像素一步,别一下顶出去太多又落回来(那就是抖);埋住的多顶几步(≤24px)
      let still = false
      for (let e = 0; e < this.edge.length; e++) { this.worldOf(this.edge[e], P); if (solid(Math.floor(P[0]), Math.floor(P[1]))) { still = true; break } }
      if (!still) {
        // 再往回收 0.25px 试一次:顶出去多了半像素,东西就悬着掉回来再顶,永远小幅蹦(vy 每个来回能到 ±20,睡不着)
        this.x -= ax * 0.25; this.y -= ay * 0.25
        let hit = false
        for (let e = 0; e < this.edge.length; e++) { this.worldOf(this.edge[e], P); if (solid(Math.floor(P[0]), Math.floor(P[1]))) { hit = true; break } }
        if (hit) { this.x += ax * 0.25; this.y += ay * 0.25 }
        break
      }
    }
    this.w *= 0.92 // 贴着东西时角速度快速耗散(接触摩擦),免得躺在地上还在微微转
    // 慢速贴地:额外耗散,让它真的停下来(单接触点冲量法在斜面上天然有点蠕动)
    if (Math.abs(this.vx) < 12 && Math.abs(this.vy) < 12) { this.vx *= 0.85; this.w *= 0.85 }
    // 接触面宽度(接触点沿切向的跨度):一整个面贴地 → 当"面接触",冲量不产生扭矩(单点模型会让平放的箱子来回摇);
    // 只有一角/一边挨着才算点接触,允许翻倒
    const tx = -ny, ty = nx
    let tmin = Infinity, tmax = -Infinity
    for (let i = 0; i < n; i++) { const t = (cs[i * 2] - cx) * tx + (cs[i * 2 + 1] - cy) * ty; if (t < tmin) tmin = t; if (t > tmax) tmax = t }
    // 几个像素的小块(尸块碎肉 3~10 像素):惯量极小,点接触的扭矩冲量会把它甩到 20 rad/s 以上乱转、转着钻进地里 —— 一律按面接触算(不给扭矩)
    const face = this.n < 12 || tmax - tmin > Math.min(this.w0, this.h0) * 0.6
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

  /** 世界点 (wx,wy) 半径 r 内的像素抠掉(弹丸命中 / 小爆炸打掉刚体一块 —— 原版是 config_explosion 挖穿 box2d 像素),返回抠掉几个 */
  carve(wx, wy, r) {
    const P = [0, 0]
    let lost = 0
    for (let k = 0; k < this.n; k++) {
      const idx = this._idx(k)
      if (!this.mask[idx]) continue
      this.worldOf(k, P)
      if ((P[0] - wx) ** 2 + (P[1] - wy) ** 2 > r * r) continue
      this.mask[idx] = 0; lost++
    }
    if (lost) { this.alive -= lost; this._rebuildEdge() }
    return lost
  }

  /** 图内局部点 (lx,ly)(相对图心)周围 1px 还有没有像素 —— 钉子 / 链子挂在那儿,像素没了关节就断 */
  hasPixelNear(lx, ly) {
    const i0 = Math.round(lx + this.w0 / 2 - 0.5), j0 = Math.round(ly + this.h0 / 2 - 0.5)
    if (i0 < -1 || j0 < -1 || i0 > this.w0 || j0 > this.h0) return true // 钉子点在图外(大灯笼 pos_y=-2 钉在顶上的墙里):不看像素,看墙
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < 0 || j < 0 || i >= this.w0 || j >= this.h0) continue
      if (this.mask[j * this.w0 + i]) return true
    }
    return false
  }

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
    // 材质 normal_mapped=1(金块 / 宝石 / 药瓶玻璃 = gem_box2d 系):png 的红绿黄不是颜色,是法线(r,g → 朝向);显示 = 材质 color 按左上方来光打亮暗
    if (this.baseColor !== undefined) {
      const d = id.data, br = (this.baseColor >> 16) & 255, bg = (this.baseColor >> 8) & 255, bb = this.baseColor & 255
      const LX = -0.5, LY = -0.6, LZ = 0.62 // 光从左上前方来
      for (let i = 0; i < this.mask.length; i++) {
        if (!d[i * 4 + 3]) continue
        const nx = d[i * 4] / 127.5 - 1, ny = d[i * 4 + 1] / 127.5 - 1, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
        const k = 0.55 + 0.6 * Math.max(0, nx * LX + ny * LY + nz * LZ)
        d[i * 4] = Math.min(255, br * k); d[i * 4 + 1] = Math.min(255, bg * k); d[i * 4 + 2] = Math.min(255, bb * k)
      }
    }
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
    const img = this.frames ? this.frames[Math.floor(this.age / (this.animWait || 0.12)) % this.frames.length] : (this.skin || this._canvas())
    ctx.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2))
    // over:叠在形状图上面的帧动画(灯笼火苗:SpriteComponent z_index −1,Noita 的 z 越小越靠前,火苗画在玻璃壳前面)
    if (this.over) { const u = this.over[Math.floor(this.age / (this.animWait || 0.12)) % this.over.length]; ctx.drawImage(u, -Math.floor(u.width / 2), -Math.floor(u.height / 2)) }
    ctx.restore()
  }
}
