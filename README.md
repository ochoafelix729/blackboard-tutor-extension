# Blackboard Lecture Tutor Extension

A local Chrome extension for downloading authorized UARK Class recordings and asking playback-aware questions with transcript and visual evidence.

The extension connects to an API on your computer. Lecture processing and artifact storage run locally; OpenAI handles transcription, embeddings, and tutor answers using the key in your local `.env` file.

## Setup

Install Node.js, npm, and FFmpeg. Both `ffmpeg` and `ffprobe` must be on your PATH.

```sh
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then build the extension and start the local API:

```sh
npm run build
npm run server
```

Load the repository root as an unpacked extension in Chrome. Reload it after rebuilding. The integration targets UARK's top-level recording player and its known DOM selectors.

## Usage

Open a recording at `https://uark.class.com/player/recording/...` and begin playback so the extension can detect its MP4.

- **Download** saves the shared-screen recording through Chrome. The instructor feed is ignored. Downloads work independently of the tutor API.
- **Tutor** opens a resizable sidebar. Enter a question and press Ask or Enter; Shift+Enter adds a line break.
- Questions automatically use timestamped transcript evidence, representative lecture frames, and a capture of the shared-screen video when available. The instructor video is separate and is not selected for screenshots.
- Timestamp citations jump back to the relevant point in the recording.

The first question acquires the recording and starts local processing. The sidebar shows progress; ask again once transcript evidence is available. One lecture is prepared at a time, with stages run in order. Completed stages are reused across questions, tabs, refreshes, and API restarts. Asking again after a failure or restart resumes the unfinished stages. When visuals are unavailable, the tutor can answer from the transcript and reports that limitation.

Questions cover the current moment and at most the preceding 10 minutes. For full-lecture analysis, download the recording and use a chat model.

## Configuration and storage

`.env.example` lists the supported settings. `TUTOR_MODEL` selects the tutor model; `TUTOR_TRANSCRIPTION_MODEL` and `TUTOR_EMBEDDING_MODEL` select the ingestion models. Choose a tutor model that accepts images.

The extension keeps one observed shared-screen recording URL per tab in session storage, with no stream ranking or candidate lists. It matches the recording ID to the page and checks link expiry before downloads or ingestion.

The API binds to `http://127.0.0.1:4387`. Its key stays outside the extension bundle. Signed recording URLs travel only from the extension service worker to this local API and are never persisted or sent to OpenAI. Required audio chunks, embedding inputs, retrieved transcript excerpts, selected images, and the question are sent to OpenAI as needed.

The ignored `phase2-data/` directory contains `registry.json` and one folder per recording ID. Each recording folder holds plain evidence files (`transcript.json`, `visuals.json`, `segments.json`, `embeddings.json`) and a `frames/` directory. The source `recording.mp4` is deleted after successful ingestion. To rebuild all evidence from scratch, stop the API and delete `phase2-data/`.

## Code layout

- `src/background.ts` and `src/background/`: UARK media observation, downloads, and local API calls.
- `src/content.ts` and `src/content/`: the UARK player's action bar, shared-screen playback tracking, and sidebar.
- `src/shared/`: TypeScript message contracts, lecture identity, recording detection, and question scope.
- `server/`: recording acquisition, sequential lecture processing, artifact storage, evidence retrieval, OpenAI calls, and citation validation.
- `dist/`: generated extension bundles referenced by `manifest.json`.

Run `npm run check` for TypeScript checking and an extension build.
