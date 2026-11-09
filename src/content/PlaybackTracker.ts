// Selects the active media element and emits current playback context.

import type { PlaybackSnapshot } from "../shared/protocol";

export type playbackListener = (playback: PlaybackSnapshot) => void;

function getVisibleArea(element: HTMLMediaElement): number
{
    const rectangle = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rectangle.right, window.innerWidth) - Math.max(rectangle.left, 0));
    const visibleHeight = Math.max(0, Math.min(rectangle.bottom, window.innerHeight) - Math.max(rectangle.top, 0));
    return visibleWidth * visibleHeight;
}

function getBestMediaElement(): HTMLMediaElement | null
{
    const videos = Array.from(document.querySelectorAll("video"));

    if (videos.length > 0)
    {
        return videos.sort((first, second) =>
        {
            return getVisibleArea(second) - getVisibleArea(first);
        })[0] ?? null;
    }

    return document.querySelector("audio");
}

function createSnapshot(mediaElement: HTMLMediaElement): PlaybackSnapshot
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
        isPaused: mediaElement.paused,
        hasVideo: mediaElement instanceof HTMLVideoElement,
        visibleArea: getVisibleArea(mediaElement),
        capturedAt: Date.now()
    };
}

export class PlaybackTracker
{
    private readonly listener: playbackListener;
    private intervalId: number | null = null;

    constructor(listener: playbackListener)
    {
        this.listener = listener;
    }

    start(): void
    {
        if (this.intervalId !== null)
        {
            return;
        }

        this.capture();
        this.intervalId = window.setInterval(() =>
        {
            this.capture();
        }, 500);
    }

    seek(seconds: number): boolean
    {
        const mediaElement = getBestMediaElement();

        if (mediaElement === null || !Number.isFinite(seconds))
        {
            return false;
        }

        const maximum = Number.isFinite(mediaElement.duration) ? mediaElement.duration : seconds;
        mediaElement.currentTime = Math.max(0, Math.min(seconds, maximum));
        this.capture();
        return true;
    }

    captureCurrentFrame(): string | null
    {
        const mediaElement = getBestMediaElement();

        if (!(mediaElement instanceof HTMLVideoElement)
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
        const mediaElement = getBestMediaElement();

        if (mediaElement !== null)
        {
            this.listener(createSnapshot(mediaElement));
        }
    }
}
