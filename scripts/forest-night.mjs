// 夜空倒影验证：node scripts/forest-night.mjs
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

// 涨满河水，停雨让云散开（星星/极光更清楚）
await page.evaluate(() => window.__forestDemo.setLevel(0.9))
await page.keyboard.press('r')
await page.waitForTimeout(6000)
await page.screenshot({ path: 'scripts/out/night-full.png' })
// 水塘特写：看夜空倒影细节
await page.screenshot({ path: 'scripts/out/night-pond.png', clip: { x: 780, y: 150, width: 780, height: 460 } })
// 河面特写
await page.screenshot({ path: 'scripts/out/night-river.png', clip: { x: 0, y: 250, width: 560, height: 500 } })

console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
