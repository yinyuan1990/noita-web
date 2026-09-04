// 临时探针:塞几瓶药进背包,逐瓶喝一口,看状态 / 数值变化
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
for (const mat of ['magic_liquid_hp_regeneration', 'magic_liquid_movement_faster', 'magic_liquid_berserk', 'acid', 'water']) {
  const r = await page.evaluate(async (mat) => {
    const np = window.__np
    np.player.hp = 2; np.player.items.length = 0
    np.player.items.push({ potion: { mat, left: 1000 }, name: '药水·' + mat })
    np.setWand(np.player.wands.length) // 选中第一个物品格
    await new Promise((r) => setTimeout(r, 100))
    const before = { hp: +np.player.hp.toFixed(2) }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    await new Promise((r) => setTimeout(r, 1200))
    return { mat, before, after: { hp: +np.player.hp.toFixed(2), left: np.player.items[0]?.potion.left, tip: document.getElementById('tip').textContent.slice(0, 40), hud: document.getElementById('hud').textContent.split('\n')[0].slice(0, 120) } }
  }, mat)
  console.log(JSON.stringify(r))
}
await browser.close()
