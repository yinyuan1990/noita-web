// 敌人骨骼动画播放器：CocoStudio-XML(monster/) + 静态png。Spine(monster_spine/)暂列为待支持。
// 贴图解密后放到 enemy_tex/(相对目录，双击HTML即可加载)；骨骼数据内联进 HTML。
// 用法: node gen_enemy_html.cjs
const fs = require('fs'); const path = require('path')
const A = 'E:/soft/xiaoshuodongtai/ziyuan/main/assets/'
const BM = A + 'battlemodel/'
const MON = BM + 'monster/'
const SPINE = BM + 'monster_spine/'
const TEXDIR = path.join(__dirname, 'enemy_tex')
const OUT = path.join(__dirname, '敌人动画.html')

// TEA 解密
const TEA_KEY = (() => { const b = Buffer.from('46E330EAFAF5C3E09D4A95835704AD7C', 'hex'); return [b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)] })()
const MOD = 0x100000000
function teaBody(body, k) { const out = Buffer.alloc(body.length), D = 0x9e3779b9; for (let i = 0; i + 8 <= body.length; i += 8) { let v0 = body.readUInt32LE(i), v1 = body.readUInt32LE(i + 4), s = (D * 16) % MOD; for (let r = 0; r < 16; r++) { const a1 = ((((v0 << 4) >>> 0) + k[2]) % MOD) ^ ((v0 + s) % MOD) ^ (((v0 >>> 5) + k[3]) % MOD); v1 = ((v1 - (a1 >>> 0)) % MOD + MOD) % MOD; const a0 = ((((v1 << 4) >>> 0) + k[0]) % MOD) ^ ((v1 + s) % MOD) ^ (((v1 >>> 5) + k[1]) % MOD); v0 = ((v0 - (a0 >>> 0)) % MOD + MOD) % MOD; s = ((s - D) % MOD + MOD) % MOD } out.writeUInt32LE(v0 >>> 0, i); out.writeUInt32LE(v1 >>> 0, i + 4) } return out }
function decPng(buf) { const d = (buf.length > 5 && buf.toString('latin1', 0, 4) === 'GaMe') ? teaBody(buf.slice(5), TEA_KEY) : buf; return d.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? d : null }

function P(f) { const t = fs.readFileSync(A + 'data/' + f, 'utf16le').replace(/^\uFEFF/, '').replace(/\r/g, ''); const L = t.split('\n').filter(x => x.length); const k = L[1].split('\t'); return L.slice(3).map(l => { const c = l.split('\t'); const o = {}; k.forEach((kk, i) => o[kk] = c[i] ?? ''); return o }) }

// 标准 cocos plist: frame "{{x,y},{w,h}}" + rotated
function parseStdPlist(xml) {
  const frames = {}
  const re = /<key>([^<]+\.png)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g; let m
  while ((m = re.exec(xml))) {
    const nm = m[1], body = m[2]
    const fr = /<key>frame<\/key>\s*<string>\{\{(-?\d+),(-?\d+)\},\{(\d+),(\d+)\}\}/.exec(body)
    if (!fr) continue
    const rot = /<key>rotated<\/key>\s*<(true|false)/.exec(body)
    frames[nm] = { x: +fr[1], y: +fr[2], w: +fr[3], h: +fr[4], rot: !!(rot && rot[1] === 'true') }
  }
  return frames
}

