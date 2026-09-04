import * as PIXI from 'pixi.js'
import { playCocosEffect, listCocosEffects } from '../fx/cocosParticles.js'

/** Cocos 粒子移植演示：左侧选特效，点击画面释放；默认自动轮播 */

const stageEl = document.getElementById('stage')
const app = new PIXI.Application({
  resizeTo: stageEl,
  backgroundColor: 0x0a0c12,
  antialias: true,
})
stageEl.appendChild(app.view)

const GROUPS = [
  ['单发射器', ['flare', 'chaoticFlare', 'candleFlare', 'growingFlare', 'sparkFlare', 'blastWave', 'dustRise']],
  ['组合特效', ['burstFlare', 'groundExplode', 'armExplode', 'cartoonExplode', 'areaBang', 'bigBang', 'canBlast']],
]

let current = 'canBlast'
const btns = new Map()
const panel = document.getElementById('buttons')

for (const [label, names] of GROUPS) {
  const head = document.createElement('div')
  head.className = 'group'
  head.textContent = label
  panel.appendChild(head)
  for (const name of names) {
    const b = document.createElement('button')
    b.textContent = name
    b.onclick = () => {
      select(name)
      fire(app.renderer.width / 2, app.renderer.height / 2)
    }
    panel.appendChild(b)
    btns.set(name, b)
  }
}

// 防止注册表与页面按钮不同步
for (const name of listCocosEffects()) {
  if (!btns.has(name)) console.warn('[demo] effect not listed in panel:', name)
}

function select(name) {
  current = name
  for (const [n, b] of btns) b.classList.toggle('active', n === name)
}

function fire(x, y) {
  playCocosEffect(app.stage, current, { x, y })
}

app.view.addEventListener('pointerdown', (e) => {
  const rect = app.view.getBoundingClientRect()
  fire(e.clientX - rect.left, e.clientY - rect.top)
})

select(current)
fire(app.renderer.width / 2, app.renderer.height / 2)

// 自动轮播
const ALL = GROUPS.flatMap(([, names]) => names)
let idx = ALL.indexOf(current)
setInterval(() => {
  if (!document.getElementById('auto').checked) return
  idx = (idx + 1) % ALL.length
  select(ALL[idx])
  const w = app.renderer.width
  const h = app.renderer.height
  fire(w * (0.3 + Math.random() * 0.4), h * (0.3 + Math.random() * 0.4))
}, 2200)
