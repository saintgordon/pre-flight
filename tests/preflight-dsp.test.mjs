import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeBroadcastLoudness,
  analyzeTruePeak,
  analyzeIntegrity,
  analyzeStereoPhase,
  computePlatformNormalization,
  runPreFlightAnalysis,
  generatePreFlightMarkdown,
  generateCompactSummary,
  formatTime,
  formatSignedDb,
} from '../js/preflight-dsp.js';

function makeSine(freqHz, amplitude, durationSec, sampleRate = 48000, phaseRad = 0) {
  const len = Math.floor(durationSec * sampleRate);
  const arr = new Float32Array(len);
  const w = (2 * Math.PI * freqHz) / sampleRate;
  for (let i = 0; i < len; i++) {
    arr[i] = amplitude * Math.sin(w * i + phaseRad);
  }
  return arr;
}

function makeStereoSine(freqHz, amplitude, durationSec, sampleRate = 48000, invertRight = false) {
  const left = makeSine(freqHz, amplitude, durationSec, sampleRate);
  const right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    right[i] = invertRight ? -left[i] : left[i];
  }
  return [left, right];
}

test('ITU-R BS.1770-4 1 kHz sine LUFS accuracy (stereo & mono, 48 kHz & 44.1 kHz)', () => {
  // Mono 0 dBFS peak 1 kHz sine => -3.01 LUFS (RMS = -3.01 dBFS, K-weight cancels -0.691 at 1 kHz)
  const mono0 = [makeSine(1000, 1.0, 4.0, 48000)];
  const monoRes = analyzeBroadcastLoudness(mono0, 48000);
  assert.ok(Math.abs(monoRes.integratedLufs - (-3.0)) <= 0.15, `Expected ~-3.0 LUFS mono, got ${monoRes.integratedLufs}`);
  assert.ok(Math.abs(monoRes.rmsDb - (-3.0)) <= 0.15);

  // Stereo -14 dB peak 1 kHz sine => dual-channel power adds +3.01 dB => ~-14.0 LUFS
  const ampNeg14 = Math.pow(10, -14 / 20);
  const stereo48 = makeStereoSine(1000, ampNeg14, 4.0, 48000);
  const res48 = analyzeBroadcastLoudness(stereo48, 48000);
  assert.ok(Math.abs(res48.integratedLufs - (-14.0)) <= 0.15, `Expected ~-14.0 LUFS at 48k, got ${res48.integratedLufs}`);
  assert.ok(Math.abs(res48.momentaryMaxLufs - (-14.0)) <= 0.15);
  assert.ok(Math.abs(res48.shortTermMaxLufs - (-14.0)) <= 0.15);

  // Verify bilinear transform accuracy at 44.1 kHz as well
  const stereo441 = makeStereoSine(1000, ampNeg14, 4.0, 44100);
  const res441 = analyzeBroadcastLoudness(stereo441, 44100);
  assert.ok(Math.abs(res441.integratedLufs - (-14.0)) <= 0.2, `Expected ~-14.0 LUFS at 44.1k, got ${res441.integratedLufs}`);
});

test('True Peak 4x oversampled polyphase FIR catches 45°-shifted Fs/4 inter-sample peaks (+3.01 dBTP)', () => {
  const sr = 48000;
  // Classic BS.1770 Annex 2 worst-case ISP test signal:
  // x[n] = sqrt(2) * sin(pi/2 * n + pi/4) has exact sample values ±1.0000 (0.00 dBFS)
  // while the reconstructed continuous signal peaks halfway between samples at ±sqrt(2) (+3.01 dBTP)!
  const ispWave = makeSine(sr / 4, Math.SQRT2, 0.5, sr, Math.PI / 4);
  let maxSample = 0;
  for (let i = 0; i < ispWave.length; i++) {
    maxSample = Math.max(maxSample, Math.abs(ispWave[i]));
  }
  assert.ok(Math.abs(maxSample - 1.0) < 1e-5, `Sample peak should be 1.0, got ${maxSample}`);

  const tp = analyzeTruePeak([ispWave, ispWave], sr);
  assert.ok(tp.truePeakDb > 2.8 && tp.truePeakDb < 3.2, `Expected ~+3.01 dBTP, got ${tp.truePeakDb}`);
  assert.ok(tp.ispCount > 1000, `Expected high ISP count, got ${tp.ispCount}`);
  assert.ok(tp.ceilingBreachCount > 1000);
  assert.ok(tp.maxOvershootDb > 2.8, `Expected ~3 dB overshoot above sample peak, got ${tp.maxOvershootDb}`);

  // Clean -3.0 dBFS 440 Hz sine should match sample peak closely with 0 ISPs and 0 ceiling breaches
  const cleanAmp = Math.pow(10, -3.0 / 20);
  const cleanSine = makeStereoSine(440, cleanAmp, 1.0, sr);
  const cleanTp = analyzeTruePeak(cleanSine, sr);
  assert.ok(Math.abs(cleanTp.truePeakDb - (-3.0)) <= 0.08, `Expected ~-3.0 dBTP, got ${cleanTp.truePeakDb}`);
  assert.equal(cleanTp.ispCount, 0);
  assert.equal(cleanTp.ceilingBreachCount, 0);
});

