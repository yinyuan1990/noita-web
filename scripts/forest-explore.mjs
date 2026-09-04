// 无限地图 + 相机跟随 + 冲刺验证：node scripts/forest-explore.mjs
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
const before = await page.evaluate(() => ({
  chunks: window.__forestDemo.getChunkCount(),
  props: window.__forestDemo.getPropCount(),
  hero: { x: window.__forestDemo.hero.x, y: window.__forestDemo.hero.y },
}))
await page.screenshot({ path: 'scripts/out/explore-0-start.png' })

// 双击 d 触发冲刺，然后按住向右狂奔 6 秒
await page.keyboard.press('d')
await page.waitForTimeout(80)
await page.keyboard.down('d')
await page.waitForTimeout(600)
const sprint = await page.evaluate(() => window.__forestDemo.isSprinting())
await page.waitForTimeout(5400)
await page.keyboard.up('d')
await page.waitForTimeout(600)
const after = await page.evaluate(() => ({
  chunks: window.__forestDemo.getChunkCount(),
  props: window.__forestDemo.getPropCount(),
  hero: { x: Math.round(window.__forestDemo.hero.x), y: Math.round(window.__forestDemo.hero.y) },
  sprintNow: window.__forestDemo.isSprinting(),
}))
await page.screenshot({ path: 'scripts/out/explore-1-far.png' })

// 再往下走一段
await page.keyboard.down('s')
await page.waitForTimeout(4000)
await page.keyboard.up('s')
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/explore-2-south.png' })
const final = await page.evaluate(() => ({
  chunks: window.__forestDemo.getChunkCount(),
  hero: { x: Math.round(window.__forestDemo.hero.x), y: Math.round(window.__forestDemo.hero.y) },
}))

console.log('before:', JSON.stringify(before))
console.log('sprint active:', sprint)
console.log('after run:', JSON.stringify(after))
console.log('final:', JSON.stringify(final))
console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
