/** 第二章快进 + 定时连拍，检查技能特效观感 */
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5177/chapter1.html?auto=1&ch=2', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__chapter1?.hero, null, { timeout: 20000 })

const t0 = Date.now()
let i = 0
while (Date.now() - t0 < 34000) {
  const free = await page.evaluate(() => !!window.__chapter1.controls?.enabled)
  if (free) break
  const t = Date.now() - t0
  if (t > 8000) {
    await page.screenshot({ path: `scripts/shots/ch2_${String(i++).padStart(2, '0')}_${Math.round(t / 100)}.png` })
  }
  await new Promise((r) => setTimeout(r, 1200))
}
console.log('shots:', i)
await browser.close()