// 解析 CocoStudio XML：栈式解析骨骼(支持嵌套父子)，动画按 dr 累计时间
function attrs(s) { const o = {}; let m; const re = /(\w+)="(-?[\d.NaN]*)"/g; while ((m = re.exec(s))) o[m[1]] = m[2]; return o }
function num(v, d) { const n = parseFloat(v); return isNaN(n) ? d : n }
function parseMonsterXml(xml) {
  const armM = /<armature[^>]*>([\s\S]*?)<\/armature>/.exec(xml); if (!armM) return null
  const arm = armM[1]
  // 栈式扫描 <b ...> ... </b>，<d .../> 取显示
  const bones = {}; const order = []
  const tokRe = /<b\s([^>]*?)>|<\/b>|<d\s([^>]*?)\/>/g; let t; const stack = []
  while ((t = tokRe.exec(arm))) {
    if (t[0].startsWith('</b')) { stack.pop(); continue }
    if (t[1] !== undefined) { const a = attrs(t[1]); const nm = a.name; const parent = stack.length ? stack[stack.length - 1] : ''; bones[nm] = { name: nm, parent, x: num(a.x, 0), y: num(a.y, 0), cX: num(a.cX, 1), cY: num(a.cY, 1), kX: num(a.kX, 0), kY: num(a.kY, 0), pX: num(a.pX, 0), pY: num(a.pY, 0), z: num(a.z, 0), disp: '' }; order.push(nm); stack.push(nm) }
    else if (t[2] !== undefined) { const a = attrs(t[2]); if (stack.length && !bones[stack[stack.length - 1]].disp) bones[stack[stack.length - 1]].disp = a.name + '.png' }
  }
  const drawOrder = order.filter(n => bones[n].disp).sort((a, b) => bones[a].z - bones[b].z)
  // 动画
  const anims = {}
  const movRe = /<mov\s([^>]*)>([\s\S]*?)<\/mov>/g; let mv
  while ((mv = movRe.exec(xml))) {
    const ma = attrs(mv[1]); const body = mv[2]; const tracks = {}
    const bRe = /<b\s([^>]*?)>([\s\S]*?)<\/b>/g; let bt
    while ((bt = bRe.exec(body))) {
      const ba = attrs(bt[1]); const bn = ba.name; const frames = []; let acc = 0
      const fRe = /<f\s([^>]*?)\/>/g; let ff
      while ((ff = fRe.exec(bt[2]))) { const fa = attrs(ff[1]); frames.push({ fi: acc, x: num(fa.x, 0), y: num(fa.y, 0), cX: num(fa.cX, 1), cY: num(fa.cY, 1), kX: num(fa.kX, 0), kY: num(fa.kY, 0), pX: num(fa.pX, 0), pY: num(fa.pY, 0), di: num(fa.dI, 0) }); acc += num(fa.dr, 1) }
      tracks[bn] = frames
    }
    anims[ma.name] = { dur: num(ma.dr, 1), lp: ma.lp === '1', tracks }
  }
  return { bones, drawOrder, anims }
}

// —— Spine 解析 ——
function parseAtlasText(txt) {
  const lines = txt.split('\n'); let page = null; const regions = {}
  for (const l of lines) { if (l.trim().endsWith('.png')) { page = l.trim(); break } }
  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    if (ln && !ln.startsWith(' ') && !ln.endsWith('.png') && ln.indexOf(':') < 0) {
      const nm = ln.trim(); const r = { rotate: false }; let j = i + 1
      while (j < lines.length && lines[j].startsWith(' ')) {
        const [k, v] = lines[j].split(':').map(s => s.trim())
        if (k === 'rotate') r.rotate = v === 'true'
        else if (k === 'xy') { const a = v.split(',').map(Number); r.x = a[0]; r.y = a[1] }
        else if (k === 'size') { const a = v.split(',').map(Number); r.w = a[0]; r.h = a[1] }
        else if (k === 'orig') { const a = v.split(',').map(Number); r.ow = a[0]; r.oh = a[1] }
        else if (k === 'offset') { const a = v.split(',').map(Number); r.ox = a[0]; r.oy = a[1] }
        j++
      }
      regions[nm] = r; i = j
    } else i++
  }
  return { page, regions }
}
function buildSpine(sj) {
  const bones = sj.bones.map(b => ({ name: b.name, parent: b.parent || '', x: b.x || 0, y: b.y || 0, rot: b.rotation || 0, sx: b.scaleX == null ? 1 : b.scaleX, sy: b.scaleY == null ? 1 : b.scaleY }))
  const slots = sj.slots.map(s => ({ name: s.name, bone: s.bone, att: s.attachment || null }))
  const skin = {}
  const def = sj.skins.default
  for (const sl in def) { skin[sl] = {}; for (const at in def[sl]) { const a = def[sl][at]; const t = a.type || 'region'; const o = { type: t }; if (t === 'region') { o.x = a.x || 0; o.y = a.y || 0; o.rot = a.rotation || 0; o.sx = a.scaleX == null ? 1 : a.scaleX; o.sy = a.scaleY == null ? 1 : a.scaleY; o.w = a.width; o.h = a.height; o.name = a.name || at } else { o.uvs = a.uvs; o.tri = a.triangles; o.verts = a.vertices; o.name = a.name || at } skin[sl][at] = o } }
  const anims = {}
  for (const an in sj.animations) {
    const A = sj.animations[an]; const B = {}; let dur = 0
    if (A.bones) for (const bn in A.bones) { const tl = A.bones[bn]; const o = {}; for (const kind of ['rotate', 'translate', 'scale']) if (tl[kind]) { o[kind] = tl[kind].map(f => ({ t: f.time || 0, x: f.x, y: f.y, a: f.angle })); dur = Math.max(dur, o[kind][o[kind].length - 1].t) } B[bn] = o }
    const SL = {}
    if (A.slots) for (const sn in A.slots) { const tl = A.slots[sn]; if (tl.attachment) { SL[sn] = tl.attachment.map(f => ({ t: f.time || 0, name: f.name })); dur = Math.max(dur, SL[sn][SL[sn].length - 1].t) } }
    anims[an] = { dur: dur || 1, bones: B, slots: SL }
  }
  return { bones, slots, skin, anims }
}