test('EBU R128 Tech 3342 Loudness Range (LRA) distinguishes dynamic vs flat masters', () => {
  const sr = 48000;

  // 1. Flat constant-level 12 s sine => LRA ~ 0.0 LU
  const flat = makeStereoSine(1000, 0.25, 12.0, sr);
  const flatRes = analyzeBroadcastLoudness(flat, sr);
  assert.ok(flatRes.lraLu <= 0.2, `Expected flat LRA ~0.0 LU, got ${flatRes.lraLu}`);

  // 2. Dynamic 24 s master: 10 s quiet verse (-22 LUFS), 2 s silence, 12 s loud chorus (-10 LUFS)
  const totalSamples = 24 * sr;
  const L = new Float32Array(totalSamples);
  const R = new Float32Array(totalSamples);
  const ampQuiet = Math.pow(10, -22 / 20);
  const ampLoud = Math.pow(10, -10 / 20);
  const w = (2 * Math.PI * 1000) / sr;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sr;
    let amp = 0;
    if (t < 10) amp = ampQuiet;
    else if (t >= 12) amp = ampLoud;
    const s = amp * Math.sin(w * i);
    L[i] = s;
    R[i] = s;
  }

  const dynRes = analyzeBroadcastLoudness([L, R], sr);
  assert.ok(dynRes.lraLu >= 9.0 && dynRes.lraLu <= 13.0, `Expected dynamic LRA ~11-12 LU, got ${dynRes.lraLu}`);
  assert.ok(dynRes.loudestMomentSec >= 11.5, `Loudest chorus should be after 12s, got ${dynRes.loudestMomentSec}`);
  assert.ok(dynRes.shortTermTimeline.length > 10);
});

test('Digital clipping burst counter, DC offset, and head/tail silence detection', () => {
  const sr = 48000;
  const len = 3 * sr;
  const L = new Float32Array(len);
  const R = new Float32Array(len);

  // 0.5 s head silence, active audio in middle, 0.75 s tail silence
  const startActive = Math.floor(0.5 * sr);
  const endActive = Math.floor(2.25 * sr);
  for (let i = startActive; i < endActive; i++) {
    const s = 0.25 * Math.sin((2 * Math.PI * 440 * i) / sr);
    L[i] = s;
    R[i] = s;
  }

  // Inject 2 isolated clipped samples (not bursts)
  L[startActive + 100] = 1.0;
  L[startActive + 200] = -1.0;
  L[startActive + 201] = -1.0;

  // Inject 2 hard clip bursts (>= 3 consecutive samples at 1.0) at 1.00 s and 1.80 s
  const burst1Idx = Math.floor(1.0 * sr);
  for (let k = 0; k < 5; k++) L[burst1Idx + k] = 1.0;
  const burst2Idx = Math.floor(1.8 * sr);
  for (let k = 0; k < 8; k++) R[burst2Idx + k] = -1.0;

  const res = analyzeIntegrity([L, R], sr);
  assert.equal(res.clippedSampleCount, 3 + 5 + 8);
  assert.equal(res.clipBurstCount, 2);
  assert.equal(res.clipEvents.length, 2);
  assert.ok(Math.abs(res.worstClipSec - 1.8) < 0.05, `Worst burst should be at 1.8s, got ${res.worstClipSec}`);
  assert.ok(Math.abs(res.headSilenceSec - 0.5) < 0.02, `Head silence ~0.5s, got ${res.headSilenceSec}`);
  assert.ok(Math.abs(res.tailSilenceSec - 0.75) < 0.02, `Tail silence ~0.75s, got ${res.tailSilenceSec}`);

  // DC offset test (+0.04 bias on L)
  const dcL = makeSine(440, 0.3, 1.0, sr);
  for (let i = 0; i < dcL.length; i++) dcL[i] += 0.04;
  const dcRes = analyzeIntegrity([dcL, makeSine(440, 0.3, 1.0, sr)], sr);
  assert.ok(Math.abs(dcRes.dcOffsetPct - 4.0) < 0.2, `Expected ~4.0% DC offset, got ${dcRes.dcOffsetPct}`);
});

