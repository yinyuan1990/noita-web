import {
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  WORLD,
  bodySizeOf,
  humanHalfWNorm,
  humanHeightPx,
} from '../config.js'

/**
 * 镜头：单屏回合制战场
 */
export const CAMERA_POLICY = {
  leads: ['lelin', 'lansika', 'jakaluo', 'motiya'],
  sayAutoFocus: false,
  zoomMin: 0.92,
  zoomMax: 1.04,
  focusBias: 0.25,
  followLerp: 0.03,
  followZoomLerp: 0.02,
  allowShake: false,
}

/**
 * 回合制占位：左我 / 右敌 · 纵列为主（i 控上下，rank 控前后）
 *
 * team: 'party' | 'foe'
 * rank: 0 前排（靠中线）· 1 中排 · 2 后排（靠边）
 * i:    同排从上到下（远→近）
 *
 * 绝对坐标：{ x, y } 归一化，不参与动态打包
 */
export const FORMATIONS = {
  party_six: [
    { id: 'nvwei', team: 'party', rank: 0, i: 0 },
    { id: 'lansika', team: 'party', rank: 0, i: 1 },
    { id: 'kesijia', team: 'party', rank: 0, i: 2 },
    { id: 'zhanshi', team: 'party', rank: 1, i: 0 },
    { id: 'zhencha', team: 'party', rank: 1, i: 1 },
    { id: 'jiruifu', team: 'party', rank: 1, i: 2 },
  ],
  party_seven: [
    { id: 'lansika', team: 'party', rank: 0, i: 0 },
    { id: 'lelin', team: 'party', rank: 0, i: 1 },
    { id: 'kesijia', team: 'party', rank: 0, i: 2 },
    { id: 'nvwei', team: 'party', rank: 1, i: 0 },
    { id: 'zhanshi', team: 'party', rank: 1, i: 1 },
    { id: 'zhencha', team: 'party', rank: 1, i: 2 },
    { id: 'jiruifu', team: 'party', rank: 2, i: 1 },
  ],
  party_seven_narrow: [
    { id: 'lansika', team: 'party', rank: 0, i: 0 },
    { id: 'lelin', team: 'party', rank: 0, i: 1 },
    { id: 'kesijia', team: 'party', rank: 0, i: 2 },
    { id: 'nvwei', team: 'party', rank: 1, i: 0 },
    { id: 'zhanshi', team: 'party', rank: 1, i: 1 },
    { id: 'zhencha', team: 'party', rank: 1, i: 2 },
    { id: 'jiruifu', team: 'party', rank: 2, i: 1 },
  ],
  ambush_faceoff: [
    { id: 'lansika', team: 'party', rank: 0, i: 0 },
    { id: 'lelin', team: 'party', rank: 0, i: 1 },
    { id: 'kesijia', team: 'party', rank: 0, i: 2 },
    { id: 'nvwei', team: 'party', rank: 1, i: 0 },
    { id: 'zhanshi', team: 'party', rank: 1, i: 1 },
    { id: 'zhencha', team: 'party', rank: 1, i: 2 },
    { id: 'jiruifu', team: 'party', rank: 2, i: 1 },
    { id: 'jakaluo', team: 'foe', rank: 0, i: 1 },
  ],
  ambush_priest: [
    { id: 'lansika', team: 'party', rank: 0, i: 0 },
    { id: 'lelin', team: 'party', rank: 0, i: 1 },
    { id: 'kesijia', team: 'party', rank: 0, i: 2 },
    { id: 'nvwei', team: 'party', rank: 1, i: 0 },
    { id: 'zhanshi', team: 'party', rank: 1, i: 1 },
    { id: 'zhencha', team: 'party', rank: 1, i: 2 },
    { id: 'jiruifu', team: 'party', rank: 2, i: 1 },
    { id: 'jakaluo', team: 'foe', rank: 0, i: 1 },
    { id: 'motiya', team: 'foe', rank: 1, i: 0 },
  ],
  /** 乐琳压到中场对蛇/莫蒂亚；毒蛇占敌前排 */
  ambush_snake: [
    { id: 'lansika', team: 'party', rank: 0, i: 0 },
    { id: 'kesijia', team: 'party', rank: 0, i: 1 },
    { id: 'nvwei', team: 'party', rank: 1, i: 0 },
    { id: 'zhanshi', team: 'party', rank: 1, i: 1 },
    { id: 'zhencha', team: 'party', rank: 1, i: 2 },
    { id: 'jiruifu', team: 'party', rank: 2, i: 1 },
    { id: 'lelin', team: 'party', rank: 0, i: 1, x: 0.46, y: 0.74 },
    { id: 'jakaluo', team: 'foe', rank: 0, i: 0 },
    { id: 'hellsnake', team: 'foe', rank: 0, i: 2 },
    { id: 'motiya', team: 'foe', rank: 1, i: 0 },
  ],
  /** 背叛：克斯迦站到贾卡罗侧；同伴已倒地不在阵 */
  betrayal: [
    { id: 'lansika', team: 'party', rank: 0, i: 1 },
    { id: 'lelin', team: 'party', rank: 0, i: 2, x: 0.4, y: 0.76 },
    { id: 'hellsnake', team: 'foe', rank: 0, i: 2 },
    { id: 'motiya', team: 'foe', rank: 1, i: 0 },
    { id: 'jakaluo', team: 'foe', rank: 0, i: 1 },
    { id: 'kesijia', team: 'foe', rank: 0, i: 0, face: 'left' },
  ],
}

