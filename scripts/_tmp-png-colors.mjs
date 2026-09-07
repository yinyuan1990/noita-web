// 临时:统计一张布景 png 的像素构成(透明 / 黑 / 暗灰 / 亮灰白 / 材质色 / 其他),看它"底"该是空气还是实心(用完删)
import fs from 'fs'
import { decodePng } from '../src/noita-map/core/png.js'
const U = 'noita-ref/unpacked/'
const matColors = new Map()
for (const m of fs.readFileSync(U + 'materials.xml', 'utf8').matchAll(/name="(\w+)"[^>]*?wang_color="([0-9a-fA-F]{8})"/g)) matColors.set(parseInt(m[2].slice(2), 16), m[1])
for (const p of process.argv.slice(2)) {
  const png = await decodePng(fs.readFileSync(U + p))
  const { width: W, height: H, data: d } = png
  let tr = 0, black = 0, dark = 0, light = 0, forceAir = 0
  const mats = {}, other = {}
  for (let i = 0; i < W * H; i++) {
    const o = i * 4
    if (d[o + 3] === 0) { tr++; continue }
    const R = d[o], G = d[o + 1], B = d[o + 2], c = (R << 16) | (G << 8) | B
    if (c === 0) black++
    else if (c === 0x000042) forceAir++
    else if (R === G && G === B) { if (R < 0x80) dark++; else light++ }
    else if (matColors.has(c)) mats[matColors.get(c)] = (mats[matColors.get(c)] || 0) + 1
    else other[c.toString(16).padStart(6, '0')] = (other[c.toString(16).padStart(6, '0')] || 0) + 1
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(`== ${p} ${W}x${H}  透明 ${tr} 黑 ${black} 暗灰 ${dark} 亮灰白 ${light} 000042 ${forceAir}\n   材质 ${top(mats)}\n   其他 ${top(other)}`)
}
