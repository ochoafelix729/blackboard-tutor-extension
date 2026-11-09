"use strict";
(() => {
  // src/background/DownloadManager.ts
  var activeDownloadsStorageKey = "activeLectureDownloads";
  function sanitizeFilenamePart(value) {
    const sanitized = value.normalize("NFKD").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    return sanitized.length > 0 ? sanitized : "lecture";
  }
  function getKindSuffix(media) {
    switch (media.kind) {
      case "sharedScreen": {
        return "shared-screen";
      }
      case "speaker": {
        return "speaker";
      }
      case "gallery": {
        return "gallery";
      }
      case "recording": {
        return "recording";
      }
    }
  }
  function normalizeActiveDownloads(value) {
    if (typeof value !== "object" || value === null) {
      return {};
    }
    const normalized = {};
    for (const [downloadId, candidate] of Object.entries(value)) {
      if (typeof candidate === "object" && candidate !== null) {
        const entry = candidate;
        if (typeof entry.tabId === "number" && typeof entry.lectureId === "string") {
          normalized[downloadId] = {
            tabId: entry.tabId,
            lectureId: entry.lectureId
          };
        }
      }
    }
    return normalized;
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
    async start(tabId, media, lectureTitle) {
      await this.ensureLoaded();
      const filename = `${sanitizeFilenamePart(lectureTitle)}-${getKindSuffix(media)}.mp4`;
      notifyTab(tabId, {
        kind: "downloadStatusChanged",
        status: "starting",
        message: "Starting download\u2026"
      });
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({
          url: media.url,
          filename,
          conflictAction: "uniquify",
          saveAs: false
        }, (createdDownloadId) => {
          const error = chrome.runtime.lastError;
          if (error !== void 0 || createdDownloadId === void 0) {
            reject(new Error(error?.message ?? "Chrome did not create the download."));
            return;
          }
          resolve(createdDownloadId);
        });
      });
      this.activeDownloads[String(downloadId)] = {
        tabId,
        lectureId: media.lectureId
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
        this.loadPromise = new Promise((resolve) => {
          chrome.storage.session.get(activeDownloadsStorageKey, (result) => {
            this.activeDownloads = normalizeActiveDownloads(result[activeDownloadsStorageKey]);
            resolve();
          });
        });
      }
      await this.loadPromise;
    }
    async persist() {
      await new Promise((resolve) => {
        chrome.storage.session.set({ [activeDownloadsStorageKey]: this.activeDownloads }, () => {
          resolve();
        });
      });
    }
  };

  // src/background/MediaStore.ts
  var storageKey = "observedMediaByTab";
  var maximumCandidatesPerTab = 12;
  function isStoredMedia(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value;
    return typeof candidate.assetKey === "string" && typeof candidate.lectureId === "string" && typeof candidate.url === "string" && typeof candidate.kind === "string" && typeof candidate.label === "string" && (candidate.expiresAt === null || typeof candidate.expiresAt === "number") && typeof candidate.observedAt === "number" && (candidate.documentId === null || typeof candidate.documentId === "string");
  }
  function normalizeStoredMedia(value) {
    if (typeof value !== "object" || value === null) {
      return {};
    }
    const normalized = {};
    for (const [tabId, candidates] of Object.entries(value)) {
      if (Array.isArray(candidates)) {
        normalized[tabId] = candidates.filter(isStoredMedia).slice(0, maximumCandidatesPerTab);
      }
    }
    return normalized;
  }
  var MediaStore = class {
    mediaByTab = {};
    loadPromise = null;
    async record(tabId, candidate) {
      await this.ensureLoaded();
      const tabKey = String(tabId);
      const existingCandidates = this.mediaByTab[tabKey] ?? [];
      const candidates = existingCandidates.filter((existing) => {
        return existing.assetKey !== candidate.assetKey;
      });
      candidates.unshift(candidate);
      this.mediaByTab[tabKey] = candidates.slice(0, maximumCandidatesPerTab);
      await this.persist();
    }
    async getForTab(tabId, documentId) {
      await this.ensureLoaded();
      const candidates = this.mediaByTab[String(tabId)] ?? [];
      if (documentId === null) {
        return [...candidates];
      }
      const documentCandidates = candidates.filter((candidate) => {
        return candidate.documentId === null || candidate.documentId === documentId;
      });
      return documentCandidates.length > 0 ? documentCandidates : [...candidates];
    }
    async clearObservedBefore(tabId, changedAt) {
      await this.ensureLoaded();
      const tabKey = String(tabId);
      const candidates = this.mediaByTab[tabKey] ?? [];
      const remainingCandidates = candidates.filter((candidate) => {
        return candidate.observedAt >= changedAt;
      });
      if (remainingCandidates.length === 0) {
        delete this.mediaByTab[tabKey];
      } else {
        this.mediaByTab[tabKey] = remainingCandidates;
      }
      await this.persist();
    }
    async clearTab(tabId) {
      await this.ensureLoaded();
      delete this.mediaByTab[String(tabId)];
      await this.persist();
    }
    async ensureLoaded() {
      if (this.loadPromise === null) {
        this.loadPromise = new Promise((resolve) => {
          chrome.storage.session.get(storageKey, (result) => {
            this.mediaByTab = normalizeStoredMedia(result[storageKey]);
            resolve();
          });
        });
      }
      await this.loadPromise;
    }
    async persist() {
      await new Promise((resolve) => {
        chrome.storage.session.set({ [storageKey]: this.mediaByTab }, () => {
          resolve();
        });
      });
    }
  };

  // src/shared/lectureIdentity.ts
  function normalizeIdentifier(value) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(normalized)) {
      return null;
    }
    return normalized;
  }
  function createIdentity(candidate) {
    const identifier = normalizeIdentifier(candidate.value);
    if (identifier === null) {
      return null;
    }
    return {
      lectureId: `classcom:${candidate.source}:${identifier}`,
      source: candidate.source
    };
  }
  function getMediaLectureIdentity(mediaUrl) {
    const recordingMatch = mediaUrl.pathname.match(/(?:^|\/)recording_([^/?.]+)/i);
    if (recordingMatch?.[1] !== void 0) {
      return createIdentity({ value: recordingMatch[1], source: "recording" });
    }
    const sessionMatch = mediaUrl.pathname.match(/(?:^|\/)session_([^/?.]+)/i);
    if (sessionMatch?.[1] !== void 0) {
      return createIdentity({ value: sessionMatch[1], source: "session" });
    }
    return null;
  }

  // src/shared/media.ts
  var expirySafetyWindowMilliseconds = 3e4;
  function isClassHost(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "class.com" || normalized.endsWith(".class.com");
  }
  function getQueryValue(searchParams, expectedName) {
    for (const [name, value] of searchParams) {
      if (name.toLowerCase() === expectedName.toLowerCase()) {
        return value;
      }
    }
    return null;
  }
  function getSignedUrlExpiry(mediaUrl) {
    const cloudFrontExpiry = getQueryValue(mediaUrl.searchParams, "Expires");
    if (cloudFrontExpiry !== null) {
      const seconds = Number(cloudFrontExpiry);
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1e3;
      }
    }
    const amazonDate = getQueryValue(mediaUrl.searchParams, "X-Amz-Date");
    const amazonLifetime = getQueryValue(mediaUrl.searchParams, "X-Amz-Expires");
    if (amazonDate !== null && amazonLifetime !== null && /^\d{8}T\d{6}Z$/.test(amazonDate)) {
      const issuedAt = Date.parse(amazonDate.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        "$1-$2-$3T$4:$5:$6Z"
      ));
      const lifetimeSeconds = Number(amazonLifetime);
      if (Number.isFinite(issuedAt) && Number.isFinite(lifetimeSeconds)) {
        return issuedAt + lifetimeSeconds * 1e3;
      }
    }
    return null;
  }
  function getMediaKind(pathname) {
    const filename = pathname.split("/").pop()?.toLowerCase() ?? "";
    if (filename.includes("shared_screen") || filename.includes("shared-screen")) {
      return "sharedScreen";
    }
    if (filename.includes("active_speaker") || filename.includes("speaker")) {
      return "speaker";
    }
    if (filename.includes("gallery")) {
      return "gallery";
    }
    return "recording";
  }
  function getMediaLabel(kind) {
    switch (kind) {
      case "sharedScreen": {
        return "Shared screen recording";
      }
      case "speaker": {
        return "Speaker recording";
      }
      case "gallery": {
        return "Gallery recording";
      }
      case "recording": {
        return "Lecture recording";
      }
    }
  }
  function parseObservedMedia(urlValue, observedAt, documentId) {
    let mediaUrl;
    try {
      mediaUrl = new URL(urlValue);
    } catch {
      return null;
    }
    if (mediaUrl.protocol !== "https:" || !isClassHost(mediaUrl.hostname) || !/\.mp4$/i.test(mediaUrl.pathname)) {
      return null;
    }
    const identity = getMediaLectureIdentity(mediaUrl);
    if (identity === null) {
      return null;
    }
    const kind = getMediaKind(mediaUrl.pathname);
    return {
      assetKey: `${mediaUrl.origin}${mediaUrl.pathname}`,
      lectureId: identity.lectureId,
      url: mediaUrl.href,
      kind,
      label: getMediaLabel(kind),
      expiresAt: getSignedUrlExpiry(mediaUrl),
      observedAt,
      documentId
    };
  }
  function isMediaExpired(media, now = Date.now()) {
    return media.expiresAt !== null && media.expiresAt <= now + expirySafetyWindowMilliseconds;
  }
  function getKindPriority(kind) {
    switch (kind) {
      case "sharedScreen": {
        return 4;
      }
      case "recording": {
        return 3;
      }
      case "speaker": {
        return 2;
      }
      case "gallery": {
        return 1;
      }
    }
  }
  function selectPreferredMedia(mediaCandidates, lectureId, now = Date.now()) {
    return mediaCandidates.filter((candidate) => {
      return (lectureId === null || candidate.lectureId === lectureId) && !isMediaExpired(candidate, now);
    }).sort((first, second) => {
      const priorityDifference = getKindPriority(second.kind) - getKindPriority(first.kind);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }
      return second.observedAt - first.observedAt;
    })[0] ?? null;
  }

  // src/shared/protocol.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function isNullableString(value) {
    return typeof value === "string" || value === null;
  }
  function isPlaybackSnapshot(value) {
    if (!isRecord(value)) {
      return false;
    }
    const hasValidDuration = value.duration === null || typeof value.duration === "number" && Number.isFinite(value.duration);
    return typeof value.currentTime === "number" && Number.isFinite(value.currentTime) && hasValidDuration && typeof value.isPaused === "boolean" && typeof value.hasVideo === "boolean" && typeof value.visibleArea === "number" && Number.isFinite(value.visibleArea) && typeof value.capturedAt === "number" && Number.isFinite(value.capturedAt);
  }
  function isContentRequest(value) {
    if (!isRecord(value) || typeof value.kind !== "string") {
      return false;
    }
    switch (value.kind) {
      case "getLectureState": {
        return isNullableString(value.pageLectureId);
      }
      case "startDownload": {
        return isNullableString(value.lectureId) && typeof value.lectureTitle === "string";
      }
      case "reportPlayback": {
        return isPlaybackSnapshot(value.playback);
      }
      case "resetPageState": {
        return typeof value.changedAt === "number" && Number.isFinite(value.changedAt);
      }
      case "seekPlayback": {
        return typeof value.seconds === "number" && Number.isFinite(value.seconds);
      }
      default: {
        return false;
      }
    }
  }

  // src/background.ts
  var observedMediaStore = new MediaStore();
  var lectureDownloadManager = new DownloadManager();
  var playbackByTab = /* @__PURE__ */ new Map();
  function createErrorResponse(code, message) {
    return {
      ok: false,
      error: {
        code,
        message
      }
    };
  }
  function notifyTopFrame(tabId, notification) {
    chrome.tabs.sendMessage(tabId, notification, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
    });
  }
  async function observeMediaRequest(details) {
    if (details.tabId < 0 || details.method !== "GET") {
      return;
    }
    const documentId = "documentId" in details && typeof details.documentId === "string" ? details.documentId : null;
    const media = parseObservedMedia(details.url, Date.now(), documentId);
    if (media === null) {
      return;
    }
    await observedMediaStore.record(details.tabId, media);
    notifyTopFrame(details.tabId, { kind: "mediaAvailabilityChanged" });
  }
  function handleObservedRequest(details) {
    void observeMediaRequest(details);
    return {};
  }
  chrome.webRequest.onBeforeRequest.addListener(
    handleObservedRequest,
    {
      urls: ["https://*.class.com/*"],
      types: ["media", "xmlhttprequest"]
    }
  );
  function chooseCurrentLectureId(mediaCandidates, pageLectureId) {
    if (pageLectureId !== null && mediaCandidates.some((candidate) => candidate.lectureId === pageLectureId)) {
      return pageLectureId;
    }
    return mediaCandidates[0]?.lectureId ?? pageLectureId;
  }
  function createLectureState(mediaCandidates, pageLectureId) {
    const lectureId = chooseCurrentLectureId(mediaCandidates, pageLectureId);
    const relevantCandidates = mediaCandidates.filter((candidate) => {
      return candidate.lectureId === lectureId;
    });
    const mediaOptions = relevantCandidates.map((candidate) => {
      return {
        assetKey: candidate.assetKey,
        kind: candidate.kind,
        label: candidate.label,
        expiresAt: candidate.expiresAt,
        isExpired: isMediaExpired(candidate)
      };
    });
    return {
      lectureId,
      mediaOptions,
      canDownload: selectPreferredMedia(relevantCandidates, lectureId) !== null
    };
  }
  async function getLectureState(tabId, documentId, pageLectureId) {
    const mediaCandidates = await observedMediaStore.getForTab(tabId, documentId);
    return {
      ok: true,
      data: createLectureState(mediaCandidates, pageLectureId)
    };
  }
  async function startDownload(tabId, documentId, request) {
    const mediaCandidates = await observedMediaStore.getForTab(tabId, documentId);
    const selectedMedia = selectPreferredMedia(mediaCandidates, request.lectureId);
    if (selectedMedia === null) {
      const hasExpiredMedia = mediaCandidates.some((candidate) => {
        return (request.lectureId === null || candidate.lectureId === request.lectureId) && isMediaExpired(candidate);
      });
      if (hasExpiredMedia) {
        return createErrorResponse(
          "signedUrlExpired",
          "The recording link expired. Replay or reload the lecture to renew it, then try again."
        );
      }
      return createErrorResponse(
        "mediaUnavailable",
        "No downloadable recording is available yet. Start lecture playback and try again."
      );
    }
    try {
      const downloadId = await lectureDownloadManager.start(tabId, selectedMedia, request.lectureTitle);
      return {
        ok: true,
        data: { downloadId }
      };
    } catch {
      return createErrorResponse(
        "downloadFailed",
        "Chrome could not start the download. Replay or reload the lecture and try again."
      );
    }
  }
  function relayPlayback(tabId, frameId, playback) {
    const previous = playbackByTab.get(tabId);
    const shouldReplace = previous === void 0 || previous.frameId === frameId || playback.hasVideo && !previous.playback.hasVideo || !playback.isPaused && previous.playback.isPaused || playback.visibleArea > previous.playback.visibleArea || playback.capturedAt - previous.playback.capturedAt > 2e3;
    if (!shouldReplace) {
      return;
    }
    playbackByTab.set(tabId, { frameId, playback });
    if (frameId !== 0) {
      notifyTopFrame(tabId, {
        kind: "playbackChanged",
        playback
      });
    }
  }
  async function handleContentRequest(request, sender) {
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      return createErrorResponse("invalidRequest", "The request is not associated with a browser tab.");
    }
    const documentId = typeof sender.documentId === "string" ? sender.documentId : null;
    switch (request.kind) {
      case "getLectureState": {
        return getLectureState(tabId, documentId, request.pageLectureId);
      }
      case "startDownload": {
        return startDownload(tabId, documentId, request);
      }
      case "reportPlayback": {
        relayPlayback(tabId, sender.frameId ?? 0, request.playback);
        return { ok: true };
      }
      case "resetPageState": {
        playbackByTab.delete(tabId);
        await observedMediaStore.clearObservedBefore(tabId, request.changedAt);
        return { ok: true };
      }
      case "seekPlayback": {
        chrome.tabs.sendMessage(tabId, {
          kind: "seekPlayback",
          seconds: request.seconds
        }, () => {
          void chrome.runtime.lastError;
        });
        return { ok: true };
      }
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isContentRequest(message)) {
      return false;
    }
    void handleContentRequest(message, sender).then((response) => {
      sendResponse(response);
    }).catch(() => {
      sendResponse(createErrorResponse("unexpectedError", "The extension could not complete the request."));
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    playbackByTab.delete(tabId);
    void observedMediaStore.clearTab(tabId);
  });
})();
