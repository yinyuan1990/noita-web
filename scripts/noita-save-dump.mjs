// ── Noita 存档解码:把真游戏跑出来的世界当"地面真值" ──
// 输入:%USERPROFILE%\AppData\LocalLow\Nolla_Games_Noita\save00(或参数 1 指定)
//   world/.stream_info           fastlz 压缩;BE:version(24) seed frames ...
//   world/world_X_Y.png_petri     fastlz 压缩;BE:version(24) w(512) h(512) + 512×512 材质下标(bit7=自定义色)
//                                 + vec<string> 材质名 + vec<u32> 自定义色 + vec<物理体>
//   格式来源:社区 NoitaMapViewer(pudy248 / dexterCD 逆向),silu/NoitaMapViewer/chunks.h streaminfo.h
// 输出:noita-ref/save-truth/
//   seed.json                      {seed, chunks:[{cx,cy,file}]}
//   chunk_X_Y.mat.bin              512×512 u16LE 全局材质 id(见 materials.json)
//   materials.json                 id→name
//   truth_<x0>_<y0>_<w>_<h>.png     拼合区域按 material_data.json 的 color 上色(查看用)
// 用法:node scripts/noita-save-dump.mjs [save00Dir] [x0 y0 w h](世界坐标,默认矿井 -512 0 2560 1024)
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const save = process.argv[2] || path.join(process.env.USERPROFILE, 'AppData/LocalLow/Nolla_Games_Noita/save00')
const REG = process.argv.length >= 7 ? process.argv.slice(3, 7).map(Number) : [-512, 0, 2560, 1024]
const OUT = 'noita-ref/save-truth'
fs.mkdirSync(OUT, { recursive: true })

// ── fastlz 解压(level1/level2,移植自 fastlz.c) ──
function fastlzDecompress(inp, outLen) {
  const out = new Uint8Array(outLen)
  const level = (inp[0] >> 5) + 1
  let ip = 0, op = 0
  let ctrl = inp[ip++] & 31
  let loop = true
  do {
    let ref = op
    let len = ctrl >> 5
    let ofs = (ctrl & 31) << 8
    if (ctrl >= 32) {
      len--
      ref -= ofs
      if (level === 1) {
        if (len === 6) len += inp[ip++]
        ref -= inp[ip++]
      } else {
        let code
        if (len === 6) do { code = inp[ip++]; len += code } while (code === 255)
        code = inp[ip++]
        ref -= code
        if (code === 255 && ofs === (31 << 8)) {
          ofs = inp[ip++] << 8
          ofs += inp[ip++]
          ref = op - ofs - 8191
        }
      }
      if (ip < inp.length) ctrl = inp[ip++]; else loop = false
      ref--
      for (let i = 0; i < len + 3; i++) out[op++] = out[ref++]
    } else {
      ctrl++
      for (let i = 0; i < ctrl; i++) out[op++] = inp[ip++]
      loop = ip < inp.length
      if (loop) ctrl = inp[ip++]
    }
  } while (loop)
  return out
}
function readCompressed(file) {
  const buf = fs.readFileSync(file)
  const cSize = buf.readUInt32LE(0), dSize = buf.readUInt32LE(4)
  if (buf.length - 8 !== cSize) throw new Error(`${file}: bad compressed size`)
  return fastlzDecompress(new Uint8Array(buf.buffer, buf.byteOffset + 8, cSize), dSize)
}
class BE {
  constructor(u8) { this.b = Buffer.from(u8.buffer, u8.byteOffset, u8.length); this.p = 0 }
  u32() { const v = this.b.readUInt32BE(this.p); this.p += 4; return v }
  u8() { return this.b[this.p++] }
  f32() { const v = this.b.readFloatBE(this.p); this.p += 4; return v }
  f64() { const v = this.b.readDoubleBE(this.p); this.p += 8; return v }
  str() { const n = this.u32(); const s = this.b.toString('latin1', this.p, this.p + n); this.p += n; return s }
  bytes(n) { const s = this.b.subarray(this.p, this.p + n); this.p += n; return s }
}

// ── 材质表(全局 id):用 telescope 的 material_data.json,含 wang 色 + 显示色 ──
const matData = JSON.parse(fs.readFileSync('../silu/noita-telescope/data/material_data.json', 'utf8'))
const matId = new Map(matData.map((m, i) => [m.name, i]))
const matColor = matData.map((m) => parseInt((m.color || 'ff000000').slice(2), 16))
if (matData[0].name !== 'air') throw new Error('material_data.json 首项应为 air')
fs.writeFileSync(`${OUT}/materials.json`, JSON.stringify(matData.map((m) => m.name)))

// ── .stream_info → seed ──
// 游戏进行中(未正常退出)时 .stream_info 尚未落盘,同格式内容在 .autosave
const siFile = ['world/.stream_info', 'world/.autosave'].map((f) => path.join(save, f)).find((f) => fs.existsSync(f))
const si = new BE(readCompressed(siFile))
const version = si.u32(), seed = si.u32(), frames = si.u32()
console.log(`stream_info: version=${version} seed=${seed} frames=${frames}`)

