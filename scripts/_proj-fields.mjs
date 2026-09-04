// 临时:统计各组件字段(找漏掉的机制)。用法:node scripts/_proj-fields.mjs ComponentName [ComponentName...]
import fs from 'fs'
const dir = 'noita-ref/unpacked/entities/projectiles/deck'
const attrsOf = (s) => { const o = {}; for (const m of (s || '').matchAll(/([\w:.\-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }
for (const comp of process.argv.slice(2)) {
  const count = new Map(), files = {}
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.xml')) continue
    const s = fs.readFileSync(`${dir}/${f}`, 'utf8')
    for (const m of s.matchAll(new RegExp(`<${comp}\\b([^>]*)>`, 'g'))) {
      for (const [k, v] of Object.entries(attrsOf(m[1]))) {
        const key = k + (['0', '1'].includes(v) || /^[a-z_]+$/.test(v) && v.length < 24 ? '=' + v : '')
        count.set(key, (count.get(key) || 0) + 1); (files[key] ||= new Set()).add(f.replace('.xml', ''))
      }
    }
  }
  console.log(`\n== ${comp}`)
  for (const [k, v] of [...count.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}   ${[...files[k]].slice(0, 5).join(',')}`)
}
