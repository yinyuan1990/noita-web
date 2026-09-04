import * as PIXI from 'pixi.js'

/**
 * Kenney Particle Pack � CC0
 * ?? /res/particles/textures/
 *
 * ???explosion dust ray fire electric light snow rain
 * ray = ?????? + ??? head ?????
 */

const TEX_BASE = '/res/particles/textures'

/** ?? ? ?? / ???? */
export const PARTICLE_PRESETS = {
  explosion: {
    textures: ['flame_01.png', 'flame_02.png', 'smoke_05.png', 'spark_03.png', 'flare_01.png'],
    count: 28,
    life: 520,
    speed: [120, 320],
    scale: [0.25, 0.7],
    tint: [0xffaa44, 0xff6622, 0xffee88, 0xffffff],
    gravity: 40,
    blend: 'add',
  },
  dust: {
    textures: ['dirt_01.png', 'dirt_02.png', 'dirt_03.png', 'smoke_01.png', 'smoke_02.png'],
    count: 22,
    life: 700,
    speed: [40, 140],
    scale: [0.2, 0.55],
    tint: [0xc4b49a, 0x8a7a62, 0xd8c8b0],
    gravity: 80,
    blend: 'normal',
  },
  /** ??????? + ??????????? */
  ray: {
    textures: ['flare_01.png', 'light_01.png', 'light_02.png', 'spark_02.png', 'circle_01.png'],
    count: 12,
    life: 420,
    speed: [0, 0],
    scale: [0.35, 0.7],
    tint: [0x7ec8ff, 0xffffff, 0x4aa8ff],
    gravity: 0,
    blend: 'add',
    along: true,
    laser: true,
    head: 'bolt',
    beamWidth: 10,
  },
  fire: {
    textures: ['fire_01.png', 'fire_02.png', 'flame_03.png', 'flame_05.png', 'smoke_04.png'],
    count: 26,
    life: 600,
    speed: [30, 100],
    scale: [0.2, 0.6],
    tint: [0xff6622, 0xffaa33, 0xff4400, 0xffcc66],
    gravity: -90,
    blend: 'add',
  },
  electric: {
    textures: ['spark_01.png', 'spark_04.png', 'spark_06.png', 'slash_01.png', 'magic_02.png'],
    count: 20,
    life: 360,
    speed: [80, 260],
    scale: [0.12, 0.4],
    tint: [0x88ddff, 0xffffff, 0x44aaff, 0xccffff],
    gravity: 0,
    blend: 'add',
    along: true,
  },
  /** ?????????????? + ?? */
  missile: {
    textures: ['circle_05.png', 'light_01.png', 'flare_01.png', 'spark_02.png', 'magic_01.png'],
    count: 10,
    life: 280,
    speed: [0, 0],
    scale: [0.2, 0.4],
    tint: [0x9ec8ff, 0xffffff, 0xc8e0ff],
    gravity: 0,
    blend: 'add',
    missile: true,
  },
  light: {
    textures: ['light_01.png', 'light_02.png', 'light_03.png', 'flare_01.png', 'star_04.png'],
    count: 16,
    life: 500,
    speed: [10, 60],
    scale: [0.3, 0.9],
    tint: [0xfff0c0, 0xffffff, 0xffe080],
    gravity: 0,
    blend: 'add',
  },
  snow: {
    textures: ['circle_01.png', 'circle_02.png', 'star_01.png', 'star_02.png'],
    count: 40,
    life: 1400,
    speed: [20, 60],
    scale: [0.08, 0.22],
    tint: [0xffffff, 0xe8f4ff, 0xd0e8ff],
    gravity: 50,
    blend: 'normal',
    area: [220, 80],
  },
  rain: {
    textures: ['trace_05.png', 'trace_06.png', 'slash_03.png'],
    count: 48,
    life: 700,
    speed: [180, 320],
    scale: [0.08, 0.2],
    tint: [0x88aacc, 0xaaccff, 0xffffff],
    gravity: 280,
    blend: 'normal',
    area: [280, 40],
    rainAngle: true,
  },
}

