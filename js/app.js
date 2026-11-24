/**
 * Pre-Flight (TOOL / 002) — UI Controller, Plain-English Fix Plan & Streaming A/B Deck.
 * Saint Gordon Collective · 100% Client-Side Web Audio.
 */

import {
  analyzeBroadcastLoudness,
  analyzeTruePeak,
  analyzeIntegrity,
  analyzeStereoPhase,
  computeWaveformPeaks,
  computePlatformNormalization,
  buildPreFlightChecklist,
  generatePreFlightMarkdown,
  generateCompactSummary,
  formatTime,
  formatSignedDb,
} from './preflight-dsp.js';
import {
  PreFlightAudioEngine,
  decodeAudioDataSafe,
} from './preflight-audio.js';

const engine = new PreFlightAudioEngine();

const state = {
  report: null,
  selectedPlatformId: 'spotify',
  isAnalyzing: false,
  rafId: null,
};

/* --------------------------------------------------------------------------
 * DOM References
 * -------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const els = {
  uploadSection: $('upload-section'),
  reportSection: $('report-section'),
  btnHeaderNew: $('btn-header-new'),
  brandHomeLink: $('brand-home-link'),

  dropzone: $('upload-dropzone'),
  dropzoneClickTarget: $('dropzone-click-target'),
  fileInput: $('file-upload-input'),
  btnSelectFile: $('btn-select-file'),
  btnTryDemo: $('btn-try-demo'),

  progressWrap: $('decode-progress-container'),
  progressText: $('decode-progress-text'),
  progressPct: $('decode-progress-pct'),
  progressBar: $('decode-progress-bar'),

  errorBanner: $('decode-errors-banner'),
  errorTitle: $('decode-errors-title'),
  errorDetail: $('decode-errors-detail'),
  btnDismissErrors: $('btn-dismiss-errors'),

  // Block 1: Verdict Sheet
  verdictSheet: $('verdict-sheet'),
  verdictStamp: $('verdict-stamp-badge'),
  verdictCounts: $('verdict-counts-label'),
  verdictHeadline: $('verdict-headline'),
  verdictSubtitle: $('verdict-subtitle'),
  reportFilename: $('report-filename'),
  reportFileSpecs: $('report-filespecs'),

  heroLufs: $('hero-lufs'),
  heroLufsSub: $('hero-lufs-sub'),
  heroTruePeak: $('hero-true-peak'),
  heroTpSub: $('hero-tp-sub'),
  heroClips: $('hero-clips'),
  heroClipsSub: $('hero-clips-sub'),
  heroMono: $('hero-mono'),
  heroMonoSub: $('hero-mono-sub'),

  btnCopyTop: $('btn-copy-summary-top'),
  btnExportTop: $('btn-export-md-top'),
  btnInspectAnother: $('btn-inspect-another'),

  // Block 1B: Fix Plan & Passed Checks
  fixPlanHeading: $('fix-plan-heading'),
  fixPlanSub: $('fix-plan-sub'),
  fixStepsContainer: $('fix-steps-container'),
  passedChecksDetails: $('passed-checks-details'),
  passedChecksSummary: $('passed-checks-summary'),
  passedChecksList: $('passed-checks-list'),

  // Block 2: Streaming Platforms & A/B Deck
  platformCardsGrid: $('platform-cards-grid'),
  studioDeck: $('studio-deck'),
  deckActiveReadout: $('deck-active-readout'),
  deckStatePill: $('deck-state-pill'),
  btnSideA: $('btn-side-a'),
  btnSideB: $('btn-side-b'),
  abGainA: $('ab-gain-a'),
  abMetaA: $('ab-meta-a'),
  abTitleB: $('ab-title-b'),
  abGainB: $('ab-gain-b'),
  abMetaB: $('ab-meta-b'),

  btnJumpIntro: $('btn-jump-intro'),
  btnJumpLoudest: $('btn-jump-loudest'),
  btnJumpWorst: $('btn-jump-worst'),

  timelineScrubber: $('timeline-scrubber'),
  waveformCanvas: $('waveform-canvas'),
  chorusRegionMask: $('waveform-chorus-region'),
  timelineProgress: $('timeline-progress-bar'),
  timelinePlayhead: $('timeline-playhead'),
  timeCurrent: $('timeline-current-time'),
  timeTotal: $('timeline-total-time'),

  vuMeterL: $('vu-meter-l'),
  vuMeterR: $('vu-meter-r'),
  vuPeakL: $('vu-peak-l'),
  vuPeakR: $('vu-peak-r'),
  clipLedL: $('clip-led-l'),
  clipLedR: $('clip-led-r'),

  livePhaseReadout: $('live-phase-readout'),
  livePhaseFill: $('live-phase-fill'),
  livePhaseNeedle: $('live-phase-needle'),

  btnPlayPause: $('btn-play-pause'),
  playBtnGlyph: $('play-btn-glyph'),
  playBtnText: $('play-btn-text'),
  btnLoopMode: $('btn-loop-mode'),
  loopBtnText: $('loop-btn-text'),
  monitorMatrix: $('monitor-matrix'),
  volumeSlider: $('master-volume-slider'),

  // Block 3: Collapsible Technical Specs
  techDetails: $('tech-details'),
  loudnessSpecList: $('loudness-spec-list'),
  stereoIntegritySpecList: $('stereo-integrity-spec-list'),
  clipEventsWrap: $('clip-events-wrap'),
  clipEventsList: $('clip-events-list'),

  toastContainer: $('toast-container'),
  footerYear: $('footer-year'),
};

/* --------------------------------------------------------------------------
 * Utilities
 * -------------------------------------------------------------------------- */

