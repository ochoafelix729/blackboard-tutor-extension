// Tracks and captures the UARK player's shared-screen video.

import type { PlaybackSnapshot } from "../shared/protocol";

type playbackListener = (playback: PlaybackSnapshot) => void;

function getLectureVideo(): HTMLVideoElement | null
{
    return document.querySelector<HTMLVideoElement>("[data-analytics-id=video-container] video");
}

function createSnapshot(mediaElement: HTMLVideoElement): PlaybackSnapshot
{
    const currentTime = Number.isFinite(mediaElement.currentTime)
        ? Math.max(0, mediaElement.currentTime)
        : 0;
    const duration = Number.isFinite(mediaElement.duration) && mediaElement.duration > 0
        ? mediaElement.duration
        : null;

    return {
        currentTime,
        duration,
        isPaused: mediaElement.paused
    };
}

export class PlaybackTracker
{
    private readonly listener: playbackListener;

    constructor(listener: playbackListener)
    {
        this.listener = listener;
    }

    start(): void
    {
        this.capture();
        window.setInterval(() =>
        {
            this.capture();
        }, 500);
    }

    seek(seconds: number): void
    {
        const mediaElement = getLectureVideo();

        if (mediaElement === null || !Number.isFinite(seconds))
        {
            return;
        }

        const maximum = Number.isFinite(mediaElement.duration) ? mediaElement.duration : seconds;
        mediaElement.currentTime = Math.max(0, Math.min(seconds, maximum));
        this.capture();
    }

    captureCurrentFrame(): string | null
    {
        const mediaElement = getLectureVideo();

        if (mediaElement === null
            || mediaElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            || mediaElement.videoWidth <= 0
            || mediaElement.videoHeight <= 0)
        {
            return null;
        }

        const maximumWidth = 960;
        const scale = Math.min(1, maximumWidth / mediaElement.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(mediaElement.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(mediaElement.videoHeight * scale));
        const context = canvas.getContext("2d");

        if (context === null)
        {
            return null;
        }

        try
        {
            context.drawImage(mediaElement, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/jpeg", 0.72);
        }
        catch
        {
            return null;
        }
    }

    private capture(): void
    {
        const mediaElement = getLectureVideo();

        if (mediaElement !== null)
        {
            this.listener(createSnapshot(mediaElement));
        }
    }
}
