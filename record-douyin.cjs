// 用系统 Edge/Chrome 无头录制竖屏展示页 -> webm -> 转 MP4（抖音竖屏 1080x1920）
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require(path.join(__dirname, 'node_modules', 'playwright-core'));

const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, 'douyin-showcase.html').replace(/\\/g, '/');
const REC_DIR = path.join(ROOT, 'record');
const OUT_MP4 = path.join(ROOT, '气功波四模型对比_抖音竖屏.mp4');

(async () => {
  let browser = null, lastErr = '';
  for (const channel of [null, 'msedge', 'chrome']) {
    try {
      browser = await chromium.launch({ channel: channel || undefined, headless: true });
      console.log('browser: ' + (channel || 'bundled chromium'));
      break;
    } catch (e) { lastErr = e.message; }
  }
  if (!browser) { console.error('NO_BROWSER: ' + lastErr); process.exit(1); }

  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    recordVideo: { dir: REC_DIR, size: { width: 1080, height: 1920 } }
  });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  console.log('recording... (~52s)');
  await page.waitForFunction('window.__DONE__ === true', null, { timeout: 90000 });
  await page.waitForTimeout(600);
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  await browser.close();
  console.log('webm: ' + webm);

  const ffmpeg = require('ffmpeg-static');
  execFileSync(ffmpeg, [
    '-y', '-i', webm,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-r', '30', '-crf', '19', '-movflags', '+faststart',
    OUT_MP4
  ], { stdio: 'inherit' });
  fs.rmSync(webm, { force: true });
  console.log('MP4: ' + OUT_MP4);
})().catch(e => { console.error(e); process.exit(1); });