function nextFrame() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    requestAnimationFrame(() => setTimeout(done, 8));
    setTimeout(done, 60);
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, isError = false) {
  if (!els.toastContainer) return;
  const el = document.createElement('div');
  el.className = isError ? 'toast toast-error' : 'toast';
  el.textContent = message;
  els.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function setProgress(pct, label) {
  els.progressWrap.classList.remove('hidden');
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  els.progressBar.style.width = `${clamped}%`;
  els.progressPct.textContent = `${clamped}%`;
  els.progressText.textContent = label;
}

function hideProgress() {
  els.progressWrap.classList.add('hidden');
}

function showError(title, detail) {
  els.errorTitle.textContent = title;
  els.errorDetail.textContent = detail;
  els.errorBanner.classList.remove('hidden');
}

function hideError() {
  els.errorBanner.classList.add('hidden');
}

function inferFormatLabel(filename, mimeType) {
  const extMatch = String(filename || '').match(/\.([a-z0-9]+)$/i);
  if (extMatch) return extMatch[1].toUpperCase();
  if (mimeType && mimeType.includes('/')) {
    return mimeType.split('/')[1].toUpperCase();
  }
  return 'AUDIO';
}

function dbToMeterPct(db) {
  if (!Number.isFinite(db) || db <= -60) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function statusSymbol(status) {
  if (status === 'fail') return '✕';
  if (status === 'warn') return '▲';
  return '✓';
}

function platformBadgeLabel(plat) {
  if (plat.status === 'fail') return 'Clip Risk';
  if (plat.status === 'warn') return 'Caution';
  return 'Safe';
}

/* --------------------------------------------------------------------------
 * Built-In 6s Demo Master Synthesizer (Zero External Files)
 * -------------------------------------------------------------------------- */

function buildDemoMasterBuffer(audioCtx) {
  const sr = audioCtx.sampleRate || 44100;
  const durationSec = 6.0;
  const length = Math.floor(sr * durationSec);
  const buffer = audioCtx.createBuffer(2, length, sr);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);

  // 120 BPM (0.5 s per beat), 3 chords (2 s each): Cm9 -> Abmaj7 -> Fm9
  const chords = [
    [130.81, 155.56, 196.0, 233.08, 293.66], // Cm9
    [103.83, 130.81, 155.56, 196.0, 233.08], // Abmaj7
    [87.31, 130.81, 174.61, 207.65, 261.63], // Fm9
  ];
  const bassNotes = [65.41, 51.91, 43.65]; // C2, Ab1, F1

  const beatDur = 0.5;
  const twoPi = 2 * Math.PI;
  const fadeInSamples = Math.floor(0.025 * sr);
  const fadeOutSamples = Math.floor(0.35 * sr);

  // Deterministic PRNG for crisp hi-hat ticks
  let seed = 133791;
  const nextNoise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const barIdx = Math.min(2, Math.floor(t / 2.0));
    const chordT = t - barIdx * 2.0;
    const beatPos = t % beatDur;
    const eighthPos = t % (beatDur * 0.5);

    // 1. Centered punchy kick every beat (sweeps 135 Hz -> 48 Hz)
    const kickEnv = Math.exp(-beatPos * 14.5);
    const kickPhase = twoPi * (48 * beatPos + (87 / 24) * (1 - Math.exp(-24 * beatPos)));
    const kick = Math.sin(kickPhase) * kickEnv * 0.58;

    // 2. Centered warm sub-bass ducked gently under kick
    const duck = 0.35 + 0.65 * Math.min(1, beatPos / 0.14);
    const bassFreq = bassNotes[barIdx];
    const sub = (Math.sin(twoPi * bassFreq * t) + 0.25 * Math.sin(twoPi * bassFreq * 2 * t)) * 0.34 * duck;

    // 3. Stereo electric-piano chord pad (slight tasteful L/R detune)
    const chordEnv = Math.min(1, chordT / 0.03) * (0.62 + 0.38 * Math.exp(-chordT * 1.4));
    let padL = 0;
    let padR = 0;
    const freqs = chords[barIdx];
    for (let n = 0; n < freqs.length; n++) {
      const f = freqs[n];
      const detune = (n % 2 === 0 ? 1 : -1) * 0.0022;
      padL += Math.sin(twoPi * f * (1 + detune) * t + n * 0.4) * 0.11;
      padR += Math.sin(twoPi * f * (1 - detune) * t + n * 0.4 + 0.12) * 0.11;
    }
    padL *= chordEnv;
    padR *= chordEnv;

    // 4. Crisp off-beat hi-hat shimmer
    const hatEnv = Math.exp(-eighthPos * 42);
    const hat = nextNoise() * hatEnv * 0.09;

    // Combine and apply musical mastering limiter drive to ~-0.35 dBTP / ~-8.8 LUFS
    let rawL = (kick + sub + padL + hat * 0.85) * 1.85;
    let rawR = (kick + sub + padR + hat * 1.05) * 1.85;

    // Smooth tanh saturation capped at 0.988 (~-0.35 dBTP -> slight true-peak heat, 0 hard clips)
    rawL = Math.tanh(rawL) * 0.988;
    rawR = Math.tanh(rawR) * 0.988;

    // Clean fade-in & fade-out
    let env = 1.0;
    if (i < fadeInSamples) {
      env = i / fadeInSamples;
    } else if (i > length - fadeOutSamples) {
      env = Math.max(0, (length - i) / fadeOutSamples);
    }

    L[i] = rawL * env;
    R[i] = rawR * env;
  }

  return buffer;
}

/* --------------------------------------------------------------------------
 * Audio Analysis Pipeline (Shared by Uploaded Files & Demo Song)
 * -------------------------------------------------------------------------- */

