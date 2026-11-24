/**
 * Pre-Flight (TOOL / 002) — UI Controller, Waveform/Spectrum Telemetry & Interaction Layer.
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
  waveformOverlay: 'lufs', // 'lufs' | 'phase' | 'none'
  isAnalyzing: false,
  rafId: null,
  spectrumPeakCaps: new Float32Array(48),
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

  progressWrap: $('decode-progress-container'),
  progressText: $('decode-progress-text'),
  progressPct: $('decode-progress-pct'),
  progressBar: $('decode-progress-bar'),

  errorBanner: $('decode-errors-banner'),
  errorTitle: $('decode-errors-title'),
  errorDetail: $('decode-errors-detail'),
  btnDismissErrors: $('btn-dismiss-errors'),

  // Verdict Sheet
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
  heroLra: $('hero-lra'),
  heroLraSub: $('hero-lra-sub'),
  heroPhase: $('hero-phase'),
  heroPhaseSub: $('hero-phase-sub'),

  btnExportTop: $('btn-export-md-top'),
  btnCopyTop: $('btn-copy-summary-top'),
  btnInspectAnother: $('btn-inspect-another'),
  btnExportBottom: $('btn-export-md-bottom'),
  btnCopyBottom: $('btn-copy-summary-bottom'),

  // Fragment Deck
  studioDeck: $('studio-deck'),
  deckActiveReadout: $('deck-active-readout'),
  deckStatePill: $('deck-state-pill'),
  platformTabsWrap: $('deck-platform-tabs'),
  btnSideA: $('btn-side-a'),
  btnSideB: $('btn-side-b'),
  abTitleB: $('ab-title-b'),
  abGainA: $('ab-gain-a'),
  abGainB: $('ab-gain-b'),
  abMetaA: $('ab-meta-a'),
  abMetaB: $('ab-meta-b'),

  overlayGroup: $('waveform-overlay-group'),
  btnJumpIntro: $('btn-jump-intro'),
  btnJumpLoudest: $('btn-jump-loudest'),
  btnJumpWorst: $('btn-jump-worst'),

  timelineScrubber: $('timeline-scrubber'),
  waveformCanvas: $('waveform-canvas'),
  chorusRegionMask: $('waveform-chorus-region'),
  timelineProgress: $('timeline-progress-bar'),
  timelinePlayhead: $('timeline-playhead'),
  waveformLegend: $('waveform-legend-tag'),
  timeCurrent: $('timeline-current-time'),
  timeTotal: $('timeline-total-time'),

  vuMeterL: $('vu-meter-l'),
  vuMeterR: $('vu-meter-r'),
  vuPeakL: $('vu-peak-l'),
  vuPeakR: $('vu-peak-r'),
  clipLedL: $('clip-led-l'),
  clipLedR: $('clip-led-r'),

  spectrumCanvas: $('spectrum-canvas'),
  spectrumModeTag: $('spectrum-mode-tag'),
  livePhaseReadout: $('live-phase-readout'),
  livePhaseFill: $('live-phase-fill'),
  livePhaseNeedle: $('live-phase-needle'),

  btnPlayPause: $('btn-play-pause'),
  playBtnGlyph: $('play-btn-glyph'),
  playBtnText: $('play-btn-text'),
  btnLoopMode: $('btn-loop-mode'),
  loopBtnText: $('loop-btn-text'),
  btnRestart: $('btn-restart'),
  monitorMatrix: $('monitor-matrix'),
  volumeSlider: $('master-volume-slider'),

  // Cards & Tables
  platformCardsGrid: $('platform-cards-grid'),
  loudnessSpecList: $('loudness-spec-list'),
  integritySpecList: $('integrity-spec-list'),
  clipEventsWrap: $('clip-events-wrap'),
  clipEventsList: $('clip-events-list'),

  staticPhaseSummary: $('static-phase-summary'),
  staticPhaseSpan: $('static-phase-span'),
  staticPhaseMinPin: $('static-phase-min-pin'),
  staticPhaseAvgPin: $('static-phase-avg-pin'),
  stereoSpecList: $('stereo-spec-list'),
  widthPctLabel: $('width-pct-label'),
  widthPctFill: $('width-pct-fill'),
  balanceDbLabel: $('balance-db-label'),
  balanceDbFill: $('balance-db-fill'),
  worstPhaseCta: $('worst-phase-cta'),
  worstPhaseLabel: $('worst-phase-label'),
  btnJumpWorstPhase: $('btn-jump-worst-phase'),

  checklistSummaryPill: $('checklist-summary-pill'),
  checklistList: $('preflight-checklist'),

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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dbToMeterPct(db) {
  // Map -60 dBFS .. 0 dBFS smoothly to 0% .. 100%
  if (!Number.isFinite(db) || db <= -60) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function statusSymbol(status) {
  if (status === 'fail') return '✕';
  if (status === 'warn') return '▲';
  return '✓';
}

/* --------------------------------------------------------------------------
 * File Ingestion & Staged Broadcast DSP Analysis
 * -------------------------------------------------------------------------- */

