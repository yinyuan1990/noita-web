// 扫描 juese 资源库（二进制 .skel）：提取可打印字符串，按动画词表粗筛主角候选
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), '..', 'juese')

// 动画名词表（ascii 提取后精确/前缀匹配）
const VOCAB = {
  idle: ['idle', 'daiji', 'stand', 'holdon', 'breath'],
  move: ['run', 'walk', 'move', 'zou', 'go'],
  jump: ['jump', 'tiao'],
  skill: ['skill', 'attack', 'att', 'atk', 'pugong', 'jineng', 'dazhao'],
  hit: ['hit', 'hurt', 'damage', 'shouji'],
  die: ['death', 'die', 'dead', 'siwang', 'dao'],
  misc: ['win', 'show', 'victory', 'talk', 'speak'],
}

/** 从二进制里抽出所有 2~24 长度的 [a-z0-9_]+ 串 */
function extractStrings(buf) {
  const out = new Set()
  let cur = ''
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || (c >= 65 && c <= 90)) {
      cur += String.fromCharCode(c).toLowerCase()
    } else {
      if (cur.length >= 2 && cur.length <= 24) out.add(cur)
      cur = ''
    }
  }
  if (cur.length >= 2 && cur.length <= 24) out.add(cur)
  return out
}

function matchVocab(strs, keys) {
  const hits = new Set()
  for (const s of strs) {
    for (const k of keys) {
      // 精确或 keyword+数字后缀（skill1/attack_2）
      if (s === k || new RegExp(`^${k}[_]?\\d{0,2}$`).test(s)) hits.add(s)
    }
  }
  return [...hits]
}

const rows = []
for (const dir of fs.readdirSync(ROOT)) {
  const full = path.join(ROOT, dir)
  if (!fs.statSync(full).isDirectory()) continue
  const skelFile = fs.readdirSync(full).find((f) => f.endsWith('.skel'))
  if (!skelFile) continue
  const strs = extractStrings(fs.readFileSync(path.join(full, skelFile)))
  const cat = {}
  for (const [name, keys] of Object.entries(VOCAB)) cat[name] = matchVocab(strs, keys)
  rows.push({ dir, cat })
}

const good = rows
  .filter((r) => r.cat.idle.length && r.cat.move.length && r.cat.skill.length >= 2)
  .sort((a, b) => b.cat.skill.length - a.cat.skill.length)

console.log(`共 ${rows.length} 个 .skel 角色；基础(待机+移动)+≥2技能 的候选 ${good.length} 个：\n`)
for (const r of good) {
  const parts = Object.entries(r.cat)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}:[${v.join(',')}]`)
  console.log(`${r.dir}\n  ${parts.join('  ')}\n`)
}
