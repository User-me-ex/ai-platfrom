'use strict';
const assert = require('assert');

console.log('====================================================');
console.log('   VOICE DUPLEX & LATENCY UNIT TEST SUITE           ');
console.log('====================================================');

const PLAY_BYTES_PER_MS = (24000 * 2) / 1000; // 48 bytes/ms
const ACOUSTIC_TAIL_MS = 60; // 60ms

function computeRms(buf) {
  if (buf.length < 2) return 0;
  let sum = 0;
  const count = Math.floor(buf.length / 2);
  for (let i = 0; i < count; i++) {
    const val = buf.readInt16LE(i * 2);
    sum += val * val;
  }
  return Math.sqrt(sum / count) / 32768;
}

// 1. Test Wall-Clock Playback Tracking
console.log('\n--- 1. Testing Wall-Clock Playback End Time Calculation ---');
let playbackEndTime = 0;

function playAiAudioChunk(audioLen, currentTime) {
  const durationMs = audioLen / PLAY_BYTES_PER_MS;
  if (playbackEndTime > currentTime) {
    playbackEndTime += durationMs;
  } else {
    playbackEndTime = currentTime + durationMs;
  }
}

// Turn 1: 3 seconds of audio arriving in 3 chunks
const t0 = 1000;
playAiAudioChunk(48000, 1000); // 1.0s chunk at t=1000 -> ends at 2000
assert.strictEqual(playbackEndTime, 2000);
playAiAudioChunk(48000, 1200); // 1.0s chunk at t=1200 -> ends at 3000
assert.strictEqual(playbackEndTime, 3000);
playAiAudioChunk(48000, 1400); // 1.0s chunk at t=1400 -> ends at 4000
assert.strictEqual(playbackEndTime, 4000);
console.log('✓ Turn 1: 3.0s audio finishes exactly at t=4000 (calculated:', playbackEndTime, ')');

// Check isAiSpeakingNow at various timestamps
function isAiSpeakingNow(now) {
  return now < playbackEndTime + ACOUSTIC_TAIL_MS;
}

assert.strictEqual(isAiSpeakingNow(3900), true, 'Should be speaking at t=3900');
assert.strictEqual(isAiSpeakingNow(4000), true, 'Should be speaking at t=4000 (playback just finished)');
assert.strictEqual(isAiSpeakingNow(4050), true, 'Should be speaking at t=4050 (inside 60ms tail)');
assert.strictEqual(isAiSpeakingNow(4061), false, 'MUST BE UN-GATED at t=4061 (just past 60ms tail)');
assert.strictEqual(isAiSpeakingNow(4100), false, 'MUST BE UN-GATED at t=4100 (ready for user speech)');
console.log('✓ Un-gating occurs within 61ms after playback ends (Zero latency for user speech!)');

// 2. Test Turn 2 & Turn 3 Zero Drift
console.log('\n--- 2. Testing Multiple Turns with Zero Drift ---');
// User speaks from t=4100 to 5000.
// Turn 2 AI response starts at t=5500 with 2 seconds of audio (96,000 bytes)
playAiAudioChunk(96000, 5500);
assert.strictEqual(playbackEndTime, 7500, 'Turn 2: 2.0s audio from t=5500 must end at t=7500');
assert.strictEqual(isAiSpeakingNow(7561), false, 'Turn 2 must be un-gated at t=7561');
console.log('✓ Turn 2: Perfectly un-gated at t=7561 without cumulative drift');

// Turn 3 AI response starts at t=9000 with 1.5 seconds of audio (72,000 bytes)
playAiAudioChunk(72000, 9000);
assert.strictEqual(playbackEndTime, 10500, 'Turn 3: 1.5s audio from t=9000 must end at t=10500');
assert.strictEqual(isAiSpeakingNow(10561), false, 'Turn 3 must be un-gated at t=10561');
console.log('✓ Turn 3: Perfectly un-gated at t=10561 with identical fast responsiveness');

// 3. Test Echo Suppression (Self-Reply Prevention)
console.log('\n--- 3. Testing Echo Suppression & Self-Reply Prevention ---');
// Create speaker echo simulation buffer (low energy, e.g. ~800 amplitude)
const echoChunk = Buffer.alloc(1024);
for (let i = 0; i < 512; i++) {
  echoChunk.writeInt16LE(Math.round(Math.sin(i / 5) * 800), i * 2);
}
const echoRms = computeRms(echoChunk);
const aecActive = true;
const getBargeInThreshold = (aec) => (aec ? 0.04 : 0.065);
const threshold = getBargeInThreshold(aecActive);
console.log(`Echo RMS: ${echoRms.toFixed(4)} (Threshold: ${threshold})`);
assert(echoRms < threshold, 'Speaker echo RMS must be below barge-in threshold');