test('Mono compatibility and stereo phase correlation (+1, -1, ~0, localized dip, native mono)', () => {
  const sr = 48000;

  // 1. Identical L = R -> +1.00 correlation, 0 dB mono loss, 0% width
  const inPhase = makeStereoSine(440, 0.5, 2.0, sr, false);
  const resIn = analyzeStereoPhase(inPhase, sr);
  assert.equal(resIn.isMono, false);
  assert.ok(Math.abs(resIn.globalCorrelation - 1.0) < 0.01);
  assert.ok(Math.abs(resIn.minCorrelation - 1.0) < 0.01);
  assert.ok(Math.abs(resIn.monoLossDb) < 0.05);
  assert.ok(resIn.stereoWidthPct < 0.1);

  // 2. Inverted polarity L = -R -> -1.00 correlation, total mono collapse, 100% width
  const outPhase = makeStereoSine(440, 0.5, 2.0, sr, true);
  const resOut = analyzeStereoPhase(outPhase, sr);
  assert.ok(Math.abs(resOut.globalCorrelation - (-1.0)) < 0.01);
  assert.ok(resOut.monoLossDb <= -60);
  assert.ok(resOut.stereoWidthPct > 99.5);

  // 3. Orthogonal/uncorrelated L & R (sin vs cos at same frequency -> r = 0, -3.01 dB mono fold)
  const orthoL = makeSine(440, 0.5, 2.0, sr, 0);
  const orthoR = makeSine(440, 0.5, 2.0, sr, Math.PI / 2);
  const resOrtho = analyzeStereoPhase([orthoL, orthoR], sr);
  assert.ok(Math.abs(resOrtho.globalCorrelation) < 0.05, `Expected r ~0, got ${resOrtho.globalCorrelation}`);
  assert.ok(Math.abs(resOrtho.monoLossDb - (-3.01)) < 0.15, `Expected ~-3.01 dB mono fold, got ${resOrtho.monoLossDb}`);
  assert.ok(Math.abs(resOrtho.stereoWidthPct - 50.0) < 1.0);

  // 4. Localized 1-second phase inversion at t = 2.0..3.0 s inside a 4 s in-phase track
  const [dipL, dipR] = makeStereoSine(300, 0.5, 4.0, sr, false);
  for (let i = 2 * sr; i < 3 * sr; i++) dipR[i] = -dipL[i];
  const resDip = analyzeStereoPhase([dipL, dipR], sr);
  assert.ok(resDip.globalCorrelation > 0.4, `Global corr should remain positive (~0.5), got ${resDip.globalCorrelation}`);
  assert.ok(resDip.minCorrelation < -0.95, `Min windowed corr should catch -1.0 dip, got ${resDip.minCorrelation}`);
  assert.ok(resDip.worstPhaseSec >= 1.9 && resDip.worstPhaseSec <= 2.6, `Worst phase timestamp near 2s, got ${resDip.worstPhaseSec}`);

  // 5. Native mono 1-channel buffer -> graceful +1.00, no false warnings
  const nativeMono = [makeSine(440, 0.4, 2.0, sr)];
  const resMono = analyzeStereoPhase(nativeMono, sr);
  assert.equal(resMono.isMono, true);
  assert.equal(resMono.globalCorrelation, 1.0);
  assert.equal(resMono.minCorrelation, 1.0);
  assert.equal(resMono.worstPhaseSec, null);
  assert.equal(resMono.monoLossDb, 0);
});

test('Low-end (< 120 Hz) mono correlation isolates sub-bass phase independently of highs', () => {
  const sr = 48000;
  const dur = 2.0;

  // Case A: In-phase 70 Hz sub + out-of-phase 2500 Hz treble -> low-end correlation ~ +1.0
  const sub = makeSine(70, 0.4, dur, sr);
  const hi = makeSine(2500, 0.4, dur, sr);
  const L1 = new Float32Array(sub.length);
  const R1 = new Float32Array(sub.length);
  for (let i = 0; i < sub.length; i++) {
    L1[i] = sub[i] + hi[i];
    R1[i] = sub[i] - hi[i];
  }
  const resGoodSub = analyzeStereoPhase([L1, R1], sr);
  assert.ok(resGoodSub.lowEndHasContent);
  assert.ok(resGoodSub.lowEndCorrelation > 0.95, `Expected in-phase sub > 0.95, got ${resGoodSub.lowEndCorrelation}`);

  // Case B: Out-of-phase 70 Hz sub + in-phase 2500 Hz treble -> low-end correlation ~ -1.0
  const L2 = new Float32Array(sub.length);
  const R2 = new Float32Array(sub.length);
  for (let i = 0; i < sub.length; i++) {
    L2[i] = sub[i] + hi[i];
    R2[i] = -sub[i] + hi[i];
  }
  const resBadSub = analyzeStereoPhase([L2, R2], sr);
  assert.ok(resBadSub.lowEndHasContent);
  assert.ok(resBadSub.lowEndCorrelation < -0.95, `Expected out-of-phase sub < -0.95, got ${resBadSub.lowEndCorrelation}`);
});

