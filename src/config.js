import { jueseAt } from './data/jueseIndex.js'

export const DESIGN_WIDTH = 1920
export const DESIGN_HEIGHT = 1080

export const RES = {
  juese: '/res/juese',
  jineng: '/res/jineng',
  spine: '/res/spine',
}

/**
 * 世界尺度（人物 ↔ 战场一起定）
 *
 * humanScreenRatio: 人类 size=1 占画布高
 *   0.14 ≈ 151px@1080 —— 可读；人多时只收站位，体型下限见 MIN_HUMAN_RATIO
 * humanHalfWOverH: 半肩宽 / 身高 → 站位间距、突进停距
 * front/backDepthScale: 前后排透视
 * contactPad: 突进额外空隙 px
 */
export const WORLD = {
  humanScreenRatio: 0.14,
  humanHalfWOverH: 0.2,
  frontDepthScale: 1.0,
  backDepthScale: 0.9,
  /** 近身刀口距离（半肩之外再留这点空）；要贴身别加大 */
  contactPad: 4,
  /** 对砍停距相对 contactGap 的倍率（<1 更贴） */
  meleeGapMul: 0.55,
  yStep: 0.05,
  /** 人潮也不得把人缩过这个屏高比（防越打越小成点） */
  minHumanRatio: 0.12,
  /** 相对舞台基准最多再缩到该倍数 */
  minHumanMul: 0.9,
}

/**
 * 体型基准：人类 size = 1（在 WORLD 尺度之上）
 *
 *   humanH    = DESIGN_HEIGHT × WORLD.humanScreenRatio
 *   unitScale = humanH / nativeH   （消掉各 skel 导出尺度差）
 *   渲染      = unitScale × size × buff × depth
 *
 * size: 相对人类（人=1；兽>1）
 * nativeH: 可选手写覆盖
 * nativeFace: juese 横版多为面左
 */
export const CAST = {
  lelin: { folder: 'dongwushuang', label: '乐琳', size: 1, nativeFace: 'left' },
  lansika: { folder: 'guanghanxianzi', label: '兰丝卡', size: 1, nativeFace: 'left' },
  jiruifu: { folder: 'duanyu', label: '吉瑞夫', size: 1, nativeFace: 'left' },
  kesijia: { folder: 'fengqingyang', label: '克斯迦', size: 1, nativeFace: 'left' },
  nvwei: { folder: 'azhu', label: '卓尔女卫', size: 1, nativeFace: 'left' },
  zhencha: { folder: 'hongqigong', label: '卓尔斥候', size: 0.95, nativeFace: 'left' },
  zhanshi: { folder: 'hubadao', label: '卓尔战士', size: 1.05, nativeFace: 'left' },

  jakaluo: {
    folder: jueseAt(42),
    label: '贾卡罗',
    size: 1.08,
    nativeFace: 'left',
    jueseIndex: 42,
  },
  motiya: {
    folder: jueseAt(150),
    label: '莫蒂亚',
    size: 1,
    nativeFace: 'left',
    jueseIndex: 150,
  },
  /** 炼狱毒蛇：Boss_long 暗红蛇形巨兽（原 jueseAt(82) 是狼，形不对）；有 skill1/2/3 攻击动画 */
  hellsnake: {
    folder: 'Boss_long',
    label: '炼狱毒蛇',
    size: 1.85,
    nativeFace: 'left',
    jueseIndex: 12,
  },
  /** 狄姆尼：祭司学院中级教官（daji 图集损坏，改用 meichaofeng） */
  dimuni: { folder: 'meichaofeng', label: '狄姆尼', size: 1.08, nativeFace: 'left' },
  /** 开口的另一名女教官（「绝后」那句） */
  jiaoguan: { folder: 'zhouzhiruo', label: '祭司教官', size: 1, nativeFace: 'left' },
}

/** 体型读取（缺省按人=1） */
export function bodySizeOf(id) {
  const c = CAST[id]
  if (!c) return 1
  if (c.size != null) return c.size
  return 1
}

/** 人类目标身高（px）；舞台 formation.humanRatio 可覆盖 */
export function humanHeightPx(stageFormation = null) {
  const ratio =
    stageFormation?.humanRatio != null ? stageFormation.humanRatio : WORLD.humanScreenRatio
  return DESIGN_HEIGHT * ratio
}

/** 人类半肩宽（屏幕归一化 x）；随身高联动 */
export function humanHalfWNorm(stageFormation = null) {
  const hNorm =
    (stageFormation?.humanRatio != null ? stageFormation.humanRatio : WORLD.humanScreenRatio) *
    (DESIGN_HEIGHT / DESIGN_WIDTH)
  return hNorm * WORLD.humanHalfWOverH
}

export const CHAPTER2_CAST_IDS = [
  'lelin',
  'lansika',
  'jiruifu',
  'kesijia',
  'nvwei',
  'zhencha',
  'zhanshi',
  'jakaluo',
  'motiya',
  'hellsnake',
]

/** 无舞台配置时的兜底站位（回合制 2.5D 脚底） */
export const DEFAULT_SLOTS = {
  hide: { x: 192, y: 972 },
  party1: { x: 422, y: 930 },
  party2: { x: 650, y: 950 },
  party3: { x: 880, y: 930 },
  left: { x: 538, y: 886 },
  center: { x: 960, y: 778 },
  right: { x: 1382, y: 518 },
  party4: { x: 576, y: 820 },
  party5: { x: 960, y: 820 },
  party6: { x: 1267, y: 540 },
  far_left: { x: 346, y: 864 },
  far_right: { x: 1498, y: 454 },
  off_left: { x: -150, y: 886 },
  off_right: { x: 2070, y: 540 },
}

export const ANIM_ALIASES = {
  idle: [
    'idle',
    'idle_sword',
    'idle_knife',
    'idle_fan',
    'idle_crossbow',
    'idle_mount',
    'daiji',
    'stand',
    'holdon',
    'breath',
    'animation',
  ],
  talk: ['talk', 'speak', 'say', 'idle', 'idle_sword', 'idle_knife', 'daiji', 'holdon'],
  walk: ['run', 'walk', 'move', 'go', 'zou', 'idle_sword', 'idle_knife', 'idle'],
  jump: ['jump', 'skill1', 'skill', 'att', 'attack', 'win', 'show', 'run'],
  attack: ['attack', 'att', 'skill1', 'skill2', 'skill', 'jump', 'win', 'show', 'idle_sword', 'idle_knife'],
  /** 受击绝不能落到 death，否则敌人会一直倒地 */
  hit: ['hit', 'hurt', 'damage', 'idle_sword', 'idle_knife', 'idle'],
  die: ['death', 'die', 'dead'],
  skill: ['skill1', 'skill2', 'skill', 'attack', 'att', 'jump', 'show'],
}

/** 本章出场的全部角色 id（预加载用） */
export const CHAPTER1_CAST_IDS = [
  'lelin',
  'lansika',
  'jiruifu',
  'kesijia',
  'nvwei',
  'zhencha',
  'zhanshi',
]