/**
 * ???? ? ??
 * head: bolt | prism | decay �� ??????
 */
export const BASIC_FX = {
  color_ray: {
    preset: 'ray',
    laser: true,
    head: 'prism',
    tint: [0xff6b8a, 0xffd56b, 0x6bffb0, 0x6bb0ff, 0xc08cff],
    beamWidth: 12,
  },
  decay_ray: {
    preset: 'ray',
    laser: true,
    head: 'decay',
    // ???????????????
    tint: [0x7dff4a, 0xc8ff9a, 0x3a8a22, 0xa8ff60],
    beamWidth: 9,
  },
  magic_missile: {
    preset: 'missile',
    missile: true,
    tint: [0xb8d4ff, 0xffffff, 0x7eb0ff, 0xe8f0ff],
    count: 12,
  },
  curse_hit: { preset: 'light', tint: [0x8a40c0, 0xd090ff, 0xffffff] },
  impact: { preset: 'explosion', tint: [0xffaa55, 0xff6633, 0xffe0a0] },
  blood_flash: { preset: 'dust', tint: [0xaa2030, 0xff4050, 0xff8080] },
  clash_sparks: { preset: 'electric', tint: [0xffee88, 0xffffff], count: 12 },
  explosion: { preset: 'explosion' },
  dust: { preset: 'dust' },
  ray: { preset: 'ray', laser: true, head: 'bolt' },
  fire: { preset: 'fire' },
  electric: { preset: 'electric' },
  light: { preset: 'light' },
  snow: { preset: 'snow' },
  rain: { preset: 'rain' },
}

const _texCache = new Map()

export function isBasicFx(skillKey) {
  return !!(skillKey && (BASIC_FX[skillKey] || PARTICLE_PRESETS[skillKey]))
}

export async function playBasicFx(root, skillKey, pos, opts = {}) {
  const map = BASIC_FX[skillKey] || (PARTICLE_PRESETS[skillKey] ? { preset: skillKey } : null)
  if (!map) return false
  const presetName = map.preset
  const base = PARTICLE_PRESETS[presetName]
  if (!base) return false

  const def = {
    ...base,
    ...map,
    tint: map.tint || base.tint,
    count: opts.count ?? map.count ?? base.count,
    life: opts.ms ?? map.life ?? base.life,
  }

  const textures = await loadTextures(def.textures)
  if (!textures.length) {
    console.warn('[FX] particle textures missing', def.textures)
    return false
  }

  const travel =
    opts.travelMs ??
    (def.missile || def.along || def.laser ? (pos.toX != null ? 380 : 0) : 0)
  console.info('[FX] particle', presetName, '�', skillKey, pos.label || '', def.head || '')

  if (pos.toX != null && (def.missile || def.laser || def.along)) {
    if (def.missile) {
      await playMissile(root, textures, pos.x, pos.y, pos.toX, pos.toY, def, travel, opts)
    } else if (def.laser) {
      // ???????????????????
      await playLaser(root, textures, pos.x, pos.y, pos.toX, pos.toY, def, travel, opts)
    } else {
      await playAlong(root, textures, pos.x, pos.y, pos.toX, pos.toY, def, travel)
    }
    return true
  }
  await playBurst(root, textures, pos.x, pos.y, def, opts)
  return true
}

function loadTextures(names) {
  return Promise.all(names.map((n) => loadTexture(`${TEX_BASE}/${n}`))).then((list) =>
    list.filter(Boolean)
  )
}

function loadTexture(url) {
  if (_texCache.has(url)) return Promise.resolve(_texCache.get(url))
  return new Promise((resolve) => {
    const tex = PIXI.Texture.from(url)
    const done = () => {
      _texCache.set(url, tex)
      resolve(tex)
    }
    if (tex.baseTexture.valid) return done()
    tex.baseTexture.once('loaded', done)
    tex.baseTexture.once('error', () => resolve(null))
  })
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0]
}

function rand(a, b) {
  return a + Math.random() * (b - a)
}

function blendMode(name) {
  return name === 'add' ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL
}

