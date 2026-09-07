// 探针:依次传送到一批整图房间 / 特殊群系,截图 + 记录该处群系、生成点、skipped、页面错误
// 用法:node scripts/_noita-rooms-shot.mjs [url] [name1,name2,...]   名字见下面 ROOMS;不给 = 全部
import { chromium } from 'playwright'
const url = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : 'http://localhost:5177/noita-play.html?log=0'
const pickArg = process.argv[2] && !process.argv[2].startsWith('http') ? process.argv[2] : process.argv[3]
const out = 'C:/Users/admin/AppData/Local/Temp'
// 名字 → 传送点(房间 chunk 左上 + 偏移,来自 _tmp-biome-pos.mjs 与标记位置)
const ROOMS = {
  orbroom_07: [4096 + 256, 512 + 300], essenceroom_alc: [-14336 + 256, 13312 + 200], mystery_teleport: [-4608 + 256, 10752 + 200], rock_room: [-3584 + 256, 3072 + 200],
  song_room: [11264 + 256, -5120 + 200], ocarina: [-10240 + 256, -6656 + 200], alchemist_secret: [3584 + 256, 15360 + 200], secret_lab: [-5120 + 256, 512 + 300],
  mestari_secret: [12288 + 256, 14848 + 300], ghost_secret: [-11776 + 256, 12800 + 300], meatroom: [6656 + 256, 8192 + 200], roboroom: [13824 + 256, 10752 + 300],
  robot_egg: [-5120 + 256, 14848 + 300], funroom: [5632 + 256, 3072 + 250], null_room: [13824 + 256, 7168 + 300], teleroom: [3584 + 256, 7168 + 250],
  friend_1: [3072 + 256, 5632 + 300], friend_3: [-5120 + 256, 4608 + 300], snowcave_secret_chamber: [3584 + 256, 4096 + 250], snowcastle_hourglass_chamber: [-4096 + 256, 5120 + 250],
  excavationsite_cube_chamber: [-4608 + 256, 2048 + 250], snowcastle_cavern_r: [1536 + 256, 5120 + 250], snowcastle_cavern_l: [-2560 + 256, 5120 + 250], wizardcave_entrance: [2560 + 256, 11264 + 200],
  bridge: [-10240 + 256, -512 + 400], solid_wall_tower_10: [9728 + 256, 4096 + 200], gourd_room: [-16384 + 256, -6656 + 256], watercave: [-2048 + 256, 512 + 256],
  snowcave_tunnel: [3072 + 256, 3072 + 256], lavalake_pit: [3584 + 256, 1536 + 256], lavalake_racing: [3072 + 256, 2048 + 300], dragoncave: [2048 + 256, 7168 + 300],
  boss_victoryroom: [6144 + 256, 14848 + 300], temple_altar_right_snowcastle: [0 + 256, 2560 + 300], lake_statue: [-14336 + 256, 0 + 300], boss_arena: [3546, 13009 - 100],
  boss_sky: [7168 + 256, -4608 + 100], barren: [-5632 + 256, -5120 + 100], darkness: [2560 + 256, -4608 + 100], potion_mimics: [-2048 + 256, -5120 + 100], watchtower: [13824 + 256, -512 + 100],
  floating_island: [512 + 266, -1536 + 440], mountain_tree: [-2048 + 672, -1324 + 897], scale: [12800 + 260, -512 + 380], sky_light: [-6144 + 256, -4608 + 256], hills_tower: [9216 + 256, 4096 + 256],
  fish_giga: [-14000, 10000 - 60], dragon_trigger: [2048 + 296, 7168 + 305 - 40], ghost_trigger: [-11776 + 255, 12800 + 336 - 30], centipede: [3546, 13009 - 60],
}
const names = pickArg ? pickArg.split(',') : Object.keys(ROOMS)
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1000)
for (const n of names) {
  const [x, y] = ROOMS[n]
  const tp = ([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y; np.player.hp = 100; np.entities.stats.skipped = {}; np.player.god = true }
  await page.evaluate(tp, [x, y])
  await page.waitForTimeout(2500)
  // 传送点落在实心里会被顶出去几千像素:等区块到了,在目标附近找一个 7×15 全空气的位置再传一次
  const fixed = await page.evaluate(([x, y]) => {
    const np = window.__np
    const solid = (wx, wy) => { const e = np.streamer.entries.get((Math.floor(wx / 512) + 35) + ',' + (Math.floor(wy / 512) + 14)); if (!e?.mat) return true; return e.mat[((wy & 511) * 512) + (wx & 511)] !== 0 }
    const free = (wx, wy) => { for (let j = -8; j <= 4; j++) for (let i = -4; i <= 4; i++) if (solid(wx + i, wy + j)) return false; return true }
    for (let r = 0; r < 240; r += 4) for (let a = 0; a < 16; a++) { const wx = Math.round(x + r * Math.cos(a * 0.3927)), wy = Math.round(y + r * Math.sin(a * 0.3927)); if (free(wx, wy)) { np.player.x = wx; np.player.y = wy; np.player.vx = 0; np.player.vy = 0; np.cam.x = wx; np.cam.y = wy; return [wx, wy] } }
    return null
  }, [x, y])
  if (fixed) console.log(`   (${n} 传送点在实心里,改到 ${fixed})`)
  await page.waitForTimeout(3500)
  const info = await page.evaluate(([x, y]) => {
    const np = window.__np, E = np.entities
    const cnt = (arr, f) => arr.reduce((a, e) => ((a[f(e)] = (a[f(e)] || 0) + 1), a), {})
    const cx = Math.floor(x / 512) + 35, cy = Math.floor(y / 512) + 14
    const entry = np.streamer.entries.get(cx + ',' + cy)
    return {
      biome: entry?.biome || null, ready: !!entry?.ready, spawns: (entry?.spawns || []).map((s) => `${s.entity}@${s.x - x | 0},${s.y - y | 0}`), scenes: (entry?.scenes || []).map((s) => s.dir + '/' + s.name),
      near: E.list.filter((e) => Math.abs(e.x - x) < 400 && Math.abs(e.y - y) < 400).map((e) => e.name), bodies: cnt((E.bodies || []).filter((b) => Math.abs(b.x - x) < 400 && Math.abs(b.y - y) < 400), (b) => b.name),
      skipped: E.stats.skipped, px: np.player.x | 0, py: np.player.y | 0,
      worms: (E.worms || []).map((w) => `${w.name}@${w.x | 0},${w.y | 0}`), triggers: (E.triggers || []).map((t) => t.name), bosses: E.list.filter((e) => e.boss).map((e) => `${e.name} hp=${e.hp.toFixed(1)} mul=${e.dmgMul ?? '-'} move=${e.bossMove?.mode || '-'} anim=${e.anim}`),
    }
  }, [x, y])
  console.log(`== ${n} @${x},${y}`, JSON.stringify(info))
  await page.screenshot({ path: `${out}/room-${n}.png` })
}
if (errors.length) console.log('ERRORS', [...new Set(errors)].slice(0, 10))
await browser.close()
