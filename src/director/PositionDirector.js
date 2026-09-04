import { DESIGN_WIDTH, DESIGN_HEIGHT, WORLD } from '../config.js'
import { FORMATIONS, resolveFormationPack } from './formations.js'

/**
 * 位置导演：阵型为本，本阵(home)为纲
 *
 * 所有打斗离位后以 home 为准收回；只有击退/穿越等显式改本阵。
 * 禁止「推着推着挤成一坨」。
 */
export class PositionDirector {
  constructor(game) {
    this.game = game
    /** @type {Map<string, {x:number,y:number,face:string,depth:number,depthScale:number}>} */
    this.homes = new Map()
    this.formationName = null
    /** @type {string|null} */
    this._crowdStageId = null
    this._baseHumanRatio = null
    /** @type {object|null} */
    this.lastCrowdPolicy = null
  }

  groundY() {
    return this.game.map?.groundY || 920
  }

  getHome(id) {
    return this.homes.get(id) || null
  }

  setHome(id, spot) {
    if (!id || !spot) return
    this.homes.set(id, {
      x: spot.x,
      y: spot.y,
      face: spot.face || 'right',
      depth: spot.depth != null ? spot.depth : 0.5,
      depthScale: spot.depthScale != null ? spot.depthScale : 1,
    })
  }

  /** 按阵型点批量写入本阵 */
  commitHomes(spots) {
    for (const s of spots || []) this.setHome(s.id, s)
  }

  /** 以当前脚底坐标更新本阵（击退落地后） */
  commitHomeFromActor(id) {
    const a = this.game.chars.get(id)
    if (!a?.view) return
    const prev = this.homes.get(id) || {}
    this.setHome(id, {
      x: a.view.x,
      y: a.view.y,
      face: a.face || prev.face || 'right',
      depth: a.depth != null ? a.depth : prev.depth,
      depthScale: a.depthScale != null ? a.depthScale : prev.depthScale,
    })
  }

  clearHome(id) {
    this.homes.delete(id)
  }

  resolveFormation(name, opts = {}) {
    const def = FORMATIONS[name]
    if (!def) throw new Error(`[PositionDirector] unknown formation: ${name}`)
    const cx = opts.cx != null ? opts.cx : this.game.map?.stageCenterX ?? DESIGN_WIDTH / 2
    const band = this.game.map?.stageCfg?.formation || null
    const { spots, policy } = resolveFormationPack(def, cx, band)
    this.applyCrowdPolicy(policy)
    return spots
  }

  /**
   * 按阵型人数微调人类身高（相对舞台 Base，绝不叠乘）
   */
  applyCrowdPolicy(policy) {
    this.lastCrowdPolicy = policy
    const form = this.game.map?.stageCfg?.formation
    if (!form || !policy) return
    const stageId = this.game.map?.stageCfg?.id || this.game.map?.id || ''
    if (this._crowdStageId !== stageId || this._baseHumanRatio == null) {
      this._crowdStageId = stageId
      this._baseHumanRatio =
        form.humanRatioBase != null
          ? form.humanRatioBase
          : WORLD.humanScreenRatio
      // 纠偏：若上次把 humanRatio 抠坏了，先拉回 Base
      form.humanRatioBase = this._baseHumanRatio
    }
    const base = this._baseHumanRatio
    const minR = WORLD.minHumanRatio != null ? WORLD.minHumanRatio : 0.12
    const minMul = WORLD.minHumanMul != null ? WORLD.minHumanMul : 0.9
    const mul = Math.max(policy.humanMul != null ? policy.humanMul : 1, minMul)
    const next = Math.max(minR, Math.min(base, base * mul))
    // 同值不反复 resync，避免无意义闪缩
    if (Math.abs((form.humanRatio || 0) - next) < 0.0005) return
    form.humanRatio = next
    this.game.chars?.resyncWorldScale?.()
  }

  /** 切台时重置人潮缓存，并恢复舞台基准身高 */
  resetCrowdBase() {
    const form = this.game.map?.stageCfg?.formation
    this._crowdStageId = null
    this._baseHumanRatio = null
    if (form?.humanRatioBase != null) form.humanRatio = form.humanRatioBase
  }

