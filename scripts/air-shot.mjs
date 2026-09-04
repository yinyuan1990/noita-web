// 空战 demo 截图验证：node scripts/air-shot.mjs [outPrefix]
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'air'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`[${r.status()}] ${r.url()}`)
})

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: `scripts/out/${prefix}-1-map.png` })

// 武器 1：机炮扫射
await page.keyboard.down(' ')
await page.waitForTimeout(1600)
await page.screenshot({ path: `scripts/out/${prefix}-2-vulcan.png` })

// 武器 2：导弹
await page.keyboard.press('2')
await page.waitForTimeout(1200)
await page.screenshot({ path: `scripts/out/${prefix}-3-missile.png` })

// 武器 3：集束炸弹（0.85s 后起爆，多抓一张）
await page.keyboard.press('3')
await page.waitForTimeout(1000)
await page.screenshot({ path: `scripts/out/${prefix}-4-bomb-air.png` })
await page.waitForTimeout(350)
await page.screenshot({ path: `scripts/out/${prefix}-5-bomb-boom.png` })

// 武器 4：电浆
await page.keyboard.press('4')
await page.waitForTimeout(900)
await page.screenshot({ path: `scripts/out/${prefix}-6-tesla.png` })
await page.keyboard.up(' ')

// 再飞一会儿，等空战混起来
await page.keyboard.down('a')
await page.waitForTimeout(1200)
await page.keyboard.up('a')
await page.keyboard.down(' ')
await page.waitForTimeout(2500)
await page.screenshot({ path: `scripts/out/${prefix}-7-dogfight.png` })
await page.keyboard.up(' ')

console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
