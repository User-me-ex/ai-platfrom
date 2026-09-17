'use strict';
const path = require('path');
const { spawn } = require('child_process');

const pcm = path.join(process.env.TEMP || 'C:/Users/USER/AppData/Local/Temp', 'opencode', 'capture.pcm');
const FFPLAY = 'C:\\Users\\USER\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-N-121938-g2456a39581-win64-gpl\\bin\\ffplay.exe';

const combos = [
  ['-nodisp', '-autoexit', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm],
  ['-nodisp', '-autoexit', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ch_layout', 'mono', '-i', pcm],
  ['-nodisp', '-autoexit', '-loglevel', 'error', '-f', 's16le', '-sample_rate', '24000', '-ch_layout', 'mono', '-i', pcm],
  ['-nodisp', '-autoexit', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-channels', '1', '-i', pcm],
  ['-nodisp', '-autoexit', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-i', pcm]
];

function run(args, label) {
  return new Promise((resolve) => {
    console.log(`--- ${label} --- args: ${args.slice(0, -2).join(' ')} ... -i <pcm>`);
    const p = spawn(FFPLAY, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    const started = Date.now();
    p.on('exit', (code) => {
      console.log(`  exit=${code} after ${Date.now() - started}ms  ${code === 0 ? 'WIN' : err.trim().split('\n').slice(0, 2).join(' | ')}`);
      resolve();
    });
    p.on('error', (e) => { console.log('  spawn error:', e.message); resolve(); });
  });
}

(async () => {
  for (let i = 0; i < combos.length; i++) await run(combos[i], 'combo ' + (i + 1));
})();