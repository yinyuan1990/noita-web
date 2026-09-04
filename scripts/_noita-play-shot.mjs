// 临时探针:横屏手机视口打开 noita-play,走几步 → 打洞 → 倒油 → 点火 → 倒水,截图 + 统计模拟
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
console.log('落地', await page.evaluate(() => ({ x: window.__np.player.x | 0, y: window.__np.player.y | 0, g: window.__np.player.onGround })))
const shoot = async (key, x, y, ms) => { await page.keyboard.press(key); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up() }
await page.keyboard.down('d'); await page.waitForTimeout(1200); await page.keyboard.up('d')
await shoot('1', 700, 300, 900)   // 动能打洞(往右下地面)
await page.waitForTimeout(300)
await shoot('3', 620, 330, 700)   // 油倒进坑
await page.waitForTimeout(600)
const count = (name) => page.evaluate((n) => { const s = window.__np.sim; const id = window.__np.mats.byName.get(n); let c = 0; for (let y = s.wy0; y <= s.wy1; y++) for (let x = s.wx0; x <= s.wx1; x++) if (s.get(x, y) === id) c++; return c }, name)
console.log('油格', await count('oil'), '水格', await count('water'))
await shoot('4', 620, 330, 250)   // 点火
await page.waitForTimeout(1500)
console.log('点火 1.5s 后 油格', await count('oil'), '火格', await count('fire'), '烟格', await count('smoke'))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/noita-play-fire.png' })
await shoot('2', 620, 300, 900)   // 倒水灭火
await page.waitForTimeout(1500)
console.log('倒水后 火格', await count('fire'), '水格', await count('water'), '蒸汽', await count('steam'))
console.log(await page.evaluate(() => document.getElementById('panel').textContent.replace(/\n/g, ' | ')))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/noita-play.png' })
await browser.close()
