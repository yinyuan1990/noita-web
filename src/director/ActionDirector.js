import { meleeGap } from './formations.js'

/**
 * 动作导演：离位演出，默认回本阵
 *
 * - lunge / clash：先贴身再打，节拍间停在刀口，结束回 home
 * - rush：贴身围攻后回 home
 * - knockback / stepBack：默认临时离位（不改本阵）
 * - dashThrough：默认写入新本阵；下一拍用阵型硬复位
 */
export class ActionDirector {
  /**
   * @param {import('../core/Game.js').Game} game
   * @param {() => import('./EffectDirector.js').EffectDirector} getEffect
   * @param {() => import('./PositionDirector.js').PositionDirector} getPosition
   */
  constructor(game, getEffect, getPosition) {
    this.game = game
    this._getEffect = getEffect
    this._getPosition = getPosition
  }

  get effect() {
    return this._getEffect()
  }

  get position() {
    return this._getPosition()
  }

  _actor(id) {
    return this.game.chars.get(id)
  }

  _homeOrNow(id) {
    const home = this.position.getHome(id)
    const a = this._actor(id)
    if (home) return { x: home.x, y: home.y, face: home.face }
    if (!a?.view) return null
    return { x: a.view.x, y: a.view.y, face: a.face || 'right' }
  }

  async _returnHome(id, ms = 240) {
    await this.position.returnHome(id, { ms })
  }

  /** 突进贴身 → 命中闪 → 默认回本阵 */
  async lunge(id, target, opts = {}) {
    const chars = this.game.chars
    const a = this._actor(id)
    const b = this._actor(target)
    if (!a?.visible || !b?.visible) return
    const home = this._homeOrNow(id)
    const gap = opts.gap != null ? opts.gap : meleeGap(id, target)
    const ms = opts.ms != null ? opts.ms : 280
    chars.faceTowardActor(id, target)
    chars.playAnim(id, 'attack', false)
    const dir = a.view.x <= b.view.x ? 1 : -1
    // 贴目标当前脚位；Y 取双方平均，避免上下错层对轰
    const y = (a.view.y + b.view.y) * 0.5
    await chars.tweenTo(id, {
      x: b.view.x - dir * gap,
      y,
      ms,
      arc: !!opts.arc,
    })
    // 命中反馈：受击闪白/抖 + 命中特效（挂在目标身上）
    chars.playHit(target)
    if (opts.fx !== false) {
      void this.effect.play(opts.fxId || 'impact', {
        at: target,
        mode: 'at',
        ms: 320,
        silent: opts.silent,
      })
    }
    await sleep(opts.hitHold != null ? opts.hitHold : 140)
    chars.playAnim(id, 'idle', true)
    chars.playAnim(target, 'idle', true)
    if (opts.stay) return
    if (opts.home !== false && home) {
      await chars.tweenTo(id, { x: home.x, y: home.y, ms: opts.returnMs || 220 })
      if (home.face) chars.setFace(id, home.face)
      chars.playAnim(id, 'idle', true)
    }
  }