async function analyzeAndDisplayBuffer(audioBuffer, metaInfo) {
  const channels = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const sampleRate = audioBuffer.sampleRate;
  const durationSec = audioBuffer.duration;

  setProgress(48, 'Measuring loudness and dynamics...');
  await nextFrame();
  const loudness = analyzeBroadcastLoudness(channels, sampleRate, 260);

  setProgress(70, 'Checking peaks for streaming distortion...');
  await nextFrame();
  const truePeak = analyzeTruePeak(channels, sampleRate);

  setProgress(86, 'Checking clipping, mono phone sound & bass phase...');
  await nextFrame();
  const integrity = analyzeIntegrity(channels, sampleRate);
  const stereo = analyzeStereoPhase(channels, sampleRate, 260);

  setProgress(96, 'Building your step-by-step fix plan...');
  await nextFrame();
  const waveformPeaks = computeWaveformPeaks(channels, 280);
  const psrDb = loudness.shortTermMaxLufs > -110 && truePeak.truePeakDb > -110
    ? Math.round(Math.max(0, truePeak.truePeakDb - loudness.shortTermMaxLufs) * 10) / 10
    : 0;
  const plrDb = loudness.integratedLufs > -110 && truePeak.truePeakDb > -110
    ? Math.round(Math.max(0, truePeak.truePeakDb - loudness.integratedLufs) * 10) / 10
    : 0;
  const platforms = computePlatformNormalization(loudness.integratedLufs, truePeak.truePeakDb);

  const report = {
    meta: {
      filename: metaInfo.filename,
      fileSizeBytes: metaInfo.fileSizeBytes || 0,
      formatLabel: metaInfo.formatLabel || 'WAV',
      sampleRate,
      numChannels: audioBuffer.numberOfChannels,
      channelLabel: audioBuffer.numberOfChannels === 1 ? 'Mono' : audioBuffer.numberOfChannels === 2 ? 'Stereo' : `${audioBuffer.numberOfChannels}ch`,
      durationSec: Math.round(durationSec * 100) / 100,
      analyzedAt: new Date().toISOString(),
    },
    durationSec: Math.round(durationSec * 100) / 100,
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

  state.report = report;
  state.selectedPlatformId = 'spotify';

  const chorusStart = Math.max(0, loudness.loudestMomentSec - 1.5);
  engine.loadBuffer(audioBuffer, chorusStart, 15.0);
  applySelectedPlatform(state.selectedPlatformId, false);

  setProgress(100, 'Ready!');
  await nextFrame();

  renderFullReport(report);
  hideProgress();
}

async function handleFile(file) {
  if (!file || state.isAnalyzing) return;

  hideError();
  state.isAnalyzing = true;
  engine.stop();
  updateTransportUI();

  try {
    setProgress(10, `Reading ${file.name}...`);
    await nextFrame();

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('The selected file is empty (0 bytes).');
    }

    setProgress(28, 'Opening audio file in your browser...');
    await nextFrame();

    const audioCtx = engine.ensureContext();
    let audioBuffer;
    try {
      audioBuffer = await decodeAudioDataSafe(audioCtx, arrayBuffer);
    } catch (decodeErr) {
      const ext = inferFormatLabel(file.name, file.type);
      const hint = ext === 'AIFF' || ext === 'AIF'
        ? 'AIFF works natively on Safari; on Chrome or Firefox, export as WAV or FLAC.'
        : 'Make sure this is a valid WAV, FLAC, MP3, M4A, AAC, or OGG audio file.';
      throw new Error(`${decodeErr.message || 'Unsupported audio format.'} ${hint}`);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('This audio file contains zero samples.');
    }

    await analyzeAndDisplayBuffer(audioBuffer, {
      filename: file.name,
      fileSizeBytes: file.size,
      formatLabel: inferFormatLabel(file.name, file.type),
    });
    showToast(`Checked ${file.name}`);
  } catch (err) {
    hideProgress();
    showError('Could not inspect audio file', err.message || 'Unknown decoding error.');
    showToast('Could not read audio file', true);
  } finally {
    state.isAnalyzing = false;
    els.fileInput.value = '';
  }
}

async function handleTryDemo() {
  if (state.isAnalyzing) return;
  hideError();
  state.isAnalyzing = true;
  engine.stop();
  updateTransportUI();

  try {
    setProgress(22, 'Generating demo master...');
    await nextFrame();

    const audioCtx = engine.ensureContext();
    const demoBuffer = buildDemoMasterBuffer(audioCtx);

    await analyzeAndDisplayBuffer(demoBuffer, {
      filename: 'Saint_Gordon_Demo_Master.wav',
      fileSizeBytes: 0,
      formatLabel: 'WAV',
    });
    showToast('Demo song loaded — try the A/B player below!');
  } catch (err) {
    hideProgress();
    showError('Could not generate demo song', err.message || 'Web Audio is unavailable in this browser.');
    showToast('Demo failed to load', true);
  } finally {
    state.isAnalyzing = false;
  }
}

/* --------------------------------------------------------------------------
 * Render Simplified 4-Block Report
 * -------------------------------------------------------------------------- */