// —— 收集敌人 ——
const pages = {}
if (!fs.existsSync(TEXDIR)) fs.mkdirSync(TEXDIR)
const bm = P('battlemonster.tbl')
const nameByModel = {}
for (const r of bm) if (r.Model && !nameByModel[r.Model]) nameByModel[r.Model] = r.MonsterName || ''
const uniq = Object.keys(nameByModel)
const ex = p => { try { fs.accessSync(p); return true } catch (e) { return false } }
// 解密并返回 base64 data URL（内嵌，避免 file:// 加载问题）
const texCache = {}
function saveTex(srcPng, key) { if (texCache[key] !== undefined) return texCache[key]; const d = decPng(fs.readFileSync(srcPng)); texCache[key] = d ? ('data:image/png;base64,' + d.toString('base64')) : null; return texCache[key] }

const list = []; let nXml = 0, nStatic = 0, nSpine = 0, nSkip = 0
for (const model of uniq) {
  const label = nameByModel[model] || model
  const base = model.replace(/\.(def|png|spine)$/i, '')
  const leaf = base.split('/').pop()
  const key = base.replace(/[\/]/g, '_')
  // Spine?
  if (ex(SPINE + leaf + '.json') && ex(SPINE + leaf + '.atlas')) {
    const { page, regions } = parseAtlasText(fs.readFileSync(SPINE + leaf + '.atlas', 'utf8'))
    const pagePath = SPINE + page; const pk = 'pg_' + (page || '').replace(/\W/g, '_')
    if (page && pages[pk] === undefined) { const src = ex(pagePath) ? pagePath : (ex(SPINE + leaf + '.png') ? SPINE + leaf + '.png' : null); pages[pk] = src ? saveTex(src, pk) : null }
    if (page && pages[pk]) {
      try { const sj = JSON.parse(fs.readFileSync(SPINE + leaf + '.json', 'utf8')); const data = buildSpine(sj); list.push({ key, label, model, fmt: 'spine', page: pk, regions, ...data }); nSpine++; continue } catch (e) { }
    }
    list.push({ key, label, model, fmt: 'spine' }); nSpine++; continue
  }
  // XML?
  let xmlPath = ex(MON + base + '.xml') ? MON + base + '.xml' : (ex(MON + leaf + '.xml') ? MON + leaf + '.xml' : null)
  if (xmlPath) {
    const dir = path.dirname(xmlPath)
    const plistPath = xmlPath.replace(/\.xml$/, '.plist'); const pngPath = xmlPath.replace(/\.xml$/, '.png')
    const td = (ex(plistPath) && ex(pngPath)) ? saveTex(pngPath, key) : null
    if (td) {
      const data = parseMonsterXml(fs.readFileSync(xmlPath, 'utf8'))
      const frames = parseStdPlist(fs.readFileSync(plistPath, 'utf8'))
      if (data && Object.keys(frames).length) { list.push({ key, label, model, fmt: 'xml', tex: td, frames, ...data }); nXml++; continue }
    }
  }
  // 静态 png?
  let pngPath = null
  for (const cand of [A + model, A + base + '.png', MON + base + '.png', MON + leaf + '.png', BM + model]) if (ex(cand)) { pngPath = cand; break }
  const tds = pngPath ? saveTex(pngPath, key) : null
  if (tds) { list.push({ key, label, model, fmt: 'static', tex: tds }); nStatic++; continue }
  nSkip++
}
const fmtOrder = { xml: 0, static: 1, spine: 2 }
list.sort((a, b) => (fmtOrder[a.fmt] - fmtOrder[b.fmt]))
console.log('敌人:', list.length, '| XML', nXml, '静态', nStatic, 'Spine(待支持)', nSpine, '跳过', nSkip)

