// 临时探针:出生地放一�?lukki(可�?lukki_longleg / lukki_tiny / eggs),看腿踩地 / 追人 / 攻击腿刺�?/ 挖洞;截几张图
// 用法:node scripts/_noita-lukki-shot.mjs [lukki|longleg|tiny|eggs] [url]
import { chromium } from 'playwright'
const kind = process.argv[2] || 'lukki'
const url = process.argv[3] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
let name = kind === 'longleg' ? 'lukki_lukki_longleg' : kind === 'tiny' ? 'lukki_lukki_tiny' : kind === 'eggs' ? 'lukki_eggs' : 'lukki_lukki'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
if (kind === 'jungle') {
  // 真实丛林:传送过�?找到第一�?lukki 站到它旁边看
  await page.evaluate(() => { const np = window.__np; np.player.x = 0; np.player.y = 6900; np.player.vx = 0; np.player.vy = 0; np.cam.x = 0; np.cam.y = 6900; np.player.hp = 4 })
  await page.waitForTimeout(6000)
  const found = await page.evaluate(() => { const E = window.__np.entities; const e = E.list.find((x) => /^lukki_lukki/.test(x.name)); return e ? { name: e.name, x: e.x, y: e.y } : null })
  console.log('jungle lukki:', found, 'skipped', await page.evaluate(() => JSON.stringify(window.__np.entities.stats.skipped)))
  if (!found) { await browser.close(); process.exit(0) }
  name = found.name
  await page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x - 45; np.player.y = y; np.cam.x = x; np.cam.y = y }, [found.x, found.y])
  await page.waitForTimeout(500)
} else {
  await page.evaluate((name) => {
    const np = window.__np, E = np.entities
    for (const e of E.list) e.dead = true
    np.player.x = 227; np.player.y = -85; np.player.vx = 0; np.player.vy = 0; np.player.hp = 4
    const e = E.spawnCreature(name, 330, -110)
    if (!e) throw new Error('spawn 失败 ' + name)
  }, name)
}
const dump = () => page.evaluate((name) => {
  const np = window.__np, E = np.entities
  const e = E.list.find((x) => x.name === name)
  if (!e) return 'gone; list=' + E.list.map((x) => x.name).join(',')
  const legs = e.legs ? e.legs.map((g) => (g.L.attacker ? `A:${g.phase}` : g.planted ? 'P' : '-')).join(' ') : '-'
  return `${name}@${e.x | 0},${e.y | 0} v=${e.vx | 0},${e.vy | 0} st=${e.state} hp=${e.hp.toFixed(2)} legs=[${legs}] player=${np.player.x | 0},${np.player.y | 0} hp=${np.player.hp.toFixed(2)} ents=${E.list.length}`
}, name)
// 放大截图:以蜘蛛为中心�?140×90 世界像素放大 4 �?
const zoom = async (file) => {
  const data = await page.evaluate((name) => {
    const np = window.__np, E = np.entities
    const e = E.list.find((x) => x.name === name) || { x: np.player.x, y: np.player.y }
    const view = document.querySelector('canvas')
    const S = view.width / 427
    const cx = (e.x - np.cam.x + 427 / 2) * S, cy = (e.y - np.cam.y + 240 / 2) * S
    const w = 140 * S, h = 90 * S
    const cv = document.createElement('canvas'); cv.width = w * 4 / S; cv.height = h * 4 / S
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false
    c.drawImage(view, cx - w / 2, cy - h / 2, w, h, 0, 0, cv.width, cv.height)
    return cv.toDataURL('image/png')
  }, name)
  const fs = await import('fs'); fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
}
for (let i = 0; i < 8; i++) { await page.waitForTimeout(700); console.log(await dump()); if (i === 3) await zoom(`${out}/lukki-${kind}-z0.png`) }
await page.screenshot({ path: `${out}/lukki-${kind}-0.png` })
if (kind === 'eggs') {
  // 打卵:每次 0.5 �?看小蜘蛛出来
  for (let i = 0; i < 6; i++) { await page.evaluate((name) => { const E = window.__np.entities; const e = E.list.find((x) => x.name === name); if (e) E.hurt(e, 0.5, 0, 0, 'proj') }, name); await page.waitForTimeout(300); console.log(await dump()) }
  await page.screenshot({ path: `${out}/lukki-${kind}-1.png` })
} else {
  // 站到它旁�?30px 等攻击腿�?
  await page.evaluate((name) => { const np = window.__np; const e = np.entities.list.find((x) => x.name === name); if (e) { np.player.x = e.x - 28; np.player.y = e.y + 10 } }, name)
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); console.log(await dump()); if (i === 2) await zoom(`${out}/lukki-${kind}-z1.png`) }
  await page.screenshot({ path: `${out}/lukki-${kind}-1.png` })
  // 打它:20 �?0.5 的弹�?projectile ×0.2)�?看掉血 / �?/ �?
  for (let i = 0; i < 20; i++) { await page.evaluate((name) => { const E = window.__np.entities; const e = E.list.find((x) => x.name === name); if (e) E.hurt(e, 0.5, 30, -20, 'proj') }, name); await page.waitForTimeout(120) }
  console.log(await dump())
  // 再用爆炸�?×0.8)打死:看腿变肉�?/ 掉金
  for (let i = 0; i < 8; i++) { await page.evaluate((name) => { const E = window.__np.entities; const e = E.list.find((x) => x.name === name); if (e) E.hurt(e, 2, 30, -40, 'explosion') }, name); await page.waitForTimeout(100) }
  await page.waitForTimeout(1200)
  console.log(await dump(), 'ragdolls=' + (await page.evaluate(() => window.__np.entities.bodies.filter((b) => b.isRagdoll).length)), 'gold=' + (await page.evaluate(() => window.__np.entities.bodies.filter((b) => b.gold).length)), 'killed=' + (await page.evaluate(() => window.__np.entities.stats.killed)))
  await zoom(`${out}/lukki-${kind}-z2.png`)
  await page.screenshot({ path: `${out}/lukki-${kind}-2.png` })
}
await browser.close()
