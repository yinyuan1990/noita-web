/** 用真实菜单点击流程验证技能音效链路：ctx 状态 + play 调用记录 */
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5177/chapter1.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__chapter1?.sfx, null, { timeout: 20000 })

// 打点：记录 sfx.play / _synth 调用
await page.evaluate(() => {
  const sfx = window.__chapter1.sfx
  window.__sfxLog = []
  const origPlay = sfx.play.bind(sfx)
  sfx.play = (el, opts) => {
    window.__sfxLog.push({ t: Date.now(), el, ctx: sfx._ctx?.state || 'none' })
    return origPlay(el, opts)
  }
  const origSynth = sfx._synth.bind(sfx)
  sfx._synth = (key, opts) => {
    window.__sfxLog.push({ t: Date.now(), synth: key, ctx: sfx._ctx?.state || 'none' })
    return origSynth(key, opts)
  }
  window.__chapter1.vn.instant = true
})

// 真实点击：进入游戏 → 第二章
await page.click('#btn-enter')
await page.waitForTimeout(400)
await page.click('#btn-ch2')

const t0 = Date.now()
while (Date.now() - t0 < 70000) {
  const free = await page.evaluate(() => !!window.__chapter1.controls?.enabled)
  if (free) break
  await page.waitForTimeout(1500)
}

const out = await page.evaluate(() => ({
  log: window.__sfxLog,
  ctxState: window.__chapter1.sfx._ctx?.state || 'none',
}))
console.log('最终 ctx 状态:', out.ctxState)
console.log('play/synth 调用数:', out.log.length)
for (const e of out.log.slice(0, 40)) console.log(JSON.stringify(e))
await browser.close()
