/**
 * 打斗音效：技能特效附带属性
 *
 * 元素键：wind | rain | thunder | electric | water | fire | explosion | impact | magic
 * 优先播放 /res/sfx/{key}.ogg|.mp3|.wav（ogg 优先）；无文件时 WebAudio 合成占位
 */

const SFX_BASE = '/res/sfx'

/** 元素 → 默认增益 / 时长 */
const ELEMENT_META = {
  wind: { gain: 0.32, ms: 650 },
  rain: { gain: 0.28, ms: 900 },
  thunder: { gain: 0.5, ms: 1100 },
  electric: { gain: 0.38, ms: 420 },
  water: { gain: 0.34, ms: 480 },
  fire: { gain: 0.36, ms: 600 },
  explosion: { gain: 0.48, ms: 700 },
  impact: { gain: 0.4, ms: 280 },
  magic: { gain: 0.34, ms: 450 },
  clash: { gain: 0.38, ms: 260 },
}

export class SoundSystem {
  constructor(game) {
    this.game = game
    this.enabled = true
    this.volume = 0.85
    /** @type {AudioContext|null} */
    this._ctx = null
    /** @type {Map<string, HTMLAudioElement>} */
    this._files = new Map()
    this._fileTried = new Set()
  }

  _ensureCtx() {
    if (this._ctx) return this._ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    this._ctx = new AC()
    return this._ctx
  }

  async unlock() {
    const ctx = this._ensureCtx()
    if (ctx?.state === 'suspended') {
      try {
        await ctx.resume()
      } catch (e) {
        void e
      }
    }
  }

  /** 预载元素 wav，避免首击只落到合成音 */
  preloadAll() {
    for (const key of Object.keys(ELEMENT_META)) {
      if (this._files.has(key) || this._fileTried.has(key)) continue
      this._fileTried.add(key)
      const tryExt = (exts, i = 0) => {
        if (i >= exts.length) return
        const a = new Audio(`${SFX_BASE}/${key}.${exts[i]}`)
        a.preload = 'auto'
        a.addEventListener(
          'canplaythrough',
          () => {
            this._files.set(key, a)
          },
          { once: true }
        )
        a.addEventListener('error', () => tryExt(exts, i + 1), { once: true })
        a.load()
      }
      tryExt(['ogg', 'mp3', 'wav'])
    }
  }

  /**
   * @param {string|string[]|null} element 元素键或列表（取第一个有实现的）
   * @param {{ gain?: number, ms?: number, forceSynth?: boolean }} [opts]
   *   forceSynth：跳过 /res/sfx 文件、强制用 WebAudio 合成（如 electric 的"滋滋"电流声，文件版听感不对）
   */
  play(element, opts = {}) {
    if (!this.enabled || !element) return
    const keys = Array.isArray(element) ? element : [element]
    void this.unlock().then(() => {
      for (const key of keys) {
        if (!key) continue
        if (!opts.forceSynth && this._playFile(key, opts)) return
        this._synth(key, opts)
        return
      }
    })
  }

  /** 技能附带：读 skill.sfx / opts.sfx */
  playForSkill(skillKey, opts = {}) {
    const sfx = opts.sfx || skillSfxOf(skillKey)
    if (!sfx) return
    this.play(sfx, opts)
  }

  _playFile(key, opts) {
    const el = this._files.get(key)
    if (el) {
      try {
        el.volume = clamp01((opts.gain ?? ELEMENT_META[key]?.gain ?? 0.3) * this.volume)
        el.currentTime = 0
        void el.play()
        // 循环素材只截短播，避免雨/风拖太久
        const maxMs = opts.ms != null ? opts.ms : ELEMENT_META[key]?.ms
        if (maxMs != null && maxMs > 0) {
          clearTimeout(el._stopTimer)
          el._stopTimer = setTimeout(() => {
            try {
              el.pause()
              el.currentTime = 0
            } catch (e) {
              void e
            }
          }, maxMs)
        }
        return true
      } catch (e) {
        void e
        return false
      }
    }
    if (this._fileTried.has(key)) return false
    this._fileTried.add(key)
    // 异步探测文件；本次走合成，下次有缓存则用文件
    const tryExt = (exts, i = 0) => {
      if (i >= exts.length) return
      const a = new Audio(`${SFX_BASE}/${key}.${exts[i]}`)
      a.preload = 'auto'
      a.addEventListener(
        'canplaythrough',
        () => {
          this._files.set(key, a)
        },
        { once: true }
      )
      a.addEventListener(
        'error',
        () => tryExt(exts, i + 1),
        { once: true }
      )
      a.load()
    }
    tryExt(['ogg', 'mp3', 'wav'])
    return false
  }

