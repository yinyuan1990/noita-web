/**
 * 第二章快进验证：?auto=1&ch=2
 * - 收集控制台报错
 * - 轮询演出进度（controls.enabled 变 true 即演出结束）
 * - 战斗中途抽样敌我坐标，检查敌人是否混进主角队伍区
 */
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !/Texture Error/.test(m.text())) errors.push(`console: ${m.text()}`)
})

await page.goto('http://localhost:5177/chapter1.html?auto=1&ch=2', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__chapter1?.hero, null, { timeout: 20000 })

const t0 = Date.now()
let done = false
const samples = []
while (Date.now() - t0 < 80000) {
  const st = await page.evaluate(() => {
    const c = window.__chapter1
    const pos = (id) => {
      const n = c.npcs?.get?.(id)
      return n ? { x: Math.round(n.actor.x), y: Math.round(n.actor.y) } : null
    }
    return {
      free: !!c.controls?.enabled,
      hero: { x: Math.round(c.hero.x), y: Math.round(c.hero.y) },
      motiya: pos('motiya'),
      hellsnake: pos('hellsnake'),
      jakaluo: pos('jakaluo'),
      lansika: pos('lansika'),
      zhencha: pos('zhencha'),
    }
  })
  samples.push({ t: Math.round((Date.now() - t0) / 1000), ...st })
  if (st.free) {
    done = true
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}

console.log('演出结束(自由探索开启):', done)
console.log('报错数:', errors.length)
for (const e of errors.slice(0, 8)) console.log(' -', e)
console.log('坐标抽样(每2s):')
for (const s of samples) {
  console.log(
    `t=${s.t}s hero=(${s.hero.x},${s.hero.y})` +
      ` motiya=${s.motiya ? `(${s.motiya.x},${s.motiya.y})` : '-'}` +
      ` snake=${s.hellsnake ? `(${s.hellsnake.x},${s.hellsnake.y})` : '-'}` +
      ` jaka=${s.jakaluo ? `(${s.jakaluo.x},${s.jakaluo.y})` : '-'}` +
      ` lans=${s.lansika ? `(${s.lansika.x},${s.lansika.y})` : '-'}` +
      ` zhencha=${s.zhencha ? `(${s.zhencha.x},${s.zhencha.y})` : '-'}`
  )
}
await browser.close()
process.exit(done && errors.length === 0 ? 0 : 1)
