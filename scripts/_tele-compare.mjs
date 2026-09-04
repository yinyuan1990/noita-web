// 临时:telescope 煤矿 wang 层 vs 存档真值 逐块对比(用完删)
import fs from 'fs'
import zlib from 'zlib'
const dump = JSON.parse(fs.readFileSync(process.env.TEMP + '/tele-dump.json', 'utf8'))
const coal = dump.coal
const raw = Buffer.from(coal.rawB64, 'base64')
const mapW = coal.mapW, rows = raw.length / 3 / mapW
console.log('wang buffer', mapW, 'x', rows, '(含顶部4行)')
const WX0 = coal.x - 35 * 512, WY0 = coal.y - 14 * 512 // 世界坐标原点
console.log('world origin', WX0, WY0)

const truthDir = 'noita-ref/save-truth'
const matNames = JSON.parse(fs.readFileSync(`${truthDir}/materials.json`, 'utf8'))
const seedInfo = JSON.parse(fs.readFileSync(`${truthDir}/seed.json`, 'utf8'))
const chunks = seedInfo.chunks.map((c) => ({ ...c, mat: new Uint16Array(fs.readFileSync(`${truthDir}/${c.file}`).buffer.slice(0)) }))
const truthAt = (x, y) => {
  const cx = Math.floor(x / 512) * 512, cy = Math.floor(y / 512) * 512
  const c = chunks.find((k) => k.wx === cx && k.wy === cy)
  if (!c) return -1
  return c.mat[(y - cy) * 512 + (x - cx)]
}
const wang = (i, j) => { const o = ((j + 4) * mapW + i) * 3; return (raw[o] << 16) | (raw[o + 1] << 8) | raw[o + 2] }

