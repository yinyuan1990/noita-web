// 氮气冲刺 + 10 级弹幕验证：node scripts/air-nitro.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// 双击 W 触发氮气
await page.keyboard.press('w')
await page.waitForTimeout(80)
await page.keyboard.down('w')
await page.waitForTimeout(250)
await page.screenshot({ path: 'scripts/out/nitro-1-boost.png' })
await page.waitForTimeout(300)
await page.screenshot({ path: 'scripts/out/nitro-2-boost-tail.png' })
await page.keyboard.up('w')
const boostState = await page.evaluate(() => {
  const p = window.__air.player
  return { speed: Math.round(Math.hypot(p.vx, p.vy)), nitroCd: +p.nitroCd.toFixed(2) }
})

// 机炮 Lv10 弹幕
await page.evaluate(() => (window.__air.weaponLv[0] = 10))
await page.keyboard.down(' ')
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/out/nitro-3-vulcan10.png' })

// 电浆 Lv10 六球紫电
await page.evaluate(() => (window.__air.weaponLv[3] = 10))
await page.keyboard.press('4')
await page.waitForTimeout(600)
await page.screenshot({ path: 'scripts/out/nitro-4-tesla10.png' })

// 导弹 Lv10 六连金色
await page.evaluate(() => (window.__air.weaponLv[1] = 10))
await page.keyboard.press('2')
await page.waitForTimeout(600)
await page.screenshot({ path: 'scripts/out/nitro-5-missile10.png' })

// 炸弹 Lv10 五连地毯
await page.evaluate(() => (window.__air.weaponLv[2] = 10))
await page.keyboard.press('3')
await page.waitForTimeout(1400)
await page.screenshot({ path: 'scripts/out/nitro-6-bomb10.png' })
await page.keyboard.up(' ')

const fps = await page.evaluate(() => document.getElementById('fps').textContent)
console.log('boost state:', JSON.stringify(boostState), 'fps:', fps)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
