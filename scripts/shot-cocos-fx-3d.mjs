// 一次性验证脚本：打开 cocos-fx-3d-demo 逐个触发特效并截图（顺带回归 2D 页）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../.tmp-shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/cocos-fx-3d-demo.html', { waitUntil: 'networkidle' })
await page.uncheck('#auto')
await page.waitForTimeout(2000)

const targets = ['bigBang', 'groundExplode', 'canBlast', 'areaBang', 'sparkFlare', 'burstFlare']
for (const name of targets) {
  await page.click(`text="${name}"`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}3d-${name}.png` })
  await page.waitForTimeout(1800)
}

// 2D 页回归（共享解析层重构后确认未破坏）
await page.goto('http://localhost:5177/cocos-fx-demo.html', { waitUntil: 'networkidle' })
await page.uncheck('#auto')
await page.click('text="bigBang"')
await page.waitForTimeout(450)
await page.screenshot({ path: `${OUT}2d-regression-bigBang.png` })

console.log('shots saved to', OUT)
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