test('Streaming platform normalization engine (Spotify, Apple Music, YouTube attenuate-only, TikTok)', () => {
  // 1. Hot commercial master (-8.2 LUFS, -0.2 dBTP -> exceeds -1 dBTP ceiling)
  const hot = computePlatformNormalization(-8.2, -0.2);
  const byId = (arr, id) => arr.find((p) => p.id === id);

  assert.equal(byId(hot, 'spotify').gainDb, -5.8);
  assert.equal(byId(hot, 'spotify').postNormLufs, -14.0);
  assert.equal(byId(hot, 'spotify').badge, 'CLIP RISK');

  assert.equal(byId(hot, 'apple').gainDb, -7.8);
  assert.equal(byId(hot, 'apple').postNormLufs, -16.0);
  assert.equal(byId(hot, 'apple').badge, 'CLIP RISK');

  assert.equal(byId(hot, 'youtube').gainDb, -5.8);
  assert.equal(byId(hot, 'youtube').postNormLufs, -14.0);
  assert.equal(byId(hot, 'youtube').badge, 'CLIP RISK');

  assert.equal(byId(hot, 'tiktok').gainDb, -5.8);
  assert.equal(byId(hot, 'tiktok').badge, 'CLIP RISK');

  // 2. Clean target master (-14.0 LUFS, -1.5 dBTP) -> all PASS
  const clean = computePlatformNormalization(-14.0, -1.5);
  assert.equal(byId(clean, 'spotify').gainDb, 0.0);
  assert.equal(byId(clean, 'spotify').badge, 'PASS');
  assert.equal(byId(clean, 'apple').gainDb, -2.0);
  assert.equal(byId(clean, 'apple').badge, 'PASS');
  assert.equal(byId(clean, 'youtube').gainDb, 0.0);
  assert.equal(byId(clean, 'youtube').badge, 'PASS');
  assert.equal(byId(clean, 'tiktok').gainDb, 0.0);
  assert.equal(byId(clean, 'tiktok').badge, 'PASS');

  // 3. Quiet master (-18.0 LUFS, -2.0 dBTP) -> YouTube & TikTok attenuate-only (0.0 dB),
  //    Spotify boosts +4.0 dB and engages -1 dB limiter, Apple Music boosts +1.0 dB (headroom-capped)
  const quiet = computePlatformNormalization(-18.0, -2.0);
  assert.equal(byId(quiet, 'youtube').gainDb, 0.0);
  assert.equal(byId(quiet, 'youtube').postNormLufs, -18.0);
  assert.equal(byId(quiet, 'tiktok').gainDb, 0.0);

  assert.equal(byId(quiet, 'spotify').gainDb, 4.0);
  assert.equal(byId(quiet, 'spotify').limiterEngaged, true);
  assert.equal(byId(quiet, 'spotify').postNormTruePeakDb, -1.0);
  assert.equal(byId(quiet, 'spotify').badge, 'CAUTION');

  assert.equal(byId(quiet, 'apple').gainDb, 1.0);
  assert.equal(byId(quiet, 'apple').headroomCapped, true);
  assert.equal(byId(quiet, 'apple').postNormTruePeakDb, -1.0);
  assert.equal(byId(quiet, 'apple').badge, 'PASS');
});

test('End-to-end runPreFlightAnalysis, checklist verdicts, and Markdown certificate export', () => {
  const sr = 48000;
  const amp = Math.pow(10, -14 / 20);
  const stereo = makeStereoSine(1000, amp, 4.0, sr);

  const report = runPreFlightAnalysis(stereo, sr, {
    filename: 'Saint_Gordon_Test_MASTER_24bit.wav',
    formatLabel: 'WAV',
  });

  assert.equal(report.meta.channelLabel, 'Stereo');
  assert.equal(report.verdict.failCount, 0);
  assert.equal(report.verdict.checks.length, 7);
  assert.equal(report.platforms.length, 4);
  assert.equal(report.waveformPeaks.length, 280);

  const md = generatePreFlightMarkdown(report);
  assert.ok(md.includes('Saint_Gordon_Test_MASTER_24bit.wav'));
  assert.ok(md.includes('Spotify'));
  assert.ok(md.includes('Apple Music'));
  assert.ok(md.includes('YouTube'));
  assert.ok(md.includes('TikTok'));
  assert.ok(md.includes('Pre-Flight Checklist'));

  const summary = generateCompactSummary(report);
  assert.ok(summary.includes('LUFS'));
  assert.ok(summary.includes('dBTP'));
  assert.equal(formatTime(65.4, true), '01:05.4');
  assert.equal(formatSignedDb(-5.8, 1), '-5.8 dB');
  assert.equal(formatSignedDb(2.4, 1), '+2.4 dB');
});
