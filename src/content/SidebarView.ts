// Renders the isolated tutor sidebar and forwards user interactions.

import type { downloadStatus, LectureState, PlaybackSnapshot } from "../shared/protocol";
import type { TutorAnswer, tutorStrategy } from "../shared/tutor";
import {
    clampSidebarWidth,
    getDefaultSidebarWidth,
    getSidebarWidthLimits
} from "./sidebarLayout";

export interface SidebarCallbacks
{
    onDownload(): void;
    onQuestion(question: string, playback: PlaybackSnapshot | null, strategy: tutorStrategy): void;
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
        select,
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

        .ask:disabled {
            cursor: not-allowed;
            opacity: 0.65;
        }

        textarea:disabled,
        select:disabled {
            cursor: wait;
            opacity: 0.65;
        }

        .strategy {
            max-width: 170px;
            padding: 6px 8px;
            color: #263247;
            background: #ffffff;
            border: 1px solid #cbd2df;
            border-radius: 7px;
            font-size: 11px;
        }

        .consent {
            display: flex;
            align-items: flex-start;
            gap: 7px;
            margin-top: 9px;
            color: #596579;
            font-size: 10px;
            line-height: 1.35;
        }

        .consent input {
            flex: none;
            margin: 2px 0 0;
        }

        .answer-text,
        .limitations,
        .trace {
            margin: 0;
        }

        .limitations {
            margin-top: 8px;
            color: #596579;
            font-size: 11px;
        }

