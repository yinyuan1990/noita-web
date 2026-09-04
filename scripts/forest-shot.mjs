// 森林 demo 截图验证：node scripts/forest-shot.mjs [outPrefix]
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'forest'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/forest-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.screenshot({ path: `scripts/out/${prefix}-1-idle.png` })

// 把主角传送到水塘中央，来回趟水
const info = await page.evaluate(() => {
  const d = window.__forestDemo
  if (!d) return null
  d.hero.x = 1380
  d.hero.y = 420
  return { onWater: d.isOnWater(1380, 426), wetness: d.getWetness() }
})
console.log('pond center:', JSON.stringify(info))

for (let i = 0; i < 6; i++) {
  await page.evaluate((i) => {
    const d = window.__forestDemo
    d.target.x = 1380 + (i % 2 === 0 ? 120 : -120)
    d.target.y = 420 + (i % 2 === 0 ? 20 : -20)
    d.target.active = true
  }, i)
  await page.waitForTimeout(450)
}
await page.screenshot({ path: `scripts/out/${prefix}-2-wade.png` })
await page.screenshot({
  path: `scripts/out/${prefix}-3-pond.png`,
  clip: { x: 780, y: 180, width: 760, height: 420 },
})

console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