function renderFullReport(report) {
  els.uploadSection.classList.add('hidden');
  els.reportSection.classList.remove('hidden');
  els.btnHeaderNew.classList.remove('hidden');
  if (els.techDetails) {
    els.techDetails.open = false;
  }

  renderVerdictSheet(report);
  renderFixPlan(report);
  renderPlatformCards(report);
  renderDeckStaticState(report);
  renderTechnicalDetails(report);

  drawWaveform();
  updateLivePhaseMeter(report.stereo.globalCorrelation);
  updateTransportUI();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderVerdictSheet(report) {
  const { meta, loudness, truePeak, integrity, stereo, platforms, verdict } = report;
  const spotify = platforms.find((p) => p.id === 'spotify') || platforms[0];

  els.verdictSheet.dataset.verdict = verdict.overallStatus;

  const stampMap = {
    pass: '✳ READY TO UPLOAD',
    warn: '✳ ALMOST READY',
    fail: '✳ FIX BEFORE UPLOADING',
  };
  els.verdictStamp.textContent = stampMap[verdict.overallStatus] || '✳ REPORT READY';

  const countParts = [`${verdict.passCount} PASSED`];
  if (verdict.failCount > 0) countParts.push(`${verdict.failCount} MUST FIX`);
  if (verdict.warnCount > 0) countParts.push(`${verdict.warnCount} QUICK TIP${verdict.warnCount === 1 ? '' : 'S'}`);
  els.verdictCounts.textContent = countParts.join(' · ');

  els.verdictHeadline.textContent = verdict.plainHeadline;
  els.verdictSubtitle.textContent = verdict.plainSubtitle;

  els.reportFilename.textContent = meta.filename;
  els.reportFileSpecs.textContent = [
    meta.formatLabel || 'AUDIO',
    formatTime(meta.durationSec, false),
    meta.channelLabel,
  ].join(' · ');

  // Tile 1: Loudness
  els.heroLufs.textContent = `${loudness.integratedLufs.toFixed(1)} LUFS`;
  const loudWord = loudness.integratedLufs > -10.5
    ? 'Loud'
    : loudness.integratedLufs >= -15.5
      ? 'Balanced'
      : 'Quiet';
  els.heroLufsSub.textContent = `${loudWord} · Spotify: ${spotify.plainAction.toLowerCase()}`;

  // Tile 2: Headroom / Peaks
  els.heroTruePeak.textContent = `${truePeak.truePeakDb.toFixed(2)} dBTP`;
  if (truePeak.truePeakDb > 0.0) {
    els.heroTpSub.textContent = 'Past 0 dB — will distort';
  } else if (truePeak.truePeakDb > -1.0) {
    els.heroTpSub.textContent = 'Too close to clipping';
  } else if (loudness.integratedLufs > -11.0 && truePeak.truePeakDb > -2.0) {
    els.heroTpSub.textContent = 'Safe (-2.0 dB even safer)';
  } else {
    els.heroTpSub.textContent = 'Safe below -1.0 dB';
  }

  // Tile 3: Clipping
  if (integrity.clipBurstCount > 0) {
    els.heroClips.textContent = `${integrity.clipBurstCount} Burst${integrity.clipBurstCount === 1 ? '' : 's'}`;
    els.heroClipsSub.textContent = `${integrity.clipBurstCount} clip burst${integrity.clipBurstCount === 1 ? '' : 's'} found`;
  } else if (integrity.clippedSampleCount > 0) {
    els.heroClips.textContent = `${integrity.clippedSampleCount} Sample${integrity.clippedSampleCount === 1 ? '' : 's'}`;
    els.heroClipsSub.textContent = 'Tiny peaks hit 0 dB';
  } else {
    els.heroClips.textContent = '0 Clips';
    els.heroClipsSub.textContent = 'Clean waveform';
  }

  // Tile 4: Phone / Mono Sound
  if (stereo.isMono) {
    els.heroMono.textContent = 'Native Mono';
    els.heroMonoSub.textContent = 'Translates cleanly everywhere';
  } else if (stereo.globalCorrelation < 0.0) {
    els.heroMono.textContent = 'Out of Phase';
    els.heroMonoSub.textContent = 'Loses sound in mono';
  } else if (stereo.monoLossDb < -4.5) {
    els.heroMono.textContent = 'Weak in Mono';
    els.heroMonoSub.textContent = 'Loses punch in mono';
  } else if (stereo.lowEndHasContent && stereo.lowEndCorrelation < 0.3) {
    els.heroMono.textContent = 'Bass Issue';
    els.heroMonoSub.textContent = 'Bass drops out in mono';
  } else if (stereo.monoLossDb < -3.0) {
    els.heroMono.textContent = 'Gets Thinner';
    els.heroMonoSub.textContent = `Drops ${Math.abs(stereo.monoLossDb).toFixed(1)} dB in mono`;
  } else if (stereo.lowEndHasContent && stereo.lowEndCorrelation < 0.7) {
    els.heroMono.textContent = 'Wide Bass';
    els.heroMonoSub.textContent = 'Mono bass below 120 Hz';
  } else if (stereo.minCorrelation < -0.25) {
    els.heroMono.textContent = 'Mostly Solid';
    els.heroMonoSub.textContent = 'Brief phase dips';
  } else {
    els.heroMono.textContent = 'Solid';
    els.heroMonoSub.textContent = 'Translates well';
  }
}

function renderFixPlan(report) {
  const { verdict } = report;
  const fails = verdict.checks.filter((c) => c.status === 'fail');
  const warns = verdict.checks.filter((c) => c.status === 'warn');
  const passed = verdict.checks.filter((c) => c.status === 'pass');
  const issues = [...fails, ...warns];

  els.fixStepsContainer.innerHTML = '';

  if (issues.length === 0) {
    els.fixPlanHeading.textContent = 'Nothing to Fix — You’re Clear';
    els.fixPlanSub.textContent = 'Your song passed all 7 streaming & playback checks.';

    const clearCard = document.createElement('div');
    clearCard.className = 'all-clear-card';
    clearCard.innerHTML = `
      <span class="all-clear-mark" aria-hidden="true">✓</span>
      <div>
        <h3 class="all-clear-title">All ${verdict.checks.length} checks passed — your master is clean and ready for DistroKid, TuneCore, CD Baby, or SoundCloud.</h3>
        <p class="all-clear-sub">Use the A/B player below to double-check how your song feels at Spotify and Apple Music playback volume.</p>
      </div>
    `;
    els.fixStepsContainer.appendChild(clearCard);
  } else {
    els.fixPlanHeading.textContent = fails.length > 0
      ? `Fix Plan (${fails.length} Must Fix${warns.length > 0 ? `, ${warns.length} Quick Tip${warns.length === 1 ? '' : 's'}` : ''})`
      : `${warns.length} Quick Tip${warns.length === 1 ? '' : 's'} Before You Upload`;
    els.fixPlanSub.textContent = 'Follow these steps in your DAW, re-export your WAV, and drop it back in here to verify.';

    issues.forEach((item, idx) => {
      const isFail = item.status === 'fail';
      const stepLabel = isFail
        ? `STEP ${idx + 1} — MUST FIX`
        : `STEP ${idx + 1} — OPTIONAL TIP`;
      const badgeText = isFail ? 'MUST FIX' : 'QUICK TIP';

      const card = document.createElement('article');
      card.className = `fix-step-card ${isFail ? 'fix-step-fail' : 'fix-step-warn'}`;

      const stepsHtml = (item.fixSteps || [])
        .map((step) => `<li>${escapeHtml(step)}</li>`)
        .join('');

      const jumpBtnHtml = item.jumpTarget
        ? `
          <div class="fix-step-actions">
            <button
              type="button"
              class="sg-btn sg-btn-ink sg-btn-sm fix-jump-btn"
              data-jump-sec="${escapeHtml(String(item.jumpTarget.timeSec ?? 0))}"
              data-jump-monitor="${escapeHtml(item.jumpTarget.monitorMode || 'stereo')}"
            >
              ${escapeHtml(item.jumpTarget.label)} →
            </button>
          </div>
        `
        : '';

      card.innerHTML = `
        <div class="fix-step-top">
          <div class="fix-step-left">
            <span class="fix-step-num">${escapeHtml(stepLabel)}</span>
            <span class="status-stamp status-${item.status}">${statusSymbol(item.status)} ${escapeHtml(badgeText)}</span>
          </div>
          <span class="fix-step-val">${escapeHtml(item.value)}</span>
        </div>

        <h3 class="fix-step-title">${escapeHtml(item.plainTitle)}</h3>

        <p class="fix-step-why">
          <strong>What's happening:</strong> ${escapeHtml(item.whatsWrong)}
        </p>

        <div class="fix-how-box">
          <span class="micro fix-how-label">HOW TO FIX IT IN YOUR DAW</span>
          <ol class="fix-daw-steps">${stepsHtml}</ol>
        </div>

        ${jumpBtnHtml}
      `;

      els.fixStepsContainer.appendChild(card);
    });
  }

  // Collapsible Passed Checks (open if everything passed, closed when there are fixes)
  if (passed.length > 0) {
    els.passedChecksDetails.classList.remove('hidden');
    els.passedChecksSummary.textContent = `✓ Passed Checks (${passed.length} of ${verdict.checks.length})`;
    els.passedChecksDetails.open = issues.length === 0;
    els.passedChecksList.innerHTML = '';

    for (const item of passed) {
      const li = document.createElement('li');
      li.className = 'passed-check-row';
      li.innerHTML = `
        <span class="passed-check-tick" aria-hidden="true">✓</span>
        <div>
          <div class="passed-check-title">${escapeHtml(item.plainTitle)}</div>
          <p class="passed-check-desc">${escapeHtml(item.whatsWrong)}</p>
        </div>
        <span class="passed-check-val">${escapeHtml(item.value)}</span>
      `;
      els.passedChecksList.appendChild(li);
    }
  } else {
    els.passedChecksDetails.classList.add('hidden');
  }
}

function renderPlatformCards(report) {
  els.platformCardsGrid.innerHTML = '';

  for (const p of report.platforms) {
    const isSel = p.id === state.selectedPlatformId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `platform-card${isSel ? ' selected' : ''}`;
    btn.dataset.platform = p.id;
    btn.setAttribute('aria-pressed', String(isSel));

    btn.innerHTML = `
      <div>
        <div class="platform-card-head">
          <h3 class="platform-card-title">${escapeHtml(p.name)}</h3>
          <span class="status-stamp status-${p.status}">${statusSymbol(p.status)} ${escapeHtml(platformBadgeLabel(p))}</span>
        </div>

        <div class="platform-action-big">${escapeHtml(p.plainAction)}</div>
        <div class="platform-target-line">Target: ${p.targetLufs.toFixed(0)} LUFS · Plays at ${p.postNormLufs.toFixed(1)} LUFS</div>
        <p class="platform-plain-status" style="margin-top: 8px;">${escapeHtml(p.plainStatus)}</p>
      </div>

      <span class="platform-select-cue">${isSel ? '● Active in A/B Player' : 'Click to A/B'}</span>
    `;

    els.platformCardsGrid.appendChild(btn);
  }
}

function renderDeckStaticState(report) {
  els.abGainA.textContent = '0.0 dB';
  els.abMetaA.textContent = `${report.loudness.integratedLufs.toFixed(1)} LUFS · AS EXPORTED`;

  els.timeTotal.textContent = formatTime(report.durationSec, false);
  els.timeCurrent.textContent = formatTime(0, false);
  els.timelineScrubber.setAttribute('aria-valuemax', String(Math.round(report.durationSec)));

  els.btnJumpLoudest.textContent = `Loudest Part (${formatTime(report.loudness.loudestMomentSec)})`;

  if (report.integrity.worstClipSec !== null) {
    els.btnJumpWorst.textContent = `Worst Clip (${formatTime(report.integrity.worstClipSec)})`;
    els.btnJumpWorst.dataset.targetSec = String(Math.max(0, report.integrity.worstClipSec - 1.0));
    els.btnJumpWorst.dataset.targetMonitor = 'stereo';
  } else if (!report.stereo.isMono && report.stereo.worstPhaseSec !== null && report.stereo.minCorrelation < 0.5) {
    els.btnJumpWorst.textContent = `Worst Spot (${formatTime(report.stereo.worstPhaseSec)})`;
    els.btnJumpWorst.dataset.targetSec = String(report.stereo.worstPhaseSec);
    els.btnJumpWorst.dataset.targetMonitor = 'mono';
  } else {
    els.btnJumpWorst.textContent = `Loudest Peak (${formatTime(report.truePeak.truePeakTimeSec)})`;
    els.btnJumpWorst.dataset.targetSec = String(Math.max(0, report.truePeak.truePeakTimeSec - 1.0));
    els.btnJumpWorst.dataset.targetMonitor = 'stereo';
  }

  updateChorusRegionVisual();
  updatePlatformDeckUI();
}

function appendSpecRows(dlEl, rows) {
  dlEl.innerHTML = '';
  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'spec-row';
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    dd.textContent = row.value;
    if (row.flag) dd.className = 'spec-flag';
    div.appendChild(dt);
    div.appendChild(dd);
    dlEl.appendChild(div);
  }
}

