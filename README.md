# Blackboard Lecture Tutor Extension

This Manifest V3 extension supports authorized Class.com lecture pages. Phase 0 provides:

- A content script that owns player detection, toolbar controls, and a full-height, bounded, resizable Shadow DOM tutor sidebar that shares horizontal space with the player.
- A service worker that observes supported MP4 requests, keeps signed URLs out of page context, and starts Chrome downloads.
- Stable lecture identity derived from Class.com recording, session, or meeting identifiers rather than signed URLs.
- Playback timestamp capture across the top page and supported Class.com frames.
- Explicit states for missing, ready, expired, active, completed, and failed downloads.

Phase 1 adds an end-to-end local experiment:

- A local tutor API keeps model credentials out of the browser extension.
- Time-aware retrieval selects ASR transcript cues and representative frames that are at or before the student's playback position.
- The sidebar requires evidence-sharing consent, can compare `Transcript + visuals` with `Transcript only`, and renders grounded timestamp links.
- A replaceable provider interface isolates model-specific API code. Text and vision models are selected independently with environment variables.
- Every request records provider, model, strategy, latency, token usage, pricing version, estimated cost, status, and a trace ID in a private JSONL ledger. Prompt and lecture content are not written to that ledger.

## Development

Install dependencies and run all checks:

```sh
npm install
npm run check
```

Load the repository root as an unpacked extension in Chrome after building. Chrome reads `manifest.json`, which references the generated `dist/background.js` and `dist/content.js` files.

## Phase 1 experiment

1. Copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and keep that file local.
2. Download an authorized lecture and produce a timestamped ASR transcript in WebVTT format.
3. Copy the stable lecture ID from the tutor sidebar, then prepare local evidence:

```sh
npm run phase1:prepare -- \
    --lecture-id "classcom:recording:recording-123" \
    --title "Lecture title" \
    --transcript "/absolute/path/to/asr-transcript.vtt" \
    --video "/absolute/path/to/authorized-recording.mp4"
```

The preparation command uses FFmpeg scene changes to extract up to 120 representative frames. Private manifests, transcripts, frames, `.env`, and cost logs are ignored by Git.

Start the API, rebuild the extension, and ask from the sidebar:

```sh
npm run phase1:server
npm run build
```

The API binds to `127.0.0.1:4387`. It sends only retrieved transcript excerpts and selected images to the configured provider; it never sends the signed recording URL, cookies, or the full video.

## Models and costs

Switch models without changing application code:

```dotenv
TUTOR_PROVIDER=openai
TUTOR_TEXT_MODEL=gpt-6-luna
TUTOR_VISION_MODEL=gpt-6.1-terra
TUTOR_REASONING_EFFORT=low
```

`server/ModelProvider.ts` is the provider contract and `server/providerFactory.ts` is the only provider selection point. Add an adapter there to use another provider. Unknown model IDs still record token usage; set `TUTOR_MODEL_PRICING_JSON` for multiple custom models or the shorter `TUTOR_*_USD_PER_MILLION` variables from `.env.example` for one custom rate card.

Each answer shows its model, input/output tokens, estimated cost, and short trace ID. Aggregate the append-only ledger with:

```sh
npm run phase1:costs
npm run phase1:costs -- --lecture-id "classcom:recording:recording-123"
```

The raw ledger is `logs/tutor-costs.jsonl`. The running API also exposes the same summary at `GET /v1/costs` and per lecture with the `lectureId` query parameter.

## Runtime boundaries

- `src/background.ts` and `src/background/` own browser-level request observation, ephemeral signed-media state, and downloads.
- `src/content.ts` and `src/content/` own DOM/player interaction and the user interface.
- `src/shared/` contains validated message contracts plus pure lecture/media identification logic.
- `server/` owns local evidence retrieval, provider adapters, grounded-answer validation, and cost traces.
- `phase1-data/` is the ignored local evidence boundary for the experiment.

Signed recording URLs are stored only in `chrome.storage.session` so service-worker suspension does not lose a currently usable link. They are never sent to the content script or logged. Links close to expiry are rejected with recovery guidance.
