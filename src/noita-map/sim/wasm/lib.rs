// CellSim 的 WASM 内核:和 ../CellSim.js 的 step / _sand / _liquid / _gas / _fire / _burnStatic / _react 逐行对应(规则、概率一样),
// 只是数据放在这块线性内存里:材质表 / 反应表 / 最多 SLOTS 个区块槽(mat u16 + aux u8 + act 块 TTL + tver 实心版本 + sblk 静态变化块 + flags)。
// JS 侧(CellSim.js)拿 arena 地址在同一块内存上建 typed array 视图:区块进来时拷进槽、e.mat / e.aux / e.act / e.tver 直接指向槽,
// get / set / mark 仍在 JS 里做(零散调用),只有每帧的 step 主循环跑这里。
// 构建:npm run build:wasm(cargo build --release --target wasm32-unknown-unknown → 拷到 ../cellsim.wasm)
#![no_std]

use core::panic::PanicInfo;
#[panic_handler]
fn panic(_: &PanicInfo) -> ! { loop {} }

const CHUNK: i32 = 512;
const BS: i32 = 32; const BSH: i32 = 5; const BN: i32 = 16;
const WAKE: u8 = 3;
const K_STATIC: u8 = 1; const K_SAND: u8 = 2; const K_LIQUID: u8 = 3; const K_GAS: u8 = 4; const K_FIRE: u8 = 5;

// ── 内存布局 ──
const TAB_KIND: usize = 0; const TAB_BURN: usize = 1024; const TAB_SMOKE: usize = 2048; const TAB_O2: usize = 3072;
const TAB_SPREAD: usize = 4096; const TAB_RXANY: usize = 5120; const TAB_AIRRX: usize = 6144;
const TAB_LIFE: usize = 8192; const TAB_DENS: usize = 16384; const TAB_GRAV: usize = 20480; const TAB_AUTOIGN: usize = 24576;
const TAB_FIRET: usize = 28672; const TAB_FIREHP: usize = 32768;
const RX_IDX: usize = 65536;                 // u16[1024*1024]:(a*1024+b) → 反应链表头(1 起,0 = 无)
const RX_LIST: usize = 2_162_688;            // 16384 × 12 B:{p f32, ox u16, oy u16, next u16, pad u16}
const RX_CAP: usize = 16384;
const SLOT_BASE: usize = 2_359_296;
const S_MAT: usize = 0; const S_AUX: usize = 524_288; const S_ACT: usize = 786_432; const S_TVER: usize = 786_688; const S_SBLK: usize = 787_200; const S_FLAGS: usize = 787_456;
const SLOT_STRIDE: usize = 788_480;
const SLOTS: usize = 48;
const ARENA_SIZE: usize = SLOT_BASE + SLOTS * SLOT_STRIDE;

#[repr(C, align(65536))]
struct Arena([u8; ARENA_SIZE]);
static mut ARENA: Arena = Arena([0; ARENA_SIZE]);

// 窗口(bind)/ 障碍盒 / 材质常量 / 随机数
static mut TBL: [i32; 16] = [-1; 16];
static mut CX0B: i32 = 0; static mut CY0B: i32 = 0; static mut CW: i32 = 0; static mut CH: i32 = 0;
static mut WX0: i32 = 0; static mut WY0: i32 = 0; static mut WX1: i32 = 0; static mut WY1: i32 = 0;
static mut IX0: i32 = 0; static mut IY0: i32 = 0; static mut IX1: i32 = 0; static mut IY1: i32 = 0;
static mut OBST: bool = false; static mut OX0: i32 = 0; static mut OY0: i32 = 0; static mut OX1: i32 = 0; static mut OY1: i32 = 0;
static mut M_FIRE: u16 = 1; static mut M_SMOKE: u16 = 0;
static mut FRAME: i32 = 0;
static mut ACTIVE: i32 = 0;
static mut RNG: u32 = 0x9E3779B9;

