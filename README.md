# Pre-Flight (`TOOL / 002`) — Saint Gordon Collective

> **Broadcast Loudness, True Peak, Phase & Streaming Release Checker** — 100% client-side in your browser, built in the editorial monochrome studio style of [Saint Gordon Collective](https://saintgordon.vercel.app).

**Live App:** [https://firewallaby.github.io/pre-flight/](https://firewallaby.github.io/pre-flight/)

---

## What It Does

Drop any stereo or mono master audio file directly into your browser for a complete broadcast & streaming pre-flight audit — zero server uploads, zero external dependencies, and instant clickless A/B auditioning at exact Spotify, Apple Music, YouTube, and TikTok playback levels.

### Core Capabilities

- **100% Client-Side & Private:** Audio is decoded and analyzed locally via the Web Audio API and pure JavaScript ES Modules. Nothing ever leaves your machine.
- **Broadcast Loudness (ITU-R BS.1770-4 & EBU R128):**
  - Two-stage gated **Integrated Loudness (LUFS)** (`400 ms` blocks, `75%` overlap, `-70 LUFS` absolute gate, `-10 LU` relative gate).
  - **Momentary Max (`400 ms`)**, **Short-Term Max (`3 s`)** + full Short-Term LUFS timeline overlay, and **EBU R128 Tech 3342 Loudness Range (`LRA` in LU)** (`-70 LUFS` abs / `-20 LU` rel, 95th − 10th percentile).
  - Unweighted **RMS**, **Crest Factor**, **PSR** (Peak-to-Short-Term Loudness Ratio), and **PLR**.
- **Genuine 4× Oversampled True Peak (`dBTP`):**
  - 4-phase, 12-tap Kaiser-windowed sinc polyphase FIR interpolation (ITU-R BS.1770-4 Annex 2 style) per channel with lossless L1-bound block pruning.
  - Reports overall & L/R `dBTP`, **Inter-Sample Peaks (`> 0.0 dBTP`)**, and **`> -1.0 dBTP` streaming ceiling breaches**.
- **Signal Integrity & Digital Clipping Audit:**
  - Counts full-scale clipped samples (`≥ 0.9999`), detects consecutive **hard clip bursts (`≥ 3` samples)** with clickable timestamps and waveform markers, checks **DC offset**, and measures **Head / Tail silence** trim.
- **Mono Compatibility & Stereo Phase Correlation:**
  - Global Pearson phase correlation (`-1.00 .. +1.00`), **500 ms windowed minimum phase** with worst-section jump button and timeline overlay, and **sub-120 Hz low-end phase correlation** (2nd-order Butterworth LPF).
  - **Mono Fold-Down Retention (`dB`)**, Mono Peak, Stereo Width `%`, and L/R Channel Balance — with graceful handling for native mono files.
- **Streaming Platform Normalization Engine:**
  - Exact playback gain adjustment, post-normalization LUFS & True Peak, codec clipping risk, and editorial `PASS` / `CAUTION` / `CLIP RISK` stamps for **Spotify (`-14 LUFS`)**, **Apple Music (`-16 LUFS` Sound Check)**, **YouTube (`-14 LUFS`, attenuate-only)**, and **TikTok (`-14 LUFS`)**.
- **Fragment Deck A/B Normalised Audition Console:**
  - Clickless `8 ms` sample-locked A/B switch between **Original Master (`0.0 dB`)** and **Platform Normalised** playback.
  - **Stereo / Mono / Side (`L − R`)** monitoring matrix, interactive full-track waveform scrubber with clip markers + Short-Term LUFS / Phase overlays, 15 s Loudest Chorus Loop toggle, true L/R VU meters + clip LEDs, real-time Phase Correlation bar, and 48-band monochrome FFT spectrum.
- **Export & Share:** One-click **Markdown Pre-Flight Certificate (`.md`)** download and compact clipboard summary.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause audition playback |
| `1` | Switch instantly to **A · Original Master (`0.0 dB`)** |
| `2` | Switch instantly to **B · Platform Normalised** |
| `M` | Toggle **Mono Sum** monitoring |
| `S` | Toggle **Side (`L − R`)** monitoring |
| `L` | Toggle **15 s Loudest Chorus Loop** vs **Full Track** |
| `R` | Restart from beginning (or chorus loop start) |

---

## Browser Compatibility

Pure vanilla HTML, CSS, and ES Modules with zero build step and zero runtime dependencies:

- **Chrome, Edge, Firefox, Safari & iOS Safari:** Supports WAV, FLAC, MP3, M4A, AAC, and OGG via cross-browser `AudioContext || webkitAudioContext` and dual Promise/callback `decodeAudioDataSafe`.
- **AIFF:** Natively supported on Safari; convert to WAV or FLAC when inspecting in Chrome/Firefox.

---

## Development & Tests

Run the zero-dependency DSP & normalization test suite directly with Node.js (Node 20+):

```bash
node --test tests/preflight-dsp.test.mjs
```

---

## Brand & License

- Built by **[Saint Gordon Collective](https://saintgordon.vercel.app)** — *Independent sound. Imperfect by design.*
- Code licensed under the [MIT License](LICENSE). Bundled display fonts follow the notes in [assets/fonts/ENGRAVERS-LICENSE-NOTES.md](assets/fonts/ENGRAVERS-LICENSE-NOTES.md) and [assets/fonts/OFL.txt](assets/fonts/OFL.txt).
