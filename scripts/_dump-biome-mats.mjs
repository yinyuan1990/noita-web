// 临时:打印各 biome xml 的 MaterialComponent 参数表;不带参数 = 列出所有字段名 + 多 material_index 的群系
import fs from 'node:fs'
const name = process.argv[2]
const attrs = (s) => { const a = {}; for (const k of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) a[k[1]] = k[2]; return a }
if (name) {
  const s = fs.readFileSync(`noita-ref/unpacked/biome/${name}.xml`, 'utf8')
  for (const m of s.matchAll(/<MaterialComponent\b([^>]*)>/g)) {
    const a = attrs(m[1])
    console.log(a.material_name.padEnd(18), 'idx', a.material_index, 'rare', a.is_rare, 'v', a.material_min, '-', a.material_max, 'y', a.limit_y === '1' ? a.limit_min_y + '..' + a.limit_max_y : '-', 'prob', a.rare_polka_probability, 'scale', a.rare_scale_x, a.rare_scale_y, 'perlin', a.rare_use_perlin, 'polka', a.rare_use_polka, 'req', a.rare_required_min, a.rare_required_max, 'rad', a.rare_polka_radius_low, a.rare_polka_radius_high)
  }
} else {
  const names = new Map()
  for (const f of fs.readdirSync('noita-ref/unpacked/biome')) {
    if (!f.endsWith('.xml')) continue
    const s = fs.readFileSync('noita-ref/unpacked/biome/' + f, 'utf8')
    const idx = new Set(), rows = []
    for (const m of s.matchAll(/<MaterialComponent\b([^>]*)>/g)) {
      const a = attrs(m[1])
      for (const k of Object.keys(a)) names.set(k, (names.get(k) || 0) + 1)
      if (a.is_rare === '1') continue
      idx.add(a.material_index); rows.push(`${a.material_name}@${a.material_index}[${a.material_min},${a.material_max}]`)
    }
    if (idx.size > 1) console.log(f.replace('.xml', '').padEnd(16), rows.join(' '))
  }
  console.log('\nfields:', [...names.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join('  '))
}
