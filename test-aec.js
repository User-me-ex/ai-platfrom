const { AecCanceller } = require('./out/src/aec.js');

const FAR_RATE = 24000;
const NEAR_RATE = 16000;
const DELAY_MS = 120; // AEC render-to-capture compensation set on the canceller

let seed = 0;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

// one-pole low-pass filtered noise: broadband-ish, non-stationary (amplitude-modulated)
function bandNoise(rate, sec, hiHz, gain, modulated) {
  const n = rate * sec;
  const b = Buffer.alloc(n * 2);
  let low = 0;
  const RC = 1 / (2 * Math.PI * hiHz);
  for (let i = 0; i < n; i++) {
    low += (rnd() * 2 - 1 - low) * (1 / rate / RC);
    const g = modulated ? 0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / rate) : 1;
    b.writeInt16LE(Math.max(-32768, Math.min(32767, low * gain * g * 32767)), i * 2);
  }
  return b;
}

function delay(buf, ms) {
  const dr = Math.floor((ms * NEAR_RATE) / 1000) * 2;
  const out = Buffer.alloc(buf.length);
  if (dr < buf.length) buf.copy(out, dr);
  return out;
}

// band energy around `centerHz` via matched sinusoid correlation (dimensionless, comparable)
function bandEnergy(buf, centerHz) {
  const Fs = NEAR_RATE;
  let re = 0, im = 0, n = 0;
  for (let i = 0; i < buf.length / 2; i += 3) {
    const s = buf.readInt16LE(i * 2) / 32768;
    const ph = (2 * Math.PI * centerHz * i) / Fs;
    re += s * Math.cos(ph);
    im += s * Math.sin(ph);
    n++;
  }
  return (re * re + im * im) / (n * n);
}

async function run(seedVal) {
  seed = seedVal;
  const aec = await AecCanceller.create();
  aec.setAudioBufferDelay(DELAY_MS);
  const far = bandNoise(FAR_RATE, 3.0, 600, 0.5, true);
  const echo = delay(bandNoise(NEAR_RATE, 2.0, 600, 0.5, true), 50);
  for (let i = 0; i < echo.length / 2; i++) echo.writeInt16LE(Math.round(echo.readInt16LE(i * 2) * 0.3), i * 2);
  const voice = bandNoise(NEAR_RATE, 2.0, 2600, 0.35, true);
  const near = Buffer.alloc(echo.length);
  for (let i = 0; i < near.length / 2; i++) {
    near.writeInt16LE(Math.max(-32768, Math.min(32767, voice.readInt16LE(i * 2) + echo.readInt16LE(i * 2))), i * 2);
  }

  const CHUNK = 40; // ms
  const farSamples = (FAR_RATE * CHUNK) / 1000;
  const nearSamples = (NEAR_RATE * CHUNK) / 1000;
  let outBuf = Buffer.alloc(nearSamples * 2);
  let out = Buffer.alloc(0);

  const SKIP = nearSamples * 2 * 5; // let the filter converge before measuring
  for (let off = SKIP; off + nearSamples * 2 <= near.length; off += nearSamples * 2) {
    const nChunk = near.subarray(off, off + nearSamples * 2);
    const farOff = Math.floor((off / 2) * (FAR_RATE / NEAR_RATE)) * 2;
    aec.feedRender(far.subarray(farOff, farOff + farSamples * 2));
    const n = aec.processCapture(nChunk, outBuf);
    out = Buffer.concat([out, outBuf.subarray(0, n)]);
  }

  const src = near.subarray(SKIP);
  aec.free();
  return {
    echoLeftRatio: bandEnergy(out, 400) / bandEnergy(src, 400),
    voiceLeftRatio: bandEnergy(out, 1600) / bandEnergy(src, 1600)
  };
}

async function main() {
  const SEEDS = [111, 222, 333, 444, 555];
  let eAvg = 0, vAvg = 0;
  for (const s of SEEDS) {
    const r = await run(s);
    eAvg += r.echoLeftRatio / SEEDS.length;
    vAvg += r.voiceLeftRatio / SEEDS.length;
  }

  const echoLeft = 100 * eAvg;
  const voiceLeft = 100 * vAvg;

  console.log(`echo band left (avg of ${SEEDS.length} seeds): ${echoLeft.toFixed(1)}% (was ${(100 - echoLeft).toFixed(1)}% removed)`);
  console.log(`voice band kept (avg): ${voiceLeft.toFixed(1)}%`);
  const goodEcho = echoLeft < 40;
  const goodVoice = voiceLeft > 40;
  const ratio = voiceLeft / Math.max(echoLeft, 1e-6);
  const betterThanTone = ratio > 3;
  const ok = goodEcho && goodVoice && betterThanTone;
  console.log(`verdict: ${ok ? 'PASS — echo removed, voice retained' : 'FAIL — echo not cleanly separated from voice'}`);
  console.log(`  (echo<40%: ${goodEcho ? 'yes' : 'no'}, voice>40%: ${goodVoice ? 'yes' : 'no'}, voice/echo ratio>3: ${ratio.toFixed(2)})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });