// 临时:列出 level_01 固定法杖的内容,以及 gun_actions.lua 里的法术表
import fs from 'node:fs'
const dir = 'noita-ref/unpacked/entities/items/wands/level_01/'
for (const f of fs.readdirSync(dir)) {
  const s = fs.readFileSync(dir + f, 'utf8')
  const ids = [...s.matchAll(/action_id="(\w+)"/g)].map((m) => m[1]).filter(Boolean)
  const g = (k) => /\b__K__="([^"]*)"/.source && (new RegExp(`\\b${k}="([^"]*)"`).exec(s) || [])[1]
  console.log(f.padEnd(14), (g('ui_name') || '').padEnd(28), (g('sprite_file') || '').split('/').pop(), `cap=${g('deck_capacity')} apr=${g('actions_per_round')} reload=${g('reload_time_frames')} fr=${g('fire_rate_wait')} mana=${g('mana_max')}/${g('mana_charge_speed')} spread=${g('spread_degrees')} shuffle=${g('shuffle_deck_when_empty')}`, ids.join(','))
}
console.log('--- gun_actions.lua')
const ga = fs.readFileSync('noita-ref/unpacked/scripts/gun/gun_actions.lua', 'utf8')
let n = 0
for (const m of ga.matchAll(/\{\s*id="(\w+)",\s*name="([^"]*)",[\s\S]*?type=(\w+),[\s\S]*?spawn_level\s*=\s*"([^"]*)",\s*spawn_probability\s*=\s*"([^"]*)",\s*price=(\d+),\s*mana=(\d+),([\s\S]*?)action\s*=\s*function\(\)([\s\S]*?)\n\t\},/g)) {
  const [, id, name, type, lvl, prob, price, mana, extra, body] = m
  if (type !== 'ACTION_TYPE_PROJECTILE' && type !== 'ACTION_TYPE_MATERIAL' && type !== 'ACTION_TYPE_STATIC_PROJECTILE') continue
  const proj = [...body.matchAll(/add_projectile\("data\/entities\/projectiles\/deck\/(\w+)\.xml"/g)].map((x) => x[1])
  const fr = /fire_rate_wait\s*=\s*c\.fire_rate_wait\s*([+-]\s*\d+)/.exec(body)?.[1]?.replace(/\s/g, '')
  const spread = /spread_degrees\s*=\s*c\.spread_degrees\s*([+-]\s*[\d.]+)/.exec(body)?.[1]?.replace(/\s/g, '')
  const uses = /max_uses\s*=\s*(\d+)/.exec(extra)?.[1]
  if (!proj.length) continue
  console.log(`${id.padEnd(28)} ${name.padEnd(22)} ${type.replace('ACTION_TYPE_', '').padEnd(18)} lvl=${lvl.padEnd(11)} p=${prob.padEnd(21)} price=${price} mana=${mana} fr=${fr || 0} spread=${spread || 0} uses=${uses || '∞'} → ${proj.join('+')}`)
  n++
}
console.log('projectile actions:', n)