async function playBurst(root, textures, x, y, def, opts = {}) {
  const container = new PIXI.Container()
  root.addChild(container)
  const bodyH = opts.bodyH != null ? opts.bodyH : null
  // ???????????? ? ????
  const [aw, ah] = bodyH
    ? [bodyH * 0.35, bodyH * 0.35]
    : def.area || [0, 0]
  const particles = []
  const n = bodyH ? Math.min(def.count, 16) : def.count
  const tex0 = textures[0]

  for (let i = 0; i < n; i++) {
    const tex = pick(textures)
    const spr = new PIXI.Sprite(tex)
    spr.anchor.set(0.5)
    spr.blendMode = blendMode(def.blend)
    spr.tint = pick(def.tint)
    const sc = bodyH
      ? flareScaleForBody(bodyH, 0.5 * rand(0.35, 0.7), tex || tex0)
      : rand(def.scale[0], def.scale[1])
    spr.scale.set(sc)
    const ox = aw ? (Math.random() - 0.5) * aw : 0
    const oy = ah ? (Math.random() - 0.5) * ah : 0
    spr.x = x + ox
    spr.y = y + oy
    spr.alpha = 0.85 + Math.random() * 0.15
    container.addChild(spr)

    let ang = Math.random() * Math.PI * 2
    let spd = bodyH
      ? bodyH * rand(0.25, 0.7)
      : rand(def.speed[0], def.speed[1])
    if (def.rainAngle) {
      ang = Math.PI * 0.5 + (Math.random() - 0.5) * 0.25
      spd = rand(def.speed[0], def.speed[1])
    }
    particles.push({
      spr,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: def.life * (0.7 + Math.random() * 0.5),
      age: 0,
      spin: (Math.random() - 0.5) * 6,
      sc0: sc,
    })
  }

  // ???? = ???????
  if (bodyH) {
    const flashTex = pick(textures)
    const flash = new PIXI.Sprite(flashTex)
    flash.anchor.set(0.5)
    flash.blendMode = PIXI.BLEND_MODES.ADD
    flash.tint = 0xffffff
    const flashSc = flareScaleForBody(bodyH, 0.5, flashTex)
    flash.scale.set(flashSc)
    flash.x = x
    flash.y = y
    container.addChild(flash)
    particles.push({
      spr: flash,
      vx: 0,
      vy: 0,
      life: Math.min(def.life, 200),
      age: 0,
      spin: 0,
      sc0: flashSc,
    })
  }

  const start = performance.now()
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(40, now - (tick._last || start)) / 1000
      tick._last = now
      let alive = 0
      for (const p of particles) {
        p.age += dt * 1000
        const t = p.age / p.life
        if (t >= 1) {
          p.spr.visible = false
          continue
        }
        alive++
        p.vy += def.gravity * dt
        p.spr.x += p.vx * dt
        p.spr.y += p.vy * dt
        p.spr.rotation += p.spin * dt
        p.spr.alpha = (1 - t) * 0.9
        p.spr.scale.set(p.sc0 * (1 + t * 0.4))
      }
      if (alive > 0 && now - start < def.life + 200) requestAnimationFrame(tick)
      else {
        if (container.parent) container.parent.removeChild(container)
        container.destroy({ children: true })
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

/**
 * ?????? + ?????/??????????? bodyH ??
 * - bolt / prism / decay
 */
async function playLaser(root, textures, x0, y0, x1, y1, def, travelMs, opts = {}) {
  const container = new PIXI.Container()
  root.addChild(container)

  const beamGfx = new PIXI.Graphics()
  container.addChild(beamGfx)

  const headStyle = def.head || 'bolt'
  const tints = def.tint || [0x7ec8ff, 0xffffff]
  const coreTint = tints[tints.length - 1] || 0xffffff
  const bodyH = Math.max(48, opts.bodyH != null ? opts.bodyH : 150)
  const beamW = Math.max(3, bodyH * 0.045)
  const ang = Math.atan2(y1 - y0, x1 - x0)
  // ???????????????????? tip??????
  const holdMs =
    opts.holdMs != null ? opts.holdMs : def.life != null ? def.life : 420
  const texRef = textures[0]
  const u = (frac) => flareScaleForBody(bodyH, frac, texRef)

  const muzzle = makeFlare(textures, tints[0] || coreTint, u(0.28))
  muzzle.x = x0
  muzzle.y = y0
  container.addChild(muzzle)

  const headOuter = makeFlare(textures, tints[0] || coreTint, u(headStyle === 'prism' ? 0.42 : 0.36))
  const headCore = makeFlare(textures, 0xffffff, u(headStyle === 'bolt' ? 0.22 : 0.18))
  const headRing = makeFlare(textures, tints[1] || coreTint, u(0.3))
  headRing.visible = headStyle === 'decay' || headStyle === 'prism'
  container.addChild(headOuter)
  container.addChild(headCore)
  container.addChild(headRing)

  const sparks = []
  const start = performance.now()
  const total = travelMs + holdMs

  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      const elapsed = now - start
      const tFly = Math.min(1, elapsed / Math.max(1, travelMs))
      const ease = 1 - Math.pow(1 - tFly, 2)
      const hit = tFly >= 1
      // ?? tip ?????? tip ?????????
      const hx = hit ? x1 : x0 + (x1 - x0) * ease
      const hy = hit ? y1 : y0 + (y1 - y0) * ease
      const fade = hit
        ? Math.max(0, 1 - (elapsed - travelMs) / Math.max(1, holdMs))
        : 0.55 + tFly * 0.45

      const pulse = 0.85 + Math.sin(elapsed * 0.03) * 0.15
      let headTint = coreTint
      if (headStyle === 'prism') {
        headTint = tints[((elapsed / 70) | 0) % tints.length]
      } else if (headStyle === 'decay') {
        headTint = tints[((elapsed / 90) | 0) % tints.length]
      }

      drawLaserBeam(beamGfx, x0, y0, hx, hy, {
        width: beamW * pulse,
        tints,
        style: headStyle,
        time: elapsed,
        alpha: fade,
        bodyH,
      })

      headOuter.x = hx
      headOuter.y = hy
      headCore.x = hx
      headCore.y = hy
      headRing.x = hx
      headRing.y = hy
      headOuter.rotation = ang
      headCore.rotation = ang + elapsed * 0.008
      headRing.rotation = -ang + elapsed * 0.012

      const headPulse = headHeadScale(headStyle, elapsed, Math.min(1, tFly), u)
      headOuter.tint = headTint
      headOuter.scale.set(headPulse.outer)
      headCore.scale.set(headPulse.core)
      headCore.tint = headStyle === 'bolt' ? 0xffffff : headTint
      headRing.tint = headTint
      headRing.scale.set(headPulse.ring)
      headOuter.alpha = fade
      headCore.alpha = fade
      headRing.alpha =
        (headStyle === 'decay' ? 0.55 + Math.sin(elapsed * 0.02) * 0.25 : 0.7) * fade
      headRing.visible = headStyle === 'decay' || headStyle === 'prism'

      muzzle.scale.set(u(0.22) * (0.9 + pulse * 0.2))
      muzzle.tint = headTint
      muzzle.alpha = (0.7 + pulse * 0.25) * (hit ? fade : 1)
      muzzle.rotation += 0.08

      if (!hit && sparks.length < def.count + 8 && Math.random() < 0.55) {
        spawnHeadSpark(container, textures, sparks, hx, hy, ang, headTint, headStyle, bodyH)
      }

      if (hit && !tick._hit) {
        tick._hit = true
        impactHead(container, textures, sparks, x1, y1, tints, headStyle, false, bodyH)
        try {
          opts.onHit?.()
        } catch (e) {
          void e
        }
      }

      const dt = 1 / 60
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]
        p.age += dt * 1000
        const t = p.age / p.life
        if (t >= 1) {
          if (p.spr.parent) p.spr.parent.removeChild(p.spr)
          p.spr.destroy()
          sparks.splice(i, 1)
          continue
        }
        p.spr.x += p.vx * dt
        p.spr.y += p.vy * dt
        p.vx *= 0.96
        p.vy *= 0.96
        p.spr.alpha = (1 - t) * 0.95
        p.spr.scale.set(p.sc0 * (1 + t * 0.25))
      }

      if (elapsed <= total || sparks.length) {
        requestAnimationFrame(tick)
      } else {
        if (container.parent) container.parent.removeChild(container)
        container.destroy({ children: true })
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

/** ?? scale?????? ? bodyH � fraction????????? */
function flareScaleForBody(bodyH, fraction, tex) {
  const tw = Math.max(32, tex?.width || tex?.orig?.width || 256)
  return Math.max(0.06, (bodyH * fraction) / tw)
}

function makeFlare(textures, tint, scale) {
  const spr = new PIXI.Sprite(pick(textures))
  spr.anchor.set(0.5)
  spr.blendMode = PIXI.BLEND_MODES.ADD
  spr.tint = tint
  spr.scale.set(scale)
  return spr
}

function headHeadScale(style, elapsed, tFly, u) {
  const breathe = 1 + Math.sin(elapsed * 0.04) * 0.1
  const grow = 0.75 + tFly * 0.35
  if (style === 'prism') {
    return {
      outer: u(0.4) * grow * breathe,
      core: u(0.2) * grow * breathe,
      ring: u(0.48) * grow * (0.85 + Math.sin(elapsed * 0.06) * 0.15),
    }
  }
  if (style === 'decay') {
    return {
      outer: u(0.36) * grow * (0.9 + Math.sin(elapsed * 0.05) * 0.15),
      core: u(0.16) * grow,
      ring: u(0.5) * grow * breathe,
    }
  }
  return {
    outer: u(0.34) * grow * breathe,
    core: u(0.18) * grow,
    ring: u(0.22),
  }
}

function drawLaserBeam(g, x0, y0, x1, y1, opt) {
  g.clear()
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 2) return
  const nxU = -dy / len
  const nyU = dx / len
  const w = opt.width
  const alpha = opt.alpha != null ? opt.alpha : 1
  const tints = opt.tints || [0x7ec8ff]
  const style = opt.style || 'bolt'
  const time = opt.time || 0
  const segs = Math.max(8, Math.min(28, (len / 34) | 0))
  // ??????????????
  const amp =
    (opt.bodyH || 150) * (style === 'decay' ? 0.05 : style === 'prism' ? 0.02 : 0.03)

  // ????????????????sin ????????
  const ptsAt = (jitterScale, phase) => {
    const pts = []
    for (let i = 0; i <= segs; i++) {
      const u = i / segs
      const env = Math.sin(u * Math.PI)
      const off =
        (Math.sin(u * 14 + time * 0.026 + phase) +
          Math.sin(u * 23 - time * 0.031 + phase * 1.7) * 0.5) *
        amp *
        jitterScale *
        env
      pts.push([x0 + dx * u + nxU * off, y0 + dy * u + nyU * off])
    }
    return pts
  }
  const stroke = (pts, width, color, a) => {
    g.lineStyle(width, color, a)
    g.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1])
  }

  // ?????????
  g.lineStyle(w * 2.6, tints[0], 0.16 * alpha)
  g.moveTo(x0, y0)
  g.lineTo(x1, y1)

  if (style === 'prism') {
    // ?????????????
    const pts = ptsAt(0.6, 0)
    const shift = (time / 90) | 0
    for (let i = 0; i < segs; i++) {
      const c = tints[(i + shift) % tints.length]
      g.lineStyle(w * 1.3, c, 0.6 * alpha)
      g.moveTo(pts[i][0], pts[i][1])
      g.lineTo(pts[i + 1][0], pts[i + 1][1])
    }
  } else {
    stroke(ptsAt(1, 0), w * 1.5, tints[0], 0.55 * alpha)
    if (style === 'decay') {
      // ?????????????
      stroke(ptsAt(1.7, 2.1), Math.max(1.5, w * 0.6), tints[1] || tints[0], 0.5 * alpha)
    }
  }

  // ??????
  stroke(ptsAt(0.35, 1.3), Math.max(2, w * 0.4), 0xffffff, 0.95 * alpha)

  // ???????????????
  const pulses = 3
  for (let k = 0; k < pulses; k++) {
    const u = (time * 0.0009 + k / pulses) % 1
    g.lineStyle(0)
    g.beginFill(0xffffff, 0.45 * alpha)
    g.drawCircle(x0 + dx * u, y0 + dy * u, Math.max(2.5, w * 0.65))
    g.endFill()
  }
}

