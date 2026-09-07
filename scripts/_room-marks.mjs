// 调研:房间布景 png 的尺寸 + 标记色像素位置,对上 lua 的 RegisterSpawnFunction(+ wang_scripts.csv 默认色)
// 用法:node scripts/_room-marks.mjs "biome_impl/xxx.png@scripts/biomes/xxx.lua" ...
import fs from 'fs'
import { decodePng } from '../src/noita-map/core/png.js'
const U = 'noita-ref/unpacked/'
const matColors = new Set()
for (const m of fs.readFileSync(U + 'materials.xml', 'utf8').matchAll(/wang_color="([0-9a-fA-F]{8})"/g)) matColors.add(parseInt(m[1].slice(2), 16))
const defaults = {}
for (const l of fs.readFileSync(U + 'scripts/wang_scripts.csv', 'utf8').split(/\r?\n/)) { const m = /^ff([0-9a-fA-F]{6}),(\w+)/.exec(l); if (m) defaults[parseInt(m[1], 16)] = m[2] + '(default)' }
for (const r of process.argv.slice(2)) {
  const [pngPath, luaPath] = r.split('@')
  if (!fs.existsSync(U + pngPath)) { console.log(`\n== ${pngPath} (missing)`); continue }
  const png = await decodePng(fs.readFileSync(U + pngPath))
  const funcs = { ...defaults }
  if (luaPath && fs.existsSync(U + luaPath)) for (const m of fs.readFileSync(U + luaPath, 'utf8').matchAll(/RegisterSpawnFunction\(\s*0x([0-9a-fA-F]{8})\s*,\s*"(\w+)"/g)) funcs[parseInt(m[1].slice(2), 16)] = m[2]
  const marks = new Map()
  const { width: W, height: H, data: d } = png
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4
    if (d[o + 3] === 0) continue
    const R = d[o], G = d[o + 1], B = d[o + 2], c = (R << 16) | (G << 8) | B
    if (R === G && G === B) continue
    if (matColors.has(c) && !funcs[c]) continue
    if (!marks.has(c)) marks.set(c, [])
    if (marks.get(c).length < 8) marks.get(c).push(`${x},${y}`)
  }
  console.log(`\n== ${pngPath} ${W}x${H}`)
  for (const [c, pts] of marks) console.log(`   ${c.toString(16).padStart(6, '0')} ${(funcs[c] || (matColors.has(c) ? '(material)' : '?')).padEnd(28)} ${pts.join(' ')}`)
}
