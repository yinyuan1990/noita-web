// 临时:打印一批特权的 func 关键行(数值从哪来)
import fs from 'fs'
const s = fs.readFileSync('noita-ref/unpacked/scripts/perks/perk_list.lua', 'utf8').replace(/--\[\[[\s\S]*?\]\]/g, '')
const want = process.argv.slice(2)
const blocks = s.split(/\n\t\{\s*\n/).slice(1)
for (const b of blocks) {
  const id = (/\bid\s*=\s*"(\w+)"/.exec(b) || [])[1]
  if (want.length && !want.includes(id)) continue
  const fn = (/func\s*=\s*function[\s\S]*?\n\t\tend/.exec(b) || [''])[0]
  const ge = (/game_effect\s*=\s*"(\w+)"/.exec(b) || [])[1]
  const lines = fn.split('\n').filter((l) => /ComponentSetValue|ComponentAdjustValues|GlobalsSetValue|\*|\+|GameAddFlag|EntityAddComponent|LuaComponent|max_hp|edit_component|money|ability|GlobalsGetValue/.test(l) && !/^\s*--/.test(l)).map((l) => l.trim()).slice(0, 10)
  console.log('##', id, ge || '', fn.length ? '' : '(no func)')
  for (const l of lines) console.log('   ', l.slice(0, 170))
}