export const BEATS = {
  openWide: { camera: { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5, zoom: 1, ms: 0 } },
  lelinSolo: { camera: { focus: 'lelin', zoom: 1.02, ms: 800 } },
  partyArrive: { camera: { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5, zoom: 0.98, ms: 900 } },
  lelinReveal: { camera: { focus: 'lelin', zoom: 1.02, ms: 700 } },
  talkWide: { camera: { x: DESIGN_WIDTH * 0.5, y: DESIGN_HEIGHT * 0.5, zoom: 0.98, ms: 600 } },
  exitMarch: { camera: { zoom: 0.98, follow: false } },
}

/** 战场可用纵带 / 中线禁区（归一化） */
const ARENA = {
  yMin: 0.52,
  yMax: 0.86,
  partyMaxX: 0.46,
  foeMinX: 0.54,
  /** 同排超过此人数 → 强制拆排 */
  maxPerRank: 3,
  /** 单队超过此人数 → 启用 3 排 */
  threeRankAt: 7,
}

const DEFAULT_BAND = {
  partyX: 0.24,
  foeX: 0.76,
  gap: 1.2,
  frontY: 0.76,
  backY: 0.64,
  midY: 0.7,
  frontScale: WORLD.frontDepthScale,
  backScale: WORLD.backDepthScale,
  midScale: 0.95,
  yStep: WORLD.yStep,
  humanRatio: WORLD.humanScreenRatio,
}

/** 永远读舞台冻结基准，禁止读已被人潮改过的 humanRatio */
export function bandBaseRatio(band = null) {
  const b = band || {}
  if (b.humanRatioBase != null) return b.humanRatioBase
  return WORLD.humanScreenRatio
}

/**
 * 人潮策略：人数↑ → 优先拆排/错开；体型只轻微下调且有硬下限
 * （禁止用已缩小的 humanRatio 再乘 — 否则越 rest 越小成点）
 *
 * | 单队人数 | humanMul | 排数策略 |
 * | ≤5 | 1.0 | 同排>3 拆排 |
 * | 6 | 0.95 | 强制 2 排 |
 * | ≥7 | 0.9 | 强制 3 排 |
 */
