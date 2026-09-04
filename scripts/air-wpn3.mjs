// 武器3集束炸弹爆炸 + 核弹抛射验证：node scripts/air-wpn3.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)

// 切武器3（集束炸弹），铺敌机，直接触发一次集束爆炸看光痕
await page.evaluate(() => {
  const p = window.__air.player
  for (let i = 0; i < 6; i++) window.__air.spawnEnemy('fighter', p.x - 400 + i * 160, p.y - 480)
  window.__air.spawnExplosion('cluster', p.x, p.y - 360, 1.4)
})
await page.waitForTimeout(200)
await page.screenshot({ path: 'scripts/out/wpn3-cluster.png' })

// 核弹抛射：按 B，拍飞行中与起爆
await page.evaluate(() => { window.__air.player.nukes = 3; window.__air.tryNuke() })
await page.waitForTimeout(180)
await page.screenshot({ path: 'scripts/out/wpn3-nuke-fly.png' })
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/wpn3-nuke-blast.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
