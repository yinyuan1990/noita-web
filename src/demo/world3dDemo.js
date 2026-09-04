import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import { createBatchRenderer, playCocosEffect3D, COCOS_EFFECTS_3D } from '../fx/cocosParticles3d.js'
import { createBattle } from './world/worldBattle.js'

/**
 * 3D 世界演示：
 * - 随机地形：种子化多倍频 Perlin 噪声高度图，顶点色按高度/坡度着色
 * - 植被散布：实例化树木 / 岩石
 * - 角色：three.js 官方开源模型 Soldier.glb（Idle/Walk/Run 动画），WASD 移动
 * - 技能：F 键在角色面前释放 Cocos 移植粒子特效
 */

/* ================= 基础 ================= */

const stageEl = document.getElementById('stage')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.75
stageEl.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0xcfd8e8, 0.0045)

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600)
camera.position.set(8, 6, 12)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.49
controls.minDistance = 3
controls.maxDistance = 40
controls.enablePan = false

function resize() {
  const w = stageEl.clientWidth
  const h = stageEl.clientHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

/* ================= 光照与天空 ================= */

const sky = new Sky()
sky.scale.setScalar(2000)
scene.add(sky)
const sun = new THREE.Vector3()
{
  const u = sky.material.uniforms
  u.turbidity.value = 6
  u.rayleigh.value = 2.2
  u.mieCoefficient.value = 0.004
  u.mieDirectionalG.value = 0.8
  // 偏黄昏的低角度阳光，让粒子特效更醒目
  const elevation = 16
  const azimuth = 150
  const phi = THREE.MathUtils.degToRad(90 - elevation)
  const theta = THREE.MathUtils.degToRad(azimuth)
  sun.setFromSphericalCoords(1, phi, theta)
  u.sunPosition.value.copy(sun)
}

const hemi = new THREE.HemisphereLight(0xbfd4ee, 0x5a4a38, 0.75)
scene.add(hemi)

const dir = new THREE.DirectionalLight(0xffe0b0, 2.2)
dir.position.copy(sun).multiplyScalar(120)
dir.castShadow = true
dir.shadow.mapSize.set(2048, 2048)
dir.shadow.camera.left = -40
dir.shadow.camera.right = 40
dir.shadow.camera.top = 40
dir.shadow.camera.bottom = -40
dir.shadow.camera.far = 400
dir.shadow.bias = -0.0004
scene.add(dir)
scene.add(dir.target)

/* ================= 随机地形 ================= */

const TERRAIN_SIZE = 260
const TERRAIN_SEGS = 180
const WATER_LEVEL = 0.0

const perlin = new ImprovedNoise()
let seed = Math.random() * 10000

/** mulberry32 种子随机数 */
function makeRng(s) {
  let a = s >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let octaveOffsets = []
function reseed(s) {
  seed = s
  const rng = makeRng(Math.floor(s * 1000))
  octaveOffsets = []
  for (let i = 0; i < 5; i++) octaveOffsets.push([rng() * 500, rng() * 500])
}

/** 地形高度采样（角色/植被/顶点共用同一函数保证一致） */
function getHeight(x, z) {
  let amp = 1
  let freq = 0.012
  let h = 0
  for (let i = 0; i < 5; i++) {
    const [ox, oz] = octaveOffsets[i]
    h += perlin.noise(x * freq + ox, z * freq + oz, seed % 100) * amp
    amp *= 0.48
    freq *= 2.1
  }
  // 边缘隆起成环山，中心相对平缓
  const d = Math.hypot(x, z) / (TERRAIN_SIZE * 0.5)
  const rim = Math.pow(THREE.MathUtils.smoothstep(d, 0.55, 1.0), 1.6) * 22
  const valley = 1 - Math.pow(THREE.MathUtils.smoothstep(d, 0.0, 0.45), 1.2) * 0.35
  return h * 7.5 * valley + rim - 1.2
}

const PALETTE = {
  sand: new THREE.Color(0xd8c496),
  grass: new THREE.Color(0x6fa552),
  grassDark: new THREE.Color(0x4d7c3a),
  rock: new THREE.Color(0x8d8578),
  snow: new THREE.Color(0xf2f4f8),
}

let terrain = null
function buildTerrain() {
  if (terrain) {
    terrain.geometry.dispose()
    scene.remove(terrain)
  }
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = getHeight(x, z)
    pos.setY(i, y)
    // 按高度混色
    if (y < WATER_LEVEL + 0.5) c.copy(PALETTE.sand)
    else if (y < 4) c.copy(PALETTE.grass).lerp(PALETTE.grassDark, THREE.MathUtils.clamp(y / 4, 0, 1))
    else if (y < 10) c.copy(PALETTE.grassDark).lerp(PALETTE.rock, (y - 4) / 6)
    else c.copy(PALETTE.rock).lerp(PALETTE.snow, THREE.MathUtils.clamp((y - 10) / 8, 0, 1))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 })
  terrain = new THREE.Mesh(geo, mat)
  terrain.receiveShadow = true
  scene.add(terrain)
}

