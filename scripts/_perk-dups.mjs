import fs from 'fs'
const lines = fs.readFileSync('noita-ref/unpacked/scripts/perks/perk_list.lua', 'utf8').split(/\r?\n/)
let depth = 0
lines.forEach((l, i) => {
  if (/^\s*--\[\[/.test(l)) { depth++; console.log(i + 1, 'OPEN', l.trim()) }
  if (/\]\]/.test(l) && depth > 0) { depth--; console.log(i + 1, 'CLOSE', l.trim()) }
  if (/id = "(NO_MORE_KNOCKBACK|FAST_PROJECTILES|GAMBLE|VISION)"/.test(l)) console.log(i + 1, 'depth', depth, l.trim())
})
