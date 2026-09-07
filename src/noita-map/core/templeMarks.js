// ── 圣山(temple_altar*.lua)整图布景里的标记像素 → 光源 / 实体生成点 / 附加布景 ──
// 圣山不是 wang 砖,altar.png / altar_top.png 里的标记色由 temple_altar.lua 的 RegisterSpawnFunction 处理;这里逐条照抄:
//   spawn_lamp / spawn_lamp_long   spawn(g_lamp, x, y, 0, 10|15):[空 1, temple_lantern 1]
//   spawn_hp                       heart_fullhp_temple (x-16, y) + spell_refresh (x+16, y)
//   spawn_all_shopitems            SetRandomSeed(x,y);5 件,宽 132;sale = Random(1,5);Random(0,100)≤50 → 两排法术卡(+shop_second_row 布景)否则一排法杖
//   spawn_all_perks                perk_spawn_many(x, y)(主线程按 perk.lua 掷)
//   spawn_rubble                   spawn(g_rubble, x, y, 5, 0):[空 2, 碎石 0.1×6]
//   spawn_portal(altar_top)        teleport (x, y-4)
//   spawn_perk_reroll(altar_right) perk_reroll (x, y)
// 布景图里的标记像素本身不进材质(World._stampScene 已把 ALL_MARK_COLORS 当空气)。
// 扫描本身在 roomMarks.js(scanSceneMarks:任何整图 / spliced 布景里的标记像素按**像素所在 chunk 的群系**查表),这里只提供圣山那张表。

export const TEMPLE_MARK_BIOMES = new Set(['temple_altar', 'temple_altar_left', 'temple_altar_right', 'temple_wall', 'temple_wall_ending', 'temple_altar_right_snowcastle'])
//   spawn_areachecks(0x03dead)     temple_areacheck_horizontal ×2:(x+180, y−101) 与 (x+180, y+140),MaterialAreaChecker 查 aabb x −124..300 / y 0..1 全是 templebrick(_noedge)_static,
//                                  不是了(玩家挖穿圣山顶 / 底)→ temple_check_for_leaks.lua:惹怒众神 → Stevari;spawn_all_shopitems 还放 shop_hitbox(±495 × −112..145):
//                                  商店货被弄出这个框 = 偷(ItemCost stealable)→ 同样惹怒。主线程(noitaPlay)拿这些点做检查
//   spawn_motordoor / spawn_pressureplate(0xfaabba / 0xfaabbb)在现行全部布景图里一处都没出现(legacy),不做
//   temple_altar_right_snowcastle.lua 多一个 spawn_statue(0x9f2a00 → props/temple_statue_02);boss_arena.lua 的 spawn_hp / spawn_items(boss_centipede)/ spawn_boss_music_and_statues 等在 roomMarks 的 boss_arena 表里
export const TEMPLE_MARKS = {
  0xffff00: 'spawn_lamp', 0xa7a707: 'spawn_lamp_long', 0x6d934c: 'spawn_hp', 0x33934c: 'spawn_all_shopitems', 0xffff81: 'spawn_all_perks',
  0xc128ff: 'spawn_rubble', 0xbf26a6: 'spawn_portal', 0x7345df: 'spawn_perk_reroll', 0x03dead: 'spawn_areachecks', 0xa85454: 'spawn_control_workshop', 0x9f2a00: 'spawn_statue',
}
export const TEMPLE_MARK_COLORS = new Set(Object.keys(TEMPLE_MARKS).map(Number))
const RUBBLE = [[2.0, ''], [0.1, 'physics_temple_rubble_01'], [0.1, 'physics_temple_rubble_02'], [0.1, 'physics_temple_rubble_03'], [0.1, 'physics_temple_rubble_04'], [0.1, 'physics_temple_rubble_05'], [0.1, 'physics_temple_rubble_06']]

