// 临时探针:憋气 → 淹死 → 死亡画面 → 回出生点
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
// 出生地右边的水潭(水探针用的坐标),血先调低到 0.5(12 HP),省得等
// 出生地脚下挖个坑灌满水,把人放进去(头在水面下),血先调低到 0.5(12 HP)省得等
const spot = await page.evaluate(() => {
  const np = window.__np, W = np.mats.byName.get('water')
  const x = 227, y = -60
  np.sim.paintCircle(x, y, 22, 0)
  np.sim.paintCircle(x, y + 2, 18, W)
  np.player.hp = 0.5; np.player.x = x; np.player.y = y + 8; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y
  return { x, y, m: np.sim.get(x, y - 6) }
})
console.log('water pit', spot)
const samples = []
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(1000)
  // 会浮起来:每秒把人按回水面下 12px(模拟往下游)
  const s = await page.evaluate(() => { const p = window.__np.player; if (!p.headInLiq && !p.dead) { p.y = -52; p.vy = 0 } return { t: 0, head: p.headInLiq, air: +p.air.toFixed(1), hp: +p.hp.toFixed(2), dead: p.dead, y: p.y | 0 } })
  s.t = i + 1; samples.push(s)
  if (s.dead) break
}
console.log(samples.map((s) => `${s.t}s head=${s.head} air=${s.air} hp=${s.hp}${s.dead ? ' DEAD' : ''}`).join('\n'))
console.log('death overlay', await page.evaluate(() => ({ on: document.getElementById('death').classList.contains('on'), info: document.getElementById('deathInfo').textContent })))
await page.screenshot({ path: `${out}/drown-0.png` })
await page.click('#btnRespawn')
await page.waitForTimeout(800)
console.log('after respawn', await page.evaluate(() => { const p = window.__np.player; return { x: p.x | 0, y: p.y | 0, hp: p.hp, dead: p.dead, on: document.getElementById('death').classList.contains('on') } }))
await browser.close()
