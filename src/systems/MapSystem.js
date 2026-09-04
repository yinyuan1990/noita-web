import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT, DEFAULT_SLOTS } from '../config.js'
import { STAGES } from '../stages/stages.js'

/**
 * 地图系统
 * - battle / pack：M387 回合制背景（远 / 中 / 近）
 * - tile / iso25：旧程序生成（备用）
 */
export class MapSystem {
  constructor(game) {
    this.game = game
    this.root = new PIXI.Container()
    this.game.mapLayer.addChild(this.root)

    this.farLayer = new PIXI.Container()
    this.midLayer = new PIXI.Container()
    this.nearLayer = new PIXI.Container()
    this.root.addChild(this.farLayer, this.midLayer, this.nearLayer)

    this.stageId = null
    this.stageCfg = null
    this.spawns = new Map(Object.entries(DEFAULT_SLOTS).map(([k, v]) => [k, { ...v }]))
    this._scrollX = 0
    this._stageWidth = DESIGN_WIDTH
    this._screenCount = 1
    this._startScreen = 0
    this._pivotX = DESIGN_WIDTH / 2
    this._mode = 'battle'
    this._iso = null
  }

  get stageWidth() {
    return this._stageWidth
  }

  get stageCenterX() {
    return this._pivotX
  }

  get screenCount() {
    return this._screenCount
  }

  get mode() {
    return this._mode
  }

  /** 单屏固定战场（回合制） */
  get isFixedArena() {
    return this._mode === 'battle' || this._mode === 'pack' || this._mode === 'iso25' || this._mode === 'arena25'
  }

  screenCenterX(index = 0) {
    const i = Math.max(0, Math.min(this._screenCount - 1, index))
    return i * DESIGN_WIDTH + DESIGN_WIDTH / 2
  }

  cameraBounds(zoom = 1) {
    const half = DESIGN_WIDTH / (2 * Math.max(0.5, zoom))
    const min = half
    const max = Math.max(min, this._stageWidth - half)
    return { min, max, half }
  }

  clampCameraX(x, zoom = 1) {
    if (this.isFixedArena) return this._pivotX
    const { min, max } = this.cameraBounds(zoom)
    return Math.max(min, Math.min(max, x))
  }

  getSpawn(name) {
    return this.spawns.get(name) || DEFAULT_SLOTS.center
  }

  get groundY() {
    return (this.stageCfg && this.stageCfg.groundY) || DESIGN_HEIGHT * 0.82
  }

  async load(mapUrlOrId, { force = false } = {}) {
    let id = mapUrlOrId
    if (String(mapUrlOrId).includes('/') || String(mapUrlOrId).endsWith('.json')) {
      id = 'cave_tunnel'
    }
    const cfg = STAGES[id] || STAGES.cave_tunnel
    if (!force && this.stageId === cfg.id && this.midLayer.children.length > 0) {
      this._applySlots(cfg)
      this._hud(cfg)
      return this.root
    }
    this.stageId = cfg.id
    this.stageCfg = cfg
    this._mode = cfg.mode || (cfg.pack ? 'battle' : cfg.iso ? 'iso25' : cfg.tile ? 'tile' : 'battle')
    this._iso = null

    this.farLayer.removeChildren()
    this.midLayer.removeChildren()
    this.nearLayer.removeChildren()

    if (cfg.pack || cfg.mode === 'battle' || cfg.mode === 'pack') {
      await this._paintPack(cfg)
    } else if (cfg.tile) {
      const { paintCaveTileMap } = await import('../maps/CaveTileBuilder.js')
      const renderer = this.game.app.renderer
      const tile = cfg.tile || {}
      const info = paintCaveTileMap(
        renderer,
        { far: this.farLayer, mid: this.midLayer, near: this.nearLayer },
        {
          screens: tile.screens != null ? tile.screens : 1,
          seed: tile.seed != null ? tile.seed : 7,
          groundRow: tile.groundRow,
        }
      )
      this._stageWidth = info.stageWidth
      this._screenCount = Math.max(1, Math.round(info.stageWidth / DESIGN_WIDTH))
      this._startScreen = cfg.startScreen || 0
      this._pivotX = this.screenCenterX(this._startScreen)
      this._mode = 'tile'
      cfg.groundY = info.groundY
      cfg.width = this._stageWidth
    } else {
      await this._paintPack(cfg)
    }

    this._applySlots(cfg)
    this.setScroll(this._pivotX)
    this._hud(cfg)
    // 切台：恢复冻结基准，防上一场人潮把人缩成点
    if (cfg.formation) {
      if (cfg.formation.humanRatioBase == null) {
        cfg.formation.humanRatioBase =
          cfg.formation.humanRatio != null
            ? cfg.formation.humanRatio
            : undefined
      }
      if (cfg.formation.humanRatioBase != null) {
        cfg.formation.humanRatio = cfg.formation.humanRatioBase
      }
    }
    this.game.director?.position?.resetCrowdBase?.()
    this.game.chars?.resyncWorldScale?.()

    if (this.game.camera) {
      this.game.camera.unlock?.()
      this.game.camera.cut({
        x: this._pivotX,
        y: DESIGN_HEIGHT * 0.5,
        zoom: 1,
      })
      if (this.isFixedArena) {
        this.game.camera.lock?.({ x: this._pivotX, y: DESIGN_HEIGHT * 0.5, zoom: 1 })
      }
    }
    return this.root
  }

