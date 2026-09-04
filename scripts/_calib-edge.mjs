// 临时:用存档真值标定 wang→世界 的放大算法(边缘噪声/圆角),用完删
import fs from 'fs'
const dump = JSON.parse(fs.readFileSync(process.env.TEMP + '/tele-dump.json', 'utf8'))
const coal = dump.coal
const raw = Buffer.from(coal.rawB64, 'base64')
const mapW = coal.mapW, rows = raw.length / 3 / mapW, mapH = rows - 4
const WX0 = coal.x - 35 * 512, WY0 = coal.y - 14 * 512
const truthDir = 'noita-ref/save-truth'
const seedInfo = JSON.parse(fs.readFileSync(`${truthDir}/seed.json`, 'utf8'))
const chunks = new Map(seedInfo.chunks.map((c) => [`${c.wx},${c.wy}`, new Uint16Array(fs.readFileSync(`${truthDir}/${c.file}`).buffer.slice(0))]))
const truthAt = (x, y) => {
  const cx = Math.floor(x / 512) * 512, cy = Math.floor(y / 512) * 512
  const c = chunks.get(`${cx},${cy}`)
  return c ? c[(y - cy) * 512 + (x - cx)] : -1
}
const wang = (i, j) => { if (i < 0 || j < 0 || i >= mapW || j >= mapH) return 0xffffff; const o = ((j + 4) * mapW + i) * 3; return (raw[o] << 16) | (raw[o + 1] << 8) | raw[o + 2] }
// wang 占据场:1=固体(非空气、非 0x000042);空气=0。忽略 spawn 标记色(1px 的怪/物品点在原版是空气)
const matData = JSON.parse(fs.readFileSync('../silu/noita-telescope/data/material_data.json', 'utf8'))
const wangSet = new Set(matData.map((m) => parseInt(m.wang.slice(2), 16)))
const isGrey = (c) => ((c >> 16) & 255) === ((c >> 8) & 255) && ((c >> 8) & 255) === (c & 255)
const occ = new Float32Array(mapW * mapH)
for (let j = 0; j < mapH; j++) for (let i = 0; i < mapW; i++) {
  const c = wang(i, j)
  let solid
  if (c === 0 || c === 0x000042) solid = 0
  else if (c === 0xffffff || isGrey(c)) solid = 1
  else if (wangSet.has(c)) { const m = matData.find((m) => parseInt(m.wang.slice(2), 16) === c); solid = m.type === 'gas' || m.name === 'air' ? 0 : 1 }
  else solid = 0 // 标记色:原版当空气
  occ[j * mapW + i] = solid
}
const occAt = (i, j) => (i < 0 || j < 0 || i >= mapW || j >= mapH) ? 1 : occ[j * mapW + i]

// 评估窗口:矿井中段,排除山体布景/圣山/未加载
const X0 = -500, X1 = 2040, Y0 = 330, Y1 = 975
const truthSolid = (x, y) => { const m = truthAt(x, y); return m < 0 ? -1 : m === 0 ? 0 : 1 }

function evalModel(name, fn) {
  let n = 0, ok = 0
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const t = truthSolid(x, y); if (t < 0) continue
    n++; if (fn(x, y) === t) ok++
  }
  console.log(`${name}: ${(ok / n * 100).toFixed(2)}%  (n=${n})`)
  return ok / n
}
// 基线:最近邻
evalModel('nearest', (x, y) => occAt(Math.floor((x - WX0) / 10), Math.floor((y - WY0) / 10)))

// 边界轮廓:到最近 wang 块边界的有符号距离 d(世界 px,正=块内固体侧) vs P(真值固体)
{
  const bins = new Map()
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const t = truthSolid(x, y); if (t < 0) continue
    const i = Math.floor((x - WX0) / 10), j = Math.floor((y - WY0) / 10)
    const s = occAt(i, j)
    // 到块内最近不同占据邻块的距离(仅 4 邻,近似)
    let d = 99
    const fx = x - WX0 - i * 10, fy = y - WY0 - j * 10 // 0..9
    if (occAt(i - 1, j) !== s) d = Math.min(d, fx + 0.5)
    if (occAt(i + 1, j) !== s) d = Math.min(d, 9.5 - fx)
    if (occAt(i, j - 1) !== s) d = Math.min(d, fy + 0.5)
    if (occAt(i, j + 1) !== s) d = Math.min(d, 9.5 - fy)
    if (d > 20) continue
    const sd = s ? d : -d
    const k = Math.round(sd)
    if (!bins.has(k)) bins.set(k, [0, 0])
    const b = bins.get(k); b[0]++; if (t) b[1]++
  }
  console.log('有符号距离(+固体侧) → P(真值固体):')
  for (const k of [...bins.keys()].sort((a, b) => a - b)) { const [n, s] = bins.get(k); console.log(`  d=${k}: ${(s / n * 100).toFixed(1)}%  n=${n}`) }
}