export function buildCrowdPolicy(def, band = null) {
  const b = { ...DEFAULT_BAND, ...(band || {}) }
  const dynamic = (def || []).filter((m) => m.x == null)
  let maxTeam = 0
  let maxRow = 0
  for (const team of ['party', 'foe']) {
    const members = dynamic.filter((m) => (m.team || 'party') === team)
    maxTeam = Math.max(maxTeam, members.length)
    const ranks = new Map()
    for (const m of members) {
      const r = m.rank != null ? m.rank : 0
      ranks.set(r, (ranks.get(r) || 0) + 1)
    }
    for (const n of ranks.values()) maxRow = Math.max(maxRow, n)
  }

  let humanMul = 1
  if (maxTeam >= 7) humanMul = 0.9
  else if (maxTeam >= 6) humanMul = 0.95

  const minMul = WORLD.minHumanMul != null ? WORLD.minHumanMul : 0.9
  humanMul = Math.max(humanMul, minMul)

  const base = bandBaseRatio(b)
  const minR = WORLD.minHumanRatio != null ? WORLD.minHumanRatio : 0.12
  const humanRatio = Math.max(minR, base * humanMul)

  const ranksTarget =
    maxTeam >= ARENA.threeRankAt ? 3 : maxTeam >= 6 || maxRow > ARENA.maxPerRank ? 2 : null

  return {
    humanMul: humanRatio / base,
    maxTeam,
    maxRow,
    ranksTarget,
    baseHumanRatio: base,
    humanRatio,
    cramped: false,
  }
}

/** 同排超员时重分配 rank/i（保持相对顺序） */
export function rebalanceRanks(members, ranksTarget, maxPerRank = ARENA.maxPerRank) {
  if (!members.length) return []
  const sorted = members
    .slice()
    .sort((a, b) => {
      const ra = a.rank != null ? a.rank : 0
      const rb = b.rank != null ? b.rank : 0
      if (ra !== rb) return ra - rb
      return (a.i ?? 0) - (b.i ?? 0)
    })

  const rankCounts = new Map()
  for (const m of sorted) {
    const r = m.rank != null ? m.rank : 0
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1)
  }
  const maxRow = Math.max(0, ...rankCounts.values())
  const nRanksNow = rankCounts.size

  // 已满足：每排≤上限，且排数够用 → 保留作者站位，只规范化 i
  if (maxRow <= maxPerRank && (ranksTarget == null || nRanksNow >= ranksTarget)) {
    const byRank = new Map()
    for (const m of sorted) {
      const r = m.rank != null ? m.rank : 0
      if (!byRank.has(r)) byRank.set(r, [])
      byRank.get(r).push(m)
    }
    const out = []
    for (const r of [...byRank.keys()].sort((a, c) => a - c)) {
      byRank.get(r).forEach((m, i) => out.push({ ...m, rank: r, i }))
    }
    return out
  }

  const nRanks =
    ranksTarget != null
      ? ranksTarget
      : sorted.length > 6
        ? 3
        : sorted.length > maxPerRank
          ? 2
          : 1

  const quotas = Array.from({ length: nRanks }, (_, r) => {
    const base = Math.floor(sorted.length / nRanks)
    const rem = sorted.length % nRanks
    return base + (r < rem ? 1 : 0)
  })
  const out = []
  let idx = 0
  for (let r = 0; r < nRanks; r++) {
    const q = quotas[r]
    for (let j = 0; j < q; j++) {
      const m = sorted[idx++]
      out.push({ ...m, rank: r, i: j })
    }
  }
  return out
}

/**
 * 单排纵距拟合：只压间距，不改体型（体型由 crowd 上限一次定死）
 */
function fitRowSpacing(n, yBand, humanRatio) {
  if (n <= 1) {
    return { yStep: 0, cramped: false }
  }
  // 脚距 ≈ 0.42×身高
  let yStep = Math.max(0.038, humanRatio * 0.42)
  let cramped = false
  if (yStep * (n - 1) > yBand) {
    yStep = yBand / (n - 1)
    cramped = yStep < humanRatio * 0.3
  }
  return { yStep, cramped }
}

function rankBaseX(team, rank, nRanks, band) {
  const toward = team === 'party' ? 1 : -1
  const block = team === 'party' ? band.partyX : band.foeX
  // 前排靠中、后排靠边；排间拉开，避免前后排脚位叠影
  const t = nRanks <= 1 ? 0 : rank / (nRanks - 1)
  const shift = (0.1 - t * 0.2) * toward
  return block + shift
}

