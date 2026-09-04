// 临时探针:玩法闭环 UI —— 目标指引 / 新手引导 / 背包只读 / 踢 / 暂停 / 底栏物品格 / 手机动作键布局
// 用法:node scripts/_noita-ui-shot.mjs [pc|touch|all] [url]
import { chromium, devices } from 'playwright'
const mode = process.argv[2] || 'all'
const url = (process.argv[3] || 'http://localhost:5177/noita-play.html?log=0') + '&tut=1&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })

async function boot(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
  await page.goto(url)
  await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  return page
}
const tp = (page, x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [x, y])
const txt = (page, id) => page.evaluate((id) => document.getElementById(id).textContent, id)

if (mode === 'pc' || mode === 'all') {
  const ctx = await browser.newContext({ viewport: { width: 854, height: 480 } })
  const page = await boot(ctx)
  console.log('tip(start tut):', await txt(page, 'tip'))
  console.log('quest@spawn:', await txt(page, 'quest'))
  console.log('slots:', await page.evaluate(() => [...document.querySelectorAll('#slots .slot')].map((e) => e.className).join(',')))
  await page.screenshot({ path: `${out}/ui-pc-0.png` })
  // 底栏点第二格 → 切到炸弹杖
  await page.click('#slots .slot:nth-child(2)')
  await page.waitForTimeout(200)
  console.log('after click slot2 payload:', await page.evaluate(() => window.__np.payloadIdx()))
  // 背包(只读)
  await page.keyboard.press('i'); await page.waitForTimeout(300)
  console.log('editor open/readonly:', await page.evaluate(() => [document.getElementById('editor').classList.contains('on'), document.getElementById('editor').classList.contains('readonly'), document.getElementById('edTitle').textContent]))
  await page.screenshot({ path: `${out}/ui-pc-bag.png` })
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  console.log('editor closed:', await page.evaluate(() => !document.getElementById('editor').classList.contains('on')))
  // 暂停
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  const y0 = await page.evaluate(() => window.__np.player.y)
  await page.waitForTimeout(700)
  console.log('paused:', await page.evaluate(() => document.getElementById('pause').classList.contains('on')), 'player frozen:', Math.abs(await page.evaluate(() => window.__np.player.y) - y0) < 0.01)
  await page.screenshot({ path: `${out}/ui-pc-pause.png` })
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  // 踢:面前放一个箱子,右键踢 → 箱子飞
  await page.evaluate(() => { const np = window.__np; np.player.face = 1; np.player.aimX = np.player.x + 50; np.entities.spawnProp?.('physics_box_harmless', np.player.x + 9, np.player.y - 4) || np.entities.spawnItem('physics_box_harmless', np.player.x + 9, np.player.y - 4, {}) })
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => { const b = window.__np.entities.bodies.filter((b) => !b.dead && !b.isItem).map((b) => ({ n: b.name, x: b.x | 0, vx: b.vx | 0 })); return b })
  await page.mouse.move(600, 240); await page.mouse.click(600, 240, { button: 'right' })
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => window.__np.entities.bodies.filter((b) => !b.dead && !b.isItem).map((b) => ({ n: b.name, x: b.x | 0, vx: b.vx | 0 })))
  console.log('kick bodies before:', JSON.stringify(before), 'after:', JSON.stringify(after))
  // 踢怪:出生点放一只 zombie
  await page.evaluate(() => { const np = window.__np; const e = np.entities.spawnCreature('zombie', np.player.x + 10, np.player.y); window.__z = e })
  await page.waitForTimeout(200)
  const hp0 = await page.evaluate(() => window.__z?.hp)
  await page.keyboard.press('x'); await page.waitForTimeout(600); await page.keyboard.press('x'); await page.waitForTimeout(300)
  console.log('kick zombie hp:', hp0, '->', await page.evaluate(() => window.__z?.hp), 'vx', await page.evaluate(() => window.__z?.vx | 0))
  // 圣山:目标指引切到出口 + 圣山引导
  await tp(page, -160, 1380); await page.waitForTimeout(5000) // 商店区地面(别传到出口走廊,会触发崩塌)
  console.log('quest@temple:', await txt(page, 'quest'), '| tip:', await txt(page, 'tip'))
  console.log('quest target:', await page.evaluate(() => window.__np.quest?.()))
  await page.keyboard.press('i'); await page.waitForTimeout(300)
  console.log('editor in temple readonly?', await page.evaluate(() => document.getElementById('editor').classList.contains('readonly')), await txt(page, 'edTitle'))
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${out}/ui-pc-temple.png` })
  // 圣山下方:指向下一座
  await tp(page, 200, 1700); await page.waitForTimeout(3000)
  console.log('quest@below:', await txt(page, 'quest'))
  await ctx.close()
}
if (mode === 'touch' || mode === 'all') {
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 851, height: 393 }, isMobile: true, hasTouch: true })
  const page = await boot(ctx)
  console.log('touch class:', await page.evaluate(() => document.body.classList.contains('touch')))
  console.log('acts visible:', await page.evaluate(() => getComputedStyle(document.getElementById('acts')).display), 'tip:', await txt(page, 'tip'))
  await page.screenshot({ path: `${out}/ui-touch-0.png` })
  // 按住"跳/飞"1s:应先起跳再悬浮(y 变小,fly 燃料下降)
  const y0 = await page.evaluate(() => window.__np.player.y)
  await page.evaluate(() => { const el = document.getElementById('btnJump'); const r = el.getBoundingClientRect(); const t = new Touch({ identifier: 9, target: el, clientX: r.x + 20, clientY: r.y + 20 }); el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true })) })
  await page.waitForTimeout(900)
  const mid = await page.evaluate(() => ({ y: window.__np.player.y | 0, fly: +window.__np.player.fly.toFixed(2), thrust: window.__np.player.thrusting }))
  await page.evaluate(() => { const el = document.getElementById('btnJump'); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true })) })
  console.log('jump hold: y', y0 | 0, '->', mid, 'held cleared:', await page.evaluate(() => !document.getElementById('btnJump').classList.contains('held')))
  // 摇杆不应被动作键触发:按钮区 touchstart 不生成 joy/aim
  console.log('no aim from button:', await page.evaluate(() => !window.__np.touchState().aim))
  // 踢按钮
  await page.waitForTimeout(2000) // 落地
  await page.evaluate(() => { const np = window.__np; np.player.face = 1; window.__box = np.entities.spawnProp('physics_box_harmless', np.player.x + 9, np.player.y - 4) })
  await page.waitForTimeout(300)
  console.log('box vs player:', await page.evaluate(() => ({ p: [window.__np.player.x | 0, window.__np.player.y | 0, window.__np.player.face], b: window.__box ? [window.__box.x | 0, window.__box.y | 0] : null })))
  await page.evaluate(() => { const el = document.getElementById('btnKick'); const r = el.getBoundingClientRect(); const t = new Touch({ identifier: 8, target: el, clientX: r.x + 10, clientY: r.y + 10 }); el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true })); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true })) })
  await page.waitForTimeout(250)
  console.log('touch kick body vx:', await page.evaluate(() => window.__np.entities.bodies.filter((b) => !b.dead && !b.isItem).map((b) => b.vx | 0)))
  // 背包按钮
  await page.evaluate(() => { const el = document.getElementById('btnBag'); const t = new Touch({ identifier: 7, target: el, clientX: 10, clientY: 10 }); el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true })); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true })) })
  await page.waitForTimeout(300)
  console.log('bag open:', await page.evaluate(() => document.getElementById('editor').classList.contains('on')))
  await page.screenshot({ path: `${out}/ui-touch-bag.png` })
  await page.tap('#edClose')
  // 暂停按钮
  await page.tap('#btnPause'); await page.waitForTimeout(300)
  console.log('touch paused:', await page.evaluate(() => document.getElementById('pause').classList.contains('on')))
  await page.screenshot({ path: `${out}/ui-touch-pause.png` })
  await page.tap('#btnResume'); await page.waitForTimeout(200)
  console.log('resumed:', await page.evaluate(() => !document.getElementById('pause').classList.contains('on')))
  // 底栏点格子切杖
  await page.tap('#slots .slot:nth-child(2)'); await page.waitForTimeout(200)
  console.log('touch slot2 payload:', await page.evaluate(() => window.__np.payloadIdx()))
  await ctx.close()
}
await browser.close()