// 差异图:红=wang固体/真值空气,蓝=wang空气/真值固体
{
  const cx0 = 600, cy0 = 400, cw = 500, ch = 300, Z = 2
  const W2 = cw * Z, H2 = ch * Z
  const buf = Buffer.alloc(W2 * H2 * 4)
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const wx = cx0 + ((x / Z) | 0), wy = cy0 + ((y / Z) | 0)
    const s = occAt(Math.floor((wx - WX0) / 10), Math.floor((wy - WY0) / 10)), t = truthSolid(wx, wy)
    let col = t < 0 ? 0xffffff : s && t ? 0x807860 : !s && !t ? 0x0c0c10 : s && !t ? 0xff3030 : 0x3060ff
    // 叠 wang 网格线(淡)
    if (((wx - WX0) % 10 === 0 || (wy - WY0) % 10 === 0) && t >= 0) col = (col & 0xfefefe) >> 1 | 0x202020
    const o = (y * W2 + x) * 4; buf[o] = col >> 16 & 255; buf[o + 1] = col >> 8 & 255; buf[o + 2] = col & 255; buf[o + 3] = 255
  }
  const zlib = await import('zlib')
  const crc32 = (b) => { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c } return (crc ^ 0xffffffff) >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W2, 0); ihdr.writeUInt32BE(H2, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows2 = Buffer.alloc((W2 * 4 + 1) * H2); for (let y = 0; y < H2; y++) buf.copy(rows2, y * (W2 * 4 + 1) + 1, y * W2 * 4, (y + 1) * W2 * 4)
  fs.writeFileSync(process.env.TEMP + '/calib-diff.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows2)), chunk('IEND', Buffer.alloc(0))]))
}
// 模型 B:占据场双线性插值(格心)+ 阈值 0.5 —— 纯"圆角"无噪声
const bilin = (x, y) => {
  const u = (x - WX0) / 10 - 0.5, v = (y - WY0) / 10 - 0.5
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j
  return occAt(i, j) * (1 - fu) * (1 - fv) + occAt(i + 1, j) * fu * (1 - fv) + occAt(i, j + 1) * (1 - fu) * fv + occAt(i + 1, j + 1) * fu * fv
}
evalModel('bilinear>0.5', (x, y) => bilin(x, y) > 0.5 ? 1 : 0)
// 模型 C:双三次/平滑(smoothstep 权)
const sm = (t) => t * t * (3 - 2 * t)
const bilinS = (x, y) => {
  const u = (x - WX0) / 10 - 0.5, v = (y - WY0) / 10 - 0.5
  const i = Math.floor(u), j = Math.floor(v), fu = sm(u - i), fv = sm(v - j)
  return occAt(i, j) * (1 - fu) * (1 - fv) + occAt(i + 1, j) * fu * (1 - fv) + occAt(i, j + 1) * (1 - fu) * fv + occAt(i + 1, j + 1) * fu * fv
}
evalModel('smoothstep>0.5', (x, y) => bilinS(x, y) > 0.5 ? 1 : 0)
// 模型 D:最近邻 + 域扭曲噪声(value noise,幅度 A,波长 L)
function mkNoise(seed) {
  const h = (x, y) => { let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0; n = (n ^ (n >> 13)) * 1274126177; n = (n ^ (n >> 16)) >>> 0; return n / 4294967296 }
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fu = sm(x - i), fv = sm(y - j); return h(i, j) * (1 - fu) * (1 - fv) + h(i + 1, j) * fu * (1 - fv) + h(i, j + 1) * (1 - fu) * fv + h(i + 1, j + 1) * fu * fv }
}
const n1 = mkNoise(1), n2 = mkNoise(2)
for (const L of [8, 14, 20]) for (const A of [3, 5, 7]) {
  evalModel(`warp L=${L} A=${A} (nearest)`, (x, y) => {
    const dx = (n1(x / L, y / L) - 0.5) * 2 * A, dy = (n2(x / L, y / L) - 0.5) * 2 * A
    return occAt(Math.floor((x + dx - WX0) / 10), Math.floor((y + dy - WY0) / 10))
  })
}
for (const L of [8, 14]) for (const A of [3, 5]) {
  evalModel(`warp L=${L} A=${A} (smoothstep)`, (x, y) => {
    const dx = (n1(x / L, y / L) - 0.5) * 2 * A, dy = (n2(x / L, y / L) - 0.5) * 2 * A
    return bilinS(x + dx, y + dy) > 0.5 ? 1 : 0
  })
}
