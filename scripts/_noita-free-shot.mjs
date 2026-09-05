// 探针:自由模式 —— 法术库全开、随处改法杖、法力 / 次数无限
// 用法:node scripts/_noita-free-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2000)
// 出生地(不在圣山)开背包:应可编辑,法术库有卡
await page.keyboard.press('i')
await page.waitForTimeout(300)
const lib = await page.evaluate(() => ({ canEdit: window.__np.editor.canEdit, title: document.getElementById('edTitle').textContent, libCards: document.querySelectorAll('#edLib .card').length, groups: [...document.querySelectorAll('#edLib .libh')].map((h) => h.textContent), cap: window.__np.player.wands.map((w) => w.deckCapacity) }))
console.log('editor', JSON.stringify(lib))
await page.screenshot({ path: `${out}/free-editor.png` })
// 点法术库里的"熔岩"(MATERIAL_LAVA)装进第 1 根杖,再装一张 FIREBALL
const added = await page.evaluate(() => {
  const np = window.__np, w = np.player.wands[0]
  const before = w.cards.slice()
  np.editor.addLib('MATERIAL_LAVA'); np.editor.addLib('FIREBALL')
  return { before, after: w.cards.slice(), cap: w.deckCapacity }
})
console.log('added', JSON.stringify(added))
// "把子弹放到第 4 根杖":8 根都得是真杖;用真实点击 —— 点第 4 行选中 → 点法术库第一张弹丸 → 第 4 根多一张;底栏第 4 格能切过去开火
const w4 = await page.evaluate(() => {
  const np = window.__np
  const rows = document.querySelectorAll('#edWands .wand')
  rows[3].click()
  const sel = document.querySelector('#edWands .wand.sel'), selIdx = [...rows].indexOf(sel)
  const card = document.querySelector('#edLib .card'); card.click()
  return { wands: np.player.wands.length, names: np.player.wands.map((w) => w.name), selIdx, msg: document.getElementById('edMsg').textContent, w4cards: np.player.wands[3].cards.slice(), statsRows: document.querySelectorAll('#edWands .wstats').length }
})
console.log('wand4', JSON.stringify(w4))
await page.screenshot({ path: `${out}/free-wand4.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const fire4 = await page.evaluate(() => {
  const np = window.__np
  document.querySelectorAll('#slots .slot')[3].click()
  const w = np.player.wands[3]; const out = []; w.cd = 0
  np.wands.cast(w, 0, (n) => out.push(n))
  return { payload: np.payloadIdx(), shot: out }
})
console.log('fire4', JSON.stringify(fire4))
await page.keyboard.press('i'); await page.waitForTimeout(200)
await page.waitForTimeout(200)
// gun.lua 组合规则:每次施放 1 张 → [二重, 火球, 岩浆, 火花弹] 第一下出 火球+岩浆(2 发),第二下出 火花弹(1 发),第三下绕回
const combo = await page.evaluate(() => {
  const np = window.__np, w = np.player.wands[0]
  w.cards = ['BURST_2', 'FIREBALL', 'MATERIAL_LAVA', 'LIGHT_BULLET']; w.actionsPerRound = 1; np.editor.after(w)
  const shot = () => { w.cd = 0; w.reloadT = 0; const out = []; np.wands.cast(w, 0, (n, off, c, pl) => out.push(n + (pl ? '{' + pl.map((p) => p.name).join(',') + '}' : ''))); return out }
  const a = shot(), b = shot(), c = shot()
  // 触发弹:[火花弹·触发, 炸弹] → 1 发 light_bullet_blue 带载荷 bomb;弹死时在原地放出炸弹
  w.cards = ['LIGHT_BULLET_TRIGGER', 'BOMB']; np.editor.after(w)
  const t = shot()
  const P = np.projectiles, before = P.list.length
  w.cd = 0; np.wands.cast(w, 0, (n, off, c, pl) => P.spawn(n, np.player.x, np.player.y - 10, 0, { c, payload: pl }))
  const trig = P.list.find((p) => p.payload); if (trig) P._die(trig, true)
  const spawned = P.list.slice(before).map((p) => p.name)
  // 修饰:[加速, 火花弹] → 1 发,c.speed_multiplier 2.5
  w.cards = ['SPEED', 'LIGHT_BULLET']; np.editor.after(w)
  let sm = 0; w.cd = 0; np.wands.cast(w, 0, (n, off, c) => { sm = c.speed_multiplier })
  return { shot1: a, shot2: b, shot3: c, trigger: t, payloadSpawned: spawned, speedMul: +sm.toFixed(2), slots: np.flags.wandSlots, slotBar: document.querySelectorAll('#slots .slot').length, cap: w.deckCapacity }
})
console.log('combo', JSON.stringify(combo))
// 法杖面板:属性行 + 可调按钮
await page.keyboard.press('i'); await page.waitForTimeout(300)
console.log('panel', await page.evaluate(() => [...document.querySelector('#edWands .wand.sel').querySelectorAll('.stat')].map((s) => s.querySelector('.k').textContent + '=' + s.querySelector('.v').textContent + (s.querySelector('button') ? '[±]' : '')).join(' | ')))
await page.screenshot({ path: `${out}/free-panel.png` })
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
// 连开火 3 秒:法力应一直是满的,次数不减
const fire = await page.evaluate(async () => {
  const np = window.__np, w = np.player.wands[0]
  np.setWand(0); np.player.iframe = 999
  const m0 = w.mana, u0 = JSON.stringify(w.uses)
  const c = document.getElementById('game'), r = c.getBoundingClientRect()
  const ev = (t, x, y) => c.dispatchEvent(new MouseEvent(t, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, bubbles: true }))
  ev('mousemove', r.width * 0.75, r.height * 0.3); ev('mousedown', r.width * 0.75, r.height * 0.3)
  await new Promise((res) => setTimeout(res, 3000))
  ev('mouseup', r.width * 0.75, r.height * 0.3)
  const lava = np.mats.byName.get('lava'); let n = 0
  for (let y = -200; y < 0; y++) for (let x = 150; x < 500; x++) if (np.sim.get(x, y) === lava) n++
  return { manaBefore: m0, manaAfter: w.mana, manaMax: w.manaMax, usesBefore: u0, usesAfter: JSON.stringify(w.uses), lavaCells: n, shots: np.projectiles?.stats?.spawned }
})
console.log('fire', JSON.stringify(fire))
await page.screenshot({ path: `${out}/free-fire.png` })
await browser.close()
