// 四种武器爆炸效果定点对比：node scripts/air-fx.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// 同屏四角各放一种爆炸（相对玩家）
await page.evaluate(() => {
  const a = window.__air
  const { x, y } = a.player
  for (let i = 0; i < 4; i++) a.spawnExplosion('vulcanHit', x - 520 + (Math.random() - 0.5) * 60, y - 260 + (Math.random() - 0.5) * 60)
  a.spawnExplosion('fire', x + 520, y - 260)
  a.spawnExplosion('cluster', x - 520, y + 280)
  a.spawnExplosion('tesla', x + 520, y + 280)
})
await page.waitForTimeout(280)
await page.screenshot({ path: 'scripts/out/fx-1-quad-early.png' })
await page.waitForTimeout(450)
await page.screenshot({ path: 'scripts/out/fx-2-quad-mid.png' })
await page.waitForTimeout(1300)
await page.screenshot({ path: 'scripts/out/fx-3-aftermath.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
