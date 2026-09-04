// 临时:列出布景 png 里出现的标记色(在 BIOME_SPAWN_FUNCS 任一群系登记过的色)及其像素位置
// 用法:node scripts/_scene-marks.mjs temple/altar temple/altar_top general/wand_altar
import fs from 'fs'
import { decodePng } from '../src/noita-map/core/png.js'
import { BIOME_SPAWN_FUNCS } from '../src/noita-map/core/scenes.js'
const names = new Map()
for (const [b, list] of Object.entries(BIOME_SPAWN_FUNCS)) for (const [c, f] of list) { if (!names.has(c)) names.set(c, new Set()); names.get(c).add(f) }
// temple_altar.lua 自己的色
for (const [c, f] of [[0x6d934c, 'spawn_hp'], [0x33934c, 'spawn_all_shopitems'], [0x10822d, 'spawn_workshop'], [0x5a822d, 'spawn_workshop_extra'], [0xfaabba, 'spawn_motordoor'], [0xfaabbb, 'spawn_pressureplate'], [0x03dead, 'spawn_areachecks'], [0x03deaf, 'spawn_fish'], [0x784dd2, 'spawn_worm_deflector'], [0x7345df, 'spawn_perk_reroll'], [0x420a3d, 'spawn_trigger_check_stats'], [0x420a3f, 'spawn_trigger_check_stats_reference'], [0xc128ff, 'spawn_rubble'], [0xa7a707, 'spawn_lamp_long'], [0x03fade, 'spawn_spell_visualizer']]) { if (!names.has(c)) names.set(c, new Set()); names.get(c).add('temple:' + f) }
for (const rel of process.argv.slice(2)) {
  const buf = fs.readFileSync(`public/res/noita/scenes/${rel}.png`)
  const img = await decodePng(new Uint8Array(buf))
  const found = new Map()
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const o = (y * img.width + x) * 4
    if (img.data[o + 3] === 0) continue
    const c = (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2]
    if (!names.has(c)) continue
    if (!found.has(c)) found.set(c, [])
    found.get(c).push(`${x},${y}`)
  }
  console.log(`## ${rel} ${img.width}x${img.height}`)
  for (const [c, pts] of found) console.log(`  #${c.toString(16).padStart(6, '0')} ${[...names.get(c)].join('/')} ×${pts.length}: ${pts.slice(0, 12).join(' ')}${pts.length > 12 ? ' …' : ''}`)
}
