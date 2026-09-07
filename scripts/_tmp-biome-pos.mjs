// 临时:列每个群系在 biome_map 上的格数与第一格的世界坐标(chunk 左上),用于传送探针(用完删)
import fs from 'fs'
import { decodePng } from '../src/noita-map/core/png.js'
import { BIOMES } from '../src/noita-map/core/biomes.js'
const png = await decodePng(fs.readFileSync('noita-ref/unpacked/biome_impl/biome_map.png'))
const { width: w, height: h, data } = png
const byColor = new Map(Object.entries(BIOMES).map(([n, b]) => [b.color, n]))
const pos = {}
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4, c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  const n = byColor.get(c) || c.toString(16).padStart(6, '0')
  ;(pos[n] ||= []).push(`${(x - 35) * 512},${(y - 14) * 512}`)
}
const only = process.argv[2]
for (const [n, list] of Object.entries(pos).sort()) if (!only || n.includes(only)) console.log(n.padEnd(30), list.length, list.slice(0, 6).join(' '))