        .trace {
            margin-top: 8px;
            color: #68748a;
            font-size: 10px;
            font-variant-numeric: tabular-nums;
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
            <textarea aria-label="Ask about this lecture" placeholder="Ask about what the professor is explaining…" required></textarea>
            <label class="consent">
                <input type="checkbox" class="consent-input">
                <span>Send retrieved lecture evidence—including frames when selected—to the configured AI provider.</span>
            </label>
            <div class="composer-row">
                <select class="strategy" aria-label="Tutor evidence strategy">
                    <option value="transcriptOnly">Transcript only</option>
                    <option value="multimodal">Transcript + visuals</option>
                </select>
                <button class="ask" type="submit">Ask</button>
            </div>
            <div class="composer-row">
                <span class="hint">Playback time and estimated API cost are attached</span>
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
    private readonly launcher: HTMLButtonElement;
    private readonly lectureTitle: HTMLElement;
    private readonly time: HTMLElement;
    private readonly mediaStatus: HTMLElement;
    private readonly lectureId: HTMLInputElement;
    private readonly downloadButton: HTMLButtonElement;
    private readonly messages: HTMLElement;
    private readonly form: HTMLFormElement;
    private readonly textarea: HTMLTextAreaElement;
    private readonly strategy: HTMLSelectElement;
    private readonly askButton: HTMLButtonElement;
    private readonly consentInput: HTMLInputElement;
    private playback: PlaybackSnapshot | null = null;
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
        this.launcher = requireElement(shadowRoot, ".launcher");
        this.lectureTitle = requireElement(shadowRoot, ".lecture-title");
        this.time = requireElement(shadowRoot, ".time");
        this.mediaStatus = requireElement(shadowRoot, ".media-status");
        this.lectureId = requireElement(shadowRoot, ".lecture-id");
        this.downloadButton = requireElement(shadowRoot, ".download");
        this.messages = requireElement(shadowRoot, ".messages");
        this.form = requireElement(shadowRoot, ".composer");
        this.textarea = requireElement(shadowRoot, "textarea");
        this.strategy = requireElement(shadowRoot, ".strategy");
        this.askButton = requireElement(shadowRoot, ".ask");
        this.consentInput = requireElement(shadowRoot, ".consent-input");

        requireElement<HTMLButtonElement>(shadowRoot, ".close").addEventListener("click", () =>
        {
            this.setOpen(false);
        });
        this.launcher.addEventListener("click", () =>
        {
            this.setOpen(true);
        });
        this.downloadButton.addEventListener("click", () =>
        {
            this.callbacks.onDownload();
        });
        this.lectureId.addEventListener("click", () =>
        {
            const lectureId = this.lectureId.value;
            this.lectureId.select();

            if (this.lectureId.dataset.isAvailable === "true" && navigator.clipboard !== undefined)
            {
                void navigator.clipboard.writeText(lectureId).then(() =>
                {
                    this.lectureId.value = "Lecture ID copied";
                    window.setTimeout(() =>
                    {
                        this.lectureId.value = lectureId;
                        this.lectureId.select();
                    }, 1_200);
                }).catch(() =>
                {
                    this.lectureId.title = "Clipboard permission was denied";
                });
            }
        });
        this.form.addEventListener("submit", (event) =>
        {
            event.preventDefault();
            this.submitQuestion();
        });
        this.consentInput.addEventListener("change", () =>
        {
            this.updateAskAvailability();
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
            "I’m tracking the lecture’s playback position. Ask a question to capture it with the current timestamp."
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
        this.playback = playback;
        const durationText = playback.duration === null ? "" : ` / ${formatTime(playback.duration)}`;
        this.time.textContent = `${formatTime(playback.currentTime)}${durationText}`;
        this.time.title = playback.isPaused ? "Lecture paused" : "Lecture playing";
    }

    setLectureState(state: LectureState): void
    {
        const lectureId = state.lectureId ?? "Lecture ID unavailable";
        this.lectureId.value = lectureId;
        this.lectureId.title = state.lectureId === null
            ? "A stable lecture ID has not been detected"
            : "Copy the stable lecture ID";

        if (state.lectureId === null)
        {
            delete this.lectureId.dataset.isAvailable;
        }
        else
        {
            this.lectureId.dataset.isAvailable = "true";
        }

        this.downloadButton.disabled = !state.canDownload;

        if (state.canDownload)
        {
            const preferredLabel = state.mediaOptions.find((option) => !option.isExpired)?.label;
            this.mediaStatus.textContent = preferredLabel ?? "Recording ready";
            this.downloadButton.title = "Download the detected authorized recording";
            return;
        }

        const hasExpiredMedia = state.mediaOptions.some((option) => option.isExpired);
        this.mediaStatus.textContent = hasExpiredMedia
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

    addTutorAnswer(answer: TutorAnswer): void
    {
        const message = document.createElement("div");
        message.className = "message assistant";

        const answerText = document.createElement("p");
        answerText.className = "answer-text";
        answerText.textContent = answer.answer;
        message.append(answerText);

        for (const citation of answer.citations)
        {
            const timestamp = document.createElement("button");
            timestamp.type = "button";
            timestamp.className = "timestamp";
            timestamp.textContent = `Jump to ${formatTime(citation.startSeconds)}`;
            timestamp.title = `Evidence: ${citation.evidenceIds.join(", ")}`;
            timestamp.addEventListener("click", () =>
            {
                this.callbacks.onSeek(citation.startSeconds);
            });
            message.append(timestamp);
        }

        if (answer.limitations.length > 0)
        {
            const limitations = document.createElement("p");
            limitations.className = "limitations";
            limitations.textContent = `Limitations: ${answer.limitations.join(" ")}`;
            message.append(limitations);
        }

        const trace = document.createElement("p");
        trace.className = "trace";
        const cost = answer.cost.estimatedCostUsd === null
            ? "cost unpriced"
            : `est. $${answer.cost.estimatedCostUsd.toFixed(6)}`;
        trace.textContent = [
            answer.cost.model,
            `${answer.cost.inputTokens} in / ${answer.cost.outputTokens} out`,
            cost,
            `trace ${answer.cost.traceId.slice(0, 8)}`
        ].join(" · ");
        message.append(trace);

        this.messages.append(message);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    setTutorBusy(isBusy: boolean): void
    {
        this.isTutorBusy = isBusy;
        this.textarea.disabled = isBusy;
        this.strategy.disabled = isBusy;
        this.consentInput.disabled = isBusy;
        this.askButton.textContent = isBusy ? "Thinking…" : "Ask";
        this.updateAskAvailability();
    }

    private setOpen(isOpen: boolean): void
    {
        this.isOpen = isOpen;
        this.panel.hidden = !isOpen;
        this.launcher.hidden = isOpen;
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

        if (question.length === 0 || !this.consentInput.checked || this.isTutorBusy)
        {
            return;
        }

        this.textarea.value = "";
        const strategy = this.strategy.value === "transcriptOnly"
            ? "transcriptOnly"
            : "multimodal";
        this.callbacks.onQuestion(question, this.playback, strategy);
    }

    private updateAskAvailability(): void
    {
        this.askButton.disabled = this.isTutorBusy || !this.consentInput.checked;
        this.askButton.title = this.consentInput.checked
            ? "Ask about the current lecture moment"
            : "Confirm evidence sharing before asking";
    }
}
