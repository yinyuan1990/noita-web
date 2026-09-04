// ── 特权(perk_list.lua)→ public/res/noita/perks.json + 图标 ent/ui_gfx_perk_icons_*.png ──
// 只抽 perk_get_spawn_order / perk_spawn 用到的字段:id / ui_name(中文)/ ui_description / perk_icon / stackable / stackable_is_rare /
// stackable_maximum / max_in_perk_pool / stackable_how_often_reappears / not_in_default_perk_pool / usable_by_enemies / game_effect(GameEffect 名)
// 用法:node scripts/noita-prepare-perks.mjs
import fs from 'fs'

const UNPACKED = 'noita-ref/unpacked'
const NOITA = 'E:/soft/xiaoshuodongtai/silu/XD220/Noita.v20250125-P2P/data'
const OUT = 'public/res/noita'
const zh = new Map()
for (const line of fs.readFileSync(`${NOITA}/translations/common.csv`, 'utf8').split(/\r?\n/).slice(1)) { const c = line.split(','); if (c[0]) zh.set(c[0], { en: c[1] || '', zh: c[9] || '' }) }
const tr = (key) => { const k = String(key || '').replace(/^\$/, ''); const t = zh.get(k); return t ? (t.zh && /[\u4e00-\u9fff]/.test(t.zh) ? t.zh : t.en) : k }
const copied = new Set()
const copyGfx = (rel) => { if (!rel) return null; const src = `${UNPACKED}/${rel.replace(/^data\//, '')}`; if (!fs.existsSync(src)) return null; const name = rel.replace(/^data\//, '').replace(/\//g, '_'); if (!copied.has(name)) { fs.copyFileSync(src, `${OUT}/ent/${name}`); copied.add(name) } return name }

// 先剥掉 --[[ ]] 块注释(里面有整条被注掉的特权)和行注释
const s = fs.readFileSync(`${UNPACKED}/scripts/perks/perk_list.lua`, 'utf8').replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--(?!\[\[).*$/gm, '')
// 每条 perk 是 perk_list 里的一个 { … } 块;按 "\n\t{\n" 切,再抠字段(函数体跳过)
const start = s.search(/perk_list\s*=\s*\{/)
const body = s.slice(start)
const blocks = body.split(/\n\t\{\s*\n/).slice(1)
const perks = []
for (const b of blocks) {
  const f = (k) => (new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`).exec(b) || [])[1]
  const n = (k) => { const m = new RegExp(`\\b${k}\\s*=\\s*(-?[\\d.]+)`).exec(b); return m ? +m[1] : undefined }
  const bool = (k) => new RegExp(`\\b${k}\\s*=\\s*(true|STACKABLE_YES)\\b`).test(b)
  const id = f('id')
  if (!id) continue
  perks.push({
    id, name: tr(f('ui_name')), desc: tr(f('ui_description')), icon: copyGfx(f('perk_icon')), uiIcon: copyGfx(f('ui_icon')),
    stackable: bool('stackable'), stackableIsRare: bool('stackable_is_rare'), stackableMaximum: n('stackable_maximum'), maxInPool: n('max_in_perk_pool'),
    reappears: n('stackable_how_often_reappears'), notInPool: bool('not_in_default_perk_pool'), usableByEnemies: bool('usable_by_enemies'),
    gameEffect: f('game_effect') || null,
  })
}
fs.writeFileSync(`${OUT}/perks.json`, JSON.stringify(perks))
console.log(`perks.json ${perks.length} 条(池内 ${perks.filter((p) => !p.notInPool).length},可叠 ${perks.filter((p) => p.stackable).length}),图标 ${copied.size}`)
console.log(perks.map((p) => p.id).join(' '))