  async enterFormation(formation, opts = {}) {
    const spots = this.resolveFormation(formation, opts)
    this.formationName = formation
    const enter = opts.enter || 'walk'
    const stagger = opts.staggerMs != null ? opts.staggerMs : 90
    const chars = this.game.chars
    const camera = this.game.camera

    camera.unlock()
    const centerX = this.game.map?.stageCenterX ?? DESIGN_WIDTH / 2
    await camera.panTo({
      x: centerX,
      y: DESIGN_HEIGHT * 0.48,
      zoom: opts.zoom != null ? opts.zoom : 0.98,
      ms: 500,
      force: true,
    })

    await Promise.all(
      spots.map(async (s, i) => {
        if (stagger > 0) await sleep(i * stagger)
        const fromSide = s.x < centerX ? 'left' : 'right'
        const stageW = this.game.map?.stageWidth || DESIGN_WIDTH
        const fromX = fromSide === 'left' ? -220 - i * 40 : stageW + 220 + i * 40
        if (enter === 'walk') {
          await chars.walkIn(s.id, {
            from: { x: fromX, y: s.y },
            to: { x: s.x, y: s.y },
            face: s.face,
            ms: 900 + i * 40,
            depthScale: s.depthScale,
            depth: s.depth,
          })
        } else {
          await chars.showAt(s.id, {
            x: s.x,
            y: s.y,
            face: s.face,
            enter: enter === 'fade' ? 'fade' : 'instant',
            depthScale: s.depthScale,
            depth: s.depth,
          })
        }
      })
    )

    this.commitHomes(spots)

    if (opts.camera !== false) {
      await camera.panTo({
        x: centerX,
        y: DESIGN_HEIGHT * 0.48,
        zoom: opts.zoom != null ? opts.zoom : 0.98,
        ms: 700,
        force: true,
      })
      camera.lock()
    }
  }

  async holdFormation(formation, opts = {}) {
    const spots = this.resolveFormation(formation, opts)
    this.formationName = formation
    const chars = this.game.chars
    const ms = opts.ms != null ? opts.ms : 280
    const keep = new Set(opts.keepIds || [])
    const moved = []
    await Promise.all(
      spots.map(async (s) => {
        if (keep.has(s.id)) return
        const a = chars.get(s.id)
        if (!a) return
        // 默认不召唤未出场角色（毒蛇等须走 enter）；spawn:true 才补出
        if (!a.visible) {
          if (opts.spawn !== true) return
          await chars.showAt(s.id, {
            x: s.x,
            y: s.y,
            face: s.face,
            enter: 'fade',
            depth: s.depth,
            depthScale: s.depthScale,
          })
          moved.push(s)
          return
        }
        chars.setDepth(s.id, s.depth, s.depthScale)
        chars.setFace(s.id, s.face)
        // 距离远就迈步走过去，时长随距离伸缩，不再滑冰
        const dist = Math.hypot(s.x - a.view.x, s.y - a.view.y)
        const moveMs = Math.max(ms, Math.min(700, dist * 1.6))
        chars.playAnim(s.id, dist > 90 ? 'walk' : 'idle', true)
        await chars.tweenTo(s.id, { x: s.x, y: s.y, ms: moveMs })
        chars.playAnim(s.id, 'idle', true)
        moved.push(s)
      })
    )
    this.commitHomes(moved.length ? moved : spots.filter((s) => !keep.has(s.id)))
    // 阵型里但 keep 的角色：不改坐标，也不用阵型点覆盖其 home

    if (opts.camera !== false) {
      const camera = this.game.camera
      const centerX = this.game.map?.stageCenterX ?? DESIGN_WIDTH / 2
      camera.unlock()
      await camera.panTo({
        x: centerX,
        y: DESIGN_HEIGHT * 0.48,
        zoom: opts.zoom != null ? opts.zoom : 0.98,
        ms: 400,
        force: true,
      })
      camera.lock()
    }
  }

  /**
   * 硬复位：按当前（或指定）阵型重算本阵并全体落位
   * 节拍边界必用——比 rest 更狠，专治越打越歪
   */
  async resetFormation(formation, opts = {}) {
    const name = formation || this.formationName
    if (!name) {
      await this.rest(opts)
      return
    }
    await this.holdFormation(name, { ...opts, camera: opts.camera ?? false })
  }

  /**
   * 归位：全体（或指定）回到本阵
   * hard:true → 先按阵型重写 home 再归（节拍收场）
   */
  async rest(opts = {}) {
    if (opts.hard || opts.formation) {
      const name =
        typeof opts.formation === 'string' ? opts.formation : this.formationName
      await this.resetFormation(name, {
        ms: opts.ms,
        keepIds: opts.keepIds,
        camera: opts.camera ?? false,
        zoom: opts.zoom,
      })
      return
    }
    const chars = this.game.chars
    const ms = opts.ms != null ? opts.ms : 280
    const ids = opts.ids || [...this.homes.keys()]
    await Promise.all(
      ids.map(async (id) => {
        const home = this.homes.get(id)
        const a = chars.get(id)
        if (!home || !a?.visible) return
        chars.setDepth(id, home.depth, home.depthScale)
        chars.setFace(id, home.face)
        const dist = Math.hypot(home.x - a.view.x, home.y - a.view.y)
        const moveMs = Math.max(ms, Math.min(700, dist * 1.6))
        chars.playAnim(id, dist > 90 ? 'walk' : 'idle', true)
        await chars.tweenTo(id, { x: home.x, y: home.y, ms: moveMs })
        chars.playAnim(id, 'idle', true)
      })
    )
  }

