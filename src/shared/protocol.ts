// Defines messages passed between this extension's content script and service worker.

import type { TutorQuestion } from "./tutor";

export type recordingStatus = "waiting" | "ready" | "expired";

export interface PlaybackSnapshot
{
    currentTime: number;
    duration: number | null;
    isPaused: boolean;
}

export interface LectureState
{
    lectureId: string | null;
    recordingStatus: recordingStatus;
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
        lectureId: string | null;
    }
    | {
        kind: "startDownload";
        lectureId: string | null;
        lectureTitle: string;
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