#[inline(always)] fn base() -> *mut u8 { core::ptr::addr_of_mut!(ARENA) as *mut u8 }
#[inline(always)] fn slot(s: i32) -> *mut u8 { unsafe { base().add(SLOT_BASE + s as usize * SLOT_STRIDE) } }
#[inline(always)] fn mat(s: *mut u8) -> *mut u16 { unsafe { s.add(S_MAT) as *mut u16 } }
#[inline(always)] fn aux(s: *mut u8) -> *mut u8 { unsafe { s.add(S_AUX) } }
#[inline(always)] fn act(s: *mut u8) -> *mut u8 { unsafe { s.add(S_ACT) } }
#[inline(always)] fn tver(s: *mut u8) -> *mut u16 { unsafe { s.add(S_TVER) as *mut u16 } }
#[inline(always)] fn tab_u8(off: usize, m: u16) -> u8 { unsafe { *base().add(off + m as usize) } }
#[inline(always)] fn tab_u16(off: usize, m: u16) -> u16 { unsafe { *(base().add(off) as *const u16).add(m as usize) } }
#[inline(always)] fn tab_f32(off: usize, m: u16) -> f32 { unsafe { *(base().add(off) as *const f32).add(m as usize) } }
#[inline(always)] fn kind(m: u16) -> u8 { tab_u8(TAB_KIND, m) }
#[inline(always)] fn solidish(m: u16) -> bool { let k = kind(m); k > 0 && k <= K_SAND }

#[inline(always)] fn rnd() -> f32 {
  unsafe { let mut x = RNG; x ^= x << 13; x ^= x >> 17; x ^= x << 5; RNG = x; (x >> 8) as f32 * (1.0 / 16_777_216.0) }
}

/// 世界坐标 → 槽指针(窗口外 / 未就位 = null)
#[inline(always)] fn entry(wx: i32, wy: i32) -> *mut u8 {
  unsafe {
    let i = (wx >> 9) - CX0B; let j = (wy >> 9) - CY0B;
    if i < 0 || i >= CW || j < 0 || j >= CH { return core::ptr::null_mut(); }
    let s = TBL[(j * 4 + i) as usize];
    if s < 0 { core::ptr::null_mut() } else { slot(s) }
  }
}
#[inline(always)] fn li(wx: i32, wy: i32) -> usize { (((wy & 511) * CHUNK) + (wx & 511)) as usize }
/// 材质 id;窗口外 -1
#[inline(always)] fn get(wx: i32, wy: i32) -> i32 {
  let e = entry(wx, wy);
  if e.is_null() { -1 } else { unsafe { *mat(e).add(li(wx, wy)) as i32 } }
}
#[inline(always)] fn blocked(tx: i32, ty: i32) -> bool { unsafe { OBST && tx >= OX0 && tx <= OX1 && ty >= OY0 && ty <= OY1 } }

#[inline(always)] fn mark_one(wx: i32, wy: i32) {
  let e = entry(wx, wy); if e.is_null() { return; }
  unsafe { *act(e).add(((((wy & 511) >> BSH) * BN) + ((wx & 511) >> BSH)) as usize) = WAKE; }
}
/// 标脏所在块,贴块边连邻块
#[inline(always)] fn mark_l(e: *mut u8, wx: i32, wy: i32) {
  let lx = wx & 511; let ly = wy & 511;
  unsafe { *act(e).add((((ly >> BSH) * BN) + (lx >> BSH)) as usize) = WAKE; }
  let bx = lx & (BS - 1); let by = ly & (BS - 1);
  if bx == 0 { mark_one(wx - 1, wy) } else if bx == BS - 1 { mark_one(wx + 1, wy) }
  if by == 0 { mark_one(wx, wy - 1) } else if by == BS - 1 { mark_one(wx, wy + 1) }
}
#[inline(always)] fn bump_tver(e: *mut u8, wx: i32, wy: i32) {
  unsafe { let p = tver(e).add(((((wy & 511) >> BSH) * BN) + ((wx & 511) >> BSH)) as usize); *p = (*p).wrapping_add(1); }
}
#[inline(always)] fn set_dirty(e: *mut u8) { unsafe { *e.add(S_FLAGS) = 1; } }

/// 写材质(同 JS set):静态材质变化 → staticChanged + sblk;实心↔非实心 → tver
fn set(wx: i32, wy: i32, m: u16, a: u8) -> bool {
  let e = entry(wx, wy); if e.is_null() { return false; }
  let i = li(wx, wy);
  unsafe {
    let old = *mat(e).add(i);
    if old == m && *aux(e).add(i) == a { return true; }
    if kind(old) == K_STATIC || kind(m) == K_STATIC {
      *e.add(S_FLAGS + 1) = 1;
      *e.add(S_SBLK + ((((wy & 511) >> 5) * 16) + ((wx & 511) >> 5)) as usize) = 1;
    }
    *mat(e).add(i) = m; *aux(e).add(i) = a; set_dirty(e);
    mark_l(e, wx, wy);
    if solidish(old) != solidish(m) { bump_tver(e, wx, wy); }
  }
  true
}

