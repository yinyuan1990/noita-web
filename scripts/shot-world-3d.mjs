// 一次性验证脚本：3D 世界页（地形/角色/移动/技能）+ bigBang 修复后的粒子页
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

// --- bigBang 修复验证 ---
await page.goto('http://localhost:5177/cocos-fx-3d-demo.html', { waitUntil: 'networkidle' })
await page.uncheck('#auto')
await page.waitForTimeout(1500)
await page.click('text="bigBang"')
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}fix-bigBang-a.png` })
await page.waitForTimeout(350)
await page.screenshot({ path: `${OUT}fix-bigBang-b.png` })

// --- 3D 世界页 ---
await page.goto('http://localhost:5177/world-3d-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3200)
await page.screenshot({ path: `${OUT}world-spawn.png` })

// 前进 + 奔跑
await page.keyboard.down('Shift')
await page.keyboard.down('KeyW')
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}world-running.png` })
await page.keyboard.up('KeyW')
await page.keyboard.up('Shift')
await page.waitForTimeout(400)

// F 释放技能
await page.keyboard.press('KeyF')
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}world-skill1.png` })
await page.waitForTimeout(1600)
await page.keyboard.press('KeyF')
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}world-skill2.png` })

// 重新生成地形
await page.click('#regen')
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}world-regen.png` })

console.log('shots saved to', OUT)
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
