// 生成「骨骼动画播放器」HTML：解密图集 + 解析 CocoStudio(ExportJson) 与 DragonBones(ske/tex)
// 用法: node gen_model_html.cjs
const fs = require('fs')
const path = require('path')

const BASE = 'E:/soft/xiaoshuodongtai/ziyuan/main/assets'
const DATA = path.join(BASE, 'data')
const HERO = path.join(BASE, 'battlemodel/hero')
const HERODB = path.join(BASE, 'battlemodel/herodb')
const OUT = path.join(__dirname, '骨骼动画.html')

// ── TEA 解密 ──
const TEA_KEY = (() => { const b = Buffer.from('46E330EAFAF5C3E09D4A95835704AD7C', 'hex'); return [b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)] })()
const MOD = 0x100000000
function teaBody(body, k) {
  const out = Buffer.alloc(body.length), D = 0x9e3779b9
  for (let i = 0; i + 8 <= body.length; i += 8) {
    let v0 = body.readUInt32LE(i), v1 = body.readUInt32LE(i + 4); let s = (D * 16) % MOD
    for (let r = 0; r < 16; r++) {
      const a1 = ((((v0 << 4) >>> 0) + k[2]) % MOD) ^ ((v0 + s) % MOD) ^ (((v0 >>> 5) + k[3]) % MOD)
      v1 = ((v1 - (a1 >>> 0)) % MOD + MOD) % MOD
      const a0 = ((((v1 << 4) >>> 0) + k[0]) % MOD) ^ ((v1 + s) % MOD) ^ (((v1 >>> 5) + k[1]) % MOD)
      v0 = ((v0 - (a0 >>> 0)) % MOD + MOD) % MOD
      s = ((s - D) % MOD + MOD) % MOD
    }
    out.writeUInt32LE(v0 >>> 0, i); out.writeUInt32LE(v1 >>> 0, i + 4)
  }
  return out
}
function decrypt(buf) { return (buf.length > 5 && buf.toString('latin1', 0, 4) === 'GaMe') ? teaBody(buf.slice(5), TEA_KEY) : buf }
function pngDataUrl(buf) { const d = decrypt(buf); if (d.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null; return 'data:image/png;base64,' + d.toString('base64') }

// ── member.tbl ──
function parseTbl(file) {
  const t = fs.readFileSync(path.join(DATA, file), 'utf16le').replace(/^\uFEFF/, '').replace(/\r/g, '')
  const lines = t.split('\n').filter(l => l.length); const keys = lines[1].split('\t')
  return lines.slice(3).map(line => { const c = line.split('\t'); const o = {}; keys.forEach((k, i) => o[k] = c[i] ?? ''); return o })
}
const members = parseTbl('member.tbl').filter(r => { const e = +r.ElemType; return e >= 1 && e <= 3 })

// ── CocoStudio 模型 ──
function parsePlist(xml) {
  const frames = {}; const re = /<key>([^<]*\.png)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g; let m
  while ((m = re.exec(xml))) {
    const name = m[1], body = m[2]
    const g = k => { const mm = new RegExp('<key>' + k + '</key>\\s*<(?:integer|real)>(-?\\d+(?:\\.\\d+)?)</(?:integer|real)>').exec(body); return mm ? parseFloat(mm[1]) : 0 }
    frames[name] = { x: g('x'), y: g('y'), w: g('width'), h: g('height') }
  }
  return frames
}
function buildCS(modelName) {
  const ejPath = path.join(HERO, modelName + '.ExportJson')
  if (!fs.existsSync(ejPath)) return null
  let ej; try { ej = JSON.parse(fs.readFileSync(ejPath, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { return null }
  const arm = ej.armature_data && ej.armature_data[0]; if (!arm) return null
  const pngName = (arm.config_png_path && arm.config_png_path[0]) || (modelName + '0.png')
  const plistName = (arm.config_file_path && arm.config_file_path[0]) || (modelName + '0.plist')
  const pp = path.join(HERO, pngName), lp = path.join(HERO, plistName)
  if (!fs.existsSync(pp) || !fs.existsSync(lp)) return null
  const atlas = pngDataUrl(fs.readFileSync(pp)); if (!atlas) return null
  const frames = parsePlist(fs.readFileSync(lp, 'utf8'))
  // 存全部骨骼(含无显示的父级)用于层级；drawOrder 只含有显示的，按 z 排序
  const bones = {}
  for (const bd of arm.bone_data) {
    bones[bd.name] = {
      name: bd.name, parent: bd.parent || '', z: bd.z || 0,
      x: +bd.x || 0, y: +bd.y || 0, cX: bd.cX == null ? 1 : +bd.cX, cY: bd.cY == null ? 1 : +bd.cY, kX: +bd.kX || 0, kY: +bd.kY || 0,
      displays: (bd.display_data || []).map(d => ({ name: d.name, skin: (d.skin_data && d.skin_data[0]) || {} })),
    }
  }
  const drawOrder = Object.values(bones).filter(b => b.displays.length).sort((a, b) => a.z - b.z).map(b => b.name)
  const anims = {}
  const ad = ej.animation_data && ej.animation_data[0]
  if (ad) for (const mov of ad.mov_data) {
    const tracks = {}
    for (const mb of mov.mov_bone_data) tracks[mb.name] = mb.frame_data.map(f => ({ fi: f.fi || 0, x: +f.x || 0, y: +f.y || 0, cX: f.cX == null ? 1 : +f.cX, cY: f.cY == null ? 1 : +f.cY, kX: +f.kX || 0, kY: +f.kY || 0, a: f.color && f.color.a != null ? f.color.a : 255, di: f.dI == null ? 0 : f.dI, bd: f.bd_dst == null ? 771 : f.bd_dst }))
    anims[mov.name] = { dr: mov.dr || 1, lp: !!mov.lp, tracks }
  }
  return { type: 'cs', atlas, frames, bones, drawOrder, anims }
}

// ── DragonBones 模型 ──
function buildDB(dbName) {
  const skePath = path.join(HERODB, dbName + '_ske.json')
  const texPath = path.join(HERODB, dbName + '_tex.json')
  const pngPath = path.join(HERODB, dbName + '_tex.png')
  if (!fs.existsSync(skePath) || !fs.existsSync(texPath) || !fs.existsSync(pngPath)) return null
  const atlas = pngDataUrl(fs.readFileSync(pngPath)); if (!atlas) return null
  const tex = JSON.parse(fs.readFileSync(texPath, 'utf8').replace(/^\uFEFF/, ''))
  const sub = {}
  for (const s of tex.SubTexture) sub[s.name] = { x: s.x, y: s.y, w: s.width, h: s.height, fx: s.frameX || 0, fy: s.frameY || 0, fw: s.frameWidth || s.width, fh: s.frameHeight || s.height }
  const ske = JSON.parse(fs.readFileSync(skePath, 'utf8').replace(/^\uFEFF/, ''))
  const arm = ske.armature[0]
  const bones = arm.bone.map(b => ({ name: b.name, parent: b.parent || '', t: b.transform || {} }))
  const slots = arm.slot.map(s => ({ name: s.name, parent: s.parent, di: s.displayIndex == null ? 0 : s.displayIndex, blend: s.blendMode || 'normal' }))
  const skin = {}
  for (const sl of arm.skin[0].slot) {
    skin[sl.name] = sl.display.map(dp => {
      const o = { type: dp.type || 'image', path: dp.path || dp.name, t: dp.transform || {} }
      if (dp.type === 'mesh') { o.vertices = dp.vertices; o.uvs = dp.uvs; o.triangles = dp.triangles }
      return o
    })
  }
  const anims = {}
  for (const an of arm.animation) {
    const bone = {}, slot = {}
    if (an.bone) for (const bt of an.bone) bone[bt.name] = (bt.frame || []).map(f => ({ d: f.duration || 0, tw: f.tweenEasing, t: f.transform || {} }))
    if (an.slot) for (const st of an.slot) slot[st.name] = (st.frame || []).map(f => ({ d: f.duration || 0, tw: f.tweenEasing, di: f.displayIndex == null ? null : f.displayIndex, a: f.color && f.color.aM != null ? f.color.aM / 100 : 1 }))
    anims[an.name] = { dur: an.duration || 1, pt: an.playTimes == null ? 0 : an.playTimes, bone, slot }
  }
  return { type: 'db', atlas, sub, bones, slots, skin, anims, fps: ske.frameRate || 60 }
}

// 为每架可玩飞机构建模型
const seen = {}, models = [], planeList = []
for (const r of members) {
  let mdl = (r.MemberModel || '').trim(); if (!mdl) continue
  const key = mdl
  if (seen[key] === undefined) {
    let data = buildCS(mdl)
    if (!data) { const db = mdl.replace(/_dragonbone$/, ''); data = buildDB(db) }
    seen[key] = data || null
    if (data) models.push([key, data])
  }
  if (seen[key]) planeList.push({ id: +r.MemberID, name: r.Name.trim(), model: key })
}

// ── 挂载(僚机 L_01~L_15) ──
const guazai = parseTbl('guazai.tbl')
const gSeenModel = {}
for (const r of guazai) {
  const id = +r.ID
  if (!r.Name || Math.floor(id / 1000) % 10 !== 1) continue // 仅僚机(31xxx)
  const mdl = (r.Model || '').trim()
  if (!mdl || gSeenModel[mdl]) continue
  if (seen[mdl] === undefined) { const data = buildCS(mdl); seen[mdl] = data || null; if (data) models.push([mdl, data]) }
  if (!seen[mdl]) continue
  gSeenModel[mdl] = 1
  planeList.push({ id: 900000 + id, name: '挂载·' + r.Name.trim().replace(/[ⅠⅡⅢⅣ]/g, '') + ' (' + mdl + ')', model: mdl, cat: 'guazai' })
}

const payload = { planes: planeList, models: Object.fromEntries(models) }
fs.writeFileSync(OUT, buildHtml(JSON.stringify(payload)), 'utf8')
const cs = models.filter(m => m[1].type === 'cs').length, db = models.filter(m => m[1].type === 'db').length
console.log('models:', models.length, '(cs', cs, ', db', db, ')  planes mapped:', planeList.length)
console.log('written', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(1) + 'MB')

function buildHtml(json) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>战机骨骼动画 · 播放器</title>
<style>
 body{margin:0;background:radial-gradient(1000px 600px at 60% -10%,#16233d,#0a0e17 60%);color:#dbe6f5;font:14px "Microsoft YaHei",system-ui,sans-serif}
 .top{padding:12px 20px;border-bottom:1px solid #243350;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
 h1{font-size:17px;margin:0}.sub{color:#8ba0c0;font-size:12px}
 .wrap{display:grid;grid-template-columns:210px 1fr;gap:16px;padding:16px 20px;max-width:1120px;margin:0 auto}
 .card{background:linear-gradient(180deg,#121a2b,#0f1626);border:1px solid #243350;border-radius:14px;padding:12px}
 .list{max-height:600px;overflow:auto;display:flex;flex-direction:column;gap:4px}
 .item{padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent;color:#b9c8e0;font-size:13px}
 .item:hover{background:#16223a}.item.sel{background:#1b2b48;border-color:#6ea8ff;color:#fff}
 .tag{font-size:10px;color:#6f86a8;border:1px solid #2a3a5a;border-radius:4px;padding:0 4px;margin-left:6px}
 .stage{display:flex;flex-direction:column;align-items:center;gap:12px}
 canvas{background:radial-gradient(circle at 50% 45%,#1a3056aa,transparent 70%);border-radius:16px}
 .ctrl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
 .btn{cursor:pointer;border:1px solid #2a3a5a;background:linear-gradient(180deg,#1b2740,#141d30);color:#dbe6f5;border-radius:8px;padding:6px 12px;font-size:13px}
 .btn.sel{border-color:#ffce54;color:#ffce54}
 label{color:#8ba0c0;font-size:12px}
</style></head>
<body>
<div class="top"><h1>✈ 战机骨骼动画播放器</h1><span class="sub">CocoStudio + DragonBones · 图集已解密(GaMe/TEA)</span></div>
<div class="wrap">
 <div class="card"><div class="list" id="list"></div></div>
 <div class="card stage">
   <canvas id="cv" width="480" height="600"></canvas>
   <div class="ctrl" id="anims"></div>
   <div class="ctrl">
     <label>速度</label><input id="spd" type="range" min="10" max="60" value="30"/><span id="spdv" class="sub">30 fps</span>
     <label>缩放</label><input id="scl" type="range" min="30" max="220" value="100"/>
     <label><input id="bloom" type="checkbox" checked/> 辉光</label>
   </div>
 </div>
</div>
<script>
const DB=${json};
let cur=DB.planes[0], curAnim=null, fps=30, scl=1.0, bloom=true;
const imgCache={};
function loadImg(url){return new Promise(res=>{if(imgCache[url])return res(imgCache[url]);const im=new Image();im.onload=()=>{imgCache[url]=im;res(im);};im.src=url;});}
function lerp(a,b,t){return a+(b-a)*t;}

function renderList(){const el=document.getElementById('list');el.innerHTML='';for(const p of DB.planes){const d=document.createElement('div');d.className='item'+(p.id===cur.id?' sel':'');const t=DB.models[p.model].type;d.innerHTML=p.name+'<span class="tag">'+t+'</span>';d.onclick=()=>{cur=p;pick(p);};el.appendChild(d);}}
function animNames(m){return m.type==='cs'?Object.keys(m.anims):Object.keys(m.anims);}
function renderAnims(m){const el=document.getElementById('anims');el.innerHTML='';const names=animNames(m);curAnim=names.includes(curAnim)?curAnim:(names.includes('putong')?'putong':names[0]);for(const n of names){const b=document.createElement('div');b.className='btn'+(n===curAnim?' sel':'');b.textContent=n;b.onclick=()=>{curAnim=n;startT=performance.now();renderAnims(m);};el.appendChild(b);}}
async function pick(p){renderList();const m=DB.models[p.model];await loadImg(m.atlas);renderAnims(m);startT=performance.now();}

// ── CocoStudio 采样 ──
function sampleCS(track,t){if(!track||!track.length)return null;if(t<=track[0].fi)return track[0];if(t>=track[track.length-1].fi)return track[track.length-1];for(let i=0;i<track.length-1;i++){const A=track[i],B=track[i+1];if(t>=A.fi&&t<=B.fi){const u=(B.fi-A.fi)?(t-A.fi)/(B.fi-A.fi):0;return{x:lerp(A.x,B.x,u),y:lerp(A.y,B.y,u),cX:lerp(A.cX,B.cX,u),cY:lerp(A.cY,B.cY,u),kX:lerp(A.kX,B.kX,u),kY:lerp(A.kY,B.kY,u),a:lerp(A.a,B.a,u)};}}return track[track.length-1];}
function stepFrame(track,t){if(!track||!track.length)return null;let f=track[0];for(const k of track){if(k.fi<=t)f=k;else break;}return f;}
// cocos 仿射(y-up)：由 x,y,scaleX,scaleY,skewX,skewY 生成 [a,b,c,d,tx,ty]
function csMat(x,y,sx,sy,skx,sky){return [Math.cos(sky)*sx, Math.sin(sky)*sx, -Math.sin(skx)*sy, Math.cos(skx)*sy, x, y];}
function drawCS(ctx,m,im,t,CX,CY){const anim=m.anims[curAnim];const dur=Math.max(1,anim.dr);t=anim.lp?(t%dur):Math.min(t,dur);
 const world={};
 function solveW(name){ if(world[name])return world[name]; const b=m.bones[name]; if(!b)return [1,0,0,1,0,0];
   const tk=anim.tracks[name]; const tr=(tk&&tk.length)?sampleCS(tk,t):{x:0,y:0,cX:1,cY:1,kX:0,kY:0};
   const local=csMat(b.x+tr.x, b.y+tr.y, b.cX*tr.cX, b.cY*tr.cY, b.kX+tr.kX, b.kY+tr.kY);
   const w=(b.parent&&m.bones[b.parent])?matMul(solveW(b.parent),local):local; world[name]=w; return w; }
 for(const name of m.drawOrder){ const b=m.bones[name]; const track=anim.tracks[name];
  let tr,di,bd; if(track&&track.length){tr=sampleCS(track,t);const sf=stepFrame(track,t);di=sf.di;bd=sf.bd;}else{tr={x:0,y:0,cX:1,cY:1,kX:0,kY:0,a:255};di=0;bd=771;}
  if(di<0)continue; // dI<0(如-1/-1000)表示隐藏
  const disp=b.displays[Math.min(Math.max(di,0),b.displays.length-1)]||b.displays[0]; if(!disp)continue;
  const fr=m.frames[disp.name];if(!fr)continue;
  const sk=disp.skin||{}; const skM=csMat(sk.x||0, sk.y||0, sk.cX==null?1:sk.cX, sk.cY==null?1:sk.cY, sk.kX||0, sk.kY||0);
  const mm=matMul(solveW(name), skM); const w=fr.w,h=fr.h;
  const E=CX+mm[0]*(-w/2)+mm[2]*(h/2)+mm[4];
  const F=CY-(mm[1]*(-w/2)+mm[3]*(h/2)+mm[5]);
  ctx.globalAlpha=Math.max(0,Math.min(1,(tr.a==null?255:tr.a)/255));
  ctx.globalCompositeOperation=(bd===1)?'lighter':'source-over';
  setT(ctx,[mm[0],-mm[1],-mm[2],mm[3],E,F]);ctx.drawImage(im,fr.x,fr.y,w,h,0,0,w,h);}
 ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';}

// ── DragonBones ──
function matFrom(t){const skX=(t.skX||0)*Math.PI/180,skY=(t.skY||0)*Math.PI/180,scX=t.scX==null?1:t.scX,scY=t.scY==null?1:t.scY;return[Math.cos(skY)*scX,Math.sin(skY)*scX,-Math.sin(skX)*scY,Math.cos(skX)*scY,t.x||0,t.y||0];}
function matMul(P,l){return[P[0]*l[0]+P[2]*l[1],P[1]*l[0]+P[3]*l[1],P[0]*l[2]+P[2]*l[3],P[1]*l[2]+P[3]*l[3],P[0]*l[4]+P[2]*l[5]+P[4],P[1]*l[4]+P[3]*l[5]+P[5]];}
let BASE=[1,0,0,1,0,0];
function setT(ctx,M){const C=matMul(BASE,M);ctx.setTransform(C[0],C[1],C[2],C[3],C[4],C[5]);}
function trackAt(frames,t){ // 返回 {seg,idx,u}
 if(!frames||!frames.length)return null;let acc=0;for(let i=0;i<frames.length;i++){const f=frames[i];const dur=f.d;if(dur<=0){return{a:f,b:f,u:0};}if(t<acc+dur||i===frames.length-1){const nf=frames[i+1]||f;let u=dur>0?(t-acc)/dur:0;if(f.tw==null)u=0;return{a:f,b:nf,u:Math.max(0,Math.min(1,u))};}acc+=dur;}return{a:frames[frames.length-1],b:frames[frames.length-1],u:0};}
function boneAnimT(seg){if(!seg)return{x:0,y:0,skX:0,skY:0,scX:1,scY:1};const a=seg.a.t,b=seg.b.t,u=seg.u;return{x:lerp(a.x||0,b.x||0,u),y:lerp(a.y||0,b.y||0,u),skX:lerp(a.skX||0,b.skX||0,u),skY:lerp(a.skY||0,b.skY||0,u),scX:lerp(a.scX==null?1:a.scX,b.scX==null?1:b.scX,u),scY:lerp(a.scY==null?1:a.scY,b.scY==null?1:b.scY,u)};}
function drawTri(ctx,im,sx0,sy0,sx1,sy1,sx2,sy2,dx0,dy0,dx1,dy1,dx2,dy2){
 ctx.save();ctx.beginPath();ctx.moveTo(dx0,dy0);ctx.lineTo(dx1,dy1);ctx.lineTo(dx2,dy2);ctx.closePath();ctx.clip();
 const denom=sx0*(sy2-sy1)-sx1*sy2+sx2*sy1+(sx1-sx2)*sy0;if(Math.abs(denom)<1e-6){ctx.restore();return;}
 const m11=-(sy0*(dx2-dx1)-sy1*dx2+sy2*dx1+(sy1-sy2)*dx0)/denom;
 const m12=(sy1*dy2+sy0*(dy1-dy2)-sy2*dy1+(sy2-sy1)*dy0)/denom;
 const m21=(sx0*(dx2-dx1)-sx1*dx2+sx2*dx1+(sx1-sx2)*dx0)/denom;
 const m22=-(sx1*dy2+sx0*(dy1-dy2)-sx2*dy1+(sx2-sx1)*dy0)/denom;
 const dx=(sx0*(sy2*dx1-sy1*dx2)+sy0*(sx1*dx2-sx2*dx1)+(sx2*sy1-sx1*sy2)*dx0)/denom;
 const dy=(sx0*(sy2*dy1-sy1*dy2)+sy0*(sx1*dy2-sx2*dy1)+(sx2*sy1-sx1*sy2)*dy0)/denom;
 ctx.transform(m11,m12,m21,m22,dx,dy);ctx.drawImage(im,0,0);ctx.restore();}
function drawDB(ctx,m,im,t,CX,CY){
 const anim=m.anims[curAnim];const dur=Math.max(1,anim.dur);const loop=(anim.pt===0);t=loop?(t%dur):Math.min(t,dur);
 const bmap={};for(const b of m.bones)bmap[b.name]=b;
 const world={};
 function solve(bn){if(world[bn])return world[bn];const b=bmap[bn];if(!b)return[1,0,0,1,0,0];const at=boneAnimT(trackAt(anim.bone[bn],t));const base=b.t;const comb={x:(base.x||0)+at.x,y:(base.y||0)+at.y,skX:(base.skX||0)+at.skX,skY:(base.skY||0)+at.skY,scX:(base.scX==null?1:base.scX)*at.scX,scY:(base.scY==null?1:base.scY)*at.scY};const l=matFrom(comb);const w=(b.parent&&bmap[b.parent])?matMul(solve(b.parent),l):l;world[bn]=w;return w;}
 for(const b of m.bones)solve(b.name);
 const root=[1,0,0,1,CX,CY];
 for(const sl of m.slots){
   let di=sl.di, alpha=1;const st=anim.slot[sl.name];
   if(st){const seg=trackAt(st,t);if(seg){if(seg.a.di!=null)di=seg.a.di;alpha=seg.a.a==null?1:seg.a.a;}}
   if(di<0)continue;const disps=m.skin[sl.name];if(!disps||di>=disps.length)continue;const dp=disps[di];
   const bw=world[sl.parent]||[1,0,0,1,0,0];const W=matMul(root,matMul(bw,matFrom(dp.t)));
   const s=m.sub[dp.path];if(!s)continue;
   ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
   ctx.globalCompositeOperation=(sl.blend==='add')?'lighter':'source-over';
   if(dp.type==='mesh'&&dp.triangles&&dp.vertices){
     const V=dp.vertices,U=dp.uvs,T=dp.triangles;
     const P=[];for(let i=0;i<V.length;i+=2){P.push([W[0]*V[i]+W[2]*V[i+1]+W[4],W[1]*V[i]+W[3]*V[i+1]+W[5]]);}
     const UV=[];for(let i=0;i<U.length;i+=2){UV.push([s.x+U[i]*s.w,s.y+U[i+1]*s.h]);}
     setT(ctx,[1,0,0,1,0,0]);
     for(let i=0;i<T.length;i+=3){const a=T[i],b=T[i+1],c=T[i+2];drawTri(ctx,im,UV[a][0],UV[a][1],UV[b][0],UV[b][1],UV[c][0],UV[c][1],P[a][0],P[a][1],P[b][0],P[b][1],P[c][0],P[c][1]);}
   } else {
     const lx=-s.fw/2-s.fx, ly=-s.fh/2-s.fy;
     setT(ctx,[W[0],W[1],W[2],W[3],W[0]*lx+W[2]*ly+W[4],W[1]*lx+W[3]*ly+W[5]]);
     ctx.drawImage(im,s.x,s.y,s.w,s.h,0,0,s.w,s.h);
   }
 }
 ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
}

let startT=performance.now();
let buf=null,bctx=null;
function frame(now){
 const cv=document.getElementById('cv'),ctx=cv.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
 const m=DB.models[cur.model],im=imgCache[m.atlas];
 if(m&&im&&curAnim&&m.anims[curAnim]){
   if(!buf){buf=document.createElement('canvas');buf.width=cv.width;buf.height=cv.height;bctx=buf.getContext('2d');}
   bctx.setTransform(1,0,0,1,0,0);bctx.clearRect(0,0,buf.width,buf.height);
   const cx=cv.width/2, cy=cv.height*0.5;
   BASE=[scl,0,0,scl, cx-scl*cx, cy-scl*cy];
   const t=((now-startT)/1000*fps);
   if(m.type==='cs')drawCS(bctx,m,im,t,cv.width/2,cv.height*0.55);else drawDB(bctx,m,im,t,cv.width/2,cv.height*0.5);
   bctx.setTransform(1,0,0,1,0,0);
   // 先柔和辉光垫底(仅能量泛光)，再把清晰机体叠上，机体保持锐利
   if(bloom){ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=0.4;ctx.filter='blur(4px)';ctx.drawImage(buf,0,0);ctx.filter='none';ctx.restore();}
   ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.drawImage(buf,0,0);
 }
 requestAnimationFrame(frame);
}
document.getElementById('spd').oninput=e=>{fps=+e.target.value;document.getElementById('spdv').textContent=fps+' fps';};
document.getElementById('scl').oninput=e=>{scl=(+e.target.value)/100;};
document.getElementById('bloom').onchange=e=>{bloom=e.target.checked;};
pick(cur).then(()=>requestAnimationFrame(frame));
</script>
</body></html>`
}