fn swap(x1: i32, y1: i32, e1: *mut u8, i1: usize, x2: i32, y2: i32) -> bool {
  let e2 = if (x1 >> 9) == (x2 >> 9) && (y1 >> 9) == (y2 >> 9) { e1 } else { entry(x2, y2) };
  if e2.is_null() { return false; }
  let i2 = li(x2, y2);
  unsafe {
    let m1 = *mat(e1).add(i1); let a1 = *aux(e1).add(i1);
    let m2 = *mat(e2).add(i2); let a2 = *aux(e2).add(i2);
    *mat(e1).add(i1) = m2; *aux(e1).add(i1) = a2;
    *mat(e2).add(i2) = m1; *aux(e2).add(i2) = a1;
    set_dirty(e1); set_dirty(e2);
    mark_l(e1, x1, y1); mark_l(e2, x2, y2);
    if solidish(m1) != solidish(m2) { bump_tver(e1, x1, y1); bump_tver(e2, x2, y2); }
  }
  true
}

/// 目标格能否被 m 占据:空 / 气 / 火,或更轻的液体
#[inline(always)] fn can_sink(m: u16, tx: i32, ty: i32) -> bool {
  let t = get(tx, ty);
  if t < 0 { return false; }
  if blocked(tx, ty) { return false; }
  if t == 0 { return true; }
  let t = t as u16; let kt = kind(t);
  if kt == K_GAS || kt == K_FIRE { return true; }
  if kt == K_LIQUID { return tab_f32(TAB_DENS, t) < tab_f32(TAB_DENS, m); }
  false
}

fn sand(x: i32, y: i32, e: *mut u8, i: usize, m: u16) -> i32 {
  let g = tab_f32(TAB_GRAV, m);
  if g < 1.0 && rnd() > g + 0.3 { return 0; }
  if can_sink(m, x, y + 1) {
    swap(x, y, e, i, x, y + 1);
    if g > 1.5 && can_sink(m, x, y + 2) { let e2 = entry(x, y + 1); if !e2.is_null() { swap(x, y + 1, e2, li(x, y + 1), x, y + 2); } }
    return 1;
  }
  let d = if rnd() < 0.5 { -1 } else { 1 };
  if can_sink(m, x + d, y + 1) && can_sink(m, x + d, y) { swap(x, y, e, i, x + d, y + 1); return 1; }
  if can_sink(m, x - d, y + 1) && can_sink(m, x - d, y) { swap(x, y, e, i, x - d, y + 1); return 1; }
  0
}

fn liquid(x: i32, y: i32, e: *mut u8, i: usize, m: u16) -> i32 {
  let g = tab_f32(TAB_GRAV, m);
  if can_sink(m, x, y + 1) { let mut p = 0.35 + g * 0.5; if p > 1.0 { p = 1.0; } if rnd() < p { swap(x, y, e, i, x, y + 1); } return 1; }
  let d = if rnd() < 0.5 { -1 } else { 1 };
  if can_sink(m, x + d, y + 1) { swap(x, y, e, i, x + d, y + 1); return 1; }
  if can_sink(m, x - d, y + 1) { swap(x, y, e, i, x - d, y + 1); return 1; }
  let sp = tab_u8(TAB_SPREAD, m) as i32;
  let mut tx = x;
  let mut k = 1;
  while k <= sp {
    let t = get(x + d * k, y);
    if (t == 0 || (t > 0 && kind(t as u16) == K_GAS)) && !blocked(x + d * k, y) { tx = x + d * k; } else { break; }
    k += 1;
  }
  if tx != x { swap(x, y, e, i, tx, y); return 1; }
  0
}

