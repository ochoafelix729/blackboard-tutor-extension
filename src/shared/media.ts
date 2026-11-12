// Recognizes the UARK shared-screen recording and checks its signed-link expiry.

import { getMediaLectureId } from "./lectureIdentity";

export interface ObservedRecording
{
    lectureId: string;
    url: string;
    expiresAt: number | null;
}

export function parseObservedRecording(urlValue: string): ObservedRecording | null
{
    const url = new URL(urlValue);

    if (!url.pathname.toLowerCase().endsWith("/shared_screen.mp4"))
    {
        return null;
    }

    const lectureId = getMediaLectureId(url);

    if (lectureId === null)
    {
        return null;
    }

    const expirySeconds = Number(url.searchParams.get("Expires"));
    return {
        lectureId,
        url: url.href,
        expiresAt: Number.isFinite(expirySeconds) && expirySeconds > 0 ? expirySeconds * 1_000 : null
    };
}

export function isRecordingExpired(recording: ObservedRecording): boolean
{
    return recording.expiresAt !== null && recording.expiresAt <= Date.now() + 30_000;
}