fs.writeFileSync(OUT, buildHtml(JSON.stringify({ list, pages })))
console.log('written', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB', '| pages', Object.keys(pages).filter(k => pages[k]).length)

function buildHtml(json) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>敌人骨骼动画</title><style>
 body{margin:0;background:radial-gradient(1000px 600px at 60% -10%,#16233d,#0a0e17 60%);color:#dbe6f5;font:14px "Microsoft YaHei",sans-serif}
 .top{padding:12px 20px;border-bottom:1px solid #243350;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
 h1{font-size:17px;margin:0}.sub{color:#8ba0c0;font-size:12px}
 .wrap{display:grid;grid-template-columns:240px 1fr;gap:16px;padding:16px 20px;max-width:1100px;margin:0 auto}
 .card{background:linear-gradient(180deg,#121a2b,#0f1626);border:1px solid #243350;border-radius:14px;padding:12px}
 .list{max-height:620px;overflow:auto;display:flex;flex-direction:column;gap:3px}
 .item{padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid transparent;color:#b9c8e0;font-size:13px;display:flex;justify-content:space-between}
 .item:hover{background:#16223a}.item.sel{background:#1b2b48;border-color:#6ea8ff;color:#fff}
 .tag{font-size:10px;color:#6f86a8;border:1px solid #2a3a5a;border-radius:4px;padding:0 5px}
 .tag.xml{color:#7dffc0;border-color:#2a5a44}.tag.static{color:#ffd27d;border-color:#5a4a2a}.tag.spine{color:#ff9bb0;border-color:#5a2a3a}
 .stage{display:flex;flex-direction:column;align-items:center;gap:10px}
 canvas{background:radial-gradient(circle at 50% 45%,#1a3056aa,transparent 70%);border-radius:14px}
 .ctrl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
 .btn{cursor:pointer;border:1px solid #2a3a5a;background:#141d30;color:#dbe6f5;border-radius:8px;padding:5px 10px;font-size:12px}
 .btn.sel{border-color:#ffce54;color:#ffce54}label{color:#8ba0c0;font-size:12px}
</style></head><body>
<div class="top"><h1>👾 敌人骨骼动画</h1><span class="sub" id="stat"></span></div>
<div class="wrap">
 <div class="card"><input id="flt" placeholder="搜索名称/模型" style="width:100%;margin-bottom:8px;background:#0e1626;border:1px solid #243350;border-radius:6px;color:#dbe6f5;padding:6px"/><div class="list" id="list"></div></div>
 <div class="card stage">
   <canvas id="cv" width="420" height="520"></canvas>
   <div class="ctrl" id="anims"></div>
   <div class="ctrl"><label>速度</label><input id="spd" type="range" min="6" max="48" value="24"/><span id="spdv" class="sub">24fps</span>
     <label>缩放</label><input id="scl" type="range" min="30" max="300" value="120"/></div>
   <div class="sub" id="info"></div>
 </div>
</div>
<script>
const DB=${json}; const LIST=DB.list, PAGES=DB.pages;
let cur=LIST.find(x=>x.fmt==='xml')||LIST[0], curAnim=null, fps=24, scl=1.2;
const imgCache={}, sprCache={}, pageCache={};
function loadPage(pk){return new Promise(r=>{if(pageCache[pk])return r(pageCache[pk]);const im=new Image();im.onload=()=>{pageCache[pk]=im;r(im);};im.onerror=()=>r(null);im.src=PAGES[pk];});}
// Spine: 取一个 atlas 区域的直立小图
function regionSprite(pk,rname,r){const key=pk+'#'+rname;if(sprCache[key])return sprCache[key];const pg=pageCache[pk];if(!pg){return null;}const c=document.createElement('canvas');
 if(r.rotate){c.width=r.h;c.height=r.w;const g=c.getContext('2d');g.translate(r.h/2,r.w/2);g.rotate(-Math.PI/2);g.drawImage(pg,r.x,r.y,r.w,r.h,-r.w/2,-r.h/2,r.w,r.h);}
 else{c.width=r.w;c.height=r.h;c.getContext('2d').drawImage(pg,r.x,r.y,r.w,r.h,0,0,r.w,r.h);}
 const o={cv:c,w:c.width,h:c.height};sprCache[key]=o;return o;}
function loadTex(t){return new Promise(r=>{if(imgCache[t])return r(imgCache[t]);const im=new Image();im.onload=()=>{imgCache[t]=im;r(im);};im.onerror=()=>r(null);im.src=t;});}
document.getElementById('stat').textContent='共 '+LIST.length+' 个 · XML骨骼 '+LIST.filter(x=>x.fmt==='xml').length+' · 静态 '+LIST.filter(x=>x.fmt==='static').length+' · Spine待支持 '+LIST.filter(x=>x.fmt==='spine').length;

function renderList(f){const el=document.getElementById('list');el.innerHTML='';for(const m of LIST){if(f&&!(m.label+m.model).toLowerCase().includes(f.toLowerCase()))continue;const d=document.createElement('div');d.className='item'+(m===cur?' sel':'');d.innerHTML='<span>'+(m.label||m.model)+'</span><span class="tag '+m.fmt+'">'+m.fmt+'</span>';d.onclick=()=>{cur=m;pick(m);};el.appendChild(d);}}
function renderAnims(m){const el=document.getElementById('anims');el.innerHTML='';if(!m.anims){curAnim=null;return;}const names=Object.keys(m.anims);curAnim=names.includes(curAnim)?curAnim:names[0];for(const n of names){const b=document.createElement('div');b.className='btn'+(n===curAnim?' sel':'');b.textContent=n;b.onclick=()=>{curAnim=n;startT=performance.now();renderAnims(m);};el.appendChild(b);}}
async function pick(m){renderList(document.getElementById('flt').value);document.getElementById('info').textContent=m.model+(m.fmt==='spine'&&!m.page?' （Spine数据缺失）':'');if(m.tex)await loadTex(m.tex);if(m.fmt==='spine'&&m.page)await loadPage(m.page);renderAnims(m);startT=performance.now();}
// 三角形贴图(源像素三角->目标三角)
function drawTri(ctx,im,sx0,sy0,sx1,sy1,sx2,sy2,dx0,dy0,dx1,dy1,dx2,dy2){ctx.save();ctx.beginPath();ctx.moveTo(dx0,dy0);ctx.lineTo(dx1,dy1);ctx.lineTo(dx2,dy2);ctx.closePath();ctx.clip();const denom=sx0*(sy2-sy1)-sx1*sy2+sx2*sy1+(sx1-sx2)*sy0;if(Math.abs(denom)<1e-6){ctx.restore();return;}const m11=-(sy0*(dx2-dx1)-sy1*dx2+sy2*dx1+(sy1-sy2)*dx0)/denom;const m12=(sy1*dy2+sy0*(dy1-dy2)-sy2*dy1+(sy2-sy1)*dy0)/denom;const m21=(sx0*(dx2-dx1)-sx1*dx2+sx2*dx1+(sx1-sx2)*dx0)/denom;const m22=-(sx1*dy2+sx0*(dy1-dy2)-sx2*dy1+(sx2-sx1)*dy0)/denom;const dx=(sx0*(sy2*dx1-sy1*dx2)+sy0*(sx1*dx2-sx2*dx1)+(sx2*sy1-sx1*sy2)*dx0)/denom;const dy=(sx0*(sy2*dy1-sy1*dy2)+sy0*(sx1*dy2-sx2*dy1)+(sx2*sy1-sx1*sy2)*dy0)/denom;ctx.transform(m11,m12,m21,m22,dx,dy);ctx.drawImage(im,0,0);ctx.restore();}
function skRot(arr,t){if(t<=arr[0].t)return arr[0].a;if(t>=arr[arr.length-1].t)return arr[arr.length-1].a;for(let i=0;i<arr.length-1;i++){const A=arr[i],B=arr[i+1];if(t>=A.t&&t<=B.t){const u=(B.t-A.t)?(t-A.t)/(B.t-A.t):0;return A.a+(B.a-A.a)*u;}}return arr[arr.length-1].a;}
function skXY(arr,t,def){if(t<=arr[0].t)return{x:arr[0].x==null?def:arr[0].x,y:arr[0].y==null?def:arr[0].y};if(t>=arr[arr.length-1].t){const f=arr[arr.length-1];return{x:f.x==null?def:f.x,y:f.y==null?def:f.y};}for(let i=0;i<arr.length-1;i++){const A=arr[i],B=arr[i+1];if(t>=A.t&&t<=B.t){const u=(B.t-A.t)?(t-A.t)/(B.t-A.t):0;return{x:(A.x==null?def:A.x)+((B.x==null?def:B.x)-(A.x==null?def:A.x))*u,y:(A.y==null?def:A.y)+((B.y==null?def:B.y)-(A.y==null?def:A.y))*u};}}return{x:def,y:def};}
function skAtt(arr,t,def){let n=def;for(const f of arr){if(f.t<=t)n=f.name;else break;}return n;}

function lerp(a,b,t){return a+(b-a)*t;}
function csMat(x,y,sx,sy,skx,sky){const rx=skx*Math.PI/180,ry=sky*Math.PI/180;return[Math.cos(ry)*sx,Math.sin(ry)*sx,-Math.sin(rx)*sy,Math.cos(rx)*sy,x,y];}
function matMul(P,l){return[P[0]*l[0]+P[2]*l[1],P[1]*l[0]+P[3]*l[1],P[0]*l[2]+P[2]*l[3],P[1]*l[2]+P[3]*l[3],P[0]*l[4]+P[2]*l[5]+P[4],P[1]*l[4]+P[3]*l[5]+P[5]];}
function sample(tr,t){if(!tr||!tr.length)return null;if(t<=tr[0].fi)return tr[0];if(t>=tr[tr.length-1].fi)return tr[tr.length-1];for(let i=0;i<tr.length-1;i++){const A=tr[i],B=tr[i+1];if(t>=A.fi&&t<=B.fi){const u=(B.fi-A.fi)?(t-A.fi)/(B.fi-A.fi):0;return{x:lerp(A.x,B.x,u),y:lerp(A.y,B.y,u),cX:lerp(A.cX,B.cX,u),cY:lerp(A.cY,B.cY,u),kX:lerp(A.kX,B.kX,u),kY:lerp(A.kY,B.kY,u),pX:A.pX,pY:A.pY};}}return tr[tr.length-1];}
function stepDI(tr,t){if(!tr||!tr.length)return 0;let d=tr[0].di;for(const f of tr){if(f.fi<=t)d=f.di;else break;}return d;}
// 取一张“直立”的精灵(处理plist旋转帧)，缓存
function getSprite(texKey,im,fr){const key=texKey+'#'+fr.x+','+fr.y+','+fr.w+','+fr.h+','+(fr.rot?1:0);if(sprCache[key])return sprCache[key];
 let w=fr.w,h=fr.h;const c=document.createElement('canvas');
 if(fr.rot){c.width=fr.h;c.height=fr.w;const g=c.getContext('2d');g.translate(fr.h/2,fr.w/2);g.rotate(-Math.PI/2);g.drawImage(im,fr.x,fr.y,fr.w,fr.h,-fr.w/2,-fr.h/2,fr.w,fr.h);}
 else{c.width=fr.w;c.height=fr.h;c.getContext('2d').drawImage(im,fr.x,fr.y,fr.w,fr.h,0,0,fr.w,fr.h);}
 const o={cv:c,w:c.width,h:c.height};sprCache[key]=o;return o;}

let startT=performance.now(), BASE=[1,0,0,1,0,0];
function setT(ctx,M){const C=matMul(BASE,M);ctx.setTransform(C[0],C[1],C[2],C[3],C[4],C[5]);}
function frame(now){
 const cv=document.getElementById('cv'),ctx=cv.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
 const m=cur, im=m&&m.tex?imgCache[m.tex]:null;
 const cx=cv.width/2, cy=cv.height*0.5;
 try{
 if(m&&m.fmt==='spine'&&(!m.page||!pageCache[m.page]||!m.anims||!curAnim)){ctx.fillStyle='#6f86a8';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText(m.page?'加载中…':'Spine 数据缺失',cx,cy);}
 else if(m&&m.fmt==='spine'){
   const anim=m.anims[curAnim];const dur=Math.max(0.001,anim.dur);const t=((now-startT)/1000)%dur;
   const bmap={};for(const b of m.bones)bmap[b.name]=b;const world={};
   function ovv(bn){const tl=anim.bones[bn];const o={rot:0,x:0,y:0,sx:1,sy:1};if(tl){if(tl.rotate)o.rot=skRot(tl.rotate,t);if(tl.translate){const p=skXY(tl.translate,t,0);o.x=p.x;o.y=p.y;}if(tl.scale){const p=skXY(tl.scale,t,1);o.sx=p.x;o.sy=p.y;}}return o;}
   function bmat(b,o){const rot=(b.rot+o.rot)*Math.PI/180,sx=b.sx*o.sx,sy=b.sy*o.sy,x=b.x+o.x,y=b.y+o.y;return[Math.cos(rot)*sx,Math.sin(rot)*sx,-Math.sin(rot)*sy,Math.cos(rot)*sy,x,y];}
   function solve(bn){if(world[bn])return world[bn];const b=bmap[bn];if(!b)return[1,0,0,1,0,0];const l=bmat(b,ovv(bn));const w=(b.parent&&bmap[b.parent])?matMul(solve(b.parent),l):l;world[bn]=w;return w;}
   for(const b of m.bones)solve(b.name);
   const toX=wx=>cx+scl*wx, toY=wy=>cy-scl*wy;
   const ap=(mm,x,y)=>[mm[0]*x+mm[2]*y+mm[4],mm[1]*x+mm[3]*y+mm[5]];
   ctx.setTransform(1,0,0,1,0,0);
   for(const sl of m.slots){const attName=anim.slots[sl.name]?skAtt(anim.slots[sl.name],t,sl.att):sl.att;if(!attName)continue;const a=(m.skin[sl.name]||{})[attName];if(!a)continue;const reg=m.regions[a.name];if(!reg)continue;const sp=regionSprite(m.page,a.name,reg);if(!sp)continue;const ow=sp.w,oh=sp.h;const W=solve(sl.bone);
     if(a.type==='region'){const arot=a.rot*Math.PI/180;const am=[Math.cos(arot)*a.sx,Math.sin(arot)*a.sx,-Math.sin(arot)*a.sy,Math.cos(arot)*a.sy,a.x,a.y];const full=matMul(W,am);const w2=(a.w||ow)/2,h2=(a.h||oh)/2;const cs=[[-w2,-h2],[w2,-h2],[w2,h2],[-w2,h2]].map(c=>{const p=ap(full,c[0],c[1]);return[toX(p[0]),toY(p[1])];});const uv=[[0,0],[ow,0],[ow,oh],[0,oh]];drawTri(ctx,sp.cv,uv[0][0],uv[0][1],uv[1][0],uv[1][1],uv[2][0],uv[2][1],cs[0][0],cs[0][1],cs[1][0],cs[1][1],cs[2][0],cs[2][1]);drawTri(ctx,sp.cv,uv[0][0],uv[0][1],uv[2][0],uv[2][1],uv[3][0],uv[3][1],cs[0][0],cs[0][1],cs[2][0],cs[2][1],cs[3][0],cs[3][1]);}
     else if(a.type==='mesh'){const V=a.verts,U=a.uvs,T=a.tri;const P=[];for(let i=0;i<V.length;i+=2){const p=ap(W,V[i],V[i+1]);P.push([toX(p[0]),toY(p[1])]);}const UV=[];for(let i=0;i<U.length;i+=2)UV.push([U[i]*ow,U[i+1]*oh]);for(let i=0;i<T.length;i+=3){const a0=T[i],b0=T[i+1],c0=T[i+2];drawTri(ctx,sp.cv,UV[a0][0],UV[a0][1],UV[b0][0],UV[b0][1],UV[c0][0],UV[c0][1],P[a0][0],P[a0][1],P[b0][0],P[b0][1],P[c0][0],P[c0][1]);}}
     else if(a.type==='skinnedmesh'){const V=a.verts,U=a.uvs,T=a.tri;const P=[];let k=0;while(k<V.length){const n=V[k++];let wx=0,wy=0;for(let q=0;q<n;q++){const bi=V[k++],vx=V[k++],vy=V[k++],wt=V[k++];const bw=solve(m.bones[bi].name);wx+=(bw[0]*vx+bw[2]*vy+bw[4])*wt;wy+=(bw[1]*vx+bw[3]*vy+bw[5])*wt;}P.push([toX(wx),toY(wy)]);}const UV=[];for(let i=0;i<U.length;i+=2)UV.push([U[i]*ow,U[i+1]*oh]);for(let i=0;i<T.length;i+=3){const a0=T[i],b0=T[i+1],c0=T[i+2];drawTri(ctx,sp.cv,UV[a0][0],UV[a0][1],UV[b0][0],UV[b0][1],UV[c0][0],UV[c0][1],P[a0][0],P[a0][1],P[b0][0],P[b0][1],P[c0][0],P[c0][1]);}}
   }
   ctx.setTransform(1,0,0,1,0,0);
 }
 else if(m&&im&&m.fmt==='static'){const s=Math.min((cv.width*0.8)/im.width,(cv.height*0.8)/im.height)*scl;ctx.setTransform(s,0,0,s,cx-im.width*s/2,cy-im.height*s/2);ctx.drawImage(im,0,0);ctx.setTransform(1,0,0,1,0,0);}
 else if(m&&im&&m.fmt==='xml'&&curAnim&&m.anims[curAnim]){
   const anim=m.anims[curAnim];const dur=Math.max(1,anim.dur);let t=((now-startT)/1000*fps);t=anim.lp?(t%dur):Math.min(t,dur);
   BASE=[scl,0,0,scl,cx-scl*cx,cy-scl*cy];
   const world={};
   function solve(n){if(world[n])return world[n];const b=m.bones[n];if(!b)return[1,0,0,1,0,0];const tk=anim.tracks[n];const tr=((tk&&tk.length)?sample(tk,t):null)||b;const loc=csMat(tr.x,tr.y,tr.cX==null?1:tr.cX,tr.cY==null?1:tr.cY,tr.kX||0,tr.kY||0);const w=(b.parent&&m.bones[b.parent])?matMul(solve(b.parent),loc):loc;world[n]=w;return w;}
   for(const name of m.drawOrder){const b=m.bones[name];if(!b)continue;const tk=anim.tracks[name];const di=stepDI(tk,t);if(di<0)continue;
     const tr=((tk&&tk.length)?sample(tk,t):null)||b;const pX=(tr.pX!=null?tr.pX:b.pX),pY=(tr.pY!=null?tr.pY:b.pY);
     const fr=m.frames[b.disp];if(!fr)continue;const sp=getSprite(m.key,im,fr);
     const mm=solve(name);const w=sp.w,h=sp.h;
     const E=cx+mm[0]*(-pX)+mm[2]*(pY)+mm[4];
     const F=cy-(mm[1]*(-pX)+mm[3]*(pY)+mm[5]);
     setT(ctx,[mm[0],-mm[1],-mm[2],mm[3],E,F]);ctx.drawImage(sp.cv,0,0);
   }
   ctx.setTransform(1,0,0,1,0,0);
 }
 }catch(e){ctx.setTransform(1,0,0,1,0,0);if(!window._rerr){window._rerr=1;console.warn('render error:',e);}}
 requestAnimationFrame(frame);
}
document.getElementById('spd').oninput=e=>{fps=+e.target.value;document.getElementById('spdv').textContent=fps+'fps';};
document.getElementById('scl').oninput=e=>{scl=(+e.target.value)/100;};
document.getElementById('flt').oninput=e=>renderList(e.target.value);
pick(cur).then(()=>requestAnimationFrame(frame));
</script></body></html>`
}