function spawnHeadSpark(container, textures, sparks, x, y, ang, tint, style, bodyH = 150) {
  const tex = pick(textures)
  const spr = new PIXI.Sprite(tex)
  spr.anchor.set(0.5)
  spr.blendMode = PIXI.BLEND_MODES.ADD
  spr.tint = tint
  const frac = style === 'prism' ? rand(0.08, 0.14) : rand(0.06, 0.11)
  const sc = flareScaleForBody(bodyH, frac, tex)
  spr.scale.set(sc)
  spr.x = x
  spr.y = y
  container.addChild(spr)
  const spread = style === 'decay' ? 1.4 : 0.7
  const spd = bodyH * (0.25 + Math.random() * 0.55)
  const a = ang + (Math.random() - 0.5) * spread
  sparks.push({
    spr,
    vx: Math.cos(a) * spd,
    vy: Math.sin(a) * spd,
    life: 180 + Math.random() * 220,
    age: 0,
    sc0: sc,
  })
}

/** ???????? 0.38�?????????? */
/** ??????? = ??????? */
function impactHead(container, textures, sparks, x, y, tints, style, _shatter, bodyH = 150) {
  const n = style === 'prism' ? 10 : 8
  for (let i = 0; i < n; i++) {
    const tex = pick(textures)
    const spr = new PIXI.Sprite(tex)
    spr.anchor.set(0.5)
    spr.blendMode = PIXI.BLEND_MODES.ADD
    spr.tint = tints[i % tints.length]
    const sc = flareScaleForBody(bodyH, 0.5 * rand(0.35, 0.55), tex)
    spr.scale.set(sc)
    spr.x = x
    spr.y = y
    container.addChild(spr)
    const a = Math.random() * Math.PI * 2
    const spd = bodyH * (0.2 + Math.random() * 0.35)
    sparks.push({
      spr,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 160,
      age: 0,
      sc0: sc,
    })
  }
  const flashTex = pick(textures)
  const flash = new PIXI.Sprite(flashTex)
  flash.anchor.set(0.5)
  flash.blendMode = PIXI.BLEND_MODES.ADD
  flash.tint = 0xffffff
  const flashSc = flareScaleForBody(bodyH, 0.5, flashTex)
  flash.scale.set(flashSc)
  flash.x = x
  flash.y = y
  container.addChild(flash)
  sparks.push({
    spr: flash,
    vx: 0,
    vy: 0,
    life: 120,
    age: 0,
    sc0: flashSc,
  })
}

