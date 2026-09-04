// 临时:打印某 biome xml 的 MaterialComponent 参数表
import fs from 'node:fs'
const name = process.argv[2] || 'hills'
const s = fs.readFileSync(`noita-ref/unpacked/biome/${name}.xml`, 'utf8')
for (const m of s.matchAll(/<MaterialComponent\b([^>]*)>/g)) {
  const a = {}
  for (const k of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) a[k[1]] = k[2]
  console.log(a.material_name.padEnd(18), 'rare', a.is_rare, 'v', a.material_min, '-', a.material_max, 'y', a.limit_y === '1' ? a.limit_min_y + '..' + a.limit_max_y : '-', 'prob', a.rare_polka_probability, 'scale', a.rare_scale_x, a.rare_scale_y, 'perlin', a.rare_use_perlin, 'polka', a.rare_use_polka, 'req', a.rare_required_min, a.rare_required_max, 'rad', a.rare_polka_radius_low, a.rare_polka_radius_high)
}