  /**
   * 近身对砍：先合到刀口，节拍间停在贴身位，结束才回本阵
   * （禁止隔着半屏对轰）
   */
  async clash(aId, bId, opts = {}) {
    const chars = this.game.chars
    const hits = opts.hits != null ? opts.hits : 3
    const beatMs = opts.ms != null ? opts.ms : 220
    const a = this._actor(aId)
    const b = this._actor(bId)
    if (!a?.visible || !b?.visible) return

    const aHome = this._homeOrNow(aId)
    const bHome = this._homeOrNow(bId)
    const gap = opts.gap != null ? opts.gap : meleeGap(aId, bId)
    const midPush = opts.push != null ? opts.push : 14

    // 合刀：在双方本阵中点贴身对峙
    const midX = ((aHome?.x ?? a.view.x) + (bHome?.x ?? b.view.x)) / 2
    const meetY =
      ((aHome?.y ?? a.view.y) + (bHome?.y ?? b.view.y)) / 2
    const dir = (aHome?.x ?? a.view.x) <= (bHome?.x ?? b.view.x) ? 1 : -1
    const aClash = { x: midX - dir * (gap * 0.5), y: meetY }
    const bClash = { x: midX + dir * (gap * 0.5), y: meetY }

    await Promise.all([
      chars.tweenTo(aId, { x: aClash.x, y: aClash.y, ms: 220 }),
      chars.tweenTo(bId, { x: bClash.x, y: bClash.y, ms: 220 }),
    ])
    chars.faceTowardActor(aId, bId)
    chars.faceTowardActor(bId, aId)

    for (let i = 0; i < hits; i++) {
      const attacker = i % 2 === 0 ? aId : bId
      const defender = attacker === aId ? bId : aId
      chars.playAnim(attacker, 'attack', false)
      chars.playHit(defender)

      await Promise.all([
        chars.tweenTo(aId, {
          x: aClash.x + dir * midPush,
          y: aClash.y,
          ms: beatMs * 0.4,
        }),
        chars.tweenTo(bId, {
          x: bClash.x - dir * midPush,
          y: bClash.y,
          ms: beatMs * 0.4,
        }),
      ])

      if (opts.fx !== false) {
        void this.effect.play(opts.fxId || 'clash_sparks', {
          from: aId,
          to: bId,
          mode: 'mid',
          ms: 280,
        })
        // 受击者身上再闪一下，体现打中（圈径 = 身高一半）
        void this.effect.play('impact', {
          at: defender,
          mode: 'at',
          ms: 260,
          silent: true,
        })
      }
      await sleep(beatMs * 0.5)

      // 节拍间回到刀口，不回半屏外本阵
      await Promise.all([
        chars.tweenTo(aId, { x: aClash.x, y: aClash.y, ms: beatMs * 0.35 }),
        chars.tweenTo(bId, { x: bClash.x, y: bClash.y, ms: beatMs * 0.35 }),
      ])
      chars.playAnim(aId, 'idle', true)
      chars.playAnim(bId, 'idle', true)
    }

    if (opts.home !== false) {
      await Promise.all([
        aHome
          ? chars.tweenTo(aId, { x: aHome.x, y: aHome.y, ms: opts.returnMs || 240 })
          : null,
        bHome
          ? chars.tweenTo(bId, { x: bHome.x, y: bHome.y, ms: opts.returnMs || 240 })
          : null,
      ])
      if (aHome?.face) chars.setFace(aId, aHome.face)
      if (bHome?.face) chars.setFace(bId, bHome.face)
      chars.playAnim(aId, 'idle', true)
      chars.playAnim(bId, 'idle', true)
    }
  }

  /**
   * 击退：相对本阵位移；默认不改本阵（commit:true 才永久挪坑）
   * Y 锁定本阵车道，避免越打越上下错层
   */
  async knockback(id, opts = {}) {
    const chars = this.game.chars
    const a = this._actor(id)
    if (!a?.visible) return
    const home = this._homeOrNow(id) || { x: a.view.x, y: a.view.y }
    const dist = opts.dist != null ? opts.dist : 80
    const ms = opts.ms != null ? opts.ms : 380
    let dx = 0
    let dy = 0
    const dir = opts.dir || 'right'
    if (dir === 'left') dx = -dist
    else if (dir === 'right') dx = dist
    else if (dir === 'far') dy = -dist
    else if (dir === 'near') dy = dist
    else if (dir === -1) dx = -dist
    else dx = dist

    chars.playHit(id, { shake: Math.min(18, Math.abs(dist) * 0.12) })
    const toX = home.x + dx
    // 纯横向击退锁 Y；远/近才动 Y
    const toY = dy ? home.y + dy : home.y
    await chars.tweenTo(id, {
      x: toX,
      y: toY,
      ms,
      arc: opts.arc !== false && !dy,
    })
    chars.playAnim(id, 'idle', true)
    if (opts.face) chars.setFace(id, opts.face)
    // 默认临时：rest / holdFormation 收场；仅显式 commit 改本阵
    if (opts.commit === true) {
      this.position.setHome(id, {
        x: toX,
        y: toY,
        face: opts.face || a.face || home.face,
        depth: this.position.getHome(id)?.depth,
        depthScale: this.position.getHome(id)?.depthScale,
      })
    }
  }