// 水面
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(TERRAIN_SIZE * 1.2, TERRAIN_SIZE * 1.2),
  new THREE.MeshStandardMaterial({
    color: 0x2e6f9e,
    transparent: true,
    opacity: 0.78,
    roughness: 0.25,
    metalness: 0.1,
  })
)
water.rotation.x = -Math.PI / 2
water.position.y = WATER_LEVEL
scene.add(water)

/* ================= 植被散布（实例化） ================= */

const scatterGroup = new THREE.Group()
scene.add(scatterGroup)

function buildScatter() {
  scatterGroup.traverse((o) => { if (o.geometry) o.geometry.dispose() })
  scatterGroup.clear()
  const rng = makeRng(Math.floor(seed * 777))

  // 采样可放置点：草地高度带、坡度平缓
  const spots = []
  for (let i = 0; i < 4000 && spots.length < 500; i++) {
    const x = (rng() - 0.5) * TERRAIN_SIZE * 0.92
    const z = (rng() - 0.5) * TERRAIN_SIZE * 0.92
    const y = getHeight(x, z)
    if (y < WATER_LEVEL + 0.6 || y > 9) continue
    const slope = Math.abs(getHeight(x + 1.2, z) - y) + Math.abs(getHeight(x, z + 1.2) - y)
    if (slope > 1.4) continue
    spots.push([x, y, z])
  }

  const dummy = new THREE.Object3D()

  // 树：树干 + 双层锥形树冠
  const treeCount = Math.min(260, Math.floor(spots.length * 0.7))
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.2, 5)
  const leafGeo1 = new THREE.ConeGeometry(1.05, 2.2, 6)
  const leafGeo2 = new THREE.ConeGeometry(0.75, 1.7, 6)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, flatShading: true, roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3e7a35, flatShading: true, roughness: 0.9 })
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount)
  const leaves1 = new THREE.InstancedMesh(leafGeo1, leafMat, treeCount)
  const leaves2 = new THREE.InstancedMesh(leafGeo2, leafMat, treeCount)
  const leafColor = new THREE.Color()
  for (let i = 0; i < treeCount; i++) {
    const [x, y, z] = spots[i]
    const s = 0.7 + rng() * 0.9
    const rot = rng() * Math.PI * 2
    dummy.position.set(x, y + 0.55 * s, z)
    dummy.rotation.set(0, rot, 0)
    dummy.scale.setScalar(s)
    dummy.updateMatrix()
    trunks.setMatrixAt(i, dummy.matrix)
    dummy.position.y = y + (1.1 + 1.0) * s
    dummy.updateMatrix()
    leaves1.setMatrixAt(i, dummy.matrix)
    dummy.position.y = y + (1.1 + 2.1) * s
    dummy.updateMatrix()
    leaves2.setMatrixAt(i, dummy.matrix)
    leafColor.setHSL(0.28 + rng() * 0.07, 0.45 + rng() * 0.2, 0.3 + rng() * 0.12)
    leaves1.setColorAt(i, leafColor)
    leaves2.setColorAt(i, leafColor)
  }
  for (const m of [trunks, leaves1, leaves2]) {
    m.castShadow = true
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    scatterGroup.add(m)
  }

  // 岩石
  const rockCount = Math.min(90, spots.length - treeCount)
  const rockGeo = new THREE.DodecahedronGeometry(0.6, 0)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, flatShading: true, roughness: 1 })
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(rockCount, 1))
  for (let i = 0; i < rockCount; i++) {
    const [x, y, z] = spots[treeCount + i]
    const s = 0.4 + rng() * 1.1
    dummy.position.set(x, y + 0.15 * s, z)
    dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    dummy.scale.set(s, s * (0.6 + rng() * 0.5), s)
    dummy.updateMatrix()
    rocks.setMatrixAt(i, dummy.matrix)
  }
  rocks.castShadow = true
  rocks.instanceMatrix.needsUpdate = true
  scatterGroup.add(rocks)
}

/* ================= 角色 ================= */

const player = {
  group: new THREE.Group(),
  mixer: null,
  actions: {},
  currentAction: null,
  speedWalk: 2.6,
  speedRun: 6.0,
  velocityY: 0,
  ready: false,
}
scene.add(player.group)

/** 在出生点附近找一块高于水面的平地 */
function findSpawn() {
  for (let r = 0; r < 60; r += 2) {
    for (let a = 0; a < Math.PI * 2; a += 0.5) {
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = getHeight(x, z)
      if (y > WATER_LEVEL + 0.6 && y < 6) return new THREE.Vector3(x, y, z)
    }
  }
  return new THREE.Vector3(0, Math.max(getHeight(0, 0), WATER_LEVEL + 0.6), 0)
}

