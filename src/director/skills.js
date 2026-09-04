/**
 * 技能逻辑名 → 种子 / 粒子预设 / 附带音效元素
 * 基础粒子贴图：Kenney Particle Pack（/res/particles/textures）
 * 音效元素：wind rain thunder electric water fire explosion impact magic clash
 */

export const SKILL_SEEDS = {
  clash_sparks: 11,
  curse_hit: 21,
  color_ray: 33,
  stun_hold: 34,
  decay_ray: 44,
  magic_missile: 55,
  buff_bull: 66,
  buff_bear: 67,
  sanctuary: 77,
  summon_red: 88,
  sonic_blast: 99,
  flail_orbit: 101,
  heal_tick: 110,
  impact: 120,
  blood_flash: 130,
}

/**
 * 技能特效附带音效（元素键）
 * 剧本 fx 步也可写 "sfx": "fire" 覆盖
 */
export const SKILL_SFX = {
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
  // 基础粒子预设同名
  explosion: 'explosion',
  dust: 'wind',
  ray: 'electric',
  fire: 'fire',
  electric: 'electric',
  light: 'magic',
  snow: 'wind',
  rain: 'rain',
}

/** 走 Kenney 基础粒子（非 seffect Spine） */
export const BASIC_SKILLS = [
  'color_ray',
  'decay_ray',
  'magic_missile',
  'missile',
  'curse_hit',
  'impact',
  'blood_flash',
  'clash_sparks',
  'explosion',
  'dust',
  'ray',
  'fire',
  'electric',
  'light',
  'snow',
  'rain',
]