  _synth(key, opts = {}) {
    const ctx = this._ensureCtx()
    if (!ctx) return
    const meta = ELEMENT_META[key] || ELEMENT_META.impact
    const gain = clamp01((opts.gain ?? meta.gain) * this.volume)
    const ms = opts.ms != null ? opts.ms : meta.ms
    const t0 = ctx.currentTime

    switch (key) {
      case 'wind':
        noiseWhoosh(ctx, t0, ms / 1000, gain, 800, 2400)
        break
      case 'rain':
        noiseWhoosh(ctx, t0, ms / 1000, gain * 0.7, 3000, 9000)
        burst(ctx, t0, 0.04, gain * 0.15, 5000)
        break
      case 'thunder':
        noiseWhoosh(ctx, t0, 0.08, gain, 100, 600)
        sineHit(ctx, t0, 0.55, gain * 0.9, 55, 40)
        noiseWhoosh(ctx, t0 + 0.05, ms / 1000, gain * 0.5, 80, 400)
        break
      case 'electric':
        // 呲呲：持续高频噪声 + 不规则电火花
        electricCrackle(ctx, t0, Math.max(0.18, ms / 1000), gain)
        break
      case 'water':
        noiseWhoosh(ctx, t0, ms / 1000, gain * 0.6, 400, 1600)
        sineHit(ctx, t0, 0.2, gain * 0.35, 220, 120)
        break
      case 'fire':
        noiseWhoosh(ctx, t0, ms / 1000, gain * 0.55, 200, 1200)
        sineHit(ctx, t0, 0.15, gain * 0.25, 90, 70)
        break
      case 'explosion':
        noiseWhoosh(ctx, t0, 0.12, gain, 80, 2000)
        sineHit(ctx, t0, 0.35, gain, 70, 35)
        noiseWhoosh(ctx, t0 + 0.04, ms / 1000, gain * 0.45, 100, 800)
        break
      case 'magic':
        sineHit(ctx, t0, 0.25, gain * 0.7, 660, 880)
        sineHit(ctx, t0 + 0.04, 0.3, gain * 0.5, 990, 1320)
        break
      case 'clash':
        noiseWhoosh(ctx, t0, 0.05, gain, 1500, 6000)
        sineHit(ctx, t0, 0.08, gain * 0.7, 800, 200)
        break
      case 'impact':
      default:
        noiseWhoosh(ctx, t0, 0.07, gain, 200, 1800)
        sineHit(ctx, t0, 0.12, gain * 0.8, 120, 60)
        break
    }
  }
}

/** 逻辑技能 → 元素音（可被 skills.js SKILL_SFX 覆盖） */
const DEFAULT_SKILL_SFX = {
  clash_sparks: 'clash',
  curse_hit: 'magic',
  color_ray: 'electric',
  stun_hold: 'electric',
  decay_ray: 'electric',
  magic_missile: 'magic',
  buff_bull: 'impact',
  buff_bear: 'impact',
  sanctuary: 'magic',
  summon_red: 'fire',
  sonic_blast: 'thunder',
  flail_orbit: 'wind',
  heal_tick: 'water',
  impact: 'explosion',
  blood_flash: 'impact',
  explosion: 'explosion',
  dust: 'wind',
  ray: 'electric',
  fire: 'fire',
  electric: 'electric',
  light: 'magic',
  snow: 'wind',
  rain: 'rain',
}

let _skillSfxTable = { ...DEFAULT_SKILL_SFX }

export function setSkillSfxTable(table) {
  _skillSfxTable = { ...DEFAULT_SKILL_SFX, ...(table || {}) }
}

export function skillSfxOf(skillKey) {
  if (!skillKey) return null
  return _skillSfxTable[skillKey] || null
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function sineHit(ctx, t0, dur, gain, f0, f1) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f0, t0)
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(ctx.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

function noiseWhoosh(ctx, t0, dur, gain, hp, lp) {
  const sr = ctx.sampleRate
  const n = Math.max(1, Math.floor(sr * dur))
  const buf = ctx.createBuffer(1, n, sr)
  const data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = (hp + lp) / 2
  filter.Q.value = 0.7
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + Math.min(0.04, dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(ctx.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

function burst(ctx, t0, dur, gain, freq) {
  sineHit(ctx, t0, dur, gain, freq, freq * 0.5)
}

/**
 * 电流滋滋声
 * 主体 = 锯齿波低鸣（100~180Hz，频率快抖 + 断续包络）→ 经典「滋——滋滋」
 * 点缀 = 稀疏高频火花爆点；不再是纯高频嘶声
 */
function electricCrackle(ctx, t0, dur, gain) {
  // —— 主体：锯齿低鸣 ——
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(120, t0)
  // 频率快速随机抖动，像电弧不稳定
  const fmSteps = Math.max(6, Math.floor(dur * 40))
  for (let i = 1; i <= fmSteps; i++) {
    osc.frequency.setValueAtTime(95 + Math.random() * 85, t0 + (dur * i) / fmSteps)
  }

  const buzzGain = ctx.createGain()
  // 断续包络：忽强忽弱地「滋滋」跳
  const amSteps = Math.max(8, Math.floor(dur * 55))
  buzzGain.gain.setValueAtTime(0.0001, t0)
  for (let i = 1; i < amSteps; i++) {
    const tt = t0 + (dur * i) / amSteps
    const on = Math.random() < 0.75
    buzzGain.gain.linearRampToValueAtTime(on ? gain * (0.4 + Math.random() * 0.6) : gain * 0.08, tt)
  }
  buzzGain.gain.linearRampToValueAtTime(0.0001, t0 + dur)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2600
  lp.Q.value = 0.8

  osc.connect(lp)
  lp.connect(buzzGain)
  buzzGain.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)

  // —— 点缀：稀疏火花爆点（衰减噪声脉冲）——
  const sr = ctx.sampleRate
  const n = Math.max(1, Math.floor(sr * dur))
  const buf = ctx.createBuffer(1, n, sr)
  const data = buf.getChannelData(0)
  let env = 0
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.0022) env = 0.9 + Math.random() * 0.4
    env *= 0.994
    data[i] = (Math.random() * 2 - 1) * env
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3000
  bp.Q.value = 0.9
  const sparkGain = ctx.createGain()
  sparkGain.gain.setValueAtTime(gain * 0.55, t0)
  sparkGain.gain.setValueAtTime(gain * 0.55, t0 + Math.max(0.02, dur * 0.75))
  sparkGain.gain.linearRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp)
  bp.connect(sparkGain)
  sparkGain.connect(ctx.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}