function setAction(name, fade = 0.24) {
  const next = player.actions[name]
  if (!next || player.currentAction === next) return
  next.enabled = true
  next.reset().play()
  if (player.currentAction) player.currentAction.crossFadeTo(next, fade, true)
  player.currentAction = next
}

new GLTFLoader().load(
  '/res/models/Soldier.glb',
  (gltf) => {
    const model = gltf.scene
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false } })
    model.rotation.y = Math.PI // 模型默认面朝 -Z，翻转为 +Z 前进方向
    player.group.add(model)
    player.mixer = new THREE.AnimationMixer(model)
    for (const clip of gltf.animations) {
      player.actions[clip.name] = player.mixer.clipAction(clip)
    }
    setAction('Idle')
    player.ready = true
  },
  undefined,
  (err) => {
    console.warn('Soldier.glb 加载失败，使用占位角色', err)
    // 占位角色：胶囊身体 + 头 + 鼻子指示朝向
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.85, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a7fbf, flatShading: true })
    )
    body.position.y = 0.95
    body.castShadow = true
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8c9a0, flatShading: true })
    )
    head.position.y = 1.75
    head.castShadow = true
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.22, 6),
      new THREE.MeshStandardMaterial({ color: 0xcc5544 })
    )
    nose.rotation.x = Math.PI / 2
    nose.position.set(0, 1.75, 0.26)
    player.group.add(body, head, nose)
    player.ready = true
  }
)

/* ================= 输入 ================= */

const keys = new Set()
window.addEventListener('keydown', (e) => {
  keys.add(e.code)
  if (e.code === 'Space') e.preventDefault()
  if (e.code === 'KeyF' && battle && battle.mode === 'foot') castSkill()
  if (e.code === 'KeyE' && battle) battle.tryInteract()
  if (e.code === 'KeyT') regenerate()
})
window.addEventListener('keyup', (e) => keys.delete(e.code))

const moveDir = new THREE.Vector3()
const camFwd = new THREE.Vector3()
const camRight = new THREE.Vector3()

function updatePlayer(dt) {
  if (!player.ready) return
  const up = keys.has('KeyW') || keys.has('ArrowUp')
  const down = keys.has('KeyS') || keys.has('ArrowDown')
  const left = keys.has('KeyA') || keys.has('ArrowLeft')
  const right = keys.has('KeyD') || keys.has('ArrowRight')
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight')

  camera.getWorldDirection(camFwd)
  camFwd.y = 0
  camFwd.normalize()
  camRight.crossVectors(camFwd, THREE.Object3D.DEFAULT_UP).negate()

  moveDir.set(0, 0, 0)
  if (up) moveDir.add(camFwd)
  if (down) moveDir.sub(camFwd)
  if (left) moveDir.add(camRight)
  if (right) moveDir.sub(camRight)

  const moving = moveDir.lengthSq() > 0
  if (moving) {
    moveDir.normalize()
    const speed = running ? player.speedRun : player.speedWalk
    const nx = player.group.position.x + moveDir.x * speed * dt
    const nz = player.group.position.z + moveDir.z * speed * dt
    const ny = getHeight(nx, nz)
    // 不允许走进深水
    if (ny > WATER_LEVEL - 0.35) {
      player.group.position.x = nx
      player.group.position.z = nz
    }
    // 平滑转向移动方向
    const targetYaw = Math.atan2(moveDir.x, moveDir.z)
    let d = targetYaw - player.group.rotation.y
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    player.group.rotation.y += d * Math.min(dt * 12, 1)
    setAction(running ? 'Run' : 'Walk')
  } else {
    setAction('Idle')
  }

  // 贴地（浅水区踩水）
  const groundY = getHeight(player.group.position.x, player.group.position.z)
  player.group.position.y += (Math.max(groundY, WATER_LEVEL - 0.3) - player.group.position.y) * Math.min(dt * 14, 1)

  if (player.mixer) player.mixer.update(dt)
}

/* ================= 相机跟随（人物或载具） ================= */

const lastFocusPos = new THREE.Vector3()
let lastFocusObj = null
function updateCamera() {
  const focus = battle ? battle.getFocus() : { obj: player.group, height: 1.4 }
  const p = focus.obj.position
  if (lastFocusObj !== focus.obj) {
    lastFocusObj = focus.obj
    lastFocusPos.copy(p)
  }
  const delta = new THREE.Vector3().subVectors(p, lastFocusPos)
  camera.position.add(delta)
  controls.target.set(p.x, p.y + focus.height, p.z)
  lastFocusPos.copy(p)
  controls.update()
}

/* ================= 粒子技能 ================= */

