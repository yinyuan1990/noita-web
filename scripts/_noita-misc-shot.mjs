// ????:???? ��???? / ??�?/ ?????? / �?/ ??�?/ ethereal_being,????????�?
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
// ORIGIN_IP=8.162.5.160 ? ??????(?? CDN / ??),? http:// URL ?
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
console.log(await page.evaluate(() => {
  const np = window.__np, E = np.entities
  for (const e of E.list) e.dead = true
  np.player.x = 227; np.player.y = -85; np.player.vx = 0; np.player.vy = 0; np.player.hp = 4
  const r = []
  r.push('lasergate=' + !!E.spawnCreature('lasergate_down', 190, -140))
  r.push('cloud=' + !!E.spawnCreature('cloud_trap', 300, -130))
  r.push('statue_trap=' + !!E.spawnCreature('statue_trap_right', 330, -88))
  r.push('banner=' + !!E.spawnCreature('banner', 150, -95))
  r.push('ethereal=' + !!E.spawnCreature('ethereal_being', 400, -120))
  r.push('utility_box=' + !!E.spawnItem('utility_box', 260, -95))
  return r.join(' ')
}))
const st = () => page.evaluate(() => {
  const np = window.__np, E = np.entities
  const f = (n) => E.list.find((e) => e.name === n)
  const lg = f('lasergate_down'), ct = f('cloud_trap'), stt = f('statue_trap_right'), sa = f('statue_animal'), eth = f('ethereal_being')
  let clouds = 0; for (let y = -150; y < -110; y++) for (let x = 280; x < 320; x++) { const m = np.matAt(x, y); if (m > 0 && np.mats.list[m]?.name === 'cloud_radioactive') clouds++ }
  return `laser=${lg ? (lg.laserOn ? 'ON len=' + lg.laserLen : 'off') : 'gone'} clouds=${clouds} trap=${stt ? 'waiting' : 'gone'} statue=${sa ? sa.state + '@' + (sa.x | 0) + ',' + (sa.y | 0) : '-'} eth=${eth ? eth.state : '-'} cards=${E.bodies.filter((b) => b.spell && !b.dead).length} box=${E.bodies.filter((b) => b.name === 'utility_box' && !b.dead).length} php=${np.player.hp.toFixed(2)} p=${np.player.x | 0},${np.player.y | 0}`
})
for (let i = 0; i < 4; i++) { await page.waitForTimeout(700); console.log(await st()) }
// ?????�?
await page.evaluate(() => { const np = window.__np; np.player.x = 190; np.player.y = -100 })
for (let i = 0; i < 4; i++) { await page.waitForTimeout(600); console.log(await st()) }
// ??????�?+ ???�?
await page.evaluate(() => { const np = window.__np; np.player.hp = 4; np.player.x = 320; np.player.y = -88 })
await page.waitForTimeout(1200); console.log(await st())
await page.evaluate(() => { const np = window.__np; const b = np.entities.bodies.find((x) => x.name === 'utility_box'); if (b) { np.player.x = b.x; np.player.y = b.y + 1 } })
await page.waitForTimeout(800); console.log(await st())
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/misc-0.png' })
await browser.close()