function rankBaseY(rank, nRanks, band) {
  if (nRanks <= 1) return band.frontY != null ? band.frontY : 0.76
  if (nRanks === 2) {
    return rank === 0
      ? band.frontY != null
        ? band.frontY
        : 0.76
      : band.backY != null
        ? band.backY
        : 0.64
  }
  // 3 排
  if (rank === 0) return band.frontY != null ? band.frontY : 0.78
  if (rank === 1) return band.midY != null ? band.midY : 0.7
  return band.backY != null ? band.backY : 0.62
}

function rankDepthScale(rank, nRanks, band) {
  if (rank === 0) return band.frontScale ?? WORLD.frontDepthScale
  if (nRanks >= 3 && rank === 1) return band.midScale ?? 0.95
  return band.backScale ?? WORLD.backDepthScale
}

/**
 * 动态阵型打包（人数 / 边界 / 错开）
 * @returns {{ spots: object[], policy: object }}
 */
export function packFormation(def, cx = DESIGN_WIDTH / 2, band = null) {
  const b = { ...DEFAULT_BAND, ...(band || {}) }
  let policy = buildCrowdPolicy(def, b)
  const spots = []
  // 渲染体型一次定死，后续 rest/hold 不得再抠小
  const renderHuman = policy.humanRatio

  // 绝对定点
  for (const m of def || []) {
    if (m.x == null) continue
    const team = m.team || (m.face === 'left' ? 'foe' : 'party')
    const face = m.face || (team === 'foe' ? 'left' : 'right')
    const yN = m.y != null ? m.y : b.frontY
    spots.push({
      id: m.id,
      x: m.x * DESIGN_WIDTH,
      y: yN * DESIGN_HEIGHT,
      face,
      depth: yN,
      depthScale: rankDepthScale(m.rank != null ? m.rank : 0, 2, b),
      size: bodySizeOf(m.id),
      team,
      rank: m.rank != null ? m.rank : 0,
    })
  }

  for (const team of ['party', 'foe']) {
    const raw = (def || []).filter((m) => m.x == null && (m.team || 'party') === team)
    if (!raw.length) continue

    const balanced = rebalanceRanks(raw, policy.ranksTarget, ARENA.maxPerRank)
    const rankIds = [...new Set(balanced.map((m) => m.rank))].sort((a, c) => a - c)
    const nRanks = Math.max(1, rankIds.length)

    // 每排可用纵带：总带按排切开，避免前后排脚位撞车
    const totalBand = ARENA.yMax - ARENA.yMin
    const rankBand = totalBand / (nRanks + 0.35)

    for (const rank of rankIds) {
      const row = balanced
        .filter((m) => m.rank === rank)
        .sort((a, c) => (a.i ?? 0) - (c.i ?? 0))
      const n = row.length
      const baseY = clamp(rankBaseY(rank, nRanks, b), ARENA.yMin + 0.02, ARENA.yMax - 0.02)
      // 该排可用高度：以 baseY 为中心，夹在总带内
      const yLo = Math.max(ARENA.yMin, baseY - rankBand * 0.45)
      const yHi = Math.min(ARENA.yMax, baseY + rankBand * 0.45)
      const yAvail = Math.max(0.06, yHi - yLo)

      const fit = fitRowSpacing(n, yAvail, renderHuman)
      if (fit.cramped) policy = { ...policy, cramped: true }

      const mid = (n - 1) / 2
      const blockX = rankBaseX(team, rank, nRanks, b)
      // 干净斜列：随 y 增大（更近）向屏幕外侧斜一点，读得出纵深
      // 斜率跟 yStep 联动，保证整列一条直线，不再锯齿乱跳
      const diagN = fit.yStep * (DESIGN_HEIGHT / DESIGN_WIDTH) * 0.62
      const toward = team === 'party' ? 1 : -1

      for (let i = 0; i < n; i++) {
        const m = row[i]
        const face = m.face || (team === 'foe' ? 'left' : 'right')
        let yN = baseY + (i - mid) * fit.yStep
        yN = clamp(yN, ARENA.yMin, ARENA.yMax)

        // 越近（i 越大）越靠外：party 往左斜、foe 往右斜
        let xN = blockX - (i - mid) * diagN * toward

        if (team === 'party') xN = Math.min(xN, ARENA.partyMaxX)
        else xN = Math.max(xN, ARENA.foeMinX)
        xN = clamp(xN, 0.06, 0.94)

        spots.push({
          id: m.id,
          x: xN * DESIGN_WIDTH,
          y: yN * DESIGN_HEIGHT,
          face,
          depth: yN,
          depthScale: rankDepthScale(rank, nRanks, b),
          size: bodySizeOf(m.id),
          team,
          rank,
        })
      }
    }
  }

  // 同队最小间距推开（脚底距离 ≈ 0.5×身高）
  const minDist = humanHeightPx({ humanRatio: renderHuman }) * 0.5
  separateTeamSpots(spots, minDist)

  policy = {
    ...policy,
    humanRatio: renderHuman,
    humanMul: renderHuman / (policy.baseHumanRatio || WORLD.humanScreenRatio),
    cramped: !!policy.cramped,
    minDist,
  }

  return { spots, policy }
}

