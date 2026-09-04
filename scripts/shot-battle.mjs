// 一次性验证脚本：混战世界（载具驾驶/开炮/修仙者 AI）
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
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(`[console] ${m.text()}`)
})

await page.goto('http://localhost:5177/world-3d-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: `${OUT}b1-spawn.png` })

// 传送到坦克旁并上车
await page.evaluate(() => {
  const t = window.__battle._debug.tank
  const p = t.group.position
  window.__player.group.position.set(p.x + 3, p.y, p.z)
})
await page.keyboard.press('KeyE')
await page.waitForTimeout(300)
// 驾驶前进
await page.keyboard.down('KeyW')
await page.waitForTimeout(1600)
await page.keyboard.up('KeyW')
// 开炮
await page.keyboard.press('Space')
await page.waitForTimeout(650)
await page.screenshot({ path: `${OUT}b2-tank-fire.png` })
await page.waitForTimeout(1400)
await page.screenshot({ path: `${OUT}b3-tank-impact.png` })

// 下车 → 传送到战机旁 → 起飞
await page.keyboard.press('KeyE')
await page.waitForTimeout(200)
await page.evaluate(() => {
  const t = window.__battle._debug.plane
  const p = t.group.position
  window.__player.group.position.set(p.x + 3, p.y, p.z)
})
await page.keyboard.press('KeyE')
await page.waitForTimeout(200)
await page.keyboard.down('KeyW')
await page.waitForTimeout(3500)
await page.keyboard.press('Space')
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}b4-plane-air.png` })
await page.keyboard.up('KeyW')

// 观察修仙者 AI（等他们接近/放技能）
await page.waitForTimeout(5000)
await page.screenshot({ path: `${OUT}b5-battle.png` })

// 传送炮艇视角
await page.evaluate(() => {
  // 强制降落再下机：直接改状态传送到船旁
  const b = window.__battle
  const boat = b._debug.boat
  const pl = window.__player.group.position
  pl.set(boat.group.position.x + 4, 0.2, boat.group.position.z)
})
await page.waitForTimeout(300)
const state = await page.evaluate(() => {
  const b = window.__battle
  return {
    mode: b.mode,
    kills: b.state.kills,
    hp: b.state.playerHp,
    cultivatorsAlive: b._debug.cultivators.filter((c) => c.alive).length,
    tankHp: b._debug.tank.hp,
    planeAirborne: b._debug.plane.airborne,
  }
})
console.log('STATE', JSON.stringify(state))
await page.screenshot({ path: `${OUT}b6-final.png` })

console.log('shots saved to', OUT)
console.log(errors.length ? errors.join('\n') : 'no page errors')
await browser.close()
