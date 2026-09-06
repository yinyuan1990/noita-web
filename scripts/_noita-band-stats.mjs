// 材质带统计:对每块存档真值 chunk,比较我们生成 vs 真值 —— 每种"带材质"的占比、水平/竖直平均连续段长(噪声尺度)、
// 并把两边按材质平色各画一张 png(%TEMP%/band-<cx>_<cy>-{gen,truth}.png)方便肉眼看"斑块大小"
// 用法:node scripts/_noita-band-stats.mjs [cx,cy ...](默认全部真值块)
import { chromium } from 'playwright'
import fs from 'fs'
import zlib from 'zlib'
const want = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-map.html?worker=0')
await page.waitForFunction(() => window.__nm && document.getElementById('mTruth'), null, { timeout: 60000, polling: 300 })
await page.click('#mTruth')
await page.waitForFunction(() => window.__nm.truth.ready, null, { timeout: 120000, polling: 300 })
const r = await page.evaluate(async (want) => {
  const { world, truth, assets } = window.__nm
  const mats = assets.materials
  const out = []
  const runs = (arr, id, W) => {
    let hs = 0, hn = 0, vs = 0, vn = 0
    for (let y = 0; y < W; y++) { let run = 0; for (let x = 0; x < W; x++) { if (arr[y * W + x] === id) run++; else if (run) { hs += run; hn++; run = 0 } } if (run) { hs += run; hn++ } }
    for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y < W; y++) { if (arr[y * W + x] === id) run++; else if (run) { vs += run; vn++; run = 0 } } if (run) { vs += run; vn++ } }
    return [hn ? +(hs / hn).toFixed(1) : 0, vn ? +(vs / vn).toFixed(1) : 0]
  }
  for (const c of [...truth.chunks.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    if (want.length && !want.includes(c.cx + ',' + c.cy)) continue
    await world.prepareChunk(c.cx, c.cy)
    const ours = world.getChunk(c.cx, c.cy)
    if (!ours) continue
    const W = 512, A = ours.mat, B = c.mat
    const ids = new Set(); for (const v of A) ids.add(v); for (const v of B) ids.add(v)
    const rows = []
    for (const id of ids) {
      if (!id) continue
      let na = 0, nb = 0; for (let i = 0; i < A.length; i++) { if (A[i] === id) na++; if (B[i] === id) nb++ }
      if (na + nb < 2000) continue
      rows.push({ mat: mats.name(id), ours: +(na / A.length * 100).toFixed(1), truth: +(nb / B.length * 100).toFixed(1), runOurs: runs(A, id, W), runTruth: runs(B, id, W) })
    }
    rows.sort((a, b) => b.truth - a.truth)
    const col = (id) => { const c = mats.color?.[id] ?? 0x808080; return [(c >> 16) & 255, (c >> 8) & 255, c & 255] }
    const img = (arr) => { const o = new Uint8Array(W * W * 3); for (let i = 0; i < arr.length; i++) { const [r, g, b] = arr[i] ? col(arr[i]) : [8, 8, 12]; o[i * 3] = r; o[i * 3 + 1] = g; o[i * 3 + 2] = b } return Array.from(o) }
    out.push({ cx: c.cx, cy: c.cy, biome: ours.biome, rows, gen: img(A), truth: img(B) })
  }
  return out
}, want)
// 写 png(RGB 无 alpha)
const crcT = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c }
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const png = (rgb, W) => { const raw = Buffer.alloc((W * 3 + 1) * W); for (let y = 0; y < W; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(rgb.slice(y * W * 3, (y + 1) * W * 3)).copy(raw, y * (W * 3 + 1) + 1) } const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(W, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]) }
for (const c of r) {
  console.log(`\n== chunk(${c.cx},${c.cy}) ${c.biome}   材质: 我们% / 真值%   连续段长 我们 [横,竖] / 真值 [横,竖]`)
  for (const w of c.rows) console.log(`  ${w.mat.padEnd(18)} ${String(w.ours).padStart(5)} / ${String(w.truth).padStart(5)}    ${JSON.stringify(w.runOurs).padEnd(14)} / ${JSON.stringify(w.runTruth)}`)
  fs.writeFileSync(`${process.env.TEMP}/band-${c.cx}_${c.cy}-gen.png`, png(c.gen, 512))
  fs.writeFileSync(`${process.env.TEMP}/band-${c.cx}_${c.cy}-truth.png`, png(c.truth, 512))
}
await browser.close()
