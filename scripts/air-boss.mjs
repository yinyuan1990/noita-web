// M5 关卡 + Boss 验证：node scripts/air-boss.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2400)

// 1. 关卡 HUD 初始状态
const init = await page.evaluate(() => ({
  level: window.__air.getLevel(),
  wave: document.getElementById('wave').textContent,
}))
console.log(`init: level=${init.level} waveHud="${init.wave}"`)

// P 键一键毕业，保证输出火力（顺便让画面华丽点）
await page.keyboard.press('p')
await page.waitForTimeout(1200)

/** 召唤指定 Boss → 观战截图 → 灌伤害击杀 → 等死亡演出与关卡推进 */
async function bossRound(lv, tag, watchMs = 3200) {
  await page.evaluate((l) => {
    // 清场，避免上一轮残兵干扰观察
    for (const e of window.__air.enemies.slice()) e.hp = -999
    window.__air.spawnBoss(l)
  }, lv)
  await page.waitForTimeout(watchMs)
  const mid = await page.evaluate(() => {
    const b = window.__air.getBoss()
    return b && {
      name: b.def.name, phase: b.phase, parts: b.parts.filter((p) => !p.dead).length,
      barShown: document.getElementById('bossbar').style.display,
      waveHud: document.getElementById('wave').textContent,
    }
  })
  await page.screenshot({ path: `scripts/out/boss-${tag}-fight.png` })
  console.log(`boss${lv}:`, JSON.stringify(mid))

  // 拆部件 → 破本体（走正规 bossDamage 通路，会依次触发阶段转换）
  await page.evaluate(() => {
    const b = window.__air.getBoss()
    if (!b) return
    b.untouchable = false
    for (const p of b.parts) if (!p.dead) window.__air.bossDamage(999, 0, p)
    for (let i = 0; i < 60 && window.__air.getBoss() && !window.__air.getBoss().dying; i++) {
      window.__air.bossDamage(30, 0, null)
    }
  })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `scripts/out/boss-${tag}-death.png` })
  await page.waitForTimeout(2200)
  const after = await page.evaluate(() => ({
    boss: !!window.__air.getBoss(),
    level: window.__air.getLevel(),
    barShown: document.getElementById('bossbar').style.display,
    scene: window.__air.SCENES && document.getElementById('wave').textContent,
  }))
  console.log(`  after kill: boss=${after.boss} level=${after.level} bar="${after.barShown}" waveHud="${after.scene}"`)
}

// 2. 第 1 关 Boss：绿荫堡垒（悬停 + 部件炮塔）；击杀后应推进到第 2 关（沙漠）
await bossRound(1, '1-fortress')
// 3. 沙蝎（钻地循环）、炎狱之眼（双螺旋+榴弹雨）、雷霆列车（八字轨道+轨道炮预警线）、末日方舟（小核弹红圈）
await bossRound(2, '2-scorpion', 4200)
await bossRound(5, '5-flame', 3600)
await bossRound(8, '8-train', 3800)
await bossRound(10, '10-ark', 5200)

const fps = await page.evaluate(() => document.getElementById('fps').textContent)
console.log('fps:', fps)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
