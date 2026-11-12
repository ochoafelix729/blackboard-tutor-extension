"use strict";
(() => {
  // src/background/DownloadManager.ts
  var activeDownloadsStorageKey = "activeLectureDownloads";
  function sanitizeFilenamePart(value) {
    const sanitized = value.normalize("NFKD").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    return sanitized.length > 0 ? sanitized : "lecture";
  }
  function notifyTab(tabId, notification) {
    chrome.tabs.sendMessage(tabId, notification, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
    });
  }
  var DownloadManager = class {
    activeDownloads = {};
    loadPromise = null;
    constructor() {
      chrome.downloads.onChanged.addListener((delta) => {
        void this.handleDownloadChange(delta);
      });
    }
    async start(tabId, recording, lectureTitle) {
      await this.ensureLoaded();
      const filename = `${sanitizeFilenamePart(lectureTitle)}.mp4`;
      notifyTab(tabId, {
        kind: "downloadStatusChanged",
        status: "starting",
        message: "Starting download\u2026"
      });
      const downloadId = await chrome.downloads.download({
        url: recording.url,
        filename,
        conflictAction: "uniquify",
        saveAs: false
      });
      this.activeDownloads[String(downloadId)] = {
        tabId
      };
      await this.persist();
      notifyTab(tabId, {
        kind: "downloadStatusChanged",
        status: "downloading",
        message: "Download in progress"
      });
      return downloadId;
    }
    async handleDownloadChange(delta) {
      if (delta.state?.current !== "complete" && delta.state?.current !== "interrupted") {
        return;
      }
      await this.ensureLoaded();
      const activeDownload = this.activeDownloads[String(delta.id)];
      if (activeDownload === void 0) {
        return;
      }
      const didComplete = delta.state.current === "complete";
      notifyTab(activeDownload.tabId, {
        kind: "downloadStatusChanged",
        status: didComplete ? "complete" : "failed",
        message: didComplete ? "Download complete" : "Download failed. Replay or reload the lecture to renew its media link, then try again."
      });
      delete this.activeDownloads[String(delta.id)];
      await this.persist();
    }
    async ensureLoaded() {
      if (this.loadPromise === null) {
        this.loadPromise = chrome.storage.session.get(activeDownloadsStorageKey).then((result) => {
          this.activeDownloads = result[activeDownloadsStorageKey] ?? {};
        });
      }
      await this.loadPromise;
    }
    persist() {
      return chrome.storage.session.set({ [activeDownloadsStorageKey]: this.activeDownloads });
    }
  };

  // src/background/RecordingStore.ts
  var storageKey = "sharedScreenRecordingsByTab";
  var RecordingStore = class {
    recordings = {};
    loadPromise = null;
    async record(tabId, recording) {
      await this.ensureLoaded();
      this.recordings[String(tabId)] = recording;
      await this.persist();
    }
    async getForTab(tabId, lectureId) {
      await this.ensureLoaded();
      const recording = this.recordings[String(tabId)];
      if (recording === void 0 || recording.lectureId !== lectureId) {
        return null;
      }
      return recording;
    }
    async clearTab(tabId) {
      await this.ensureLoaded();
      delete this.recordings[String(tabId)];
      await this.persist();
    }
    async ensureLoaded() {
      if (this.loadPromise === null) {
        this.loadPromise = chrome.storage.session.get(storageKey).then((result) => {
          this.recordings = result[storageKey] ?? {};
        });
      }
      await this.loadPromise;
    }
    persist() {
      return chrome.storage.session.set({ [storageKey]: this.recordings });
    }
  };

  // src/background/TutorApiClient.ts
  var tutorApiBaseUrl = "http://127.0.0.1:4387";
  var TutorApiClient = class {
    registerLecture(lectureId, title, mediaUrl) {
      return this.request("/v1/lectures/auto-register", { lectureId, title, mediaUrl });
    }
    getStatus(lectureId) {
      const query = new URLSearchParams({ lectureId });
      return this.request(`/v1/lectures/status?${query.toString()}`);
    }
    async streamAnswer(question, onEvent, signal) {
      try {
        const response = await fetch(`${tutorApiBaseUrl}/v1/questions/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(question),
          signal: AbortSignal.any([signal, AbortSignal.timeout(1e5)])
        });
        if (!response.ok || response.body === null) {
          throw new Error("The local tutor did not start streaming.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let finished = false;
        while (true) {
          const chunk = await reader.read();
          pending += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            if (line.length > 0) {
              const event = JSON.parse(line);
              onEvent(event);
              finished ||= event.kind === "complete" || event.kind === "error";
            }
          }
          if (chunk.done) {
            break;
          }
        }
        if (!finished) {
          throw new Error("The tutor response stream ended early.");
        }
      } catch {
        if (!signal.aborted) {
          onEvent({
            kind: "error",
            error: {
              code: "tutorUnavailable",
              message: "The tutor response was interrupted. Check that the local API is running, then try again."
            }
          });
        }
      }
    }
    async request(endpoint, body) {
      try {
        const options = { signal: AbortSignal.timeout(1e5) };
        if (body !== void 0) {
          options.method = "POST";
          options.headers = { "Content-Type": "application/json" };
          options.body = JSON.stringify(body);
        }
        const response = await fetch(`${tutorApiBaseUrl}${endpoint}`, options);
        const data = await response.json();
        return response.ok ? { ok: true, data } : { ok: false, error: data.error };
      } catch {
        return {
          ok: false,
          error: {
            code: "tutorUnavailable",
            message: "The local tutor API is unavailable. Start it with npm run server."
          }
        };
      }
    }
  };

  // src/shared/lectureIdentity.ts
  function getMediaLectureId(mediaUrl) {
    const recordingId = mediaUrl.pathname.match(/\/recording_([^/]+)\//)?.[1];
    return recordingId === void 0 ? null : `classcom:recording:${recordingId.toLowerCase()}`;
  }

  // src/shared/media.ts
  function parseObservedRecording(urlValue) {
    const url = new URL(urlValue);
    if (!url.pathname.toLowerCase().endsWith("/shared_screen.mp4")) {
      return null;
    }
    const lectureId = getMediaLectureId(url);
    if (lectureId === null) {
      return null;
    }
    const expirySeconds = Number(url.searchParams.get("Expires"));
    return {
      lectureId,
      url: url.href,
      expiresAt: Number.isFinite(expirySeconds) && expirySeconds > 0 ? expirySeconds * 1e3 : null
    };
  }
  function isRecordingExpired(recording) {
    return recording.expiresAt !== null && recording.expiresAt <= Date.now() + 3e4;
  }

  // src/background.ts
  var recordingStore = new RecordingStore();
  var downloadManager = new DownloadManager();
  var tutorApiClient = new TutorApiClient();
  function createErrorResponse(code, message) {
    return { ok: false, error: { code, message } };
  }
  function createRecordingError(recording) {
    return recording === null ? createErrorResponse("mediaUnavailable", "Start lecture playback to detect its shared-screen recording.") : createErrorResponse("signedUrlExpired", "The recording link expired. Replay or reload the lecture to renew it.");
  }
  function notifyTopFrame(tabId, notification) {
    chrome.tabs.sendMessage(tabId, notification, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
    });
  }
  async function observeRecordingRequest(details) {
    if (details.tabId < 0 || details.frameId !== 0 || details.initiator !== "https://uark.class.com" || details.method !== "GET") {
      return;
    }
    const recording = parseObservedRecording(details.url);
    if (recording !== null) {
      await recordingStore.record(details.tabId, recording);
      notifyTopFrame(details.tabId, { kind: "mediaAvailabilityChanged" });
    }
  }
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      void observeRecordingRequest(details);
      return void 0;
    },
    {
      urls: ["https://*.class.com/*"],
      types: ["media", "xmlhttprequest"]
    }
  );
  async function getLectureState(tabId, lectureId) {
    const recording = await recordingStore.getForTab(tabId, lectureId);
    const state = {
      lectureId,
      recordingStatus: recording === null ? "waiting" : isRecordingExpired(recording) ? "expired" : "ready"
    };
    return { ok: true, data: state };
  }
  async function startDownload(tabId, request) {
    const recording = await recordingStore.getForTab(tabId, request.lectureId);
    if (recording === null || isRecordingExpired(recording)) {
      return createRecordingError(recording);
    }
    try {
      const downloadId = await downloadManager.start(tabId, recording, request.lectureTitle);
      return { ok: true, data: { downloadId } };
    } catch {
      return createErrorResponse("downloadFailed", "Chrome could not start the download. Reload the recording and try again.");
    }
  }
  async function prepareTutor(tabId, request) {
    const recording = await recordingStore.getForTab(tabId, request.lectureId);
    if (recording === null || isRecordingExpired(recording)) {
      return createRecordingError(recording);
    }
    return tutorApiClient.registerLecture(
      request.lectureId,
      request.lectureTitle,
      recording.url
    );
  }
  async function handleContentRequest(request, sender) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return createErrorResponse("invalidRequest", "The request is not associated with a browser tab.");
    }
    switch (request.kind) {
      case "getLectureState": {
        return getLectureState(tabId, request.lectureId);
      }
      case "startDownload": {
        return startDownload(tabId, request);
      }
      case "prepareTutor": {
        return prepareTutor(tabId, request);
      }
      case "askTutor": {
        return createErrorResponse("invalidRequest", "Tutor questions require a streaming connection.");
      }
      case "getTutorStatus": {
        return tutorApiClient.getStatus(request.lectureId);
      }
    }
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "tutorStream") {
      return;
    }
    const abortController = new AbortController();
    port.onDisconnect.addListener(() => {
      abortController.abort();
    });
    port.onMessage.addListener((request) => {
      void (async () => {
        const tabId = port.sender?.tab?.id;
        if (tabId === void 0) {
          port.postMessage({ kind: "error", error: { code: "invalidRequest", message: "The request is not associated with a browser tab." } });
          return;
        }
        const registration = await prepareTutor(tabId, {
          kind: "prepareTutor",
          lectureId: request.question.lectureId,
          lectureTitle: request.lectureTitle
        });
        if (abortController.signal.aborted) {
          return;
        }
        if (!registration.ok) {
          port.postMessage({ kind: "error", error: registration.error });
          return;
        }
        await tutorApiClient.streamAnswer(request.question, (event) => {
          if (!abortController.signal.aborted) {
            port.postMessage(event);
          }
        }, abortController.signal);
      })().catch(() => {
        if (!abortController.signal.aborted) {
          port.postMessage({ kind: "error", error: { code: "unexpectedError", message: "The extension could not complete the request." } });
        }
      });
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleContentRequest(message, sender).then(sendResponse).catch(() => {
      sendResponse(createErrorResponse("unexpectedError", "The extension could not complete the request."));
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void recordingStore.clearTab(tabId);
  });
})();
