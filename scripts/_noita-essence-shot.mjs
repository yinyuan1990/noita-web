// 探针:精华 / 贪婪诅咒 / 书 —— 出生点给玩家挂上五种精华 + 诅咒,跑 8s 看有没有报错、弹丸数、诅咒转换;再读一本书截图
// 用法:node scripts/_noita-essence-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1&god=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.evaluate(() => { const np = window.__np; np.player.essences = { laser: true, water: true, air: true, fire: true, alcohol: true }; np.player.curse = { depth: -10, t: 1, pend: [] } })
await page.waitForTimeout(8000)
const info = await page.evaluate(() => { const np = window.__np; return { proj: np.projectiles.list.map((p) => p.name).reduce((a, n) => ((a[n] = (a[n] || 0) + 1), a), {}), curse: np.player.curse && { t: np.player.curse.t | 0, pend: np.player.curse.pend.length }, hp: np.player.hp, pos: [np.player.x | 0, np.player.y | 0] } })
console.log(JSON.stringify(info))
await page.screenshot({ path: `${out}/essence-0.png` })
// 书:放一块 book_02 在脚边,走过去读
await page.evaluate(() => { const np = window.__np; np.player.curse = null; np.player.essences = {}; np.entities.hooks.pickup({ name: 'book_02', d: np.entities.defs.book_02, isItem: true, x: np.player.x, y: np.player.y, dead: true }) })
await page.waitForTimeout(800)
const book = await page.evaluate(() => ({ shown: document.getElementById('book').classList.contains('on'), title: document.querySelector('#book b').textContent, text: document.querySelector('#book span').textContent.slice(0, 60) }))
console.log(JSON.stringify(book))
await page.screenshot({ path: `${out}/essence-book.png` })
if (errors.length) console.log('ERRORS', [...new Set(errors)].slice(0, 8))
await browser.close()
