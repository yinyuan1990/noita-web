// 一次性验证脚本：打开 cocos-fx-demo 逐个触发特效并截图
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../.tmp-shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/cocos-fx-demo.html', { waitUntil: 'networkidle' })
await page.uncheck('#auto')
await page.waitForTimeout(1500)

const targets = ['bigBang', 'groundExplode', 'canBlast', 'areaBang', 'armExplode', 'burstFlare']
for (const name of targets) {
  await page.click(`text="${name}"`)
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}${name}.png` })
  await page.waitForTimeout(1400)
}

console.log('shots saved to', OUT)
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
