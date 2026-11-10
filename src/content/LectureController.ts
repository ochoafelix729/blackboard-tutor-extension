// Coordinates lecture identity, playback context, downloads, and sidebar state.

import { detectLectureIdentity, type LectureIdentity } from "../shared/lectureIdentity";
import { isLectureProcessingStatus } from "../shared/ingestion";
import { evaluateQuestionScope } from "../shared/questionScope";
import {
    isBackgroundNotification,
    isBackgroundResponse,
    isLectureState,
    type backgroundResponse,
    type contentRequest,
    type LectureState,
    type PlaybackSnapshot
} from "../shared/protocol";
import { isTutorAnswer, type tutorStrategy } from "../shared/tutor";
import { PlaybackTracker } from "./PlaybackTracker";
import { SidebarView } from "./SidebarView";
import { ToolbarController } from "./ToolbarController";

function sendRequest(request: contentRequest): Promise<backgroundResponse>
{
    return new Promise((resolve) =>
    {
        chrome.runtime.sendMessage(request, (response: unknown) =>
        {
            const error = chrome.runtime.lastError;

            if (error !== undefined)
            {
                resolve({
                    ok: false,
                    error: {
                        code: "unexpectedError",
                        message: "The extension service is temporarily unavailable."
                    }
                });
                return;
            }

            if (!isBackgroundResponse(response))
            {
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

function getLectureTitle(): string
{
    const selectors = [
        "[data-recording-title]",
        "[data-session-title]",
        "h1",
        "title"
    ];

    for (const selector of selectors)
    {
        const element = document.querySelector(selector);
        const title = element?.getAttribute("data-recording-title")
            ?? element?.getAttribute("data-session-title")
            ?? element?.textContent;

        if (title !== null && title !== undefined && title.trim().length > 0)
        {
            return title.trim();
        }
    }

    return "Class.com lecture";
}

export class LectureController
{
    private identity: LectureIdentity;
    private lectureState: LectureState;
    private readonly sidebar: SidebarView;
    private readonly toolbar: ToolbarController;
    private readonly tracker: PlaybackTracker;
    private currentLocation = window.location.href;
    private latestPlayback: PlaybackSnapshot | null = null;
    private lastPlaybackReportAt = 0;

    constructor()
    {
        this.identity = detectLectureIdentity(new URL(window.location.href), document);
        this.lectureState = {
            lectureId: this.identity.lectureId,
            mediaOptions: [],
            canDownload: false
        };
        this.sidebar = new SidebarView({
            onDownload: () =>
            {
                void this.startDownload();
            },
            onQuestion: (question, playback, strategy) =>
            {
                void this.askQuestion(question, playback, strategy);
            },
            onSeek: (seconds) =>
            {
                this.seek(seconds);
            }
        });
        this.toolbar = new ToolbarController({
            onDownload: () =>
            {
                void this.startDownload();
            },
            onToggleTutor: () =>
            {
                this.sidebar.toggle();
            }
        });
        this.tracker = new PlaybackTracker((playback) =>
        {
            this.handlePlayback(playback);
        });
    }

    start(): void
    {
        this.sidebar.setLectureTitle(getLectureTitle());
        this.toolbar.start();
        this.tracker.start();
        this.installMessageListener();
        void this.refreshLectureState();

        window.setInterval(() =>
        {
            this.checkForNavigation();
        }, 1000);
        window.setInterval(() =>
        {
            void this.refreshLectureState();
            void this.refreshTutorStatus();
        }, 5000);
        void this.refreshTutorStatus();
    }

    private installMessageListener(): void
    {
        chrome.runtime.onMessage.addListener((message: unknown) =>
        {
            if (!isBackgroundNotification(message))
            {
                return false;
            }

            switch (message.kind)
            {
                case "mediaAvailabilityChanged":
                {
                    void this.refreshLectureState();
                    break;
                }
                case "playbackChanged":
                {
                    this.handlePlayback(message.playback, false);
                    break;
                }
                case "seekPlayback":
                {
                    this.tracker.seek(message.seconds);
                    break;
                }
                case "downloadStatusChanged":
                {
                    this.sidebar.setDownloadStatus(message.status, message.message);

                    if (message.status === "complete" || message.status === "failed")
                    {
                        void this.refreshLectureState();
                    }
                    break;
                }
            }

            return false;
        });
    }

    private handlePlayback(playback: PlaybackSnapshot, shouldReport: boolean = true): void
    {
        // Keep the snapshot from the active-looking player and ignore noisier iframe updates.
        const shouldUsePlayback = this.latestPlayback === null
            || (playback.hasVideo && !this.latestPlayback.hasVideo)
            || (!playback.isPaused && this.latestPlayback.isPaused)
            || playback.visibleArea >= this.latestPlayback.visibleArea
            || playback.capturedAt - this.latestPlayback.capturedAt > 2000;

        if (!shouldUsePlayback)
        {
            return;
        }

        this.latestPlayback = playback;
        this.sidebar.setPlayback(playback);

        if (shouldReport && playback.capturedAt - this.lastPlaybackReportAt >= 1000)
        {
            // The UI samples frequently, but the background worker only needs one update per second.
            this.lastPlaybackReportAt = playback.capturedAt;
            void sendRequest({
                kind: "reportPlayback",
                playback
            });
        }
    }

    private async refreshLectureState(): Promise<void>
    {
        const response = await sendRequest({
            kind: "getLectureState",
            pageLectureId: this.identity.lectureId
        });

        if (!response.ok || !isLectureState(response.data))
        {
            return;
        }

        this.lectureState = response.data;
        this.sidebar.setLectureState(response.data);
        this.toolbar.setCanDownload(response.data.canDownload);
    }

    private async startDownload(): Promise<void>
    {
        const response = await sendRequest({
            kind: "startDownload",
            lectureId: this.lectureState.lectureId,
            lectureTitle: getLectureTitle()
        });

        if (!response.ok)
        {
            this.sidebar.setDownloadStatus("failed", response.error.message);
            await this.refreshLectureState();
        }
    }

    private async refreshTutorStatus(): Promise<void>
    {
        const lectureId = this.lectureState.lectureId;

        if (lectureId === null)
        {
            this.sidebar.setTutorStatus(null);
            return;
        }

        const response = await sendRequest({
            kind: "getTutorStatus",
            lectureId
        });

        if (!response.ok)
        {
            this.sidebar.setTutorStatus(null, response.error.message);
            return;
        }

        if (isLectureProcessingStatus(response.data))
        {
            this.sidebar.setTutorStatus(response.data);
        }
    }

    private async askQuestion(
        question: string,
        playback: PlaybackSnapshot | null,
        strategy: tutorStrategy
    ): Promise<void>
    {
        const timestamp = playback?.currentTime ?? this.latestPlayback?.currentTime;
        this.sidebar.addMessage("user", question, timestamp);

        if (timestamp === undefined)
        {
            this.sidebar.addMessage(
                "assistant",
                "Start or pause the lecture so I can attach a playback timestamp, then ask again."
            );
            return;
        }

        const scopeDecision = evaluateQuestionScope(question, timestamp);

        if (!scopeDecision.isAllowed)
        {
            this.sidebar.addMessage("assistant", scopeDecision.message);
            return;
        }

        if (this.lectureState.lectureId === null)
        {
            this.sidebar.addMessage(
                "assistant",
                "I could not identify this lecture yet. Start playback or reload the recording, then ask again."
            );
            return;
        }

        this.sidebar.setTutorBusy(true);

        try
        {
            const response = await sendRequest({
                kind: "askTutor",
                lectureTitle: getLectureTitle(),
                question: {
                    lectureId: this.lectureState.lectureId,
                    timestampSeconds: timestamp,
                    question,
                    strategy,
                    currentFrameDataUrl: strategy === "multimodal"
                        ? this.tracker.captureCurrentFrame()
                        : null
                }
            });

            if (!response.ok)
            {
                this.sidebar.addMessage("assistant", response.error.message);
                void this.refreshTutorStatus();
                return;
            }

            if (!isTutorAnswer(response.data))
            {
                this.sidebar.addMessage(
                    "assistant",
                    "The tutor returned an invalid answer. Check the local API and try again."
                );
                return;
            }

            this.sidebar.addTutorAnswer(response.data);
        }
        finally
        {
            this.sidebar.setTutorBusy(false);
        }
    }

    private seek(seconds: number): void
    {
        const didSeekLocally = this.tracker.seek(seconds);

        if (!didSeekLocally)
        {
            void sendRequest({
                kind: "seekPlayback",
                seconds
            });
        }
    }

    private checkForNavigation(): void
    {
        if (window.location.href === this.currentLocation)
        {
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
        this.sidebar.setTutorStatus(null);
        this.toolbar.setCanDownload(false);
        void sendRequest({ kind: "resetPageState", changedAt }).then(() =>
        {
            return this.refreshLectureState();
        }).then(() =>
        {
            return this.refreshTutorStatus();
        });
    }
}
