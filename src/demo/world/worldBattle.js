import * as THREE from 'three'

/**
 * 混战系统：可驾驶载具（坦克/飞机/轮船）+ 投射物 + 修仙者 AI + 阵营战
 *
 * 阵营：
 * - jun（军团）：玩家、玩家载具、AI 坦克
 * - xiu（修仙）：修仙者（角色名取自小说：贾卡罗、莫蒂亚、克斯迦、迪穆尼、兰丝卡）
 *
 * 用法：
 *   const battle = createBattle(ctx)
 *   battle.update(dt)          每帧
 *   battle.tryInteract()       E 键上下载具
 *   battle.repositionAll()     地形重新生成后重摆
 *   battle.mode                'foot' | 'tank' | 'plane' | 'boat'
 */

const flatMat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra })

let _glowTex = null
function glowTexture() {
  if (_glowTex) return _glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  _glowTex = new THREE.CanvasTexture(c)
  return _glowTex
}

/* ============ 载具建模（低模程序化，合金弹头卡通比例） ============ */

function buildTank(color = 0x5e7a4a) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 3.6), flatMat(color))
  body.position.y = 0.95
  const trackMat = flatMat(0x3a3f45)
  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 4.0), trackMat)
    track.position.set(side * 1.35, 0.55, 0)
    g.add(track)
    for (let i = 0; i < 5; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), flatMat(0x23272c))
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(side * 1.45, 0.36, -1.5 + i * 0.75)
      g.add(wheel)
    }
  }
  const turret = new THREE.Group()
  turret.position.set(0, 1.55, -0.2)
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.65, 8), flatMat(color))
  dome.position.y = 0.2
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 2.6, 8), flatMat(0x2f343a))
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.25, 1.8)
  const muzzle = new THREE.Object3D()
  muzzle.position.set(0, 0.25, 3.1)
  turret.add(dome, barrel, muzzle)
  g.add(body, turret)
  g.traverse((o) => { if (o.isMesh) o.castShadow = true })
  return { group: g, turret, muzzle, kind: 'tank' }
}

function buildPlane(color = 0x8a9aad) {
  const g = new THREE.Group()
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 4.6, 8), flatMat(color))
  fuselage.rotation.x = Math.PI / 2
  fuselage.position.y = 1.1
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.7, 8), flatMat(0xd7b356))
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.1, 2.6)
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), flatMat(0x9fd8f0, { roughness: 0.3 }))
  cockpit.scale.set(0.8, 0.6, 1.1)
  cockpit.position.set(0, 1.62, 0.6)
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 1.5), flatMat(color))
  wing.position.set(0, 1.15, 0.4)
  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.8), flatMat(color))
  tailWing.position.set(0, 1.3, -2.1)
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.9), flatMat(0xd7b356))
  tailFin.position.set(0, 1.8, -2.15)
  const propeller = new THREE.Group()
  propeller.position.set(0, 1.1, 3.0)
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.06), flatMat(0x33383e))
    blade.rotation.z = a
    propeller.add(blade)
  }
  // 起落橇
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), flatMat(0x33383e))
    leg.position.set(side * 0.8, 0.55, 0.8)
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 10), flatMat(0x23272c))
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(side * 0.8, 0.28, 0.8)
    g.add(leg, wheel)
  }
  const muzzleL = new THREE.Object3D()
  muzzleL.position.set(-2.4, 1.1, 1.0)
  const muzzleR = new THREE.Object3D()
  muzzleR.position.set(2.4, 1.1, 1.0)
  g.add(fuselage, nose, cockpit, wing, tailWing, tailFin, propeller, muzzleL, muzzleR)
  g.traverse((o) => { if (o.isMesh) o.castShadow = true })
  return { group: g, propeller, muzzles: [muzzleL, muzzleR], kind: 'plane' }
}

