// ── 布娃娃(反 noita_dev.exe DamageModelSystem::KillMe + PhysicsRagdollSystem::LoadRagdoll)──
// 原版:ragdoll_filenames_file 列的每张 png 都是整帧尺寸(僵尸 18×19 = 精灵帧),各部件在帧内各占自己的位置;
// LoadCachedRagdoll 对每一对图片找"两张都有像素"的格子(FindOverlap),每个重叠像素 = 一个 box2d 关节(pin);
// 一具僵尸的骨架:上躯干~下躯干 / 上躯干~头 / 上躯干~左右臂 / 下躯干~左右腿~脚 / 臂~手 …… 各 1 个像素,所以是一整具连着倒下。
// KillMe 里 NORMAL / BLOOD_SPRAY / FROZEN 都建关节(LoadRagdoll 第 7 个参数 = 1),只有 BLOOD_EXPLOSION 不建 → 块散开。
// 这里:各部件是普通 RigidBody(材质 ragdoll_material)。有 Box2D(planck)时部件挂成多体组(Entities._buildRagdoll:每个重叠像素一个 revolute,
// 刚度 2 / 0.05 当电机刹车,断裂 max(200,(mA+mB)×400)),本类只留血喷 / 烧尸的记账(g.planck);没 planck 时才用下面的手写 pin joint 顺序冲量求解。

export class Ragdoll {
  /**
   * @param {import('./RigidBody.js').RigidBody[]} parts
   * @param {{a:number,b:number,ax:number,ay:number,bx:number,by:number,broken?:boolean}[]} joints  a/b = parts 下标,锚点是各自图心为原点的局部坐标
   */
  constructor(parts, joints) {
    this.parts = parts; this.joints = joints
    this.age = 0; this.restT = 0; this.sleptT = 0
    this.burn = 0 // 火烧死:还要点几秒火
    this.blood = null // BLOOD_SPRAY:{ mat, left, dirx, diry }
    // LoadRagdoll:每具掷一次 rand < 0.75 → 用"很硬"的关节(PHYSICS_RAGDOLL_VERY_STIFF_JOINT_STIFFNESS 2),否则普通(PHYSICS_RAGDOLL_JOINT_STIFFNESS 0.05)
    // 关节有转角刚度 = 尸体大体保持精灵姿势整具倒下,只是四肢软一点;这里刚度当"每轮把相对转角拉回多少"
    this.stiff = Math.random() < 0.75 ? 0.12 : 0.03
    for (const j of joints) j.rest = parts[j.b].rot - parts[j.a].rot
    for (const p of parts) p.group = this
  }

