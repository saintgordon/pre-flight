/**
 * Pre-Flight (TOOL / 002) — Studio-Grade Web Audio A/B Normalised Audition Engine.
 *
 * Features:
 * - Cross-browser decodeAudioDataSafe (Promise + legacy callback form + webkitAudioContext)
 * - Sample-phase-locked single-source parallel A (Original 0.0 dB) / B (Platform Normalised)
 *   with 8 ms clickless linear crossfade
 * - Transparent -1.0 dB safety limiter engaged on B ONLY when a platform applies positive gain
 *   that would otherwise exceed -1.0 dBTP (e.g. Spotify Standard boosting quiet tracks)
 * - Real-time Stereo / Mono Sum / Side (L - R) monitoring matrix with explicit stereo upmix
 *   so native mono files render cleanly in both ears and meters
 * - Pre-volume-fader true L/R peak + RMS VU metering, peak hold, clip LEDs,
 *   real-time Pearson phase correlation (-1 .. +1), and 48-band monochrome FFT
 * - Full-Track playback & 15 s Loudest Chorus Loop mode with instant jump-to-timestamp
 */

export function createAudioContextSafe() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  return new AudioContextClass();
}

export function decodeAudioDataSafe(audioCtx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const copy = arrayBuffer.slice(0);
    let isDone = false;
    const done = (fn, arg) => {
      if (!isDone) {
        isDone = true;
        fn(arg);
      }
    };
    try {
      const ret = audioCtx.decodeAudioData(
        copy,
        (decoded) => done(resolve, decoded),
        (err) => done(reject, err || new Error('Audio decoding failed for this file format.'))
      );
      if (ret && typeof ret.then === 'function') {
        ret.then((buf) => done(resolve, buf)).catch((err) => done(reject, err));
      }
    } catch (e) {
      done(reject, e);
    }
  });
}