/**
 * 一个圣山标记像素的处理(temple_altar.lua 对应函数)
 * @param {string} func
 * @param {number} x @param {number} y 世界坐标
 * @param {{out:{spawns:Array,lights:Array,extra:Array}, prng:import('./NollaPrng.js').NollaPrng, ws:number, globals:object}} c
 */
export function templeMark(func, x, y, c) {
  const { out, prng, ws, globals } = c
  switch (func) {
    case 'spawn_lamp':
    case 'spawn_lamp_long': {
      // spawn(g_lamp, x, y, 0, ry):random_from_table PR(x,y)·2 ≤ 1 空;实体在 (x+5, y+5 + PR(x+6, y+5, -ry, ry))
      if (prng.ProceduralRandom(ws, x, y) * 2 <= 1) break
      const ry = func === 'spawn_lamp' ? 10 : 15
      const X = x + 5, Y = y + 5
      prng.ProceduralRandomi(ws, X, Y, 1, 1)
      out.lights.push({ x: X, y: Y + prng.ProceduralRandomi(ws, X + 1, Y, -ry, ry), kind: 'lantern' })
      break
    }
    case 'spawn_hp':
      out.spawns.push({ entity: 'heart_fullhp_temple', x: x - 16, y, func }, { entity: 'spell_refresh', x: x + 16, y, func })
      break
    case 'spawn_areachecks':
      out.spawns.push({ entity: 'areacheck', x: x + 180, y: y - 65 - 16 - 20, func }, { entity: 'areacheck', x: x + 180, y: y + 140, func })
      break
    case 'spawn_all_shopitems': {
      out.spawns.push({ entity: 'shop_area', x, y, func })
      prng.SetRandomSeed(ws, x, y)
      const count = Math.max(1, Math.min(10, globals?.shopCount || 5)), iw = 132 / count
      const sale = prng.Random(1, count)
      if (prng.Random(0, 100) <= 50) {
        for (let i = 1; i <= count; i++) {
          const ix = x + (i - 1) * iw
          out.spawns.push({ entity: 'shop_item', x: ix, y, sale: i === sale, func })
          out.spawns.push({ entity: 'shop_item', x: ix, y: y - 30, sale: false, func })
          out.extra.push({ dir: 'temple', name: 'shop_second_row', x: ix - 8, y: y - 22 })
        }
      } else {
        for (let i = 1; i <= count; i++) out.spawns.push({ entity: 'shop_wand', x: x + (i - 1) * iw, y, sale: i === sale, func })
      }
      break
    }
    case 'spawn_all_perks':
      out.spawns.push({ entity: 'perks', x, y, func })
      break
    case 'spawn_rubble': {
      // spawn(g_rubble, x, y, 5, 0)
      let total = 0
      for (const [p] of RUBBLE) total += p
      let r = prng.ProceduralRandom(ws, x, y) * total, pick = null
      for (const row of RUBBLE) { if (r <= row[0]) { pick = row; break } r -= row[0] }
      if (!pick || !pick[1]) break
      const X = x + 5, Y = y + 5
      const n = prng.ProceduralRandomi(ws, X, Y, 1, 1)
      for (let i = 1; i <= n; i++) out.spawns.push({ entity: pick[1], x: X + prng.ProceduralRandomi(ws, X + i, Y, -5, 5), y: Y, func })
      break
    }
    case 'spawn_portal':
      out.spawns.push({ entity: 'portal', x, y: y - 4, func })
      break
    case 'spawn_perk_reroll':
      out.spawns.push({ entity: 'perk_reroll', x, y, func })
      break
    case 'spawn_control_workshop':
      // temple_altar_right.lua:workshop_exit.xml —— CollisionTrigger 52×52(player_unit)→ workshop_exit.lua:圣山崩塌(主线程 noitaPlay 处理)
      out.spawns.push({ entity: 'workshop_exit', x, y, func })
      break
    case 'spawn_statue':
      out.spawns.push({ entity: 'temple_statue_02', x, y, func })
      break
  }
}