  /** 部件 k 的锚点世界坐标 */
  static anchor(p, lx, ly, out) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot)
    out[0] = p.x + lx * c - ly * s; out[1] = p.y + lx * s + ly * c
    return out
  }

  /**
   * 关节求解(每帧一次,所有部件 step 完再调):顺序冲量 iters 轮。
   * pin joint:两锚点相对速度 → 用 2×2 有效质量矩阵解冲量全部消掉(相对转动自由 = 关节可转);位置误差按逆质量分摊直接拉回。
   * 小块(3~10 像素)惯量按至少 2px 回转半径算,不然一点冲量就甩成螺旋桨。
   */
  solve(iters = 3) {
    const PA = [0, 0], PB = [0, 0]
    let any = false
    for (let it = 0; it < iters; it++) {
      for (const j of this.joints) {
        if (j.broken) continue
        const A = this.parts[j.a], B = this.parts[j.b]
        if (A.dead || B.dead) { j.broken = true; continue }
        if (A.asleep && B.asleep) continue
        any = true
        Ragdoll.anchor(A, j.ax, j.ay, PA); Ragdoll.anchor(B, j.bx, j.by, PB)
        let ex = PA[0] - PB[0], ey = PA[1] - PB[1]
        let err = Math.hypot(ex, ey)
        // 断裂(PHYSICS_RAGDOLL_JOINT_MIN_BREAK_FORCE 的替身):一帧被拉开 16px(爆炸把手臂炸飞),或连续 4 帧都合不拢 8px(卡在地形里被硬拽);
        // 落地时躯干翻身、小块被地面顶着合不上的那一两帧不算 —— 位置修正每轮拉 3px,几帧就能回去
        if (it === 0 && this.age > 0.25) {
          j.stress = err > 8 ? (j.stress || 0) + 1 : 0
          if (err > 16 || j.stress >= 4) {
            j.broken = true
            ;(this.breakLog ||= []).push({ t: +this.age.toFixed(2), a: j.a, b: j.b, err: +err.toFixed(1), A: [+A.x.toFixed(1), +A.y.toFixed(1), +A.vx.toFixed(0), +A.vy.toFixed(0), +A.w.toFixed(1)], B: [+B.x.toFixed(1), +B.y.toFixed(1), +B.vx.toFixed(0), +B.vy.toFixed(0), +B.w.toFixed(1)] })
            continue
          }
        }
        const imA = A.asleep ? 0 : 1 / A.m, imB = B.asleep ? 0 : 1 / B.m
        const IA = Math.max(A.I, A.m * 4), IB = Math.max(B.I, B.m * 4)
        const iIA = A.asleep ? 0 : 1 / IA, iIB = B.asleep ? 0 : 1 / IB
        // 转角刚度:相对转角拉回初始姿势(按逆惯量分摊),相对角速度也耗掉一部分;转完锚点位置变了,重算误差
        if (iIA + iIB > 0 && this.stiff > 0) {
          let da = B.rot - A.rot - j.rest
          da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI
          const tot = iIA + iIB, c = da * this.stiff
          if (!A.asleep) A.rot += c * (iIA / tot)
          if (!B.asleep) B.rot -= c * (iIB / tot)
          const dw = (B.w - A.w) * this.stiff
          if (!A.asleep) A.w += dw * (iIA / tot)
          if (!B.asleep) B.w -= dw * (iIB / tot)
          Ragdoll.anchor(A, j.ax, j.ay, PA); Ragdoll.anchor(B, j.bx, j.by, PB)
          ex = PA[0] - PB[0]; ey = PA[1] - PB[1]; err = Math.hypot(ex, ey)
        }
        const rax = PA[0] - A.x, ray = PA[1] - A.y, rbx = PB[0] - B.x, rby = PB[1] - B.y
        // 有效质量矩阵 K(2×2)
        const k11 = imA + imB + ray * ray * iIA + rby * rby * iIB
        const k12 = -(rax * ray * iIA) - rbx * rby * iIB
        const k22 = imA + imB + rax * rax * iIA + rbx * rbx * iIB
        const det = k11 * k22 - k12 * k12
        if (det < 1e-9) continue
        // 相对速度(A 锚点 − B 锚点)全部消掉 = 铰链;位置误差另用位置修正拉回(不叠 Baumgarte 速度项:两者同时用会过冲,把 3 像素的手甩飞)
        const vax = A.vx - A.w * ray, vay = A.vy + A.w * rax, vbx = B.vx - B.w * rby, vby = B.vy + B.w * rbx
        const cx = vax - vbx, cy = vay - vby
        const px = -(k22 * cx - k12 * cy) / det, py = -(-k12 * cx + k11 * cy) / det
        if (!A.asleep) { A.vx += px * imA; A.vy += py * imA; A.w += (rax * py - ray * px) * iIA }
        if (!B.asleep) { B.vx -= px * imB; B.vy -= py * imB; B.w -= (rbx * py - rby * px) * iIB }
        // 位置直接拉回(按逆质量分摊,不动转角:稳;一轮最多拉 3px)
        const tot = imA + imB
        if (tot > 0 && err > 0.05) {
          const f = Math.min(1, 3 / err)
          if (!A.asleep) { A.x -= ex * f * (imA / tot); A.y -= ey * f * (imA / tot) }
          if (!B.asleep) { B.x += ex * f * (imB / tot); B.y += ey * f * (imB / tot) }
        }
      }
    }
    if (any) for (const p of this.parts) if (!p.asleep) p.w = Math.max(-12, Math.min(12, p.w))
  }

  /** 锚点像素被打掉 / 烧掉 → 关节断(关节钉在像素上) */
  checkAnchors() {
    for (const j of this.joints) {
      if (j.broken) continue
      const A = this.parts[j.a], B = this.parts[j.b]
      if (A.dead || B.dead || !A.hasPixelNear(j.ax, j.ay) || !B.hasPixelNear(j.bx, j.by)) j.broken = true
    }
  }

  get alive() { return this.parts.some((p) => !p.dead) }
  get anyAwake() { return this.parts.some((p) => !p.dead && !p.asleep) }

  /** 这块还连在别的块上吗(BLOOD_EXPLOSION 没关节 / 关节断了的块各自睡各自醒,不受整组牵制) */
  connected(p) {
    for (const j of this.joints) if (!j.broken && (this.parts[j.a] === p || this.parts[j.b] === p)) return true
    return false
  }

  /**
   * 相连的块是不是都停了:看位置 —— 每 0.5s 对一次快照,所有相连块位移 < 1.5px、大块转角 < 0.3 rad 就算停。
   * (关节每帧把重力速度在块之间倒来倒去,挂着的块速度表上永远有几像素/秒的"幽灵速度",按速度判永远睡不着)
   */
  resting(dt) {
    this.snapT = (this.snapT || 0) + dt
    if (this.snapT < 0.5) return this.stillFlag || false
    this.snapT = 0
    let still = true
    const prev = this.snap || new Map()
    const snap = new Map()
    for (const p of this.parts) {
      if (p.dead || p.asleep || !this.connected(p)) continue
      snap.set(p, [p.x, p.y, p.rot])
      const q = prev.get(p)
      if (!q) { still = false; continue }
      if (Math.hypot(p.x - q[0], p.y - q[1]) > 1.5 || (p.n >= 12 && Math.abs(p.rot - q[2]) > 0.3)) still = false
    }
    this.snap = snap
    this.stillFlag = still
    return still
  }

  /** 相连的块里有任何一块底下有实心就算有支撑(挂在躯干上的手臂自己不着地) */
  supported(solid) {
    for (const p of this.parts) if (!p.dead && this.connected(p) && p.supported(solid)) return true
    return false
  }

  sleepAll(sim) { for (const p of this.parts) if (!p.dead && !p.asleep && this.connected(p)) p.sleep(sim) }
  wakeAll(sim) { for (const p of this.parts) if (!p.dead && p.asleep && this.connected(p)) p.wake(sim) }
}
