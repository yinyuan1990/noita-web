import { SKILL_SEEDS, BASIC_SKILLS } from './skills.js'
import { listParticlePresets } from '../fx/basicParticles.js'

/**
 * 特效导演：技能落点、射线/弹道/命中、与动作节拍对齐
 * 基础粒子预设：explosion dust ray fire electric light snow rain
 */
export class EffectDirector {
  constructor(game) {
    this.game = game
  }

  get fx() {
    return this.game.fx
  }

  /** 通用播放：逻辑技能名 / 粒子预设名 / seffect id */
  async play(skillOrId, opts = {}) {
    return this.fx.play(skillOrId, opts)
  }

  async at(skill, targetId, opts = {}) {
    return this.play(skill, { ...opts, at: targetId, mode: 'at' })
  }

  async projectile(skill, fromId, toId, opts = {}) {
    return this.play(skill, {
      ...opts,
      from: fromId,
      to: toId,
      mode: 'projectile',
    })
  }

  async mid(skill, fromId, toId, opts = {}) {
    return this.play(skill, { ...opts, from: fromId, to: toId, mode: 'mid' })
  }

  /** 八类基础粒子：explosion dust ray fire electric light snow rain */
  async particle(preset, opts = {}) {
    return this.play(preset, opts)
  }

  isBasic(skill) {
    return BASIC_SKILLS.includes(skill)
  }

  listSkills() {
    return Object.keys(SKILL_SEEDS)
  }

  listPresets() {
    return listParticlePresets()
  }
}
