// 探针:帧时间剖析 —— 传送到指定点,给各子系统的 update / render 包一层计时,跑 4s 报每帧平均毫秒
// 用法:node scripts/_noita-prof-shot.mjs [x,y] [url] [deep]   —— deep = 连 Entities 内部 _xxx 方法也包一层(调用很密的方法会被包装本身拖慢,只看相对量)
import { chromium } from 'playwright'
const [tx, ty] = (process.argv[2] || '300,400').split(',').map(Number)
const url = process.argv[3] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const deep = process.argv[4] === 'deep'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y; np.flags.god = true }, [tx, ty])
await page.waitForTimeout(3000)
const r = await page.evaluate(async (deep) => {
  const np = window.__np, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const acc = {}
  const wrap = (obj, name, label) => {
    const f = obj[name]; if (typeof f !== 'function') return
    obj[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc[label] = (acc[label] || 0) + performance.now() - t; return r }
  }
  wrap(np.sim, 'step', 'sim.step'); wrap(np.streamer, 'update', 'streamer.update')
  wrap(np.entities, 'update', 'entities.update'); wrap(np.entities, 'render', 'entities.render'); wrap(np.entities, 'lights', 'entities.lights')
  wrap(np.entities, '_updateBodies', 'entities._updateBodies'); wrap(np.entities, '_updateRagdolls', 'entities._updateRagdolls')
  wrap(np.projectiles, 'update', 'projectiles.update'); wrap(np.projectiles, 'render', 'projectiles.render'); wrap(np.projectiles, 'lights', 'projectiles.lights')
  wrap(np.veg, 'update', 'veg.update'); wrap(np.veg, 'render', 'veg.render'); wrap(np.veg, 'sync', 'veg.sync')
  wrap(np.sky, 'render', 'sky.render'); wrap(np.sky, 'draw', 'sky.draw')
  wrap(np.streamer, 'draw', 'streamer.draw')
  // Entities 原型上所有方法(含内部 _xxx):看 update 里的时间花在哪个环节(嵌套调用会重复计,看相对量)
  const proto = Object.getPrototypeOf(np.entities)
  const calls = {}
  if (deep) for (const name of Object.getOwnPropertyNames(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, name)
    if (name === 'constructor' || !desc || typeof desc.value !== 'function' || /^(update|render|lights|_updateBodies|_updateRagdolls)$/.test(name)) continue
    const f = desc.value
    proto[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc['E.' + name] = (acc['E.' + name] || 0) + performance.now() - t; calls['E.' + name] = (calls['E.' + name] || 0) + 1; return r }
  }
  // rAF 帧数
  let frames = 0, t0 = performance.now(), maxGap = 0, lastT = t0
  const tick = (t) => { frames++; maxGap = Math.max(maxGap, t - lastT); lastT = t; if (t - t0 < 4000) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  await wait(4200)
  const el = (performance.now() - t0) / 1000
  const out = { fps: +(frames / el).toFixed(1), maxFrameGapMs: +maxGap.toFixed(0), bodies: np.entities.bodies.length, awakeBodies: np.entities.bodies.filter((b) => !b.asleep && !b.dead).length, lanterns: np.entities.bodies.filter((b) => /lantern/.test(b.name)).length, ragdolls: np.entities.ragdolls.length, creatures: np.entities.list.length, projectiles: np.projectiles.list.length, debris: np.debris.length, chunks: np.streamer.entries.size, activeBlocks: np.sim.activeBlocks, perFrameMs: {} }
  for (const [k, v] of Object.entries(acc)) out.perFrameMs[k] = +(v / frames).toFixed(2)
  out.top = Object.entries(acc).filter(([k]) => k.startsWith('E.')).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${(v / frames).toFixed(2)}ms x${(calls[k] / frames).toFixed(1)}/frame`)
  return out
}, deep)
console.log(JSON.stringify(r, null, 1))
await browser.close()
