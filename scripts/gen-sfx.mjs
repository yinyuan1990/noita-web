// 程序化合成 9 套分类爆炸音效（零依赖，直接写 16-bit PCM WAV）
// 用法：node scripts/gen-sfx.mjs → 输出到 public/res/sfx/gen/
// 配方见 docs/air-combat-gdd.md「七、爆炸音效方案」
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'res', 'sfx', 'gen')
mkdirSync(OUT, { recursive: true })

const rnd = () => Math.random() * 2 - 1
const buf = (dur) => new Float32Array(Math.ceil(dur * SR))

/** 低通白噪声：cutoffFn(t01)→Hz，ampFn(t01, 秒)→增益 */
function noiseLP(dur, cutoffFn, ampFn) {
  const b = buf(dur)
  let y = 0
  for (let i = 0; i < b.length; i++) {
    const t = i / b.length
    const tt = i / SR
    const a = 1 - Math.exp((-2 * Math.PI * cutoffFn(t, tt)) / SR)
    y += a * (rnd() - y)
    b[i] = y * ampFn(t, tt)
  }
  return b
}

/** 正弦（可扫频）：freqFn(t01, 秒)→Hz */
function tone(dur, freqFn, ampFn, shape = Math.sin) {
  const b = buf(dur)
  let ph = 0
  for (let i = 0; i < b.length; i++) {
    const t = i / b.length
    const tt = i / SR
    ph += (2 * Math.PI * freqFn(t, tt)) / SR
    b[i] = shape(ph) * ampFn(t, tt)
  }
  return b
}

/** 噪声 × 方波环形调制（电流质感） */
function buzz(dur, modHz, cutoff, ampFn) {
  const b = buf(dur)
  let y = 0
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
  for (let i = 0; i < b.length; i++) {
    const tt = i / SR
    y += a * (rnd() - y)
    const sq = Math.sin(2 * Math.PI * modHz * tt) > 0 ? 1 : -1
    b[i] = y * sq * ampFn(i / b.length, tt)
  }
  return b
}

/** 把 src 混入 dst 的 at 秒处 */
function mixInto(dst, src, at = 0, gain = 1) {
  const off = Math.floor(at * SR)
  for (let i = 0; i < src.length && off + i < dst.length; i++) dst[off + i] += src[i] * gain
  return dst
}

/** 软削波 + 峰值归一化 */
function finish(b, drive = 1, peak = 0.92) {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive)
  let m = 0
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]))
  const g = m > 0 ? peak / m : 1
  for (let i = 0; i < b.length; i++) b[i] *= g
  // 首尾 3ms 淡入淡出防爆音
  const f = Math.floor(SR * 0.003)
  for (let i = 0; i < f; i++) {
    b[i] *= i / f
    b[b.length - 1 - i] *= i / f
  }
  return b
}

function writeWav(name, data) {
  const n = data.length
  const bytes = new ArrayBuffer(44 + n * 2)
  const v = new DataView(bytes)
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE')
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  wstr(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true)
  writeFileSync(join(OUT, name), Buffer.from(bytes))
  console.log(`${name}  ${(bytes.byteLength / 1024).toFixed(0)}KB  ${(n / SR).toFixed(2)}s`)
}

const E = (k) => (t, tt) => Math.exp(-tt * k) // 指数衰减包络（按秒）

