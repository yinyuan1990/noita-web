// 极光武器 + 导弹拖尾验证：node scripts/air-aurora.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)

// 1. 导弹拖尾：切到导弹 Lv6（多发），对右侧目标齐射
await page.evaluate(() => {
  const p = window.__air.player
  window.__air.weaponLv[1] = 6
  for (let i = 0; i < 3; i++) window.__air.spawnEnemy('wingman', p.x + 900, p.y - 150 + i * 150)
})
await page.keyboard.press('2')
await page.keyboard.down('d')
await page.waitForTimeout(200)
await page.keyboard.up('d')
await page.keyboard.down(' ')
await page.waitForTimeout(520)
await page.screenshot({ path: 'scripts/out/aurora-1-missile-trail.png' })
await page.keyboard.up(' ')
await page.waitForTimeout(1200)

// 2. 极光 Lv1：单光带蛇形
await page.keyboard.press('5')
await page.keyboard.down(' ')
await page.waitForTimeout(650)
await page.screenshot({ path: 'scripts/out/aurora-2-lv1.png' })
await page.keyboard.up(' ')

// 3. 极光 Lv9：五光带帘幕，洞穿一列纵队
await page.evaluate(() => {
  const p = window.__air.player
  window.__air.weaponLv[4] = 9
  for (let i = 0; i < 5; i++) window.__air.spawnEnemy('fighter', p.x + 500 + i * 170, p.y)
})
const scoreBefore = await page.evaluate(() => document.getElementById('score').textContent)
await page.keyboard.down(' ')
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/aurora-3-lv9-pierce.png' })
await page.waitForTimeout(900)
await page.screenshot({ path: 'scripts/out/aurora-4-lv9-boom.png' })
await page.keyboard.up(' ')
const scoreAfter = await page.evaluate(() => document.getElementById('score').textContent)

const stat = await page.evaluate(() => ({
  weapon: document.getElementById('weapon').textContent,
  fps: document.getElementById('fps').textContent,
  enemies: window.__air.enemies.length,
}))
console.log(`score ${scoreBefore} -> ${scoreAfter} | hud="${stat.weapon}" | enemies=${stat.enemies} | ${stat.fps}`)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
