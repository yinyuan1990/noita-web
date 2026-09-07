// 探针:同 _noita-simload-shot 的火海场景(用户 iPhone 的法杖卡组对地连开),开火 6 秒后用 CDP Profiler 采 8 秒 CPU profile,
// 按函数聚合 self time 打印前 40 —— 定位模拟 / 渲染在手机上 20~45ms 到底花在哪(iPhone 没法直接挂调试器,用 CPU 限速 ×4 近似)
// 用法:node scripts/_noita-prof-shot.mjs [url] [cpuThrottle=4] [phase=after|start]   start = 从按下开火那一刻起采 4 秒(开局那 1~2 秒的 5fps 尖峰)
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const throttle = +(process.argv[3] || 4)
const phase = process.argv[4] || 'after'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 390 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const cdp = await page.context().newCDPSession(page)
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 150000 })
await page.waitForTimeout(500)
await page.evaluate(() => {
  const np = window.__np, w = np.player.wands[0]
  w.cards = ['BURST_3', 'LASER', 'LARPA_UPWARDS', 'LARPA_CHAOS_2', 'LASER', 'METEOR']; w.deck = [...w.cards]; w.uses = {}; w.mana = w.manaMax = 1e6; w.cd = 0; w.reloadT = 0; np.setWand(0)
})
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
const panel = () => page.evaluate(() => document.getElementById('panel').textContent.split('\n').slice(0, 2).join(' | '))
let before, profile
if (phase === 'start') {
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  before = await panel()
  await cdp.send('Profiler.start')
  await page.mouse.move(560, 330); await page.mouse.down()
  for (let i = 0; i < 8; i++) { await page.keyboard.down(i & 1 ? 'a' : 'd'); await page.waitForTimeout(500); await page.keyboard.up(i & 1 ? 'a' : 'd') }
  await page.mouse.up()
  profile = (await cdp.send('Profiler.stop')).profile
} else {
  await page.mouse.move(560, 330); await page.mouse.down()
  for (let i = 0; i < 12; i++) { await page.keyboard.down(i & 1 ? 'a' : 'd'); await page.waitForTimeout(500); await page.keyboard.up(i & 1 ? 'a' : 'd') }
  await page.mouse.up()
  await page.waitForTimeout(1500)
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  before = await panel()
  await cdp.send('Profiler.start')
  await page.waitForTimeout(8000)
  profile = (await cdp.send('Profiler.stop')).profile
}
const after = await panel()
console.log('before:', before); console.log('after: ', after)
// 聚合 self time:samples[i] 是节点 id,timeDeltas[i] 是与上一采样的间隔(µs)
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]), dt = profile.timeDeltas[i] || 0
  total += dt
  const cf = n.callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`
  self.set(key, (self.get(key) || 0) + dt)
}
// 再算 total time(含子调用):按父链累加
const parent = new Map()
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)
const incl = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  const dt = profile.timeDeltas[i] || 0, seen = new Set()
  for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
    const cf = byId.get(id).callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`
    if (seen.has(key)) continue
    seen.add(key); incl.set(key, (incl.get(key) || 0) + dt)
  }
}
console.log(`\n采样 ${(total / 1000).toFixed(0)}ms  —— self time 前 40:`)
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`)
console.log('\ninclusive 前 30:')
for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`)
await browser.close()
