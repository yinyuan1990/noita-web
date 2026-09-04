// 气功波冒烟测试：node scripts/forest-ki.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/forest-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// 蓄力：满蓄后截图（光球应该很大）
const charging = await page.evaluate(() => {
  const d = window.__forestDemo
  d.ki.start()
  d.ki.setCharge(1.2)
  return d.ki.isCharging()
})
console.log('charging:', charging)
await page.waitForTimeout(400)
await page.screenshot({ path: 'scripts/out/ki-1-charge.png' })

// 半蓄力发射光束（射程短，头点落在屏幕内），hold 阶段截图
const fired = await page.evaluate(() => {
  const d = window.__forestDemo
  d.ki.setCharge(0.2) // 小蓄力 → 射程 ~750px，爆点/弹坑落在画面内
  d.ki.release()
  return { charging: d.ki.isCharging(), beams: d.ki.count() }
})
console.log('fired:', JSON.stringify(fired))
await page.waitForTimeout(250)
await page.screenshot({ path: 'scripts/out/ki-2-beam.png' })
const holding = await page.evaluate(() => ({
  beams: window.__forestDemo.ki.count(),
  fx: window.__forestDemo.getFxNow(),
  zoom: window.__forestDemo.cam ? window.__forestDemo.cam.zoom : null,
  camOn: window.__forestDemo.ki.isCamOn(),
}))
console.log('holding (zoom should be >1):', JSON.stringify(holding))

// 等收束结束 + 爆点起火
await page.waitForTimeout(1200)
await page.screenshot({ path: 'scripts/out/ki-3-after.png' })
const after = await page.evaluate(() => ({
  beams: window.__forestDemo.ki.count(),
}))
console.log('after (beams should be 0):', JSON.stringify(after))

console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
