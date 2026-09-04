// 导出「我方一键升级」等级曲线 -> player_data.json，并打印文档用表格
// 我方只有等级(1~500)：每级给 攻击/生命/战力，升级消耗一种货币。无品质/星级/材料。
const fs = require('fs'); const path = require('path')
const A = 'E:/soft/xiaoshuodongtai/ziyuan/main/assets/data/'
function P(f) { const t = fs.readFileSync(A + f, 'utf16le').replace(/^\uFEFF/, '').replace(/\r/g, ''); const L = t.split('\n').filter(x => x.length); const k = L[1].split('\t'); return L.slice(3).map(l => { const c = l.split('\t'); const o = {}; k.forEach((kk, i) => o[kk] = c[i] ?? ''); return o }) }
function kv(s) { const o = {}; (s || '').split('|').forEach(p => { const [a, b] = p.split(';'); if (a) o[+a] = +b }); return o }
const lv = P('memberlevel.tbl')
const levels = lv.map(r => { const p = kv(r.PropAll); return { lv: +r.Level, atk: p[3] || 0, hp: p[1] || 0, def: p[4] || 0, combat: +r.CombatPoint, upCost: +r.UpNeedExp || 0 } }).sort((a, b) => a.lv - b.lv)
const out = { meta: { track: '单一等级(一键升级)', levelRange: [1, levels.length], note: '我方只有等级；攻击=atk,生命=hp,战力=combat；升级消耗upCost(一种货币)。伤害=atk×弹幕百分比。' }, levels }
fs.writeFileSync(path.join(__dirname, 'player_data.json'), JSON.stringify(out))
console.log('written player_data.json  levels', levels.length)
const fmt = n => n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : '' + n
console.log('\n|等级|攻击|生命|战力|升级消耗|')
console.log('|--|--|--|--|--|')
for (const n of [1, 2, 5, 10, 20, 30, 50, 80, 100, 150, 200, 300, 400, 500]) { const r = levels.find(x => x.lv === n); if (!r) continue; console.log('|' + n + '|' + fmt(r.atk) + '|' + fmt(r.hp) + '|' + fmt(r.combat) + '|' + fmt(r.upCost) + '|') }
