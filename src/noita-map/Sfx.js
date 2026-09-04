// ── 音效(Web Audio):首次手势解锁 AudioContext;mp3 走 BufferSource(iOS 上别用多个 <audio>,会互相掐断)──
// 素材 public/res/noita/sfx/*.mp3 全部 CC0(见 public/res/sfx/LICENSE.txt)。喷气/环境音用噪声合成,不占文件。

export class Sfx {
  constructor(base) {
    this.base = base
    this.ctx = null
    this.bufs = new Map()
    this.master = null
    this.loops = new Map()
    this.lastAt = new Map()
    this.muted = false
    // 任何手势都尝试解锁/恢复:iOS 切后台再回来 AudioContext 会变 'interrupted'/'suspended',且只能在手势里 resume
    const unlock = () => this.ensure()
    for (const ev of ['pointerdown', 'touchstart', 'touchend', 'keydown', 'mousedown']) window.addEventListener(ev, unlock, { passive: true })
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resume() })
    window.addEventListener('focus', () => this.resume())
    window.addEventListener('pageshow', () => this.resume())
  }

  resume() {
    const c = this.ctx
    if (!c) return
    if (c.state !== 'running') c.resume().catch(() => {})
  }

  /** 每帧调一次:状态不对就补救(iOS 上 resume 可能要多试几次) */
  tick() {
    if (this.ctx && this.ctx.state !== 'running' && !this._resumeBusy) {
      this._resumeBusy = true
      this.ctx.resume().catch(() => {}).finally(() => { this._resumeBusy = false })
    }
  }

  ensure() {
    if (this.ctx) { this.resume(); return this.ctx }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    this.ctx = new AC()
    // master → 低通(水下闷音:头没进液体时压到 ~400Hz)→ 输出
    this.master = this.ctx.createGain(); this.master.gain.value = 0.8
    this.muffle = this.ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5
    this.master.connect(this.muffle); this.muffle.connect(this.ctx.destination)
    this._startAmbient()
    return this.ctx
  }

  /** 水下:整体闷掉(player_base 的 sound_underwater 循环 + 引擎对其他声音的低通) */
  setUnderwater(on) {
    if (!this.ctx) return
    this.muffle.frequency.setTargetAtTime(on ? 420 : 20000, this.ctx.currentTime, 0.08)
    this.loop('underwater', on, { vol: 0.35, freq: 140, q: 0.6 })
  }

  async load(names) {
    await Promise.all(names.map(async (n) => {
      try {
        const ab = await (await fetch(`${this.base}/sfx/${n}.mp3`)).arrayBuffer()
        this.raw = this.raw || new Map(); this.raw.set(n, ab)
      } catch (e) { void e }
    }))
  }

  async _buf(n) {
    if (this.bufs.has(n)) return this.bufs.get(n)
    const raw = this.raw?.get(n)
    if (!raw || !this.ctx) return null
    const b = await this.ctx.decodeAudioData(raw.slice(0))
    this.bufs.set(n, b)
    return b
  }

  /** 播一次;minGap 防同一音效一帧里叠很多次 */
  play(n, { vol = 1, rate = 1, minGap = 40, pan = 0 } = {}) {
    if (this.muted || !this.ctx) return
    const now = performance.now()
    if (now - (this.lastAt.get(n) || 0) < minGap) return
    this.lastAt.set(n, now)
    this._buf(n).then((b) => {
      if (!b) return
      const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.94 + Math.random() * 0.12)
      const g = this.ctx.createGain(); g.gain.value = vol
      let node = g
      if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p }
      s.connect(g); node.connect(this.master); s.start()
    })
  }

  /** 持续音(喷气/燃烧):on=true 拉起,false 放下;用滤波噪声合成 */
  loop(name, on, { vol = 0.25, freq = 800, q = 0.7 } = {}) {
    if (!this.ctx) return
    let l = this.loops.get(name)
    if (!l) {
      const len = this.ctx.sampleRate * 2
      const nb = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = nb.getChannelData(0)
      let v = 0
      for (let i = 0; i < len; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.15; d[i] = v } // 棕噪声
      const src = this.ctx.createBufferSource(); src.buffer = nb; src.loop = true
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q
      const g = this.ctx.createGain(); g.gain.value = 0
      src.connect(f); f.connect(g); g.connect(this.master); src.start()
      l = { g, f }; this.loops.set(name, l)
    }
    const t = this.ctx.currentTime
    l.g.gain.cancelScheduledValues(t)
    l.g.gain.setTargetAtTime(on && !this.muted ? vol : 0, t, on ? 0.05 : 0.12)
  }

  /** 环境音:洞穴低频嗡鸣 + 偶尔滴水,深度越深越明显(由 setDepth 调) */
  _startAmbient() {
    const c = this.ctx
    const len = c.sampleRate * 3
    const nb = c.createBuffer(1, len, c.sampleRate)
    const d = nb.getChannelData(0)
    let v = 0
    for (let i = 0; i < len; i++) { v = v * 0.995 + (Math.random() * 2 - 1) * 0.02; d[i] = v }
    const src = c.createBufferSource(); src.buffer = nb; src.loop = true
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160
    this.amb = c.createGain(); this.amb.gain.value = 0
    src.connect(f); f.connect(this.amb); this.amb.connect(this.master); src.start()
    this.dripT = 0
  }

  setDepth(depth01, dt) {
    if (!this.ctx) return
    this.amb.gain.setTargetAtTime(this.muted ? 0 : 0.05 + 0.5 * depth01, this.ctx.currentTime, 0.5)
    this.dripT -= dt
    if (depth01 > 0.3 && this.dripT <= 0) {
      this.dripT = 2 + Math.random() * 6
      const o = this.ctx.createOscillator(), g = this.ctx.createGain()
      o.type = 'sine'; o.frequency.setValueAtTime(1800 + Math.random() * 800, this.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.12)
      g.gain.setValueAtTime(0.06 * depth01, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25)
      o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.3)
    }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05) }
}
