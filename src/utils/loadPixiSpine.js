import * as PIXI from 'pixi.js'

let loading = null

function spineNamespace() {
  if (typeof window === 'undefined') return null
  return window.pixi_spine || (window.PIXI && window.PIXI.spine) || null
}

function wireSpine(ns) {
  if (!ns || !ns.Spine) return null
  try {
    const Loader = PIXI.Loader
    const plugins = Loader && Loader._plugins
    const has = plugins && plugins.some((p) => p && p.use && ns.AtlasParser && p.use === ns.AtlasParser.use)
    if (Loader && ns.AtlasParser && !has) Loader.registerPlugin(ns.AtlasParser)
  } catch (e) {
    void e
  }
  return ns
}

/** 同德州：UMD pixi-spine → window.pixi_spine（Spine 3.8） */
export function loadPixiSpine() {
  const existing = spineNamespace()
  if (existing && existing.Spine) return Promise.resolve(wireSpine(existing))
  if (loading) return loading
  window.PIXI = window.PIXI || PIXI
  loading = new Promise((resolve, reject) => {
    const sc = document.createElement('script')
    sc.src = '/lib/pixi-spine.js'
    sc.onload = () => {
      const ns = spineNamespace()
      if (ns && ns.Spine) resolve(wireSpine(ns))
      else reject(new Error('pixi-spine loaded but Spine class missing'))
    }
    sc.onerror = () => reject(new Error('failed to load /lib/pixi-spine.js'))
    document.head.appendChild(sc)
  })
  return loading
}

export function getSpineClass() {
  const ns = spineNamespace()
  return ns ? ns.Spine : null
}

const DEATH_LIKE = /^(death|die|dead|siwang)/i

export function listAnims(spine) {
  const all = spine && spine.spineData && spine.spineData.animations
  return all ? all.map((a) => a.name) : []
}

/**
 * 选动画：严格按候选；禁止默默回退到 death（部分 juese 第一轨就是 death）
 */
export function pickAnim(spine, candidates, { allowDeath = false } = {}) {
  if (!spine || !spine.state || !spine.state.hasAnimation) return null
  const names = listAnims(spine)
  if (!names.length) return null

  for (const name of candidates || []) {
    if (spine.state.hasAnimation(name)) {
      if (!allowDeath && DEATH_LIKE.test(name)) continue
      return name
    }
  }

  // 软匹配：idle_sword / idle_knife 等
  for (const name of candidates || []) {
    const soft = names.find(
      (n) => n === name || n.startsWith(name + '_') || n.includes(name)
    )
    if (soft && (allowDeath || !DEATH_LIKE.test(soft))) return soft
  }

  // 偏好站立类
  const idlePref = names.find((n) => /^idle/i.test(n) && !DEATH_LIKE.test(n))
  if (idlePref) return idlePref

  const safe = names.find((n) => !DEATH_LIKE.test(n))
  return safe || (allowDeath ? names[0] : null)
}
