// 调研:把 Noita 实体系统(敌人 / 物理道具 / 物品 / 状态)从 xml + lua 里盘出来,作为"先看全效果再写代码"的底稿
import fs from 'node:fs'
import path from 'node:path'
const U = 'noita-ref/unpacked'
const attrsOf = (s) => { const o = {}; for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
const comps = (xml) => [...xml.matchAll(/<([A-Z][A-Za-z0-9_]+Component)\b/g)].map((m) => m[1])
const walk = (dir, out = []) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p, out); else if (f.endsWith('.xml')) out.push(p) } return out }

// ── 1. 群系敌人表:出生山两侧 + 煤矿 ──
console.log('## 1. 群系生成表(scripts/biomes/*.lua 的 g_* 权重表)\n')
for (const f of ['hills', 'mountain/mountain_left_entrance', 'mountain/mountain_hall', 'coalmine', 'coalmine_alt', 'excavationsite']) {
  const s = read(`${U}/scripts/biomes/${f}.lua`)
  if (!s) continue
  console.log(`### ${f}.lua`)
  for (const m of s.matchAll(/^(g_\w+)\s*=\s*\{([\s\S]*?)^\}/gm)) {
    const rows = [...m[2].matchAll(/prob\s*=\s*([\d.]+)[\s\S]*?min_count\s*=\s*(\d+)[\s\S]*?max_count\s*=\s*(\d+)[\s\S]*?entity\s*=\s*"([^"]*)"/g)]
    if (!rows.length) continue
    console.log(`- **${m[1]}**: ` + rows.map((r) => `${path.basename(r[4]).replace('.xml', '') || '(空)'} ${r[1]}×${r[2]}~${r[3]}`).join(' · '))
  }
  const regs = [...s.matchAll(/RegisterSpawnFunction\(\s*(0x[0-9a-fA-F]+)\s*,\s*"(\w+)"/g)].map((r) => `${r[2]}=${r[1].slice(-6)}`)
  if (regs.length) console.log(`- 标记色: ${regs.join(' ')}`)
  console.log()
}

// ── 2. 敌人 xml 解剖 ──
console.log('## 2. 敌人(entities/animals)\n')
const animals = walk(`${U}/entities/animals`).filter((p) => !/\/(boss_|the_end|parallel)/.test(p.replace(/\\/g, '/')))
const compCount = {}
const rows = []
for (const p of animals) {
  const s = read(p)
  const cs = comps(s)
  for (const c of new Set(cs)) compCount[c] = (compCount[c] || 0) + 1
  const dm = attrsOf((/<DamageModelComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const cd = attrsOf((/<CharacterDataComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const ai = attrsOf((/<AnimalAIComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const sp = attrsOf((/<SpriteComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const gen = attrsOf((/<GenomeDataComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  rows.push({ name: path.basename(p, '.xml'), hp: dm.hp, blood: dm.blood_material, ragdoll: dm.ragdoll_material, fly: cd.fly_velocity_x ? 'fly' : '', melee: ai.attack_melee_enabled, ranged: ai.attack_ranged_enabled, sprite: path.basename(sp.image_file || ''), faction: gen.herd_id, comps: cs.length })
}
console.log(`共 ${animals.length} 个 xml(含 Base 片段)。用得最多的组件:\n`)
console.log(Object.entries(compCount).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([c, n]) => `- ${c} ×${n}`).join('\n'))
console.log('\n出生地表 / 煤矿会碰到的几种:\n')
console.log('| 敌人 | hp | 血 | 布娃娃材质 | 近战 | 远程 | 阵营 | 精灵 |\n|---|---|---|---|---|---|---|---|')
for (const n of ['sheep', 'deer', 'elk', 'duck', 'zombie', 'miner', 'rat', 'worm', 'worm_tiny', 'firemage', 'shotgunner', 'slimeshooter', 'scavenger_grenade', 'fungus', 'giantshooter', 'longleg', 'bat', 'frog', 'shooter']) {
  const r = rows.find((x) => x.name === n); if (!r) continue
  console.log(`| ${n} | ${r.hp || ''} | ${r.blood || ''} | ${r.ragdoll || ''} | ${r.melee || ''} | ${r.ranged || ''} | ${r.faction || ''} | ${r.sprite} |`)
}
console.log()

// ── 3. 物理道具 ──
console.log('## 3. 物理道具(entities/props)\n')
const props = walk(`${U}/entities/props`)
const propComp = {}
const propRows = []
for (const p of props) {
  const s = read(p)
  const cs = comps(s)
  for (const c of new Set(cs)) propComp[c] = (propComp[c] || 0) + 1
  const pi = attrsOf((/<PhysicsImageShapeComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const pb = attrsOf((/<PhysicsBodyComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const dm = attrsOf((/<DamageModelComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const ex = attrsOf((/<ExplodeOnDamageComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const mi = attrsOf((/<MaterialInventoryComponent\b([^>]*)>/.exec(s) || ['', ''])[1])
  const mat = [...s.matchAll(/<Materials>[\s\S]*?<\/Materials>|material="(\w+)"/g)].map((m) => m[1]).filter(Boolean)
  propRows.push({ name: path.relative(`${U}/entities/props`, p).replace(/\\/g, '/').replace('.xml', ''), img: path.basename(pi.image_file || ''), material: pi.material || '', hp: dm.hp || '', explode: ex.explode_on_damage_percent || '', inv: mi.count_per_material_type ? 'yes' : '', physics: pb.friction !== undefined ? `f${pb.friction}/r${pb.restitution}` : (cs.includes('PhysicsBodyComponent') ? 'yes' : ''), comps: [...new Set(cs)] })
}
console.log(`共 ${props.length} 个。组件:\n`)
console.log(Object.entries(propComp).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([c, n]) => `- ${c} ×${n}`).join('\n'))
console.log('\n煤矿 / 山体里会碰到的:\n')
console.log('| 道具 | 形状图 | 材质 | hp | 炸 | 装液体 | 物理 |\n|---|---|---|---|---|---|---|')
for (const n of ['physics_box_explosive', 'physics_barrel_oil', 'physics_barrel_radioactive', 'physics_crate', 'physics/minecart', 'physics_cart', 'physics_stone_01', 'physics/lantern_small', 'physics_skateboard', 'physics_propane_tank', 'physics_seamine', 'physics_fungus', 'physics_pata', 'suspended_container', 'physics_chain_torch', 'physics/torch_small', 'physics_wheel', 'physics_torch_stand', 'physics_bone_01']) {
  const r = propRows.find((x) => x.name === n); if (!r) continue
  console.log(`| ${n} | ${r.img} | ${r.material} | ${r.hp} | ${r.explode} | ${r.inv} | ${r.physics} |`)
}
console.log()

// ── 4. 物品 ──
console.log('## 4. 物品(entities/items)\n')
const items = walk(`${U}/entities/items`)
const byDir = {}
for (const p of items) { const d = path.dirname(path.relative(`${U}/entities/items`, p)).replace(/\\/g, '/') || '.'; byDir[d] = (byDir[d] || 0) + 1 }
console.log(Object.entries(byDir).map(([d, n]) => `- ${d} ×${n}`).join('\n'))
for (const n of ['pickup/goldnugget', 'pickup/potion', 'pickup/heart', 'pickup/spell_refresh', 'wand_level_01', 'chest_random', 'pickup/egg_monster']) {
  const s = read(`${U}/entities/items/${n}.xml`); if (!s) continue
  console.log(`- **${n}**: ${[...new Set(comps(s))].join(', ')}`)
}
console.log()

// ── 5. 状态效果 ──
console.log('## 5. 状态效果(scripts/status_effects/status_list.lua)\n')
const st = read(`${U}/scripts/status_effects/status_list.lua`)
const ids = [...st.matchAll(/id\s*=\s*"(\w+)"[\s\S]*?ui_name\s*=\s*"\$?(\w+)"/g)].map((m) => m[1])
console.log(ids.join(' · '))
console.log()

// ── 6. 布娃娃 ──
console.log('## 6. 布娃娃(ragdolls/<名>/filenames.txt)\n')
const rd = fs.readdirSync(`${U}/ragdolls`).filter((d) => fs.statSync(`${U}/ragdolls/${d}`).isDirectory())
console.log(`${rd.length} 套;例 zombie: ${read(`${U}/ragdolls/zombie/filenames.txt`).trim().split(/\r?\n/).map((l) => path.basename(l)).join(' ')}`)
console.log()

// ── 7. 环境交互相关的组件/参数(从 player_base / 敌人 / 道具里挑出来) ──
console.log('## 7. 与环境的交互(数据层面能看到的)\n')
const pb = read(`${U}/entities/player_base.xml`)
const dmP = attrsOf((/<DamageModelComponent\b([^>]*)>/.exec(pb) || ['', ''])[1])
console.log(`- player DamageModel: materials_that_damage=${dmP.materials_that_damage}`)
console.log(`- player: materials_how_much_damage=${dmP.materials_how_much_damage}; fire_probability_of_ignition=${dmP.fire_probability_of_ignition}; fire_damage_amount=${dmP.fire_damage_amount}; falling_damages=${dmP.falling_damages}; air_needed=${dmP.air_needed} air_in_lungs_max=${dmP.air_in_lungs_max}`)
const zombie = read(`${U}/entities/animals/zombie.xml`)
const dmZ = attrsOf((/<DamageModelComponent\b([^>]*)>/.exec(zombie) || ['', ''])[1])
console.log(`- zombie DamageModel: hp=${dmZ.hp} blood=${dmZ.blood_material} blood_spray=${dmZ.blood_spray_material} ragdoll=${dmZ.ragdoll_material} ragdoll_files=${dmZ.ragdoll_filenames_file} fire_prob=${dmZ.fire_probability_of_ignition} materials_damage=${dmZ.materials_that_damage}`)
const luas = new Set()
for (const p of animals.concat(props)) for (const m of read(p).matchAll(/script_\w+="([^"]+\.lua)"/g)) luas.add(path.basename(m[1]))
console.log(`- 实体挂的 lua 脚本(死亡掉金 / 爆炸 / 特效)共 ${luas.size} 种,常见: ${[...luas].slice(0, 25).join(' ')}`)
