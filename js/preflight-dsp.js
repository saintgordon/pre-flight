/**
 * Pre-Flight (TOOL / 002) — Broadcast-Grade Audio Mastering DSP Engine.
 * Zero DOM dependencies — runs identically in browsers and Node.js tests.
 *
 * Implements:
 * - ITU-R BS.1770-4 K-weighted Integrated LUFS (400 ms / 75% overlap, -70 abs / -10 rel gates)
 * - Momentary Max LUFS (400 ms) & Short-Term Max LUFS (3000 ms) + timeline
 * - EBU R128 Tech 3342 Loudness Range (LRA, 3 s windows, -70 abs / -20 rel gates, P95 - P10)
 * - True Peak (dBTP) via 4x oversampled 12-tap Kaiser-windowed sinc polyphase FIR (BS.1770-4 Annex 2)
 * - Inter-Sample Peak (> 0.0 dBTP) & Streaming Ceiling (> -1.0 dBTP) breach counters
 * - Sample Peak (dBFS), Digital Clipping & Hard Clip Burst (>= 3 consecutive samples) detector
 * - Unweighted RMS, Crest Factor, PSR, DC Offset, and Head/Tail Silence inspection
 * - Mono Compatibility (M/S energy retention, mono peak, stereo width %, L/R balance)
 * - Stereo Phase Correlation (global, 500 ms windowed minimum + timeline, <120 Hz low-end phase)
 * - Streaming Platform Normalization Matrix (Spotify, Apple Music, YouTube, TikTok)
 * - Actionable Pre-Flight Engineering Verdict Checklist & Markdown Certificate Export
 */

export const VALID_AUDIO_EXTENSIONS = [
  '.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.webm',
];

export const STREAMING_PLATFORMS = [
  {
    id: 'spotify',
    name: 'Spotify',
    shortLabel: 'Spotify (-14)',
    targetLufs: -14.0,
    ceilingDbtp: -1.0,
    loudCeilingDbtp: -2.0,
    canBoost: true,
    usesLimiterOnBoost: true,
    note: 'Standard -14 LUFS (Loud -11 / Quiet -19). Attenuates loud masters; boosts quiet masters with -1 dB limiter.',
  },
  {
    id: 'apple',
    name: 'Apple Music',
    shortLabel: 'Apple Music (-16)',
    targetLufs: -16.0,
    ceilingDbtp: -1.0,
    loudCeilingDbtp: -1.0,
    canBoost: true,
    usesLimiterOnBoost: false,
    note: 'Sound Check -16 LUFS. Turns down loud masters; boosts quiet masters only up to available -1 dBTP headroom.',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    shortLabel: 'YouTube (-14)',
    targetLufs: -14.0,
    ceilingDbtp: -1.0,
    loudCeilingDbtp: -1.0,
    canBoost: false,
    usesLimiterOnBoost: false,
    note: 'Attenuates loud masters to -14 LUFS. Never turns up tracks quieter than -14 LUFS.',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    shortLabel: 'TikTok (-14)',
    targetLufs: -14.0,
    ceilingDbtp: -1.0,
    loudCeilingDbtp: -1.0,
    canBoost: false,
    usesLimiterOnBoost: false,
    note: 'Turns down loud masters toward -14 LUFS with -1 dBTP headroom for mobile AAC playback.',
  },
];

/* --------------------------------------------------------------------------
 * Formatting Helpers
 * -------------------------------------------------------------------------- */

export function formatTime(seconds, showTenths = false) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (showTenths) {
    const totalTenths = Math.round(safe * 10);
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
  }
  const totalSeconds = Math.floor(safe);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatSignedDb(val, digits = 1) {
  if (!Number.isFinite(val)) return '—';
  const rounded = Number(val.toFixed(digits));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(digits)} dB`;
}

export function formatDb(val, unit = 'dBFS', digits = 1) {
  if (!Number.isFinite(val) || val <= -119) return `-∞ ${unit}`;
  const rounded = Number(val.toFixed(digits));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${normalized.toFixed(digits)} ${unit}`;
}

