// Renders the isolated tutor sidebar and forwards user interactions.

import type { LectureProcessingStatus } from "../shared/ingestion";
import type { downloadStatus, LectureState, PlaybackSnapshot } from "../shared/protocol";
import type { TutorAnswer } from "../shared/tutor";
import { renderAnswer } from "./renderAnswer";
import {
    clampSidebarWidth,
    getDefaultSidebarWidth,
    getSidebarWidthLimits
} from "./sidebarLayout";

export interface SidebarCallbacks
{
    onDownload(): void;
    onQuestion(question: string): void;
    onSeek(seconds: number): void;
}

type messageRole = "assistant" | "user";

const pageLayoutStyleId = "blackboard-tutor-page-layout";
const pageLayoutClassName = "blackboard-tutor-sidebar-open";
const pageWidthProperty = "--blackboard-tutor-sidebar-width";
const keyboardResizeStep = 24;

const sidebarMarkup = `
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

        .panel[hidden] {
            display: none;
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

        .answer-text {
            white-space: normal;
            overflow-wrap: anywhere;
        }

        .answer-text > :first-child {
            margin-top: 0;
        }

        .answer-text > :last-child {
            margin-bottom: 0;
        }

        .answer-text section {
            max-width: 100%;
            overflow-x: auto;
        }

        .answer-text pre {
            max-width: 100%;
            overflow-x: auto;
            white-space: pre;
        }

        .limitations {
            margin-top: 8px;
            color: #596579;
            font-size: 11px;
        }
    </style>
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
            <button class="icon-button close" type="button" aria-label="Close lecture tutor">×</button>
        </header>
        <section class="context" aria-label="Lecture context">
            <p class="lecture-title">Current lecture</p>
            <div class="context-row">
                <span class="time">0:00</span>
                <button class="download" type="button" disabled>Download</button>
            </div>
            <div class="context-row">
                <span class="media-status">Waiting for authorized media…</span>
            </div>
            <div class="context-row">
                <span class="tutor-status">Checking lecture evidence…</span>
            </div>
        </section>
        <div class="messages" role="log" aria-live="polite"></div>
        <form class="composer">
            <textarea aria-label="Ask about this lecture" placeholder="Ask about now or the last 10 minutes…" required></textarea>
            <div class="composer-row">
                <button class="ask" type="submit">Ask</button>
            </div>
            <div class="composer-row">
                <span class="hint">For full-lecture questions, download the video and use a chat model</span>
            </div>
        </form>
    </aside>
`;