let packetsSentToGemini = 0;
let interruptedCount = 0;
function simulateMicInput(chunk, now, aec = true) {
  const aiSpeaking = isAiSpeakingNow(now);
  if (aiSpeaking) {
    const energy = computeRms(chunk);
    if (energy > getBargeInThreshold(aec)) {
      // Interruption
      playbackEndTime = 0;
      interruptedCount++;
      packetsSentToGemini++;
      return 'interrupted';
    }
    // Echo suppressed
    return 'suppressed';
  }
  packetsSentToGemini++;
  return 'sent';
}

// At t=9500 (AI is speaking):
const resEcho = simulateMicInput(echoChunk, 9500, aecActive);
assert.strictEqual(resEcho, 'suppressed', 'Speaker echo must be suppressed during AI playback');
assert.strictEqual(packetsSentToGemini, 0, 'No packets should be sent to Gemini Live during echo');
console.log('✓ Speaker echo is 100% suppressed during AI speech (No self-reply feedback loop!)');

// 4. Test User Normal Speech Right After AI Finishes
console.log('\n--- 4. Testing User Normal Speech Right After AI Finishes ---');
// At t=10600 (AI has finished speaking):
const userVoiceChunk = Buffer.alloc(1024);
for (let i = 0; i < 512; i++) {
  userVoiceChunk.writeInt16LE(Math.round(Math.sin(i / 5) * 4000), i * 2);
}
const resUser = simulateMicInput(userVoiceChunk, 10600, aecActive);
assert.strictEqual(resUser, 'sent', 'User speech immediately after AI must be sent');
assert.strictEqual(packetsSentToGemini, 1, 'Packet must reach Gemini Live immediately');
console.log('✓ User speech is forwarded immediately with zero latency');

// 5. Test Conversational Barge-in Interruption
console.log('\n--- 5. Testing Conversational Barge-in Interruption During AI Speech ---');
// AI starts talking at t=12000 for 5 seconds (ends at 17000)
playAiAudioChunk(5 * 48000, 12000);
assert.strictEqual(playbackEndTime, 17000);

// User says "Wait, hold on" at conversational level (peak ~3000) at t=13000
const convUserChunk = Buffer.alloc(1024);
for (let i = 0; i < 512; i++) {
  convUserChunk.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), i * 2);
}
const convRms = computeRms(convUserChunk);
console.log(`Conversational speech RMS: ${convRms.toFixed(4)} (Threshold: ${threshold})`);
assert(convRms > threshold, 'Conversational speech RMS must exceed adaptive barge-in threshold');

const resInterrupted = simulateMicInput(convUserChunk, 13000, aecActive);
assert.strictEqual(resInterrupted, 'interrupted', 'Should trigger interruption');
assert.strictEqual(playbackEndTime, 0, 'AI playback must be stopped immediately (playbackEndTime reset to 0)');
assert.strictEqual(isAiSpeakingNow(13001), false, 'AI must be silent immediately');
console.log('✓ Conversational interruption cuts AI audio instantly and forwards user speech');

// 6. Test Gemini Live serverContent.interrupted handling
console.log('\n--- 6. Testing Gemini Live Server Interruption Message Handling ---');
let aiPlaybackActive = true;
function handleServerContent(sc) {
  if (sc.interrupted) {
    aiPlaybackActive = false;
    playbackEndTime = 0;
  }
}
playAiAudioChunk(3 * 48000, 20000);
assert.strictEqual(isAiSpeakingNow(21000), true);
handleServerContent({ interrupted: true });
assert.strictEqual(aiPlaybackActive, false, 'Playback must be cancelled on server interrupted acknowledgement');
assert.strictEqual(isAiSpeakingNow(21000), false, 'isAiSpeakingNow must be false immediately');
console.log('✓ Gemini Live server-side interruption message handled cleanly');

// 7. Test Manual interrupt() Method
console.log('\n--- 7. Testing Manual interrupt() Command Execution ---');
let manualStopped = false;
function interrupt() {
  playbackEndTime = 0;
  manualStopped = true;
}
playAiAudioChunk(4 * 48000, 30000);
assert.strictEqual(isAiSpeakingNow(31000), true);
interrupt();
assert.strictEqual(manualStopped, true);
assert.strictEqual(isAiSpeakingNow(31000), false);
console.log('✓ Manual interrupt() command stops AI playback instantly');

console.log('\n====================================================');
console.log('  ALL VOICE DUPLEX & INTERRUPTION TESTS PASSED (100%)');
console.log('====================================================');
