// 雨天 demo 截图验证：node scripts/rain-shot.mjs [outPrefix]
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'rain'
const url = 'http://localhost:5177/rain-demo.html'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: `scripts/out/${prefix}-1-idle.png` })

// 找一个水坑点，命令主角走过去
const pud = await page.evaluate(() => {
  const d = window.__rainDemo
  if (!d) return null
  const { weather } = d
  let best = null
  for (let y = 250; y < 620; y += 8) {
    for (let x = 500; x < 1420; x += 8) {
      const v = weather.puddleValueAt(x, y)
      if (!best || v > best.v) best = { x, y, v }
    }
  }
  return best
})
console.log('deepest puddle:', JSON.stringify(pud))

if (pud) {
  await page.evaluate(({ x, y }) => {
    const d = window.__rainDemo
    d.target.x = x
    d.target.y = y
    d.target.active = true
  }, pud)
  await page.waitForTimeout(3400)
  await page.screenshot({ path: `scripts/out/${prefix}-2-walk.png` })
  // 在水里来回走，抓踩水波纹
  await page.evaluate(({ x, y }) => {
    const d = window.__rainDemo
    d.target.x = x - 140
    d.target.y = y + 20
    d.target.active = true
  }, pud)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `scripts/out/${prefix}-3-splash.png` })
}

const onWater = await page.evaluate(() => {
  const d = window.__rainDemo
  return d ? d.weather.isOnPuddle(d.hero.x, d.hero.y) : null
})
console.log('hero on water:', onWater)
console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