const batch = createBatchRenderer(scene)
const SKILLS = Object.keys(COCOS_EFFECTS_3D).filter((n) =>
  ['burstFlare', 'groundExplode', 'armExplode', 'cartoonExplode', 'areaBang', 'bigBang', 'canBlast'].includes(n)
)
let skillIdx = 0

function castSkill() {
  const name = SKILLS[skillIdx % SKILLS.length]
  skillIdx++
  const fwd = new THREE.Vector3(Math.sin(player.group.rotation.y), 0, Math.cos(player.group.rotation.y))
  const pos = player.group.position.clone().add(fwd.multiplyScalar(4.5))
  pos.y = Math.max(getHeight(pos.x, pos.z), WATER_LEVEL) + 0.05
  // 技能带伤害（军团阵营）
  if (battle) battle.explode(pos, 'jun', 45, 5, name)
  else playCocosEffect3D(scene, batch, name, { position: pos })
  const tipEl = document.getElementById('skill-name')
  if (tipEl) tipEl.textContent = name
}

// 点击：徒步 = 在点击处放技能（带伤害）；驾驶载具 = 开炮
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downAt = null
let clickFire = false
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY] })
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return
  if (battle && battle.mode !== 'foot') {
    clickFire = true
    return
  }
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObject(terrain)[0]
  if (hit) {
    const name = SKILLS[Math.floor(Math.random() * SKILLS.length)]
    const pos = hit.point.clone().add(new THREE.Vector3(0, 0.05, 0))
    if (battle) battle.explode(pos, 'jun', 45, 5, name)
    else playCocosEffect3D(scene, batch, name, { position: pos })
  }
})

/* ================= HUD ================= */

const hpBarEl = document.getElementById('hp-bar')
const hpTextEl = document.getElementById('hp-text')
const modeEl = document.getElementById('mode')
const killsEl = document.getElementById('kills')
const logEl = document.getElementById('log')
const logLines = []

function pushLog(msg) {
  if (!logEl) return
  logLines.push(msg)
  if (logLines.length > 5) logLines.shift()
  logEl.innerHTML = logLines.map((l) => `<div>${l}</div>`).join('')
}

const MODE_NAMES = { foot: '徒步', tank: '坦克', plane: '战机', boat: '炮艇' }
function updateHud() {
  if (!battle) return
  const hpRatio = Math.max(0, battle.state.playerHp) / 100
  if (hpBarEl) {
    hpBarEl.style.width = `${hpRatio * 100}%`
    hpBarEl.style.background = hpRatio > 0.35 ? '#6fe08a' : '#e06f5a'
  }
  if (hpTextEl) hpTextEl.textContent = `${Math.max(0, Math.round(battle.state.playerHp))}`
  if (modeEl) {
    const v = battle.state.vehicle
    modeEl.textContent = MODE_NAMES[battle.mode] + (v ? `（${Math.round((v.hp / v.maxHp) * 100)}%）` : '')
  }
  if (killsEl) killsEl.textContent = battle.state.kills
}

/* ================= 战斗系统 ================= */

let battle = null

function respawnPlayer() {
  const spawn = findSpawn()
  player.group.position.copy(spawn)
  player.group.visible = true
}

/* ================= 世界生成 ================= */

function regenerate(newSeed = Math.random() * 10000) {
  reseed(newSeed)
  buildTerrain()
  buildScatter()
  const spawn = findSpawn()
  player.group.position.copy(spawn)
  lastFocusPos.copy(spawn)
  camera.position.set(spawn.x + 7, spawn.y + 5.5, spawn.z + 10)
  controls.target.set(spawn.x, spawn.y + 1.4, spawn.z)
  const seedEl = document.getElementById('seed')
  if (seedEl) seedEl.textContent = newSeed.toFixed(0)
  if (battle) battle.repositionAll()
}

const regenBtn = document.getElementById('regen')
if (regenBtn) regenBtn.onclick = () => regenerate()

regenerate()

battle = createBattle({
  scene,
  camera,
  player,
  getHeight,
  waterLevel: WATER_LEVEL,
  playFx: (name, pos) => playCocosEffect3D(scene, batch, name, { position: pos }),
  onLog: pushLog,
  respawnPlayer,
  mouseFire: () => {
    const v = clickFire
    clickFire = false
    return v
  },
})
battle.repositionAll()
pushLog('修仙者已现世，军团进入战备（E 上载具 · F 技能）')
window.__battle = battle
window.__player = player

/* ================= 主循环 ================= */

const clock = new THREE.Clock()
function tick() {
  requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  if (!battle || battle.mode === 'foot') updatePlayer(dt)
  else if (player.mixer) player.mixer.update(dt)
  if (battle) battle.update(dt, keys)
  updateCamera()
  updateHud()
  batch.update(dt)
  renderer.render(scene, camera)
}
tick()
