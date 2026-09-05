// 盘点 gun_actions.lua 里所有 action 的 action 函数体:改了哪些 c.* / shot_effects.* 字段,挂了哪些 extra_entities / game_effect_entities
import fs from 'fs'
const src = fs.readFileSync('noita-ref/unpacked/scripts/gun/gun_actions.lua', 'utf8')
const ids = [...src.matchAll(/^\s*id\s*=\s*"([A-Z0-9_]+)",/gm)]
let rows = [], fields = new Map(), extras = new Map(), types = {}
for (let i = 0; i < ids.length; i++) {
  const id = ids[i][1], body = src.slice(ids[i].index, i + 1 < ids.length ? ids[i + 1].index : src.length)
  const t = /type\s*=\s*ACTION_TYPE_([A-Z_]+)/.exec(body)?.[1] || '?'
  const fn = /action\s*=\s*function\(([^)]*)\)([\s\S]*)$/.exec(body)?.[2] || ''
  const cs = [...fn.matchAll(/\b(c\.[a-z_0-9]+|shot_effects\.[a-z_]+)\s*=/g)].map((x) => x[1])
  const ex = [...fn.matchAll(/(?:extra_entities|game_effect_entities)\s*=\s*c\.(?:extra_entities|game_effect_entities)\s*\.\.\s*"([^"]+)"/g)].map((x) => x[1])
  const calls = [...fn.matchAll(/\b(add_projectile(?:_trigger_[a-z_]+)?|draw_actions|move_discarded_to_deck|order_deck|check_recursion|set_current_action|EntityGetWithTag|EntitySetTransform|EntityGetTransform|GameGetFrameNum|SetRandomSeed|Random|c\.[a-z_]+\s*=\s*c\.[a-z_]+\s*\*|reflecting)/g)].map((x) => x[1])
  types[t] = (types[t] || 0) + 1
  for (const f of cs) fields.set(f, (fields.get(f) || 0) + 1)
  for (const e of ex) extras.set(e, (extras.get(e) || 0) + 1)
  rows.push({ id, t, cs: [...new Set(cs)], ex: [...new Set(ex)], calls: [...new Set(calls)] })
}
console.log('actions', rows.length, types)
console.log('\n== 修饰卡改的字段(全部 action 计数)==')
for (const [f, n] of [...fields].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), f)
console.log('\n== extra_entities / game_effect_entities 文件 ==')
for (const [f, n] of [...extras].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), f)
console.log('\n== MODIFIER 明细 ==')
for (const r of rows.filter((r) => r.t === 'MODIFIER')) console.log(r.id.padEnd(30), r.cs.join(' '), r.ex.length ? ' | ' + r.ex.join(' ') : '', r.calls.filter((c) => !/^c\./.test(c)).length ? ' | ' + r.calls.filter((c) => !/^c\./.test(c)).join(' ') : '')
console.log('\n== 关注的几张 ==')
for (const r of rows.filter((r) => /TELEPORT|RECOIL|LASER|LEVITATION|HOMING|BOUNCE|LIGHT_SHOT|HEAVY_SHOT|SPEED|GRAVITY|KNOCKBACK|LIFETIME|PIERCING|CLIPPING|FLY_/.test(r.id))) console.log(r.id.padEnd(30), r.t.padEnd(18), r.cs.join(' '), r.ex.length ? ' | ' + r.ex.join(' ') : '')