  setScroll(cameraWorldX) {
    this._scrollX = cameraWorldX
    if (this.isFixedArena) {
      this.farLayer.x = 0
      this.midLayer.x = 0
      this.nearLayer.x = 0
      return
    }
    const p = (this.stageCfg && this.stageCfg.parallax) || { far: 0.35, mid: 1, near: 1.08 }
    const dx = cameraWorldX - this._pivotX
    const slack = Math.max(0, (this._stageWidth - DESIGN_WIDTH) * 0.45)
    this.farLayer.x = clamp(dx * (1 - (p.far ?? 0.35)), -slack, slack)
    this.midLayer.x = 0
    this.nearLayer.x = clamp(dx * (1 - (p.near ?? 1.08)), -slack, slack)
  }

  _applySlots(cfg) {
    const baseX = (this._startScreen || 0) * DESIGN_WIDTH
    this.spawns = new Map()
    const slots = cfg.slots || {}
    for (const [name, s] of Object.entries(slots)) {
      const nx = typeof s.x === 'number' && s.x <= 1.5 ? s.x : s.x / DESIGN_WIDTH
      const ny =
        typeof s.y === 'number' && s.y <= 1.5 ? s.y : s.y != null ? s.y / DESIGN_HEIGHT : null
      const y = ny != null ? ny * DESIGN_HEIGHT : cfg.groundY || this.groundY
      this.spawns.set(name, { x: baseX + nx * DESIGN_WIDTH, y })
    }
    for (const [k, v] of Object.entries(DEFAULT_SLOTS)) {
      if (!this.spawns.has(k)) {
        this.spawns.set(k, {
          x: baseX + (v.x / DESIGN_WIDTH) * DESIGN_WIDTH,
          y: v.y,
        })
      }
    }
  }

  /**
   * M387 回合制背景：
   * far  = 暗底氛围
   * mid  = floor 主画面（cover 铺满）
   * near = front / font 前景遮挡
   */
  async _paintPack(cfg) {
    const pack = cfg.pack
    if (!pack) throw new Error(`[Map] stage ${cfg.id} missing pack`)
    const base = pack.dir.replace(/\/$/, '')
    const floors = resolveFloors(pack)
    if (!floors.length) throw new Error(`[Map] no floors in pack ${pack.dir}`)

    this._screenCount = Math.max(1, floors.length)
    this._startScreen = cfg.startScreen || 0
    this._stageWidth = DESIGN_WIDTH * this._screenCount
    this._pivotX = this.screenCenterX(this._startScreen)
    this._mode = 'battle'
    this._iso = null

    const nativeH = pack.nativeH || 640
    const gNative = pack.groundNativeY != null ? pack.groundNativeY : nativeH * 0.78
    cfg.groundY = (gNative / nativeH) * DESIGN_HEIGHT
    cfg.width = this._stageWidth

    // —— 远：深色底 + 轻雾，垫在 floor 后 ——
    const far = new PIXI.Graphics()
    far.beginFill(0x07080c)
    far.drawRect(0, 0, this._stageWidth, DESIGN_HEIGHT)
    far.endFill()
    for (let i = 0; i < 6; i++) {
      far.beginFill(0x14182a, 0.06 + i * 0.02)
      far.drawEllipse(
        DESIGN_WIDTH * 0.5,
        DESIGN_HEIGHT * (0.22 + i * 0.04),
        DESIGN_WIDTH * (0.7 - i * 0.05),
        70 - i * 6
      )
      far.endFill()
    }
    this.farLayer.addChild(far)

    // —— 中：floor ——
    let midCoverScale = null
    for (let i = 0; i < floors.length; i++) {
      const tex = await loadTexture(`${base}/${floors[i]}`)
      const spr = fitSprite(tex, pack.fit || 'cover')
      if (midCoverScale == null) {
        midCoverScale = Math.max(
          DESIGN_WIDTH / Math.max(1, tex.width),
          DESIGN_HEIGHT / Math.max(1, tex.height)
        )
      }
      spr.x += i * DESIGN_WIDTH
      this.midLayer.addChild(spr)
    }

    // —— 近：只做贴边小饰，绝不铺满挡主地板 ——
    // pack.near=false 可关；默认高度 ≤ 屏高 14%
    if (pack.near && pack.near !== false) {
      try {
        const tex = await loadTexture(`${base}/${pack.near}`)
        for (let i = 0; i < floors.length; i++) {
          const spr = fitNearSprite(tex, {
            maxH: pack.nearMaxH != null ? pack.nearMaxH : 0.14,
            // 近景不再跟 mid cover 同尺度（会过大），只按高度上限
            preferScale: null,
            align: 'center',
          })
          spr.x += i * DESIGN_WIDTH
          spr.alpha = pack.nearAlpha != null ? pack.nearAlpha : 0.55
          this.nearLayer.addChild(spr)
        }
      } catch (e) {
        console.warn('[Map] near skip', e && e.message)
      }
    }

    for (const prop of pack.nearProps || []) {
      try {
        const tex = await loadTexture(`${base}/${prop.file}`)
        const spr = fitNearSprite(tex, {
          maxH: prop.h != null ? prop.h : 0.14,
          preferScale: null,
          align: prop.side || 'left',
          stageWidth: this._stageWidth,
          // 侧饰再压窄，避免挡站位区
          maxW: prop.maxW != null ? prop.maxW : 0.22,
        })
        spr.alpha = prop.alpha != null ? prop.alpha : 0.5
        this.nearLayer.addChild(spr)
      } catch (e) {
        console.warn('[Map] nearProp skip', prop.file, e && e.message)
      }
    }

    // 不再加上下左右暗角 / vignette，避免画面四边发黑
  }

