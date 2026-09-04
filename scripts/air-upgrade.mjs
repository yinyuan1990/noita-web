// 武器升级效果验证：node scripts/air-upgrade.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// 掉一个 P 在玩家旁边，验证磁吸+拾取（机炮 1→2 级）
await page.evaluate(() => {
  const a = window.__air
  a.spawnPickup('P', a.player.x + 160, a.player.y)
  a.spawnPickup('H', a.player.x - 200, a.player.y + 60)
})
await page.screenshot({ path: 'scripts/out/up-0-pickups.png' })
await page.waitForTimeout(900)
const lvAfterPickup = await page.evaluate(() => window.__air.weaponLv.join(','))

// 满级机炮弹幕
await page.evaluate(() => (window.__air.weaponLv[0] = 4))
await page.keyboard.down(' ')
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/out/up-1-vulcan-max.png' })

// 满级导弹 4 连发
await page.evaluate(() => (window.__air.weaponLv[1] = 4))
await page.keyboard.press('2')
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/up-2-missile-max.png' })

// 满级炸弹三连地毯
await page.evaluate(() => (window.__air.weaponLv[2] = 4))
await page.keyboard.press('3')
await page.waitForTimeout(1250)
await page.screenshot({ path: 'scripts/out/up-3-bomb-max.png' })

// 满级电浆三球
await page.evaluate(() => (window.__air.weaponLv[3] = 4))
await page.keyboard.press('4')
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/up-4-tesla-max.png' })
await page.keyboard.up(' ')

console.log('weaponLv after pickup:', lvAfterPickup)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
