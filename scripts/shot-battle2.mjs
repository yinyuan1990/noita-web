// 一次性验证脚本：炮艇驾驶 + 击杀结算
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/world-3d-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 传送到炮艇旁（岸边）并上船
await page.evaluate(() => {
  const boat = window.__battle._debug.boat
  const p = boat.group.position
  window.__player.group.position.set(p.x + 4, 0.3, p.z)
})
await page.keyboard.press('KeyE')
await page.waitForTimeout(300)
await page.keyboard.down('KeyW')
await page.waitForTimeout(2200)
await page.keyboard.up('KeyW')
await page.keyboard.press('Space')
await page.waitForTimeout(500)
await page.screenshot({ path: '.tmp-shots/b7-boat-fire.png' })
await page.waitForTimeout(1200)
await page.screenshot({ path: '.tmp-shots/b8-boat-impact.png' })

// 击杀结算：对一个修仙者投放大伤害
const killInfo = await page.evaluate(() => {
  const b = window.__battle
  const c = b._debug.cultivators.find((x) => x.alive)
  b.explode(c.getPos().clone(), 'jun', 500, 4, 'cartoonExplode')
  return { name: c.name, alive: c.alive, kills: b.state.kills, boatMode: b.mode }
})
console.log('KILL', JSON.stringify(killInfo))
await page.waitForTimeout(600)
await page.screenshot({ path: '.tmp-shots/b9-kill.png' })

console.log(errors.length ? errors.join('\n') : 'no page errors')
await browser.close()
