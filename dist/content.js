"use strict";
(() => {
  // src/shared/lectureIdentity.ts
  function getPageLectureId(pageUrl) {
    const recordingId = pageUrl.pathname.match(/^\/player\/recording\/[^/]+\/([^/]+)\/?$/)?.[1];
    return recordingId === void 0 ? null : `classcom:recording:${recordingId.toLowerCase()}`;
  }

  // src/shared/questionScope.ts
  var lectureContextLookbackSeconds = 10 * 60;
  var fullLecturePatterns = [
    /\b(?:entire|whole|full)\s+(?:lecture|video|recording)\b/i,
    /\b(?:summarize|recap|outline)\s+(?:(?:this|the)\s+)?(?:lecture|video|recording)\b/i,
    /\b(?:summary|recap|overview)\s+of\s+(?:(?:this|the)\s+)?(?:lecture|video|recording)\b/i,
    /\b(?:across|throughout)\s+(?:this|the)\s+(?:lecture|video|recording)\b/i,
    /\b(?:main|key)\s+(?:topics?|points?|concepts?)\b.{0,40}\b(?:lecture|video|recording)\b/i,
    /\bwhat\s+(?:did|does)\s+(?:the\s+)?professor\s+cover\s+in\s+(?:this|the)\s+lecture\b/i
  ];
  var ambiguousEarlierPatterns = [
    /\bearlier\s+in\s+(?:this|the)\s+(?:lecture|video|recording)\b/i,
    /\b(?:at|from)\s+(?:the\s+)?(?:beginning|start)\s+of\s+(?:this|the)\s+(?:lecture|video|recording)\b/i,
    /\bback\s+(?:at|in)\s+(?:the\s+)?(?:beginning|start)\b/i
  ];
  function asksAboutFullLecture(question) {
    return fullLecturePatterns.some((pattern) => pattern.test(question));
  }
  function hasAmbiguousEarlierReference(question) {
    return ambiguousEarlierPatterns.some((pattern) => pattern.test(question));
  }
  function getExplicitLookbackSeconds(question) {
    const numericMatch = question.match(
      /\b(\d+(?:\.\d+)?)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+ago\b/i
    );
    if (numericMatch !== null) {
      const amount = Number(numericMatch[1]);
      const unit = numericMatch[2]?.toLowerCase() ?? "seconds";
      if (unit.startsWith("hour") || unit.startsWith("hr")) {
        return amount * 3600;
      }
      if (unit.startsWith("minute") || unit.startsWith("min")) {
        return amount * 60;
      }
      return amount;
    }
    if (/\b(?:half an hour|an hour|one hour)\s+ago\b/i.test(question)) {
      return /\bhalf an hour\s+ago\b/i.test(question) ? 1800 : 3600;
    }
    return null;
  }
  function evaluateQuestionScope(question, timestampSeconds) {
    const normalizedQuestion = question.replace(/\s+/g, " ").trim();
    if (asksAboutFullLecture(normalizedQuestion)) {
      return {
        isAllowed: false,
        reason: "fullLecture",
        message: "This tutor is designed for the current moment and the preceding 10 minutes, not full-lecture analysis. Use Download to save the recording, then share it with a chat model for questions about the entire lecture."
      };
    }
    const explicitLookbackSeconds = getExplicitLookbackSeconds(normalizedQuestion);
    if (explicitLookbackSeconds !== null && explicitLookbackSeconds > lectureContextLookbackSeconds) {
      return {
        isAllowed: false,
        reason: "distantTimeReference",
        message: "I can only inspect the current moment and the preceding 10 minutes. Seek closer to that part of the lecture, then ask again."
      };
    }
    if (timestampSeconds > lectureContextLookbackSeconds && hasAmbiguousEarlierReference(normalizedQuestion)) {
      return {
        isAllowed: false,
        reason: "ambiguousEarlierReference",
        message: "\u201CEarlier in the lecture\u201D is outside the tutor\u2019s reliable scope here. Ask about the last 10 minutes, or seek back to the earlier moment and ask again."
      };
    }
    return { isAllowed: true };
  }

  // src/content/PlaybackTracker.ts
  function getLectureVideo() {
    return document.querySelector("[data-analytics-id=video-container] video");
  }
  function createSnapshot(mediaElement) {
    const currentTime = Number.isFinite(mediaElement.currentTime) ? Math.max(0, mediaElement.currentTime) : 0;
    const duration = Number.isFinite(mediaElement.duration) && mediaElement.duration > 0 ? mediaElement.duration : null;
    return {
      currentTime,
      duration,
      isPaused: mediaElement.paused
    };
  }
  var PlaybackTracker = class {
    listener;
    constructor(listener) {
      this.listener = listener;
    }
    start() {
      this.capture();
      window.setInterval(() => {
        this.capture();
      }, 500);
    }
    seek(seconds) {
      const mediaElement = getLectureVideo();
      if (mediaElement === null || !Number.isFinite(seconds)) {
        return;
      }
      const maximum = Number.isFinite(mediaElement.duration) ? mediaElement.duration : seconds;
      mediaElement.currentTime = Math.max(0, Math.min(seconds, maximum));
      this.capture();
    }
    captureCurrentFrame() {
      const mediaElement = getLectureVideo();
      if (mediaElement === null || mediaElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || mediaElement.videoWidth <= 0 || mediaElement.videoHeight <= 0) {
        return null;
      }
      const maximumWidth = 960;
      const scale = Math.min(1, maximumWidth / mediaElement.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(mediaElement.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(mediaElement.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (context === null) {
        return null;
      }
      try {
        context.drawImage(mediaElement, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.72);
      } catch {
        return null;
      }
    }
    capture() {
      const mediaElement = getLectureVideo();
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

        .media-status,
        .tutor-status {
            min-width: 0;
            color: #68748a;
            font-size: 12px;
        }

        .media-status {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tutor-status[data-status="ready"] {
            color: #247447;
        }

        .tutor-status[data-status="failed"] {
            color: #a33c37;
        }

        .lecture-id {
            min-width: 0;
            max-width: 100%;
            padding: 0;
            overflow: hidden;
            color: #68748a;
            background: transparent;
            border: 0;
            cursor: copy;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 10px;
            text-align: left;
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
            display: inline-block;
            margin: 7px 8px 0 0;
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
            justify-content: flex-end;
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

        .ask:disabled {
            cursor: not-allowed;
            opacity: 0.65;
        }

        textarea:disabled {
            cursor: wait;
            opacity: 0.65;
        }

        .answer-text,
        .limitations {
            margin: 0;
        }

        .limitations {
            margin-top: 8px;
            color: #596579;
            font-size: 11px;
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
            <div class="context-row">
                <span class="tutor-status">Checking lecture evidence\u2026</span>
            </div>
            <div class="context-row">
                <input
                    class="lecture-id"
                    type="text"
                    value="Lecture ID pending"
                    aria-label="Stable lecture ID"
                    title="Select and copy the stable lecture ID"
                    readonly
                >
            </div>
        </section>
        <div class="messages" role="log" aria-live="polite"></div>
        <form class="composer">
            <textarea aria-label="Ask about this lecture" placeholder="Ask about now or the last 10 minutes\u2026" required></textarea>
            <div class="composer-row">
                <button class="ask" type="submit">Ask</button>
            </div>
            <div class="composer-row">
                <span class="hint">For full-lecture questions, download the video and use a chat model</span>
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
    tutorStatus;
    lectureId;
    downloadButton;
    messages;
    form;
    textarea;
    askButton;
    isOpen = true;
    sidebarWidth = getDefaultSidebarWidth(window.innerWidth);
    activeResizePointerId = null;
    isTutorBusy = false;
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
      this.tutorStatus = requireElement(shadowRoot, ".tutor-status");
      this.lectureId = requireElement(shadowRoot, ".lecture-id");
      this.downloadButton = requireElement(shadowRoot, ".download");
      this.messages = requireElement(shadowRoot, ".messages");
      this.form = requireElement(shadowRoot, ".composer");
      this.textarea = requireElement(shadowRoot, "textarea");
      this.askButton = requireElement(shadowRoot, ".ask");
      requireElement(shadowRoot, ".close").addEventListener("click", () => {
        this.setOpen(false);
      });
      this.launcher.addEventListener("click", () => {
        this.setOpen(true);
      });
      this.downloadButton.addEventListener("click", () => {
        this.callbacks.onDownload();
      });
      this.lectureId.addEventListener("click", () => {
        const lectureId = this.lectureId.value;
        this.lectureId.select();
        if (this.lectureId.dataset.isAvailable === "true" && navigator.clipboard !== void 0) {
          void navigator.clipboard.writeText(lectureId).then(() => {
            this.lectureId.value = "Lecture ID copied";
            window.setTimeout(() => {
              this.lectureId.value = lectureId;
              this.lectureId.select();
            }, 1200);
          }).catch(() => {
            this.lectureId.title = "Clipboard permission was denied";
          });
        }
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
      this.updateAskAvailability();
      this.addMessage(
        "assistant",
        "Ask about what\u2019s happening now or within the last 10 minutes. For full-lecture questions, download the video and use a chat model."
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
      const durationText = playback.duration === null ? "" : ` / ${formatTime(playback.duration)}`;
      this.time.textContent = `${formatTime(playback.currentTime)}${durationText}`;
      this.time.title = playback.isPaused ? "Lecture paused" : "Lecture playing";
    }
    setLectureState(state) {
      const lectureId = state.lectureId ?? "Lecture ID unavailable";
      this.lectureId.value = lectureId;
      this.lectureId.title = state.lectureId === null ? "A stable lecture ID has not been detected" : "Copy the stable lecture ID";
      if (state.lectureId === null) {
        delete this.lectureId.dataset.isAvailable;
      } else {
        this.lectureId.dataset.isAvailable = "true";
      }
      this.downloadButton.disabled = state.recordingStatus !== "ready";
      if (state.recordingStatus === "ready") {
        this.mediaStatus.textContent = "Recording ready";
        this.downloadButton.title = "Download the detected authorized recording";
        return;
      }
      this.mediaStatus.textContent = state.recordingStatus === "expired" ? "Media link expired \u2014 replay or reload to renew" : "Start playback to detect authorized media";
      this.downloadButton.title = this.mediaStatus.textContent;
    }
    setDownloadStatus(status, message) {
      this.mediaStatus.textContent = message;
      this.downloadButton.disabled = status === "starting" || status === "downloading";
      if (status === "failed") {
        this.addMessage("assistant", message);
      }
    }
    setTutorStatus(status, fallbackMessage) {
      if (status === null) {
        this.tutorStatus.textContent = fallbackMessage ?? "Lecture evidence status unavailable";
        this.tutorStatus.removeAttribute("data-status");
        this.tutorStatus.removeAttribute("title");
        return;
      }
      this.tutorStatus.dataset.status = status.status;
      this.tutorStatus.textContent = status.message;
      const readyCapabilities = [
        status.capabilities.hasTranscript ? "transcript" : null,
        status.capabilities.hasVisuals ? "visuals" : null,
        status.capabilities.hasSegments ? "segments" : null,
        status.capabilities.hasSemanticSearch ? "semantic search" : null
      ].filter((value) => value !== null);
      this.tutorStatus.title = readyCapabilities.length > 0 ? `Ready: ${readyCapabilities.join(", ")}` : "No evidence stage is ready yet";
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
    addTutorAnswer(answer) {
      const message = document.createElement("div");
      message.className = "message assistant";
      const answerText = document.createElement("p");
      answerText.className = "answer-text";
      answerText.textContent = answer.answer;
      message.append(answerText);
      for (const citation of answer.citations) {
        const timestamp = document.createElement("button");
        timestamp.type = "button";
        timestamp.className = "timestamp";
        timestamp.textContent = `Jump to ${formatTime(citation.startSeconds)}`;
        timestamp.title = `Evidence: ${citation.evidenceIds.join(", ")}`;
        timestamp.addEventListener("click", () => {
          this.callbacks.onSeek(citation.startSeconds);
        });
        message.append(timestamp);
      }
      if (answer.limitations.length > 0) {
        const limitations = document.createElement("p");
        limitations.className = "limitations";
        limitations.textContent = `Limitations: ${answer.limitations.join(" ")}`;
        message.append(limitations);
      }
      this.messages.append(message);
      this.messages.scrollTop = this.messages.scrollHeight;
    }
    setTutorBusy(isBusy) {
      this.isTutorBusy = isBusy;
      this.textarea.disabled = isBusy;
      this.askButton.textContent = isBusy ? "Thinking\u2026" : "Ask";
      this.updateAskAvailability();
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
      if (question.length === 0 || this.isTutorBusy) {
        return;
      }
      this.textarea.value = "";
      this.callbacks.onQuestion(question);
    }
    updateAskAvailability() {
      this.askButton.disabled = this.isTutorBusy;
      this.askButton.title = "Ask about the current lecture moment";
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
  async function sendRequest(request) {
    try {
      return await chrome.runtime.sendMessage(request);
    } catch {
      return {
        ok: false,
        error: {
          code: "unexpectedError",
          message: "The extension service is temporarily unavailable."
        }
      };
    }
  }
  function getLectureTitle() {
    return document.title || "UARK Class recording";
  }
  var LectureController = class {
    lectureState;
    sidebar;
    toolbar;
    tracker;
    currentLocation = window.location.href;
    latestPlayback = null;
    constructor() {
      this.lectureState = {
        lectureId: getPageLectureId(new URL(this.currentLocation)),
        recordingStatus: "waiting"
      };
      this.sidebar = new SidebarView({
        onDownload: () => {
          void this.startDownload();
        },
        onQuestion: (question) => {
          void this.askQuestion(question);
        },
        onSeek: (seconds) => {
          this.tracker.seek(seconds);
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
        void this.refreshTutorStatus();
      }, 5e3);
      void this.refreshTutorStatus();
    }
    installMessageListener() {
      chrome.runtime.onMessage.addListener((message) => {
        switch (message.kind) {
          case "mediaAvailabilityChanged": {
            void this.refreshLectureState();
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
    handlePlayback(playback) {
      this.latestPlayback = playback;
      this.sidebar.setPlayback(playback);
    }
    async refreshLectureState() {
      const response = await sendRequest({
        kind: "getLectureState",
        lectureId: getPageLectureId(new URL(this.currentLocation))
      });
      if (!response.ok) {
        return;
      }
      this.lectureState = response.data;
      this.sidebar.setLectureState(this.lectureState);
      this.toolbar.setCanDownload(this.lectureState.recordingStatus === "ready");
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
    async refreshTutorStatus() {
      const lectureId = this.lectureState.lectureId;
      if (lectureId === null) {
        this.sidebar.setTutorStatus(null);
        return;
      }
      const response = await sendRequest({
        kind: "getTutorStatus",
        lectureId
      });
      if (!response.ok) {
        this.sidebar.setTutorStatus(null, response.error.message);
        return;
      }
      this.sidebar.setTutorStatus(response.data);
    }
    async askQuestion(question) {
      const timestamp = this.latestPlayback?.currentTime;
      this.sidebar.addMessage("user", question, timestamp);
      if (timestamp === void 0) {
        this.sidebar.addMessage(
          "assistant",
          "Start or pause the lecture so I can attach a playback timestamp, then ask again."
        );
        return;
      }
      const scopeDecision = evaluateQuestionScope(question, timestamp);
      if (!scopeDecision.isAllowed) {
        this.sidebar.addMessage("assistant", scopeDecision.message);
        return;
      }
      if (this.lectureState.lectureId === null) {
        this.sidebar.addMessage(
          "assistant",
          "I could not identify this lecture yet. Start playback or reload the recording, then ask again."
        );
        return;
      }
      this.sidebar.setTutorBusy(true);
      try {
        const response = await sendRequest({
          kind: "askTutor",
          lectureTitle: getLectureTitle(),
          question: {
            lectureId: this.lectureState.lectureId,
            timestampSeconds: timestamp,
            question,
            currentFrameDataUrl: this.tracker.captureCurrentFrame()
          }
        });
        if (!response.ok) {
          this.sidebar.addMessage("assistant", response.error.message);
          void this.refreshTutorStatus();
          return;
        }
        this.sidebar.addTutorAnswer(response.data);
      } finally {
        this.sidebar.setTutorBusy(false);
      }
    }
    checkForNavigation() {
      if (window.location.href === this.currentLocation) {
        return;
      }
      this.currentLocation = window.location.href;
      this.lectureState = {
        lectureId: getPageLectureId(new URL(this.currentLocation)),
        recordingStatus: "waiting"
      };
      this.latestPlayback = null;
      this.sidebar.setLectureTitle(getLectureTitle());
      this.sidebar.setLectureState(this.lectureState);
      this.sidebar.setTutorStatus(null);
      this.toolbar.setCanDownload(false);
      void this.refreshLectureState().then(() => {
        return this.refreshTutorStatus();
      });
    }
  };

  // src/content.ts
  function startWhenReady() {
    if (document.querySelector(".ClassActionBar-measure") !== null) {
      new LectureController().start();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(".ClassActionBar-measure") !== null) {
        observer.disconnect();
        new LectureController().start();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  startWhenReady();
})();
