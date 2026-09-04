// 动态水位河流验证：node scripts/forest-river.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[error] ${m.text()}`)
})

await page.goto('http://localhost:5177/forest-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

for (const lv of [0.15, 0.55, 0.95]) {
  await page.evaluate((v) => window.__forestDemo.setLevel(v), lv)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `scripts/out/river-${Math.round(lv * 100)}.png` })
}

// 高水位下站进河里，验证踩水判定
const check = await page.evaluate(() => {
  const d = window.__forestDemo
  d.hero.x = 200
  d.hero.y = 560
  return {
    depth: d.riverDepthAt(200, 566),
    onWater: d.isOnWater(200, 566),
    level: d.getLevel(),
  }
})
await page.waitForTimeout(400)
await page.screenshot({ path: 'scripts/out/river-hero.png', clip: { x: 0, y: 180, width: 700, height: 500 } })
console.log('river check:', JSON.stringify(check))
console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