fn gas(x: i32, y: i32, e: *mut u8, i: usize, m: u16) -> i32 {
  let life = tab_u16(TAB_LIFE, m);
  if life == 0 { return 0; }
  unsafe {
    let mut a = *aux(e).add(i) as i32;
    if a == 0 { let v = ((if life > 0 { life } else { 240 }) as f32 / 4.0 + rnd() * 20.0) as i32; a = if v < 1 { 1 } else if v > 255 { 255 } else { v }; }
    if (FRAME & 3) == 0 { a -= 1; }
    if a <= 0 { set(x, y, 0, 0); return 1; }
    *aux(e).add(i) = a as u8;
    let lx = x & 511; let inner = lx > 0 && lx < 511 && (y & 511) > 0;
    let up = if inner { *mat(e).add(i - CHUNK as usize) as i32 } else { get(x, y - 1) };
    let can_up = up == 0 || (up > 0 && { let ku = kind(up as u16); ku == K_LIQUID || (ku == K_GAS && tab_f32(TAB_DENS, up as u16) > tab_f32(TAB_DENS, m)) });
    let r = rnd();
    if can_up && r < 0.7 { swap(x, y, e, i, x, y - 1); return 1; }
    let d: i32 = if r < 0.85 { -1 } else { 1 };
    let side = if inner { *mat(e).add((i as i32 + d) as usize) as i32 } else { get(x + d, y) };
    if side == 0 { swap(x, y, e, i, x + d, y); return 1; }
    let diag = if inner { *mat(e).add((i as i32 + d - CHUNK) as usize) as i32 } else { get(x + d, y - 1) };
    if diag == 0 { swap(x, y, e, i, x + d, y - 1); return 1; }
  }
  0
}

const N8_DX: [i32; 8] = [1, -1, 0, 0, 1, -1, 1, -1];
const N8_DY: [i32; 8] = [0, 0, 1, -1, 1, 1, -1, -1];

fn fire(x: i32, y: i32, e: *mut u8, i: usize, m: u16) -> i32 {
  unsafe {
    let mut a = *aux(e).add(i) as i32;
    if a == 0 { a = 6 + (rnd() * 10.0) as i32; }
    a -= 1;
    let lx = x & 511; let ly = y & 511; let inner = lx > 0 && lx < 511 && ly > 0 && ly < 511;
    let nb = |k: usize| -> i32 { if inner { *mat(e).add((i as i32 + N8_DY[k] * CHUNK + N8_DX[k]) as usize) as i32 } else { get(x + N8_DX[k], y + N8_DY[k]) } };
    let mut air = 0;
    for k in 0..4 { let t = nb(k); if t == 0 || (t > 0 && kind(t as u16) == K_GAS) { air += 1; } }
    if a <= 0 || (tab_u8(TAB_O2, m) != 0 && air == 0) {
      let out = if M_SMOKE != 0 && rnd() < 0.25 { M_SMOKE } else { 0 };
      set(x, y, out, 0); return 1;
    }
    *aux(e).add(i) = a as u8;
    let t_fire = tab_f32(TAB_FIRET, m);
    for k in 0..8 {
      let t = nb(k);
      if t <= 0 || tab_u8(TAB_BURN, t as u16) == 0 || tab_f32(TAB_AUTOIGN, t as u16) > t_fire { continue; }
      let (ne, ni) = if inner { (e, (i as i32 + N8_DY[k] * CHUNK + N8_DX[k]) as usize) } else { (entry(x + N8_DX[k], y + N8_DY[k]), li(x + N8_DX[k], y + N8_DY[k])) };
      if ne.is_null() { continue; }
      if *aux(ne).add(ni) == 0 && rnd() < 0.12 { *aux(ne).add(ni) = 1; set_dirty(ne); }
    }
    if rnd() < 0.55 {
      let up = if inner { *mat(e).add(i - CHUNK as usize) as i32 } else { get(x, y - 1) };
      if up == 0 { swap(x, y, e, i, x, y - 1); return 1; }
      let d: i32 = if rnd() < 0.5 { -1 } else { 1 };
      let diag = if inner { *mat(e).add((i as i32 + d - CHUNK) as usize) as i32 } else { get(x + d, y - 1) };
      if diag == 0 { swap(x, y, e, i, x + d, y - 1); return 1; }
    }
  }
  0
}

