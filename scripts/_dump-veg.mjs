import fs from 'fs'
const U = 'e:/soft/xiaoshuodongtai/web/noita-ref/unpacked/biome/'
const rows = new Map()
for (const f of fs.readdirSync(U).filter((f) => f.endsWith('.xml'))) {
  const s = fs.readFileSync(U + f, 'utf8')
  for (const m of s.matchAll(/<VegetationComponent\b([^>]*)>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w.]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]))
    const key = `${a.tree_image_file || ''}|vis=${a.is_visual}|mat=${a.tree_material}|visimg=${a.tree_image_visual || ''}|ceil=${a.is_ceiling_plant || 0}|top=${a.material_on_top_of || ''}`
    if (!rows.has(key)) rows.set(key, new Set())
    rows.get(key).add(f.replace('.xml', ''))
  }
}
for (const [k, v] of rows) console.log(k.padEnd(120), [...v].slice(0, 6).join(','))
