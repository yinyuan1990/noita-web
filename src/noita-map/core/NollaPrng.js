// ── Noita 原版随机数(逐位一致)──
// 来源:noita-telescope js/nolla_prng.js(MIT, Lymm37),对照 noita-rng crate 校验过。
// 游戏内所有地图随机 —— wang 拼砖、秘室掷骰、布景选择(SetRandomSeed(x,y) + Random) —— 全部走这一个类。
// 纯数值,无 DOM 依赖;Next() 用双精度整数运算代替 BigInt(16807*s < 2^45,精确),手机上快得多。

export class NollaPrng {
  constructor(seed = 0) {
    this.Seed = seed
    this.Next()
  }

  // C 里的 (uint32)(int64)r:JS 的 |0 / & 走 ToInt32,对 |r| < 2^63 同样是模 2^32 截断
  static toU32(r) { return (r & 0xffffffff) >>> 0 }

  static Helper2(a, b, ws) {
    a >>>= 0; b >>>= 0; ws >>>= 0
    let u2 = ((a - b) - ws) ^ (ws >>> 13); u2 >>>= 0
    let u1 = ((b - u2) - ws) ^ (u2 << 8); u1 >>>= 0
    let u3 = ((ws - u2) - u1) ^ (u1 >>> 13); u3 >>>= 0
    u2 = ((u2 - u1) - u3) ^ (u3 >>> 12); u2 >>>= 0
    u1 = ((u1 - u2) - u3) ^ (u2 << 16); u1 >>>= 0
    u3 = ((u3 - u2) - u1) ^ (u1 >>> 5); u3 >>>= 0
    u2 = ((u2 - u1) - u3) ^ (u3 >>> 3); u2 >>>= 0
    u1 = ((u1 - u2) - u3) ^ (u2 << 10); u1 >>>= 0
    return (((u3 - u2) - u1) ^ (u1 >>> 15)) >>> 0
  }

  /** 世界种子直接当状态(wang 生成入口用) */
  SetRandomFromWorldSeed(s) {
    this.Seed = s
    if (this.Seed >= 2147483647.0) this.Seed = s * 0.5
  }

  /** Lua 的 SetRandomSeed(x, y):按世界坐标派生种子,是"同一位置永远掷出同一结果"的根 */
  SetRandomSeed(ws, x, y) {
    const a = (ws ^ 0x93262e6f) >>> 0
    const b = a & 0xfff
    const c = (a >>> 12) & 0xfff
    const x_ = x + b
    let y_ = y + c
    let r = x_ * 134217727.0
    const e = NollaPrng.toU32(r)
    if (Math.abs(y_) >= 102400.0 || Math.abs(x_) <= 1.0) {
      r = y_ * 134217727.0
    } else {
      let y__ = y_ * 3483.328
      y__ += e
      y_ *= y__
      r = y_
    }
    const f = r ? NollaPrng.toU32(r) : 2
    const g = NollaPrng.Helper2(e, f, ws)
    let s = g
    s /= 4294967295.0
    s *= 2147483639.0
    s += 1.0
    this.Seed = s >>> 0
    this.Next()
    let h = ws & 3
    while (h > 0) { this.Next(); h-- }
  }

  /** MINSTD (Park–Miller):s' = 16807·s mod (2^31−1),Schrage 形式 */
  Next() {
    const s = Math.floor(this.Seed)
    let v = 16807 * s - 2147483647 * Math.floor(s / 127773)
    if (v <= 0) v += 2147483647
    this.Seed = v
    return v / 2147483647.0
  }

  /** stbhw 用的无符号整数抽样 */
  NextU() {
    this.Next()
    return (this.Seed * 4.656612875e-10 * 2147483645.0) >>> 0
  }

  /** Lua Random(a, b):闭区间整数 */
  Random(a, b) {
    return a + Math.floor((b + 1 - a) * this.Next())
  }

  /** Lua ProceduralRandom(x, y):位置派生 → (0, 1] */
  ProceduralRandom(ws, x, y) {
    this.SetRandomSeed(ws, x, y)
    return this.Next()
  }

  ProceduralRandomi(ws, x, y, a, b) {
    this.SetRandomSeed(ws, x, y)
    return this.Random(a, b)
  }
}
