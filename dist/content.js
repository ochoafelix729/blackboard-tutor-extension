"use strict";
(() => {
  // src/shared/lectureIdentity.ts
  var identifierNames = [
    "recordingId",
    "recordingUuid",
    "recording",
    "sessionId",
    "sessionUuid",
    "session",
    "meetingId",
    "meetingUuid",
    "meeting"
  ];
  function normalizeIdentifier(value) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(normalized)) {
      return null;
    }
    return normalized;
  }
  function sourceForName(name) {
    const normalized = name.toLowerCase();
    if (normalized.includes("recording")) {
      return "recording";
    }
    if (normalized.includes("session")) {
      return "session";
    }
    return "meeting";
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
  function getQueryCandidate(pageUrl) {
    for (const [name, value] of pageUrl.searchParams) {
      const expectedName = identifierNames.find((identifierName) => {
        return identifierName.toLowerCase() === name.toLowerCase();
      });
      if (expectedName !== void 0) {
        return {
          value,
          source: sourceForName(expectedName)
        };
      }
    }
    return null;
  }
  function getPathCandidate(pageUrl) {
    const patterns = [
      { pattern: /(?:^|\/)recordings?[_/-]([^/?#.]+)/i, source: "recording" },
      { pattern: /(?:^|\/)sessions?[_/-]([^/?#.]+)/i, source: "session" },
      { pattern: /(?:^|\/)meetings?[_/-]([^/?#.]+)/i, source: "meeting" }
    ];
    for (const entry of patterns) {
      const match = pageUrl.pathname.match(entry.pattern);
      const value = match?.[1];
      if (value !== void 0) {
        return {
          value,
          source: entry.source
        };
      }
    }
    return null;
  }
  function getDomCandidate(root) {
    for (const name of identifierNames) {
      const attributeName = name.replace(/[A-Z]/g, (character) => {
        return `-${character.toLowerCase()}`;
      });
      const attributeElement = root.querySelector(`[data-${attributeName}]`);
      const attributeValue = attributeElement?.getAttribute(`data-${attributeName}`);
      if (attributeValue !== null && attributeValue !== void 0) {
        return {
          value: attributeValue,
          source: sourceForName(name)
        };
      }
      const metaElement = root.querySelector(`meta[name="${attributeName}"], meta[property="${attributeName}"]`);
      const metaValue = metaElement?.getAttribute("content");
      if (metaValue !== null && metaValue !== void 0) {
        return {
          value: metaValue,
          source: sourceForName(name)
        };
      }
    }
    return null;
  }
  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function createPageIdentity(pageUrl) {
    const normalizedPath = pageUrl.pathname.replace(/\/+$/, "") || "/";
    const stableLocation = `${pageUrl.origin.toLowerCase()}${normalizedPath}`;
    return {
      lectureId: `classcom:page:${hashString(stableLocation)}`,
      source: "page"
    };
  }
  function detectLectureIdentity(pageUrl, root) {
    const candidates = [
      getQueryCandidate(pageUrl),
      getPathCandidate(pageUrl),
      getDomCandidate(root)
    ];
    for (const candidate of candidates) {
      if (candidate !== null) {
        const identity = createIdentity(candidate);
        if (identity !== null) {
          return identity;
        }
      }
    }
    return createPageIdentity(pageUrl);
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
  function isBackgroundNotification(value) {
    if (!isRecord(value) || typeof value.kind !== "string") {
      return false;
    }
    switch (value.kind) {
      case "mediaAvailabilityChanged": {
        return true;
      }
      case "playbackChanged": {
        return isPlaybackSnapshot(value.playback);
      }
      case "seekPlayback": {
        return typeof value.seconds === "number" && Number.isFinite(value.seconds);
      }
      case "downloadStatusChanged": {
        const validStatuses = ["starting", "downloading", "complete", "failed"];
        return validStatuses.includes(value.status) && typeof value.message === "string";
      }
      default: {
        return false;
      }
    }
  }
  function isBackgroundResponse(value) {
    if (!isRecord(value) || typeof value.ok !== "boolean") {
      return false;
    }
    if (value.ok) {
      return true;
    }
    return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
  }
  function isLectureState(value) {
    if (!isRecord(value) || !isNullableString(value.lectureId) || !Array.isArray(value.mediaOptions)) {
      return false;
    }
    return typeof value.canDownload === "boolean" && value.mediaOptions.every((option) => {
      return isRecord(option) && typeof option.assetKey === "string" && typeof option.kind === "string" && typeof option.label === "string" && (option.expiresAt === null || typeof option.expiresAt === "number") && typeof option.isExpired === "boolean";
    });
  }

  // src/content/PlaybackTracker.ts
  function getVisibleArea(element) {
    const rectangle = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rectangle.right, window.innerWidth) - Math.max(rectangle.left, 0));
    const visibleHeight = Math.max(0, Math.min(rectangle.bottom, window.innerHeight) - Math.max(rectangle.top, 0));
    return visibleWidth * visibleHeight;
  }
  function getBestMediaElement() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length > 0) {
      return videos.sort((first, second) => {
        return getVisibleArea(second) - getVisibleArea(first);
      })[0] ?? null;
    }
    return document.querySelector("audio");
  }
  function createSnapshot(mediaElement) {
    const currentTime = Number.isFinite(mediaElement.currentTime) ? Math.max(0, mediaElement.currentTime) : 0;
    const duration = Number.isFinite(mediaElement.duration) && mediaElement.duration > 0 ? mediaElement.duration : null;
    return {
      currentTime,
      duration,
      isPaused: mediaElement.paused,
      hasVideo: mediaElement instanceof HTMLVideoElement,
      visibleArea: getVisibleArea(mediaElement),
      capturedAt: Date.now()
    };
  }
  var PlaybackTracker = class {
    listener;
    intervalId = null;
    constructor(listener) {
      this.listener = listener;
    }
    start() {
      if (this.intervalId !== null) {
        return;
      }
      this.capture();
      this.intervalId = window.setInterval(() => {
        this.capture();
      }, 500);
    }
    seek(seconds) {
      const mediaElement = getBestMediaElement();
      if (mediaElement === null || !Number.isFinite(seconds)) {
        return false;
      }
      const maximum = Number.isFinite(mediaElement.duration) ? mediaElement.duration : seconds;
      mediaElement.currentTime = Math.max(0, Math.min(seconds, maximum));
      this.capture();
      return true;
    }
    capture() {
      const mediaElement = getBestMediaElement();
      if (mediaElement !== null) {
        this.listener(createSnapshot(mediaElement));
      }
    }
  };

  // src/content/sidebarLayout.ts
  var preferredSidebarWidth = 380;
  var minimumSidebarWidth = 320;
  var maximumSidebarWidth = 640;
  var maximumViewportRatio = 0.55;
  function getSidebarWidthLimits(viewportWidth) {
    const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
    const maximum = Math.min(
      maximumSidebarWidth,
      Math.floor(safeViewportWidth * maximumViewportRatio)
    );
    return {
      minimum: Math.min(minimumSidebarWidth, maximum),
      maximum
    };
  }
  function clampSidebarWidth(requestedWidth, viewportWidth) {
    const limits = getSidebarWidthLimits(viewportWidth);
    const safeRequestedWidth = Number.isFinite(requestedWidth) ? requestedWidth : preferredSidebarWidth;
    return Math.min(limits.maximum, Math.max(limits.minimum, safeRequestedWidth));
  }
  function getDefaultSidebarWidth(viewportWidth) {
    return clampSidebarWidth(preferredSidebarWidth, viewportWidth);
  }

  // src/content/SidebarView.ts
  var pageLayoutStyleId = "blackboard-tutor-page-layout";
  var pageLayoutClassName = "blackboard-tutor-sidebar-open";
  var pageWidthProperty = "--blackboard-tutor-sidebar-width";
  var keyboardResizeStep = 24;
  var sidebarMarkup = `
    <style>
        :host {
            color-scheme: light;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * {
            box-sizing: border-box;
        }

        button,
        textarea {
            font: inherit;
        }

        .panel {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            z-index: 2147483647;
            display: flex;
            width: 380px;
            height: 100vh;
            height: 100dvh;
            flex-direction: column;
            overflow: hidden;
            color: #172033;
            background: #ffffff;
            border: 0;
            border-left: 1px solid #d8deea;
            border-radius: 0;
            box-shadow: -12px 0 36px rgba(15, 23, 42, 0.18);
        }

        .resize-handle {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            z-index: 2;
            width: 9px;
            padding: 0;
            touch-action: none;
            background: transparent;
            border: 0;
            cursor: ew-resize;
        }

        .resize-handle::after {
            position: absolute;
            top: 50%;
            left: 3px;
            width: 3px;
            height: 54px;
            content: "";
            background: #aeb7c7;
            border-radius: 999px;
            opacity: 0;
            transform: translateY(-50%);
            transition: opacity 120ms ease;
        }

        .resize-handle:hover::after,
        .resize-handle:focus-visible::after,
        .panel[data-resizing="true"] .resize-handle::after {
            opacity: 1;
        }

        .resize-handle:focus-visible {
            outline: 2px solid #8c3047;
            outline-offset: -3px;
        }

        .panel[hidden],
        .launcher[hidden] {
            display: none;
        }

        .launcher {
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 2147483647;
            padding: 11px 16px;
            color: #ffffff;
            background: #7c2d3f;
            border: 0;
            border-radius: 999px;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.28);
            cursor: pointer;
            font-weight: 700;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 15px 16px 12px 20px;
            color: #ffffff;
            background: linear-gradient(135deg, #641c2f, #9f344d);
        }

        .eyebrow {
            margin: 0 0 2px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            opacity: 0.78;
            text-transform: uppercase;
        }

        h2 {
            margin: 0;
            font-size: 18px;
            line-height: 1.2;
        }

        .icon-button {
            width: 34px;
            height: 34px;
            color: inherit;
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 9px;
            cursor: pointer;
            font-size: 20px;
        }

        .context {
            padding: 12px 15px;
            background: #f7f8fb;
            border-bottom: 1px solid #e3e7ef;
        }

        .lecture-title {
            margin: 0;
            overflow: hidden;
            color: #263247;
            font-size: 13px;
            font-weight: 700;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .context-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-top: 8px;
        }

        .time {
            color: #4b5870;
            font-variant-numeric: tabular-nums;
            font-size: 13px;
        }

        .media-status {
            min-width: 0;
            overflow: hidden;
            color: #68748a;
            font-size: 12px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .download {
            flex: none;
            padding: 7px 10px;
            color: #ffffff;
            background: #7c2d3f;
            border: 0;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 700;
        }

        .download:disabled {
            color: #8a94a6;
            background: #e4e8ef;
            cursor: not-allowed;
        }

        .messages {
            display: flex;
            flex: 1;
            flex-direction: column;
            gap: 10px;
            min-height: 0;
            padding: 14px;
            overflow-y: auto;
            background: #ffffff;
        }

        .message {
            max-width: 88%;
            padding: 10px 12px;
            border-radius: 13px;
            font-size: 13px;
            line-height: 1.45;
            white-space: pre-wrap;
        }

        .message.assistant {
            align-self: flex-start;
            background: #f0f2f7;
            border-bottom-left-radius: 4px;
        }

        .message.user {
            align-self: flex-end;
            color: #ffffff;
            background: #7c2d3f;
            border-bottom-right-radius: 4px;
        }

        .timestamp {
            display: block;
            margin-top: 7px;
            padding: 0;
            color: inherit;
            background: transparent;
            border: 0;
            cursor: pointer;
            font-size: 11px;
            font-weight: 700;
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .composer {
            padding: 12px;
            background: #f7f8fb;
            border-top: 1px solid #e3e7ef;
        }

        textarea {
            display: block;
            width: 100%;
            min-height: 68px;
            max-height: 150px;
            padding: 9px 10px;
            resize: vertical;
            color: #172033;
            background: #ffffff;
            border: 1px solid #cbd2df;
            border-radius: 9px;
            outline: none;
        }

        textarea:focus {
            border-color: #8c3047;
            box-shadow: 0 0 0 3px rgba(140, 48, 71, 0.12);
        }

        .composer-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-top: 8px;
        }

        .hint {
            color: #6e798d;
            font-size: 11px;
        }

        .ask {
            padding: 8px 14px;
            color: #ffffff;
            background: #263247;
            border: 0;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 700;
        }

    </style>
    <button class="launcher" type="button" aria-label="Open lecture tutor" hidden>Tutor</button>
    <aside class="panel" aria-label="Lecture tutor">
        <button
            class="resize-handle"
            type="button"
            role="separator"
            aria-label="Resize lecture tutor"
            aria-orientation="vertical"
        ></button>
        <header class="header">
            <div>
                <p class="eyebrow">Playback-aware</p>
                <h2>Lecture Tutor</h2>
            </div>
            <button class="icon-button close" type="button" aria-label="Close lecture tutor">\xD7</button>
        </header>
        <section class="context" aria-label="Lecture context">
            <p class="lecture-title">Current lecture</p>
            <div class="context-row">
                <span class="time">0:00</span>
                <button class="download" type="button" disabled>Download</button>
            </div>
            <div class="context-row">
                <span class="media-status">Waiting for authorized media\u2026</span>
            </div>
        </section>
        <div class="messages" role="log" aria-live="polite"></div>
        <form class="composer">
            <textarea aria-label="Ask about this lecture" placeholder="Ask about what the professor is explaining\u2026" required></textarea>
            <div class="composer-row">
                <span class="hint">Your playback time is attached</span>
                <button class="ask" type="submit">Ask</button>
            </div>
        </form>
    </aside>
`;
  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor(safeSeconds % 3600 / 60);
    const remainingSeconds = safeSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  function requireElement(root, selector) {
    const element = root.querySelector(selector);
    if (element === null) {
      throw new Error(`Sidebar element is missing: ${selector}`);
    }
    return element;
  }
  function installPageLayoutStyle() {
    if (document.getElementById(pageLayoutStyleId) !== null) {
      return;
    }
    const style = document.createElement("style");
    style.id = pageLayoutStyleId;
    style.textContent = `
        html.${pageLayoutClassName} {
            width: calc(100vw - var(${pageWidthProperty})) !important;
            min-width: 0 !important;
        }

        html.${pageLayoutClassName} > body {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
        }
    `;
    (document.head ?? document.documentElement).append(style);
  }
  var SidebarView = class {
    callbacks;
    host;
    panel;
    resizeHandle;
    launcher;
    lectureTitle;
    time;
    mediaStatus;
    downloadButton;
    messages;
    form;
    textarea;
    playback = null;
    isOpen = true;
    sidebarWidth = getDefaultSidebarWidth(window.innerWidth);
    activeResizePointerId = null;
    resizeStartX = 0;
    resizeStartWidth = 0;
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.host = document.createElement("div");
      this.host.id = "blackboard-tutor-root";
      const shadowRoot = this.host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = sidebarMarkup;
      this.panel = requireElement(shadowRoot, ".panel");
      this.resizeHandle = requireElement(shadowRoot, ".resize-handle");
      this.launcher = requireElement(shadowRoot, ".launcher");
      this.lectureTitle = requireElement(shadowRoot, ".lecture-title");
      this.time = requireElement(shadowRoot, ".time");
      this.mediaStatus = requireElement(shadowRoot, ".media-status");
      this.downloadButton = requireElement(shadowRoot, ".download");
      this.messages = requireElement(shadowRoot, ".messages");
      this.form = requireElement(shadowRoot, ".composer");
      this.textarea = requireElement(shadowRoot, "textarea");
      requireElement(shadowRoot, ".close").addEventListener("click", () => {
        this.setOpen(false);
      });
      this.launcher.addEventListener("click", () => {
        this.setOpen(true);
      });
      this.downloadButton.addEventListener("click", () => {
        this.callbacks.onDownload();
      });
      this.form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submitQuestion();
      });
      this.textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.submitQuestion();
        }
      });
      this.resizeHandle.addEventListener("pointerdown", (event) => {
        this.startResize(event);
      });
      this.resizeHandle.addEventListener("pointermove", (event) => {
        this.continueResize(event);
      });
      this.resizeHandle.addEventListener("pointerup", (event) => {
        this.finishResize(event.pointerId);
      });
      this.resizeHandle.addEventListener("pointercancel", (event) => {
        this.finishResize(event.pointerId);
      });
      this.resizeHandle.addEventListener("lostpointercapture", () => {
        this.finishResize(this.activeResizePointerId);
      });
      this.resizeHandle.addEventListener("keydown", (event) => {
        this.resizeWithKeyboard(event);
      });
      this.resizeHandle.addEventListener("dblclick", () => {
        this.applySidebarWidth(getDefaultSidebarWidth(window.innerWidth));
      });
      window.addEventListener("resize", () => {
        this.applySidebarWidth(this.sidebarWidth);
      });
      document.documentElement.append(this.host);
      installPageLayoutStyle();
      this.applySidebarWidth(this.sidebarWidth);
      this.addMessage(
        "assistant",
        "I\u2019m tracking the lecture\u2019s playback position. Ask a question to capture it with the current timestamp."
      );
    }
    toggle() {
      this.setOpen(!this.isOpen);
    }
    setLectureTitle(title) {
      this.lectureTitle.textContent = title.trim() || "Current lecture";
      this.lectureTitle.title = title;
    }
    setPlayback(playback) {
      this.playback = playback;
      const durationText = playback.duration === null ? "" : ` / ${formatTime(playback.duration)}`;
      this.time.textContent = `${formatTime(playback.currentTime)}${durationText}`;
      this.time.title = playback.isPaused ? "Lecture paused" : "Lecture playing";
    }
    setLectureState(state) {
      this.downloadButton.disabled = !state.canDownload;
      if (state.canDownload) {
        const preferredLabel = state.mediaOptions.find((option) => !option.isExpired)?.label;
        this.mediaStatus.textContent = preferredLabel ?? "Recording ready";
        this.downloadButton.title = "Download the detected authorized recording";
        return;
      }
      const hasExpiredMedia = state.mediaOptions.some((option) => option.isExpired);
      this.mediaStatus.textContent = hasExpiredMedia ? "Media link expired \u2014 replay or reload to renew" : "Start playback to detect authorized media";
      this.downloadButton.title = this.mediaStatus.textContent;
    }
    setDownloadStatus(status, message) {
      this.mediaStatus.textContent = message;
      this.downloadButton.disabled = status === "starting" || status === "downloading";
      if (status === "failed") {
        this.addMessage("assistant", message);
      }
    }
    addMessage(role, text, timestampSeconds) {
      const message = document.createElement("div");
      message.className = `message ${role}`;
      message.textContent = text;
      if (timestampSeconds !== void 0) {
        const timestamp = document.createElement("button");
        timestamp.type = "button";
        timestamp.className = "timestamp";
        timestamp.textContent = `Jump to ${formatTime(timestampSeconds)}`;
        timestamp.addEventListener("click", () => {
          this.callbacks.onSeek(timestampSeconds);
        });
        message.append(timestamp);
      }
      this.messages.append(message);
      this.messages.scrollTop = this.messages.scrollHeight;
    }
    setOpen(isOpen) {
      this.isOpen = isOpen;
      this.panel.hidden = !isOpen;
      this.launcher.hidden = isOpen;
      this.updatePageLayout();
      if (isOpen) {
        this.textarea.focus();
      }
    }
    startResize(event) {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.activeResizePointerId = event.pointerId;
      this.resizeStartX = event.clientX;
      this.resizeStartWidth = this.sidebarWidth;
      this.panel.dataset.resizing = "true";
      this.resizeHandle.setPointerCapture(event.pointerId);
    }
    continueResize(event) {
      if (event.pointerId !== this.activeResizePointerId) {
        return;
      }
      event.preventDefault();
      const horizontalMovement = this.resizeStartX - event.clientX;
      this.applySidebarWidth(this.resizeStartWidth + horizontalMovement);
    }
    finishResize(pointerId) {
      if (pointerId === null || pointerId !== this.activeResizePointerId) {
        return;
      }
      if (this.resizeHandle.hasPointerCapture(pointerId)) {
        this.resizeHandle.releasePointerCapture(pointerId);
      }
      this.activeResizePointerId = null;
      delete this.panel.dataset.resizing;
    }
    resizeWithKeyboard(event) {
      const limits = getSidebarWidthLimits(window.innerWidth);
      let requestedWidth = null;
      switch (event.key) {
        case "ArrowLeft": {
          requestedWidth = this.sidebarWidth + keyboardResizeStep;
          break;
        }
        case "ArrowRight": {
          requestedWidth = this.sidebarWidth - keyboardResizeStep;
          break;
        }
        case "Home": {
          requestedWidth = limits.minimum;
          break;
        }
        case "End": {
          requestedWidth = limits.maximum;
          break;
        }
      }
      if (requestedWidth !== null) {
        event.preventDefault();
        this.applySidebarWidth(requestedWidth);
      }
    }
    applySidebarWidth(requestedWidth) {
      const limits = getSidebarWidthLimits(window.innerWidth);
      this.sidebarWidth = clampSidebarWidth(requestedWidth, window.innerWidth);
      this.panel.style.width = `${this.sidebarWidth}px`;
      this.resizeHandle.setAttribute("aria-valuemin", String(limits.minimum));
      this.resizeHandle.setAttribute("aria-valuemax", String(limits.maximum));
      this.resizeHandle.setAttribute("aria-valuenow", String(this.sidebarWidth));
      this.updatePageLayout();
    }
    updatePageLayout() {
      document.documentElement.classList.toggle(pageLayoutClassName, this.isOpen);
      if (this.isOpen) {
        document.documentElement.style.setProperty(pageWidthProperty, `${this.sidebarWidth}px`);
      } else {
        document.documentElement.style.removeProperty(pageWidthProperty);
      }
    }
    submitQuestion() {
      const question = this.textarea.value.trim();
      if (question.length === 0) {
        return;
      }
      this.textarea.value = "";
      this.callbacks.onQuestion(question, this.playback);
    }
  };

  // src/content/ToolbarController.ts
  var toolbarSelector = ".ClassActionBar-measure";
  var itemAttribute = "data-blackboard-tutor-action";
  var ToolbarController = class {
    callbacks;
    observer;
    canDownload = false;
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.observer = new MutationObserver(() => {
        this.attach();
      });
    }
    start() {
      this.attach();
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
    setCanDownload(canDownload) {
      this.canDownload = canDownload;
      this.updateDownloadButton();
    }
    attach() {
      const toolbar = document.querySelector(toolbarSelector);
      if (toolbar === null) {
        return;
      }
      this.attachButton(toolbar, "download", "Download", () => {
        this.callbacks.onDownload();
      });
      this.attachButton(toolbar, "tutor", "Tutor", () => {
        this.callbacks.onToggleTutor();
      });
      this.updateDownloadButton();
    }
    attachButton(toolbar, action, label, listener) {
      if (toolbar.querySelector(`[${itemAttribute}="${action}"]`) !== null) {
        return;
      }
      const item = document.createElement("div");
      item.className = "ClassActionBarItem-root";
      item.setAttribute(itemAttribute, action);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", action === "download" ? "Download lecture recording" : "Toggle lecture tutor");
      button.style.cssText = [
        "padding: 12px",
        "background: transparent",
        "color: inherit",
        "border: 0",
        "cursor: pointer",
        "font: inherit"
      ].join(";");
      button.addEventListener("click", () => {
        listener();
      });
      item.append(button);
      const spacer = toolbar.querySelector("#gap-item");
      toolbar.insertBefore(item, spacer);
    }
    updateDownloadButton() {
      const item = document.querySelector(`[${itemAttribute}="download"]`);
      const button = item?.querySelector("button");
      if (button instanceof HTMLButtonElement) {
        button.disabled = !this.canDownload;
        button.title = this.canDownload ? "Download the detected lecture recording" : "Start lecture playback so the recording can be detected";
        button.style.opacity = this.canDownload ? "1" : "0.55";
        button.style.cursor = this.canDownload ? "pointer" : "not-allowed";
      }
    }
  };

  // src/content/LectureController.ts
  function sendRequest(request) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(request, (response) => {
        const error = chrome.runtime.lastError;
        if (error !== void 0) {
          resolve({
            ok: false,
            error: {
              code: "unexpectedError",
              message: "The extension service is temporarily unavailable."
            }
          });
          return;
        }
        if (!isBackgroundResponse(response)) {
          resolve({
            ok: false,
            error: {
              code: "unexpectedError",
              message: "The extension returned an invalid response."
            }
          });
          return;
        }
        resolve(response);
      });
    });
  }
  function getLectureTitle() {
    const selectors = [
      "[data-recording-title]",
      "[data-session-title]",
      "h1",
      "title"
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const title = element?.getAttribute("data-recording-title") ?? element?.getAttribute("data-session-title") ?? element?.textContent;
      if (title !== null && title !== void 0 && title.trim().length > 0) {
        return title.trim();
      }
    }
    return "Class.com lecture";
  }
  var LectureController = class {
    identity;
    lectureState;
    sidebar;
    toolbar;
    tracker;
    currentLocation = window.location.href;
    latestPlayback = null;
    lastPlaybackReportAt = 0;
    constructor() {
      this.identity = detectLectureIdentity(new URL(window.location.href), document);
      this.lectureState = {
        lectureId: this.identity.lectureId,
        mediaOptions: [],
        canDownload: false
      };
      this.sidebar = new SidebarView({
        onDownload: () => {
          void this.startDownload();
        },
        onQuestion: (question, playback) => {
          this.captureQuestion(question, playback);
        },
        onSeek: (seconds) => {
          this.seek(seconds);
        }
      });
      this.toolbar = new ToolbarController({
        onDownload: () => {
          void this.startDownload();
        },
        onToggleTutor: () => {
          this.sidebar.toggle();
        }
      });
      this.tracker = new PlaybackTracker((playback) => {
        this.handlePlayback(playback);
      });
    }
    start() {
      this.sidebar.setLectureTitle(getLectureTitle());
      this.toolbar.start();
      this.tracker.start();
      this.installMessageListener();
      void this.refreshLectureState();
      window.setInterval(() => {
        this.checkForNavigation();
      }, 1e3);
      window.setInterval(() => {
        void this.refreshLectureState();
      }, 5e3);
    }
    installMessageListener() {
      chrome.runtime.onMessage.addListener((message) => {
        if (!isBackgroundNotification(message)) {
          return false;
        }
        switch (message.kind) {
          case "mediaAvailabilityChanged": {
            void this.refreshLectureState();
            break;
          }
          case "playbackChanged": {
            this.handlePlayback(message.playback, false);
            break;
          }
          case "seekPlayback": {
            this.tracker.seek(message.seconds);
            break;
          }
          case "downloadStatusChanged": {
            this.sidebar.setDownloadStatus(message.status, message.message);
            if (message.status === "complete" || message.status === "failed") {
              void this.refreshLectureState();
            }
            break;
          }
        }
        return false;
      });
    }
    handlePlayback(playback, shouldReport = true) {
      const shouldUsePlayback = this.latestPlayback === null || playback.hasVideo && !this.latestPlayback.hasVideo || !playback.isPaused && this.latestPlayback.isPaused || playback.visibleArea >= this.latestPlayback.visibleArea || playback.capturedAt - this.latestPlayback.capturedAt > 2e3;
      if (!shouldUsePlayback) {
        return;
      }
      this.latestPlayback = playback;
      this.sidebar.setPlayback(playback);
      if (shouldReport && playback.capturedAt - this.lastPlaybackReportAt >= 1e3) {
        this.lastPlaybackReportAt = playback.capturedAt;
        void sendRequest({
          kind: "reportPlayback",
          playback
        });
      }
    }
    async refreshLectureState() {
      const response = await sendRequest({
        kind: "getLectureState",
        pageLectureId: this.identity.lectureId
      });
      if (!response.ok || !isLectureState(response.data)) {
        return;
      }
      this.lectureState = response.data;
      this.sidebar.setLectureState(response.data);
      this.toolbar.setCanDownload(response.data.canDownload);
    }
    async startDownload() {
      const response = await sendRequest({
        kind: "startDownload",
        lectureId: this.lectureState.lectureId,
        lectureTitle: getLectureTitle()
      });
      if (!response.ok) {
        this.sidebar.setDownloadStatus("failed", response.error.message);
        await this.refreshLectureState();
      }
    }
    captureQuestion(question, playback) {
      const timestamp = playback?.currentTime ?? this.latestPlayback?.currentTime;
      this.sidebar.addMessage("user", question, timestamp);
      const contextDescription = timestamp === void 0 ? "I saved your question, but no player timestamp is available yet." : "I saved your question with the current playback time.";
      this.sidebar.addMessage(
        "assistant",
        `${contextDescription} Grounded lecture answers will be connected in Phase 1.`,
        timestamp
      );
    }
    seek(seconds) {
      const didSeekLocally = this.tracker.seek(seconds);
      if (!didSeekLocally) {
        void sendRequest({
          kind: "seekPlayback",
          seconds
        });
      }
    }
    checkForNavigation() {
      if (window.location.href === this.currentLocation) {
        return;
      }
      this.currentLocation = window.location.href;
      const changedAt = Date.now();
      this.identity = detectLectureIdentity(new URL(this.currentLocation), document);
      this.lectureState = {
        lectureId: this.identity.lectureId,
        mediaOptions: [],
        canDownload: false
      };
      this.latestPlayback = null;
      this.sidebar.setLectureTitle(getLectureTitle());
      this.sidebar.setLectureState(this.lectureState);
      this.toolbar.setCanDownload(false);
      void sendRequest({ kind: "resetPageState", changedAt }).then(() => {
        return this.refreshLectureState();
      });
    }
  };

  // src/content.ts
  var lectureSurfaceSelector = ".ClassActionBar-measure, video, audio";
  function isLectureLocation() {
    const locationText = `${window.location.pathname}${window.location.search}`;
    return /player|recording|session|meeting/i.test(locationText);
  }
  function startTopFrameControllerWhenReady() {
    let hasStarted = false;
    function startController() {
      if (hasStarted) {
        return;
      }
      hasStarted = true;
      const controller = new LectureController();
      controller.start();
    }
    if (isLectureLocation() || document.querySelector(lectureSurfaceSelector) !== null) {
      startController();
      return;
    }
    const observer = new MutationObserver(() => {
      if (isLectureLocation() || document.querySelector(lectureSurfaceSelector) !== null) {
        observer.disconnect();
        startController();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  function reportFramePlayback() {
    let lastReportAt = 0;
    const tracker = new PlaybackTracker((playback) => {
      if (playback.capturedAt - lastReportAt < 1e3) {
        return;
      }
      lastReportAt = playback.capturedAt;
      const request = {
        kind: "reportPlayback",
        playback
      };
      chrome.runtime.sendMessage(request, () => {
        void chrome.runtime.lastError;
      });
    });
    chrome.runtime.onMessage.addListener((message) => {
      if (isBackgroundNotification(message) && message.kind === "seekPlayback") {
        tracker.seek(message.seconds);
      }
      return false;
    });
    tracker.start();
  }
  if (window.top === window) {
    startTopFrameControllerWhenReady();
  } else {
    reportFramePlayback();
  }
})();
