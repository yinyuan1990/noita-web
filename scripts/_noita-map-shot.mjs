// 临时探针:无头打开 noita-map.html,收集报错,切模式截图,输出 diff 统计(用完可删)
import { chromium } from 'playwright'
const mode = process.argv[2] || 'gen'
const cam = (process.argv[3] || '400,700,1.0').split(',').map(Number)
const out = process.argv[4] || `C:/Users/admin/AppData/Local/Temp/noita-map-${mode}.png`
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text()) })
await page.goto('http://localhost:5177/noita-map.html')
await page.waitForFunction(() => document.getElementById('hud')?.textContent.includes('seed'), null, { timeout: 20000 })
await page.evaluate(([x, y, z]) => { const c = window.__nm.cam; c.x = x; c.y = y; c.z = z; window.dispatchEvent(new Event('resize')) }, cam)
if (process.env.NOBOX) await page.click('#optScenes') // 去掉布景框+名字,看干净画面
const btn = { gen: 'mGen', wang: 'mWang', truth: 'mTruth', split: 'mSplit', diff: 'mDiff' }[mode]
await page.click('#' + btn)
// 等区块生成完
await page.waitForFunction(() => { const t = document.getElementById('hud').textContent; const m = /区块 (\d+)\/(\d+)/.exec(t); return m && m[1] === m[2] && !t.includes('生成中') }, null, { timeout: 120000, polling: 300 })
await page.waitForTimeout(800)
console.log('HUD', await page.evaluate(() => document.getElementById('hud').textContent))
console.log('STAT', await page.evaluate(() => document.getElementById('stat').innerText.replace(/\n/g, ' | ')))
await page.screenshot({ path: out })
console.log('shot', out)
await browser.close()