/// 正在燃烧的材质(aux>0):往上方空格吐火,按 fire_hp 消耗,烧完变空气 / 烟
fn burn_static(x: i32, y: i32, e: *mut u8, i: usize, m: u16) {
  unsafe {
    if tab_u8(TAB_BURN, m) == 0 { *aux(e).add(i) = 0; return; }
    let mut a = *aux(e).add(i) as i32;
    let hp = tab_f32(TAB_FIREHP, m);
    let mut rate = (6000.0 / hp) as i32; if rate < 1 { rate = 1; } if rate > 60 { rate = 60; }
    a += rate; if a > 255 { a = 255; }
    *aux(e).add(i) = a as u8; set_dirty(e);
    for k in 0..3 {
      let nx = x + if k == 0 { 0 } else if k == 1 { -1 } else { 1 }; let ny = y - 1;
      if get(nx, ny) == 0 && rnd() < 0.3 { set(nx, ny, M_FIRE, 4 + (rnd() * 8.0) as u8); }
    }
    if rnd() < 0.2 {
      let nx = x + if rnd() < 0.5 { -1 } else { 1 }; let ny = y + (rnd() * 3.0) as i32 - 1;
      let t = get(nx, ny);
      if t > 0 && tab_u8(TAB_BURN, t as u16) != 0 && tab_f32(TAB_AUTOIGN, t as u16) <= tab_f32(TAB_FIRET, M_FIRE) {
        let ne = entry(nx, ny); if !ne.is_null() { let ni = li(nx, ny); if *aux(ne).add(ni) == 0 { *aux(ne).add(ni) = 1; set_dirty(ne); } }
      }
    }
    if a >= 255 {
      let out = if tab_u8(TAB_SMOKE, m) != 0 && M_SMOKE != 0 && rnd() < 0.5 { M_SMOKE } else if rnd() < 0.5 { M_FIRE } else { 0 };
      set(x, y, out, 0);
    }
  }
}

fn react(x: i32, y: i32, e: *mut u8, i: usize) {
  unsafe {
    let m = *mat(e).add(i);
    if m == 0 { return; }
    if tab_u8(TAB_AIRRX, m) != 0 { mark_one(x, y); }
    let idx = base().add(RX_IDX) as *const u16;
    let list = base().add(RX_LIST);
    for k in 0..4 {
      let nx = x + if k == 0 { 1 } else if k == 1 { -1 } else { 0 }; let ny = y + if k == 2 { 1 } else if k == 3 { -1 } else { 0 };
      let t = get(nx, ny);
      if t < 0 { continue; }
      let mut h = *idx.add(m as usize * 1024 + t as usize) as usize;
      while h != 0 {
        let r = list.add((h - 1) * 12);
        let p = *(r as *const f32); let ox = *(r.add(4) as *const u16); let oy = *(r.add(6) as *const u16); let next = *(r.add(8) as *const u16) as usize;
        if rnd() < p * 0.5 { set(x, y, ox, 0); set(nx, ny, oy, 0); return; }
        h = next;
      }
    }
  }
}

// ── 导出 ──
#[no_mangle] pub extern "C" fn arena() -> *mut u8 { base() }
#[no_mangle] pub extern "C" fn layout(k: i32) -> i32 {
  match k { 0 => SLOT_BASE as i32, 1 => SLOT_STRIDE as i32, 2 => SLOTS as i32, 3 => S_MAT as i32, 4 => S_AUX as i32, 5 => S_ACT as i32, 6 => S_TVER as i32, 7 => S_SBLK as i32, 8 => S_FLAGS as i32,
    10 => TAB_KIND as i32, 11 => TAB_BURN as i32, 12 => TAB_SMOKE as i32, 13 => TAB_O2 as i32, 14 => TAB_SPREAD as i32, 15 => TAB_RXANY as i32, 16 => TAB_AIRRX as i32, 17 => TAB_LIFE as i32,
    18 => TAB_DENS as i32, 19 => TAB_GRAV as i32, 20 => TAB_AUTOIGN as i32, 21 => TAB_FIRET as i32, 22 => TAB_FIREHP as i32, 23 => RX_IDX as i32, 24 => RX_LIST as i32, 25 => RX_CAP as i32, _ => -1 }
}
#[no_mangle] pub extern "C" fn set_mats(m_fire: i32, m_smoke: i32) { unsafe { M_FIRE = m_fire as u16; M_SMOKE = m_smoke as u16; } }
#[no_mangle] pub extern "C" fn set_tbl(i: i32, s: i32) { unsafe { TBL[i as usize] = s; } }
#[no_mangle] pub extern "C" fn set_window(cx0b: i32, cy0b: i32, cw: i32, ch: i32, wx0: i32, wy0: i32, wx1: i32, wy1: i32, ix0: i32, iy0: i32, ix1: i32, iy1: i32) {
  unsafe { CX0B = cx0b; CY0B = cy0b; CW = cw; CH = ch; WX0 = wx0; WY0 = wy0; WX1 = wx1; WY1 = wy1; IX0 = ix0; IY0 = iy0; IX1 = ix1; IY1 = iy1; }
}
#[no_mangle] pub extern "C" fn set_obst(on: i32, x0: i32, y0: i32, x1: i32, y1: i32) { unsafe { OBST = on != 0; OX0 = x0; OY0 = y0; OX1 = x1; OY1 = y1; } }
#[no_mangle] pub extern "C" fn active() -> i32 { unsafe { ACTIVE } }
/// 清一个槽(区块进来时拷 mat 之前调,把 aux / act / tver / sblk / flags 归零)
#[no_mangle] pub extern "C" fn clear_slot(s: i32) {
  unsafe { core::ptr::write_bytes(slot(s).add(S_AUX), 0, SLOT_STRIDE - S_AUX); }
}

