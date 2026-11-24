# Pre-Flight (`TOOL / 002`) — Saint Gordon Collective

> **Plain-English Release Checker & Streaming A/B Player** — 100% client-side in your browser, built in the editorial monochrome studio style of [Saint Gordon Collective](https://saintgordon.vercel.app).

**Live App:** [https://saintgordon.github.io/pre-flight/](https://saintgordon.github.io/pre-flight/)

---

## What It Does

Drop your finished song before uploading to Spotify, Apple Music, YouTube, or TikTok. Pre-Flight runs broadcast-grade loudness, 4× oversampled true-peak, clipping, and stereo/mono phase analysis right inside your browser — then translates every issue into **plain English with exact step-by-step DAW fix instructions** and lets you **hear how loud streaming apps will actually play it**.

### How It Works

1. **Drop Your Song (or Click `♪ Try Demo Song`)** — Supports WAV, FLAC, MP3, M4A, AAC, OGG, and AIFF (on Safari). Nothing ever leaves your device.
2. **Instant Verdict & Step-by-Step Fix Plan** — Immediately see whether your song is **Ready to Upload**, **Almost Ready**, or needs fixes first, with numbered DAW steps (e.g., limiter True Peak ceiling, fixing clipping bursts, tightening mono bass below 120 Hz, trimming abrupt starts/ends, removing DC offset) and 1-click buttons to jump straight to problem spots.
3. **Streaming Volume & Clickless A/B Player** — Click **Spotify (`-14 LUFS`)**, **Apple Music (`-16 LUFS`)**, **YouTube (`-14 LUFS`)**, or **TikTok (`-14 LUFS`)** to flip clicklessly between **Your Original File** and exact streaming playback level, plus **Stereo / Phone (Mono) / Side** monitoring and chorus looping.
4. **Full Technical Numbers (Collapsible)** — Broadcast-accurate ITU-R BS.1770-4 Integrated/Short-Term/Momentary LUFS, EBU R128 LRA, 4× polyphase True Peak (`dBTP`) & inter-sample peaks, crest factor, PSR, global/windowed/sub-120 Hz phase correlation, mono fold-down retention, DC offset, and silence trim tucked neatly in an expandable drawer for mastering engineers.
5. **Copy & Export** — Copy a plain-English Fix Checklist to your clipboard or download a full Markdown report (`.md`).

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause audition playback |
| `1` | Switch instantly to **Your Original File (`0.0 dB`)** |
| `2` | Switch instantly to **Selected Streaming Platform** |
| `M` | Toggle **Phone (Mono)** monitoring |
| `S` | Toggle **Side (`L − R`)** monitoring |
| `L` | Toggle **Loop Chorus (15 s)** vs **Full Song** |
| `R` | Restart from beginning (or chorus loop start) |

---

## Browser Compatibility

Pure vanilla HTML, CSS, and ES Modules with zero build step and zero runtime dependencies:

- **Chrome, Edge, Firefox, Safari & iOS Safari:** Supports WAV, FLAC, MP3, M4A, AAC, and OGG via cross-browser `AudioContext || webkitAudioContext` and dual Promise/callback `decodeAudioDataSafe`.
- **AIFF:** Natively supported on Safari; export as WAV or FLAC when checking in Chrome or Firefox.

---

## Development & Tests

Run the zero-dependency DSP, normalization, and plain-English fix-step test suite directly with Node.js (Node 20+):

```bash
node --test tests/preflight-dsp.test.mjs
```

---

## Brand & License

- Built by **[Saint Gordon Collective](https://saintgordon.vercel.app)** — *Independent sound. Imperfect by design.*
- Source on GitHub: [https://github.com/saintgordon/pre-flight](https://github.com/saintgordon/pre-flight)
- Code licensed under the [MIT License](LICENSE). Bundled display fonts follow the notes in [assets/fonts/ENGRAVERS-LICENSE-NOTES.md](assets/fonts/ENGRAVERS-LICENSE-NOTES.md) and [assets/fonts/OFL.txt](assets/fonts/OFL.txt).
