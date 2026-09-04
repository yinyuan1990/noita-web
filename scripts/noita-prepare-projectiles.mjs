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
  'bomb', 'bomb_small', 'bomb_holy',
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
  return {
    image: copyGfx(sp.filename), offX: num(sp.offset_x, 0), offY: num(sp.offset_y, 0),
    fw: num(a.frame_width, 0), fh: num(a.frame_height, 0), frames: num(a.frame_count, 1), wait: num(a.frame_wait, 0.1), loop: num(a.loop, 1),
    posX: num(a.pos_x, 0), posY: num(a.pos_y, 0), shrink: a.shrink_by_one_pixel === '1',
  }
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
  const pc = merged(/<ProjectileComponent\b([^>]*)>/)
  const ex = merged(/<config_explosion\b([^>]*)>/)
  // 刚体弹(炸弹/箱子):PhysicsBodyComponent + PhysicsImageShapeComponent 的图就是弹体
  const physShape = merged(/<PhysicsImageShapeComponent\b([^>]*)>/)
  const physics = /<PhysicsBodyComponent\b/.test(s + bs) ? { image: copyGfx(physShape.image_file) } : null
  const spc = attrsOf((/<SpriteComponent\b([^>]*)>/.exec(s) || [])[1])
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
  const lifeComp = attrsOf((/<LifetimeComponent\b([^>]*)>/.exec(s) || [])[1])
  const isStatic = !Object.keys(pc).length
  if (isStatic) { pc.speed_min = '0'; pc.speed_max = '0'; pc.lifetime = lifeComp.lifetime || '60'; pc.on_collision_die = '0'; pc.collide_with_world = '0'; pc.on_death_explode = '0'; pc.on_lifetime_out_explode = '0' }
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
    gravity: num(vel.gravity_y, 0), airFriction: num(vel.air_friction, 0),
    // 刚体弹没有 speed_*:是被"扔"出去的(PhysicsThrowableComponent),给个投掷速度
    speed: [num(pc.speed_min, physics ? 120 : 400), num(pc.speed_max, physics ? 140 : 400)], lifetime: num(pc.lifetime, 60), lifetimeRandom: num(pc.lifetime_randomness, 0),
    damage: num(pc.damage, 0), collisionDie: pc.on_collision_die !== '0', bounces: num(pc.bounces_left, 0), penetrate: pc.penetrate_world === '1',
    friction: num(pc.friction, 1), lob: [num(pc.lob_min, 0), num(pc.lob_max, 0)], velocitySetsScale: pc.velocity_sets_scale === '1',
    deathExplode: pc.on_death_explode === '1', lifetimeExplode: pc.on_lifetime_out_explode === '1',
    muzzle, shootFlash: pc.shoot_light_flash_radius ? { r: num(pc.shoot_light_flash_r, 255), g: num(pc.shoot_light_flash_g, 255), b: num(pc.shoot_light_flash_b, 255), radius: num(pc.shoot_light_flash_radius, 0) } : null,
    explosion: Object.keys(ex).length ? {
      radius: num(ex.explosion_radius, 0), damage: num(ex.damage, 0), shake: num(ex.camera_shake, 0), hole: ex.hole_enabled !== '0',
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
    emitters, sprEmitters, converters, cellEater, looseGround,
    tags: tags || '',
  }
}
fs.writeFileSync(`${OUT}/projectiles.json`, JSON.stringify(out))
console.log(`projectiles.json: ${Object.keys(out).length} 种投射物,贴图 ${copied.size} 张`)