async function handleFile(file) {
  if (!file || state.isAnalyzing) return;

  hideError();
  state.isAnalyzing = true;
  engine.stop();
  updateTransportUI();

  try {
    setProgress(8, `Reading ${file.name}...`);
    await nextFrame();

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('The selected file is empty (0 bytes).');
    }

    setProgress(24, 'Decoding audio buffer in browser...');
    await nextFrame();

    const audioCtx = engine.ensureContext();
    let audioBuffer;
    try {
      audioBuffer = await decodeAudioDataSafe(audioCtx, arrayBuffer);
    } catch (decodeErr) {
      const ext = inferFormatLabel(file.name, file.type);
      const hint = ext === 'AIFF' || ext === 'AIF'
        ? 'AIFF decoding is natively supported on Safari; on Chrome/Firefox, convert to WAV or FLAC.'
        : 'Confirm this is a valid WAV, FLAC, MP3, M4A, AAC, or OGG audio file.';
      throw new Error(`${decodeErr.message || 'Unsupported audio encoding.'} ${hint}`);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Decoded audio buffer contains zero samples.');
    }

    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }
    const sampleRate = audioBuffer.sampleRate;
    const durationSec = audioBuffer.duration;

    setProgress(46, 'Measuring ITU-R BS.1770-4 Loudness & EBU R128 LRA...');
    await nextFrame();
    const loudness = analyzeBroadcastLoudness(channels, sampleRate, 260);

    setProgress(68, 'Computing 4× oversampled polyphase True Peak (dBTP)...');
    await nextFrame();
    const truePeak = analyzeTruePeak(channels, sampleRate);

    setProgress(84, 'Auditing digital clipping, mono fold-down & phase...');
    await nextFrame();
    const integrity = analyzeIntegrity(channels, sampleRate);
    const stereo = analyzeStereoPhase(channels, sampleRate, 260);

    setProgress(95, 'Computing streaming platform matrix & waveform...');
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
        filename: file.name,
        fileSizeBytes: file.size,
        formatLabel: inferFormatLabel(file.name, file.type),
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

    // Load buffer into audition engine with auto-detected loudest 15s chorus
    const chorusStart = Math.max(0, loudness.loudestMomentSec - 1.5);
    engine.loadBuffer(audioBuffer, chorusStart, 15.0);
    applySelectedPlatform(state.selectedPlatformId, false);

    setProgress(100, 'Pre-Flight report ready.');
    await nextFrame();

    renderFullReport(report);
    hideProgress();
    showToast(`Inspected ${file.name}`);
  } catch (err) {
    hideProgress();
    showError('Could not inspect audio file', err.message || 'Unknown decoding error.');
    showToast('Audio inspection failed', true);
  } finally {
    state.isAnalyzing = false;
    els.fileInput.value = '';
  }
}

/* --------------------------------------------------------------------------
 * Render Complete Pre-Flight Dashboard
 * -------------------------------------------------------------------------- */

