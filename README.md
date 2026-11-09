# Blackboard Lecture Tutor Extension

This Manifest V3 extension supports authorized Class.com lecture pages. Phase 0 provides:

- A content script that owns player detection, toolbar controls, and a full-height, bounded, resizable Shadow DOM tutor sidebar that shares horizontal space with the player.
- A service worker that observes supported MP4 requests, keeps signed URLs out of page context, and starts Chrome downloads.
- Stable lecture identity derived from Class.com recording, session, or meeting identifiers rather than signed URLs.
- Playback timestamp capture across the top page and supported Class.com frames.
- Explicit states for missing, ready, expired, active, completed, and failed downloads.

The sidebar captures questions with their playback timestamps, but it deliberately does not generate lecture answers yet. Grounded transcript and visual answers are Phase 1 work.

## Development

Install dependencies and run all checks:

```sh
npm install
npm run check
```

Load the repository root as an unpacked extension in Chrome after building. Chrome reads `manifest.json`, which references the generated `dist/background.js` and `dist/content.js` files.

## Runtime boundaries

- `src/background.ts` and `src/background/` own browser-level request observation, ephemeral signed-media state, and downloads.
- `src/content.ts` and `src/content/` own DOM/player interaction and the user interface.
- `src/shared/` contains validated message contracts plus pure lecture/media identification logic.

Signed recording URLs are stored only in `chrome.storage.session` so service-worker suspension does not lose a currently usable link. They are never sent to the content script or logged. Links close to expiry are rejected with recovery guidance.
