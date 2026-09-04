// 闪电/火焰验证：node scripts/forest-fire.mjs
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

// 劈在草地上（左下空地）
await page.evaluate(() => window.__forestDemo.strikeLightning(640, 760))
await page.waitForTimeout(120)
await page.screenshot({ path: 'scripts/out/fire-1-bolt.png' })
await page.waitForTimeout(1600)
await page.screenshot({ path: 'scripts/out/fire-2-burn.png' })

// 劈进水塘（应是大波纹+水汽，不起火）
await page.evaluate(() => window.__forestDemo.strikeLightning(1290, 430))
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/fire-3-pondhit.png' })

// 火焰衰减尾声
await page.waitForTimeout(5200)
await page.screenshot({ path: 'scripts/out/fire-4-dying.png' })

console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