export function isSupportedAudioFilename(filename) {
  const name = String(filename || '');
  if (name.startsWith('.') || name.startsWith('._')) return false;
  const lower = name.toLowerCase();
  return VALID_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function round1(v) {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

function round2(v) {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function round3(v) {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/* --------------------------------------------------------------------------
 * Biquad Filters (ITU-R BS.1770-4 K-Weighting + 120 Hz Low-Pass)
 * -------------------------------------------------------------------------- */

/**
 * Compute ITU-R BS.1770-4 K-weighting two-stage biquad filter coefficients
 * for any sample rate via the bilinear transform.
 */
export function computeKWeightingCoeffs(sampleRate) {
  const fs = Math.max(8000, Number(sampleRate) || 48000);

  // Stage 1: Acoustic head-effect high-shelf pre-filter (+4 dB above ~1.68 kHz)
  const f0Shelf = 1681.974450955533;
  const gShelf = 3.999843853973347;
  const qShelf = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * f0Shelf) / fs);
  const vh = Math.pow(10, gShelf / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a01 = 1 + k1 / qShelf + k1 * k1;

  const stage1 = {
    b0: (vh + (vb * k1) / qShelf + k1 * k1) / a01,
    b1: (2 * (k1 * k1 - vh)) / a01,
    b2: (vh - (vb * k1) / qShelf + k1 * k1) / a01,
    a1: (2 * (k1 * k1 - 1)) / a01,
    a2: (1 - k1 / qShelf + k1 * k1) / a01,
  };

  // Stage 2: RLB (Revised Low-frequency B-curve) 2nd-order high-pass (~38 Hz)
  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * f0Hp) / fs);
  const a02 = 1 + k2 / qHp + k2 * k2;

  const stage2 = {
    b0: 1 / a02,
    b1: -2 / a02,
    b2: 1 / a02,
    a1: (2 * (k2 * k2 - 1)) / a02,
    a2: (1 - k2 / qHp + k2 * k2) / a02,
  };

  return { stage1, stage2 };
}

/**
 * 2nd-order Butterworth low-pass biquad coefficients for sub-bass (< 120 Hz) phase check.
 */
export function computeLowpassBiquadCoeffs(sampleRate, cutoffHz = 120) {
  const fs = Math.max(8000, Number(sampleRate) || 48000);
  const fc = Math.min(cutoffHz, fs * 0.45);
  const q = Math.SQRT1_2;
  const k = Math.tan((Math.PI * fc) / fs);
  const k2 = k * k;
  const norm = 1 / (1 + k / q + k2);

  return {
    b0: k2 * norm,
    b1: 2 * k2 * norm,
    b2: k2 * norm,
    a1: 2 * (k2 - 1) * norm,
    a2: (1 - k / q + k2) * norm,
  };
}

/**
 * Apply a Direct Form II Transposed biquad filter to a sample array.
 */
export function applyBiquad(samples, { b0, b1, b2, a1, a2 }) {
  const len = samples.length;
  const out = new Float32Array(len);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < len; i++) {
    const x = samples[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

/* --------------------------------------------------------------------------
 * True Peak (dBTP): 4x Oversampled 12-Tap Polyphase Windowed-Sinc FIR
 * -------------------------------------------------------------------------- */

/**
 * Modified Bessel function of the first kind, order 0 (for Kaiser window).
 */
function besselI0(x) {
  let sum = 1.0;
  let term = 1.0;
  const halfX = x * 0.5;
  for (let k = 1; k <= 25; k++) {
    term *= (halfX / k) * (halfX / k);
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/**
 * Build ITU-R BS.1770-4 Annex 2 style 4-phase, 12-tap Kaiser-windowed sinc
 * polyphase interpolation filter bank (48-tap prototype FIR, beta = 6.5).
 * Phase 0 = exact original sample (fractional delay 0).
 * Phases 1, 2, 3 = fractional delays +0.25, +0.50, +0.75 samples.
 */
export function buildTruePeakPolyphaseKernels() {
  const taps = 12;
  const halfSpan = 6.0;
  const beta = 6.5;
  const invI0Beta = 1.0 / besselI0(beta);
  const phases = [];
  const l1Norms = [];

  for (let p = 1; p <= 3; p++) {
    const mu = p / 4.0;
    const h = new Float64Array(taps);
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      // Sample x[i + t - 5] evaluated at position i + mu
      // Distance from interpolated point: d = (t - 5) - mu
      const d = (t - 5) - mu;
      const sinc = Math.abs(d) < 1e-12 ? 1.0 : Math.sin(Math.PI * d) / (Math.PI * d);
      const ratio = d / halfSpan;
      const winArg = Math.max(0, 1 - ratio * ratio);
      const windowVal = besselI0(beta * Math.sqrt(winArg)) * invI0Beta;
      h[t] = sinc * windowVal;
      sum += h[t];
    }
    let l1 = 0;
    for (let t = 0; t < taps; t++) {
      h[t] /= sum; // Exact unity DC gain
      l1 += Math.abs(h[t]);
    }
    phases.push(h);
    l1Norms.push(l1);
  }

  return {
    phase1: phases[0],
    phase2: phases[1],
    phase3: phases[2],
    maxL1Norm: Math.max(...l1Norms),
  };
}

const TRUE_PEAK_KERNELS = buildTruePeakPolyphaseKernels();
const CEILING_NEG1_LINEAR = Math.pow(10, -1.0 / 20.0); // ~0.891250938

/**
 * Analyze True Peak (dBTP) across channels using 4x oversampled 12-tap polyphase
 * Kaiser-windowed sinc FIR interpolation.
 *
 * Uses mathematically exact L1-norm block upper-bound pruning so quiet blocks that
 * cannot reach the current true peak or -1.0 dBTP skip convolution with ZERO error.
 */
export function analyzeTruePeak(channelDataList, sampleRate = 48000) {
  if (!channelDataList || channelDataList.length === 0 || channelDataList[0].length === 0) {
    return {
      truePeakDb: -120,
      truePeakLinear: 0,
      channelTruePeaksDb: [],
      truePeakTimeSec: 0,
      ispCount: 0,
      ceilingBreachCount: 0,
      maxOvershootDb: 0,
    };
  }

  const { phase1, phase2, phase3, maxL1Norm } = TRUE_PEAK_KERNELS;

  // Unpack filter taps to local scalars for peak JIT performance
  const p1_0 = phase1[0], p1_1 = phase1[1], p1_2 = phase1[2], p1_3 = phase1[3];
  const p1_4 = phase1[4], p1_5 = phase1[5], p1_6 = phase1[6], p1_7 = phase1[7];
  const p1_8 = phase1[8], p1_9 = phase1[9], p1_10 = phase1[10], p1_11 = phase1[11];

  const p2_0 = phase2[0], p2_1 = phase2[1], p2_2 = phase2[2], p2_3 = phase2[3];
  const p2_4 = phase2[4], p2_5 = phase2[5], p2_6 = phase2[6], p2_7 = phase2[7];
  const p2_8 = phase2[8], p2_9 = phase2[9], p2_10 = phase2[10], p2_11 = phase2[11];

  const p3_0 = phase3[0], p3_1 = phase3[1], p3_2 = phase3[2], p3_3 = phase3[3];
  const p3_4 = phase3[4], p3_5 = phase3[5], p3_6 = phase3[6], p3_7 = phase3[7];
  const p3_8 = phase3[8], p3_9 = phase3[9], p3_10 = phase3[10], p3_11 = phase3[11];

  const numChannels = channelDataList.length;
  const channelTruePeaksDb = [];
  let globalMaxTP = 0;
  let globalMaxSamplePeak = 0;
  let globalPeakSampleIdx = 0;
  let ispCount = 0;
  let ceilingBreachCount = 0;

  const blockSize = 128;

  for (let c = 0; c < numChannels; c++) {
    const ch = channelDataList[c];
    const len = ch.length;
    let chMaxTP = 0;

    for (let blockStart = 0; blockStart < len; blockStart += blockSize) {
      const blockEnd = Math.min(len, blockStart + blockSize);
      const haloStart = Math.max(0, blockStart - 5);
      const haloEnd = Math.min(len, blockEnd + 6);

      let blockMaxAbs = 0;
      for (let i = haloStart; i < haloEnd; i++) {
        const a = Math.abs(ch[i]);
        if (a > blockMaxAbs) blockMaxAbs = a;
      }

      if (blockMaxAbs > globalMaxSamplePeak) {
        globalMaxSamplePeak = blockMaxAbs;
      }

      // Exact mathematical upper bound: |sum(h_k * x_k)| <= maxL1Norm * blockMaxAbs
      const upperBound = blockMaxAbs * maxL1Norm;
      const interestThreshold = Math.min(chMaxTP, CEILING_NEG1_LINEAR);
      if (upperBound <= interestThreshold && blockMaxAbs <= interestThreshold) {
        continue;
      }

      for (let i = blockStart; i < blockEnd; i++) {
        const x0 = ch[i];
        const abs0 = x0 < 0 ? -x0 : x0;
        let localMax = abs0;

        let y1, y2, y3;
        if (i >= 5 && i + 6 < len) {
          const s0 = ch[i - 5], s1 = ch[i - 4], s2 = ch[i - 3], s3 = ch[i - 2];
          const s4 = ch[i - 1], s5 = ch[i],     s6 = ch[i + 1], s7 = ch[i + 2];
          const s8 = ch[i + 3], s9 = ch[i + 4], s10 = ch[i + 5], s11 = ch[i + 6];

          y1 = p1_0 * s0 + p1_1 * s1 + p1_2 * s2 + p1_3 * s3 +
               p1_4 * s4 + p1_5 * s5 + p1_6 * s6 + p1_7 * s7 +
               p1_8 * s8 + p1_9 * s9 + p1_10 * s10 + p1_11 * s11;

          y2 = p2_0 * s0 + p2_1 * s1 + p2_2 * s2 + p2_3 * s3 +
               p2_4 * s4 + p2_5 * s5 + p2_6 * s6 + p2_7 * s7 +
               p2_8 * s8 + p2_9 * s9 + p2_10 * s10 + p2_11 * s11;

          y3 = p3_0 * s0 + p3_1 * s1 + p3_2 * s2 + p3_3 * s3 +
               p3_4 * s4 + p3_5 * s5 + p3_6 * s6 + p3_7 * s7 +
               p3_8 * s8 + p3_9 * s9 + p3_10 * s10 + p3_11 * s11;
        } else {
          // Boundary-safe zero-padded convolution at very start/end of buffer
          let a1 = 0, a2 = 0, a3 = 0;
          for (let t = 0; t < 12; t++) {
            const idx = i + t - 5;
            const s = idx >= 0 && idx < len ? ch[idx] : 0;
            a1 += phase1[t] * s;
            a2 += phase2[t] * s;
            a3 += phase3[t] * s;
          }
          y1 = a1;
          y2 = a2;
          y3 = a3;
        }

        const abs1 = y1 < 0 ? -y1 : y1;
        const abs2 = y2 < 0 ? -y2 : y2;
        const abs3 = y3 < 0 ? -y3 : y3;
        const interMax = abs1 > abs2 ? (abs1 > abs3 ? abs1 : abs3) : (abs2 > abs3 ? abs2 : abs3);
        if (interMax > localMax) localMax = interMax;

        if (interMax > 1.0) ispCount++;
        if (localMax > CEILING_NEG1_LINEAR) ceilingBreachCount++;

        if (localMax > chMaxTP) {
          chMaxTP = localMax;
        }
        if (localMax > globalMaxTP) {
          globalMaxTP = localMax;
          globalPeakSampleIdx = i;
        }
      }
    }

    const chDb = chMaxTP > 1e-9 ? 20 * Math.log10(chMaxTP) : -120;
    channelTruePeaksDb.push(round2(chDb));
  }

  const truePeakDb = globalMaxTP > 1e-9 ? 20 * Math.log10(globalMaxTP) : -120;
  const samplePeakDb = globalMaxSamplePeak > 1e-9 ? 20 * Math.log10(globalMaxSamplePeak) : -120;
  const maxOvershootDb = Math.max(0, truePeakDb - samplePeakDb);

  return {
    truePeakDb: round2(truePeakDb),
    truePeakLinear: globalMaxTP,
    channelTruePeaksDb,
    truePeakTimeSec: round2(globalPeakSampleIdx / Math.max(1, sampleRate)),
    ispCount,
    ceilingBreachCount,
    maxOvershootDb: round2(maxOvershootDb),
  };
}

/* --------------------------------------------------------------------------
 * Broadcast Loudness (ITU-R BS.1770-4 + EBU R128 Tech 3342 LRA)
 * -------------------------------------------------------------------------- */

function percentileSorted(sortedArr, p) {
  const n = sortedArr.length;
  if (n === 0) return 0;
  if (n === 1) return sortedArr[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] + frac * (sortedArr[hi] - sortedArr[lo]);
}

/**
 * Compute full ITU-R BS.1770-4 Integrated LUFS, Momentary Max (400 ms),
 * Short-Term Max (3000 ms), EBU R128 Loudness Range (LRA in LU),
 * Short-Term LUFS timeline, loudest moment timestamp, RMS, Sample Peak, and Crest Factor.
 */
export function analyzeBroadcastLoudness(channelDataList, sampleRate = 48000, timelineBins = 240) {
  if (!channelDataList || channelDataList.length === 0 || channelDataList[0].length === 0) {
    return {
      integratedLufs: -120,
      momentaryMaxLufs: -120,
      shortTermMaxLufs: -120,
      lraLu: 0,
      rmsDb: -120,
      samplePeakDb: -120,
      channelSamplePeaksDb: [],
      crestDb: 0,
      loudestMomentSec: 0,
      shortTermTimeline: [],
    };
  }

  const numChannels = channelDataList.length;
  const length = channelDataList[0].length;
  const { stage1, stage2 } = computeKWeightingCoeffs(sampleRate);

  const channelWeight = (idx) => {
    if (numChannels <= 2) return 1.0;
    if (idx === 3 && numChannels >= 6) return 0.0; // LFE excluded per BS.1770-4
    if (idx >= 3) return 1.41; // Surround +1.5 dB weight
    return 1.0;
  };

  let maxAbs = 0;
  let rawSumSq = 0;
  const channelSamplePeaksDb = [];
  const kWeightedChannels = [];

  for (let c = 0; c < numChannels; c++) {
    const data = channelDataList[c];
    let chMax = 0;
    for (let i = 0; i < length; i++) {
      const s = data[i];
      const a = s < 0 ? -s : s;
      if (a > chMax) chMax = a;
      rawSumSq += s * s;
    }
    if (chMax > maxAbs) maxAbs = chMax;
    channelSamplePeaksDb.push(round2(chMax > 1e-9 ? 20 * Math.log10(chMax) : -120));

    const s1 = applyBiquad(data, stage1);
    const s2 = applyBiquad(s1, stage2);
    kWeightedChannels.push(s2);
  }

  const rmsLinear = Math.sqrt(rawSumSq / (length * numChannels));
  const rmsDb = rmsLinear > 1e-9 ? 20 * Math.log10(rmsLinear) : -120;
  const samplePeakDb = maxAbs > 1e-9 ? 20 * Math.log10(maxAbs) : -120;
  const crestDb = Math.max(0, samplePeakDb - rmsDb);

  // Partition into 100 ms sub-blocks (exact O(N) basis for both 400 ms M and 3000 ms ST)
  const hopSamples = Math.max(1, Math.round(sampleRate * 0.1));
  const numSubBlocks = Math.floor(length / hopSamples);

  // Very short clip (< 400 ms)
  if (numSubBlocks < 4) {
    let meanSq = 0;
    for (let c = 0; c < numChannels; c++) {
      const kData = kWeightedChannels[c];
      let sum = 0;
      for (let i = 0; i < length; i++) sum += kData[i] * kData[i];
      meanSq += channelWeight(c) * (sum / length);
    }
    const lufs = meanSq > 1e-12 ? -0.691 + 10 * Math.log10(meanSq) : -120;
    return {
      integratedLufs: round1(lufs),
      momentaryMaxLufs: round1(lufs),
      shortTermMaxLufs: round1(lufs),
      lraLu: 0,
      rmsDb: round1(rmsDb),
      samplePeakDb: round2(samplePeakDb),
      channelSamplePeaksDb,
      crestDb: round1(crestDb),
      loudestMomentSec: 0,
      shortTermTimeline: [{ timeSec: 0, lufs: round1(lufs) }],
    };
  }

  // Weighted energy per 100 ms sub-block
  const subEnergies = new Float64Array(numSubBlocks);
  for (let b = 0; b < numSubBlocks; b++) {
    const start = b * hopSamples;
    const end = start + hopSamples;
    let z = 0;
    for (let c = 0; c < numChannels; c++) {
      const kData = kWeightedChannels[c];
      let sum = 0;
      for (let i = start; i < end; i++) {
        const v = kData[i];
        sum += v * v;
      }
      z += channelWeight(c) * (sum / hopSamples);
    }
    subEnergies[b] = z;
  }

  // 1. Momentary blocks: 400 ms (4 sub-blocks), 100 ms hop (75% overlap)
  const numMom = numSubBlocks - 3;
  const momEnergies = new Float64Array(numMom);
  let momWindowSum = subEnergies[0] + subEnergies[1] + subEnergies[2] + subEnergies[3];
  momEnergies[0] = momWindowSum * 0.25;
  let maxMomEnergy = momEnergies[0];

  for (let i = 1; i < numMom; i++) {
    momWindowSum += subEnergies[i + 3] - subEnergies[i - 1];
    const e = Math.max(0, momWindowSum * 0.25);
    momEnergies[i] = e;
    if (e > maxMomEnergy) maxMomEnergy = e;
  }

  const momentaryMaxLufs = maxMomEnergy > 1e-12 ? -0.691 + 10 * Math.log10(maxMomEnergy) : -120;

  // Integrated LUFS: ITU-R BS.1770-4 two-stage gating (-70 LUFS abs, -10 LU rel)
  const absThreshold = Math.pow(10, (-70 + 0.691) / 10);
  let aboveAbsSum = 0;
  let aboveAbsCount = 0;
  for (let i = 0; i < numMom; i++) {
    if (momEnergies[i] > absThreshold) {
      aboveAbsSum += momEnergies[i];
      aboveAbsCount++;
    }
  }

  let integratedLufs = -70;
  if (aboveAbsCount > 0) {
    const ungatedMean = aboveAbsSum / aboveAbsCount;
    const ungatedLufs = -0.691 + 10 * Math.log10(ungatedMean);
    const relThreshold = Math.pow(10, (ungatedLufs - 10 + 0.691) / 10);

    let aboveRelSum = 0;
    let aboveRelCount = 0;
    for (let i = 0; i < numMom; i++) {
      if (momEnergies[i] > absThreshold && momEnergies[i] > relThreshold) {
        aboveRelSum += momEnergies[i];
        aboveRelCount++;
      }
    }
    const gatedMean = aboveRelCount > 0 ? aboveRelSum / aboveRelCount : ungatedMean;
    integratedLufs = -0.691 + 10 * Math.log10(gatedMean);
  } else {
    integratedLufs = maxMomEnergy > 1e-12 ? -0.691 + 10 * Math.log10(maxMomEnergy) : -120;
  }

  // 2. Short-Term blocks: 3000 ms (30 sub-blocks), 100 ms hop
  const stBlocks = Math.min(30, numSubBlocks);
  const numST = numSubBlocks - stBlocks + 1;
  const stEnergies = new Float64Array(numST);
  const stLufsValues = new Float64Array(numST);

  let stSum = 0;
  for (let i = 0; i < stBlocks; i++) stSum += subEnergies[i];
  stEnergies[0] = stSum / stBlocks;
  stLufsValues[0] = stEnergies[0] > 1e-12 ? -0.691 + 10 * Math.log10(stEnergies[0]) : -120;

  let maxStEnergy = stEnergies[0];
  let maxStIdx = 0;

  for (let i = 1; i < numST; i++) {
    stSum += subEnergies[i + stBlocks - 1] - subEnergies[i - 1];
    const e = Math.max(0, stSum / stBlocks);
    stEnergies[i] = e;
    stLufsValues[i] = e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -120;
    if (e > maxStEnergy) {
      maxStEnergy = e;
      maxStIdx = i;
    }
  }

  const shortTermMaxLufs = maxStEnergy > 1e-12 ? -0.691 + 10 * Math.log10(maxStEnergy) : -120;
  const loudestMomentSec = round2(maxStIdx * 0.1);

  // 3. Loudness Range (LRA) per EBU R128 Tech 3342 (-70 LUFS abs, -20 LU rel, P95 - P10)
  let lraLu = 0;
  if (numSubBlocks >= 30 && numST >= 2) {
    let stAbsSum = 0;
    let stAbsCount = 0;
    for (let i = 0; i < numST; i++) {
      if (stEnergies[i] > absThreshold) {
        stAbsSum += stEnergies[i];
        stAbsCount++;
      }
    }
    if (stAbsCount >= 2) {
      const stUngatedMean = stAbsSum / stAbsCount;
      const stUngatedLufs = -0.691 + 10 * Math.log10(stUngatedMean);
      const lraRelCutoffLufs = stUngatedLufs - 20.0;

      const gatedStLufs = [];
      for (let i = 0; i < numST; i++) {
        if (stEnergies[i] > absThreshold && stLufsValues[i] > lraRelCutoffLufs) {
          gatedStLufs.push(stLufsValues[i]);
        }
      }

      if (gatedStLufs.length >= 2) {
        gatedStLufs.sort((a, b) => a - b);
        const p10 = percentileSorted(gatedStLufs, 0.10);
        const p95 = percentileSorted(gatedStLufs, 0.95);
        lraLu = Math.max(0, p95 - p10);
      }
    }
  }

  // 4. Downsampled Short-Term LUFS timeline for canvas plotting
  const targetBins = Math.min(timelineBins, numST);
  const shortTermTimeline = [];
  for (let b = 0; b < targetBins; b++) {
    const start = Math.floor((b * numST) / targetBins);
    const end = Math.max(start + 1, Math.floor(((b + 1) * numST) / targetBins));
    let sumL = 0;
    let maxL = -120;
    for (let i = start; i < end; i++) {
      const v = Math.max(-70, stLufsValues[i]);
      sumL += v;
      if (v > maxL) maxL = v;
    }
    const avgL = sumL / (end - start);
    const centerIdx = (start + end) * 0.5;
    shortTermTimeline.push({
      timeSec: round2((centerIdx + stBlocks * 0.5) * 0.1),
      lufs: round1(avgL),
      peakLufs: round1(maxL),
    });
  }

  return {
    integratedLufs: round1(integratedLufs),
    momentaryMaxLufs: round1(momentaryMaxLufs),
    shortTermMaxLufs: round1(shortTermMaxLufs),
    lraLu: round1(lraLu),
    rmsDb: round1(rmsDb),
    samplePeakDb: round2(samplePeakDb),
    channelSamplePeaksDb,
    crestDb: round1(crestDb),
    loudestMomentSec,
    shortTermTimeline,
  };
}

/* --------------------------------------------------------------------------
 * Digital Clipping, DC Offset & Head/Tail Silence Detection
 * -------------------------------------------------------------------------- */

/**
 * Scan for digital clipping (|s| >= 0.9999), consecutive hard clip bursts (>= 3 samples),
 * DC offset per channel, and head/tail silence padding.
 */
export function analyzeIntegrity(channelDataList, sampleRate = 48000) {
  if (!channelDataList || channelDataList.length === 0 || channelDataList[0].length === 0) {
    return {
      clippedSampleCount: 0,
      clipBurstCount: 0,
      clipEvents: [],
      clipMarkerTimes: [],
      worstClipSec: null,
      dcOffsetMax: 0,
      dcOffsetPct: 0,
      dcOffsetDb: -120,
      channelDcOffsets: [],
      headSilenceSec: 0,
      tailSilenceSec: 0,
      headHardStart: false,
      tailHardEnd: false,
    };
  }

  const numChannels = channelDataList.length;
  const length = channelDataList[0].length;
  const clipThresh = 0.9999;
  const silenceThresh = 0.001; // -60 dBFS

  let clippedSampleCount = 0;
  let clipBurstCount = 0;
  const rawBursts = [];
  const channelDcOffsets = [];
  let dcOffsetMax = 0;

  for (let c = 0; c < numChannels; c++) {
    const ch = channelDataList[c];
    let sum = 0;
    let runLen = 0;
    let runStart = 0;

    for (let i = 0; i < length; i++) {
      const s = ch[i];
      sum += s;
      const a = s < 0 ? -s : s;
      if (a >= clipThresh) {
        clippedSampleCount++;
        if (runLen === 0) runStart = i;
        runLen++;
      } else if (runLen > 0) {
        if (runLen >= 3) {
          clipBurstCount++;
          rawBursts.push({
            timeSec: round2(runStart / sampleRate),
            durationSamples: runLen,
            channel: c === 0 ? 'L' : c === 1 ? 'R' : `CH${c + 1}`,
          });
        }
        runLen = 0;
      }
    }

    if (runLen >= 3) {
      clipBurstCount++;
      rawBursts.push({
        timeSec: round2(runStart / sampleRate),
        durationSamples: runLen,
        channel: c === 0 ? 'L' : c === 1 ? 'R' : `CH${c + 1}`,
      });
    }

    const dc = sum / length;
    channelDcOffsets.push(round3(dc));
    if (Math.abs(dc) > dcOffsetMax) dcOffsetMax = Math.abs(dc);
  }

  // Merge clip events occurring within 180 ms for clean reporting & markers
  rawBursts.sort((a, b) => a.timeSec - b.timeSec);
  const mergedEvents = [];
  for (const ev of rawBursts) {
    const prev = mergedEvents[mergedEvents.length - 1];
    if (prev && ev.timeSec - prev.timeSec < 0.18) {
      if (ev.durationSamples > prev.durationSamples) {
        prev.durationSamples = ev.durationSamples;
        prev.channel = ev.channel;
      }
      prev.burstsHere = (prev.burstsHere || 1) + 1;
    } else {
      mergedEvents.push({ ...ev, burstsHere: 1 });
    }
  }

  // Sort copy by severity to surface worst locations
  const worstFirst = [...mergedEvents].sort((a, b) => b.durationSamples - a.durationSamples);
  const clipEvents = worstFirst.slice(0, 12);
  const worstClipSec = clipEvents.length > 0 ? clipEvents[0].timeSec : null;
  const clipMarkerTimes = mergedEvents.slice(0, 200).map((e) => e.timeSec);

  // Head & tail silence scan (-60 dBFS threshold)
  let firstActiveIdx = length;
  for (let i = 0; i < length; i++) {
    let active = false;
    for (let c = 0; c < numChannels; c++) {
      if (Math.abs(channelDataList[c][i]) >= silenceThresh) {
        active = true;
        break;
      }
    }
    if (active) {
      firstActiveIdx = i;
      break;
    }
  }

  let lastActiveIdx = -1;
  for (let i = length - 1; i >= 0; i--) {
    let active = false;
    for (let c = 0; c < numChannels; c++) {
      if (Math.abs(channelDataList[c][i]) >= silenceThresh) {
        active = true;
        break;
      }
    }
    if (active) {
      lastActiveIdx = i;
      break;
    }
  }

  const headSilenceSec = firstActiveIdx < length ? round2(firstActiveIdx / sampleRate) : round2(length / sampleRate);
  const tailSilenceSec = lastActiveIdx >= 0 ? round2((length - 1 - lastActiveIdx) / sampleRate) : round2(length / sampleRate);

  // Hard start/end splice check (sample 0 or last sample > -26 dBFS)
  let startAbs = 0;
  let endAbs = 0;
  for (let c = 0; c < numChannels; c++) {
    startAbs = Math.max(startAbs, Math.abs(channelDataList[c][0]));
    endAbs = Math.max(endAbs, Math.abs(channelDataList[c][length - 1]));
  }
  const headHardStart = startAbs > 0.05;
  const tailHardEnd = endAbs > 0.05;

  const dcOffsetDb = dcOffsetMax > 1e-6 ? round1(20 * Math.log10(dcOffsetMax)) : -120;

  return {
    clippedSampleCount,
    clipBurstCount,
    clipEvents,
    clipMarkerTimes,
    worstClipSec,
    dcOffsetMax: Number(dcOffsetMax.toFixed(5)),
    dcOffsetPct: round2(dcOffsetMax * 100),
    dcOffsetDb,
    channelDcOffsets,
    headSilenceSec,
    tailSilenceSec,
    headHardStart,
    tailHardEnd,
  };
}

/* --------------------------------------------------------------------------
 * Mono Compatibility & Stereo Phase Correlation (Full-Band + < 120 Hz)
 * -------------------------------------------------------------------------- */

function pearsonCorrelation(arrL, arrR, start = 0, end = arrL.length) {
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  for (let i = start; i < end; i++) {
    const l = arrL[i];
    const r = arrR[i];
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }
  const denom = Math.sqrt(sumL2 * sumR2);
  if (denom < 1e-14) {
    if (sumL2 < 1e-14 && sumR2 < 1e-14) return 1.0; // Both silent
    return 0.0; // Hard panned to one channel
  }
  return Math.max(-1, Math.min(1, sumLR / denom));
}

/**
 * Analyze Mono Fold-Down Compatibility and Stereo Phase Correlation.
 * Gracefully handles native mono inputs without false phase warnings.
 */
export function analyzeStereoPhase(channelDataList, sampleRate = 48000, timelineBins = 240) {
  if (!channelDataList || channelDataList.length === 0 || channelDataList[0].length === 0) {
    return {
      isMono: true,
      globalCorrelation: 1.0,
      minCorrelation: 1.0,
      worstPhaseSec: null,
      negativePhasePct: 0,
      lowEndCorrelation: 1.0,
      lowEndHasContent: false,
      monoLossDb: 0,
      monoPeakDb: -120,
      stereoWidthPct: 0,
      lrBalanceDb: 0,
      phaseTimeline: [],
    };
  }

  const length = channelDataList[0].length;
  const durationSec = length / Math.max(1, sampleRate);

  // Graceful native mono handling
  if (channelDataList.length === 1) {
    const ch = channelDataList[0];
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const monoPeakDb = peak > 1e-9 ? round2(20 * Math.log10(peak)) : -120;
    const phaseTimeline = [
      { timeSec: 0, r: 1.0 },
      { timeSec: round2(durationSec), r: 1.0 },
    ];
    return {
      isMono: true,
      globalCorrelation: 1.0,
      minCorrelation: 1.0,
      worstPhaseSec: null,
      negativePhasePct: 0,
      lowEndCorrelation: 1.0,
      lowEndHasContent: true,
      monoLossDb: 0,
      monoPeakDb,
      stereoWidthPct: 0,
      lrBalanceDb: 0,
      phaseTimeline,
    };
  }

  const L = channelDataList[0];
  const R = channelDataList[1];

  let sumL2 = 0;
  let sumR2 = 0;
  let sumLR = 0;
  let sumM2 = 0;
  let sumS2 = 0;
  let monoPeak = 0;

  for (let i = 0; i < length; i++) {
    const l = L[i];
    const r = R[i];
    const m = 0.5 * (l + r);
    const s = 0.5 * (l - r);
    sumL2 += l * l;
    sumR2 += r * r;
    sumLR += l * r;
    sumM2 += m * m;
    sumS2 += s * s;
    const am = m < 0 ? -m : m;
    if (am > monoPeak) monoPeak = am;
  }

  const denom = Math.sqrt(sumL2 * sumR2);
  const globalCorrelation = denom < 1e-14
    ? (sumL2 < 1e-14 && sumR2 < 1e-14 ? 1.0 : 0.0)
    : Math.max(-1, Math.min(1, sumLR / denom));

  const stereoMeanSq = 0.5 * (sumL2 + sumR2) / length;
  const monoMeanSq = sumM2 / length;
  const sideMeanSq = sumS2 / length;

  let monoLossDb = 0;
  if (stereoMeanSq > 1e-12) {
    monoLossDb = monoMeanSq > 1e-14 ? 10 * Math.log10(monoMeanSq / stereoMeanSq) : -120;
  }
  monoLossDb = Math.min(0, monoLossDb);

  const monoPeakDb = monoPeak > 1e-9 ? 20 * Math.log10(monoPeak) : -120;

  const mRms = Math.sqrt(monoMeanSq);
  const sRms = Math.sqrt(sideMeanSq);
  const stereoWidthPct = (mRms + sRms) > 1e-9 ? (sRms / (mRms + sRms)) * 100 : 0;

  const rmsL = Math.sqrt(sumL2 / length);
  const rmsR = Math.sqrt(sumR2 / length);
  let lrBalanceDb = 0;
  if (rmsL > 1e-9 && rmsR > 1e-9) {
    lrBalanceDb = Math.max(-24, Math.min(24, 20 * Math.log10(rmsR / rmsL)));
  } else if (rmsR > 1e-9) {
    lrBalanceDb = 24;
  } else if (rmsL > 1e-9) {
    lrBalanceDb = -24;
  }

  // Windowed Phase Correlation (500 ms windows, 250 ms hop)
  const winSamples = Math.min(length, Math.max(64, Math.round(sampleRate * 0.5)));
  const hopSamples = Math.max(32, Math.round(winSamples * 0.5));
  const rawWindows = [];
  const activeEnergyGate = 1e-6; // -60 dBFS mean square gate so silence doesn't distort min correlation

  let minCorrelation = 1.0;
  let worstPhaseSec = null;
  let activeWindowCount = 0;
  let negativeWindowCount = 0;

  for (let start = 0; start < length; start += hopSamples) {
    const end = Math.min(length, start + winSamples);
    if (end - start < Math.min(64, winSamples * 0.25)) break;

    let wL2 = 0;
    let wR2 = 0;
    let wLR = 0;
    for (let i = start; i < end; i++) {
      const l = L[i];
      const r = R[i];
      wL2 += l * l;
      wR2 += r * r;
      wLR += l * r;
    }

    const n = end - start;
    const meanSq = 0.5 * (wL2 + wR2) / n;
    const wDenom = Math.sqrt(wL2 * wR2);
    const active = meanSq >= activeEnergyGate;
    const r = !active
      ? 1.0
      : (wDenom < 1e-14 ? 0.0 : Math.max(-1, Math.min(1, wLR / wDenom)));

    const centerTime = (start + n * 0.5) / sampleRate;
    rawWindows.push({ timeSec: centerTime, r, active });

    if (active) {
      activeWindowCount++;
      if (r < 0) negativeWindowCount++;
      if (r < minCorrelation || worstPhaseSec === null) {
        minCorrelation = r;
        worstPhaseSec = round2(start / sampleRate);
      }
    }
    if (end >= length) break;
  }

  if (activeWindowCount === 0) {
    minCorrelation = globalCorrelation;
    worstPhaseSec = null;
  }

  const negativePhasePct = activeWindowCount > 0 ? (negativeWindowCount / activeWindowCount) * 100 : 0;

  // Low-End (< 120 Hz) Mono Correlation via 2nd-order Butterworth LPF
  const lpCoeffs = computeLowpassBiquadCoeffs(sampleRate, 120);
  const lowL = applyBiquad(L, lpCoeffs);
  const lowR = applyBiquad(R, lpCoeffs);

  let lowSumL2 = 0;
  let lowSumR2 = 0;
  let lowSumLR = 0;
  // Skip first 20 ms filter settling transient if track is long enough
  const settleIdx = length > Math.round(sampleRate * 0.1) ? Math.round(sampleRate * 0.02) : 0;
  for (let i = settleIdx; i < length; i++) {
    const ll = lowL[i];
    const lr = lowR[i];
    lowSumL2 += ll * ll;
    lowSumR2 += lr * lr;
    lowSumLR += ll * lr;
  }
  const lowMeanSq = 0.5 * (lowSumL2 + lowSumR2) / Math.max(1, length - settleIdx);
  const lowRmsDb = lowMeanSq > 1e-14 ? 10 * Math.log10(lowMeanSq) : -120;
  const lowEndHasContent = lowRmsDb > -75;
  const lowDenom = Math.sqrt(lowSumL2 * lowSumR2);
  const lowEndCorrelation = lowDenom < 1e-14
    ? (lowSumL2 < 1e-14 && lowSumR2 < 1e-14 ? 1.0 : 0.0)
    : Math.max(-1, Math.min(1, lowSumLR / lowDenom));

  // Downsample phase timeline preserving worst dips in each bin
  const numWins = rawWindows.length;
  const targetBins = Math.min(timelineBins, numWins);
  const phaseTimeline = [];
  for (let b = 0; b < targetBins; b++) {
    const start = Math.floor((b * numWins) / targetBins);
    const end = Math.max(start + 1, Math.floor(((b + 1) * numWins) / targetBins));
    let minR = 1.0;
    let sumR = 0;
    for (let i = start; i < end; i++) {
      sumR += rawWindows[i].r;
      if (rawWindows[i].r < minR) minR = rawWindows[i].r;
    }
    phaseTimeline.push({
      timeSec: round2(rawWindows[Math.floor((start + end) * 0.5)].timeSec),
      r: round2(minR),
      avgR: round2(sumR / (end - start)),
    });
  }

  return {
    isMono: false,
    globalCorrelation: round2(globalCorrelation),
    minCorrelation: round2(minCorrelation),
    worstPhaseSec,
    negativePhasePct: round1(negativePhasePct),
    lowEndCorrelation: round2(lowEndCorrelation),
    lowEndHasContent,
    lowEndRmsDb: round1(lowRmsDb),
    monoLossDb: round2(monoLossDb),
    monoPeakDb: round2(monoPeakDb),
    stereoWidthPct: round1(stereoWidthPct),
    lrBalanceDb: round2(lrBalanceDb),
    phaseTimeline,
  };
}

/* --------------------------------------------------------------------------
 * Streaming Platform Normalization Matrix
 * -------------------------------------------------------------------------- */

/**
 * Calculate exact turn-down / gain adjustment, post-normalization LUFS & True Peak,
 * codec clipping risk, and editorial PASS / CAUTION / CLIP RISK verdict per platform.
 */
export function computePlatformNormalization(integratedLufs, truePeakDb) {
  const safeLufs = Number.isFinite(integratedLufs) ? integratedLufs : -120;
  const safeTP = Number.isFinite(truePeakDb) ? truePeakDb : -120;

  return STREAMING_PLATFORMS.map((platform) => {
    const rawDeltaDb = platform.targetLufs - safeLufs;
    let gainDb = 0;
    let limiterEngaged = false;
    let headroomCapped = false;

    if (safeLufs <= -110) {
      gainDb = 0;
    } else if (rawDeltaDb <= 0) {
      // Track is louder than target -> linear attenuation
      gainDb = rawDeltaDb;
    } else if (!platform.canBoost) {
      // Attenuate-only platforms (YouTube, TikTok) never turn up quiet tracks
      gainDb = 0;
    } else if (platform.usesLimiterOnBoost) {
      // Spotify Standard boosts quieter tracks to -14 LUFS and engages -1 dB limiter if peaks exceed ceiling
      gainDb = rawDeltaDb;
      if (safeTP + gainDb > platform.ceilingDbtp) {
        limiterEngaged = true;
      }
    } else {
      // Apple Music Sound Check boosts quiet tracks only up to available peak headroom (no clipping)
      const availableHeadroom = Math.max(0, platform.ceilingDbtp - safeTP);
      gainDb = Math.min(rawDeltaDb, availableHeadroom);
      if (gainDb < rawDeltaDb - 0.05) {
        headroomCapped = true;
      }
    }

    const postNormLufs = safeLufs <= -110 ? -120 : safeLufs + gainDb;
    const rawPostNormTP = safeTP <= -110 ? -120 : safeTP + gainDb;
    const postNormTruePeakDb = limiterEngaged ? platform.ceilingDbtp : rawPostNormTP;

    // Codec clipping risk evaluates BOTH the delivered master True Peak (encoded to AAC/Vorbis/Opus
    // BEFORE playback loudness normalization) AND post-normalization True Peak / limiter engagement.
    let status = 'pass';
    let badge = 'PASS';
    let codecRisk = 'Low';
    let summary = '';

    if (safeTP > 0.0) {
      status = 'fail';
      badge = 'CLIP RISK';
      codecRisk = 'High (> 0 dBTP ISP)';
      summary = 'Master exceeds 0.0 dBTP; lossy transcoding will introduce audible inter-sample distortion.';
    } else if (safeTP > platform.ceilingDbtp) {
      status = 'fail';
      badge = 'CLIP RISK';
      codecRisk = `High (> ${platform.ceilingDbtp.toFixed(1)} dBTP)`;
      summary = `Exceeds ${platform.name}'s ${platform.ceilingDbtp.toFixed(1)} dBTP ceiling; lossy encoder overshoot likely.`;
    } else if (limiterEngaged) {
      status = 'warn';
      badge = 'CAUTION';
      codecRisk = 'Platform Limiter Active';
      summary = `Positive gain (+${round1(gainDb)} dB) engages ${platform.name}'s -1 dB limiter (+${round1(rawPostNormTP - platform.ceilingDbtp)} dB into ceiling).`;
    } else if (platform.id === 'spotify' && safeLufs > -11.0 && safeTP > platform.loudCeilingDbtp) {
      status = 'warn';
      badge = 'CAUTION';
      codecRisk = 'Moderate (Hot Master)';
      summary = 'Spotify recommends -2.0 dBTP ceiling for hot masters (> -11 LUFS) to prevent Ogg Vorbis overs.';
    } else if (gainDb <= -6.0) {
      status = 'warn';
      badge = 'CAUTION';
      codecRisk = 'Low (Heavy Turn-Down)';
      summary = `Turned down ${Math.abs(round1(gainDb)).toFixed(1)} dB on playback — check dynamics vs a less limited master.`;
    } else if (!platform.canBoost && rawDeltaDb > 3.0) {
      status = 'warn';
      badge = 'CAUTION';
      codecRisk = 'Low (Under-Level)';
      summary = `${platform.name} does not boost quiet tracks — plays ${round1(rawDeltaDb).toFixed(1)} LU below ${platform.targetLufs} LUFS reference.`;
    } else if (headroomCapped) {
      status = 'pass';
      badge = 'PASS';
      codecRisk = 'Low (Headroom-Capped)';
      summary = `Boosted +${round1(gainDb).toFixed(1)} dB up to -1.0 dBTP ceiling without limiting.`;
    } else {
      status = 'pass';
      badge = 'PASS';
      codecRisk = 'Low';
      summary = gainDb < -0.1
        ? `Clean attenuation (${round1(gainDb).toFixed(1)} dB) with safe codec headroom.`
        : gainDb > 0.1
          ? `Clean boost (+${round1(gainDb).toFixed(1)} dB) within ${platform.ceilingDbtp.toFixed(1)} dBTP ceiling.`
          : 'Matches target loudness with clean codec headroom.';
    }

    const roundedGain = round1(gainDb);
    let plainAction = 'No volume change';
    if (roundedGain < 0) {
      plainAction = `Turned down ${Math.abs(roundedGain).toFixed(1)} dB`;
    } else if (roundedGain > 0) {
      plainAction = `Boosted +${roundedGain.toFixed(1)} dB`;
    }

    let plainStatus = 'Safe to upload';
    if (safeTP > 0.0 || safeTP > platform.ceilingDbtp) {
      plainStatus = 'May crackle — lower peak ceiling to -1.0 dB';
    } else if (limiterEngaged) {
      plainStatus = `${platform.name} limiter kicks in — may sound squashed`;
    } else if (platform.id === 'spotify' && safeLufs > -11.0 && safeTP > platform.loudCeilingDbtp) {
      plainStatus = 'Very loud song — -2.0 dB ceiling is safer here';
    } else if (gainDb <= -6.0) {
      plainStatus = 'Turned down heavily — compare punch on the A/B player';
    } else if (!platform.canBoost && rawDeltaDb > 3.0) {
      plainStatus = 'Will sound quieter than expected';
    } else if (headroomCapped) {
      plainStatus = 'Boosted safely up to ceiling';
    }

    return {
      id: platform.id,
      name: platform.name,
      shortLabel: platform.shortLabel,
      targetLufs: platform.targetLufs,
      ceilingDbtp: platform.ceilingDbtp,
      gainDb: roundedGain,
      gainLinear: Math.pow(10, gainDb / 20),
      postNormLufs: round1(postNormLufs),
      postNormTruePeakDb: round2(postNormTruePeakDb),
      rawPostNormTruePeakDb: round2(rawPostNormTP),
      limiterEngaged,
      headroomCapped,
      status,
      badge,
      codecRisk,
      summary,
      plainAction,
      plainStatus,
      note: platform.note,
    };
  });
}

/* --------------------------------------------------------------------------
 * Pre-Flight Engineering Verdict Checklist + Plain-English DAW Fix Steps
 * -------------------------------------------------------------------------- */

export function buildPreFlightChecklist(report) {
  const { loudness, truePeak, integrity, stereo, durationSec, psrDb } = report;
  const checks = [];

  // 1. True Peak Ceiling
  if (truePeak.truePeakDb > 0.0) {
    checks.push({
      id: 'true-peak',
      label: 'True Peak Ceiling',
      status: 'fail',
      badge: 'FAIL',
      value: `${truePeak.truePeakDb.toFixed(2)} dBTP`,
      detail: `${truePeak.ispCount.toLocaleString()} inter-sample peak instant(s) exceed 0.0 dBTP. Lower limiter ceiling to -1.0 dBTP (or -2.0 dBTP for hot masters).`,
      plainTitle: 'Peaks are too loud — will distort on Spotify & Apple Music',
      whatsWrong: 'Your audio peaks go past 0 dB between digital samples, so streaming apps will add harsh crackling when converting your song for playback.',
      fixSteps: [
        'Open the limiter on your master track (e.g. Logic Adaptive Limiter, FabFilter Pro-L, Ozone, or Fruity Limiter).',
        'Turn ON True Peak Limiting and set the Output Ceiling to -1.0 dB (use -1.5 dB or -2.0 dB if your song is very loud).',
        'Re-export your WAV file and drop it back in here to confirm it passes.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: Math.max(0, truePeak.truePeakTimeSec - 1.0),
        label: `Jump to ${formatTime(truePeak.truePeakTimeSec)} & Hear`,
        monitorMode: 'stereo',
      },
    });
  } else if (truePeak.truePeakDb > -1.0) {
    checks.push({
      id: 'true-peak',
      label: 'True Peak Ceiling',
      status: 'warn',
      badge: 'WARN',
      value: `${truePeak.truePeakDb.toFixed(2)} dBTP`,
      detail: `Exceeds the -1.0 dBTP streaming ceiling (${truePeak.ceilingBreachCount.toLocaleString()} breach instants). Lossy codecs (AAC/Vorbis) may clip on transcode.`,
      plainTitle: 'Peaks are slightly too close to the ceiling',
      whatsWrong: 'Your loudest peaks sit above -1.0 dB, leaving almost no safety room when Spotify or Apple Music compress your song for streaming.',
      fixSteps: [
        'Open the limiter on your master track (e.g. Logic Adaptive Limiter, FabFilter Pro-L, Ozone, or Fruity Limiter).',
        'Turn ON True Peak Limiting and set the Output Ceiling to -1.0 dB (use -1.5 dB or -2.0 dB if your song is very loud).',
        'Re-export your WAV file and drop it back in here to confirm it passes.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: Math.max(0, truePeak.truePeakTimeSec - 1.0),
        label: `Jump to ${formatTime(truePeak.truePeakTimeSec)} & Hear`,
        monitorMode: 'stereo',
      },
    });
  } else if (loudness.integratedLufs > -11.0 && truePeak.truePeakDb > -2.0) {
    checks.push({
      id: 'true-peak',
      label: 'True Peak Ceiling',
      status: 'warn',
      badge: 'WARN',
      value: `${truePeak.truePeakDb.toFixed(2)} dBTP`,
      detail: 'Clears -1.0 dBTP, but hot masters (> -11 LUFS) benefit from -2.0 dBTP headroom for Spotify Ogg Vorbis transcoding.',
      plainTitle: 'Peaks are slightly too close to the ceiling',
      whatsWrong: 'Your song is very loud (above -11 LUFS). Spotify recommends a -2.0 dB peak ceiling on loud releases so big hits stay crisp after streaming compression.',
      fixSteps: [
        'Open the limiter on your master track and turn ON True Peak Limiting.',
        'Lower the Output Ceiling to -2.0 dB (or pull the limiter input back 1–2 dB).',
        'Re-export your WAV file and drop it back in here to confirm.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: Math.max(0, truePeak.truePeakTimeSec - 1.0),
        label: `Jump to ${formatTime(truePeak.truePeakTimeSec)} & Hear`,
        monitorMode: 'stereo',
      },
    });
  } else {
    checks.push({
      id: 'true-peak',
      label: 'True Peak Ceiling',
      status: 'pass',
      badge: 'PASS',
      value: `${truePeak.truePeakDb.toFixed(2)} dBTP`,
      detail: 'Clean true-peak headroom below -1.0 dBTP with zero inter-sample clipping.',
      plainTitle: 'Peak ceiling is clean and streaming-safe',
      whatsWrong: 'Your loudest peaks stay safely below -1.0 dB, so streaming apps can convert your song cleanly without distortion.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  // 2. Digital Clipping Bursts
  if (integrity.clipBurstCount > 0) {
    const worstAt = integrity.worstClipSec !== null ? ` Worst burst at ${formatTime(integrity.worstClipSec, true)}.` : '';
    const worstShort = integrity.worstClipSec !== null ? ` (worst at ${formatTime(integrity.worstClipSec)})` : '';
    checks.push({
      id: 'clipping',
      label: 'Digital Clipping',
      status: 'fail',
      badge: 'FAIL',
      value: `${integrity.clipBurstCount} burst${integrity.clipBurstCount === 1 ? '' : 's'}`,
      detail: `${integrity.clippedSampleCount.toLocaleString()} sample(s) hit 0 dBFS with ${integrity.clipBurstCount} hard clip run(s) ≥ 3 samples.${worstAt}`,
      plainTitle: 'Audible clipping (distortion) found in your file',
      whatsWrong: `We found ${integrity.clipBurstCount} hard clip burst${integrity.clipBurstCount === 1 ? '' : 's'} where the audio flattens out at 0 dB${worstShort}. Listeners hear this as harsh digital crunch.`,
      fixSteps: [
        'Open the limiter on your master track (e.g. Logic Adaptive Limiter, FabFilter Pro-L, Ozone, or Fruity Limiter).',
        'Turn ON True Peak Limiting, set the Output Ceiling to -1.0 dB, and turn down any red-clipping tracks hitting your master bus.',
        'Re-export your WAV file and drop it back in here to confirm it reaches 0 clips.',
      ],
      jumpTarget: integrity.worstClipSec !== null
        ? {
            type: 'clip',
            timeSec: Math.max(0, integrity.worstClipSec - 1.0),
            label: `Jump to ${formatTime(integrity.worstClipSec)} & Hear`,
            monitorMode: 'stereo',
          }
        : null,
    });
  } else if (integrity.clippedSampleCount > 0) {
    checks.push({
      id: 'clipping',
      label: 'Digital Clipping',
      status: 'warn',
      badge: 'WARN',
      value: `${integrity.clippedSampleCount} sample${integrity.clippedSampleCount === 1 ? '' : 's'}`,
      detail: 'Isolated single/double samples touch 0.0 dBFS without hard clip bursts. Pull output trim down 0.5–1.0 dB.',
      plainTitle: 'A few tiny peaks hit 0 dB',
      whatsWrong: 'A handful of single samples touch maximum volume (0 dB). Usually hard to hear, but pulling your ceiling down 1.0 dB prevents streaming encoders from crackling.',
      fixSteps: [
        'Open the limiter on your master track and turn ON True Peak Limiting.',
        'Set the Output Ceiling to -1.0 dB and re-export your WAV file.',
      ],
      jumpTarget: {
        type: 'clip',
        timeSec: Math.max(0, truePeak.truePeakTimeSec - 1.0),
        label: `Jump to ${formatTime(truePeak.truePeakTimeSec)} & Hear`,
        monitorMode: 'stereo',
      },
    });
  } else {
    checks.push({
      id: 'clipping',
      label: 'Digital Clipping',
      status: 'pass',
      badge: 'PASS',
      value: '0 clips',
      detail: 'Zero samples reaching full scale (≥ 0.9999) across all channels.',
      plainTitle: 'Zero digital clipping',
      whatsWrong: 'No samples slam into 0 dB anywhere in your song — completely clean waveform.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  // 3. Loudness & Dynamic Range
  if (loudness.integratedLufs > -7.0 || (psrDb < 5.5 && loudness.integratedLufs > -24)) {
    checks.push({
      id: 'dynamics',
      label: 'Loudness & Dynamics',
      status: 'warn',
      badge: 'WARN',
      value: `${loudness.integratedLufs.toFixed(1)} LUFS · PSR ${psrDb.toFixed(1)} dB`,
      detail: `Heavily limited master (LRA ${loudness.lraLu.toFixed(1)} LU). Streaming platforms will turn this down significantly without restoring transient punch.`,
      plainTitle: 'Your master is squashed very loud (losing punch)',
      whatsWrong: 'Your song is pushed very hard into a limiter. Streaming apps will turn it down anyway, which can make squashed drums sound smaller than a more dynamic master.',
      fixSteps: [
        'Pull the input gain / threshold on your master limiter back by 1.5–3 dB so drums can breathe again.',
        'Use the A/B player below to hear Spotify turn your song down — backing off the limiter often sounds punchier after normalization.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: loudness.loudestMomentSec,
        label: `Hear Loudest Part (${formatTime(loudness.loudestMomentSec)})`,
        monitorMode: 'stereo',
      },
    });
  } else if (loudness.integratedLufs < -20.0) {
    checks.push({
      id: 'dynamics',
      label: 'Loudness & Dynamics',
      status: 'warn',
      badge: 'WARN',
      value: `${loudness.integratedLufs.toFixed(1)} LUFS · LRA ${loudness.lraLu.toFixed(1)} LU`,
      detail: 'Noticeably quieter than -14 LUFS streaming targets; YouTube and TikTok will not boost it up.',
      plainTitle: 'Your song is noticeably quieter than most releases',
      whatsWrong: 'Your track averages much quieter than standard streaming levels. YouTube and TikTok never turn quiet songs up, so listeners will have to reach for their volume knob.',
      fixSteps: [
        'Add gentle limiting on your master bus until your chorus averages around -14 to -9 LUFS.',
        'Keep your Output Ceiling at -1.0 dB so it stays clean without clipping.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: loudness.loudestMomentSec,
        label: 'Hear on Streaming A/B',
        monitorMode: 'stereo',
      },
    });
  } else if (durationSec >= 8 && loudness.lraLu < 2.2) {
    checks.push({
      id: 'dynamics',
      label: 'Loudness & Dynamics',
      status: 'warn',
      badge: 'WARN',
      value: `LRA ${loudness.lraLu.toFixed(1)} LU · PSR ${psrDb.toFixed(1)} dB`,
      detail: 'Very flat macro-dynamic range (< 2.2 LU). Confirm verse/chorus contrast is intentional.',
      plainTitle: 'Volume stays very flat from start to finish',
      whatsWrong: 'Your verses and choruses stay at almost the exact same loudness. If you want your chorus to feel bigger, a little extra contrast helps.',
      fixSteps: [
        'Automate your chorus 0.5–1.5 dB louder than your verses, or ease off heavy master-bus compression.',
        'If a constant, steady volume is intentional for your style, you can safely skip this tip.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: loudness.loudestMomentSec,
        label: `Hear Loudest Part (${formatTime(loudness.loudestMomentSec)})`,
        monitorMode: 'stereo',
      },
    });
  } else {
    checks.push({
      id: 'dynamics',
      label: 'Loudness & Dynamics',
      status: 'pass',
      badge: 'PASS',
      value: `${loudness.integratedLufs.toFixed(1)} LUFS · LRA ${loudness.lraLu.toFixed(1)} LU`,
      detail: `Healthy dynamic profile (PSR ${psrDb.toFixed(1)} dB, Crest ${loudness.crestDb.toFixed(1)} dB).`,
      plainTitle: 'Good balance of loudness and punch',
      whatsWrong: 'Your loudness and dynamics sit in a sweet spot — competitive volume while keeping drums and transients punchy.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  // 4. Mono Fold-Down Compatibility
  if (stereo.isMono) {
    checks.push({
      id: 'mono',
      label: 'Mono Compatibility',
      status: 'pass',
      badge: 'PASS',
      value: 'Native Mono',
      detail: 'Single-channel mono audio translates identically on phones, club rigs, and smart speakers.',
      plainTitle: 'Sounds solid on phones, clubs & mono speakers',
      whatsWrong: 'Your song is native mono, so it plays back identically on phones, smart speakers, and club systems.',
      fixSteps: [],
      jumpTarget: null,
    });
  } else if (stereo.monoLossDb < -4.5) {
    checks.push({
      id: 'mono',
      label: 'Mono Compatibility',
      status: 'fail',
      badge: 'FAIL',
      value: `${stereo.monoLossDb.toFixed(1)} dB loss`,
      detail: `Severe energy cancellation when summed to mono (width ${stereo.stereoWidthPct.toFixed(0)}%). Audition in Mono [M] immediately.`,
      plainTitle: 'Parts of your song disappear on phone & mono speakers',
      whatsWrong: `When played on a phone speaker or club PA, your mix loses ${Math.abs(stereo.monoLossDb).toFixed(1)} dB of volume — key vocals, synths, or guitars can sound hollow or vanish.`,
      fixSteps: [
        'Click "Hear in Phone / Mono" below to hear which instrument or vocal drops in volume.',
        'Turn down stereo widener, chorus, or Haas-delay plugins on that track, or check if a phase/polarity button is flipped.',
        'Re-export and test in Mono again until your lead elements stay full and centered.',
      ],
      jumpTarget: {
        type: 'phase',
        timeSec: stereo.worstPhaseSec !== null ? stereo.worstPhaseSec : loudness.loudestMomentSec,
        label: 'Hear in Phone / Mono',
        monitorMode: 'mono',
      },
    });
  } else if (stereo.monoLossDb < -3.0) {
    checks.push({
      id: 'mono',
      label: 'Mono Compatibility',
      status: 'warn',
      badge: 'WARN',
      value: `${stereo.monoLossDb.toFixed(1)} dB loss`,
      detail: `Wide stereo image (${stereo.stereoWidthPct.toFixed(0)}% side ratio) loses noticeable energy in mono. Verify lead elements in Mono [M].`,
      plainTitle: 'Your stereo mix gets noticeably thinner in mono',
      whatsWrong: `Your mix is quite wide and drops ${Math.abs(stereo.monoLossDb).toFixed(1)} dB on mono speakers. Double-check that your vocal, snare, and main hook still cut through.`,
      fixSteps: [
        'Click "Hear in Phone / Mono" below to hear which instrument or vocal drops in volume.',
        'Turn down stereo widener, chorus, or Haas-delay plugins on any lead element that gets too quiet.',
      ],
      jumpTarget: {
        type: 'phase',
        timeSec: stereo.worstPhaseSec !== null ? stereo.worstPhaseSec : loudness.loudestMomentSec,
        label: 'Hear in Phone / Mono',
        monitorMode: 'mono',
      },
    });
  } else {
    checks.push({
      id: 'mono',
      label: 'Mono Compatibility',
      status: 'pass',
      badge: 'PASS',
      value: `${stereo.monoLossDb.toFixed(1)} dB fold`,
      detail: `Solid mono fold-down retention (width ${stereo.stereoWidthPct.toFixed(0)}%, L/R balance ${formatSignedDb(stereo.lrBalanceDb, 1)}).`,
      plainTitle: 'Sounds solid on phones, clubs & mono speakers',
      whatsWrong: 'Your stereo mix holds together cleanly when played through a phone speaker or mono club system.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  // 5. Stereo Phase Correlation
  if (stereo.isMono) {
    checks.push({
      id: 'phase',
      label: 'Stereo Phase Correlation',
      status: 'pass',
      badge: 'PASS',
      value: '+1.00',
      detail: 'Native mono track — zero inter-channel phase cancellation.',
      plainTitle: 'Clean stereo focus throughout the song',
      whatsWrong: 'Native mono audio has perfect phase alignment from start to finish.',
      fixSteps: [],
      jumpTarget: null,
    });
  } else if (stereo.globalCorrelation < 0.0) {
    checks.push({
      id: 'phase',
      label: 'Stereo Phase Correlation',
      status: 'fail',
      badge: 'FAIL',
      value: `r = ${stereo.globalCorrelation.toFixed(2)}`,
      detail: 'Track is globally out of phase (negative correlation). Check polarity inversion or stereo widener plugins.',
      plainTitle: 'Left and right speakers are fighting each other (out of phase)',
      whatsWrong: 'Your left and right channels cancel each other out across most of the song, causing a weird hollow sound on headphones and heavy volume loss in mono.',
      fixSteps: [
        'Click "Hear in Phone / Mono" below to hear the cancellation immediately.',
        'Check your tracks and master bus for a flipped phase/polarity button (Ø) or an over-pushed stereo widener plugin.',
        'Fix the polarity flip or reduce stereo widening, re-export, and re-check here.',
      ],
      jumpTarget: {
        type: 'phase',
        timeSec: stereo.worstPhaseSec !== null ? stereo.worstPhaseSec : 0,
        label: 'Hear in Phone / Mono',
        monitorMode: 'mono',
      },
    });
  } else if (stereo.minCorrelation < -0.25 || stereo.globalCorrelation < 0.25) {
    const atStr = stereo.worstPhaseSec !== null ? ` at ${formatTime(stereo.worstPhaseSec, true)}` : '';
    const atShort = stereo.worstPhaseSec !== null ? ` (especially around ${formatTime(stereo.worstPhaseSec)})` : '';
    checks.push({
      id: 'phase',
      label: 'Stereo Phase Correlation',
      status: 'warn',
      badge: 'WARN',
      value: `Avg ${stereo.globalCorrelation.toFixed(2)} · Min ${stereo.minCorrelation.toFixed(2)}`,
      detail: `Phase dips negative${atStr} (${stereo.negativePhasePct.toFixed(1)}% of active windows < 0). Audition that section in Mono [M].`,
      plainTitle: 'Some moments lose focus on mono speakers',
      whatsWrong: `During parts of your song${atShort}, the left and right speakers briefly cancel out. Worth a quick listen in Mono to be sure nothing important disappears.`,
      fixSteps: [
        'Click the button below to jump straight to that spot in Phone / Mono mode.',
        'Turn down stereo widener, chorus, or Haas-delay plugins on any instrument that vanishes there.',
      ],
      jumpTarget: {
        type: 'phase',
        timeSec: stereo.worstPhaseSec !== null ? stereo.worstPhaseSec : loudness.loudestMomentSec,
        label: stereo.worstPhaseSec !== null
          ? `Jump to ${formatTime(stereo.worstPhaseSec)} in Mono`
          : 'Hear in Phone / Mono',
        monitorMode: 'mono',
      },
    });
  } else {
    checks.push({
      id: 'phase',
      label: 'Stereo Phase Correlation',
      status: 'pass',
      badge: 'PASS',
      value: `Avg +${stereo.globalCorrelation.toFixed(2)} · Min ${stereo.minCorrelation >= 0 ? '+' : ''}${stereo.minCorrelation.toFixed(2)}`,
      detail: 'Coherent stereo phase across the entire program.',
      plainTitle: 'Clean stereo focus throughout the song',
      whatsWrong: 'Left and right channels stay nicely aligned from start to finish without fighting each other.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  // 6. Low-End (< 120 Hz) Phase
  if (stereo.isMono) {
    checks.push({
      id: 'low-end-phase',
      label: 'Low-End (<120 Hz) Phase',
      status: 'pass',
      badge: 'PASS',
      value: '+1.00',
      detail: 'Sub-120 Hz content is strictly mono.',
      plainTitle: 'Tight, centered bass that hits in mono',
      whatsWrong: 'Your low end is strictly centered so your kick and bass hit with full weight on every speaker.',
      fixSteps: [],
      jumpTarget: null,
    });
  } else if (!stereo.lowEndHasContent) {
    checks.push({
      id: 'low-end-phase',
      label: 'Low-End (<120 Hz) Phase',
      status: 'pass',
      badge: 'PASS',
      value: 'Minimal Sub',
      detail: 'Very little energy below 120 Hz — no sub-bass phase issues.',
      plainTitle: 'Tight, centered bass that hits in mono',
      whatsWrong: 'Very little sub-bass below 120 Hz, so there are zero low-end phase issues.',
      fixSteps: [],
      jumpTarget: null,
    });
  } else if (stereo.lowEndCorrelation < 0.3) {
    checks.push({
      id: 'low-end-phase',
      label: 'Low-End (<120 Hz) Phase',
      status: 'fail',
      badge: 'FAIL',
      value: `r = ${stereo.lowEndCorrelation.toFixed(2)}`,
      detail: 'Sub-bass (< 120 Hz) has heavy stereo phase cancellation. Mono-sum frequencies below 100–120 Hz.',
      plainTitle: 'Your bass / 808 will vanish on club & mono speakers',
      whatsWrong: 'Your deep bass (below 120 Hz) is out of phase between left and right. On club speakers, phones, or vinyl, the low end cancels out and sounds thin.',
      fixSteps: [
        'Put an EQ or Mid/Side utility on your bass/808 track (or master bus).',
        'Make everything below 120 Hz mono (cut the Side channel below 120 Hz).',
        'Check again in Mono — your kick and 808 should feel noticeably heavier.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: loudness.loudestMomentSec,
        label: 'Hear Bass in Mono',
        monitorMode: 'mono',
      },
    });
  } else if (stereo.lowEndCorrelation < 0.7) {
    checks.push({
      id: 'low-end-phase',
      label: 'Low-End (<120 Hz) Phase',
      status: 'warn',
      badge: 'WARN',
      value: `r = ${stereo.lowEndCorrelation.toFixed(2)}`,
      detail: 'Noticeable stereo width below 120 Hz. Check kick and sub-bass punch on mono club systems or vinyl.',
      plainTitle: 'Your bass is a bit wide for mono club systems',
      whatsWrong: 'Your sub-bass below 120 Hz has extra stereo width, which can rob your kick and 808 of punch on mono club rigs or phones.',
      fixSteps: [
        'Put an EQ or Mid/Side utility on your bass/808 track (or master bus).',
        'Make everything below 120 Hz mono (cut the Side channel below 120 Hz).',
        'Check again in Mono — your kick and 808 should feel noticeably heavier.',
      ],
      jumpTarget: {
        type: 'loudest',
        timeSec: loudness.loudestMomentSec,
        label: 'Hear Bass in Mono',
        monitorMode: 'mono',
      },
    });
  } else {
    checks.push({
      id: 'low-end-phase',
      label: 'Low-End (<120 Hz) Phase',
      status: 'pass',
      badge: 'PASS',
      value: `r = +${stereo.lowEndCorrelation.toFixed(2)}`,
      detail: 'Focused, phase-coherent low end below 120 Hz.',
      plainTitle: 'Tight, centered bass that hits in mono',
      whatsWrong: 'Your kick, bass, and 808 below 120 Hz stay tightly centered so they hit hard on every speaker.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  // 7. DC Offset & Head/Tail Trim
  if (integrity.dcOffsetMax > 0.01) {
    checks.push({
      id: 'dc-trim',
      label: 'DC Offset & Trim',
      status: 'fail',
      badge: 'FAIL',
      value: `DC ${integrity.dcOffsetPct.toFixed(2)}%`,
      detail: `Significant DC bias (${integrity.dcOffsetDb} dBFS) wastes headroom and causes edit clicks. Insert a 20–30 Hz high-pass filter.`,
      plainTitle: 'Invisible speaker offset (DC offset) wasting headroom',
      whatsWrong: 'Your audio waveform sits shifted off-center, which quietly eats up loudness headroom and can cause clicks at the start or end of playback.',
      fixSteps: [
        'Insert a high-pass filter set to 20–30 Hz at the start of your master chain (or enable your DAW’s DC Offset Removal).',
        'Re-export your master and drop it back in here to confirm.',
      ],
      jumpTarget: {
        type: 'intro',
        timeSec: 0,
        label: 'Hear Start (0:00)',
        monitorMode: 'stereo',
      },
    });
  } else if (integrity.dcOffsetMax > 0.005) {
    checks.push({
      id: 'dc-trim',
      label: 'DC Offset & Trim',
      status: 'warn',
      badge: 'WARN',
      value: `DC ${integrity.dcOffsetPct.toFixed(2)}%`,
      detail: 'Minor DC offset present. Consider a gentle sub-sonic DC blocker before final print.',
      plainTitle: 'Invisible speaker offset (DC offset) wasting headroom',
      whatsWrong: 'There is a small electrical shift (DC offset) in the waveform. Filtering it out keeps transitions click-free and frees up clean headroom.',
      fixSteps: [
        'Insert a high-pass filter set to 20–30 Hz at the start of your master chain (or enable your DAW’s DC Offset Removal).',
        'Re-export your master.',
      ],
      jumpTarget: {
        type: 'intro',
        timeSec: 0,
        label: 'Hear Start (0:00)',
        monitorMode: 'stereo',
      },
    });
  } else if (integrity.headHardStart || integrity.tailHardEnd) {
    checks.push({
      id: 'dc-trim',
      label: 'DC Offset & Trim',
      status: 'warn',
      badge: 'WARN',
      value: `Head ${integrity.headSilenceSec.toFixed(2)}s · Tail ${integrity.tailSilenceSec.toFixed(2)}s`,
      detail: 'Non-zero transient right at the file boundary — add a brief 5–20 ms fade to prevent playback clicks.',
      plainTitle: 'Abrupt cut at the very start or end (can click)',
      whatsWrong: 'Your song starts or cuts off right on a loud sample, which can cause an audible pop when a playlist moves to or from your track.',
      fixSteps: [
        'Zoom in on the very start and end of your song in your DAW.',
        'Add a tiny 5–20 ms fade-in at 0:00 and a short fade-out at the end so it never pops between playlist tracks.',
      ],
      jumpTarget: {
        type: 'intro',
        timeSec: 0,
        label: 'Hear Start (0:00)',
        monitorMode: 'stereo',
      },
    });
  } else if (integrity.headSilenceSec > 2.5 || integrity.tailSilenceSec > 6.0) {
    checks.push({
      id: 'dc-trim',
      label: 'DC Offset & Trim',
      status: 'warn',
      badge: 'WARN',
      value: `Head ${integrity.headSilenceSec.toFixed(2)}s · Tail ${integrity.tailSilenceSec.toFixed(2)}s`,
      detail: 'Extended silence padding at head or tail — verify intentional release spacing.',
      plainTitle: 'Long silent gap at the start or end',
      whatsWrong: `There is ${integrity.headSilenceSec.toFixed(1)} s of silence at the start and ${integrity.tailSilenceSec.toFixed(1)} s at the end. Long empty gaps can make listeners think playback stalled.`,
      fixSteps: [
        'Trim extra silence before the first beat to under 0.2–0.5 seconds.',
        'Trim trailing silence to 1–3 seconds after the final reverb tail fades out.',
      ],
      jumpTarget: {
        type: 'intro',
        timeSec: 0,
        label: 'Hear Start (0:00)',
        monitorMode: 'stereo',
      },
    });
  } else {
    checks.push({
      id: 'dc-trim',
      label: 'DC Offset & Trim',
      status: 'pass',
      badge: 'PASS',
      value: `DC ${integrity.dcOffsetPct.toFixed(2)}% · ${integrity.headSilenceSec.toFixed(2)}s / ${integrity.tailSilenceSec.toFixed(2)}s`,
      detail: 'Negligible DC offset with clean head and tail silence trim.',
      plainTitle: 'Clean start, clean ending, zero offset',
      whatsWrong: 'Your song starts and ends cleanly with zero electrical offset and tidy spacing.',
      fixSteps: [],
      jumpTarget: null,
    });
  }

  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const passCount = checks.filter((c) => c.status === 'pass').length;

  let overallStatus = 'pass';
  let overallHeadline = 'Cleared for Release';
  let overallStamp = 'CLEARED FOR RELEASE';
  let overallSubtitle = 'All broadcast loudness, true-peak ceiling, mono fold-down, and phase checks passed cleanly.';
  let plainHeadline = 'Ready to Upload.';
  let plainSubtitle = 'Every check passed — your song is clean, balanced, and ready for Spotify, Apple Music, YouTube, and TikTok.';

  if (failCount > 0) {
    overallStatus = 'fail';
    overallHeadline = 'Hold for Revision.';
    overallStamp = 'HOLD · ISSUES DETECTED';
    overallSubtitle = `${failCount} critical engineering flag${failCount === 1 ? '' : 's'} detected — review before uploading to distributors.`;
    plainHeadline = failCount === 1
      ? 'Fix 1 Thing Before Uploading.'
      : `Fix ${failCount} Things Before Uploading.`;
    plainSubtitle = `We caught ${failCount} issue${failCount === 1 ? '' : 's'} that could hurt how your song sounds on streaming${warnCount > 0 ? ` (plus ${warnCount} quick tip${warnCount === 1 ? '' : 's'})` : ''}. Follow the exact DAW steps below.`;
  } else if (warnCount > 0) {
    overallStatus = 'warn';
    overallHeadline = 'Cleared with Notes.';
    overallStamp = 'CLEARED WITH NOTES';
    overallSubtitle = `No hard blockers, but ${warnCount} advisory flag${warnCount === 1 ? '' : 's'} worth auditioning on the deck below.`;
    plainHeadline = 'Almost Ready — Quick Tips.';
    plainSubtitle = `No dealbreakers — your song is safe to upload, with ${warnCount} quick tip${warnCount === 1 ? '' : 's'} below to make it sound even cleaner.`;
  }

  return {
    overallStatus,
    overallHeadline,
    overallStamp,
    overallSubtitle,
    plainHeadline,
    plainSubtitle,
    passCount,
    warnCount,
    failCount,
    checks,
  };
}

/* --------------------------------------------------------------------------
 * Waveform Envelope (Symmetric Min/Max Peaks)
 * -------------------------------------------------------------------------- */

export function computeWaveformPeaks(channelDataList, numBins = 260) {
  const peaks = new Array(numBins).fill(0);
  if (!channelDataList || channelDataList.length === 0 || channelDataList[0].length === 0) {
    return peaks;
  }

  const totalSamples = channelDataList[0].length;
  const samplesPerBin = Math.max(1, Math.floor(totalSamples / numBins));
  const numCh = channelDataList.length;
  let globalMax = 0;

  for (let b = 0; b < numBins; b++) {
    const start = Math.floor((b * totalSamples) / numBins);
    const end = Math.min(totalSamples, start + samplesPerBin);
    const stride = Math.max(1, Math.floor((end - start) / 160));
    let binPeak = 0;
    for (let c = 0; c < numCh; c++) {
      const ch = channelDataList[c];
      for (let i = start; i < end; i += stride) {
        const v = Math.abs(ch[i]);
        if (v > binPeak) binPeak = v;
      }
    }
    peaks[b] = binPeak;
    if (binPeak > globalMax) globalMax = binPeak;
  }

  const norm = globalMax > 1e-6 ? globalMax : 1;
  return peaks.map((p) => Number((p / norm).toFixed(3)));
}

/* --------------------------------------------------------------------------
 * Master Orchestrator: Full Pre-Flight Report
 * -------------------------------------------------------------------------- */

/**
 * Run the complete Pre-Flight DSP suite synchronously on raw channel Float32Arrays.
 * (Zero DOM dependencies; callable directly from Node tests or chunked async UI.)
 */
export function runPreFlightAnalysis(channelDataList, sampleRate = 48000, meta = {}) {
  const length = channelDataList && channelDataList[0] ? channelDataList[0].length : 0;
  const numChannels = channelDataList ? channelDataList.length : 0;
  const durationSec = length / Math.max(1, sampleRate);

  const loudness = analyzeBroadcastLoudness(channelDataList, sampleRate);
  const truePeak = analyzeTruePeak(channelDataList, sampleRate);
  const integrity = analyzeIntegrity(channelDataList, sampleRate);
  const stereo = analyzeStereoPhase(channelDataList, sampleRate);
  const waveformPeaks = computeWaveformPeaks(channelDataList, 280);

  // Peak-to-Short-Term Loudness Ratio (PSR) & Peak-to-Integrated Loudness Ratio (PLR)
  const psrDb = loudness.shortTermMaxLufs > -110 && truePeak.truePeakDb > -110
    ? round1(Math.max(0, truePeak.truePeakDb - loudness.shortTermMaxLufs))
    : 0;
  const plrDb = loudness.integratedLufs > -110 && truePeak.truePeakDb > -110
    ? round1(Math.max(0, truePeak.truePeakDb - loudness.integratedLufs))
    : 0;

  const platforms = computePlatformNormalization(loudness.integratedLufs, truePeak.truePeakDb);

  const report = {
    meta: {
      filename: meta.filename || 'Untitled Master',
      fileSizeBytes: meta.fileSizeBytes || 0,
      formatLabel: meta.formatLabel || '',
      sampleRate,
      numChannels,
      channelLabel: numChannels === 1 ? 'Mono' : numChannels === 2 ? 'Stereo' : `${numChannels}ch`,
      durationSec: round2(durationSec),
      analyzedAt: meta.analyzedAt || new Date().toISOString(),
    },
    durationSec: round2(durationSec),
    loudness,
    truePeak,
    integrity,
    stereo,
    psrDb,
    plrDb,
    platforms,
    waveformPeaks,
  };

  report.verdict = buildPreFlightChecklist(report);
  return report;
}

/* --------------------------------------------------------------------------
 * Markdown Engineering Certificate Generator
 * -------------------------------------------------------------------------- */

export function generatePreFlightMarkdown(report) {
  const { meta, loudness, truePeak, integrity, stereo, psrDb, plrDb, platforms, verdict } = report;
  const lines = [];
  const issues = [
    ...verdict.checks.filter((c) => c.status === 'fail'),
    ...verdict.checks.filter((c) => c.status === 'warn'),
  ];

  lines.push(`# Pre-Flight Report — ${meta.filename}`);
  lines.push('');
  lines.push(`> **Verdict:** **${verdict.plainHeadline}** (${verdict.overallStamp}) — ${verdict.plainSubtitle}`);
  lines.push(`> Generated by **Pre-Flight (TOOL / 002)** · [Saint Gordon Collective](https://saintgordon.github.io/pre-flight/) · ${meta.analyzedAt}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Fix Steps (Plain English)');
  lines.push('');

  if (issues.length === 0) {
    lines.push('All 7 checks passed — your master is clean and ready to upload to Spotify, Apple Music, YouTube, and TikTok.');
    lines.push('');
  } else {
    issues.forEach((item, idx) => {
      const tag = item.status === 'fail' ? 'MUST FIX' : 'QUICK TIP';
      lines.push(`### Step ${idx + 1} (${tag}) — ${item.plainTitle} \`${item.value}\``);
      lines.push('');
      lines.push(`**What's happening:** ${item.whatsWrong}`);
      lines.push('');
      if (item.fixSteps && item.fixSteps.length > 0) {
        lines.push('**How to fix it:**');
        item.fixSteps.forEach((step, sIdx) => {
          lines.push(`${sIdx + 1}. ${step}`);
        });
        lines.push('');
      }
    });
  }

  lines.push('## How Streaming Apps Will Play Your Song');
  lines.push('');
  lines.push('| Platform | Volume Change | Target | Plays At | Post-Norm Peak | Verdict |');
  lines.push('|---|---|---|---|---|---|');
  for (const p of platforms) {
    lines.push(
      `| **${p.name}** | ${p.plainAction} (${formatSignedDb(p.gainDb, 1)}) | ${p.targetLufs.toFixed(1)} LUFS | ${p.postNormLufs.toFixed(1)} LUFS | ${p.postNormTruePeakDb.toFixed(2)} dBTP | **${p.badge}** — ${p.plainStatus} |`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## File Specifications');
  lines.push('');
  lines.push(`- **File:** \`${meta.filename}\``);
  lines.push(`- **Format:** ${meta.formatLabel || 'Audio'} · ${(meta.sampleRate / 1000).toFixed(1)} kHz · ${meta.channelLabel}`);
  lines.push(`- **Duration:** ${formatTime(meta.durationSec, true)}`);
  lines.push('');
  lines.push('## Full Technical Numbers (Broadcast & Mastering)');
  lines.push('');
  lines.push('| Metric | Measurement | Standard |');
  lines.push('|---|---|---|');
  lines.push(`| **Integrated Loudness** | **${loudness.integratedLufs.toFixed(1)} LUFS** | ITU-R BS.1770-4 |`);
  lines.push(`| **True Peak (4× Oversampled)** | **${truePeak.truePeakDb.toFixed(2)} dBTP** | ITU-R BS.1770-4 Annex 2 |`);
  lines.push(`| **Sample Peak** | ${loudness.samplePeakDb.toFixed(2)} dBFS | Digital Full Scale |`);
  lines.push(`| **Short-Term Max (3 s)** | ${loudness.shortTermMaxLufs.toFixed(1)} LUFS | EBU R128 |`);
  lines.push(`| **Momentary Max (400 ms)** | ${loudness.momentaryMaxLufs.toFixed(1)} LUFS | EBU R128 |`);
  lines.push(`| **Loudness Range (LRA)** | ${loudness.lraLu.toFixed(1)} LU | EBU Tech 3342 |`);
  lines.push(`| **PSR (Peak to Short-Term)** | ${psrDb.toFixed(1)} dB | Dynamic Density |`);
  lines.push(`| **PLR (Peak to Integrated)** | ${plrDb.toFixed(1)} dB | Macro Headroom |`);
  lines.push(`| **RMS / Crest Factor** | ${loudness.rmsDb.toFixed(1)} dBFS / ${loudness.crestDb.toFixed(1)} dB | Unweighted |`);
  lines.push(`| **Inter-Sample Peaks (> 0 dBTP)** | ${truePeak.ispCount.toLocaleString()} | 4× Sinc Oversampled |`);
  lines.push(`| **Ceiling Breaches (> -1 dBTP)** | ${truePeak.ceilingBreachCount.toLocaleString()} | Streaming Ceiling |`);
  lines.push(`| **Clipped Samples / Hard Bursts** | ${integrity.clippedSampleCount.toLocaleString()} / ${integrity.clipBurstCount} | ≥ 3 Consecutive @ 0 dBFS |`);
  lines.push('');
  lines.push('## Mono Compatibility & Stereo Phase');
  lines.push('');
  lines.push(`- **Global Phase Correlation:** ${stereo.globalCorrelation >= 0 ? '+' : ''}${stereo.globalCorrelation.toFixed(2)}`);
  lines.push(`- **Minimum Windowed Correlation (500 ms):** ${stereo.minCorrelation >= 0 ? '+' : ''}${stereo.minCorrelation.toFixed(2)}${stereo.worstPhaseSec !== null ? ` (at ${formatTime(stereo.worstPhaseSec, true)})` : ''}`);
  lines.push(`- **Low-End (< 120 Hz) Correlation:** ${stereo.lowEndHasContent ? `${stereo.lowEndCorrelation >= 0 ? '+' : ''}${stereo.lowEndCorrelation.toFixed(2)}` : 'Minimal sub-120 Hz energy'}`);
  lines.push(`- **Mono Fold-Down Retention:** ${stereo.monoLossDb.toFixed(2)} dB (Mono Peak: ${stereo.monoPeakDb.toFixed(2)} dBFS)`);
  lines.push(`- **Stereo Width / L-R Balance:** ${stereo.stereoWidthPct.toFixed(1)}% / ${formatSignedDb(stereo.lrBalanceDb, 2)}`);
  lines.push(`- **DC Offset / Silence Trim:** ${integrity.dcOffsetPct.toFixed(2)}% / Head ${integrity.headSilenceSec.toFixed(2)}s · Tail ${integrity.tailSilenceSec.toFixed(2)}s`);
  lines.push('');
  lines.push('## Pre-Flight Checklist');
  lines.push('');
  for (const c of verdict.checks) {
    lines.push(`- **[${c.badge}] ${c.plainTitle}** (${c.value}) — ${c.whatsWrong}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('*Checked with [Pre-Flight](https://saintgordon.github.io/pre-flight/) · Saint Gordon Collective · Independent sound. Imperfect by design.*');

  return lines.join('\n');
}

export function generateCompactSummary(report) {
  const { meta, loudness, truePeak, integrity, stereo, psrDb, platforms, verdict } = report;
  const platStr = platforms.map((p) => `${p.name}: ${p.plainAction} [${p.badge}]`).join(' · ');
  const issues = [
    ...verdict.checks.filter((c) => c.status === 'fail'),
    ...verdict.checks.filter((c) => c.status === 'warn'),
  ];

  const out = [
    `PRE-FLIGHT — ${verdict.plainHeadline} (${meta.filename})`,
    `Loudness: ${loudness.integratedLufs.toFixed(1)} LUFS | True Peak: ${truePeak.truePeakDb.toFixed(2)} dBTP | Clips: ${integrity.clipBurstCount} bursts (${integrity.clippedSampleCount} smp) | Mono fold: ${stereo.monoLossDb.toFixed(1)} dB`,
    `Streaming: ${platStr}`,
  ];

  if (issues.length === 0) {
    out.push('Fix Checklist: All 7 checks passed — ready to upload.');
  } else {
    out.push('Fix Checklist:');
    issues.forEach((item, idx) => {
      const tag = item.status === 'fail' ? 'MUST FIX' : 'TIP';
      out.push(`${idx + 1}. [${tag}] ${item.plainTitle} (${item.value})`);
      if (item.fixSteps && item.fixSteps.length > 0) {
        out.push(`   -> ${item.fixSteps[0]}`);
      }
    });
  }

  out.push(`Tech: LRA ${loudness.lraLu.toFixed(1)} LU | PSR ${psrDb.toFixed(1)} dB | Phase ${stereo.globalCorrelation >= 0 ? '+' : ''}${stereo.globalCorrelation.toFixed(2)} (<120Hz ${stereo.lowEndCorrelation.toFixed(2)})`);
  out.push('Checked at https://saintgordon.github.io/pre-flight/');
  return out.join('\n');
}

// Backward-compatible named aliases
export {
  analyzeBroadcastLoudness as analyzeLoudness,
  computePlatformNormalization as evaluateStreamingPlatforms,
  generatePreFlightMarkdown as buildMarkdownReport,
  generateCompactSummary as buildCompactSummary,
};
