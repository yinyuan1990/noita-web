/**
 * 舞台：M387 回合制战斗背景（远 / 中 / 近）
 * 站位 / 体型跟 config.WORLD 联动；单舞台可用 humanRatio 微调
 */
import { DESIGN_HEIGHT, WORLD } from '../config.js'

/** 槽位（direct.enter 用）：与阵型同一套左右战场 */
const BATTLE_SLOTS = {
  // 我方左
  party_fl: { x: 0.18, y: 0.76 },
  party_f: { x: 0.28, y: 0.78 },
  party_fr: { x: 0.38, y: 0.76 },
  party_bl: { x: 0.2, y: 0.68 },
  party_b: { x: 0.3, y: 0.68 },
  party_br: { x: 0.4, y: 0.68 },
  party_lead: { x: 0.32, y: 0.72 },
  // 敌方右
  foe_fl: { x: 0.62, y: 0.76 },
  foe_f: { x: 0.72, y: 0.78 },
  foe_fr: { x: 0.82, y: 0.76 },
  foe_bl: { x: 0.64, y: 0.66 },
  foe_b: { x: 0.74, y: 0.66 },
  foe_br: { x: 0.84, y: 0.66 },
  hide: { x: 0.06, y: 0.8 },
  left: { x: 0.26, y: 0.76 },
  center: { x: 0.5, y: 0.72 },
  right: { x: 0.74, y: 0.76 },
  far_left: { x: 0.14, y: 0.7 },
  far_right: { x: 0.86, y: 0.68 },
  off_left: { x: -0.08, y: 0.76 },
  off_right: { x: 1.08, y: 0.76 },
  party1: { x: 0.18, y: 0.76 },
  party2: { x: 0.28, y: 0.78 },
  party3: { x: 0.38, y: 0.76 },
  party4: { x: 0.22, y: 0.68 },
  party5: { x: 0.32, y: 0.68 },
  party6: { x: 0.42, y: 0.68 },
}

function battleStage(id, label, pack) {
  const form = {
    partyX: 0.3,
    foeX: 0.72,
    gap: 1,
    frontY: 0.76,
    backY: 0.68,
    frontScale: WORLD.frontDepthScale,
    backScale: WORLD.backDepthScale,
    yStep: WORLD.yStep,
    humanRatio: WORLD.humanScreenRatio,
    ...(pack.formation || {}),
  }
  // 冻结基准：运行时 humanRatio 可被人潮微调，打包永远读 Base
  form.humanRatioBase = form.humanRatio
  return {
    id,
    label,
    height: DESIGN_HEIGHT,
    mode: 'battle',
    slots: BATTLE_SLOTS,
    groundY: DESIGN_HEIGHT * (form.frontY != null ? form.frontY : 0.76),
    startScreen: 0,
    parallax: { far: 0.15, mid: 1, near: 1.05 },
    formation: form,
    pack: {
      dir: `/res/m387/${pack.folder}`,
      nativeH: pack.nativeH || 640,
      groundNativeY: pack.groundNativeY != null ? pack.groundNativeY : 500,
      mid: pack.mid,
      floors: pack.floors,
      near: pack.near,
      nearProps: pack.nearProps || [],
      nearMaxH: pack.nearMaxH != null ? pack.nearMaxH : 0.14,
      nearScale: pack.nearScale,
      nearAlpha: pack.nearAlpha,
      fit: pack.fit || 'cover',
    },
  }
}

export const STAGES = {
  cave_tunnel: battleStage('cave_tunnel', '暗域·荒径', {
    folder: 'Chapter2',
    mid: 'floor01.jpg',
    near: 'font01.png',
    nearMaxH: 0.12,
    nearAlpha: 0.5,
    nearProps: [
      { file: 'font02.png', side: 'right', h: 0.14, maxW: 0.18, alpha: 0.45 },
      { file: 'font03.png', side: 'left', h: 0.12, maxW: 0.16, alpha: 0.45 },
    ],
    groundNativeY: 480,
    formation: {
      partyX: 0.22,
      foeX: 0.78,
      frontY: 0.78,
      midY: 0.7,
      backY: 0.62,
      humanRatio: 0.14,
      gap: 1.25,
    },
  }),
  cave_fork: battleStage('cave_fork', '暗域·岔口', {
    folder: 'Chapter2',
    mid: 'floor02.jpg',
    near: 'font04.png',
    nearMaxH: 0.12,
    nearAlpha: 0.5,
    nearProps: [{ file: 'font05.png', side: 'right', h: 0.14, maxW: 0.18, alpha: 0.45 }],
    groundNativeY: 490,
    formation: {
      partyX: 0.22,
      foeX: 0.78,
      frontY: 0.8,
      midY: 0.72,
      backY: 0.64,
      humanRatio: 0.14,
      gap: 1.3,
    },
  }),
  cave_narrow: battleStage('cave_narrow', '魔塔·石廊', {
    folder: 'tower',
    mid: 'floor.jpg',
    near: false,
    nearProps: [],
    groundNativeY: 400,
    formation: {
      partyX: 0.24,
      foeX: 0.76,
      frontY: 0.68,
      midY: 0.6,
      backY: 0.52,
      humanRatio: 0.135,
      gap: 1.25,
      backScale: 0.9,
    },
  }),
  arena_m387: battleStage('arena_m387', '暗域·浮石', {
    folder: 'arena',
    mid: 'floor.jpg',
    near: 'front.png',
    nearMaxH: 0.12,
    nearAlpha: 0.5,
    nearProps: [
      { file: 'front01.png', side: 'left', h: 0.16, maxW: 0.16, alpha: 0.4 },
      { file: 'front02.png', side: 'right', h: 0.16, maxW: 0.16, alpha: 0.4 },
    ],
    groundNativeY: 500,
    formation: {
      partyX: 0.22,
      foeX: 0.78,
      frontY: 0.78,
      midY: 0.7,
      backY: 0.62,
      humanRatio: 0.14,
      gap: 1.25,
    },
  }),
}

export { BATTLE_SLOTS as ARENA_SLOTS }
