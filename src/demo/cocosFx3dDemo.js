import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createBatchRenderer, playCocosEffect3D } from '../fx/cocosParticles3d.js'

/** Cocos 粒子 3D 演示：轨道相机 + 点击地面释放 */

const stageEl = document.getElementById('stage')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x0a0c12)
stageEl.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x0a0c12, 18, 40)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.set(6, 4.5, 9)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1.2, 0)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.49
controls.minDistance = 3
controls.maxDistance = 26

// 地面：暗色圆盘 + 网格
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(16, 48),
  new THREE.MeshBasicMaterial({ color: 0x11141c })
)
ground.rotation.x = -Math.PI / 2
scene.add(ground)
const grid = new THREE.GridHelper(32, 32, 0x2a3444, 0x1a2230)
grid.position.y = 0.01
scene.add(grid)

const batch = createBatchRenderer(scene)
window.__batch = batch

function resize() {
  const w = stageEl.clientWidth
  const h = stageEl.clientHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

/* ---------------- UI ---------------- */

const GROUPS = [
  ['单发射器', ['flare', 'chaoticFlare', 'candleFlare', 'growingFlare', 'sparkFlare', 'blastWave', 'dustRise']],
  ['组合特效', ['burstFlare', 'groundExplode', 'armExplode', 'cartoonExplode', 'areaBang', 'bigBang', 'canBlast']],
]

let current = 'bigBang'
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
      fire(new THREE.Vector3(0, 0.02, 0))
    }
    panel.appendChild(b)
    btns.set(name, b)
  }
}

function select(name) {
  current = name
  for (const [n, b] of btns) b.classList.toggle('active', n === name)
}

function fire(position) {
  playCocosEffect3D(scene, batch, current, { position })
}

// 点击地面（射线拾取）释放
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downAt = null
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY]
})
renderer.domElement.addEventListener('pointerup', (e) => {
  // 拖动旋转相机时不触发
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObject(ground)[0]
  if (hit) fire(hit.point.clone().add(new THREE.Vector3(0, 0.02, 0)))
})

select(current)
fire(new THREE.Vector3(0, 0.02, 0))

// 自动轮播
const ALL = GROUPS.flatMap(([, names]) => names)
let idx = ALL.indexOf(current)
setInterval(() => {
  if (!document.getElementById('auto').checked) return
  idx = (idx + 1) % ALL.length
  select(ALL[idx])
  const r = Math.random() * 3
  const a = Math.random() * Math.PI * 2
  fire(new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r))
}, 2400)

/* ---------------- 主循环 ---------------- */

const clock = new THREE.Clock()
function tick() {
  requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  batch.update(dt)
  controls.update()
  renderer.render(scene, camera)
}
tick()
