// 临时:把 biome lua 的 g_* 生成表抽成 [prob, min, max, entity, offX, offY, extra?] 数组(粘进 scenes.js 的 SPAWN_TABLES)
//   extra.g   = entities 组(字符串 = 单个;{e,min,max} = 掷数量的子组),director_helpers entity_load_camera_bound 的"load groups"分支
//   extra.ng  = ngpluslevel(NG+ 等级不够时该行连 total_prob 都不算,init_total_prob / random_from_table 都跳过)
//   extra.xmas= spawn_check(圣诞 12/24~26 才有;平时同样不计入)
// 用法:node scripts/_dump-spawn-tables.mjs excavationsite snowcave
import fs from 'node:fs'

/** 极简 lua 表解析:从 '{' 开始,返回 [值, 结束下标]。值:{k:v}/数组/字符串/数字/函数占位 */
function parseTable(s, i) {
  const obj = {}, arr = []
  i++ // '{'
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++
    if (s.startsWith('--[[', i)) { i = s.indexOf(']]', i) + 2; continue }
    if (s.startsWith('--', i)) { i = s.indexOf('\n', i); continue }
    if (s[i] === '}') return [Object.assign(arr, obj), i + 1]
    let key = null
    const km = /^([A-Za-z_]\w*)\s*=/.exec(s.slice(i, i + 40))
    if (km) { key = km[1]; i += km[0].length; while (/\s/.test(s[i])) i++ }
    let val
    if (s[i] === '{') { [val, i] = parseTable(s, i) }
    else if (s[i] === '"') { const e = s.indexOf('"', i + 1); val = s.slice(i + 1, e); i = e + 1 }
    else if (s.startsWith('function', i)) { let d = 0, j = i; for (;;) { const m = /\b(function|if|for|while|do|end)\b/g; m.lastIndex = j; const r = m.exec(s); if (!r) break; if (r[1] === 'end') { d--; if (d === 0) { j = r.index + 3; break } } else if (r[1] === 'function' || r[1] === 'if' || r[1] === 'for' || r[1] === 'while') d++; j = r.index + r[0].length } val = 'fn'; i = j }
    else { const m = /^[^,}\s]+/.exec(s.slice(i)); val = m[0]; i += m[0].length; if (/^-?[\d.]+$/.test(val)) val = +val }
    if (key) obj[key] = val; else arr.push(val)
  }
  return [Object.assign(arr, obj), i]
}
const ent = (p) => (p || '').replace(/^data\/entities\//, '').replace(/\.xml$/, '')

for (const f of process.argv.slice(2).length ? process.argv.slice(2) : ['coalmine', 'coalmine_alt', 'excavationsite']) {
  const s = fs.readFileSync(`noita-ref/unpacked/scripts/biomes/${f}.lua`, 'utf8')
  console.log('##', f)
  for (const m of s.matchAll(/^(g_\w+)\s*=\s*\{/gm)) {
    const [t] = parseTable(s, m.index + m[0].length - 1)
    const rows = t.filter((r) => typeof r === 'object' && r.prob !== undefined)
    if (!rows.length) continue
    // 布景池 / 背景贴图池:[prob, 材质图, 手绘, 背景, z](文件名去目录去 .png)
    if (rows[0].material_file !== undefined || rows[0].sprite_file !== undefined) {
      const f = (p) => (p || '').split('/').pop().replace(/\.png$/, '')
      console.log(`${m[1]} (scenes): ${JSON.stringify(rows.map((o) => (o.sprite_file !== undefined ? [+o.prob, f(o.sprite_file), 'bg', +(o.z_index ?? 40)] : [+o.prob, f(o.material_file), f(o.visual_file), f(o.background_file), o.color_material ? 'cm' : ''])))}`)
      continue
    }
    const out = rows.map((o) => {
      const row = [+o.prob, +(o.min_count ?? 1), +(o.max_count ?? 1), ent(o.entity), +(o.offset_x || 0), +(o.offset_y || 0)]
      const extra = {}
      if (o.entities) extra.g = o.entities.map((e) => (typeof e === 'string' ? ent(e) : { e: ent(e.entity), min: +(e.min_count ?? 1), max: e.max_count === undefined ? undefined : +e.max_count, ox: +(e.offset_x || 0), oy: +(e.offset_y || 0) }))
      if (o.ngpluslevel !== undefined) extra.ng = +o.ngpluslevel
      if (o.spawn_check !== undefined) extra.xmas = 1
      if (Object.keys(extra).length) row.push(extra)
      return row
    })
    console.log(`${m[1]}: ${JSON.stringify(out)}`)
  }
}