export class PreFlightAudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;

    // Parallel A (Original 0 dB) / B (Platform Normalised)
    this.branchGainA = null;
    this.normGainB = null;
    this.safetyLimiterB = null;
    this.branchGainB = null;
    this.limiterRouted = false;

    // Explicit stereo sum bus -> Monitoring Matrix -> Metering Tap -> Master Volume -> Out
    this.sumBus = null;
    this.matrixSplitter = null;
    this.matrixMerger = null;
    this.mLL = null;
    this.mLR = null;
    this.mRL = null;
    this.mRR = null;
    this.masterGain = null;

    this.meterSplitter = null;
    this.analyserL = null;
    this.analyserR = null;
    this.analyserFft = null;

    // Pre-allocated metering typed arrays (zero per-frame allocations)
    this.timeDataL = null;
    this.timeDataR = null;
    this.fftData = null;

    this.peakHoldL = -100;
    this.peakHoldR = -100;
    this.clipHoldL = 0;
    this.clipHoldR = 0;
    this.smoothedCorr = 1.0;

    // Playback state
    this.isPlaying = false;
    this.activeSide = 'A'; // 'A' = Original (0 dB), 'B' = Platform Normalised
    this.platformGainDb = 0;
    this.platformLimiterNeeded = false;
    this.monitorMode = 'stereo'; // 'stereo' | 'mono' | 'side'
    this.volume = 0.88;

    // Full vs Chorus Loop state
    this.duration = 0;
    this.loopChorus = false;
    this.chorusStart = 0;
    this.chorusDuration = 15.0;

    this.startCtxTime = 0;
    this.pauseOffset = 0;
    this.activeLoopStart = 0;
    this.activeLoopEnd = 0;

    this.onPlaybackEnd = null;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = createAudioContextSafe();

      // Branch A: Original Master (unity 0.0 dB)
      this.branchGainA = this.ctx.createGain();
      this.branchGainA.gain.value = 1.0;

      // Branch B: Platform Normalised Gain -> optional -1 dB safety limiter -> A/B crossfade gain
      this.normGainB = this.ctx.createGain();
      this.normGainB.gain.value = 1.0;

      this.safetyLimiterB = this.ctx.createDynamicsCompressor();
      this.safetyLimiterB.threshold.value = -1.0;
      this.safetyLimiterB.knee.value = 0.0;
      this.safetyLimiterB.ratio.value = 20.0;
      this.safetyLimiterB.attack.value = 0.002;
      this.safetyLimiterB.release.value = 0.1;

      this.branchGainB = this.ctx.createGain();
      this.branchGainB.gain.value = 0.0;

      // Explicit 2-channel stereo upmix bus (handles native mono cleanly!)
      this.sumBus = this.ctx.createGain();
      this.sumBus.channelCount = 2;
      this.sumBus.channelCountMode = 'explicit';
      this.sumBus.channelInterpretation = 'speakers';
      this.sumBus.gain.value = 1.0;

      this.branchGainA.connect(this.sumBus);
      this.normGainB.connect(this.branchGainB);
      this.limiterRouted = false;
      this.branchGainB.connect(this.sumBus);

      // Stereo / Mono / Side Matrix
      this.matrixSplitter = this.ctx.createChannelSplitter(2);
      this.matrixMerger = this.ctx.createChannelMerger(2);

      this.mLL = this.ctx.createGain();
      this.mLR = this.ctx.createGain();
      this.mRL = this.ctx.createGain();
      this.mRR = this.ctx.createGain();

      this.sumBus.connect(this.matrixSplitter);
      this.matrixSplitter.connect(this.mLL, 0);
      this.matrixSplitter.connect(this.mRL, 0);
      this.matrixSplitter.connect(this.mLR, 1);
      this.matrixSplitter.connect(this.mRR, 1);

      this.mLL.connect(this.matrixMerger, 0, 0);
      this.mLR.connect(this.matrixMerger, 0, 0);
      this.mRL.connect(this.matrixMerger, 0, 1);
      this.mRR.connect(this.matrixMerger, 0, 1);

      // Metering tap sits PRE master volume fader so VU reflects true A/B level changes
      this.meterSplitter = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserR = this.ctx.createAnalyser();
      this.analyserFft = this.ctx.createAnalyser();

      this.analyserL.fftSize = 1024;
      this.analyserR.fftSize = 1024;
      this.analyserFft.fftSize = 256;
      this.analyserFft.smoothingTimeConstant = 0.78;

      this.timeDataL = new Float32Array(this.analyserL.fftSize);
      this.timeDataR = new Float32Array(this.analyserR.fftSize);
      this.fftData = new Uint8Array(this.analyserFft.frequencyBinCount);

      this.matrixMerger.connect(this.meterSplitter);
      this.meterSplitter.connect(this.analyserL, 0);
      this.meterSplitter.connect(this.analyserR, 1);
      this.matrixMerger.connect(this.analyserFft);

      // Output master volume fader -> speakers
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.matrixMerger.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.setMonitorMode(this.monitorMode, true);
      this._applyBranchGains(true);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  loadBuffer(audioBuffer, chorusStartSec = 0, chorusDurSec = 15.0) {
    this.stop();
    this.buffer = audioBuffer;
    this.duration = audioBuffer ? audioBuffer.duration : 0;
    this.chorusDuration = Math.min(chorusDurSec, Math.max(1, this.duration));
    this.chorusStart = Math.max(0, Math.min(chorusStartSec, Math.max(0, this.duration - this.chorusDuration)));
    this.pauseOffset = 0;
    this.loopChorus = false;
    this.activeSide = 'A';
    this.resetMeters();
    this._applyBranchGains(true);
  }

  setPlatformGain(gainDb, engageLimiter = false) {
    this.platformGainDb = Number.isFinite(gainDb) ? gainDb : 0;
    this.platformLimiterNeeded = Boolean(engageLimiter && this.platformGainDb > 0.05);

    if (!this.ctx || !this.normGainB) return;

    // Route through safety limiter ONLY when positive gain would overshoot ceiling
    if (this.platformLimiterNeeded !== this.limiterRouted) {
      try { this.normGainB.disconnect(); } catch { /* noop */ }
      try { this.safetyLimiterB.disconnect(); } catch { /* noop */ }
      if (this.platformLimiterNeeded) {
        this.normGainB.connect(this.safetyLimiterB);
        this.safetyLimiterB.connect(this.branchGainB);
      } else {
        this.normGainB.connect(this.branchGainB);
      }
      this.limiterRouted = this.platformLimiterNeeded;
    }

    const linear = Math.pow(10, this.platformGainDb / 20);
    const now = this.ctx.currentTime;
    this.normGainB.gain.cancelScheduledValues(now);
    this.normGainB.gain.setValueAtTime(this.normGainB.gain.value, now);
    this.normGainB.gain.linearRampToValueAtTime(linear, now + 0.012);
  }

  async setActiveSide(side, autoPlay = false) {
    if (side !== 'A' && side !== 'B') return;
    this.activeSide = side;
    if (this.ctx) {
      this._applyBranchGains(false);
    }
    if (autoPlay && !this.isPlaying && this.buffer) {
      await this.play();
    }
  }

  _applyBranchGains(immediate = false) {
    if (!this.ctx || !this.branchGainA || !this.branchGainB) return;
    const targetA = this.activeSide === 'A' ? 1.0 : 0.0;
    const targetB = this.activeSide === 'B' ? 1.0 : 0.0;
    const now = this.ctx.currentTime;
    const fadeSec = 0.008; // 8 ms clickless crossfade

    for (const [node, target] of [
      [this.branchGainA, targetA],
      [this.branchGainB, targetB],
    ]) {
      node.gain.cancelScheduledValues(now);
      if (immediate) {
        node.gain.setValueAtTime(target, now);
      } else {
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(target, now + fadeSec);
      }
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, Number(val)));
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 0.015);
    }
  }

  setMonitorMode(mode, immediate = false) {
    if (!['stereo', 'mono', 'side'].includes(mode)) return;
    this.monitorMode = mode;
    if (!this.ctx || !this.mLL) return;

    let ll = 1, lr = 0, rl = 0, rr = 1;
    if (mode === 'mono') {
      ll = 0.5; lr = 0.5; rl = 0.5; rr = 0.5;
    } else if (mode === 'side') {
      ll = 0.5; lr = -0.5; rl = -0.5; rr = 0.5;
    }

    const now = this.ctx.currentTime;
    const ramp = immediate ? 0 : 0.008;
    for (const [node, target] of [
      [this.mLL, ll],
      [this.mLR, lr],
      [this.mRL, rl],
      [this.mRR, rr],
    ]) {
      node.gain.cancelScheduledValues(now);
      if (immediate) {
        node.gain.setValueAtTime(target, now);
      } else {
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(target, now + ramp);
      }
    }
  }

  async setLoopChorus(enabled) {
    const next = Boolean(enabled);
    if (next === this.loopChorus) return;
    const wasPlaying = this.isPlaying;
    const curPos = this.getCurrentTime();
    this.loopChorus = next;

    if (this.loopChorus) {
      const loopEnd = Math.min(this.duration, this.chorusStart + this.chorusDuration);
      if (curPos < this.chorusStart || curPos >= loopEnd) {
        this.pauseOffset = this.chorusStart;
      } else {
        this.pauseOffset = curPos;
      }
    } else {
      this.pauseOffset = curPos;
    }

    if (wasPlaying) {
      this._cleanupSource();
      this.isPlaying = false;
      await this.play();
    }
  }

  async play() {
    if (!this.buffer) return false;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Browser may require gesture
      }
    }
    if (this.isPlaying) return true;

    this._cleanupSource();

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;

    let offset = Math.max(0, Math.min(this.pauseOffset, Math.max(0, this.duration - 0.02)));

    if (this.loopChorus && this.duration > 1) {
      const loopStart = this.chorusStart;
      const loopEnd = Math.min(this.duration, this.chorusStart + this.chorusDuration);
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = loopEnd;
      if (offset < loopStart || offset >= loopEnd) {
        offset = loopStart;
      }
      this.activeLoopStart = loopStart;
      this.activeLoopEnd = loopEnd;
    } else {
      src.loop = false;
      this.activeLoopStart = 0;
      this.activeLoopEnd = this.duration;
    }

    src.connect(this.branchGainA);
    src.connect(this.normGainB);
    this.setPlatformGain(this.platformGainDb, this.platformLimiterNeeded);
    this._applyBranchGains(true);

    const now = ctx.currentTime + 0.01;
    this.startCtxTime = now;
    this.pauseOffset = offset;
    this.source = src;

    src.onended = () => {
      // Only handle natural end-of-track (not manual pause/seek cleanup)
      if (this.source === src && !this.loopChorus && this.isPlaying) {
        this.isPlaying = false;
        this.source = null;
        this.pauseOffset = 0;
        if (typeof this.onPlaybackEnd === 'function') {
          this.onPlaybackEnd();
        }
      }
    };

    try {
      src.start(now, offset);
      this.isPlaying = true;
      return true;
    } catch (err) {
      console.error('Pre-Flight playback start error:', err);
      this.isPlaying = false;
      this.source = null;
      return false;
    }
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this._cleanupSource();
    this.isPlaying = false;
  }

  stop() {
    this._cleanupSource();
    this.isPlaying = false;
    this.pauseOffset = 0;
  }

  async seek(targetSec, autoPlay = false) {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(targetSec, Math.max(0, this.duration - 0.02)));

    // If user explicitly jumps outside the chorus loop region, leave chorus loop cleanly
    if (this.loopChorus) {
      const loopEnd = Math.min(this.duration, this.chorusStart + this.chorusDuration);
      if (clamped < this.chorusStart || clamped > loopEnd) {
        this.loopChorus = false;
      }
    }

    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this._cleanupSource();
      this.isPlaying = false;
    }
    this.pauseOffset = clamped;
    if (wasPlaying || autoPlay) {
      await this.play();
    }
  }

  _cleanupSource() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try { s.stop(); } catch { /* noop */ }
      try { s.disconnect(); } catch { /* noop */ }
    }
  }

  getCurrentTime() {
    if (!this.buffer) return 0;
    if (!this.isPlaying || !this.ctx) return this.pauseOffset;
    const elapsed = Math.max(0, this.ctx.currentTime - this.startCtxTime);
    if (this.loopChorus && this.activeLoopEnd > this.activeLoopStart) {
      const span = this.activeLoopEnd - this.activeLoopStart;
      const rel = (this.pauseOffset - this.activeLoopStart + elapsed) % span;
      return this.activeLoopStart + rel;
    }
    return Math.min(this.duration, this.pauseOffset + elapsed);
  }

  resetMeters() {
    this.peakHoldL = -100;
    this.peakHoldR = -100;
    this.clipHoldL = 0;
    this.clipHoldR = 0;
    this.smoothedCorr = 1.0;
  }

  /**
   * Read real-time L/R peak & RMS VU, peak hold, clip LEDs,
   * live Pearson Phase Correlation (-1 .. +1), and FFT spectrum.
   * Zero TypedArray allocations per animation frame.
   */
  getTelemetry() {
    if (!this.analyserL || !this.analyserR || !this.analyserFft || !this.isPlaying) {
      this.peakHoldL = Math.max(-100, this.peakHoldL - 1.2);
      this.peakHoldR = Math.max(-100, this.peakHoldR - 1.2);
      if (this.clipHoldL > 0) this.clipHoldL--;
      if (this.clipHoldR > 0) this.clipHoldR--;
      return {
        active: false,
        peakLDb: -100,
        peakRDb: -100,
        rmsLDb: -100,
        rmsRDb: -100,
        peakHoldLDb: this.peakHoldL,
        peakHoldRDb: this.peakHoldR,
        clipL: this.clipHoldL > 0,
        clipR: this.clipHoldR > 0,
        correlation: this.smoothedCorr,
        fftData: null,
      };
    }

    this.analyserL.getFloatTimeDomainData(this.timeDataL);
    this.analyserR.getFloatTimeDomainData(this.timeDataR);
    this.analyserFft.getByteFrequencyData(this.fftData);

    const len = this.timeDataL.length;
    let sumL2 = 0;
    let sumR2 = 0;
    let sumLR = 0;
    let peakL = 0;
    let peakR = 0;

    for (let i = 0; i < len; i++) {
      const l = this.timeDataL[i];
      const r = this.timeDataR[i];
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
      sumL2 += l * l;
      sumR2 += r * r;
      sumLR += l * r;
    }

    const rmsL = Math.sqrt(sumL2 / len);
    const rmsR = Math.sqrt(sumR2 / len);
    const peakLDb = peakL > 1e-6 ? 20 * Math.log10(peakL) : -100;
    const peakRDb = peakR > 1e-6 ? 20 * Math.log10(peakR) : -100;
    const rmsLDb = rmsL > 1e-6 ? 20 * Math.log10(rmsL) : -100;
    const rmsRDb = rmsR > 1e-6 ? 20 * Math.log10(rmsR) : -100;

    this.peakHoldL = peakLDb >= this.peakHoldL ? peakLDb : Math.max(-100, this.peakHoldL - 0.35);
    this.peakHoldR = peakRDb >= this.peakHoldR ? peakRDb : Math.max(-100, this.peakHoldR - 0.35);

    if (peakLDb >= -0.1) this.clipHoldL = 55;
    else if (this.clipHoldL > 0) this.clipHoldL--;

    if (peakRDb >= -0.1) this.clipHoldR = 55;
    else if (this.clipHoldR > 0) this.clipHoldR--;

    // Real-time Pearson correlation with gentle smoothing
    const denom = Math.sqrt(sumL2 * sumR2);
    if (denom > 1e-8) {
      const instCorr = Math.max(-1, Math.min(1, sumLR / denom));
      this.smoothedCorr = this.smoothedCorr * 0.78 + instCorr * 0.22;
    }

    return {
      active: true,
      peakLDb,
      peakRDb,
      rmsLDb,
      rmsRDb,
      peakHoldLDb: this.peakHoldL,
      peakHoldRDb: this.peakHoldR,
      clipL: this.clipHoldL > 0,
      clipR: this.clipHoldR > 0,
      correlation: this.smoothedCorr,
      fftData: this.fftData,
    };
  }
}