  /** 单人回本阵 */
  async returnHome(id, opts = {}) {
    await this.rest({ ids: [id], ms: opts.ms != null ? opts.ms : 240 })
  }

  async march(ids, opts = {}) {
    const arena =
      this.game.map?.isFixedArena ||
      this.game.map?.mode === 'battle' ||
      this.game.map?.mode === 'pack'
    const dir = opts.dir || (arena ? 'far' : 'right')
    const distance = opts.distance != null ? opts.distance : arena ? 36 : 1100
    const ms = opts.ms != null ? opts.ms : arena ? 700 : 1600
    const stagger = opts.staggerMs != null ? opts.staggerMs : 70
    const chars = this.game.chars
    const camera = this.game.camera

    const visible = ids
      .map((id) => chars.get(id))
      .filter((a) => a?.visible)
      .sort((a, b) => a.view.x - b.view.x)
    if (!visible.length) return

    // 战场行军：按本阵整体平移，不 unclump 打散阵型
    if (arena) {
      const plan = visible.map((actor) => {
        const home = this.homes.get(actor.id)
        let x = home ? home.x : actor.view.x
        let y = home ? home.y : actor.view.y
        if (dir === 'far') y -= distance
        else if (dir === 'near') y += distance
        else if (dir === 'left') x -= distance
        else x += distance
        return { id: actor.id, x, y, face: home?.face || actor.face }
      })
      await Promise.all(
        plan.map(async (p, i) => {
          if (stagger > 0) await sleep(i * stagger)
          chars.playAnim(p.id, 'walk', true)
          await chars.tweenTo(p.id, { x: p.x, y: p.y, ms })
          chars.playAnim(p.id, 'idle', true)
          this.setHome(p.id, {
            x: p.x,
            y: p.y,
            face: p.face,
            depth: this.homes.get(p.id)?.depth,
            depthScale: this.homes.get(p.id)?.depthScale,
          })
        })
      )
      return
    }

    await this.unclump(
      visible.map((a) => a.id),
      { minGap: 140 }
    )
    if (opts.cameraFollow !== false) {
      camera.unlock()
      camera.follow(
        visible.map((a) => a.id),
        { zoom: opts.zoom != null ? opts.zoom : 0.98, force: true }
      )
    }
    const refreshed = ids.map((id) => chars.get(id)).filter((a) => a?.visible)
    await Promise.all(
      refreshed.map(async (actor, i) => {
        if (stagger > 0) await sleep(i * stagger)
        let toX = actor.view.x
        let toY = actor.view.y
        if (dir === 'left') {
          toX -= distance
          chars.setFace(actor.id, 'left')
        } else if (dir === 'right') {
          toX += distance
          chars.setFace(actor.id, 'right')
        } else if (dir === 'far') toY -= distance
        else toY += distance
        chars.playAnim(actor.id, 'walk', true)
        await chars.tweenTo(actor.id, { x: toX, y: toY, ms })
        chars.playAnim(actor.id, 'idle', true)
        if (opts.hide !== false) {
          actor.visible = false
          actor.view.visible = false
        }
      })
    )
    camera.stopFollow()
  }

  async unclump(ids, opts = {}) {
    const minGap = opts.minGap || 140
    const chars = this.game.chars
    const list = ids
      .map((id) => chars.get(id))
      .filter((a) => a?.visible)
      .sort((a, b) => a.view.x - b.view.x)
    if (list.length < 2) return
    const cx = list.reduce((s, a) => s + a.view.x, 0) / list.length
    const total = (list.length - 1) * minGap
    const startX = cx - total / 2
    await Promise.all(
      list.map((a, i) =>
        chars.tweenTo(a.id, { x: startX + i * minGap, y: a.view.y, ms: 350 })
      )
    )
  }

  async enter(id, opts = {}) {
    const chars = this.game.chars
    const camera = this.game.camera
    if (opts.slot) await chars.show(id, opts)
    else if (opts.x != null) await chars.showAt(id, opts)
    else await chars.show(id, { slot: 'center', ...opts })
    chars.playAnim(id, 'idle', true)
    // 写入本阵（随后 holdFormation 会统一刷新）
    const a = chars.get(id)
    if (a?.view) {
      this.setHome(id, {
        x: a.view.x,
        y: a.view.y,
        face: opts.face || a.face || 'right',
        depth: a.depth,
        depthScale: a.depthScale,
      })
    }
    if (opts.camera === 'focus') {
      camera.unlock()
      await camera.focus(id, {
        zoom: opts.zoom || 1.04,
        ms: opts.camMs || 800,
        force: true,
      })
      if (opts.lock !== false) camera.lock()
    }
  }

  async exit(id, opts = {}) {
    this.clearHome(id)
    await this.game.chars.hide(id, opts)
  }

  faceAll(ids, face) {
    for (const id of ids) {
      this.game.chars.setFace(id, face)
      const h = this.homes.get(id)
      if (h) h.face = face
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