function renderFullReport(report) {
  els.uploadSection.classList.add('upload-compact');
  els.reportSection.classList.remove('hidden');
  els.btnHeaderNew.classList.remove('hidden');

  renderVerdictSheet(report);
  renderDeckStaticState(report);
  renderPlatformCards(report);
  renderLoudnessAndIntegrity(report);
  renderStereoAndMono(report);
  renderChecklist(report);

  drawWaveform();
  drawIdleSpectrum();
  updateLivePhaseMeter(report.stereo.globalCorrelation);
  updateTransportUI();

  els.verdictSheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderVerdictSheet(report) {
  const { meta, loudness, truePeak, psrDb, stereo, verdict } = report;

  els.verdictSheet.dataset.verdict = verdict.overallStatus;
  els.verdictStamp.textContent = `✳ ${verdict.overallStamp}`;
  els.verdictCounts.textContent = `${verdict.passCount} PASS · ${verdict.warnCount} WARN · ${verdict.failCount} FAIL`;
  els.verdictHeadline.textContent = verdict.overallHeadline;
  els.verdictSubtitle.textContent = verdict.overallSubtitle;

  els.reportFilename.textContent = meta.filename;
  const sizePart = formatBytes(meta.fileSizeBytes);
  const specParts = [
    meta.formatLabel,
    `${(meta.sampleRate / 1000).toFixed(1)} kHz`,
    meta.channelLabel,
    formatTime(meta.durationSec, true),
    sizePart,
  ].filter(Boolean);
  els.reportFileSpecs.textContent = specParts.join(' · ');

  els.heroLufs.textContent = `${loudness.integratedLufs.toFixed(1)} LUFS`;
  els.heroLufsSub.textContent = `ST MAX ${loudness.shortTermMaxLufs.toFixed(1)} · MOM ${loudness.momentaryMaxLufs.toFixed(1)}`;

  els.heroTruePeak.textContent = `${truePeak.truePeakDb.toFixed(2)} dBTP`;
  els.heroTpSub.textContent = truePeak.ispCount > 0
    ? `${truePeak.ispCount.toLocaleString()} ISP${truePeak.ispCount === 1 ? '' : 's'} > 0 dBTP`
    : `SAMPLE PEAK ${loudness.samplePeakDb.toFixed(2)} dBFS`;

  els.heroLra.textContent = `${loudness.lraLu.toFixed(1)} LU`;
  els.heroLraSub.textContent = `PSR ${psrDb.toFixed(1)} dB · CREST ${loudness.crestDb.toFixed(1)} dB`;

  const corrStr = `${stereo.globalCorrelation >= 0 ? '+' : ''}${stereo.globalCorrelation.toFixed(2)}`;
  els.heroPhase.textContent = stereo.isMono ? 'MONO (+1.00)' : corrStr;
  els.heroPhaseSub.textContent = stereo.isMono
    ? 'NATIVE MONO · 0.0 dB FOLD'
    : `<120 Hz ${stereo.lowEndCorrelation >= 0 ? '+' : ''}${stereo.lowEndCorrelation.toFixed(2)} · FOLD ${stereo.monoLossDb.toFixed(1)} dB`;
}

function renderDeckStaticState(report) {
  // Update platform gain badges on tabs
  for (const p of report.platforms) {
    const badge = els.platformTabsWrap.querySelector(`[data-gain-badge="${p.id}"]`);
    if (badge) {
      badge.textContent = formatSignedDb(p.gainDb, 1);
    }
  }

  els.abGainA.textContent = '0.0 dB';
  els.abMetaA.textContent = `${report.loudness.integratedLufs.toFixed(1)} LUFS · ${report.truePeak.truePeakDb.toFixed(2)} dBTP`;

  els.timeTotal.textContent = formatTime(report.durationSec, true);
  els.timeCurrent.textContent = formatTime(0, true);
  els.timelineScrubber.setAttribute('aria-valuemax', String(Math.round(report.durationSec)));

  // Quick Jump Labels
  els.btnJumpLoudest.textContent = `Chorus ${formatTime(report.loudness.loudestMomentSec)}`;

  if (report.integrity.worstClipSec !== null) {
    els.btnJumpWorst.textContent = `Worst Clip ${formatTime(report.integrity.worstClipSec)}`;
    els.btnJumpWorst.dataset.targetSec = String(Math.max(0, report.integrity.worstClipSec - 1.0));
  } else if (!report.stereo.isMono && report.stereo.worstPhaseSec !== null && report.stereo.minCorrelation < 0.5) {
    els.btnJumpWorst.textContent = `Worst Phase ${formatTime(report.stereo.worstPhaseSec)}`;
    els.btnJumpWorst.dataset.targetSec = String(report.stereo.worstPhaseSec);
  } else {
    els.btnJumpWorst.textContent = `True Peak ${formatTime(report.truePeak.truePeakTimeSec)}`;
    els.btnJumpWorst.dataset.targetSec = String(Math.max(0, report.truePeak.truePeakTimeSec - 1.0));
  }

  updateChorusRegionVisual();
  updatePlatformDeckUI();
}

function renderPlatformCards(report) {
  els.platformCardsGrid.innerHTML = '';

  for (const p of report.platforms) {
    const card = document.createElement('article');
    card.className = 'platform-card';

    const gainStr = formatSignedDb(p.gainDb, 1);
    const limiterNote = p.limiterEngaged
      ? ' (limiter @ -1 dB)'
      : p.headroomCapped
        ? ' (headroom cap)'
        : '';

    card.innerHTML = `
      <div>
        <div class="platform-card-head">
          <div>
            <h3 class="platform-card-title">${escapeHtml(p.name)}</h3>
            <span class="micro platform-card-target">TARGET ${p.targetLufs.toFixed(1)} LUFS · ${p.ceilingDbtp.toFixed(1)} dBTP</span>
          </div>
          <span class="status-stamp status-${p.status}">${statusSymbol(p.status)} ${escapeHtml(p.badge)}</span>
        </div>

        <div class="platform-gain-hero">
          <span class="micro platform-gain-label">PLAYBACK GAIN ADJUSTMENT</span>
          <div class="platform-gain-val">${escapeHtml(gainStr)}</div>
        </div>

        <dl class="platform-stats">
          <div class="platform-stat-row">
            <dt>Post-Norm Loudness</dt>
            <dd>${p.postNormLufs.toFixed(1)} LUFS</dd>
          </div>
          <div class="platform-stat-row">
            <dt>Post-Norm True Peak</dt>
            <dd>${p.postNormTruePeakDb.toFixed(2)} dBTP${escapeHtml(limiterNote)}</dd>
          </div>
          <div class="platform-stat-row">
            <dt>Codec Clip Risk</dt>
            <dd>${escapeHtml(p.codecRisk)}</dd>
          </div>
        </dl>

        <p class="platform-card-summary" style="margin-top: 12px;">${escapeHtml(p.summary)}</p>
        <p class="platform-card-note">${escapeHtml(p.note)}</p>
      </div>

      <div class="platform-card-foot">
        <button type="button" class="sg-btn sg-btn-outline sg-btn-sm" data-audition-platform="${escapeHtml(p.id)}">
          Audition ${escapeHtml(p.name)} on Deck →
        </button>
      </div>
    `;

    els.platformCardsGrid.appendChild(card);
  }
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

function renderLoudnessAndIntegrity(report) {
  const { loudness, truePeak, integrity, psrDb, plrDb } = report;

  const chTpStr = truePeak.channelTruePeaksDb.length >= 2
    ? `L ${truePeak.channelTruePeaksDb[0].toFixed(2)} / R ${truePeak.channelTruePeaksDb[1].toFixed(2)} dBTP`
    : `${truePeak.truePeakDb.toFixed(2)} dBTP`;

  const chSpStr = loudness.channelSamplePeaksDb.length >= 2
    ? `L ${loudness.channelSamplePeaksDb[0].toFixed(2)} / R ${loudness.channelSamplePeaksDb[1].toFixed(2)} dBFS`
    : `${loudness.samplePeakDb.toFixed(2)} dBFS`;

  appendSpecRows(els.loudnessSpecList, [
    { label: 'Integrated Loudness (BS.1770-4)', value: `${loudness.integratedLufs.toFixed(1)} LUFS` },
    { label: 'Short-Term Max (3 s)', value: `${loudness.shortTermMaxLufs.toFixed(1)} LUFS @ ${formatTime(loudness.loudestMomentSec)}` },
    { label: 'Momentary Max (400 ms)', value: `${loudness.momentaryMaxLufs.toFixed(1)} LUFS` },
    { label: 'Loudness Range (EBU R128 LRA)', value: `${loudness.lraLu.toFixed(1)} LU` },
    { label: 'True Peak (4× Polyphase FIR)', value: `${truePeak.truePeakDb.toFixed(2)} dBTP @ ${formatTime(truePeak.truePeakTimeSec)}`, flag: truePeak.truePeakDb > -1.0 },
    { label: 'Channel True Peaks', value: chTpStr },
    { label: 'Sample Peak (Digital Full Scale)', value: `${loudness.samplePeakDb.toFixed(2)} dBFS` },
    { label: 'Channel Sample Peaks', value: chSpStr },
    { label: 'Inter-Sample Peaks (> 0.0 dBTP)', value: `${truePeak.ispCount.toLocaleString()}`, flag: truePeak.ispCount > 0 },
    { label: 'Ceiling Breaches (> -1.0 dBTP)', value: `${truePeak.ceilingBreachCount.toLocaleString()}`, flag: truePeak.ceilingBreachCount > 0 },
    { label: 'Unweighted RMS / Crest Factor', value: `${loudness.rmsDb.toFixed(1)} dBFS / ${loudness.crestDb.toFixed(1)} dB` },
    { label: 'PSR (Peak to Short-Term) / PLR', value: `${psrDb.toFixed(1)} dB / ${plrDb.toFixed(1)} dB` },
  ]);

  appendSpecRows(els.integritySpecList, [
    { label: 'Clipped Samples (≥ 0.9999)', value: integrity.clippedSampleCount.toLocaleString(), flag: integrity.clippedSampleCount > 0 },
    { label: 'Hard Clip Bursts (≥ 3 consecutive)', value: String(integrity.clipBurstCount), flag: integrity.clipBurstCount > 0 },
    { label: 'DC Offset (Max Channel Bias)', value: `${integrity.dcOffsetPct.toFixed(2)}% (${integrity.dcOffsetDb <= -119 ? '-∞' : integrity.dcOffsetDb} dBFS)`, flag: integrity.dcOffsetMax > 0.005 },
    { label: 'Head Silence (< -60 dBFS)', value: `${integrity.headSilenceSec.toFixed(2)} s${integrity.headHardStart ? ' · HARD START' : ''}`, flag: integrity.headHardStart },
    { label: 'Tail Silence (< -60 dBFS)', value: `${integrity.tailSilenceSec.toFixed(2)} s${integrity.tailHardEnd ? ' · HARD END' : ''}`, flag: integrity.tailHardEnd },
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

function renderStereoAndMono(report) {
  const { stereo } = report;

  const avgPct = ((stereo.globalCorrelation + 1) / 2) * 100;
  const minPct = ((stereo.minCorrelation + 1) / 2) * 100;
  const spanLeft = Math.min(avgPct, minPct);
  const spanWidth = Math.max(1.5, Math.abs(avgPct - minPct));

  els.staticPhaseAvgPin.style.left = `${avgPct}%`;
  els.staticPhaseMinPin.style.left = `${minPct}%`;
  els.staticPhaseSpan.style.left = `${spanLeft}%`;
  els.staticPhaseSpan.style.width = `${spanWidth}%`;

  const fmtCorr = (r) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}`;
  els.staticPhaseSummary.textContent = stereo.isMono
    ? 'NATIVE MONO · +1.00'
    : `AVG ${fmtCorr(stereo.globalCorrelation)} · MIN ${fmtCorr(stereo.minCorrelation)}`;

  appendSpecRows(els.stereoSpecList, [
    { label: 'Channel Format', value: stereo.isMono ? 'Native Mono (1 ch)' : `${report.meta.channelLabel} (${report.meta.numChannels} ch)` },
    { label: 'Global Phase Correlation', value: fmtCorr(stereo.globalCorrelation), flag: !stereo.isMono && stereo.globalCorrelation < 0.2 },
    {
      label: 'Min Windowed Phase (500 ms)',
      value: stereo.worstPhaseSec !== null
        ? `${fmtCorr(stereo.minCorrelation)} @ ${formatTime(stereo.worstPhaseSec, true)}`
        : fmtCorr(stereo.minCorrelation),
      flag: !stereo.isMono && stereo.minCorrelation < -0.25,
    },
    {
      label: 'Low-End (< 120 Hz) Correlation',
      value: stereo.isMono
        ? '+1.00 (Mono)'
        : stereo.lowEndHasContent
          ? fmtCorr(stereo.lowEndCorrelation)
          : 'Minimal Sub Energy',
      flag: !stereo.isMono && stereo.lowEndHasContent && stereo.lowEndCorrelation < 0.5,
    },
    { label: 'Mono Fold-Down Retention', value: `${stereo.monoLossDb.toFixed(2)} dB`, flag: !stereo.isMono && stereo.monoLossDb < -3.0 },
    { label: 'Mono Sum Peak', value: `${stereo.monoPeakDb.toFixed(2)} dBFS` },
    { label: 'Negative Phase Duration', value: `${stereo.negativePhasePct.toFixed(1)}% of active audio`, flag: !stereo.isMono && stereo.negativePhasePct > 5 },
    { label: 'L / R Channel Balance', value: formatSignedDb(stereo.lrBalanceDb, 2), flag: !stereo.isMono && Math.abs(stereo.lrBalanceDb) > 1.5 },
  ]);

  // Stereo Width bar
  els.widthPctLabel.textContent = `${stereo.stereoWidthPct.toFixed(1)}%`;
  els.widthPctFill.style.width = `${Math.max(0, Math.min(100, stereo.stereoWidthPct))}%`;

  // Centered L/R balance bar (-6 dB .. +6 dB full travel)
  const balLabel = Math.abs(stereo.lrBalanceDb) < 0.05
    ? '0.0 dB (Centered)'
    : `${formatSignedDb(stereo.lrBalanceDb, 2)} (${stereo.lrBalanceDb > 0 ? 'Right' : 'Left'})`;
  els.balanceDbLabel.textContent = balLabel;
  const clampedBal = Math.max(-6, Math.min(6, stereo.lrBalanceDb));
  const halfPct = (Math.abs(clampedBal) / 6) * 50;
  if (clampedBal >= 0) {
    els.balanceDbFill.style.left = '50%';
    els.balanceDbFill.style.width = `${halfPct}%`;
  } else {
    els.balanceDbFill.style.left = `${50 - halfPct}%`;
    els.balanceDbFill.style.width = `${halfPct}%`;
  }

  if (!stereo.isMono && stereo.worstPhaseSec !== null && stereo.minCorrelation < 0.4) {
    els.worstPhaseCta.classList.remove('hidden');
    els.worstPhaseLabel.textContent = `LOWEST PHASE (${fmtCorr(stereo.minCorrelation)}) AT ${formatTime(stereo.worstPhaseSec, true)}`;
  } else {
    els.worstPhaseCta.classList.add('hidden');
  }
}

function renderChecklist(report) {
  const { verdict } = report;
  els.checklistSummaryPill.textContent = `${verdict.passCount} PASS · ${verdict.warnCount} WARN · ${verdict.failCount} FAIL`;
  els.checklistList.innerHTML = '';

  for (const item of verdict.checks) {
    const li = document.createElement('li');
    li.className = 'checklist-item';
    li.innerHTML = `
      <div>
        <span class="status-stamp status-${item.status}">${statusSymbol(item.status)} ${escapeHtml(item.badge)}</span>
      </div>
      <div>
        <div class="checklist-label">${escapeHtml(item.label)}</div>
        <p class="checklist-detail">${escapeHtml(item.detail)}</p>
      </div>
      <div class="checklist-val">${escapeHtml(item.value)}</div>
    `;
    els.checklistList.appendChild(li);
  }
}

/* --------------------------------------------------------------------------
 * Fragment Deck State & Interactive Controls
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
  updatePlatformDeckUI();

  if (announce) {
    showToast(`Deck B set to ${plat.name} (${formatSignedDb(plat.gainDb, 1)})`);
  }
}

function updatePlatformDeckUI() {
  const plat = getSelectedPlatform();
  if (!plat) return;

  for (const btn of els.platformTabsWrap.querySelectorAll('.platform-tab')) {
    const isSel = btn.dataset.platform === plat.id;
    btn.classList.toggle('active', isSel);
    btn.setAttribute('aria-selected', String(isSel));
  }

  els.abTitleB.textContent = `B · ${plat.name.toUpperCase()} NORMALISED`;
  els.abGainB.textContent = formatSignedDb(plat.gainDb, 1);

  const limiterStr = plat.limiterEngaged
    ? ' · -1 dB LIMITER ACTIVE'
    : !plat.gainDb
      ? ' · NO GAIN CHANGE'
      : '';
  els.abMetaB.textContent = `PLAYS AT ${plat.postNormLufs.toFixed(1)} LUFS · ${plat.postNormTruePeakDb.toFixed(2)} dBTP${limiterStr}`;

  const isA = engine.activeSide === 'A';
  els.btnSideA.classList.toggle('active-play', isA);
  els.btnSideB.classList.toggle('active-play', !isA);
  els.btnSideA.setAttribute('aria-pressed', String(isA));
  els.btnSideB.setAttribute('aria-pressed', String(!isA));

  els.deckActiveReadout.textContent = isA
    ? 'ORIGINAL MASTER · 0.0 dB'
    : `${plat.name.toUpperCase()} NORMALISED · ${formatSignedDb(plat.gainDb, 1)}`;
}

function updateMonitorMatrixUI() {
  const mode = engine.monitorMode;
  for (const btn of els.monitorMatrix.querySelectorAll('.deck-seg-btn')) {
    const active = btn.dataset.monitor === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }

  const label = mode === 'mono'
    ? 'MONO SUM · 48-BAND FFT'
    : mode === 'side'
      ? 'SIDE (L − R) · 48-BAND FFT'
      : 'STEREO · 48-BAND FFT';
  els.spectrumModeTag.textContent = label;
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
  els.loopBtnText.textContent = engine.loopChorus ? 'Loop: Chorus (15s)' : 'Loop: Full';
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
 * Waveform + Clip Markers + Short-Term LUFS / Phase Correlation Canvas
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

  // Subtle horizontal reference center line
  const midY = h * 0.5;
  ctx.strokeStyle = '#242424';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  // Waveform amplitude bars
  const peaks = report.waveformPeaks;
  const count = peaks.length;
  const barStep = w / Math.max(1, count);
  const barW = Math.max(1, barStep - 1);
  const maxBarHalf = h * 0.43;

  for (let i = 0; i < count; i++) {
    const p = peaks[i];
    const halfH = Math.max(1.5, p * maxBarHalf);
    const x = i * barStep;
    ctx.fillStyle = state.waveformOverlay === 'none' ? '#8c8c8c' : '#4a4a4a';
    ctx.fillRect(x, midY - halfH, barW, halfH * 2);
  }

  const dur = Math.max(0.01, report.durationSec);

  // Overlay 1: Short-Term LUFS Curve (-34 LUFS bottom .. -4 LUFS top)
  if (state.waveformOverlay === 'lufs' && report.loudness.shortTermTimeline.length > 1) {
    const minLufs = -34;
    const maxLufs = -4;
    const mapLufsY = (val) => {
      const clamped = Math.max(minLufs, Math.min(maxLufs, val));
      const norm = (clamped - minLufs) / (maxLufs - minLufs);
      return h - 10 - norm * (h - 22);
    };

    // -14 LUFS dashed streaming target guide
    const y14 = mapLufsY(-14);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(242, 242, 242, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y14);
    ctx.lineTo(w, y14);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(242, 242, 242, 0.55)';
    ctx.font = '700 9px "Courier New", monospace';
    ctx.fillText('-14 LUFS', w - 54, Math.max(12, y14 - 4));

    // Short-term LUFS trace
    const pts = report.loudness.shortTermTimeline;
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = Math.min(w, (pts[i].timeSec / dur) * w);
      const y = mapLufsY(pts[i].lufs);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Overlay 2: Stereo Phase Correlation Curve (+1 top .. 0 mid .. -1 bottom)
  if (state.waveformOverlay === 'phase' && report.stereo.phaseTimeline.length > 1) {
    const mapPhaseY = (r) => {
      const clamped = Math.max(-1, Math.min(1, r));
      return h - 10 - ((clamped + 1) * 0.5) * (h - 20);
    };

    const yZero = mapPhaseY(0);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(242, 242, 242, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yZero);
    ctx.lineTo(w, yZero);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(242, 242, 242, 0.6)';
    ctx.font = '700 9px "Courier New", monospace';
    ctx.fillText('r = 0.0', w - 46, yZero - 4);

    const pts = report.stereo.phaseTimeline;

    // Highlight negative correlation dips cleanly
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].r < 0) {
        const x = (pts[i].timeSec / dur) * w;
        const y = mapPhaseY(pts[i].r);
        const segW = Math.max(2, w / pts.length);
        ctx.fillRect(x - segW * 0.5, yZero, segW, Math.max(2, y - yZero));
      }
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = Math.min(w, (pts[i].timeSec / dur) * w);
      const y = mapPhaseY(pts[i].r);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Hard Clip Marker Ticks (stark white ticks along top edge)
  const clips = report.integrity.clipMarkerTimes;
  if (clips && clips.length > 0) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < clips.length; i++) {
      const x = Math.max(1, Math.min(w - 2, (clips[i] / dur) * w));
      ctx.fillRect(x, 0, 2, 14);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(x, 14, 1, h - 14);
      ctx.fillStyle = '#ffffff';
    }
  }

  ctx.restore();

  // Update overlay legend badge
  const clipNote = clips && clips.length > 0 ? ` · ${clips.length} CLIP TICKS` : '';
  if (state.waveformOverlay === 'lufs') {
    els.waveformLegend.textContent = `SHORT-TERM LUFS OVERLAY${clipNote} · CLICK TO SEEK`;
  } else if (state.waveformOverlay === 'phase') {
    els.waveformLegend.textContent = `PHASE CORRELATION (-1..+1)${clipNote} · CLICK TO SEEK`;
  } else {
    els.waveformLegend.textContent = `WAVEFORM PEAK ENVELOPE${clipNote} · CLICK TO SEEK`;
  }
}

/* --------------------------------------------------------------------------
 * Real-Time Telemetry Loop (60 fps VU + 48-Band FFT + Live Phase + Playhead)
 * -------------------------------------------------------------------------- */

function drawIdleSpectrum() {
  const canvas = els.spectrumCanvas;
  const dims = resizeCanvasToDisplaySize(canvas);
  if (!dims) return;
  const { w, h, dpr } = dims;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  const bands = 48;
  const gap = 2;
  const barW = Math.max(2, (w - gap * (bands + 1)) / bands);
  ctx.fillStyle = '#252525';
  for (let i = 0; i < bands; i++) {
    const x = gap + i * (barW + gap);
    ctx.fillRect(x, h - 4, barW, 3);
  }
  ctx.restore();
}

function drawSpectrum(fftData) {
  if (!fftData) {
    drawIdleSpectrum();
    return;
  }
  const canvas = els.spectrumCanvas;
  const dims = resizeCanvasToDisplaySize(canvas);
  if (!dims) return;
  const { w, h, dpr } = dims;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  // Subtle horizontal reference grid
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const gy = Math.round((h * g) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  const bands = 48;
  const binCount = fftData.length;
  const gap = 2;
  const barW = Math.max(2, (w - gap * (bands + 1)) / bands);

  for (let i = 0; i < bands; i++) {
    // Quasi-logarithmic frequency bin mapping across 128 FFT bins
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const b0 = Math.floor(Math.pow(t0, 1.55) * (binCount - 1));
    const b1 = Math.max(b0 + 1, Math.floor(Math.pow(t1, 1.55) * binCount));

    let peak = 0;
    for (let b = b0; b < b1 && b < binCount; b++) {
      if (fftData[b] > peak) peak = fftData[b];
    }

    const norm = peak / 255;
    const barH = Math.max(2, norm * (h - 10));
    const x = gap + i * (barW + gap);
    const y = h - barH;

    // Monochrome brightness scales with band energy
    const lum = Math.round(96 + norm * 148);
    ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
    ctx.fillRect(x, y, barW, barH);

    // Falling white peak cap
    if (barH >= state.spectrumPeakCaps[i]) {
      state.spectrumPeakCaps[i] = barH;
    } else {
      state.spectrumPeakCaps[i] = Math.max(2, state.spectrumPeakCaps[i] - 1.1);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, h - state.spectrumPeakCaps[i] - 2, barW, 1.5);
  }

  ctx.restore();
}

function updateLivePhaseMeter(r) {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(r) ? r : 1));
  const pct = ((clamped + 1) * 0.5) * 100;

  els.livePhaseReadout.textContent = `${clamped >= 0 ? '+' : ''}${clamped.toFixed(2)}`;
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
  els.timeCurrent.textContent = formatTime(cur, true);
  els.timelineScrubber.setAttribute('aria-valuenow', String(Math.round(cur)));
}

function startAnimationLoop() {
  if (state.rafId !== null) return;

  const tick = () => {
    const tel = engine.getTelemetry();

    // Update L/R VU meters & peak holds
    const pctL = dbToMeterPct(tel.peakLDb);
    const pctR = dbToMeterPct(tel.peakRDb);
    const holdL = dbToMeterPct(tel.peakHoldLDb);
    const holdR = dbToMeterPct(tel.peakHoldRDb);

    els.vuMeterL.style.height = `${pctL}%`;
    els.vuMeterR.style.height = `${pctR}%`;

    els.vuPeakL.style.bottom = `${holdL}%`;
    els.vuPeakL.style.opacity = holdL > 2 ? '1' : '0';
    els.vuPeakR.style.bottom = `${holdR}%`;
    els.vuPeakR.style.opacity = holdR > 2 ? '1' : '0';

    els.clipLedL.classList.toggle('clipping', tel.clipL);
    els.clipLedR.classList.toggle('clipping', tel.clipR);

    if (tel.active) {
      drawSpectrum(tel.fftData);
      updateLivePhaseMeter(tel.correlation);
      updatePlayheadVisuals();
      state.rafId = requestAnimationFrame(tick);
    } else if (holdL > 1 || holdR > 1 || tel.clipL || tel.clipR) {
      drawIdleSpectrum();
      updatePlayheadVisuals();
      state.rafId = requestAnimationFrame(tick);
    } else {
      drawIdleSpectrum();
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
 * Export Markdown & Copy Summary
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
  showToast('Exported Pre-Flight certificate (.md)');
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
    showToast('Pre-Flight summary copied to clipboard');
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

  // File Selection
  els.btnSelectFile.addEventListener('click', (e) => {
    e.stopPropagation();
    els.fileInput.click();
  });

  els.dropzoneClickTarget.addEventListener('click', () => {
    els.fileInput.click();
  });

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  // Drag & Drop (on dropzone + whole document drop prevention)
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

  // Platform Selector Tabs on Deck
  els.platformTabsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.platform-tab');
    if (!btn || !btn.dataset.platform) return;
    applySelectedPlatform(btn.dataset.platform, false);
  });

  // Platform Cards "Audition on Deck ->" button
  els.platformCardsGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-audition-platform]');
    if (!btn) return;
    applySelectedPlatform(btn.dataset.auditionPlatform, false);
    await engine.setActiveSide('B', true);
    updateTransportUI();
    els.studioDeck.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // A / B Instant Switch Cards
  els.btnSideA.addEventListener('click', async () => {
    await engine.setActiveSide('A', true);
    updateTransportUI();
  });

  els.btnSideB.addEventListener('click', async () => {
    await engine.setActiveSide('B', true);
    updateTransportUI();
  });

  // Overlay Toggle
  els.overlayGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.deck-seg-btn');
    if (!btn || !btn.dataset.overlay) return;
    state.waveformOverlay = btn.dataset.overlay;
    for (const b of els.overlayGroup.querySelectorAll('.deck-seg-btn')) {
      const act = b.dataset.overlay === state.waveformOverlay;
      b.classList.toggle('active', act);
      b.setAttribute('aria-pressed', String(act));
    }
    drawWaveform();
  });

  // Quick Jump Buttons
  els.btnJumpIntro.addEventListener('click', () => jumpAndAudition(0));
  els.btnJumpLoudest.addEventListener('click', () => {
    if (!state.report) return;
    jumpAndAudition(state.report.loudness.loudestMomentSec);
  });
  els.btnJumpWorst.addEventListener('click', () => {
    const sec = Number(els.btnJumpWorst.dataset.targetSec || 0);
    jumpAndAudition(sec);
  });
  els.btnJumpWorstPhase.addEventListener('click', () => {
    if (!state.report || state.report.stereo.worstPhaseSec === null) return;
    jumpAndAudition(state.report.stereo.worstPhaseSec, 'mono');
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

  els.btnRestart.addEventListener('click', async () => {
    if (!state.report) return;
    const startTarget = engine.loopChorus ? engine.chorusStart : 0;
    await engine.seek(startTarget, true);
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
  els.btnExportBottom.addEventListener('click', exportMarkdownReport);
  els.btnCopyTop.addEventListener('click', copySummaryToClipboard);
  els.btnCopyBottom.addEventListener('click', copySummaryToClipboard);

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

  // Redraw HiDPI canvases on resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.report) {
        drawWaveform();
        if (!engine.isPlaying) drawIdleSpectrum();
      }
    }, 100);
  });
}

initEvents();