// ── 已放置布景清单(.stream_info 同名的 world_pixel_scenes / .autosave_world_pixel_scenes):P3 的地面真值 ──
const psFile = ['world/.world_pixel_scenes', 'world/.autosave_world_pixel_scenes'].map((f) => path.join(save, f)).find((f) => fs.existsSync(f))
if (psFile) {
  const r = new BE(readCompressed(psFile))
  const v = r.u32(); r.u32()
  const readScene = () => {
    const x = r.u32() | 0, y = r.u32() | 0
    const mat = r.str(), visual = r.str(), bg = r.str()
    r.bytes(6); const pad2 = r.str(); r.bytes(5)
    const n = r.u8(); const colorMats = []
    for (let i = 0; i < n; i++) { const hi = r.u32(), lo = r.u32(); colorMats.push([hi, lo]) }
    return { x, y, mat, visual, bg, pad2, colorMats }
  }
  const readVec = () => { const n = r.u32(); const a = []; for (let i = 0; i < n; i++) a.push(readScene()); return a }
  const pending = readVec(), placed = readVec(), backgrounds = readVec()
  console.log(`pixel_scenes v${v}: pending=${pending.length} placed=${placed.length} backgrounds=${backgrounds.length}`)
  for (const s of placed) console.log(`  placed ${s.x},${s.y} mat=${s.mat.replace('data/biome_impl/', '')} visual=${s.visual.replace('data/biome_impl/', '')} bg=${s.bg.replace('data/biome_impl/', '')}${s.colorMats.length ? ' colorMats=' + s.colorMats.map(([h, l]) => h.toString(16) + ':' + l.toString(16)).join(',') : ''}`)
  fs.writeFileSync(`${OUT}/pixel_scenes.json`, JSON.stringify({ pending, placed, backgrounds }, null, 1))
}

// ── 区块 ──
const chunks = []
for (const f of fs.readdirSync(path.join(save, 'world'))) {
  const m = /^world_(-?\d+)_(-?\d+)\.png_petri$/.exec(f)
  if (!m) continue
  const wx = +m[1], wy = +m[2]
  const r = new BE(readCompressed(path.join(save, 'world', f)))
  const v = r.u32(), w = r.u32(), h = r.u32()
  if (v !== 24 || w !== 512 || h !== 512) { console.warn(`${f}: 非预期头 ${v} ${w}x${h}`); continue }
  const raw = r.bytes(512 * 512)
  const nNames = r.u32()
  const names = []
  for (let i = 0; i < nNames; i++) names.push(r.str())
  const nCustom = r.u32()
  r.bytes(nCustom * 4)
  const nPhys = r.u32()
  const mat = new Uint16Array(512 * 512) // 材质 id 有 467 个,u8 装不下
  const hist = new Map()
  const unknown = new Set()
  for (let i = 0; i < 512 * 512; i++) {
    const nm = names[raw[i] & 0x7f]
    let id = matId.get(nm)
    if (id === undefined) { unknown.add(nm); id = 0 }
    mat[i] = id
    hist.set(nm, (hist.get(nm) || 0) + 1)
  }
  fs.writeFileSync(`${OUT}/chunk_${wx}_${wy}.mat.bin`, Buffer.from(mat.buffer)) // u16 LE
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(`${f}: ${nNames} mats, ${nCustom} custom, ${nPhys} phys | ${top}${unknown.size ? ' | 未知:' + [...unknown].join(',') : ''}`)
  chunks.push({ wx, wy, mat })
}
fs.writeFileSync(`${OUT}/seed.json`, JSON.stringify({ seed, frames, chunks: chunks.map((c) => ({ wx: c.wx, wy: c.wy, file: `chunk_${c.wx}_${c.wy}.mat.bin` })) }, null, 1))

// ── 拼合区域 → PNG(最小 PNG 编码器:zlib + CRC32) ──
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function pngEncode(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const rows = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { rows[y * (w * 4 + 1)] = 0; rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
const [X0, Y0, W, H] = REG
const rgba = Buffer.alloc(W * H * 4)
let covered = 0
for (const c of chunks) {
  for (let y = 0; y < 512; y++) {
    const wy = c.wy + y - Y0
    if (wy < 0 || wy >= H) continue
    for (let x = 0; x < 512; x++) {
      const wx = c.wx + x - X0
      if (wx < 0 || wx >= W) continue
      const id = c.mat[y * 512 + x]
      const col = matColor[id]
      const o = (wy * W + wx) * 4
      if (id === 0) { rgba[o] = 12; rgba[o + 1] = 12; rgba[o + 2] = 16; rgba[o + 3] = 255 } // 空气=近黑,和"未加载=透明"区分
      else { rgba[o] = (col >> 16) & 255; rgba[o + 1] = (col >> 8) & 255; rgba[o + 2] = col & 255; rgba[o + 3] = 255 }
      covered++
    }
  }
}
const png = `${OUT}/truth_${X0}_${Y0}_${W}_${H}.png`
fs.writeFileSync(png, pngEncode(W, H, rgba))
console.log(`写出 ${png},区域覆盖 ${(covered / (W * H) * 100).toFixed(1)}%`)
