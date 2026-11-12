// Coordinates lecture identity, playback context, downloads, and sidebar state.

import { getPageLectureId } from "../shared/lectureIdentity";
import type { LectureProcessingStatus } from "../shared/ingestion";
import { evaluateQuestionScope } from "../shared/questionScope";
import {
    type backgroundNotification,
    type backgroundResponse,
    type contentRequest,
    type LectureState,
    type PlaybackSnapshot
} from "../shared/protocol";
import type { TutorAnswer } from "../shared/tutor";
import { PlaybackTracker } from "./PlaybackTracker";
import { SidebarView } from "./SidebarView";
import { ToolbarController } from "./ToolbarController";

async function sendRequest(request: contentRequest): Promise<backgroundResponse>
{
    try
    {
        return await chrome.runtime.sendMessage(request) as backgroundResponse;
    }
    catch
    {
        return {
            ok: false,
            error: {
                code: "unexpectedError",
                message: "The extension service is temporarily unavailable."
            }
        };
    }
}

function getLectureTitle(): string
{
    return document.title || "UARK Class recording";
}

export class LectureController
{
    private lectureState: LectureState;
    private readonly sidebar: SidebarView;
    private readonly toolbar: ToolbarController;
    private readonly tracker: PlaybackTracker;
    private currentLocation = window.location.href;
    private latestPlayback: PlaybackSnapshot | null = null;
    private preparedLectureId: string | null = null;
    private readonly refreshingLectures = new Set<string | null>();

    constructor()
    {
        this.lectureState = {
            lectureId: getPageLectureId(new URL(this.currentLocation)),
            recordingStatus: "waiting"
        };
        this.sidebar = new SidebarView({
            onDownload: () =>
            {
                void this.startDownload();
            },
            onQuestion: (question) =>
            {
                void this.askQuestion(question);
            },
            onSeek: (seconds) =>
            {
                this.tracker.seek(seconds);
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
        }, 5000);
    }

    private installMessageListener(): void
    {
        chrome.runtime.onMessage.addListener((message: backgroundNotification) =>
        {
            switch (message.kind)
            {
                case "mediaAvailabilityChanged":
                {
                    void this.refreshLectureState();
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

    private handlePlayback(playback: PlaybackSnapshot): void
    {
        this.latestPlayback = playback;
        this.sidebar.setPlayback(playback);
    }

    private async refreshLectureState(): Promise<void>
    {
        const lectureId = this.lectureState.lectureId;

        if (this.refreshingLectures.has(lectureId))
        {
            return;
        }

        this.refreshingLectures.add(lectureId);

        try
        {
            const response = await sendRequest({ kind: "getLectureState", lectureId });

            if (!response.ok || this.lectureState.lectureId !== lectureId)
            {
                return;
            }

            this.lectureState = response.data as LectureState;
            this.sidebar.setLectureState(this.lectureState);
            this.toolbar.setCanDownload(this.lectureState.recordingStatus === "ready");
            await this.refreshTutorStatus();
        }
        finally
        {
            this.refreshingLectures.delete(lectureId);
        }
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

        const shouldPrepare = this.lectureState.recordingStatus === "ready"
            && this.preparedLectureId !== lectureId;
        const response = await sendRequest(shouldPrepare
            ? { kind: "prepareTutor", lectureId, lectureTitle: getLectureTitle() }
            : { kind: "getTutorStatus", lectureId });

        if (this.lectureState.lectureId !== lectureId)
        {
            return;
        }

        if (!response.ok)
        {
            const message = response.error.code === "evidenceUnavailable"
                && this.lectureState.recordingStatus !== "ready"
                ? "Waiting for authorized media to start lecture preparation."
                : response.error.message;
            this.sidebar.setTutorStatus(null, message);
            return;
        }

        const status = response.data as LectureProcessingStatus;

        if (shouldPrepare)
        {
            this.preparedLectureId = lectureId;
        }
        else if (status.status === "notStarted")
        {
            // An API restart resets interrupted stages; the next refresh resumes them.
            this.preparedLectureId = null;
        }

        this.sidebar.setTutorStatus(status);
    }

    private async askQuestion(question: string): Promise<void>
    {
        const timestamp = this.latestPlayback?.currentTime;
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
                    currentFrameDataUrl: this.tracker.captureCurrentFrame()
                }
            });

            if (!response.ok)
            {
                this.sidebar.addMessage("assistant", response.error.message);
                void this.refreshTutorStatus();
                return;
            }

            this.sidebar.addTutorAnswer(response.data as TutorAnswer);
        }
        finally
        {
            this.sidebar.setTutorBusy(false);
        }
    }

    private checkForNavigation(): void
    {
        if (window.location.href === this.currentLocation)
        {
            return;
        }

        this.currentLocation = window.location.href;
        this.lectureState = {
            lectureId: getPageLectureId(new URL(this.currentLocation)),
            recordingStatus: "waiting"
        };
        this.latestPlayback = null;
        this.preparedLectureId = null;
        this.sidebar.setLectureTitle(getLectureTitle());
        this.sidebar.setLectureState(this.lectureState);
        this.sidebar.setTutorStatus(null);
        this.toolbar.setCanDownload(false);
        void this.refreshLectureState();
    }
}
