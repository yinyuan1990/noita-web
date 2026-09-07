// 临时:列出 biome_map 上出现但 BIOMES 没登记的群系,抽 xml Topology 关键属性 + lua init 里的 LoadPixelScene 调用(用完删)
import fs from 'fs'
import { decodePng } from '../src/noita-map/core/png.js'
import { BIOMES } from '../src/noita-map/core/biomes.js'

const png = await decodePng(fs.readFileSync('noita-ref/unpacked/biome_impl/biome_map.png'))
const xml = fs.readFileSync('noita-ref/unpacked/biome/_biomes_all.xml', 'utf8')
const legend = {}
for (const m of xml.matchAll(/biome_filename="data\/((?:biome|biome_impl\/static_tile)\/[\w/]+)\.xml"\s+height_index="(\d+)"\s+color="ff([0-9a-fA-F]{6})"/g)) legend[parseInt(m[3], 16)] = { file: m[1], h: +m[2] }
const byColor = new Map(Object.entries(BIOMES).map(([n, b]) => [b.color, n]))
const seen = new Set()
const { width: w, height: h, data } = png
for (let i = 0; i < w * h; i++) seen.add((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2])
const only = process.argv[2]
for (const c of [...seen].sort()) {
  if (byColor.has(c) && !only) continue
  const L = legend[c]; if (!L) continue
  if (only && !L.file.includes(only)) continue
  const p = `noita-ref/unpacked/${L.file}.xml`
  const t = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(no xml)'
  const attrs = {}
  for (const m of t.matchAll(/\b(type|lua_script|background_image|wang_template_file|background_use_neighbor|color_material|lua_script_file|ignore_wang|pixel_scene|noise_biome_edges|coarse_map_force_terrain|coarse_map_not_terrain|coarse_map_is_forced_terrain|wang_map_width|wang_map_height|wang_is_debug)="([^"]*)"/g)) attrs[m[1]] = m[2]
  const mats = [...t.matchAll(/<Material\s[^>]*?material="([^"]+)"/g)].map((m) => m[1])
  console.log(`\n== ${c.toString(16).padStart(6, '0')} ${L.file} (h ${L.h})`)
  console.log('   ', JSON.stringify(attrs))
  if (mats.length) console.log('    mats:', mats.join(','))
  const lua = attrs.lua_script
  if (lua) {
    const lp = 'noita-ref/unpacked/' + lua.replace(/^data\//, '')
    if (fs.existsSync(lp)) {
      const ls = fs.readFileSync(lp, 'utf8')
      const calls = [...ls.matchAll(/(LoadPixelScene|LoadBackgroundSprite|EntityLoad|LoadRandomPixelScene|load_pixel_scene\w*|RegisterSpawnFunction|dofile\w*)\s*\(([^\n]*)/g)].map((m) => `${m[1]}(${m[2].trim().slice(0, 150)}`)
      for (const c2 of calls) console.log('      ', c2)
    } else console.log('       (lua missing)', lp)
  }
}