// 1. 机炮命中：3ms 噪声爆 + 4.2kHz 金属谐振 → 叮脆火花
{
  const b = buf(0.18)
  mixInto(b, noiseLP(0.05, () => 9000, E(160)), 0, 0.9)
  mixInto(b, tone(0.18, (t) => 4200 * (1 - 0.2 * t), E(40)), 0, 0.7)
  mixInto(b, tone(0.12, () => 2600, E(55)), 0, 0.4)
  writeWav('boom_vulcan.wav', finish(b, 1))
}
// 2. 导弹：低频重锤 + 低通扫频轰响 → 标准"轰"
{
  const b = buf(0.75)
  mixInto(b, tone(0.25, (t) => 110 - 50 * t, E(18)), 0, 1)
  mixInto(b, noiseLP(0.75, (t) => 200 + 1000 * Math.exp(-t * 4), E(6)), 0.01, 1.1)
  mixInto(b, noiseLP(0.4, () => 3000, E(10)), 0, 0.3)
  writeWav('boom_fire.wav', finish(b, 1.3))
}
// 3. 集束炸弹：60Hz 重锤 + 错峰噪声爆 + 次声余响 → 闷雷连响
{
  const b = buf(1.6)
  mixInto(b, tone(0.9, (t, tt) => 45 + 35 * Math.exp(-tt * 6), E(3.2)), 0, 1.3)
  mixInto(b, noiseLP(1.3, (t) => 140 + 460 * Math.exp(-t * 3), E(3)), 0.12, 1)
  mixInto(b, noiseLP(1.6, () => 120, (t, tt) => Math.min(tt * 10, 1) * Math.exp(-tt * 2)), 0, 0.8)
  writeWav('boom_cluster.wav', finish(b, 1.7))
}
// 4. 电浆：方波调制噪声 + 高频嘶声 + 谐振 → 电弧炸裂
{
  const b = buf(0.45)
  mixInto(b, buzz(0.4, 120, 5000, E(10)), 0, 1)
  mixInto(b, noiseLP(0.3, () => 8000, E(18)), 0, 0.5)
  mixInto(b, tone(0.35, () => 950, E(14)), 0, 0.5)
  writeWav('boom_tesla.wav', finish(b, 1.2))
}
// 5. 极光：880/1318 双钟 + 泛音 + 噪声垫 → 清亮空灵
{
  const b = buf(0.95)
  mixInto(b, tone(0.95, () => 880, E(5)), 0, 1)
  mixInto(b, tone(0.8, () => 1318, E(6)), 0.02, 0.6)
  mixInto(b, tone(0.6, () => 1774, E(7)), 0.04, 0.3)
  mixInto(b, noiseLP(0.7, () => 1800, E(4)), 0, 0.22)
  writeWav('boom_aurora.wav', finish(b, 1))
}
// 6. 炮团/解体：噪声爆 + 300Hz 共振 + 短重锤 → 闷响
{
  const b = buf(0.5)
  mixInto(b, noiseLP(0.5, (t) => 220 + 680 * Math.exp(-t * 3.5), E(9)), 0, 1)
  mixInto(b, tone(0.35, () => 300, E(12)), 0, 0.6)
  mixInto(b, tone(0.15, () => 90, E(20)), 0, 0.5)
  writeWav('boom_flak.wav', finish(b, 1.3))
}
// 7. 坠地/地面：低通轰 + 次声尾 + 碎屑颗粒 → 土石崩落
{
  const b = buf(1.15)
  mixInto(b, noiseLP(1.0, (t) => 110 + 290 * Math.exp(-t * 3), E(4)), 0, 1)
  mixInto(b, tone(0.8, (t) => 85 - 30 * t, E(5)), 0, 0.8)
  for (let i = 0; i < 7; i++) {
    mixInto(b, noiseLP(0.03, () => 2500, E(60)), 0.15 + Math.random() * 0.7, 0.22)
  }
  writeWav('boom_ground.wav', finish(b, 1.4))
}
// 8. 核弹：40Hz 次声巨浪 + 风啸 + 长尾 → 灭世（3.2s）
{
  const b = buf(3.2)
  mixInto(b, tone(3.0, (t, tt) => 28 + 34 * Math.exp(-tt * 1.2), (t, tt) => Math.min(tt * 40, 1) * Math.exp(-tt * 1.1)), 0, 1.6)
  mixInto(b, noiseLP(3.2, (t) => 80 + 420 * Math.exp(-t * 2.5), E(1.5)), 0.02, 1)
  // 风啸：0.9s 处到达峰值再缓降
  mixInto(b, noiseLP(3.0, () => 1800, (t, tt) => (tt < 0.9 ? tt / 0.9 : Math.exp(-(tt - 0.9) * 1.2)) * 0.5), 0.1, 0.8)
  mixInto(b, noiseLP(1.5, () => 4000, E(3)), 0.05, 0.15)
  writeWav('boom_nuke.wav', finish(b, 2))
}
// 9. Boss 殉爆：三段错峰闷雷 + 金属撕裂 + 长余响（2.3s）
{
  const b = buf(2.3)
  const boom = (pitch) => {
    const seg = buf(1.0)
    mixInto(seg, tone(0.6, (t, tt) => (40 + 30 * Math.exp(-tt * 6)) * pitch, E(4)), 0, 1.2)
    mixInto(seg, noiseLP(1.0, (t) => (130 + 420 * Math.exp(-t * 3)) * pitch, E(3.5)), 0.02, 1)
    return seg
  }
  mixInto(b, boom(1.0), 0)
  mixInto(b, boom(1.12), 0.38, 0.9)
  mixInto(b, boom(0.88), 0.82, 1.1)
  mixInto(b, tone(1.2, (t) => 700 - 400 * t, E(3)), 0.1, 0.35) // 金属撕裂扫频
  mixInto(b, tone(0.9, () => 520, E(5)), 0.4, 0.25)
  mixInto(b, noiseLP(2.3, () => 100, (t, tt) => Math.min(tt * 6, 1) * Math.exp(-tt * 1.6)), 0, 0.7)
  writeWav('boom_bossdie.wav', finish(b, 1.8))
}

console.log('done →', OUT)
