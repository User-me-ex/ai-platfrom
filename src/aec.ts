import WebRtcAec3 from '@ennuicastr/webrtcaec3.js';

type Aec3Instance = WebRtcAec3.AEC3;

const AEC_RATE = 48000;
const FAR_RATE = 24000;
const NEAR_RATE = 16000;

export class AecCanceller {
  private aec: Aec3Instance;
  private f32Far: Float32Array = new Float32Array(0);
  private f32Near: Float32Array = new Float32Array(0);
  private f32Far48: Float32Array = new Float32Array(0);
  private f32Near48: Float32Array = new Float32Array(0);
  private f32Out: Float32Array = new Float32Array(0);

  private constructor(aec: Aec3Instance) {
    this.aec = aec;
  }

  static async create(): Promise<AecCanceller> {
    const mod = await WebRtcAec3();
    const aec = new mod.AEC3(AEC_RATE, 1, 1);
    return new AecCanceller(aec);
  }

  setAudioBufferDelay(delayMs: number): void {
    try {
      this.aec.setAudioBufferDelay(delayMs);
    } catch {
      /* noop */
    }
  }

  feedRender(buf: Buffer): void {
    const n = Math.floor(buf.length / 2);
    if (n <= 0) return;
    if (this.f32Far.length < n) this.f32Far = new Float32Array(n);
    const f = this.f32Far;
    for (let i = 0; i < n; i++) f[i] = buf.readInt16LE(i * 2) / 32768;
    const ratio = AEC_RATE / FAR_RATE;
    const outN = Math.floor(n * ratio);
    if (this.f32Far48.length < outN) this.f32Far48 = new Float32Array(outN);
    const o = this.f32Far48;
    for (let j = 0; j < outN; j++) {
      const p = j / ratio;
      const i0 = Math.min(Math.floor(p), n - 1);
      const frac = p - i0;
      const a = f[i0];
      const b = f[Math.min(i0 + 1, n - 1)];
      o[j] = a + (b - a) * frac;
    }
    try {
      this.aec.analyze([o.subarray(0, outN) as Float32Array]);
    } catch {
      /* noop */
    }
  }

  processCapture(buf: Buffer, out: Buffer): number {
    const n = Math.floor(buf.length / 2);
    if (n <= 0) return buf.copy(out);
    if (this.f32Near.length < n) this.f32Near = new Float32Array(n);
    const f = this.f32Near;
    for (let i = 0; i < n; i++) f[i] = buf.readInt16LE(i * 2) / 32768;
    const ratio = AEC_RATE / NEAR_RATE;
    const upN = Math.floor(n * ratio);
    if (this.f32Near48.length < upN) this.f32Near48 = new Float32Array(upN);
    const u = this.f32Near48;
    for (let j = 0; j < upN; j++) {
      const p = j / ratio;
      const i0 = Math.min(Math.floor(p), n - 1);
      const frac = p - i0;
      const a = f[i0];
      const b = f[Math.min(i0 + 1, n - 1)];
      u[j] = a + (b - a) * frac;
    }
    const near = [u.subarray(0, upN) as Float32Array];
    let sz: number;
    try {
      sz = this.aec.processSize(near);
    } catch {
      return buf.copy(out);
    }
    if (sz <= 0) return buf.copy(out);
    if (this.f32Out.length < sz) this.f32Out = new Float32Array(sz);
    const of = this.f32Out.subarray(0, sz) as Float32Array;
    try {
      this.aec.process([of], near);
    } catch {
      return buf.copy(out);
    }
    const maxSamples = Math.floor(out.length / 2);
    const samples = Math.min(Math.floor(sz / (AEC_RATE / NEAR_RATE)), maxSamples);
    for (let i = 0; i < samples; i++) {
      const v = of[i * (AEC_RATE / NEAR_RATE)];
      const s = Math.max(-1, Math.min(1, v));
      out.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2);
    }
    return samples * 2;
  }

  free(): void {
    try {
      this.aec.free();
    } catch {
      /* noop */
    }
  }
}

export async function initAec(): Promise<AecCanceller> {
  return AecCanceller.create();
}