// 偏移搜索:在 ±12 px 内找 wang 空气块 vs 真值空气一致率最高的 (dx,dy)
{
  let best = null
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
    let ok = 0, n = 0
    for (let j = 34; j < 96; j += 1) for (let i = 0; i < mapW; i += 2) {
      const c = wang(i, j)
      if (c !== 0 && c !== 0xffffff) continue
      const x0 = WX0 + i * 10 + dx, y0 = WY0 + j * 10 + dy
      let air = 0, tot = 0
      for (let dy2 = 0; dy2 < 10; dy2 += 3) for (let dx2 = 0; dx2 < 10; dx2 += 3) { const m = truthAt(x0 + dx2, y0 + dy2); if (m < 0) continue; tot++; if (m === 0) air++ }
      if (tot < 16) continue
      n++
      if (c === 0 ? air >= tot * 0.9 : air <= tot * 0.1) ok++
    }
    const r = ok / n
    if (!best || r > best.r) best = { dx, dy, r, n }
  }
  console.log('最佳偏移', best)
}
// 统计
let nAir = 0, airOK = 0, nSolid = 0, solidOK = 0, nMat = 0, matOK = 0
const whiteHist = new Map(), greyHist = new Map(), colorHist = new Map()
const matData = JSON.parse(fs.readFileSync('../silu/noita-telescope/data/material_data.json', 'utf8'))
const wangToMat = new Map(matData.map((m, i) => [parseInt(m.wang.slice(2), 16), i]))
const H = rows - 4
for (let j = 0; j < H; j++) for (let i = 0; i < mapW; i++) {
  const c = wang(i, j)
  const x0 = WX0 + i * 10, y0 = WY0 + j * 10
  let air = 0, tot = 0
  const hist = new Map()
  for (let dy = 0; dy < 10; dy++) for (let dx = 0; dx < 10; dx++) {
    const m = truthAt(x0 + dx, y0 + dy)
    if (m < 0) continue
    tot++
    if (m === 0) air++
    hist.set(m, (hist.get(m) || 0) + 1)
  }
  if (tot < 100) continue
  if (y0 < 320 || y0 >= 980) continue // 排除山体静态布景(mountain/*.png 盖住顶部)和圣山顶(altar_top y≥984)
  const isGrey = ((c >> 16) & 255) === ((c >> 8) & 255) && ((c >> 8) & 255) === (c & 255)
  if (c === 0) { nAir++; if (air >= 90) airOK++ }
  else if (c === 0xffffff) { nSolid++; if (air <= 10) solidOK++; for (const [m, n] of hist) whiteHist.set(m, (whiteHist.get(m) || 0) + n) }
  else if (isGrey) { nSolid++; if (air <= 10) solidOK++; const g = c & 255; if (!greyHist.has(g)) greyHist.set(g, new Map()); for (const [m, n] of hist) greyHist.get(g).set(m, (greyHist.get(g).get(m) || 0) + n) }
  else if (wangToMat.has(c)) {
    nMat++
    const want = wangToMat.get(c)
    const got = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (got === want) matOK++
    const k = matNames[want]; if (!colorHist.has(k)) colorHist.set(k, new Map()); for (const [m, n] of hist) colorHist.get(k).set(matNames[m], (colorHist.get(k).get(matNames[m]) || 0) + n)
  }
}
console.log(`wang 空气块 ${nAir}:真值≥90%空气 ${airOK} (${(airOK / nAir * 100).toFixed(1)}%)`)
console.log(`wang 白/灰块 ${nSolid}:真值≤10%空气 ${solidOK} (${(solidOK / nSolid * 100).toFixed(1)}%)`)
console.log(`wang 材质色块 ${nMat}:真值主材质一致 ${matOK} (${(matOK / nMat * 100).toFixed(1)}%)`)
const top = (m, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log('白块(0xffffff)真值材质分布:', top(whiteHist).map(([m, n]) => `${matNames[m]}=${n}`).join(' '))
for (const [g, h] of [...greyHist.entries()].sort((a, b) => a[0] - b[0])) console.log(`灰 ${g}:`, top(h, 6).map(([m, n]) => `${matNames[m]}=${n}`).join(' '))
for (const [k, h] of colorHist) console.log(`色→${k}:`, top(h, 5).map(([m, n]) => `${m}=${n}`).join(' '))

// 输出对比图:上=telescope wang 放大 10×(仅空气/白/材质色),下=真值
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c } return (crc ^ 0xffffffff) >>> 0 }
function png(w, h, rgba) {
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows2 = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) rgba.copy(rows2, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows2)), chunk('IEND', Buffer.alloc(0))])
}
const W = 2560, HH = 1030
const out = Buffer.alloc(W * (HH * 2 + 4) * 4)
const matColor = matData.map((m) => parseInt((m.color || 'ff000000').slice(2), 16))
for (let y = 0; y < HH; y++) for (let x = 0; x < W; x++) {
  const c = wang((x / 10) | 0, (y / 10) | 0)
  let col = c === 0 ? 0x0c0c10 : c === 0xffffff ? 0x807860 : wangToMat.has(c) ? matColor[wangToMat.get(c)] : c
  let o = (y * W + x) * 4; out[o] = col >> 16 & 255; out[o + 1] = col >> 8 & 255; out[o + 2] = col & 255; out[o + 3] = 255
  const m = truthAt(WX0 + x, WY0 + y)
  col = m < 0 ? 0xffffff : m === 0 ? 0x0c0c10 : matColor[m]
  o = ((y + HH + 4) * W + x) * 4; out[o] = col >> 16 & 255; out[o + 1] = col >> 8 & 255; out[o + 2] = col & 255; out[o + 3] = 255
}
fs.writeFileSync(process.env.TEMP + '/tele-vs-truth.png', png(W, HH * 2 + 4, out))
// 1:1 裁剪对照:左 wang×10,右真值,同一世界窗口
{
  const cx0 = 600, cy0 = 400, cw = 400, ch = 300, Z = 2
  const o2 = Buffer.alloc((cw * 2 + 8) * Z * ch * Z * 4)
  const W2 = (cw * 2 + 8) * Z
  for (let y = 0; y < ch * Z; y++) for (let x = 0; x < W2; x++) {
    const wy = cy0 + ((y / Z) | 0)
    let col = 0x404040
    const xx = (x / Z) | 0
    if (xx < cw) { const wx = cx0 + xx; const c = wang(((wx - WX0) / 10) | 0, ((wy - WY0) / 10) | 0); col = c === 0 ? 0x0c0c10 : c === 0xffffff ? 0x807860 : wangToMat.has(c) ? matColor[wangToMat.get(c)] : c }
    else if (xx >= cw + 8) { const wx = cx0 + xx - cw - 8; const m = truthAt(wx, wy); col = m < 0 ? 0xffffff : m === 0 ? 0x0c0c10 : matColor[m] }
    const o = (y * W2 + x) * 4; o2[o] = col >> 16 & 255; o2[o + 1] = col >> 8 & 255; o2[o + 2] = col & 255; o2[o + 3] = 255
  }
  fs.writeFileSync(process.env.TEMP + '/tele-vs-truth-crop.png', png(W2, ch * Z, o2))
}
console.log('写出', process.env.TEMP + '/tele-vs-truth.png')