/** 同队互推，优先左右错开，其次上下；不越过中线禁区；间距按体型放大 */
function separateTeamSpots(spots, minDist) {
  if (!spots?.length || !(minDist > 0)) return
  for (let iter = 0; iter < 8; iter++) {
    let moved = false
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i]
        const b = spots[j]
        if (a.team !== b.team) continue
        // 大体型（毒蛇等）需要更大脚距，防止贴脸叠影
        const need = minDist * (((a.size || 1) + (b.size || 1)) / 2)
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= need || d < 1e-3) {
          if (d < 1e-3) {
            dx = (i % 2 === 0 ? 1 : -1) * 12
            dy = 18
            d = Math.hypot(dx, dy)
          } else continue
        }
        const push = ((need - d) / d) * 0.5
        const ox = dx * push
        const oy = dy * push
        a.x -= ox
        a.y -= oy
        b.x += ox
        b.y += oy
        moved = true
      }
    }
    for (const s of spots) {
      let xN = s.x / DESIGN_WIDTH
      let yN = s.y / DESIGN_HEIGHT
      if (s.team === 'party') xN = Math.min(xN, ARENA.partyMaxX)
      else if (s.team === 'foe') xN = Math.max(xN, ARENA.foeMinX)
      xN = clamp(xN, 0.06, 0.94)
      yN = clamp(yN, ARENA.yMin, ARENA.yMax)
      s.x = xN * DESIGN_WIDTH
      s.y = yN * DESIGN_HEIGHT
      s.depth = yN
    }
    if (!moved) break
  }
}

/** @deprecated 用 packFormation；保留兼容 */
export function formationToWorld(m, cx = DESIGN_WIDTH / 2, band = null, peers = null) {
  const def = peers || [m]
  const { spots } = packFormation(def, cx, band)
  return spots.find((s) => s.id === m.id) || spots[0]
}

export function resolveFormationSpots(def, cx, band) {
  return packFormation(def, cx, band).spots
}

export function resolveFormationPack(def, cx, band) {
  return packFormation(def, cx, band)
}

export function isLead(id) {
  return CAMERA_POLICY.leads.includes(id)
}

export function clampZoom(z) {
  if (z == null) return z
  return Math.max(CAMERA_POLICY.zoomMin, Math.min(CAMERA_POLICY.zoomMax, z))
}

/** 躯干停距（站桩）；近身请用 meleeGap */
export function contactGap(idA, idB, pad = WORLD.contactPad) {
  const half = humanHalfWNorm() * DESIGN_WIDTH
  return half * bodySizeOf(idA) + half * bodySizeOf(idB) + pad
}

/** 近身搏斗停距：必须挨在一起，不是远程对轰 */
export function meleeGap(idA, idB) {
  const mul = WORLD.meleeGapMul != null ? WORLD.meleeGapMul : 0.55
  return Math.max(28, contactGap(idA, idB) * mul)
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
