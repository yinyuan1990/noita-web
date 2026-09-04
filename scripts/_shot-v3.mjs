import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

// 1. 开局防护罩气泡
await page.screenshot({ path: 'scripts/out/v3-1-shield.png' })

// 2. 切极光武器（按5），敌机排一排看光束
await page.evaluate(() => {
  const p = window.__air.player
  for (let i = 0; i < 4; i++) window.__air.spawnEnemy('fighter', p.x + 500 + i * 200, p.y + (i - 1.5) * 60)
})
await page.keyboard.press('5')
await page.waitForTimeout(320)
await page.screenshot({ path: 'scripts/out/v3-2-beam.png' })
await page.waitForTimeout(300)
await page.screenshot({ path: 'scripts/out/v3-3-beam2.png' })

// 3. 敌潮密度：等15秒统计
await page.waitForTimeout(15000)
const stat = await page.evaluate(() => ({ enemies: window.__air.enemies.length, shield: window.__air.player.shieldHp, fps: document.getElementById('fps').textContent }))
await page.screenshot({ path: 'scripts/out/v3-4-horde.png' })
console.log(JSON.stringify(stat))
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
