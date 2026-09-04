// ── 法杖与法术:gun_actions.lua(法术表)+ items/wands/level_01/wand_*.xml(煤矿祭坛上的 17 根固定法杖)+ 初始法杖 → wands.json ──
// 名字用 translations/common.csv 的中文列;法术图标 ui_gfx/gun_actions/*.png、法杖图 items_gfx/**.png → ent/
// 用法:node scripts/noita-prepare-wands.mjs
import fs from 'fs'
import path from 'path'

const UNPACKED = 'noita-ref/unpacked'
const NOITA = 'E:/soft/xiaoshuodongtai/silu/XD220/Noita.v20250125-P2P/data'
const OUT = 'public/res/noita'
const attrsOf = (s) => { const o = {}; for (const m of (s || '').matchAll(/([\w:.\-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }
const readFile = (rel) => { const p = `${UNPACKED}/${rel.replace(/^data\//, '')}`; return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
const copied = new Set()
const copyGfx = (rel) => {
  if (!rel) return null
  const src = `${UNPACKED}/${rel.replace(/^data\//, '')}`
  if (!fs.existsSync(src)) return null
  const name = rel.replace(/^data\//, '').replace(/\//g, '_')
  if (!copied.has(name)) { fs.copyFileSync(src, `${OUT}/ent/${name}`); copied.add(name) }
  return name
}

// ── 翻译:$key → 中文(缺就英文)──
const zh = new Map()
{
  const csv = fs.readFileSync(`${NOITA}/translations/common.csv`, 'utf8').split(/\r?\n/)
  for (const line of csv.slice(1)) {
    const cols = line.split(',') // 文案里没有逗号的占绝大多数;有逗号的只影响英文/其他列,中文列位置会偏,兜底用英文
    if (!cols[0]) continue
    zh.set(cols[0], { en: cols[1] || '', zh: cols[9] || '' })
  }
}
const tr = (key) => { const k = String(key || '').replace(/^\$/, ''); const t = zh.get(k); return t ? (t.zh && /[\u4e00-\u9fff]/.test(t.zh) ? t.zh : t.en) : k }

// ── 法术表(gun_actions.lua):逐条正则抠 id / name / sprite / type / spawn_level / probability / price / mana / max_uses / action 体 ──
const ga = fs.readFileSync(`${UNPACKED}/scripts/gun/gun_actions.lua`, 'utf8')
const spells = {}
const blocks = ga.split(/\n\t\{\s*\n\t\tid\s*=\s*"/).slice(1)
for (const b of blocks) {
  const id = b.slice(0, b.indexOf('"'))
  const f = (k) => (new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`).exec(b) || [])[1]
  const n = (k) => { const m = new RegExp(`\\b${k}\\s*=\\s*(-?[\\d.]+)`).exec(b); return m ? +m[1] : undefined }
  const type = (/\btype\s*=\s*(ACTION_TYPE_\w+)/.exec(b) || [])[1]
  const body = (/action\s*=\s*function\([^)]*\)([\s\S]*?)\n\t\tend/.exec(b) || [])[1] || ''
  const projs = [...body.matchAll(/add_projectile\(\s*"data\/entities\/projectiles\/(?:deck\/)?(\w+)\.xml"/g)].map((m) => m[1])
  const trig = [...body.matchAll(/add_projectile_trigger_(\w+)\(\s*"data\/entities\/projectiles\/(?:deck\/)?(\w+)\.xml"/g)].map((m) => ({ kind: m[1], proj: m[2] }))
  const delta = (k) => { const m = new RegExp(`c\\.${k}\\s*=\\s*c\\.${k}\\s*([+-])\\s*([\\d.]+)`).exec(body); return m ? (m[1] === '-' ? -1 : 1) * +m[2] : 0 }
  spells[id] = {
    id, name: tr(f('name')), type: (type || '').replace('ACTION_TYPE_', ''),
    icon: copyGfx(f('sprite')), levels: (f('spawn_level') || '').split(',').map(Number), probs: (f('spawn_probability') || '').split(',').map(Number),
    price: n('price') ?? 0, mana: n('mana') ?? 0, maxUses: n('max_uses') ?? -1,
    flag: f('spawn_requires_flag') || null, // 要先解锁(HasFlagPersistent)才会进 GetRandomAction 的池,新存档默认全锁
    desc: tr(f('description')),
    projectiles: projs.length ? projs : trig.map((t) => t.proj), trigger: trig[0]?.kind || null,
    fireRateWait: delta('fire_rate_wait'), spread: delta('spread_degrees'), speed: delta('speed_multiplier'), reload: delta('reload_time'),
    drawMany: type === 'ACTION_TYPE_DRAW_MANY' ? (n('draw_actions') ?? (/draw_actions\(\s*(\d+)/.exec(body) || [])[1] ?? 0) : 0,
  }
}

// ── 固定法杖:level_01/wand_001~017 + 初始两根 ──
const wands = {}
const wandOf = (xml, key) => {
  const ab = attrsOf((/<AbilityComponent\b([^>]*)>/.exec(xml) || [])[1])
  const gc = attrsOf((/<gun_config\b([^>]*)>/.exec(xml) || [])[1])
  const ga2 = attrsOf((/<gunaction_config\b([^>]*)>/.exec(xml) || [])[1])
  const hs = attrsOf((/<HotspotComponent\b([^>]*)>/.exec(xml) || [])[1])
  let sprite = ab.sprite_file || ''
  let offX = 0, offY = 0
  if (sprite.endsWith('.xml')) { const sx = readFile(sprite); const sp = attrsOf((/<Sprite\b([^>]*)>/.exec(sx || '') || [])[1]); offX = +(sp.offset_x || 0); offY = +(sp.offset_y || 0); sprite = sp.filename || '' }
  return {
    key, name: ab.ui_name || key, sprite: copyGfx(sprite), offX, offY, tipX: +(hs['offset.x'] || 8), tipY: +(hs['offset.y'] || 0),
    deckCapacity: +(gc.deck_capacity || 3), actionsPerRound: +(gc.actions_per_round || 1), reloadTime: +(gc.reload_time || 20), shuffle: gc.shuffle_deck_when_empty !== '0',
    fireRateWait: +(ga2.fire_rate_wait || 10), spread: +(ga2.spread_degrees || 0), speedMul: +(ga2.speed_multiplier || 1),
    manaMax: +(ab.mana_max || 100), manaCharge: +(ab.mana_charge_speed || 30),
    cards: (ab.add_these_child_actions || '').split(',').map((s) => s.trim()).filter(Boolean),
  }
}
for (let i = 1; i <= 17; i++) {
  const key = `wand_${String(i).padStart(3, '0')}`
  const xml = readFile(`data/entities/items/wands/level_01/${key}.xml`)
  if (xml) { wands[key] = wandOf(xml, key); wands[key].level1Cards = true } // 卡由 level_1_wand.lua 掷(运行时 Wands.js 复刻)
}
wands.starting_wand = wandOf(readFile('data/entities/items/starting_wand.xml'), 'starting_wand')
wands.starting_bomb_wand = { ...wandOf(readFile('data/entities/items/starting_bomb_wand.xml'), 'starting_bomb_wand'), cards: ['BOMB'], deckCapacity: 1, actionsPerRound: 1, shuffle: true, name: 'Bomb wand', rangeReload: [1, 10], rangeFireRate: [3, 8], rangeManaCharge: [5, 20], rangeManaMax: [80, 110] }
// wand_level_01(随机法杖):运行时用 17 根固定法杖里随机一根的数值 + level_1_wand 掷卡(gun_procedural 的完整复刻另做)
fs.writeFileSync(`${OUT}/wands.json`, JSON.stringify({ spells, wands }))
const projSpells = Object.values(spells).filter((s) => s.projectiles.length)
console.log(`wands.json:法术 ${Object.keys(spells).length}(带弹丸 ${projSpells.length}),法杖 ${Object.keys(wands).length},贴图 ${copied.size}`)
for (const k of ['LIGHT_BULLET', 'BOMB', 'RUBBER_BALL', 'DISC_BULLET', 'GRENADE', 'DIGGER', 'SLIMEBALL', 'AIR_BULLET', 'BLACK_HOLE', 'CLOUD_WATER', 'X_RAY', 'TORCH']) { const s = spells[k]; console.log(' ', k.padEnd(14), s ? `${s.name} ${s.type} mana=${s.mana} fr=${s.fireRateWait} sp=${s.spread} uses=${s.maxUses} → ${s.projectiles.join('+')}${s.trigger ? ' trig:' + s.trigger : ''}` : '缺') }
console.log('  starting_wand', JSON.stringify(wands.starting_wand))
console.log('  wand_001', JSON.stringify(wands.wand_001))