function buildBoat(color = 0x7a5a3a) {
  const g = new THREE.Group()
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 6.0), flatMat(color))
  hull.position.y = 0.5
  const prow = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.8, 4), flatMat(color))
  prow.rotation.x = Math.PI / 2
  prow.rotation.y = Math.PI / 4
  prow.scale.set(1, 1, 0.56)
  prow.position.set(0, 0.5, 3.7)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 2.2), flatMat(0xcfd4da))
  deck.position.set(0, 1.35, -1.4)
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.1, 8), flatMat(0x3a3f45))
  chimney.position.set(0, 2.2, -1.6)
  const turret = new THREE.Group()
  turret.position.set(0, 1.25, 1.2)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.55, 8), flatMat(0x8f9aa5))
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 2.2, 8), flatMat(0x2f343a))
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.2, 1.4)
  const muzzle = new THREE.Object3D()
  muzzle.position.set(0, 0.2, 2.5)
  turret.add(base, barrel, muzzle)
  g.add(hull, prow, deck, chimney, turret)
  g.traverse((o) => { if (o.isMesh) o.castShadow = true })
  return { group: g, turret, muzzle, kind: 'boat' }
}

/* ============ 修仙者建模 ============ */

const CULTIVATORS = [
  { name: '贾卡罗', color: 0xb04a3a }, // 双刀
  { name: '莫蒂亚', color: 0x7a4ab0 }, // 咒术
  { name: '克斯迦', color: 0x3a7ab0 },
  { name: '迪穆尼', color: 0xb0983a },
  { name: '兰丝卡', color: 0x3ab07a }, // 一阶法术
]

function makeLabel(text, color = '#fff') {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 96
  const g = c.getContext('2d')
  g.font = 'bold 44px "Noto Serif SC", serif'
  g.textAlign = 'center'
  g.fillStyle = 'rgba(0,0,0,0.45)'
  g.fillRect(28, 6, 200, 56)
  g.fillStyle = color
  g.fillText(text, 128, 48)
  // 血条底
  g.fillStyle = 'rgba(0,0,0,0.55)'
  g.fillRect(48, 70, 160, 14)
  const tex = new THREE.CanvasTexture(c)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sp.scale.set(3.4, 1.28, 1)
  return {
    sprite: sp,
    setHp(ratio) {
      g.clearRect(50, 72, 156, 10)
      g.fillStyle = ratio > 0.35 ? '#6fe08a' : '#e06f5a'
      g.fillRect(50, 72, 156 * Math.max(0, ratio), 10)
      tex.needsUpdate = true
    },
  }
}

function buildCultivator({ name, color }) {
  const g = new THREE.Group()
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.9, 7), flatMat(color))
  robe.position.y = 0.95
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), flatMat(color))
  chest.position.y = 1.85
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), flatMat(0xe8c9a0))
  head.position.y = 2.35
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), flatMat(0x2a2226))
  bun.position.y = 2.62
  // 飞剑（悬在身侧，发光）
  const sword = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.02, 1.5),
    new THREE.MeshBasicMaterial({ color: 0xbfe8ff })
  )
  sword.position.set(0.75, 1.6, 0)
  // 脚下灵光
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.06
  const label = makeLabel(name, '#ffd9c4')
  label.sprite.position.y = 3.4
  g.add(robe, chest, head, bun, sword, halo, label.sprite)
  robe.castShadow = chest.castShadow = true
  return { group: g, sword, halo, label }
}

/* ============ 战斗系统 ============ */

