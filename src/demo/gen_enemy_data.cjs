// 导出敌人数值 + 关卡进度为程序可读 JSON -> enemy_data.json
// 用法: node gen_enemy_data.cjs
const fs = require('fs'); const path = require('path')
const A = 'E:/soft/xiaoshuodongtai/ziyuan/main/assets/data/'
const OUT = path.join(__dirname, 'enemy_data.json')

function P(f) { const t = fs.readFileSync(A + f, 'utf16le').replace(/^\uFEFF/, '').replace(/\r/g, ''); const L = t.split('\n').filter(x => x.length); const k = L[1].split('\t'); return L.slice(3).map(l => { const c = l.split('\t'); const o = {}; k.forEach((kk, i) => o[kk] = c[i] ?? ''); return o }) }
function kv(s) { const o = {}; (s || '').split('|').forEach(p => { const [a, b] = p.split(';'); if (a) o[+a] = +b }); return o }
function stat(s) { const a = kv(s); return { hp: a[1] || 0, atk: a[3] || 0, def: a[4] || 0 } }

// 敌人各档位(按方案×等级)
const blm = P('battlelevelmonster.tbl')
const monsterLevels = {}
for (const r of blm) {
  const s = r.ID; (monsterLevels[s] = monsterLevels[s] || []).push({
    lv: +r.Level, combat: +r.CombatPoint,
    chongsi: stat(r.Attribute1), xiaoguai: stat(r.Attribute2), duizhang: stat(r.Attribute3),
    jingying: stat(r.Attribute4), boss: stat(r.Attribute5), chaojiboss: stat(r.Attribute6),
    collideMob: +r.CollisionParam1 || 0, collideBoss: +r.CollisionParam2 || 0,
  })
}
for (const s in monsterLevels) monsterLevels[s].sort((a, b) => a.lv - b.lv)

// 关卡进度
const camp = P('campaign.tbl')
const stages = camp.map(c => ({
  id: +c.CampaignID, name: c.CampaignName, type: +c.TypeID, chapter: +c.ChapterID,
  monsterLv: +c.DefaultMonsterLv || 0, fighting: +c.Fighting || 0, fightingLeast: +c.FightingLeast || 0,
  bossId: c.BossID || '', sp: c.SPCost || '',
}))

const out = {
  meta: { levelRange: [1, 800], schemes: Object.keys(monsterLevels).map(Number), mainScheme: 1, note: '数值为原游戏放置手游绝对值，接入 demo 请按文档第8节用 TTK 缩放；档位倍率可直接用。' },
  tierRatio: { chongsi: 0.02, xiaoguai: 1, duizhang: 2, jingying: 7, boss: 30, chaojiboss: 80 },
  tierName: { chongsi: '秒死怪', xiaoguai: '小怪', duizhang: '队长怪', jingying: '精英怪', boss: 'BOSS', chaojiboss: '超级BOSS' },
  damageCapPct: { chongsi: 1, xiaoguai: 1, duizhang: 1, jingying: 1, boss: 1, chaojiboss: 0.5 },
  monsterLevels,   // { "1":[{lv,combat,chongsi:{hp,atk,def},...}], "2":[...], ... }
  stages,          // [{id,name,type,chapter,monsterLv,fighting,...}]
}
fs.writeFileSync(OUT, JSON.stringify(out))
console.log('written', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + 'MB')
console.log('schemes', out.meta.schemes.join(','), '| scheme1 levels', monsterLevels['1'].length, '| stages', stages.length)
