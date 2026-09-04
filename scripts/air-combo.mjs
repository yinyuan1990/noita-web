// 组合火力 + P 键升级 + 编队验证：node scripts/air-combo.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// P 键直接升级 3 次（机炮 1→4）
await page.keyboard.press('p')
await page.keyboard.press('p')
await page.keyboard.press('p')
const lvAfterP = await page.evaluate(() => window.__air.weaponLv.join(','))

// 全武器练起来 → 组合火力齐射
await page.evaluate(() => {
  const a = window.__air
  a.weaponLv[1] = 3
  a.weaponLv[2] = 2
  a.weaponLv[3] = 3
})
await page.keyboard.press('1') // 主武器机炮，其余作为副武器
await page.keyboard.down(' ')
await page.waitForTimeout(800)
await page.screenshot({ path: 'scripts/out/combo-1-allguns.png' })
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/out/combo-2-allguns-boom.png' })
await page.keyboard.up(' ')

// 编队验证：横列 / 长蛇纵队 / 轰炸机护航
await page.evaluate(() => {
  const a = window.__air
  for (const e of [...a.enemies]) e.hp = 0 // 想办法清场？直接改血让子弹打——不行，直接搬远
  for (const e of a.enemies) { e.x += 99999; e.y += 99999 }
  a.spawnFormation('line', a.player.x - 700, a.player.y - 420)
  a.spawnFormation('column', a.player.x + 700, a.player.y - 380)
  a.spawnFormation('escort', a.player.x, a.player.y + 560)
})
await page.waitForTimeout(1800)
await page.screenshot({ path: 'scripts/out/combo-3-formations.png' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'scripts/out/combo-4-formations-later.png' })

console.log('weaponLv after 3x P:', lvAfterP)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
