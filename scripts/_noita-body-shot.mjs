// 探针:刚体能不能安静下来 —— 桌子 / 崩塌块落地后 3s 内应入睡(不左右摇);崩塌块砸地炸一下、睡着变 concrete_static;金块按材质色打光
// 用法:node scripts/_noita-body-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, ent = np.entities, sim = np.sim, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  const groundY = (x) => { for (let y = Math.floor(pl.y) - 40; y < pl.y + 300; y++) { const m = sim.get(Math.floor(x), y); if (m > 0 && (sim.kind[m] === 1 || sim.kind[m] === 2)) return y } return pl.y + 40 }
  // 出生点右边是山洞口、左边是下坡:在左上方空中搭一块平的石台(80×6),东西都掉在这上面看
  const rock = np.mats.byName.get('rock_static'), PY = Math.floor(pl.y) - 20, PX0 = Math.floor(pl.x) - 130, PX1 = Math.floor(pl.x) - 50
  for (let y = PY; y < PY + 6; y++) for (let x = PX0; x <= PX1; x++) sim.set(x, y, rock, 0)
  for (let y = PY - 80; y < PY; y++) for (let x = PX0; x <= PX1; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0) // 台子上方清空
  const groundY0 = groundY
  const gx0 = PX1 - 20
  // ① 桌子从 40px 高掉到石台上,记 3s 内的角度轨迹,末了应该睡着、角度稳定
  ent.spawnProp('furniture_table', gx0, PY - 40)
  await wait(300)
  const t = ent.bodies.find((b) => b.name === 'furniture_table')
  const rots = [], ys = []
  for (let i = 0; i < 30; i++) { await wait(100); if (t) { rots.push(+t.rot.toFixed(3)); ys.push(t.y | 0) } }
  res.tableYs = ys.slice(0, 12)
  res.table = t ? { asleep: t.asleep, restT: +t.restT.toFixed(2), rot: +t.rot.toFixed(3), w: +t.w.toFixed(3), vx: +t.vx.toFixed(1), vy: +t.vy.toFixed(1), rotSwing: +(Math.max(...rots.slice(10)) - Math.min(...rots.slice(10))).toFixed(3) } : null
  // ② 崩塌块:直接造一块 concrete_collapsed 在空中掉下来 → 砸地应出 concrete_sand 碎屑 + 3s 内睡着变 concrete_static
  const w = 12, h = 10, mask = new Uint8Array(w * h).fill(1)
  const cx = PX0 + 20, cy = PY - 60
  const b = ent.spawnLooseChunk(cx, cy, w, h, mask, null, 'concrete_collapsed')
  b.collideExplode = true; b.sleepConvert = np.mats.byName.get('concrete_static')
  const sandM = np.mats.byName.get('concrete_sand'), cs = np.mats.byName.get('concrete_static')
  let sandSeen = 0
  for (let i = 0; i < 35; i++) { await wait(100); sandSeen = Math.max(sandSeen, np.debris.filter((d) => d.m === sandM).length) }
  let staticN = 0; for (let y = b.y - 20; y < b.y + 20; y++) for (let x = b.x - 20; x <= b.x + 20; x++) if (sim.get(x, y) === cs) staticN++
  res.chunk = { exploded: !!b.exploded, sandDebrisSeen: sandSeen, dead: b.dead, asleep: b.asleep, concreteStaticCells: staticN, state: { x: b.x | 0, y: b.y | 0, gy: groundY(pl.x - 30), vx: +b.vx.toFixed(1), vy: +b.vy.toFixed(1), w: +b.w.toFixed(3), rot: +b.rot.toFixed(3), restT: +b.restT.toFixed(2), n: b.n, edge: b.edge.length } }
  res.tableDef = { t: t ? { n: t.n, edge: t.edge.length, x: t.x | 0, y: t.y | 0, gy: groundY(gx0) } : null }
  // ⑤b 材质 platform_type:人 / 怪对 wood_loose(树)不挡、对 rock_static 挡;刚体(Box2D)两者都挡
  { const wl = np.mats.byName.get('wood_loose'), rs = np.mats.byName.get('rock_static'), tx = PX0 + 5, ty = PY - 3; sim.set(tx, ty, wl, 0); res.platform = { creatureOnTree: ent._solid(tx, ty), creatureOnRock: ent._solid(tx, PY + 1), bodyOnTree: ent._solidB(tx, ty), playerOnTree: !!np.solidAt?.(tx, ty), wlPT: np.mats.list[wl].platformType, rsPT: np.mats.list[rs].platformType }; sim.set(tx, ty, 0, 0) }
  // ③ 金块打光:醒着的金块位图第一个不透明像素应是金色(r 高、b 低),不是绿 / 红法线色
  ent.spawnItem('goldnugget_50', pl.x + 20, pl.y - 30, { vy: -20, pickCool: 99 })
  await wait(300)
  const g = ent.bodies.find((x) => x.gold === 50)
  if (g) { const cv = g._canvas(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let px = null; for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { px = [d[i], d[i + 1], d[i + 2]]; break } res.gold = { px, baseColor: g.baseColor?.toString(16) } }
  // ④ 尸块:在石台上放一只僵尸打死,3s 后所有肉块应睡着 / 不再左右晃
  {
    const z = ent.spawnCreature('zombie', PX0 + 45, PY - 12)
    await wait(300)
    if (z) ent.hurt(z, 9999, 0, 0, 'probe')
    await wait(3200)
    const rag = ent.bodies.filter((b) => b.isRagdoll && !b.dead)
    const jitter = []
    for (let i = 0; i < 20; i++) { await wait(50); jitter.push(rag.map((b) => b.asleep ? 0 : Math.abs(b.vx) + Math.abs(b.w) * 4)) }
    const maxJ = Math.max(0, ...jitter.flat())
    res.ragdoll = { pieces: rag.length, asleep: rag.filter((b) => b.asleep).length, awake: rag.filter((b) => !b.asleep).length, maxAwakeMotion: +maxJ.toFixed(2), sample: rag.slice(0, 4).map((b) => ({ x: b.x | 0, y: b.y | 0, rot: +b.rot.toFixed(2), asleep: b.asleep, restT: +b.restT.toFixed(2), vx: +b.vx.toFixed(1), vy: +b.vy.toFixed(1), w: +b.w.toFixed(2), n: b.n })) }
  }
  // ⑤ 穿树:找一棵实心树,树干格对人 / 怪都不挡,对子弹挡
  {
    np.veg.sync()
    const OX = 35 * 512, OY = 14 * 512
    let hit = null
    for (const it of np.veg.inst.values()) { const d = it.d; if (!/^tree/.test(d.name)) continue; for (let j = d.fh - 40; j < d.fh - 5 && !hit; j++) for (let i = 0; i < d.fw && !hit; i++) if (sim.get(d.x - OX + i, d.y - OY + j) === d.mat) hit = [d.x - OX + i, d.y - OY + j, d.name] }
    if (hit) res.treePass = { cell: hit, solidForPlayer: np.solidAt ? np.solidAt(hit[0], hit[1]) : null, solidForMonster: ent._solid(hit[0], hit[1]), matKind: np.mats.kind[sim.get(hit[0], hit[1])] }
  }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/body.png` })
await browser.close()
