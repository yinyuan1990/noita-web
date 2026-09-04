import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config.js'
import { CAMERA_POLICY, clampZoom } from '../director/formations.js'

/**
 * 镜头系统（稳：少动、小变焦、默认可锁）
 */
export class CameraSystem {
  constructor(game) {
    this.game = game
    this.root = new PIXI.Container()
    this.game.app.stage.addChild(this.root)

    this.x = DESIGN_WIDTH / 2
    this.y = DESIGN_HEIGHT * 0.48
    this.zoom = 1
    this._followIds = null
    this._followZoom = null
    this._shake = 0
    this._tween = null
    /** 对话锁镜：锁定期间 ignore 自动 focus */
    this.locked = false
    this._lockFrame = null
  }

  attach(layers) {
    for (const layer of layers) {
      if (layer.parent) layer.parent.removeChild(layer)
      this.root.addChild(layer)
    }
    this.apply()
  }

  /** 锁住当前（或指定）构图，对话期间不再晃 */
  lock(opts = {}) {
    this.locked = true
    this._lockFrame = {
      x: opts.x != null ? opts.x : this.x,
      y: opts.y != null ? opts.y : this.y,
      zoom: clampZoom(opts.zoom != null ? opts.zoom : this.zoom),
    }
    this.stopFollow()
    this.cut(this._lockFrame)
  }

  unlock() {
    this.locked = false
    this._lockFrame = null
  }

  apply() {
    const z = this.zoom
    let ox = 0
    let oy = 0
    if (this._shake > 0) {
      ox = (Math.random() - 0.5) * this._shake * 2
      oy = (Math.random() - 0.5) * this._shake * 2
    }
    this.root.scale.set(z)
    this.root.x = DESIGN_WIDTH / 2 - this.x * z + ox
    this.root.y = DESIGN_HEIGHT / 2 - this.y * z + oy
    this._hud()
    // 视差：把镜头注视世界 X 交给地图（mid 锁角色平面）
    if (this.game.map?.setScroll) {
      this.game.map.setScroll(this.x)
    }
  }

  cut(opts = {}) {
    this._cancelTween()
    if (opts.x != null) this.x = opts.x
    if (opts.y != null) this.y = opts.y
    if (opts.zoom != null) this.zoom = clampZoom(opts.zoom)
    this._clampToStage()
    this.apply()
  }

  async panTo(opts = {}) {
    if (this.locked && !opts.force) return
    this._cancelTween()
    let toX = opts.x != null ? opts.x : this.x
    const toY = opts.y != null ? opts.y : this.y
    const toZ = clampZoom(opts.zoom != null ? opts.zoom : this.zoom)
    if (this.game.map?.clampCameraX) toX = this.game.map.clampCameraX(toX, toZ)
    const ms = opts.ms != null ? opts.ms : 900
    if (ms <= 0) {
      this.cut({ x: toX, y: toY, zoom: toZ })
      return
    }
    const fromX = this.x
    const fromY = this.y
    const fromZ = this.zoom
    const start = performance.now()
    await new Promise((resolve) => {
      this._tween = { resolve }
      const tick = () => {
        if (!this._tween) return
        const t = Math.min(1, (performance.now() - start) / ms)
        const e = easeInOut(t)
        this.x = fromX + (toX - fromX) * e
        this.y = fromY + (toY - fromY) * e
        this.zoom = fromZ + (toZ - fromZ) * e
        this.apply()
        if (t < 1) requestAnimationFrame(tick)
        else {
          this._tween = null
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
  }

  /**
   * 对焦：不完全钉死角色，与当前画面做 bias 混合（更稳）
   */
  async focus(id, opts = {}) {
    if (this.locked && !opts.force) return
    const actor = this.game.chars.get(id)
    if (!actor?.view) return this.panTo({ ...opts, force: opts.force })
    const bias = opts.bias != null ? opts.bias : CAMERA_POLICY.focusBias
    const targetX = actor.view.x
    const targetY = actor.view.y - 160
    const x = this.x + (targetX - this.x) * bias
    const y = this.y + (targetY - this.y) * bias
    const zoom = clampZoom(opts.zoom != null ? opts.zoom : 1.03)
    return this.panTo({
      x,
      y,
      zoom,
      ms: opts.ms != null ? opts.ms : 800,
      force: opts.force,
    })
  }

  async focusGroup(ids, opts = {}) {
    if (this.locked && !opts.force) return
    const box = this._groupBox(ids)
    if (!box) return
    // 组对焦也偏保守：中心略留，变焦贴下限
    const zoom =
      opts.zoom != null
        ? clampZoom(opts.zoom)
        : clampZoom(fitZoom(box.w, box.h, opts.pad ?? 0.35))
    return this.panTo({
      x: box.cx,
      y: Math.min(box.cy, DESIGN_HEIGHT * 0.5),
      zoom,
      ms: opts.ms != null ? opts.ms : 900,
      force: opts.force,
    })
  }

  follow(ids, opts = {}) {
    if (this.locked && !opts.force) return
    this._followIds = ids && ids.length ? [...ids] : null
    this._followZoom = opts.zoom != null ? clampZoom(opts.zoom) : null
  }

  stopFollow() {
    this._followIds = null
    this._followZoom = null
  }

  async shake(amount = 3, ms = 160, opts = {}) {
    if (!CAMERA_POLICY.allowShake && amount > 0 && !opts.force) return
    this._shake = amount
    const start = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / ms)
        this._shake = amount * (1 - t)
        this.apply()
        if (t < 1) requestAnimationFrame(tick)
        else {
          this._shake = 0
          this.apply()
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
  }

  update() {
    if (!this._followIds) return
    const box = this._groupBox(this._followIds)
    if (!box) return
    const lx = CAMERA_POLICY.followLerp
    const lz = CAMERA_POLICY.followZoomLerp
    let targetX = box.cx
    const targetY = Math.min(box.cy, DESIGN_HEIGHT * 0.5)
    const targetZ = this._followZoom != null ? this._followZoom : this.zoom
    if (this.game.map?.clampCameraX) targetX = this.game.map.clampCameraX(targetX, targetZ)
    this.x += (targetX - this.x) * lx
    this.y += (targetY - this.y) * lx
    this.zoom += (targetZ - this.zoom) * lz
    this._clampToStage()
    this.apply()
  }

  _clampToStage() {
    if (this.game.map?.clampCameraX) {
      this.x = this.game.map.clampCameraX(this.x, this.zoom)
    }
  }

  _groupBox(ids) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let n = 0
    for (const id of ids) {
      const a = this.game.chars.get(id)
      if (!a?.visible || !a.view) continue
      minX = Math.min(minX, a.view.x)
      maxX = Math.max(maxX, a.view.x)
      minY = Math.min(minY, a.view.y - 320)
      maxY = Math.max(maxY, a.view.y)
      n++
    }
    if (!n) return null
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: Math.max(200, maxX - minX),
      h: Math.max(200, maxY - minY),
    }
  }

  _cancelTween() {
    if (this._tween) {
      this._tween.resolve?.()
      this._tween = null
    }
  }

  _hud() {
    const el = document.getElementById('hud-camera')
    if (el) {
      const lock = this.locked ? ' LOCK' : ''
      el.textContent = `CAM x${Math.round(this.x)} z${this.zoom.toFixed(2)}${lock}`
    }
  }
}

function fitZoom(w, h, pad) {
  const zx = DESIGN_WIDTH / (w * (1 + pad * 2) || 1)
  const zy = DESIGN_HEIGHT / (h * (1 + pad * 2) || 1)
  return Math.max(0.94, Math.min(1.02, Math.min(zx, zy)))
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
