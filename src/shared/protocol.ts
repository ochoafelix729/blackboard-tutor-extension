// Defines and validates messages shared between extension execution contexts.

import { isTutorQuestion, type TutorQuestion } from "./tutor";

export type mediaKind = "sharedScreen" | "speaker" | "gallery" | "recording";

export interface MediaOption
{
    assetKey: string;
    kind: mediaKind;
    label: string;
    expiresAt: number | null;
    isExpired: boolean;
}

export interface PlaybackSnapshot
{
    currentTime: number;
    duration: number | null;
    isPaused: boolean;
    hasVideo: boolean;
    visibleArea: number;
    capturedAt: number;
}

export interface LectureState
{
    lectureId: string | null;
    mediaOptions: MediaOption[];
    canDownload: boolean;
}

export type downloadStatus = "starting" | "downloading" | "complete" | "failed";

export interface ExtensionError
{
    code:
        | "invalidRequest"
        | "mediaUnavailable"
        | "signedUrlExpired"
        | "downloadFailed"
        | "tutorUnavailable"
        | "questionOutOfScope"
        | "evidenceUnavailable"
        | "lectureProcessing"
        | "modelFailed"
        | "unexpectedError";
    message: string;
}

export type contentRequest =
    | {
        kind: "getLectureState";
        pageLectureId: string | null;
    }
    | {
        kind: "startDownload";
        lectureId: string | null;
        lectureTitle: string;
    }
    | {
        kind: "reportPlayback";
        playback: PlaybackSnapshot;
    }
    | {
        kind: "resetPageState";
        changedAt: number;
    }
    | {
        kind: "seekPlayback";
        seconds: number;
    }
    | {
        kind: "askTutor";
        question: TutorQuestion;
        lectureTitle: string;
    }
    | {
        kind: "getTutorStatus";
        lectureId: string;
    };

export type backgroundNotification =
    | {
        kind: "mediaAvailabilityChanged";
    }
    | {
        kind: "playbackChanged";
        playback: PlaybackSnapshot;
    }
    | {
        kind: "seekPlayback";
        seconds: number;
    }
    | {
        kind: "downloadStatusChanged";
        status: downloadStatus;
        message: string;
    };

export type backgroundResponse =
    | {
        ok: true;
        data?: unknown;
    }
    | {
        ok: false;
        error: ExtensionError;
    };

export function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null
{
    return typeof value === "string" || value === null;
}

export function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot
{
    if (!isRecord(value))
    {
        return false;
    }

    const hasValidDuration = value.duration === null
        || (typeof value.duration === "number" && Number.isFinite(value.duration));

    return typeof value.currentTime === "number"
        && Number.isFinite(value.currentTime)
        && hasValidDuration
        && typeof value.isPaused === "boolean"
        && typeof value.hasVideo === "boolean"
        && typeof value.visibleArea === "number"
        && Number.isFinite(value.visibleArea)
        && typeof value.capturedAt === "number"
        && Number.isFinite(value.capturedAt);
}

export function isContentRequest(value: unknown): value is contentRequest
{
    if (!isRecord(value) || typeof value.kind !== "string")
    {
        return false;
    }

    switch (value.kind)
    {
        case "getLectureState":
        {
            return isNullableString(value.pageLectureId);
        }
        case "startDownload":
        {
            return isNullableString(value.lectureId) && typeof value.lectureTitle === "string";
        }
        case "reportPlayback":
        {
            return isPlaybackSnapshot(value.playback);
        }
        case "resetPageState":
        {
            return typeof value.changedAt === "number" && Number.isFinite(value.changedAt);
        }
        case "seekPlayback":
        {
            return typeof value.seconds === "number" && Number.isFinite(value.seconds);
        }
        case "askTutor":
        {
            return isTutorQuestion(value.question) && typeof value.lectureTitle === "string";
        }
        case "getTutorStatus":
        {
            return typeof value.lectureId === "string" && value.lectureId.length > 0;
        }
        default:
        {
            return false;
        }
    }
}

export function isBackgroundNotification(value: unknown): value is backgroundNotification
{
    if (!isRecord(value) || typeof value.kind !== "string")
    {
        return false;
    }

    switch (value.kind)
    {
        case "mediaAvailabilityChanged":
        {
            return true;
        }
        case "playbackChanged":
        {
            return isPlaybackSnapshot(value.playback);
        }
        case "seekPlayback":
        {
            return typeof value.seconds === "number" && Number.isFinite(value.seconds);
        }
        case "downloadStatusChanged":
        {
            const validStatuses: downloadStatus[] = ["starting", "downloading", "complete", "failed"];
            return validStatuses.includes(value.status as downloadStatus) && typeof value.message === "string";
        }
        default:
        {
            return false;
        }
    }
}

export function isBackgroundResponse(value: unknown): value is backgroundResponse
{
    if (!isRecord(value) || typeof value.ok !== "boolean")
    {
        return false;
    }

    if (value.ok)
    {
        return true;
    }

    return isRecord(value.error)
        && typeof value.error.code === "string"
        && typeof value.error.message === "string";
}

export function isLectureState(value: unknown): value is LectureState
{
    if (!isRecord(value) || !isNullableString(value.lectureId) || !Array.isArray(value.mediaOptions))
    {
        return false;
    }

    return typeof value.canDownload === "boolean" && value.mediaOptions.every((option) =>
    {
        return isRecord(option)
            && typeof option.assetKey === "string"
            && typeof option.kind === "string"
            && typeof option.label === "string"
            && (option.expiresAt === null || typeof option.expiresAt === "number")
            && typeof option.isExpired === "boolean";
    });
}