  /** 围攻：打完全体回本阵 */
  async rush(ids, target, opts = {}) {
    const chars = this.game.chars
    const t = this._actor(target)
    if (!t?.visible) return
    const ms = opts.ms != null ? opts.ms : 480
    const list = (ids || []).filter((id) => this._actor(id)?.visible)
    const n = list.length || 1

    await Promise.all(
      list.map(async (id, i) => {
        if (opts.staggerMs) await sleep(i * opts.staggerMs)
        const a = this._actor(id)
        const home = this._homeOrNow(id)
        chars.faceTowardActor(id, target)
        chars.playAnim(id, 'attack', false)
        const gap = opts.gap != null ? opts.gap : meleeGap(id, target)
        const spread = (i - (n - 1) / 2) * 36
        const dir = a.view.x <= t.view.x ? 1 : -1
        await chars.tweenTo(id, {
          x: t.view.x - dir * gap + spread * 0.25,
          y: t.view.y,
          ms,
        })
        chars.playAnim(id, 'idle', true)
      })
    )

    // 围攻命中：目标受击 + 一次命中闪
    chars.playHit(target, { shake: 14 })
    if (opts.fx !== false) {
      void this.effect.play(opts.fxId || 'impact', {
        at: target,
        mode: 'at',
        ms: 340,
      })
    }
    await sleep(160)
    chars.playAnim(target, 'idle', true)

    if (opts.home !== false) {
      await this.position.rest({ ids: list, ms: opts.returnMs || 260 })
    }
  }

  async freeze(id, opts = {}) {
    const chars = this.game.chars
    const a = this._actor(id)
    if (!a?.visible) return
    chars.playAnim(id, 'hit', false)
    await sleep(opts.ms != null ? opts.ms : 900)
    if (opts.resume !== false) chars.playAnim(id, 'idle', true)
  }

  async buffScale(id, opts = {}) {
    const chars = this.game.chars
    const a = this._actor(id)
    if (!a?.spine) return
    const to = opts.scale != null ? opts.scale : 1.12
    const ms = opts.ms != null ? opts.ms : 280
    const from = a.buffMul != null ? a.buffMul : 1
    const start = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / ms)
        a.buffMul = from + (to - from) * t
        chars.setFace(id, a.face || 'right')
        if (t < 1) requestAnimationFrame(tick)
        else {
          a.buffMul = to
          chars.setFace(id, a.face || 'right')
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
  }

  /** 穿越：新落点成为本阵 */
  async dashThrough(id, target, opts = {}) {
    const chars = this.game.chars
    const a = this._actor(id)
    const b = this._actor(target)
    if (!a?.visible || !b?.visible) return
    const past = opts.past != null ? opts.past : 140
    const ms = opts.ms != null ? opts.ms : 420
    const home = this._homeOrNow(id)
    chars.faceTowardActor(id, target)
    chars.playAnim(id, 'attack', false)
    const dir = a.view.x <= b.view.x ? 1 : -1
    const toX = b.view.x + dir * past
    const toY = home ? home.y : a.view.y
    await chars.tweenTo(id, { x: toX, y: toY, ms, arc: true })
    chars.playHit(target)
    if (opts.fx !== false) {
      void this.effect.play(opts.fxId || 'impact', {
        at: target,
        mode: 'at',
        ms: 280,
        silent: true,
      })
    }
    chars.playAnim(id, 'idle', true)
    if (opts.faceTarget) chars.faceTowardActor(id, opts.faceTarget)
    // 默认写入新本阵；剧本可 commit:false，交给下一拍 holdFormation
    if (opts.commit !== false) {
      this.position.setHome(id, {
        x: toX,
        y: toY,
        face: a.face || home?.face || 'right',
        depth: this.position.getHome(id)?.depth,
        depthScale: this.position.getHome(id)?.depthScale,
      })
    }
  }

  async stepBack(id, opts = {}) {
    await this.knockback(id, {
      dir: opts.dir || 'near',
      dist: opts.dist != null ? opts.dist : 50,
      ms: opts.ms != null ? opts.ms : 320,
      arc: false,
      face: opts.face,
      commit: opts.commit === true,
    })
  }

  async knockdown(ids, opts = {}) {
    const chars = this.game.chars
    const list = Array.isArray(ids) ? ids : [ids]
    const ms = opts.ms != null ? opts.ms : 500
    await Promise.all(
      list.map(async (id, i) => {
        if (opts.staggerMs) await sleep(i * opts.staggerMs)
        const a = this._actor(id)
        if (!a?.visible) return
        chars.playAnim(id, 'die', false)
        const home = this._homeOrNow(id) || { x: a.view.x, y: a.view.y }
        await chars.tweenTo(id, {
          x: home.x + (opts.dir === 'right' ? 40 : -40),
          y: home.y + 30,
          ms,
        })
        a.view.alpha = 0.35
        this.position.clearHome(id)
        if (opts.hide !== false) {
          await sleep(200)
          a.visible = false
          a.view.visible = false
          a.view.alpha = 1
        }
      })
    )
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
