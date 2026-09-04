// 导出 敌机阵型 + 弹道配置 + boss技能弹幕 -> battle_spawn_data.json
// 用法: node gen_battle_data.cjs
const fs = require('fs'); const path = require('path')
const A = 'E:/soft/xiaoshuodongtai/ziyuan/main/assets/data/'
function P(f) { const t = fs.readFileSync(A + f, 'utf16le').replace(/^\uFEFF/, '').replace(/\r/g, ''); const L = t.split('\n').filter(x => x.length); const k = L[1].split('\t'); return L.slice(3).map(l => { const c = l.split('\t'); const o = {}; k.forEach((kk, i) => o[kk] = c[i] ?? ''); return o }) }

// 阵型 GroupDef 解析
function parseGroup(def) {
  const out = []
  def = (def || '').replace(/"/g, '')
  for (let tok of def.split(';')) {
    tok = tok.trim(); if (!tok) continue
    const m = /^\((\d+),(\d+)@([0-9]+)\|([^,]+),(.+)\)$/.exec(tok)
    if (m) out.push({ monster: +m[1], count: +m[2], path: +m[3], x: m[4].trim(), y: m[5].trim() })
    else if (/^\d+$/.test(tok)) out.push({ delay: +tok })
    else out.push({ raw: tok })
  }
  return out
}
const RACE = { 1: '人族', 2: '虫族', 3: '魔灵' }
const fm = P('battleformation.tbl')
const formations = fm.map(r => ({ id: +r.FormationID, race: RACE[r.Type] || r.Type, type: +r.Type, groups: parseGroup(r.GroupDef), comment: r.Comment }))

// 行进/弹道配置
function cfg(r) { return { id: +r.ID, anchor: +r.Anchor, pos: r.Position, angle: +r.Angle, action: +r.Actiontype, speed: r.Speed, accel: r.Speed_acc, center: r.Ct_delta, omega: +r.Omega, deltaR: +r.Delta_r, alpha: +r.Alpha } }
const moveCfg = P('battlepluscfg.tbl').map(cfg)   // 敌机走位
const bulletCfg = P('battlebltcfg.tbl').map(cfg)  // 子弹弹道

// 子弹视觉
const blt = {}
for (const r of P('battleblt.tbl')) blt[r.BulletID] = { model: r.Model, inherit: +r.InheritPercent, through: +r.IsThrough, box: r.BoxSize }

// 技能弹幕
const skById = {}
for (const r of P('battleskill.tbl')) if (!skById[r.SkillID]) skById[r.SkillID] = { id: +r.SkillID, type: +r.SkillType, plan: r.BulletPlan, bullet: r.BulletID, num: r.TargetNum, range: r.Range, freq: +r.Frequency, dur: +r.Duration, isCommon: +r.IsCommon }

// boss 及其技能
const bm = P('battlemonster.tbl')
const bosses = []
for (const r of bm) {
  if (r.DieEffect !== '704') continue // Boss 死亡效果
  const skills = (r.MonsterSkill || '').split('|').map(s => +s.split(';')[0]).filter(Boolean)
  bosses.push({ id: +r.MonsterID, name: r.MonsterName, skills, crazy: r.CrazySkill })
}

const out = {
  meta: { note: '阵型完全数据驱动可复现；弹幕方案(plan)多为引擎脚本(1069种),精确几何在代码,常见样式见文档;子弹伤害=boss攻击×inherit', formations: formations.length, bosses: bosses.length },
  formations, moveCfg, bulletCfg, bullets: blt, skills: skById, bosses,
}
fs.writeFileSync(path.join(__dirname, 'battle_spawn_data.json'), JSON.stringify(out))
console.log('formations', formations.length, '| moveCfg', moveCfg.length, '| bulletCfg', bulletCfg.length, '| skills', Object.keys(skById).length, '| bosses', bosses.length)
// 打印文档用统计
const races = {}; for (const f of formations) races[f.race] = (races[f.race] || 0) + 1
console.log('阵型按种族', JSON.stringify(races))
const gsz = formations.map(f => f.groups.filter(g => g.monster).length)
console.log('每阵型出怪数 min/avg/max', Math.min(...gsz), (gsz.reduce((a, b) => a + b) / gsz.length).toFixed(1), Math.max(...gsz))