export function createBattle(ctx) {
  const { scene, getHeight, waterLevel, playFx, player, camera, onLog } = ctx

  const entities = []
  const projectiles = []
  const telegraphs = []
  const root = new THREE.Group()
  scene.add(root)

  const state = {
    mode: 'foot', // foot | tank | plane | boat
    vehicle: null, // 玩家当前驾驶的载具实体
    kills: 0,
    playerHp: 100,
  }

  const log = (msg) => onLog && onLog(msg)

  /* ---------- 实体注册 ---------- */

  function addEntity(e) {
    entities.push(e)
    if (e.group) root.add(e.group)
    return e
  }

  const playerEntity = addEntity({
    kind: 'player',
    name: '士兵',
    faction: 'jun',
    group: null, // 位置直接读 player.group
    getPos: () => player.group.position,
    hitRadius: 0.9,
    get alive() {
      return state.mode === 'foot'
    },
    takeDamage(dmg) {
      state.playerHp -= dmg
      if (state.playerHp <= 0) {
        state.playerHp = 100
        playFx('canBlast', player.group.position.clone())
        log('士兵阵亡，返回出生点')
        ctx.respawnPlayer()
      }
    },
  })

  /* ---------- 载具 ---------- */

  function makeVehicleEntity(build, kind, name, hp) {
    const v = build()
    const e = addEntity({
      kind,
      name,
      faction: 'jun',
      group: v.group,
      parts: v,
      hp,
      maxHp: hp,
      hitRadius: kind === 'plane' ? 3.2 : 2.6,
      alive: true,
      spawnPos: new THREE.Vector3(),
      yaw: 0,
      speed: 0,
      fireCd: 0,
      respawnTimer: 0,
      vertVel: 0,
      airborne: false,
      getPos: () => v.group.position,
      takeDamage(dmg) {
        if (!e.alive) return
        e.hp -= dmg
        if (e.hp <= 0) destroyVehicle(e)
      },
    })
    return e
  }

  function destroyVehicle(e) {
    e.alive = false
    e.hp = 0
    e.group.visible = false
    e.respawnTimer = 14
    playFx('bigBang', e.getPos().clone().add(new THREE.Vector3(0, 0.5, 0)))
    log(`${e.name} 被摧毁`)
    if (state.vehicle === e) {
      // 玩家被炸出载具
      state.mode = 'foot'
      state.vehicle = null
      player.group.visible = true
      player.group.position.copy(findLandNear(e.getPos(), 6))
      state.playerHp = Math.max(20, state.playerHp - 30)
    }
  }

  const tank = makeVehicleEntity(buildTank, 'tank', '坦克', 400)
  const plane = makeVehicleEntity(buildPlane, 'plane', '战机', 200)
  const boat = makeVehicleEntity(buildBoat, 'boat', '炮艇', 320)

  /* ---------- AI 坦克（军团） ---------- */

  const aiTanks = []
  for (let i = 0; i < 2; i++) {
    const e = makeVehicleEntity(() => buildTank(0x4a6a7a), 'aitank', `军团坦克${i + 1}`, 280)
    e.waypoint = new THREE.Vector3()
    e.aiFireCd = 2 + i
    aiTanks.push(e)
  }

  /* ---------- 修仙者（敌对阵营） ---------- */

  const cultivators = CULTIVATORS.map((def, i) => {
    const c = buildCultivator(def)
    const e = addEntity({
      kind: 'cultivator',
      name: def.name,
      faction: 'xiu',
      group: c.group,
      parts: c,
      hp: 140,
      maxHp: 140,
      hitRadius: 1.4,
      alive: true,
      anchor: new THREE.Vector3(),
      phase: Math.random() * Math.PI * 2,
      fireCd: 2 + i * 0.7,
      bigCd: 6 + i * 2,
      respawnTimer: 0,
      getPos: () => c.group.position,
      takeDamage(dmg) {
        if (!e.alive) return
        e.hp -= dmg
        e.parts.label.setHp(e.hp / e.maxHp)
        if (e.hp <= 0) {
          e.alive = false
          e.group.visible = false
          e.respawnTimer = 18
          state.kills++
          playFx('canBlast', e.getPos().clone())
          log(`${e.name} 陨落（击杀 ${state.kills}）`)
        }
      },
    })
    return e
  })

  /* ---------- 位置摆放 ---------- */

  function findLandNear(center, maxR, minH = waterLevel + 0.6) {
    for (let r = 2; r <= maxR; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += 0.6) {
        const x = center.x + Math.cos(a) * r
        const z = center.z + Math.sin(a) * r
        const y = getHeight(x, z)
        if (y > minH && y < 8) return new THREE.Vector3(x, y, z)
      }
    }
    return center.clone()
  }

  function findWaterNear(center, maxR = 120) {
    for (let r = 6; r <= maxR; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += 0.45) {
        const x = center.x + Math.cos(a) * r
        const z = center.z + Math.sin(a) * r
        if (getHeight(x, z) < waterLevel - 1.2) return new THREE.Vector3(x, waterLevel, z)
      }
    }
    return new THREE.Vector3(center.x, waterLevel, center.z)
  }

  function repositionAll() {
    const spawn = player.group.position
    const tp = findLandNear(spawn, 14)
    tank.group.position.copy(tp)
    tank.spawnPos.copy(tp)
    tank.yaw = Math.random() * Math.PI * 2
    const pp = findLandNear(spawn.clone().add(new THREE.Vector3(12, 0, -8)), 20)
    plane.group.position.copy(pp)
    plane.spawnPos.copy(pp)
    plane.yaw = 0
    plane.speed = 0
    plane.airborne = false
    const bp = findWaterNear(spawn)
    boat.group.position.copy(bp)
    boat.spawnPos.copy(bp)
    boat.yaw = 0
    for (const [i, e] of aiTanks.entries()) {
      const p = findLandNear(spawn.clone().add(new THREE.Vector3(-16 + i * 30, 0, 18)), 24)
      e.group.position.copy(p)
      e.spawnPos.copy(p)
      e.yaw = Math.random() * Math.PI * 2
      e.waypoint.copy(findLandNear(p, 30))
    }
    for (const e of cultivators) {
      const a = Math.random() * Math.PI * 2
      const r = 30 + Math.random() * 25
      const p = findLandNear(spawn.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 20)
      e.anchor.copy(p)
      e.group.position.set(p.x, p.y + 4, p.z)
      e.hp = e.maxHp
      e.alive = true
      e.group.visible = true
      e.parts.label.setHp(1)
    }
    for (const e of [tank, plane, boat, ...aiTanks]) {
      e.alive = true
      e.hp = e.maxHp
      e.group.visible = true
    }
  }

  /* ---------- 投射物 ---------- */

  const projGeo = new THREE.SphereGeometry(0.18, 8, 6)

  function fireProjectile(opts) {
    const mesh = new THREE.Mesh(
      projGeo,
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0xffd28a })
    )
    mesh.position.copy(opts.from)
    mesh.scale.setScalar(opts.size ?? 1)
    root.add(mesh)
    projectiles.push({
      mesh,
      vel: opts.dir.clone().normalize().multiplyScalar(opts.speed),
      grav: opts.grav ?? 0,
      faction: opts.faction,
      dmg: opts.dmg,
      radius: opts.radius,
      fxLand: opts.fxLand ?? 'groundExplode',
      fxWater: opts.fxWater ?? 'areaBang',
      fxHit: opts.fxHit ?? opts.fxLand ?? 'burstFlare',
      ttl: opts.ttl ?? 6,
    })
    if (opts.muzzleFx) playFx(opts.muzzleFx, opts.from.clone())
  }

  function explode(pos, faction, dmg, radius, fxName) {
    playFx(fxName, pos.clone())
    for (const e of entities) {
      if (!e.alive || e.faction === faction) continue
      if (e.getPos().distanceTo(pos) < radius + e.hitRadius) {
        e.takeDamage(dmg)
      }
    }
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]
      p.ttl -= dt
      p.vel.y -= p.grav * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      const pos = p.mesh.position
      let hit = null
      // 地形/水面
      const groundY = getHeight(pos.x, pos.z)
      if (pos.y <= Math.max(groundY, waterLevel)) {
        hit = groundY > waterLevel ? p.fxLand : p.fxWater
        pos.y = Math.max(groundY, waterLevel) + 0.05
      } else {
        // 实体命中
        for (const e of entities) {
          if (!e.alive || e.faction === p.faction) continue
          if (e.getPos().distanceTo(pos) < e.hitRadius + 0.4) {
            hit = p.fxHit
            break
          }
        }
      }
      if (hit || p.ttl <= 0) {
        if (hit) explode(pos, p.faction, p.dmg, p.radius, hit)
        root.remove(p.mesh)
        p.mesh.material.dispose()
        projectiles.splice(i, 1)
      }
    }
  }

  /* ---------- 大招预警圈 ---------- */

  function telegraph(pos, delay, radius, onDone) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.85, radius, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff6a4a,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(pos.x, Math.max(getHeight(pos.x, pos.z), waterLevel) + 0.08, pos.z)
    root.add(ring)
    telegraphs.push({ ring, t: delay, total: delay, onDone })
  }

  function updateTelegraphs(dt) {
    for (let i = telegraphs.length - 1; i >= 0; i--) {
      const t = telegraphs[i]
      t.t -= dt
      t.ring.scale.setScalar(0.4 + 0.6 * (1 - t.t / t.total))
      if (t.t <= 0) {
        t.onDone(t.ring.position.clone())
        root.remove(t.ring)
        t.ring.geometry.dispose()
        t.ring.material.dispose()
        telegraphs.splice(i, 1)
      }
    }
  }

  /* ---------- 玩家载具驾驶 ---------- */

  function camAzimuth() {
    const d = new THREE.Vector3()
    camera.getWorldDirection(d)
    return Math.atan2(d.x, d.z)
  }

  function alignToTerrain(e, dt) {
    const p = e.group.position
    const ahead = 1.6
    const hF = getHeight(p.x + Math.sin(e.yaw) * ahead, p.z + Math.cos(e.yaw) * ahead)
    const hB = getHeight(p.x - Math.sin(e.yaw) * ahead, p.z - Math.cos(e.yaw) * ahead)
    const hL = getHeight(p.x + Math.cos(e.yaw) * ahead, p.z - Math.sin(e.yaw) * ahead)
    const hR = getHeight(p.x - Math.cos(e.yaw) * ahead, p.z + Math.sin(e.yaw) * ahead)
    const pitch = Math.atan2(hB - hF, ahead * 2)
    const roll = Math.atan2(hR - hL, ahead * 2)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, e.yaw, roll, 'YXZ'))
    e.group.quaternion.slerp(q, Math.min(dt * 6, 1))
  }

  function driveTank(e, keys, dt, isPlayer) {
    const accel = keys.has('KeyW') ? 10 : keys.has('KeyS') ? -7 : 0
    e.speed += accel * dt
    e.speed *= 1 - Math.min(dt * 1.5, 0.9)
    e.speed = THREE.MathUtils.clamp(e.speed, -4, 8)
    if (keys.has('KeyA')) e.yaw += 1.5 * dt
    if (keys.has('KeyD')) e.yaw -= 1.5 * dt
    const p = e.group.position
    const nx = p.x + Math.sin(e.yaw) * e.speed * dt
    const nz = p.z + Math.cos(e.yaw) * e.speed * dt
    const ny = getHeight(nx, nz)
    if (ny > waterLevel - 0.3) {
      p.x = nx
      p.z = nz
      p.y = ny
    } else {
      e.speed = 0
    }
    alignToTerrain(e, dt)
    // 炮塔跟随相机
    if (isPlayer) e.parts.turret.rotation.y = camAzimuth() - e.yaw
    e.fireCd -= dt
    if (isPlayer && (keys.has('Space') || ctx.mouseFire()) && e.fireCd <= 0) {
      e.fireCd = 1.1
      const muzzlePos = e.parts.muzzle.getWorldPosition(new THREE.Vector3())
      const dir = new THREE.Vector3(0, 0.22, 1)
        .applyEuler(new THREE.Euler(0, e.yaw + e.parts.turret.rotation.y, 0))
        .normalize()
      fireProjectile({
        from: muzzlePos, dir, speed: 30, grav: 10, faction: 'jun',
        dmg: 70, radius: 5, fxLand: 'cartoonExplode', fxWater: 'areaBang', fxHit: 'cartoonExplode',
        muzzleFx: 'sparkFlare', color: 0xffe0a0, size: 1.4,
      })
    }
  }

  function drivePlane(e, keys, dt) {
    const p = e.group.position
    if (keys.has('KeyW')) e.speed += 9 * dt
    if (keys.has('KeyS')) e.speed -= 12 * dt
    e.speed = THREE.MathUtils.clamp(e.speed, 0, 26)
    const turn = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0)
    e.yaw += turn * 1.1 * dt
    const groundY = Math.max(getHeight(p.x, p.z), waterLevel)
    if (!e.airborne && e.speed > 11) e.airborne = true
    if (e.airborne) {
      // 巡航高度：地形上方 12，可用 R/F 升降
      let target = Math.max(groundY + 12, waterLevel + 10)
      if (keys.has('KeyR')) target = p.y + 8
      if (keys.has('KeyF')) target = Math.max(groundY + 3, p.y - 8)
      p.y += (target - p.y) * Math.min(dt * 1.6, 1)
      if (e.speed < 7) {
        // 失速降落
        p.y += (groundY - p.y) * Math.min(dt * 2, 1)
        if (p.y - groundY < 0.3) e.airborne = false
      }
    } else {
      p.y = groundY
    }
    p.x += Math.sin(e.yaw) * e.speed * dt
    p.z += Math.cos(e.yaw) * e.speed * dt
    const bank = turn * 0.5
    const pitch = e.airborne ? THREE.MathUtils.clamp((keys.has('KeyR') ? -0.3 : 0) + (keys.has('KeyF') ? 0.3 : 0), -0.4, 0.4) : 0
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, e.yaw, -bank, 'YXZ'))
    e.group.quaternion.slerp(q, Math.min(dt * 5, 1))
    e.parts.propeller.rotation.z += (2 + e.speed) * dt * 6
    e.fireCd -= dt
    if ((keys.has('Space') || ctx.mouseFire()) && e.fireCd <= 0 && e.airborne) {
      e.fireCd = 0.32
      e.muzzleFlip = !e.muzzleFlip
      const m = e.parts.muzzles[e.muzzleFlip ? 0 : 1]
      const from = m.getWorldPosition(new THREE.Vector3())
      const dir = new THREE.Vector3(0, -0.08, 1).applyQuaternion(e.group.quaternion).normalize()
      fireProjectile({
        from, dir, speed: 46, grav: 2, faction: 'jun',
        dmg: 30, radius: 3.2, fxLand: 'burstFlare', fxWater: 'areaBang', fxHit: 'burstFlare',
        color: 0xaad8ff,
      })
    }
  }

  function driveBoat(e, keys, dt) {
    const accel = keys.has('KeyW') ? 6 : keys.has('KeyS') ? -4 : 0
    e.speed += accel * dt
    e.speed *= 1 - Math.min(dt * 0.8, 0.9)
    e.speed = THREE.MathUtils.clamp(e.speed, -3, 7)
    if (keys.has('KeyA')) e.yaw += 0.9 * dt
    if (keys.has('KeyD')) e.yaw -= 0.9 * dt
    const p = e.group.position
    const nx = p.x + Math.sin(e.yaw) * e.speed * dt
    const nz = p.z + Math.cos(e.yaw) * e.speed * dt
    if (getHeight(nx, nz) < waterLevel - 0.6) {
      p.x = nx
      p.z = nz
    } else {
      e.speed *= 0.3 // 搁浅减速
    }
    p.y = waterLevel + 0.15 + Math.sin(performance.now() * 0.0016 + 1) * 0.08
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.sin(performance.now() * 0.0013) * 0.02, e.yaw, Math.sin(performance.now() * 0.0011) * 0.03, 'YXZ')
    )
    e.group.quaternion.slerp(q, Math.min(dt * 4, 1))
    e.parts.turret.rotation.y = camAzimuth() - e.yaw
    e.fireCd -= dt
    if ((keys.has('Space') || ctx.mouseFire()) && e.fireCd <= 0) {
      e.fireCd = 1.4
      const from = e.parts.muzzle.getWorldPosition(new THREE.Vector3())
      const dir = new THREE.Vector3(0, 0.3, 1)
        .applyEuler(new THREE.Euler(0, e.yaw + e.parts.turret.rotation.y, 0))
        .normalize()
      fireProjectile({
        from, dir, speed: 32, grav: 10, faction: 'jun',
        dmg: 60, radius: 5.5, fxLand: 'groundExplode', fxWater: 'areaBang', fxHit: 'groundExplode',
        muzzleFx: 'sparkFlare', color: 0xffc890, size: 1.4,
      })
    }
  }

  /* ---------- AI ---------- */

  function nearestEnemy(e, maxDist) {
    let best = null
    let bestD = maxDist
    for (const o of entities) {
      if (!o.alive || o.faction === e.faction) continue
      const d = o.getPos().distanceTo(e.getPos())
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    return best
  }

  function updateAiTank(e, dt) {
    if (!e.alive) return
    const target = nearestEnemy(e, 70)
    // 巡逻/追击
    const goal = target ? target.getPos() : e.waypoint
    const dx = goal.x - e.group.position.x
    const dz = goal.z - e.group.position.z
    const dist = Math.hypot(dx, dz)
    if (!target && dist < 4) e.waypoint.copy(findLandNear(e.spawnPos, 34))
    const wantYaw = Math.atan2(dx, dz)
    let dyaw = wantYaw - e.yaw
    while (dyaw > Math.PI) dyaw -= Math.PI * 2
    while (dyaw < -Math.PI) dyaw += Math.PI * 2
    e.yaw += THREE.MathUtils.clamp(dyaw, -1.0 * dt, 1.0 * dt)
    const wantDist = target ? 26 : 2
    e.speed = dist > wantDist ? 4.5 : 0
    const p = e.group.position
    const nx = p.x + Math.sin(e.yaw) * e.speed * dt
    const nz = p.z + Math.cos(e.yaw) * e.speed * dt
    const ny = getHeight(nx, nz)
    // AI 坦克不下水
    if (ny > waterLevel + 0.25) {
      p.x = nx
      p.z = nz
      p.y = ny
    }
    alignToTerrain(e, dt)
    // 炮塔瞄准 + 开火
    e.aiFireCd -= dt
    if (target) {
      const tp = target.getPos()
      const aim = Math.atan2(tp.x - p.x, tp.z - p.z)
      e.parts.turret.rotation.y = aim - e.yaw
      const d = tp.distanceTo(p)
      if (e.aiFireCd <= 0 && d < 55 && Math.abs(dyaw) < 1.2) {
        e.aiFireCd = 3
        const from = e.parts.muzzle.getWorldPosition(new THREE.Vector3())
        const dir = tp.clone().sub(from)
        dir.y += d * 0.16 // 抛物线补偿
        fireProjectile({
          from, dir, speed: 30, grav: 10, faction: 'jun',
          dmg: 55, radius: 4.5, fxLand: 'groundExplode', fxWater: 'areaBang', fxHit: 'groundExplode',
          color: 0xffe0a0, size: 1.3,
        })
      }
    }
  }

  function updateCultivator(e, dt, now) {
    if (!e.alive) {
      e.respawnTimer -= dt
      if (e.respawnTimer <= 0) {
        e.alive = true
        e.hp = e.maxHp
        e.group.visible = true
        e.parts.label.setHp(1)
        const p = findLandNear(e.anchor, 16)
        e.group.position.set(p.x, p.y + 4, p.z)
        log(`${e.name} 渡劫归来`)
      }
      return
    }
    const target = nearestEnemy(e, 90)
    const p = e.group.position
    const bob = Math.sin(now * 1.7 + e.phase) * 0.5
    let goal
    if (target) {
      // 绕目标游走
      const orbit = 17 + Math.sin(now * 0.4 + e.phase) * 5
      const ang = now * 0.35 + e.phase
      const tp = target.getPos()
      goal = new THREE.Vector3(tp.x + Math.cos(ang) * orbit, 0, tp.z + Math.sin(ang) * orbit)
    } else {
      goal = new THREE.Vector3(
        e.anchor.x + Math.cos(now * 0.25 + e.phase) * 10,
        0,
        e.anchor.z + Math.sin(now * 0.25 + e.phase) * 10
      )
    }
    goal.y = Math.max(getHeight(goal.x, goal.z), waterLevel) + 4 + bob
    p.lerp(goal, Math.min(dt * 0.9, 1))
    if (target) {
      const tp = target.getPos()
      e.group.rotation.y = Math.atan2(tp.x - p.x, tp.z - p.z)
    }
    // 飞剑绕身
    e.parts.sword.position.set(Math.cos(now * 2.2 + e.phase) * 0.85, 1.55 + Math.sin(now * 3 + e.phase) * 0.2, Math.sin(now * 2.2 + e.phase) * 0.85)
    e.parts.sword.rotation.y = -(now * 2.2 + e.phase)

    e.fireCd -= dt
    e.bigCd -= dt
    if (!target) return
    const tp = target.getPos()
    const dist = tp.distanceTo(p)
    if (e.fireCd <= 0 && dist < 60) {
      e.fireCd = 2.4 + Math.random()
      // 剑气：快速直线弹
      const from = e.parts.sword.getWorldPosition(new THREE.Vector3())
      const lead = tp.clone().sub(from).normalize()
      fireProjectile({
        from, dir: lead, speed: 34, grav: 0, faction: 'xiu',
        dmg: 16, radius: 2.2, fxLand: 'burstFlare', fxWater: 'areaBang', fxHit: 'burstFlare',
        color: 0x9fe8ff, ttl: 3.5,
      })
    }
    if (e.bigCd <= 0 && dist < 55) {
      e.bigCd = 10 + Math.random() * 4
      log(`${e.name} 引动气功波！`)
      telegraph(tp, 1.4, 6, (pos) => {
        explode(pos.add(new THREE.Vector3(0, 0.1, 0)), 'xiu', 45, 6, 'bigBang')
      })
    }
  }

  /* ---------- 上下载具 ---------- */

  function tryInteract() {
    if (state.mode !== 'foot') {
      const v = state.vehicle
      // 飞机必须落地才能跳伞下机
      if (v.kind === 'plane' && v.airborne) {
        log('战机飞行中无法下机（减速至失速可降落）')
        return
      }
      const exitPos = findLandNear(v.getPos(), 8)
      player.group.position.copy(exitPos)
      player.group.visible = true
      state.mode = 'foot'
      state.vehicle = null
      log(`离开${v.name}`)
      return
    }
    let best = null
    let bestD = 6
    for (const v of [tank, plane, boat]) {
      if (!v.alive) continue
      const d = v.getPos().distanceTo(player.group.position)
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    if (best) {
      state.mode = best.kind
      state.vehicle = best
      player.group.visible = false
      log(`登上${best.name}｜WASD 驾驶 · 空格/点击开炮${best.kind === 'plane' ? ' · R/F 升降' : ''}`)
    }
  }

  /* ---------- 主更新 ---------- */

  function update(dt, keys) {
    const now = performance.now() / 1000
    // 玩家载具
    if (state.mode === 'tank') driveTank(state.vehicle, keys, dt, true)
    else if (state.mode === 'plane') drivePlane(state.vehicle, keys, dt)
    else if (state.mode === 'boat') driveBoat(state.vehicle, keys, dt)
    // 载具重生
    for (const e of [tank, plane, boat, ...aiTanks]) {
      if (!e.alive) {
        e.respawnTimer -= dt
        if (e.respawnTimer <= 0) {
          e.alive = true
          e.hp = e.maxHp
          e.group.visible = true
          e.group.position.copy(e.spawnPos)
          e.speed = 0
          e.airborne = false
          log(`${e.name} 已重新部署`)
        }
      }
    }
    for (const e of aiTanks) updateAiTank(e, dt)
    for (const e of cultivators) updateCultivator(e, dt, now)
    updateProjectiles(dt)
    updateTelegraphs(dt)
  }

  return {
    state,
    update,
    tryInteract,
    repositionAll,
    explode,
    _debug: { tank, plane, boat, aiTanks, cultivators },
    get mode() {
      return state.mode
    },
    getFocus() {
      if (state.mode === 'foot') return { obj: player.group, height: 1.4 }
      return { obj: state.vehicle.group, height: state.vehicle.kind === 'plane' ? 2 : 2.4 }
    },
  }
}
