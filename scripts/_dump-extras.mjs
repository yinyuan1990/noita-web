// 列出 extra_entities 文件里的组件与关键属性
import fs from 'fs'
const U = 'e:/soft/xiaoshuodongtai/web/noita-ref/unpacked/'
const names = process.argv.slice(2)
for (const n of names) {
  const p = U + `entities/misc/${n}.xml`
  if (!fs.existsSync(p)) { console.log('##', n, '缺'); continue }
  const s = fs.readFileSync(p, 'utf8')
  console.log('##', n)
  for (const m of s.matchAll(/<([A-Z][A-Za-z0-9]+Component)\b([^>]*)>/g)) {
    const attrs = [...m[2].matchAll(/([\w.]+)="([^"]*)"/g)].filter((a) => !/^_tags|^_enabled/.test(a[1])).map((a) => `${a[1]}=${a[2]}`).join(' ')
    console.log('   ', m[1], attrs.slice(0, 220))
  }
  const lua = [...s.matchAll(/script_source_file="([^"]+)"/g)].map((m) => m[1])
  for (const l of lua) { const lp = U + l.replace(/^data\//, ''); if (fs.existsSync(lp)) { console.log('    --', l); console.log(fs.readFileSync(lp, 'utf8').split('\n').filter((x) => x.trim() && !x.trim().startsWith('--')).slice(0, 40).map((x) => '      ' + x).join('\n')) } }
}
