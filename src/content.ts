// Boots the top-frame lecture UI or reports playback from embedded frames.

import { LectureController } from "./content/LectureController";
import { PlaybackTracker } from "./content/PlaybackTracker";
import { isBackgroundNotification, type contentRequest } from "./shared/protocol";

const lectureSurfaceSelector = ".ClassActionBar-measure, video, audio";

function isLectureLocation(): boolean
{
    const locationText = `${window.location.pathname}${window.location.search}`;
    return /player|recording|session|meeting/i.test(locationText);
}

function startTopFrameControllerWhenReady(): void
{
    let hasStarted = false;

    function startController(): void
    {
        if (hasStarted)
        {
            return;
        }

        hasStarted = true;
        const controller = new LectureController();
        controller.start();
    }

    if (isLectureLocation() || document.querySelector(lectureSurfaceSelector) !== null)
    {
        startController();
        return;
    }

    const observer = new MutationObserver(() =>
    {
        if (isLectureLocation() || document.querySelector(lectureSurfaceSelector) !== null)
        {
            observer.disconnect();
            startController();
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}

function reportFramePlayback(): void
{
    let lastReportAt = 0;
    const tracker = new PlaybackTracker((playback) =>
    {
        if (playback.capturedAt - lastReportAt < 1000)
        {
            return;
        }

        lastReportAt = playback.capturedAt;
        const request: contentRequest = {
            kind: "reportPlayback",
            playback
        };
        chrome.runtime.sendMessage(request, () =>
        {
            void chrome.runtime.lastError;
        });
    });

    chrome.runtime.onMessage.addListener((message: unknown) =>
    {
        if (isBackgroundNotification(message) && message.kind === "seekPlayback")
        {
            tracker.seek(message.seconds);
        }

        return false;
    });
    tracker.start();
}

if (window.top === window)
{
    startTopFrameControllerWhenReady();
}
else
{
    reportFramePlayback();
}
