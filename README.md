# Blackboard Lecture Tutor Extension

> **Draft status:** The Phase 2 ingestion and playback-aware tutoring workflow is a rough functional draft. Its architecture, retrieval quality, UX, and production readiness will be revisited and improved in Phase 4.

This Manifest V3 extension supports authorized Class.com lecture pages. Phase 0 provides:

- A content script that owns player detection, toolbar controls, and a full-height, bounded, resizable Shadow DOM tutor sidebar that shares horizontal space with the player.
- A service worker that observes supported MP4 requests, keeps signed URLs out of page context, and starts Chrome downloads.
- Stable lecture identity derived from Class.com recording, session, or meeting identifiers rather than signed URLs.
- Playback timestamp capture across the top page and supported Class.com frames.
- Explicit states for missing, ready, expired, active, completed, and failed downloads.

Phase 1 added an end-to-end local experiment:

- A local tutor API keeps model credentials out of the browser extension.
- Time-aware retrieval selects ASR transcript cues and representative frames from the current moment and at most the preceding 10 minutes.
- Deterministic scope guardrails reject full-lecture analysis and distant or ambiguous earlier references; the sidebar recommends downloading the recording for full-lecture questions in a chat model.
- The sidebar requires evidence-sharing consent, can compare `Transcript + visuals` with `Transcript only`, and renders grounded timestamp links.
- A replaceable provider interface isolates model-specific API code. Text and vision models are selected independently with environment variables.
- Every request records provider, model, strategy, latency, token usage, pricing version, estimated cost, status, and a trace ID in a private JSONL ledger. Prompt and lecture content are not written to that ledger.

Phase 2 replaces the one-off evidence manifest with durable local ingestion and retrieval:

- A private persistent registry tracks lectures, versioned artifacts, stage-level readiness, and leased processing jobs.
- The first tutor question starts an idempotent ingestion job. Duplicate questions, tabs, and refreshes reuse the same job and artifacts.
- On the first question, the extension securely hands the observed authorized MP4 to the local API for acquisition; timestamped ASR publishes first, while metadata inspection and deterministic FFmpeg scene extraction run in parallel.
- Concept-boundary segments fuse transcript and slide intervals, then receive configurable baseline embeddings.
- Retrieval combines watched-time proximity, exact technical terms, and semantic similarity while preserving source evidence IDs.
- Failed jobs retry with backoff, keep completed stages, and expose partial readiness to the sidebar.

## Development

Install dependencies and run all checks:

```sh
npm install
npm run check
```

Load the repository root as an unpacked extension in Chrome after building. Chrome reads `manifest.json`, which references the generated `dist/background.js` and `dist/content.js` files.

## Phase 2 local workflow

1. Copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and keep that file local.
2. Start the API and rebuild the extension:

```sh
npm run phase2:server
npm run build
```

3. Open an authorized Class.com recording, let it begin playback so the extension can observe its authorized MP4, confirm the evidence-sharing consent, and ask a question.

The first question automatically acquires the recording to private local storage and starts a durable job lease. The pipeline extracts audio and produces a timestamped transcript with the configured ASR model, inspects media with FFprobe, extracts representative scene frames, builds semantic lecture segments, and creates embeddings. Transcript-only questions can work as soon as that stage is ready while remaining stages continue. The sidebar polls stage status and shows which capabilities are usable.

The API binds to `127.0.0.1:4387`. Private registry data and artifacts live under `phase2-data/` by default and are ignored by Git. The signed recording URL is sent only from the extension service worker to this local API, never to page scripts, logs, or model providers. Only required audio chunks for transcription plus retrieved transcript excerpts and selected images are sent to the configured AI provider. The managed local recording is deleted after successful ingestion.

The Phase 1 preparation command remains available for reproducing the original experiment, but the running API now reads only Phase 2 durable storage.

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
npm run phase2:costs
npm run phase2:costs -- --lecture-id "classcom:recording:recording-123"
```

The raw ledger is `logs/tutor-costs.jsonl`. The running API also exposes the same summary at `GET /v1/costs` and per lecture with the `lectureId` query parameter.

## Runtime boundaries

- `src/background.ts` and `src/background/` own browser-level request observation, ephemeral signed-media state, and downloads.
- `src/content.ts` and `src/content/` own DOM/player interaction and the user interface.
- `src/shared/` contains validated message contracts plus pure lecture/media identification logic.
- `server/` owns durable ingestion, job leases, artifact storage, hybrid retrieval, provider adapters, grounded-answer validation, and cost traces.
- `phase2-data/` is the ignored private registry and artifact boundary. Automatically acquired source media is temporary and deleted after successful ingestion.

Signed recording URLs are stored only in `chrome.storage.session` so service-worker suspension does not lose a currently usable link. They are never sent to the content script or logged. Links close to expiry are rejected with recovery guidance.