/// 一步(同 JS step):只步进脏块,块内自下而上、交替左右;返回动了几格,ACTIVE = 活跃块数
#[no_mangle] pub extern "C" fn step(frame: i32, lvl_in: i32, lvl_out: i32, seed: i32) -> i32 {
  unsafe {
    FRAME = frame; RNG ^= seed as u32; if RNG == 0 { RNG = 0x9E3779B9; }
    let dir_r = (frame & 1) != 0;
    let mut moved = 0; let mut active = 0;
    let mut j = CH - 1;
    while j >= 0 {
      let mut by = BN - 1;
      while by >= 0 {
        for i in 0..CW {
          let s = TBL[(j * 4 + i) as usize];
          if s < 0 { continue; }
          let e = slot(s);
          let ax0 = (CX0B + i) * CHUNK; let ay0 = (CY0B + j) * CHUNK;
          for bx in 0..BN {
            let b = (by * BN + bx) as usize;
            let ttl = *act(e).add(b);
            if ttl == 0 { continue; }
            active += 1;
            let x0 = if WX0 > ax0 + bx * BS { WX0 } else { ax0 + bx * BS }; let x1 = if WX1 < ax0 + bx * BS + BS - 1 { WX1 } else { ax0 + bx * BS + BS - 1 };
            let y0 = if WY0 > ay0 + by * BS { WY0 } else { ay0 + by * BS }; let y1 = if WY1 < ay0 + by * BS + BS - 1 { WY1 } else { ay0 + by * BS + BS - 1 };
            if x0 > x1 || y0 > y1 { continue; }
            let lvl = if x1 < IX0 || x0 > IX1 || y1 < IY0 || y0 > IY1 { lvl_out } else { lvl_in };
            if lvl > 1 && (bx + by + frame) % lvl != 0 { continue; }
            *act(e).add(b) = ttl - 1;
            let mut keep = false;
            let mut wy = y1;
            while wy >= y0 {
              let row = ((wy & 511) * CHUNK) as usize;
              for k in 0..=(x1 - x0) {
                let wx = if dir_r { x0 + k } else { x1 - k };
                let i = row + (wx & 511) as usize;
                let m = *mat(e).add(i);
                if m == 0 { continue; }
                let k0 = kind(m);
                if k0 == K_STATIC { if *aux(e).add(i) != 0 { burn_static(wx, wy, e, i, m); keep = true; } continue; }
                if k0 == K_SAND { moved += sand(wx, wy, e, i, m); }
                else if k0 == K_LIQUID { moved += liquid(wx, wy, e, i, m); }
                else if k0 == K_GAS { moved += gas(wx, wy, e, i, m); if tab_u16(TAB_LIFE, m) != 0 { keep = true; } }
                else if k0 == K_FIRE { moved += fire(wx, wy, e, i, m); keep = true; }
                let m2 = *mat(e).add(i);
                if m2 == 0 { continue; }
                if *aux(e).add(i) != 0 { let k2 = kind(m2); if k2 != K_FIRE && k2 != K_GAS { burn_static(wx, wy, e, i, m2); keep = true; } }
                if tab_u8(TAB_RXANY, m2) != 0 && ((frame + wx) & 1) != 0 { react(wx, wy, e, i); }
              }
              wy -= 1;
            }
            if keep { *act(e).add(b) = WAKE; }
          }
        }
        by -= 1;
      }
      j -= 1;
    }
    ACTIVE = active;
    moved
  }
}
