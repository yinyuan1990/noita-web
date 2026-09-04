// ── 玩家精灵 data/enemies_gfx/player.xml(动画表 + 热点图)→ public/res/noita/player/ + player.json ──
// 动画:stand/walk/run/jump_up/jump_fall/land/fly_idle/fly_move/swim_idle/swim_move/knockback…(12×19,每行 8 帧)
// 热点:player_hotspots.png 同尺寸,按色标出每帧的 right_arm_start(#800000)/hand 等;手臂 player_arm.xml 5×5,hand 热点 #00ff00
import fs from 'fs'
import path from 'path'

const UNPACKED = 'noita-ref/unpacked'
const OUT = 'public/res/noita/player'
fs.mkdirSync(OUT, { recursive: true })
const attrsOf = (s) => { const o = {}; for (const m of (s || '').matchAll(/([\w:.\-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }
const num = (v, d) => (v === undefined ? d : +v)

const parseSprite = (rel) => {
  const s = fs.readFileSync(`${UNPACKED}/${rel}`, 'utf8')
  const sp = attrsOf((/<Sprite\b([^>]*)>/.exec(s) || [])[1])
  const anims = {}
  for (const m of s.matchAll(/<RectAnimation\b([^>]*)>/g)) {
    const a = attrsOf(m[1])
    anims[a.name] = { x: num(a.pos_x, 0), y: num(a.pos_y, 0), frames: num(a.frame_count, 1), fw: num(a.frame_width, 0), fh: num(a.frame_height, 0), wait: num(a.frame_wait, 0.1), loop: num(a.loop, 1), perRow: num(a.frames_per_row, 8) }
  }
  const hotspots = {}
  for (const m of s.matchAll(/<Hotspot\b([^>]*)>/g)) { const h = attrsOf(m[1]); hotspots[h.name] = parseInt(h.color.slice(-6), 16) }
  return { image: path.basename(sp.filename), hotspotsImage: sp.hotspots_filename ? path.basename(sp.hotspots_filename) : null, offX: num(sp.offset_x, 0), offY: num(sp.offset_y, 0), def: sp.default_animation || 'default', anims, hotspots }
}
const body = parseSprite('enemies_gfx/player.xml')
const arm = parseSprite('enemies_gfx/player_arm.xml')
for (const f of ['player.png', 'player_hotspots.png', 'player_arm.png', 'player_arm_hotspots.png']) fs.copyFileSync(`${UNPACKED}/enemies_gfx/${f}`, `${OUT}/${f}`)
// 法杖贴图:每种法术配一根不同的杖(items_gfx/wands/wand_00xx.png)
fs.mkdirSync(`${OUT}/wands`, { recursive: true })
const wands = []
for (const f of fs.readdirSync(`${UNPACKED}/items_gfx/wands`)) if (/^wand_\d{4}\.png$/.test(f)) { fs.copyFileSync(`${UNPACKED}/items_gfx/wands/${f}`, `${OUT}/wands/${f}`); wands.push(f) }
fs.writeFileSync(`${OUT}/player.json`, JSON.stringify({ body, arm, wand: 'wands/' + (wands[6] || wands[0]), wands: wands.map((w) => 'wands/' + w) }))
console.log('wands:', wands.length)
console.log('player.json:', Object.keys(body.anims).join(' '), '| hotspots', JSON.stringify(body.hotspots), JSON.stringify(arm.hotspots))