/**
 * ???????????????? = bodyH � 0.5
 */
async function playMissile(root, textures, x0, y0, x1, y1, def, travelMs, opts = {}) {
  const container = new PIXI.Container()
  root.addChild(container)

  const bodyH = Math.max(48, opts.bodyH != null ? opts.bodyH : 150)
  const tints = def.tint || [0x9ec8ff, 0xffffff]
  const shots = Math.max(1, opts.shots != null ? opts.shots : 1)
  const stagger = opts.staggerMs != null ? opts.staggerMs : 90
  const hold = def.life != null ? def.life : 280

  const runOne = (delay, arcSign) =>
    new Promise((resolve) => {
      setTimeout(() => {
        const local = new PIXI.Container()
        container.addChild(local)
        const texOrb = pick(textures)
        const orb = new PIXI.Sprite(texOrb)
        orb.anchor.set(0.5)
        orb.blendMode = PIXI.BLEND_MODES.ADD
        orb.tint = tints[0]
        const orbSc = flareScaleForBody(bodyH, 0.22, texOrb)
        orb.scale.set(orbSc)
        orb.x = x0
        orb.y = y0
        local.addChild(orb)

        const glow = new PIXI.Sprite(pick(textures))
        glow.anchor.set(0.5)
        glow.blendMode = PIXI.BLEND_MODES.ADD
        glow.tint = tints[1] || 0xffffff
        glow.scale.set(orbSc * 1.35)
        glow.alpha = 0.65
        glow.x = x0
        glow.y = y0
        local.addChildAt(glow, 0)

        const trail = []
        const start = performance.now()
        const dx = x1 - x0
        const dy = y1 - y0
        // ????????????
        const arc = Math.hypot(dx, dy) * 0.12 * arcSign

        const tick = () => {
          const now = performance.now()
          const elapsed = now - start
          const t = Math.min(1, elapsed / Math.max(1, travelMs))
          const ease = t * t * (3 - 2 * t) // smoothstep
          const px = x0 + dx * ease
          const py = y0 + dy * ease - Math.sin(ease * Math.PI) * arc

          orb.x = px
          orb.y = py
          orb.rotation += 0.15
          orb.scale.set(orbSc * (0.95 + Math.sin(elapsed * 0.04) * 0.08))
          orb.tint = tints[((elapsed / 60) | 0) % tints.length]
          glow.x = px
          glow.y = py
          glow.scale.set(orbSc * 1.4 * (0.9 + Math.sin(elapsed * 0.05) * 0.12))
          glow.alpha = 0.5 + Math.sin(elapsed * 0.03) * 0.15

          // ??????????
          if (t < 1 && Math.random() < 0.7) {
            const tex = pick(textures)
            const spr = new PIXI.Sprite(tex)
            spr.anchor.set(0.5)
            spr.blendMode = PIXI.BLEND_MODES.ADD
            spr.tint = pick(tints)
            const sc = flareScaleForBody(bodyH, rand(0.06, 0.12), tex)
            spr.scale.set(sc)
            spr.x = px + (Math.random() - 0.5) * 6
            spr.y = py + (Math.random() - 0.5) * 6
            spr.alpha = 0.75
            local.addChild(spr)
            trail.push({ spr, age: 0, life: 160 + Math.random() * 100, sc0: sc })
          }

          const dt = 1 / 60
          for (let i = trail.length - 1; i >= 0; i--) {
            const p = trail[i]
            p.age += dt * 1000
            const u = p.age / p.life
            if (u >= 1) {
              if (p.spr.parent) p.spr.parent.removeChild(p.spr)
              p.spr.destroy()
              trail.splice(i, 1)
              continue
            }
            p.spr.alpha = (1 - u) * 0.7
            p.spr.scale.set(p.sc0 * (1 - u * 0.4))
          }

          if (t < 1) {
            requestAnimationFrame(tick)
            return
          }

          // ??????? ? ?????????
          orb.visible = false
          glow.visible = false
          try {
            opts.onHit?.()
          } catch (e) {
            void e
          }
          for (let i = 0; i < 8; i++) {
            const tex = pick(textures)
            const spr = new PIXI.Sprite(tex)
            spr.anchor.set(0.5)
            spr.blendMode = PIXI.BLEND_MODES.ADD
            spr.tint = tints[i % tints.length]
            const sc = flareScaleForBody(bodyH, 0.5 * rand(0.35, 0.55), tex)
            spr.scale.set(sc)
            spr.x = x1
            spr.y = y1
            local.addChild(spr)
            const a = Math.random() * Math.PI * 2
            const spd = bodyH * (0.2 + Math.random() * 0.35)
            trail.push({
              spr,
              age: 0,
              life: 220 + Math.random() * 120,
              sc0: sc,
              vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd,
            })
          }
          // ??? = ??????
          const flashTex = pick(textures)
          const flash = new PIXI.Sprite(flashTex)
          flash.anchor.set(0.5)
          flash.blendMode = PIXI.BLEND_MODES.ADD
          flash.tint = 0xffffff
          const flashSc = flareScaleForBody(bodyH, 0.5, flashTex)
          flash.scale.set(flashSc)
          flash.x = x1
          flash.y = y1
          local.addChild(flash)
          trail.push({ spr: flash, age: 0, life: 160, sc0: flashSc })

          const hitStart = performance.now()
          const hitTick = () => {
            const he = performance.now() - hitStart
            for (let i = trail.length - 1; i >= 0; i--) {
              const p = trail[i]
              p.age += 1000 / 60
              const u = p.age / p.life
              if (u >= 1) {
                if (p.spr.parent) p.spr.parent.removeChild(p.spr)
                p.spr.destroy()
                trail.splice(i, 1)
                continue
              }
              if (p.vx != null) {
                p.spr.x += p.vx / 60
                p.spr.y += p.vy / 60
                p.vx *= 0.94
                p.vy *= 0.94
              }
              p.spr.alpha = (1 - u) * 0.85
              p.spr.scale.set(p.sc0 * (1 + u * 0.3))
            }
            if (he < hold && trail.length) requestAnimationFrame(hitTick)
            else {
              if (local.parent) local.parent.removeChild(local)
              local.destroy({ children: true })
              resolve()
            }
          }
          requestAnimationFrame(hitTick)
        }
        requestAnimationFrame(tick)
      }, delay)
    })

  const jobs = []
  for (let i = 0; i < shots; i++) {
    const sign = shots === 1 ? 1 : i % 2 === 0 ? 1 : -1
    jobs.push(runOne(i * stagger, sign))
  }
  await Promise.all(jobs)
  if (container.parent) container.parent.removeChild(container)
  container.destroy({ children: true })
}

