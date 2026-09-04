// 将四个模型特效以 base64 内嵌进竖屏展示页，并注入“隐藏UI/自动发射”补丁
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..');

// 隐藏各页面自带的控制面板 / HUD，录制画面保持干净
const HIDE = '<style>#panel,.panel,#hud,.hud,#tag,#info,#ui,.controls,.tip,.hint{display:none!important}</style>';
// Sonnet 版需要点击“发射”按钮才有飞行穿透，注入定时自动触发
const AUTO_LAUNCH =
  '<scr' + 'ipt>setTimeout(function tick(){' +
  'var b=document.getElementById("btnLaunch");if(b)b.click();' +
  'setTimeout(tick,4500)},1200)</scr' + 'ipt>';

function load(file, extra){
  let s = fs.readFileSync(path.join(dir, file), 'utf8');
  const inject = HIDE + (extra || '');
  if(s.includes('</body>')) s = s.replace('</body>', inject + '</body>');
  else s += inject;
  return Buffer.from(s, 'utf8').toString('base64');
}

let t = fs.readFileSync(path.join(dir, '_douyin_template.html'), 'utf8');
t = t.replace('{{FABLE}}',  load('claude-fable-5.html'))
     .replace('{{SONNET}}', load('claude-sonnet-5.html', AUTO_LAUNCH))
     .replace('{{OPUS}}',   load('claude-opus-5.html'))
     .replace('{{GROK}}',   load('grok-4.6-qigong-beam.html'));

const out = path.join(dir, 'douyin-showcase.html');
fs.writeFileSync(out, t);
console.log('OK ' + out + ' (' + (t.length / 1024).toFixed(0) + ' KB)');
