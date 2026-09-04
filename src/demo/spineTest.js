import * as PIXImod from 'pixi.js'
// pixi-spine 2.x 依赖全局可写的 PIXI，且会往 PIXI.spine 挂类；
// ESM namespace 只读，故用浅拷贝副本挂到 window 再动态 import
const PIXI = { ...PIXImod }
window.PIXI = PIXI
await import('pixi-spine')

const NAMES = ['Alien', 'Bomber', 'Cruiser', 'Cylone', 'DarkEye', 'Bee', 'Phoenix', 'Snake', 'Zombie', 'red_bug', 'Thunder', 'BigBoy', 'God', 'bagonfly']

const app = new PIXI.Application({ width: 1200, height: 800, backgroundColor: 0x0a0f14 })
document.getElementById('stage').appendChild(app.view)

const loader = app.loader
for (const n of NAMES) loader.add(n, `/res/enemies-spine/${n}/${n}.json`)

window.__spineReport = { loaded: [], failed: [] }

loader.onError.add((err, ldr, res) => {
  window.__spineReport.failed.push(`${res?.name}: ${err?.message || err}`)
})

loader.load((ldr, resources) => {
  const cols = 5
  const cellW = 1200 / cols
  const cellH = 800 / Math.ceil(NAMES.length / cols)
  NAMES.forEach((n, i) => {
    try {
      const data = resources[n]?.spineData
      if (!data) { window.__spineReport.failed.push(`${n}: no spineData`); return }
      const sp = new PIXI.spine.Spine(data)
      const anims = sp.spineData.animations.map((a) => a.name)
      const anim = anims.includes('idle') ? 'idle' : anims[0]
      if (anim) sp.state.setAnimation(0, anim, true)
      // 归一化到格子里
      const b = sp.getLocalBounds()
      const s = Math.min(cellW / (b.width || 100), cellH / (b.height || 100)) * 0.6
      sp.scale.set(s)
      sp.x = (i % cols) * cellW + cellW / 2
      sp.y = Math.floor(i / cols) * cellH + cellH / 2
      app.stage.addChild(sp)
      // 名称标注
      const t = new PIXI.Text(`${n} [${anims.join(',')}]`, { fontSize: 12, fill: 0x8fd, fontFamily: 'monospace' })
      t.anchor.set(0.5, 0)
      t.x = sp.x
      t.y = Math.floor(i / cols) * cellH + 4
      app.stage.addChild(t)
      window.__spineReport.loaded.push(`${n}(${anim})`)
    } catch (e) {
      window.__spineReport.failed.push(`${n}: ${e.message}`)
    }
  })
  window.__spineDone = true
  console.log('SPINE loaded:', window.__spineReport.loaded.join(', '))
  console.log('SPINE failed:', window.__spineReport.failed.join(' | ') || 'none')
})
