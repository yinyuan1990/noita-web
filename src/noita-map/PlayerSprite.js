// ── 玩家精灵:Noita 原版 data/enemies_gfx/player.xml(身体帧动画)+ player_arm.xml(手臂)+ 热点图 ──
// 身体 12×19,pivot (6,14);朝向跟着瞄准方向翻转(Noita 规则:身体面朝鼠标,腿可以倒着走 → walk_backwards)。
// 手臂根 = 热点图里每帧的 #800000 像素(right_arm_start),手臂 5×5 绕根旋转指向瞄准点,手的位置 = 手臂热点 hand;法杖画在手上,弹从杖尖出。
export class PlayerSprite {
  constructor(res, decodePng) {
    this.res = res
    this.decodePng = decodePng
    this.ready = false
    this.anim = 'stand'
    this.t = 0
    this.lastLoopAnim = 'stand'
  }

  async load() {
    const def = await (await fetch(`${this.res}/player/player.json`)).json()
    this.def = def
    const [body, bodyHot, arm, armHot, wand] = await Promise.all(['player.png', 'player_hotspots.png', 'player_arm.png', 'player_arm_hotspots.png', def.wand].map((f) => this.decodePng(`${this.res}/player/${f}`)))
    this.body = body; this.arm = arm; this.wand = wand
    // 每个动画每帧的手臂根热点(相对帧左上)
    this.armRoot = {}
    const find = (img, x0, y0, w, h, color) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = ((y0 + y) * img.width + x0 + x) * 4
        if (img.data[o + 3] && ((img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2]) === color) return [x, y]
      }
      return null
    }
    for (const [name, a] of Object.entries(def.body.anims)) {
      const list = []
      for (let f = 0; f < a.frames; f++) {
        const fx = a.x + (f % a.perRow) * a.fw, fy = a.y + Math.floor(f / a.perRow) * a.fh
        list.push(find(bodyHot, fx, fy, a.fw, a.fh, def.body.hotspots.right_arm_start) || [7, 8])
      }
      this.armRoot[name] = list
    }
    const aa = def.arm.anims[def.arm.def]
    this.hand = find(armHot, aa.x, aa.y, aa.fw, aa.fh, def.arm.hotspots.hand) || [4, 2]
    this.wandCache = new Map([[def.wand, wand]])
    this.ready = true
    return this
  }

  /** 换法杖贴图(player.json 的 wands 列表里挑一根,按下标) */
  async setWand(index) {
    const list = this.def.wands || [this.def.wand]
    const name = list[((index % list.length) + list.length) % list.length]
    if (!this.wandCache.has(name)) this.wandCache.set(name, await this.decodePng(`${this.res}/player/${name}`).catch(() => null))
    this.wand = this.wandCache.get(name) || this.wand
  }
  /** 直接给一张法杖图(真法杖:AbilityComponent.sprite_file) */
  async setWandUrl(url) {
    if (!this.wandCache.has(url)) this.wandCache.set(url, await this.decodePng(url).catch(() => null))
    this.wand = this.wandCache.get(url) || this.wand
  }

  /**
   * 选动画:Noita 状态机的简化版
   * @param {{onGround:boolean, inLiq:boolean, thrusting:boolean, vx:number, vy:number, dir:number, face:number, landed:boolean}} s
   */
  update(s, dt) {
    let want
    if (s.inLiq) want = Math.abs(s.vx) > 8 ? 'swim_move' : 'swim_idle'
    else if (s.thrusting) want = s.dir ? 'fly_move' : 'fly_idle'
    else if (!s.onGround) want = s.vy < -10 ? 'jump_up' : 'jump_fall'
    else if (s.landed) want = 'land'
    else if (Math.abs(s.vx) > 8) want = s.dir && s.dir * s.face < 0 ? 'walk_backwards' : 'walk'
    else want = 'stand'
    const a = this.def.body.anims
    // 一次性动画(land/jump_up)播完再切;循环动画直接切
    const cur = a[this.anim]
    if (want !== this.anim) {
      const curDone = !cur || cur.loop !== 0 || this.t >= cur.frames * cur.wait
      if (curDone || (want !== 'stand' && want !== 'walk' && want !== 'walk_backwards')) { this.anim = a[want] ? want : 'stand'; this.t = 0 }
    }
    this.t += dt
  }

  frame() {
    const a = this.def.body.anims[this.anim]
    const f = Math.floor(this.t / a.wait)
    return a.loop === 0 ? Math.min(a.frames - 1, f) : f % a.frames
  }

  /**
   * 画身体 + 手臂 + 法杖;返回杖尖世界坐标(发射点)
   * @param {number} face 1 右 / -1 左(= 瞄准方向)
   * @param {number} aim  瞄准角(世界)
   */
  draw(ctx, x, y, face, aim, ox, oy) {
    if (!this.ready) return { x, y: y - 2 }
    const B = this.def.body, a = B.anims[this.anim], f = this.frame()
    const fx = a.x + (f % a.perRow) * a.fw, fy = a.y + Math.floor(f / a.perRow) * a.fh
    const px = Math.round(x - ox), py = Math.round(y - oy)
    ctx.imageSmoothingEnabled = false
    ctx.save()
    ctx.translate(px, py)
    ctx.scale(face, 1)
    ctx.drawImage(this.body.image, fx, fy, a.fw, a.fh, -B.offX, -B.offY, a.fw, a.fh)
    ctx.restore()
    // 手臂:根在热点,朝瞄准角旋转;面朝左时上下翻转,免得手臂倒过来
    const root = this.armRoot[this.anim][f]
    const rx = px + face * (root[0] - B.offX + 0.5), ry = py + (root[1] - B.offY + 0.5)
    const A = this.def.arm, aa = A.anims[A.def]
    ctx.save()
    ctx.translate(Math.round(rx), Math.round(ry))
    ctx.rotate(aim)
    if (face < 0) ctx.scale(1, -1)
    ctx.drawImage(this.arm.image, aa.x, aa.y, aa.fw, aa.fh, -A.offX, -A.offY, aa.fw, aa.fh)
    // 法杖:握柄放在手热点,沿手臂方向
    const hx = this.hand[0] - A.offX, hy = this.hand[1] - A.offY
    if (this.wand?.image) ctx.drawImage(this.wand.image, hx - 2, hy - Math.floor(this.wand.height / 2))
    ctx.restore()
    const len = (this.wand?.width || 8) + hx - 2
    return { x: rx + Math.cos(aim) * len, y: ry + Math.sin(aim) * len }
  }
}
