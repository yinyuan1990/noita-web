// ── 投射物定义 data/entities/projectiles/deck/*.xml → public/res/noita/projectiles.json + 贴图 proj/ ──
// 每条:速度/寿命/重力/空气阻力(VelocityComponent+ProjectileComponent)、爆炸配置(config_explosion)、
// 精灵(SpriteComponent → Sprite xml:图/帧/偏移/additive)、拖尾粒子发射器(ParticleEmitterComponent:材质色/数量/寿命/速度/乱流)、
// 光(LightComponent rgb 半径)、发射闪光(shoot_light_flash_*)、枪口火焰。用法:node scripts/noita-prepare-projectiles.mjs
import fs from 'fs'
import path from 'path'

const UNPACKED = 'noita-ref/unpacked'
const OUT = 'public/res/noita'
// 先做玩家常用法术的投射物(其余同样格式,想加往这里塞名字即可)
const NAMES = [
  'light_bullet', 'light_bullet_blue', 'bullet', 'bullet_heavy', 'bullet_slow', 'glowing_bolt', 'fireball', 'iceball', 'lance', 'arrow',
  'digger', 'powerdigger', 'bomb', 'grenade', 'rocket', 'disc_bullet', 'spitter', 'acidshot', 'bubbleshot', 'slime', 'rock',
  'material_water', 'material_oil', 'material_acid', 'material_lava', 'material_gunpowder_explosive', 'chain_bolt', 'laser', 'meteor', 'firebomb', 'pebble_player',
  'rubber_ball', 'bouncy_orb', 'bounce_spark', 'glue_shot', 'grenade_large', 'disc_bullet_big',
  'circle_fire', 'circle_water', 'circle_oil', 'circle_acid', 'touch_water', 'touch_oil', 'touch_gold', 'crumbling_earth', 'luminous_drill', 'chainsaw', 'pink_orb', 'lance_holy',
  'bomb', 'bomb_small', 'bomb_holy', 'teleport_projectile', 'teleport_projectile_short', 'teleport_projectile_static', 'teleport_projectile_closer', 'teleport_cast',
  // level_1_wand.lua 会掷到的其余卡
  'light_bullet_air', 'tentacle_portal', 'black_hole_big', 'tnt', 'glitter_bomb', 'mine', 'cloud_water', 'xray', 'freeze_field', 'black_hole', 'shield_field', 'electrocution_field', 'chunk_of_soil',
]
const attrsOf = (s) => { const o = {}; for (const m of (s || '').matchAll(/([\w:.\-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }
const num = (v, d) => (v === undefined ? d : +v)
const readFile = (rel) => { const p = `${UNPACKED}/${rel.replace(/^data\//, '')}`; return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }

fs.mkdirSync(`${OUT}/proj`, { recursive: true })
const copied = new Set()
const copyGfx = (rel) => {
  if (!rel) return null
  const src = `${UNPACKED}/${rel.replace(/^data\//, '')}`
  if (!fs.existsSync(src)) return null
  const name = rel.replace(/^data\//, '').replace(/\//g, '_')
  if (!copied.has(name)) { fs.copyFileSync(src, `${OUT}/proj/${name}`); copied.add(name) }
  return name
}
/** Sprite xml → {image, offX, offY, fw, fh, frames, wait, loop} */
function sprite(rel) {
  if (!rel) return null
  if (rel.endsWith('.png')) return { image: copyGfx(rel), offX: 0, offY: 0, fw: 0, fh: 0, frames: 1, wait: 0.1, loop: 1 }
  const s = readFile(rel)
  if (!s) return null
  const sp = attrsOf((/<Sprite\b([^>]*)>/.exec(s) || [])[1])
  const anims = [...s.matchAll(/<RectAnimation\b([^>]*)>/g)].map((m) => attrsOf(m[1]))
  const a = anims.find((x) => x.name === (sp.default_animation || 'default')) || anims[0] || {}
  const anim = (x) => ({ fw: num(x.frame_width, 0), fh: num(x.frame_height, 0), frames: num(x.frame_count, 1), wait: num(x.frame_wait, 0.1), loop: num(x.loop, 1), posX: num(x.pos_x, 0), posY: num(x.pos_y, 0), shrink: x.shrink_by_one_pixel === '1' })
  // loop=0 的动画播完接 next_animation(场类 blast:spawn 5 帧 → fireball 行一直脉动);Sprite 的 color_r/g/b 是整张图的染色(blast_frozen 淡蓝 / blast_shield 青)
  const nx = a.next_animation ? anims.find((x) => x.name === a.next_animation) : null
  const tint = sp.color_r !== undefined || sp.color_g !== undefined || sp.color_b !== undefined ? [num(sp.color_r, 1), num(sp.color_g, 1), num(sp.color_b, 1)] : null
  return { image: copyGfx(sp.filename), offX: num(sp.offset_x, 0), offY: num(sp.offset_y, 0), ...anim(a), next: nx ? anim(nx) : null, tint }
}

// 敌人用的弹(AnimalAI attack_ranged_entity_file,在 projectiles/ 根目录,和 deck/ 同名的不是一回事):键名加 e_ 前缀
const ENEMY = [
  'tnt', 'buckshot', 'fireball', 'radioactive_blob', 'acidshot',
  // 挖掘场
  'fireball_firebug', 'fireball_bigfirebug', 'glitter_bomb', 'bat', 'mine', 'fireball_ghostly', 'thunderball', 'orb_hearty', 'orb_cursed', 'grenade_leader',
  // 雪窟
  'ice', 'grenade_scavenger', 'machinegun_bullet_slower', 'coward_bullet', 'sniperbullet', 'rocket_tank', 'thunderball_line', 'pebble', 'iceball',
  'orb_neutral', 'orb_tele', 'orb_dark', 'orb_swapper', 'polyorb', 'lightning_thunderskull', 'glue_shot',
  // 雪城堡
  'healshot', 'healshot_slow', 'megalaser_blue', 'laser_turret', 'deck/sausage',
  // 真菌洞
  'acidburst', 'smalltentacle_melee', 'freeze_circle', 'invisshot', 'orb_poly', 'slimetrail', 'orb_twitchy', 'machinegun_bullet_slow',
  // 丛林
  'orb_tiny', 'bullet_poison', 'laser_spear', 'flamethrower',
  // 金库
  'laserbeam', 'rocket_tiny_roll', 'icethrower', 'shieldshot',
  // 艺术神殿
  'orbspawner', 'orbspawner_green', 'darkflame', 'orb_pink', 'radioactive_liquid', 'enlightened_laser_dark_wand',
  // 圣山守卫 Stevari(necromancer_shop.xml 两段 AIAttack:远 orb_pink_big_explosive / 近 orb_pink)
  'orb_pink_big_explosive',
  // 古代实验室 lasergun.lua 朝下射的激光
  'laser_lasergun',
  // 金字塔 wizard_weaken
  'orb_weaken',
  // 肉界(miner_hell / sniper_hell / necrobot / walleye)
  'tnt_hell', 'sniperbullet_hell', 'dotshot', 'orb_pink_big',
  // 发电站(基地机器人 / 死灵机器人 / 大型卫兵 / 超级坦克)
  'machinegun_bullet_roboguard_big', 'sentryshot', 'hiddenshot', 'neutralizershot', 'soldiershot', 'dotshot_strong', 'machinegun_bullet_tank_super',
  // 地狱(gazer / spitmonster)
  'lavashot', 'orb_pink_fast',
  // 巫师洞 wizard_homing
  'orb_homing',
  // Stevari 强化版 necromancer_super
  'orb_pink_big_super', 'orb_pink_super',
  // 神殿陷阱(crypt_trap_check.lua)
  'arrow', 'fire_trap', 'thunder_trap', 'spit_trap',
]

const out = {}
for (const entry of [...NAMES.map((n) => ({ key: n, paths: [`data/entities/projectiles/deck/${n}.xml`, `data/entities/projectiles/${n}.xml`] })), ...ENEMY.map((n) => ({ key: 'e_' + n.split('/').pop(), paths: [`data/entities/projectiles/${n}.xml`] }))]) {
  const name = entry.key
  let s = null
  for (const p of entry.paths) { s = readFile(p); if (s) break }
  if (!s) { console.warn('缺', name); continue }
  // <Base file>:基文件的组件属性打底,本文件同名组件覆盖(炸弹 = base_projectile_physics + 自己的爆炸配置)
  const baseFile = (/<Base\s+file="([^"]+)"/.exec(s) || [])[1]
  const bs = baseFile ? readFile(baseFile) || '' : ''
  const merged = (re) => ({ ...attrsOf((re.exec(bs) || [])[1]), ...attrsOf((re.exec(s) || [])[1]) })
  const vel = merged(/<VelocityComponent\b([^>]*)>/)
  const hasVel = /<VelocityComponent\b/.test(s) || /<VelocityComponent\b/.test(bs)
  const pc = merged(/<ProjectileComponent\b([^>]*)>/)
  const ex = merged(/<config_explosion\b([^>]*)>/)
  // 刚体弹(炸弹/箱子):PhysicsBodyComponent + PhysicsImageShapeComponent 的图就是弹体
  const physShape = merged(/<PhysicsImageShapeComponent\b([^>]*)>/)
  const physics = /<PhysicsBodyComponent\b/.test(s + bs) ? { image: copyGfx(physShape.image_file) } : null
  // 精灵也按 Base 打底(场类:base_field 给 alpha 0.25 + additive,子文件只换 image_file)
  const spc = merged(/<SpriteComponent\b([^>]*)>/)
  const light = attrsOf((/<LightComponent\b([^>]*)>/.exec(s) || [])[1])
  const emitters = [...s.matchAll(/<ParticleEmitterComponent\b([^>]*)>/g)].map((m) => attrsOf(m[1])).filter((e) => e._enabled !== '0').map((e) => ({
    mat: e.emitted_material_name || null, trail: e.is_trail === '1', gap: num(e.trail_gap, 1),
    count: [num(e.count_min, 1), num(e.count_max, 1)], life: [num(e.lifetime_min, 0.2), num(e.lifetime_max, 0.4)],
    vx: [num(e.x_vel_min, 0), num(e.x_vel_max, 0)], vy: [num(e.y_vel_min, 0), num(e.y_vel_max, 0)], g: num(e['gravity.y'], 0),
    interval: [num(e.emission_interval_min_frames, 1), num(e.emission_interval_max_frames, 1)],
    airflow: num(e.airflow_force, 0), fade: e.fade_based_on_lifetime === '1', real: e.create_real_particles === '1',
    offX: [num(e.x_pos_offset_min, 0), num(e.x_pos_offset_max, 0)], offY: [num(e.y_pos_offset_min, 0), num(e.y_pos_offset_max, 0)],
    ox: num(e['offset.x'], 0), oy: num(e['offset.y'], 0),
    awayFromCenter: e.velocity_always_away_from_center === '1', areaR: [num(e['area_circle_radius.min'], 0), num(e['area_circle_radius.max'], 0)],
    long: e.draw_as_long === '1', delay: num(e.delay_frames, 0), emitterLife: num(e.emitter_lifetime_frames, 0), isEmitting: e.is_emitting !== '0',
    attractor: num(e.attractor_force, 0),
    // 图形发射:沿 image_animation_file 的像素从中心向外一圈圈发射(火圈/水圈法术)
    image: e.image_animation_file ? { file: copyGfx(e.image_animation_file), speed: num(e.image_animation_speed, 1), loop: e.image_animation_loop === '1', raytrace: e.image_animation_raytrace_from_center === '1' } : null,
  }))
  // 精灵粒子发射器(烟团/光斑这类贴图粒子)
  const sprEmitters = [...s.matchAll(/<SpriteParticleEmitterComponent\b([^>]*)>/g)].map((m) => attrsOf(m[1])).filter((e) => e._enabled !== '0').map((e) => ({
    sprite: sprite(e.sprite_file), delay: num(e.delay, 0), lifetime: num(e.lifetime, 0),
    color: [num(e['color.r'], 1), num(e['color.g'], 1), num(e['color.b'], 1), num(e['color.a'], 1)],
    colorChange: [num(e['color_change.r'], 0), num(e['color_change.g'], 0), num(e['color_change.b'], 0), num(e['color_change.a'], 0)],
    vel: [num(e['velocity.x'], 0), num(e['velocity.y'], 0)], rvel: [num(e['randomize_velocity.min_x'], 0), num(e['randomize_velocity.max_x'], 0), num(e['randomize_velocity.min_y'], 0), num(e['randomize_velocity.max_y'], 0)],
    g: [num(e['gravity.x'], 0), num(e['gravity.y'], 0)], slow: num(e.velocity_slowdown, 0),
    rot: num(e.rotation, 0), rrot: [num(e['randomize_rotation.min'], 0), num(e['randomize_rotation.max'], 0)], useVelRot: e.use_velocity_as_rotation === '1',
    angVel: num(e.angular_velocity, 0), rangVel: [num(e['randomize_angular_velocity.min'], 0), num(e['randomize_angular_velocity.max'], 0)],
    scale: [num(e['scale.x'], 1), num(e['scale.y'], 1)], scaleVel: [num(e['scale_velocity.x'], 0), num(e['scale_velocity.y'], 0)],
    rpos: [num(e['randomize_position.min_x'], 0), num(e['randomize_position.max_x'], 0), num(e['randomize_position.min_y'], 0), num(e['randomize_position.max_y'], 0)],
    rlife: [num(e['randomize_lifetime.min'], 0), num(e['randomize_lifetime.max'], 0)],
    count: [num(e.count_min, 1), num(e.count_max, 1)], interval: [num(e.emission_interval_min_frames, 1), num(e.emission_interval_max_frames, 1)],
    additive: e.additive === '1', emissive: e.emissive === '1', randomRot: e.sprite_random_rotation === '1', isEmitting: e.is_emitting !== '0',
  }))
  // 材质转换(冰球冻结/火球点燃/触摸系变材质)。<Base file> 里的同类组件按顺序继承基文件属性(冰球的冻结表在 misc/material_converter_freeze.xml)
  const convAttrs = []
  const baseBlocks = [...s.matchAll(/<Base\s+file="([^"]+)"\s*>([\s\S]*?)<\/Base>/g)]
  const baseConv = []
  for (const b of baseBlocks) {
    const bs = readFile(b[1]) || ''
    const baseList = [...bs.matchAll(/<MagicConvertMaterialComponent\b([^>]*)>/g)].map((m) => attrsOf(m[1]))
    const ownList = [...b[2].matchAll(/<MagicConvertMaterialComponent\b([^>]*)>/g)].map((m) => attrsOf(m[1]))
    baseList.forEach((ba, i) => convAttrs.push({ ...ba, ...(ownList[i] || {}) }))
    baseConv.push(...ownList)
  }
  // Base 块之外的直接组件
  const stripped = s.replace(/<Base\s+file="[^"]+"\s*>[\s\S]*?<\/Base>/g, '')
  for (const m of stripped.matchAll(/<MagicConvertMaterialComponent\b([^>]*)>/g)) convAttrs.push(attrsOf(m[1]))
  const converters = convAttrs.filter((e) => e._enabled !== '0').map((e) => ({
    radius: num(e.radius, 8), steps: num(e.steps_per_frame, 5), loop: e.loop === '1', circle: e.is_circle !== '0',
    from: e.from_material || null, fromArray: e.from_material_array ? e.from_material_array.split(',').map((x) => x.trim()).filter(Boolean) : null, fromAny: e.from_any_material === '1',
    to: e.to_material || null, toArray: e.to_material_array ? e.to_material_array.split(',').map((x) => x.trim()).filter(Boolean) : null,
    extinguish: e.extinguish_fire === '1', ignite: num(e.ignite_materials, 0), killWhenFinished: e.kill_when_finished === '1',
  }))
  // load_this_entity 里的 LooseGroundComponent(崩塌大地:一定距离内随机把地面块变松散坠落)
  let looseGround = null
  for (const f of (ex.load_this_entity || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const ls = readFile(f)
    const lgm = ls && /<LooseGroundComponent\b([^>]*)>/.exec(ls)
    if (!lgm) continue
    const lg = attrsOf(lgm[1])
    // 引擎默认:max_distance 与爆炸半径挂钩,这里给保守默认
    looseGround = { prob: num(lg.probability, 0.4), maxDist: num(lg.max_distance, 0), minR: num(lg.min_radius, 6), maxR: num(lg.max_radius, 16), maxAngle: num(lg.max_angle, Math.PI) }
  }
  const ce = attrsOf((/<CellEaterComponent\b([^>]*)>/.exec(s) || [])[1])
  const cellEater = ce.radius ? { radius: num(ce.radius, 4), prob: num(ce.eat_probability, 100), ignoredTag: ce.ignored_material_tag || null, ignoredMat: ce.ignored_material || null } : null
  const tags = (/<Entity\b([^>]*)>/.exec(s) || [])[1]
  // 没有 ProjectileComponent 的是"原地实体"(火圈/水圈:只有 LifetimeComponent + 发射器),不飞不撞
  const lifeComp = merged(/<LifetimeComponent\b([^>]*)>/)
  const isStatic = !Object.keys(pc).length
  if (isStatic) { pc.speed_min = '0'; pc.speed_max = '0'; pc.lifetime = lifeComp.lifetime || '60'; pc.on_collision_die = '0'; pc.collide_with_world = '0'; pc.on_death_explode = '0'; pc.on_lifetime_out_explode = '0' }
  // 两个都有(场类 base_field:ProjectileComponent lifetime=9999999 + LifetimeComponent 7200):实体寿命取小的那个
  else if (lifeComp.lifetime && +lifeComp.lifetime > 0 && (!pc.lifetime || +pc.lifetime > +lifeComp.lifetime)) pc.lifetime = lifeComp.lifetime
  // GameAreaEffectComponent(场):半径内的活物每 frame_length 帧吃一次 damage_game_effect_entities 的状态(电击 / 冻结)
  const esh = merged(/<EnergyShieldComponent\b([^>]*)>/)
  const shield = esh.radius ? { radius: num(esh.radius, 28), energy: num(esh.max_energy, 20) } : null
  // BlackHoleComponent(巨大黑洞,引擎内置):半径内吞噬一切格子、圈内活物按 damage_probability 每帧吃伤害、拉粒子;
  //   black_hole_big.lua 每 execute_every_n_frame 帧 radius = min(64, radius+1);black_hole_gravity.lua 每帧把 150px 内的弹丸 / 刚体往里拉(196 × (1 - d/150),刚体 ×0.2)
  const bhc = merged(/<BlackHoleComponent\b([^>]*)>/)
  let blackHole = null
  if (bhc.radius) {
    // damage_amount 文档默认 0.1(tools_modding/component_documentation.txt:BlackHoleComponent radius 16 / particle_attractor_force 2 / damage_probability 0.25 / damage_amount 0.1)
    blackHole = { radius: num(bhc.radius, 16), damageProb: num(bhc.damage_probability, 0.25), damageAmount: num(bhc.damage_amount, 0.1), attractor: num(bhc.particle_attractor_force, 2), grow: null }
    const lua = /<LuaComponent\b([^>]*script_source_file="([^"]*black_hole_big\.lua)"[^>]*)>/.exec(s)
    if (lua) {
      const src = readFile(lua[2]) || ''
      const mx = /math\.min\(\s*(\d+)\s*,\s*radius\s*\+\s*(\d+)\s*\)/.exec(src), ap = /particle_attractor_force\s*=\s*radius\s*\*\s*([\d.]+)/.exec(src)
      blackHole.grow = { every: num(attrsOf(lua[1]).execute_every_n_frame, 1), max: mx ? +mx[1] : 64, step: mx ? +mx[2] : 1, attrPerR: ap ? +ap[1] : 0.25 }
      // 子实体的 LooseGroundComponent(黑洞周围的地面崩成松散块掉进去);lua 每次把 max_distance 改成 radius + 20
      const lgm = /<LooseGroundComponent\b([^>]*)>/.exec(s)
      if (lgm) {
        const lg = attrsOf(lgm[1]), da = /vars\.max_distance\s*=\s*radius\s*\+\s*(\d+)/.exec(src)
        blackHole.loose = { prob: num(lg.probability, 0.2), distAdd: da ? +da[1] : num(lg.max_distance, 80), minR: num(lg.min_radius, 6), maxR: num(lg.max_radius, 16), maxAngle: num(lg.max_angle, Math.PI), chunkProb: num(lg.chunk_probability, 0), chunkMaxAngle: num(lg.chunk_max_angle, Math.PI) }
      }
    }
  }
  let gravityWell = null
  const gl = /<LuaComponent\b[^>]*script_source_file="([^"]*black_hole_gravity\.lua)"[^>]*>/.exec(s)
  if (gl) {
    const src = readFile(gl[1]) || ''
    const dist = /distance_full\s*=\s*([\d.]+)/.exec(src), coeff = /gravity_coeff\s*=\s*([\d.]+)/.exec(src), bm = /fx\s*=\s*fx\s*\*\s*([\d.]+)\s*\*\s*body_mass/.exec(src)
    gravityWell = { dist: dist ? +dist[1] : 150, coeff: coeff ? +coeff[1] : 196, bodyMul: bm ? +bm[1] : 0.2 }
  }
  // 雷霆之环:electrocution_blast.lua 每 execute_every_n_frame 帧在圈内随机点(Random(-28,28))朝随机方向 shoot 一个 misc/electricity.xml
  //   —— 引擎内置 ElectricityComponent(文档默认 energy 1000 / speed 32 格每帧 / probability_to_heat 0):电流碰到导电材质(液体 / 金属)就在里面窜,碰到活物就电
  let electricity = null
  const el = /<LuaComponent\b([^>]*script_source_file="([^"]*electrocution_blast\.lua)"[^>]*)>/.exec(s)
  if (el) {
    const src = readFile(el[2]) || ''
    const sp = /Random\(\s*-(\d+)\s*,\s*(\d+)\s*\)/.exec(src), ef = /"([^"]*electricity\.xml)"/.exec(src), spd = /local\s+length\s*=\s*(\d+)/.exec(src)
    const ec = attrsOf((/<ElectricityComponent\b([^>]*)>/.exec(ef ? readFile(ef[1]) || '' : '') || [])[1])
    electricity = { every: num(attrsOf(el[1]).execute_every_n_frame, 10), spread: sp ? +sp[2] : 28, shotSpeed: spd ? +spd[1] : 5000, energy: num(ec.energy, 1000), speed: num(ec.speed, 32), heat: num(ec.probability_to_heat, 0) }
  }
  // 雨云 cloud_position.lua(execute_times=1):出生时从杖尖往上 RaytraceSurfaces 40px,云挂到那儿(碰到天花板就停)
  let riseTo = 0
  const cpl = /<LuaComponent\b[^>]*script_source_file="([^"]*cloud_position\.lua)"/.exec(s)
  if (cpl) { const src = readFile(cpl[1]) || ''; const up = /pos_y\s*-\s*(\d+)/.exec(src); riseTo = up ? +up[1] : 40 }
  // 瞬移弹:TeleportProjectileComponent(引擎)—— 弹死在哪,射手就被传到哪(离墙 min_distance_from_wall,reset_shooter_y_vel 把 y 速度归零)
  const tpc = merged(/<TeleportProjectileComponent\b([^>]*)>/)
  const teleport = /<TeleportProjectileComponent\b/.test(s) ? { minWall: num(tpc.min_distance_from_wall, 16), resetY: tpc.reset_shooter_y_vel !== '0', actionable: num(tpc.actionable_lifetime, 3) } : null
  // 瞬移施法 teleport_cast.lua:出生时跳到 96px 内随机一个 homing_target(敌人)身上,2 帧后死 → 载荷在那儿放
  const castTo = /teleport_cast\.lua/.test(s) ? (() => { const src = readFile('data/scripts/projectiles/teleport_cast.lua') || ''; const r = /EntityGetInRadiusWithTag\([^,]+,[^,]+,\s*(\d+)/.exec(src); return { range: r ? +r[1] : 96 } })() : null
  // 持续音(AudioLoopComponent event_name):场 / 电场 / 黑洞 各自的循环声,运行时用合成噪声近似
  const loopM = /<AudioLoopComponent\b[^>]*event_name="([^"]+)"/.exec(s) || /<AudioLoopComponent\b[^>]*event_name="([^"]+)"/.exec(bs)
  const loop = loopM ? loopM[1].replace(/^player_projectiles\//, '').replace(/\/loop$/, '') : null
  const gae = merged(/<GameAreaEffectComponent\b([^>]*)>/)
  const areaEffect = gae.radius ? { radius: num(gae.radius, 28), every: num(gae.frame_length, 100), effects: String(pc.damage_game_effect_entities || '').split(',').map((f) => f.trim()).filter(Boolean).map((f) => f.split('/').pop().replace(/^effect_/, '').replace('.xml', '')) } : null
  // 枪口火焰:是个小实体,SpriteComponent 的 image_file 可能是 $[1-5] 变体模板
  let muzzle = null
  if (pc.muzzle_flash_file) {
    const ms = readFile(pc.muzzle_flash_file)
    const msp = ms ? attrsOf((/<SpriteComponent\b([^>]*)>/.exec(ms) || [])[1]) : {}
    if (msp.image_file) {
      const rg = /\$\[(\d+)-(\d+)\]/.exec(msp.image_file)
      const variants = []
      if (rg) for (let i = +rg[1]; i <= +rg[2]; i++) { const f = copyGfx(msp.image_file.replace(/\$\[\d+-\d+\]/, String(i))); if (f) variants.push(f) }
      else { const f = copyGfx(msp.image_file); if (f) variants.push(f) }
      muzzle = { variants, offX: num(msp.offset_x, 0), offY: num(msp.offset_y, 0), additive: msp.additive === '1' }
    }
  }
  // 反弹特效(bounce_fx_file):一个只活几帧的小实体,里面是一次性粒子喷发
  let bounceFx = null
  if (pc.bounce_fx_file) {
    const bs = readFile(pc.bounce_fx_file)
    if (bs) {
      const e = attrsOf((/<ParticleEmitterComponent\b([^>]*)>/.exec(bs) || [])[1])
      if (e.emitted_material_name) bounceFx = { mat: e.emitted_material_name, count: [num(e.count_min, 3), num(e.count_max, 6)], life: [num(e.lifetime_min, 0.05), num(e.lifetime_max, 0.15)], vx: [num(e.x_vel_min, -50), num(e.x_vel_max, 50)], vy: [num(e.y_vel_min, -50), num(e.y_vel_max, 50)] }
    }
  }
  out[name] = {
    type: physics ? 'PHYSICS' : isStatic ? 'STATIC' : pc.projectile_type || 'PROJECTILE', physics, deathMaterial: pc.on_death_emit_particle === '1' ? pc.on_death_emit_particle_type || null : null,
    dirRandom: num(pc.direction_random_rad, 0), shakeWhenShot: num(pc.camera_shake_when_shot, 0),
    // 碰撞行为
    bounces: num(pc.bounces_left, 0), bounceEnergy: num(pc.bounce_energy, 0.8), bounceAlways: pc.bounce_always === '1', bounceAnyAngle: pc.bounce_at_any_angle === '1', bounceFx,
    dieLowVel: pc.die_on_low_velocity === '1' ? num(pc.die_on_low_velocity_limit, 5) : 0, dieOnLiquid: pc.die_on_liquid_collision === '1',
    collideWorld: pc.collide_with_world !== '0' && pc.penetrate_world !== '1', groundPenetration: num(pc.ground_penetration_coeff, 0),
    leaveSprite: pc.on_death_gfx_leave_sprite === '1', velRotation: pc.velocity_sets_rotation !== '0', angularVelocity: num(pc.angular_velocity, 0),
    mass: num(vel.mass, 0.05),
    // VelocityComponent 引擎默认(component_documentation):gravity_y 400 / air_friction 0.55 / terminal_velocity 1000 / liquid_drag 1 —— 没写就是这些,不是 0
    // (反 exe VelocitySystem::Update:v += g·dt;v −= v·air_friction·dt;液体里 v −= v·liquid_drag·dt·液体格数;|v| ≤ terminal)
    // 没有 VelocityComponent 的实体(circle_* / touch_* 这类)根本不动
    gravity: hasVel ? num(vel.gravity_y, 400) : 0, airFriction: hasVel ? num(vel.air_friction, 0.55) : 0, terminal: !hasVel || vel.apply_terminal_velocity === '0' ? 0 : num(vel.terminal_velocity, 1000), liquidDrag: hasVel ? num(vel.liquid_drag, 1) : 0,
    // 刚体弹没有 speed_*:是被"扔"出去的(PhysicsThrowableComponent),给个投掷速度
    speed: [num(pc.speed_min, physics ? 120 : 400), num(pc.speed_max, physics ? 140 : 400)], lifetime: num(pc.lifetime, 60), lifetimeRandom: num(pc.lifetime_randomness, 0),
    damage: num(pc.damage, 0), collisionDie: pc.on_collision_die !== '0', bounces: num(pc.bounces_left, 0), penetrate: pc.penetrate_world === '1',
    // 反 exe / 文档:final_knockback = knockback_force × 弹速 × 弹 mass / 目标 mass;damage_scaled_by_speed → damage × min(1, 速度 / (damage_scale_max_speed || 初速))
    knockback: num(pc.knockback_force, 0), dmgBySpeed: pc.damage_scaled_by_speed === '1', dmgMaxSpeed: num(pc.damage_scale_max_speed, 0),
    penetrateEntities: pc.penetrate_entities === '1',
    friction: num(pc.friction, 1), lob: [num(pc.lob_min, 0), num(pc.lob_max, 0)], velocitySetsScale: pc.velocity_sets_scale === '1',
    deathExplode: pc.on_death_explode === '1', lifetimeExplode: pc.on_lifetime_out_explode === '1',
    muzzle, shootFlash: pc.shoot_light_flash_radius ? { r: num(pc.shoot_light_flash_r, 255), g: num(pc.shoot_light_flash_g, 255), b: num(pc.shoot_light_flash_b, 255), radius: num(pc.shoot_light_flash_radius, 0) } : null,
    explosion: Object.keys(ex).length ? {
      radius: num(ex.explosion_radius, 0), damage: num(ex.damage, 0), shake: num(ex.camera_shake, 0), hole: ex.hole_enabled !== '0',
      // 反 exe ExplosionFactory::DamageMortals:击退冲量 = 方向 × lerp(physics_explosion_power.min, .max, 1 − d/r) × knockback_force × 3600(ConfigExplosion 默认 power [0,0.2] / knockback 1)
      power: [num(ex['physics_explosion_power.min'], 0), num(ex['physics_explosion_power.max'], 0.2)], knockback: num(ex.knockback_force, 1),
      destroyLiquid: ex.hole_destroy_liquid === '1', // 0 = 液体不是留着,是被抛飞
      holeLiquid: ex.hole_destroy_liquid === '1', rayEnergy: num(ex.ray_energy, 0), maxDurability: num(ex.max_durability_to_destroy, 0),
      sprite: sprite(ex.explosion_sprite), spriteLife: num(ex.explosion_sprite_lifetime, 0),
      sparks: ex.sparks_enabled === '1' ? [num(ex.sparks_count_min, 0), num(ex.sparks_count_max, 0)] : null,
      matSparks: ex.material_sparks_enabled === '1' ? [num(ex.material_sparks_count_min, 0), num(ex.material_sparks_count_max, 0)] : null,
      light: ex.light_enabled === '1' ? { fade: num(ex.light_fade_time, 0.1), r: num(ex.light_r, 255), g: num(ex.light_g, 255), b: num(ex.light_b, 255), radius: num(ex.light_radius_coeff, 1) } : null,
      createCell: num(ex.create_cell_probability, 0) ? { p: num(ex.create_cell_probability, 0), mat: ex.create_cell_material || 'fire' } : null, // 引擎默认生成材质是 fire
      loadEntity: ex.load_this_entity || null, stains: num(ex.stains_radius, 0),
    } : null,
    sprite: sprite(spc.image_file), additive: spc.additive === '1', spriteAlpha: num(spc.alpha, 1), emissive: spc.emissive === '1',
    velocitySetsScaleCoeff: num(pc.velocity_sets_scale_coeff, 1),
    light: light.radius ? { r: num(light.r, 255), g: num(light.g, 255), b: num(light.b, 255), radius: num(light.radius, 0) } : null,
    emitters, sprEmitters, converters, cellEater, looseGround, areaEffect, shield, blackHole, gravityWell, electricity, loop, riseTo, teleport, castTo,
    tags: tags || '',
  }
}
fs.writeFileSync(`${OUT}/projectiles.json`, JSON.stringify(out))
console.log(`projectiles.json: ${Object.keys(out).length} 种投射物,贴图 ${copied.size} 张`)