function renderTechnicalDetails(report) {
  const { loudness, truePeak, integrity, stereo, psrDb } = report;

  const chTpStr = truePeak.channelTruePeaksDb.length >= 2
    ? `L ${truePeak.channelTruePeaksDb[0].toFixed(2)} / R ${truePeak.channelTruePeaksDb[1].toFixed(2)} dBTP`
    : `${truePeak.truePeakDb.toFixed(2)} dBTP`;

  const fmtCorr = (r) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}`;

  appendSpecRows(els.loudnessSpecList, [
    { label: 'Integrated LUFS', value: `${loudness.integratedLufs.toFixed(1)} LUFS` },
    { label: 'Short-Term Max (3 s)', value: `${loudness.shortTermMaxLufs.toFixed(1)} LUFS @ ${formatTime(loudness.loudestMomentSec)}` },
    { label: 'Momentary Max (400 ms)', value: `${loudness.momentaryMaxLufs.toFixed(1)} LUFS` },
    { label: 'Loudness Range (LRA)', value: `${loudness.lraLu.toFixed(1)} LU` },
    { label: 'Sample Peak (dBFS)', value: `${loudness.samplePeakDb.toFixed(2)} dBFS` },
    { label: '4× True Peak (dBTP)', value: `${truePeak.truePeakDb.toFixed(2)} dBTP @ ${formatTime(truePeak.truePeakTimeSec)}`, flag: truePeak.truePeakDb > -1.0 },
    { label: 'L / R True Peaks', value: chTpStr },
    { label: 'Inter-Sample Peaks (> 0 dBTP)', value: truePeak.ispCount.toLocaleString(), flag: truePeak.ispCount > 0 },
    { label: 'RMS (Unweighted)', value: `${loudness.rmsDb.toFixed(1)} dBFS` },
    { label: 'Crest Factor', value: `${loudness.crestDb.toFixed(1)} dB` },
    { label: 'PSR (Peak to Short-Term)', value: `${psrDb.toFixed(1)} dB` },
  ]);

  appendSpecRows(els.stereoIntegritySpecList, [
    { label: 'Global Correlation', value: stereo.isMono ? '+1.00 (Mono)' : fmtCorr(stereo.globalCorrelation), flag: !stereo.isMono && stereo.globalCorrelation < 0.2 },
    {
      label: 'Worst Window Correlation (500 ms)',
      value: stereo.worstPhaseSec !== null
        ? `${fmtCorr(stereo.minCorrelation)} @ ${formatTime(stereo.worstPhaseSec, true)}`
        : fmtCorr(stereo.minCorrelation),
      flag: !stereo.isMono && stereo.minCorrelation < -0.25,
    },
    {
      label: 'Bass (< 120 Hz) Correlation',
      value: stereo.isMono
        ? '+1.00 (Mono)'
        : stereo.lowEndHasContent
          ? fmtCorr(stereo.lowEndCorrelation)
          : 'Minimal Sub Energy',
      flag: !stereo.isMono && stereo.lowEndHasContent && stereo.lowEndCorrelation < 0.5,
    },
    { label: 'Mono Energy Change (dB)', value: `${stereo.monoLossDb.toFixed(2)} dB`, flag: !stereo.isMono && stereo.monoLossDb < -3.0 },
    { label: 'Mono Peak', value: `${stereo.monoPeakDb.toFixed(2)} dBFS` },
    { label: 'Stereo Width %', value: `${stereo.stereoWidthPct.toFixed(1)}%` },
    { label: 'L / R Balance', value: formatSignedDb(stereo.lrBalanceDb, 2), flag: !stereo.isMono && Math.abs(stereo.lrBalanceDb) > 1.5 },
    { label: 'Clipped Samples (≥ 0.9999)', value: integrity.clippedSampleCount.toLocaleString(), flag: integrity.clippedSampleCount > 0 },
    { label: 'Hard Clip Bursts (≥ 3 smp)', value: String(integrity.clipBurstCount), flag: integrity.clipBurstCount > 0 },
    { label: 'DC Offset', value: `${integrity.dcOffsetPct.toFixed(2)}% (${integrity.dcOffsetDb <= -119 ? '-∞' : integrity.dcOffsetDb} dBFS)`, flag: integrity.dcOffsetMax > 0.005 },
    {
      label: 'Head / Tail Silence',
      value: `${integrity.headSilenceSec.toFixed(2)} s / ${integrity.tailSilenceSec.toFixed(2)} s`,
      flag: integrity.headHardStart || integrity.tailHardEnd,
    },
  ]);

  if (integrity.clipEvents.length > 0) {
    els.clipEventsWrap.classList.remove('hidden');
    els.clipEventsList.innerHTML = '';
    for (const ev of integrity.clipEvents.slice(0, 8)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sg-btn sg-btn-outline sg-btn-sm';
      btn.textContent = `${formatTime(ev.timeSec, true)} · ${ev.channel} (${ev.durationSamples} smp)`;
      btn.addEventListener('click', () => {
        jumpAndAudition(Math.max(0, ev.timeSec - 1.0), 'stereo');
      });
      els.clipEventsList.appendChild(btn);
    }
  } else {
    els.clipEventsWrap.classList.add('hidden');
  }
}

/* --------------------------------------------------------------------------
 * A/B Player State & Interactive Controls
 * -------------------------------------------------------------------------- */

function getSelectedPlatform() {
  if (!state.report) return null;
  return state.report.platforms.find((p) => p.id === state.selectedPlatformId) || state.report.platforms[0];
}

function applySelectedPlatform(platformId, announce = false) {
  state.selectedPlatformId = platformId;
  const plat = getSelectedPlatform();
  if (!plat) return;

  engine.setPlatformGain(plat.gainDb, plat.limiterEngaged);
  updatePlatformCardsSelection();
  updatePlatformDeckUI();

  if (announce) {
    showToast(`A/B Player set to ${plat.name} (${plat.plainAction})`);
  }
}

function updatePlatformCardsSelection() {
  for (const card of els.platformCardsGrid.querySelectorAll('.platform-card')) {
    const isSel = card.dataset.platform === state.selectedPlatformId;
    card.classList.toggle('selected', isSel);
    card.setAttribute('aria-pressed', String(isSel));
    const cue = card.querySelector('.platform-select-cue');
    if (cue) {
      cue.textContent = isSel ? '● Active in A/B Player' : 'Click to A/B';
    }
  }
}

function updatePlatformDeckUI() {
  const plat = getSelectedPlatform();
  if (!plat) return;

  els.abTitleB.textContent = `On ${plat.name} (${formatSignedDb(plat.gainDb, 1)})`;
  els.abGainB.textContent = plat.plainAction;

  const extra = plat.limiterEngaged
    ? ' · PLATFORM LIMITER ON'
    : '';
  els.abMetaB.textContent = `PLAYS AT ${plat.postNormLufs.toFixed(1)} LUFS${extra}`;

  const isA = engine.activeSide === 'A';
  els.btnSideA.classList.toggle('active-play', isA);
  els.btnSideB.classList.toggle('active-play', !isA);
  els.btnSideA.setAttribute('aria-pressed', String(isA));
  els.btnSideB.setAttribute('aria-pressed', String(!isA));

  els.deckActiveReadout.textContent = isA
    ? 'YOUR ORIGINAL FILE · 0.0 dB'
    : `ON ${plat.name.toUpperCase()} · ${formatSignedDb(plat.gainDb, 1)}`;
}

function updateMonitorMatrixUI() {
  const mode = engine.monitorMode;
  for (const btn of els.monitorMatrix.querySelectorAll('.deck-seg-btn')) {
    const active = btn.dataset.monitor === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}

function updateChorusRegionVisual() {
  if (!state.report || !engine.loopChorus || engine.duration <= 0) {
    els.chorusRegionMask.classList.add('hidden');
    return;
  }
  const leftPct = (engine.chorusStart / engine.duration) * 100;
  const widthPct = (Math.min(engine.chorusDuration, engine.duration - engine.chorusStart) / engine.duration) * 100;
  els.chorusRegionMask.style.left = `${leftPct}%`;
  els.chorusRegionMask.style.width = `${widthPct}%`;
  els.chorusRegionMask.classList.remove('hidden');
}

function updateTransportUI() {
  const playing = engine.isPlaying;
  els.studioDeck.dataset.state = playing ? 'playing' : 'paused';
  els.deckStatePill.textContent = playing ? 'PLAYING' : 'STANDBY';
  els.playBtnGlyph.textContent = playing ? '❚❚' : '▶';
  els.playBtnText.textContent = playing ? 'Pause' : 'Play';

  els.btnLoopMode.classList.toggle('deck-pill-active', engine.loopChorus);
  els.btnLoopMode.setAttribute('aria-pressed', String(engine.loopChorus));
  els.loopBtnText.textContent = engine.loopChorus ? 'Looping Chorus' : 'Loop Chorus';
  updateChorusRegionVisual();
  updatePlatformDeckUI();
  updateMonitorMatrixUI();

  if (playing) {
    startAnimationLoop();
  }
}

async function jumpAndAudition(targetSec, monitorMode = null, side = null) {
  if (!state.report) return;
  if (monitorMode) {
    engine.setMonitorMode(monitorMode);
  }
  if (side) {
    await engine.setActiveSide(side, false);
  }
  await engine.seek(targetSec, true);
  updateTransportUI();
  els.studioDeck.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* --------------------------------------------------------------------------
 * Clean Waveform Canvas (with Red/White Clip Markers)
 * -------------------------------------------------------------------------- */

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  return { w: rect.width, h: rect.height, dpr };
}

function drawWaveform() {
  const report = state.report;
  if (!report) return;
  const canvas = els.waveformCanvas;
  const dims = resizeCanvasToDisplaySize(canvas);
  if (!dims) return;

  const { w, h, dpr } = dims;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);

  // Dark hardware bed
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, w, h);

  // Center axis
  const midY = h * 0.5;
  ctx.strokeStyle = '#242424';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  // Crisp monochrome amplitude bars
  const peaks = report.waveformPeaks;
  const count = peaks.length;
  const barStep = w / Math.max(1, count);
  const barW = Math.max(1, barStep - 1);
  const maxBarHalf = h * 0.42;

  ctx.fillStyle = '#929292';
  for (let i = 0; i < count; i++) {
    const p = peaks[i];
    const halfH = Math.max(1.5, p * maxBarHalf);
    const x = i * barStep;
    ctx.fillRect(x, midY - halfH, barW, halfH * 2);
  }

  // Red & white clip markers where hard clipping occurred
  const dur = Math.max(0.01, report.durationSec);
  const clips = report.integrity.clipMarkerTimes;
  if (clips && clips.length > 0) {
    for (let i = 0; i < clips.length; i++) {
      const x = Math.max(1, Math.min(w - 2, (clips[i] / dur) * w));
      ctx.fillStyle = 'rgba(255, 77, 77, 0.55)';
      ctx.fillRect(x, 0, 2, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, 0, 2, 10);
    }
  }

  ctx.restore();
}

/* --------------------------------------------------------------------------
 * Real-Time Telemetry Loop (Horizontal L/R Bars + Live Mono/Phase + Playhead)
 * -------------------------------------------------------------------------- */

function updateLivePhaseMeter(r) {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(r) ? r : 1));
  const pct = ((clamped + 1) * 0.5) * 100;

  let label = 'SOLID';
  if (clamped < 0) label = 'OUT OF PHASE';
  else if (clamped < 0.3) label = 'WIDE';

  els.livePhaseReadout.textContent = `${label} (${clamped >= 0 ? '+' : ''}${clamped.toFixed(2)})`;
  els.livePhaseNeedle.style.left = `${pct}%`;

  if (clamped >= 0) {
    els.livePhaseFill.classList.remove('negative');
    els.livePhaseFill.style.left = '50%';
    els.livePhaseFill.style.width = `${clamped * 50}%`;
  } else {
    els.livePhaseFill.classList.add('negative');
    els.livePhaseFill.style.left = `${pct}%`;
    els.livePhaseFill.style.width = `${Math.abs(clamped) * 50}%`;
  }
}

function updatePlayheadVisuals() {
  if (!state.report || engine.duration <= 0) return;
  const cur = engine.getCurrentTime();
  const pct = Math.max(0, Math.min(100, (cur / engine.duration) * 100));
  els.timelinePlayhead.style.left = `${pct}%`;
  els.timelineProgress.style.width = `${pct}%`;
  els.timeCurrent.textContent = formatTime(cur, false);
  els.timelineScrubber.setAttribute('aria-valuenow', String(Math.round(cur)));
}

function startAnimationLoop() {
  if (state.rafId !== null) return;

  const tick = () => {
    const tel = engine.getTelemetry();

    const pctL = dbToMeterPct(tel.peakLDb);
    const pctR = dbToMeterPct(tel.peakRDb);
    const holdL = dbToMeterPct(tel.peakHoldLDb);
    const holdR = dbToMeterPct(tel.peakHoldRDb);

    els.vuMeterL.style.width = `${pctL}%`;
    els.vuMeterR.style.width = `${pctR}%`;

    els.vuPeakL.style.left = `${holdL}%`;
    els.vuPeakL.style.opacity = holdL > 2 ? '1' : '0';
    els.vuPeakR.style.left = `${holdR}%`;
    els.vuPeakR.style.opacity = holdR > 2 ? '1' : '0';

    els.clipLedL.classList.toggle('clipping', tel.clipL);
    els.clipLedR.classList.toggle('clipping', tel.clipR);

    if (tel.active) {
      updateLivePhaseMeter(tel.correlation);
      updatePlayheadVisuals();
      state.rafId = requestAnimationFrame(tick);
    } else if (holdL > 1 || holdR > 1 || tel.clipL || tel.clipR) {
      updatePlayheadVisuals();
      state.rafId = requestAnimationFrame(tick);
    } else {
      updatePlayheadVisuals();
      if (state.report) {
        updateLivePhaseMeter(state.report.stereo.globalCorrelation);
      }
      state.rafId = null;
    }
  };

  state.rafId = requestAnimationFrame(tick);
}

/* --------------------------------------------------------------------------
 * Export Markdown & Copy Fix Checklist
 * -------------------------------------------------------------------------- */

function exportMarkdownReport() {
  if (!state.report) return;
  const md = generatePreFlightMarkdown(state.report);
  const baseName = state.report.meta.filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '_') || 'master';
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_preflight_report.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Exported report (.md)');
}

async function copySummaryToClipboard() {
  if (!state.report) return;
  const summary = generateCompactSummary(state.report);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(summary);
    } else {
      const ta = document.createElement('textarea');
      ta.value = summary;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('Fix checklist copied to clipboard');
  } catch {
    showToast('Could not access clipboard', true);
  }
}

/* --------------------------------------------------------------------------
 * Event Wiring
 * -------------------------------------------------------------------------- */

function initEvents() {
  if (els.footerYear) {
    els.footerYear.textContent = String(new Date().getFullYear());
  }

  engine.onPlaybackEnd = () => {
    updateTransportUI();
    updatePlayheadVisuals();
  };

  // File Selection & Demo Song
  els.btnSelectFile.addEventListener('click', (e) => {
    e.stopPropagation();
    els.fileInput.click();
  });

  els.btnTryDemo.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTryDemo();
  });

  els.dropzoneClickTarget.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    els.fileInput.click();
  });

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  // Drag & Drop (works on dropzone AND anywhere on the page once loaded)
  ['dragenter', 'dragover'].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.remove('drag-over');
    });
  });

  els.dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!els.dropzone.contains(e.target)) {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    }
  });

  els.btnDismissErrors.addEventListener('click', hideError);

  const openFilePicker = () => els.fileInput.click();
  els.btnHeaderNew.addEventListener('click', openFilePicker);
  els.btnInspectAnother.addEventListener('click', openFilePicker);

  els.brandHomeLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // 1-Click Jump Buttons on Fix Step Cards
  els.fixStepsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.fix-jump-btn');
    if (!btn) return;
    const sec = Number(btn.dataset.jumpSec || 0);
    const monitor = btn.dataset.jumpMonitor || 'stereo';
    jumpAndAudition(sec, monitor);
  });

  // Clickable Platform Cards -> select platform for A/B player below
  els.platformCardsGrid.addEventListener('click', async (e) => {
    const card = e.target.closest('.platform-card');
    if (!card || !card.dataset.platform) return;
    applySelectedPlatform(card.dataset.platform, false);
    if (engine.isPlaying) {
      await engine.setActiveSide('B', false);
      updateTransportUI();
    }
  });

  // A / B Instant Switcher
  els.btnSideA.addEventListener('click', async () => {
    await engine.setActiveSide('A', true);
    updateTransportUI();
  });

  els.btnSideB.addEventListener('click', async () => {
    await engine.setActiveSide('B', true);
    updateTransportUI();
  });

  // Quick Jump Buttons
  els.btnJumpIntro.addEventListener('click', () => jumpAndAudition(0));
  els.btnJumpLoudest.addEventListener('click', () => {
    if (!state.report) return;
    jumpAndAudition(state.report.loudness.loudestMomentSec);
  });
  els.btnJumpWorst.addEventListener('click', () => {
    const sec = Number(els.btnJumpWorst.dataset.targetSec || 0);
    const mon = els.btnJumpWorst.dataset.targetMonitor || null;
    jumpAndAudition(sec, mon);
  });

  // Interactive Waveform Scrubbing (Pointer + Keyboard)
  let scrubbing = false;
  const seekFromClientX = (clientX) => {
    if (!state.report || engine.duration <= 0) return;
    const rect = els.timelineScrubber.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const targetSec = frac * engine.duration;
    engine.seek(targetSec, false);
    updateTransportUI();
    updatePlayheadVisuals();
  };

  els.timelineScrubber.addEventListener('pointerdown', (e) => {
    if (!state.report) return;
    scrubbing = true;
    els.timelineScrubber.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  });

  els.timelineScrubber.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    seekFromClientX(e.clientX);
  });

  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    try { els.timelineScrubber.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  els.timelineScrubber.addEventListener('pointerup', endScrub);
  els.timelineScrubber.addEventListener('pointercancel', endScrub);

  els.timelineScrubber.addEventListener('keydown', (e) => {
    if (!state.report) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      engine.seek(engine.getCurrentTime() + 5, false);
      updatePlayheadVisuals();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      engine.seek(engine.getCurrentTime() - 5, false);
      updatePlayheadVisuals();
    }
  });

  // Transport Controls
  els.btnPlayPause.addEventListener('click', async () => {
    if (!state.report) return;
    if (engine.isPlaying) {
      engine.pause();
    } else {
      await engine.play();
    }
    updateTransportUI();
  });

  els.btnLoopMode.addEventListener('click', async () => {
    if (!state.report) return;
    await engine.setLoopChorus(!engine.loopChorus);
    updateTransportUI();
    updatePlayheadVisuals();
  });

  els.monitorMatrix.addEventListener('click', (e) => {
    const btn = e.target.closest('.deck-seg-btn');
    if (!btn || !btn.dataset.monitor) return;
    engine.setMonitorMode(btn.dataset.monitor);
    updateMonitorMatrixUI();
  });

  els.volumeSlider.addEventListener('input', (e) => {
    engine.setVolume(Number(e.target.value));
  });

  // Exports & Copy
  els.btnExportTop.addEventListener('click', exportMarkdownReport);
  els.btnCopyTop.addEventListener('click', copySummaryToClipboard);

  // Studio Keyboard Shortcuts
  window.addEventListener('keydown', async (e) => {
    if (!state.report) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
      return;
    }

    const key = e.key.toLowerCase();
    if (e.code === 'Space') {
      e.preventDefault();
      if (engine.isPlaying) engine.pause();
      else await engine.play();
      updateTransportUI();
    } else if (key === '1') {
      e.preventDefault();
      await engine.setActiveSide('A', true);
      updateTransportUI();
    } else if (key === '2') {
      e.preventDefault();
      await engine.setActiveSide('B', true);
      updateTransportUI();
    } else if (key === 'm') {
      e.preventDefault();
      engine.setMonitorMode(engine.monitorMode === 'mono' ? 'stereo' : 'mono');
      updateMonitorMatrixUI();
    } else if (key === 's') {
      e.preventDefault();
      engine.setMonitorMode(engine.monitorMode === 'side' ? 'stereo' : 'side');
      updateMonitorMatrixUI();
    } else if (key === 'l') {
      e.preventDefault();
      await engine.setLoopChorus(!engine.loopChorus);
      updateTransportUI();
      updatePlayheadVisuals();
    } else if (key === 'r') {
      e.preventDefault();
      const target = engine.loopChorus ? engine.chorusStart : 0;
      await engine.seek(target, true);
      updateTransportUI();
      updatePlayheadVisuals();
    }
  });

  // Redraw HiDPI waveform on resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.report) {
        drawWaveform();
      }
    }, 100);
  });
}

initEvents();