function formatTime(seconds: number): string
{
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainingSeconds = safeSeconds % 60;

    if (hours > 0)
    {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function requireElement<elementType extends Element>(root: ShadowRoot, selector: string): elementType
{
    const element = root.querySelector(selector);

    if (element === null)
    {
        throw new Error(`Sidebar element is missing: ${selector}`);
    }

    return element as elementType;
}

function installPageLayoutStyle(): void
{
    if (document.getElementById(pageLayoutStyleId) !== null)
    {
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

export class SidebarView
{
    private readonly callbacks: SidebarCallbacks;
    private readonly host: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly resizeHandle: HTMLButtonElement;
    private readonly lectureTitle: HTMLElement;
    private readonly time: HTMLElement;
    private readonly mediaStatus: HTMLElement;
    private readonly tutorStatus: HTMLElement;
    private readonly downloadButton: HTMLButtonElement;
    private readonly messages: HTMLElement;
    private readonly form: HTMLFormElement;
    private readonly textarea: HTMLTextAreaElement;
    private readonly askButton: HTMLButtonElement;
    private isOpen = true;
    private sidebarWidth = getDefaultSidebarWidth(window.innerWidth);
    private activeResizePointerId: number | null = null;
    private isTutorBusy = false;
    private resizeStartX = 0;
    private resizeStartWidth = 0;

    constructor(callbacks: SidebarCallbacks)
    {
        this.callbacks = callbacks;
        this.host = document.createElement("div");
        this.host.id = "blackboard-tutor-root";

        const shadowRoot = this.host.attachShadow({ mode: "open" });
        shadowRoot.innerHTML = sidebarMarkup;
        this.panel = requireElement(shadowRoot, ".panel");
        this.resizeHandle = requireElement(shadowRoot, ".resize-handle");
        this.lectureTitle = requireElement(shadowRoot, ".lecture-title");
        this.time = requireElement(shadowRoot, ".time");
        this.mediaStatus = requireElement(shadowRoot, ".media-status");
        this.tutorStatus = requireElement(shadowRoot, ".tutor-status");
        this.downloadButton = requireElement(shadowRoot, ".download");
        this.messages = requireElement(shadowRoot, ".messages");
        this.form = requireElement(shadowRoot, ".composer");
        this.textarea = requireElement(shadowRoot, "textarea");
        this.askButton = requireElement(shadowRoot, ".ask");

        requireElement<HTMLButtonElement>(shadowRoot, ".close").addEventListener("click", () =>
        {
            this.setOpen(false);
        });
        this.downloadButton.addEventListener("click", () =>
        {
            this.callbacks.onDownload();
        });
        this.form.addEventListener("submit", (event) =>
        {
            event.preventDefault();
            this.submitQuestion();
        });
        this.textarea.addEventListener("keydown", (event) =>
        {
            if (event.key === "Enter" && !event.shiftKey)
            {
                event.preventDefault();
                this.submitQuestion();
            }
        });
        this.resizeHandle.addEventListener("pointerdown", (event) =>
        {
            this.startResize(event);
        });
        this.resizeHandle.addEventListener("pointermove", (event) =>
        {
            this.continueResize(event);
        });
        this.resizeHandle.addEventListener("pointerup", (event) =>
        {
            this.finishResize(event.pointerId);
        });
        this.resizeHandle.addEventListener("pointercancel", (event) =>
        {
            this.finishResize(event.pointerId);
        });
        this.resizeHandle.addEventListener("lostpointercapture", () =>
        {
            this.finishResize(this.activeResizePointerId);
        });
        this.resizeHandle.addEventListener("keydown", (event) =>
        {
            this.resizeWithKeyboard(event);
        });
        this.resizeHandle.addEventListener("dblclick", () =>
        {
            this.applySidebarWidth(getDefaultSidebarWidth(window.innerWidth));
        });
        window.addEventListener("resize", () =>
        {
            this.applySidebarWidth(this.sidebarWidth);
        });

        document.documentElement.append(this.host);
        installPageLayoutStyle();
        this.applySidebarWidth(this.sidebarWidth);
        this.updateAskAvailability();
        this.addMessage(
            "assistant",
            "Ask about what’s happening now or within the last 10 minutes. For full-lecture questions, download the video and use a chat model."
        );
    }

    toggle(): void
    {
        this.setOpen(!this.isOpen);
    }

    setLectureTitle(title: string): void
    {
        this.lectureTitle.textContent = title.trim() || "Current lecture";
        this.lectureTitle.title = title;
    }

    setPlayback(playback: PlaybackSnapshot): void
    {
        const durationText = playback.duration === null ? "" : ` / ${formatTime(playback.duration)}`;
        this.time.textContent = `${formatTime(playback.currentTime)}${durationText}`;
        this.time.title = playback.isPaused ? "Lecture paused" : "Lecture playing";
    }

    setLectureState(state: LectureState): void
    {
        this.downloadButton.disabled = state.recordingStatus !== "ready";

        if (state.recordingStatus === "ready")
        {
            this.mediaStatus.textContent = "Recording ready";
            this.downloadButton.title = "Download the detected authorized recording";
            return;
        }

        this.mediaStatus.textContent = state.recordingStatus === "expired"
            ? "Media link expired — replay or reload to renew"
            : "Start playback to detect authorized media";
        this.downloadButton.title = this.mediaStatus.textContent;
    }

    setDownloadStatus(status: downloadStatus, message: string): void
    {
        this.mediaStatus.textContent = message;
        this.downloadButton.disabled = status === "starting" || status === "downloading";

        if (status === "failed")
        {
            this.addMessage("assistant", message);
        }
    }

    setTutorStatus(status: LectureProcessingStatus | null, fallbackMessage?: string): void
    {
        if (status === null)
        {
            this.tutorStatus.textContent = fallbackMessage ?? "Lecture evidence status unavailable";
            this.tutorStatus.removeAttribute("data-status");
            this.tutorStatus.removeAttribute("title");
            return;
        }

        this.tutorStatus.dataset.status = status.status;
        const transcriptProgress = status.transcriptProgress;
        const isPartialTranscript = transcriptProgress !== undefined
            && transcriptProgress.processedThroughSeconds < transcriptProgress.durationSeconds;
        this.tutorStatus.textContent = isPartialTranscript
            ? `Transcript processed through ${formatTime(transcriptProgress.processedThroughSeconds)} / `
                + `${formatTime(transcriptProgress.durationSeconds)}. ${status.message}`
            : status.message;
        const readyCapabilities = [
            status.capabilities.hasTranscript ? "transcript" : null,
            status.capabilities.hasVisuals ? "visuals" : null,
            status.capabilities.hasSegments ? "segments" : null,
            status.capabilities.hasSemanticSearch ? "semantic search" : null
        ].filter((value): value is string => value !== null);
        const readiness = readyCapabilities.length > 0
            ? `Ready: ${readyCapabilities.join(", ")}`
            : "No evidence stage is ready yet";
        const timings = status.stages.flatMap((stage) =>
        {
            return stage.durationMilliseconds === undefined
                ? []
                : [`${stage.stage}: ${(stage.durationMilliseconds / 1000).toFixed(1)}s (${stage.status})`];
        });

        if (status.acquisitionDurationMilliseconds !== undefined)
        {
            timings.unshift(`download: ${(status.acquisitionDurationMilliseconds / 1000).toFixed(1)}s`);
        }

        this.tutorStatus.title = [readiness, ...timings].join("\n");
    }

    addMessage(role: messageRole, text: string, timestampSeconds?: number): void
    {
        const message = document.createElement("div");
        message.className = `message ${role}`;
        message.textContent = text;

        if (timestampSeconds !== undefined)
        {
            const timestamp = document.createElement("button");
            timestamp.type = "button";
            timestamp.className = "timestamp";
            timestamp.textContent = `Jump to ${formatTime(timestampSeconds)}`;
            timestamp.addEventListener("click", () =>
            {
                this.callbacks.onSeek(timestampSeconds);
            });
            message.append(timestamp);
        }

        this.messages.append(message);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    startTutorAnswer(): HTMLElement
    {
        const message = document.createElement("div");
        message.className = "message assistant";
        this.messages.append(message);
        return message;
    }

    updateTutorAnswer(message: HTMLElement, text: string): void
    {
        message.replaceChildren(renderAnswer(text));
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    finishTutorAnswer(message: HTMLElement, answer: TutorAnswer): void
    {
        this.updateTutorAnswer(message, answer.answer);

        if (answer.limitations.length > 0)
        {
            const limitations = document.createElement("p");
            limitations.className = "limitations";
            limitations.textContent = `Limitations: ${answer.limitations.join(" ")}`;
            message.append(limitations);
        }

        this.messages.scrollTop = this.messages.scrollHeight;
    }

    setTutorBusy(isBusy: boolean): void
    {
        this.isTutorBusy = isBusy;
        this.textarea.disabled = isBusy;
        this.askButton.textContent = isBusy ? "Thinking…" : "Ask";
        this.updateAskAvailability();
    }

    private setOpen(isOpen: boolean): void
    {
        this.isOpen = isOpen;
        this.panel.hidden = !isOpen;
        this.updatePageLayout();

        if (isOpen)
        {
            this.textarea.focus();
        }
    }

    private startResize(event: PointerEvent): void
    {
        if (event.button !== 0)
        {
            return;
        }

        event.preventDefault();
        this.activeResizePointerId = event.pointerId;
        this.resizeStartX = event.clientX;
        this.resizeStartWidth = this.sidebarWidth;
        this.panel.dataset.resizing = "true";
        this.resizeHandle.setPointerCapture(event.pointerId);
    }

    private continueResize(event: PointerEvent): void
    {
        if (event.pointerId !== this.activeResizePointerId)
        {
            return;
        }

        event.preventDefault();
        const horizontalMovement = this.resizeStartX - event.clientX;
        this.applySidebarWidth(this.resizeStartWidth + horizontalMovement);
    }

    private finishResize(pointerId: number | null): void
    {
        if (pointerId === null || pointerId !== this.activeResizePointerId)
        {
            return;
        }

        if (this.resizeHandle.hasPointerCapture(pointerId))
        {
            this.resizeHandle.releasePointerCapture(pointerId);
        }

        this.activeResizePointerId = null;
        delete this.panel.dataset.resizing;
    }

    private resizeWithKeyboard(event: KeyboardEvent): void
    {
        const limits = getSidebarWidthLimits(window.innerWidth);
        let requestedWidth: number | null = null;

        switch (event.key)
        {
            case "ArrowLeft":
            {
                requestedWidth = this.sidebarWidth + keyboardResizeStep;
                break;
            }
            case "ArrowRight":
            {
                requestedWidth = this.sidebarWidth - keyboardResizeStep;
                break;
            }
            case "Home":
            {
                requestedWidth = limits.minimum;
                break;
            }
            case "End":
            {
                requestedWidth = limits.maximum;
                break;
            }
        }

        if (requestedWidth !== null)
        {
            event.preventDefault();
            this.applySidebarWidth(requestedWidth);
        }
    }

    private applySidebarWidth(requestedWidth: number): void
    {
        const limits = getSidebarWidthLimits(window.innerWidth);
        this.sidebarWidth = clampSidebarWidth(requestedWidth, window.innerWidth);
        this.panel.style.width = `${this.sidebarWidth}px`;
        this.resizeHandle.setAttribute("aria-valuemin", String(limits.minimum));
        this.resizeHandle.setAttribute("aria-valuemax", String(limits.maximum));
        this.resizeHandle.setAttribute("aria-valuenow", String(this.sidebarWidth));
        this.updatePageLayout();
    }

    private updatePageLayout(): void
    {
        document.documentElement.classList.toggle(pageLayoutClassName, this.isOpen);

        if (this.isOpen)
        {
            document.documentElement.style.setProperty(pageWidthProperty, `${this.sidebarWidth}px`);
        }
        else
        {
            document.documentElement.style.removeProperty(pageWidthProperty);
        }
    }

    private submitQuestion(): void
    {
        const question = this.textarea.value.trim();

        if (question.length === 0 || this.isTutorBusy)
        {
            return;
        }

        this.textarea.value = "";
        this.callbacks.onQuestion(question);
    }

    private updateAskAvailability(): void
    {
        this.askButton.disabled = this.isTutorBusy;
        this.askButton.title = "Ask about the current lecture moment";
    }
}
