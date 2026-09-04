// 临时:看一批敌人 xml 的关键字段(hp / 会飞 / 远程弹 / lua 脚本),决定实体层要不要补什么
import fs from 'fs'
const names = process.argv.slice(2)
const base = (f, d = 0) => {
  const p = 'noita-ref/unpacked/entities/' + f.replace(/^data\/entities\//, '')
  if (!fs.existsSync(p)) return ''
  let s = fs.readFileSync(p, 'utf8')
  for (const m of s.matchAll(/<Base\s+file="([^"]+)"/g)) if (d < 4) s = base(m[1], d + 1) + s
  return s
}
for (const n of names) {
  const p = 'noita-ref/unpacked/entities/animals/' + n + '.xml'
  if (!fs.existsSync(p)) { console.log(n.padEnd(20), 'MISSING'); continue }
  const s = base('animals/' + n + '.xml')
  const ranged = [...s.matchAll(/attack_ranged_entity_file="([^"]*)"/g)].map((m) => m[1].replace('data/entities/', '')).filter(Boolean)
  const fly = /can_fly="1"/.test(s)
  const hp = [...s.matchAll(/\bhp="([\d.]+)"/g)].map((m) => m[1]).pop()
  const lua = [...new Set([...s.matchAll(/script_\w+="([^"]+)"/g)].map((m) => m[1].split('/').pop()))].slice(0, 4)
  const comps = ['AnimalAIComponent', 'CharacterPlatformingComponent', 'PhysicsAIComponent', 'WormComponent', 'PhysicsImageShapeComponent'].filter((c) => s.includes('<' + c)).map((c) => c.replace('Component', ''))
  console.log(n.padEnd(20), 'hp', String(hp).padEnd(5), fly ? 'fly ' : '    ', (ranged.slice(-1)[0] || '-').padEnd(40), comps.join('+').padEnd(40), lua.join(','))
}