/** ?????????????? */
async function playAlong(root, textures, x0, y0, x1, y1, def, travelMs) {
  const container = new PIXI.Container()
  root.addChild(container)
  const start = performance.now()
  const total = travelMs + def.life * 0.45
  const particles = []

  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      const elapsed = now - start
      const tBeam = Math.min(1, elapsed / Math.max(1, travelMs))
      const headX = x0 + (x1 - x0) * tBeam
      const headY = y0 + (y1 - y0) * tBeam

      if (elapsed < travelMs + 80 && particles.length < def.count * 2) {
        for (let k = 0; k < 2; k++) {
          const u = Math.random() * tBeam
          const spr = new PIXI.Sprite(pick(textures))
          spr.anchor.set(0.5)
          spr.blendMode = blendMode(def.blend)
          spr.tint = pick(def.tint)
          const sc = rand(def.scale[0], def.scale[1])
          spr.scale.set(sc)
          spr.x = x0 + (headX - x0) * u + (Math.random() - 0.5) * 12
          spr.y = y0 + (headY - y0) * u + (Math.random() - 0.5) * 12
          spr.rotation = Math.atan2(y1 - y0, x1 - x0)
          container.addChild(spr)
          particles.push({
            spr,
            vx: (Math.random() - 0.5) * 40,
            vy: (Math.random() - 0.5) * 40,
            life: def.life * 0.5,
            age: 0,
            sc0: sc,
          })
        }
      }

      if (tBeam >= 1 && !tick._hit) {
        tick._hit = true
        for (let i = 0; i < 8; i++) {
          const spr = new PIXI.Sprite(pick(textures))
          spr.anchor.set(0.5)
          spr.blendMode = blendMode(def.blend)
          spr.tint = pick(def.tint)
          const sc = rand(def.scale[0], def.scale[1]) * 1.2
          spr.scale.set(sc)
          spr.x = x1
          spr.y = y1
          container.addChild(spr)
          const a = Math.random() * Math.PI * 2
          const spd = 60 + Math.random() * 140
          particles.push({
            spr,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            life: def.life * 0.6,
            age: 0,
            sc0: sc,
          })
        }
      }

      const dt = 1 / 60
      let alive = 0
      for (const p of particles) {
        p.age += dt * 1000
        const t = p.age / p.life
        if (t >= 1) {
          p.spr.visible = false
          continue
        }
        alive++
        p.spr.x += p.vx * dt
        p.spr.y += p.vy * dt
        p.spr.alpha = 1 - t
      }

      if (elapsed < total || alive > 0) requestAnimationFrame(tick)
      else {
        if (container.parent) container.parent.removeChild(container)
        container.destroy({ children: true })
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

export function listParticlePresets() {
  return Object.keys(PARTICLE_PRESETS)
}