  _hud(cfg) {
    const el = document.getElementById('hud-map')
    if (el) {
      const mode =
        this._mode === 'battle' || this._mode === 'pack'
          ? '远中近'
          : this._mode === 'iso25'
            ? 'ISO45°'
            : this._mode === 'tile'
              ? 'TILE'
              : this._mode.toUpperCase()
      el.textContent = `STAGE ${cfg.label || cfg.id} · ${mode}`
    }
  }
}

function resolveFloors(pack) {
  if (Array.isArray(pack.floors) && pack.floors.length) return pack.floors
  const list = []
  if (pack.mid || pack.floor) list.push(pack.mid || pack.floor)
  if (pack.floor2) list.push(pack.floor2)
  return list
}

/** cover：铺满画布裁切；contain：完整显示留边 */
function fitSprite(tex, fit = 'cover') {
  const spr = new PIXI.Sprite(tex)
  const tw = tex.width
  const th = tex.height
  const sx = DESIGN_WIDTH / tw
  const sy = DESIGN_HEIGHT / th
  const s = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy)
  spr.scale.set(s)
  spr.x = (DESIGN_WIDTH - tw * s) / 2
  // 偏下对齐：脚底地面更贴近角色站位带
  if (fit === 'cover' && th * s > DESIGN_HEIGHT) {
    spr.y = DESIGN_HEIGHT - th * s
  } else {
    spr.y = (DESIGN_HEIGHT - th * s) / 2
  }
  return spr
}

/**
 * 近景：贴边小饰
 * 以高度上限为主缩放；可选 maxW 限制宽度，避免挡主地板/站位
 */
function fitNearSprite(tex, opts = {}) {
  const tw = Math.max(1, tex.width)
  const th = Math.max(1, tex.height)
  const maxH = DESIGN_HEIGHT * (opts.maxH != null ? opts.maxH : 0.14)
  const maxW = DESIGN_WIDTH * (opts.maxW != null ? opts.maxW : 0.55)
  let s = opts.preferScale != null ? opts.preferScale : maxH / th
  if (th * s > maxH) s = maxH / th
  if (tw * s > maxW) s = maxW / tw

  const spr = new PIXI.Sprite(tex)
  spr.scale.set(s)
  spr.y = DESIGN_HEIGHT - th * s

  const stageW = opts.stageWidth != null ? opts.stageWidth : DESIGN_WIDTH
  const w = tw * s
  const align = opts.align || 'center'
  if (align === 'right') spr.x = stageW - w
  else if (align === 'left') spr.x = 0
  else spr.x = (DESIGN_WIDTH - w) / 2
  return spr
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const tex = PIXI.Texture.from(url)
    if (tex.baseTexture.valid) return resolve(tex)
    const ok = () => {
      cleanup()
      resolve(tex)
    }
    const bad = () => {
      cleanup()
      reject(new Error(url))
    }
    const cleanup = () => {
      tex.baseTexture.off('loaded', ok)
      tex.baseTexture.off('error', bad)
    }
    tex.baseTexture.once('loaded', ok)
    tex.baseTexture.once('error', bad)
  })
}
