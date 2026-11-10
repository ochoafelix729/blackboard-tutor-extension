// Coordinates media observation, playback messaging, and downloads in the service worker.

import { DownloadManager } from "./background/DownloadManager";
import { MediaStore } from "./background/MediaStore";
import { TutorApiClient } from "./background/TutorApiClient";
import { isMediaExpired, parseObservedMedia, selectPreferredMedia } from "./shared/media";
import {
    isContentRequest,
    type backgroundNotification,
    type backgroundResponse,
    type contentRequest,
    type ExtensionError,
    type LectureState,
    type MediaOption,
    type PlaybackSnapshot
} from "./shared/protocol";

const observedMediaStore = new MediaStore();
const lectureDownloadManager = new DownloadManager();
const tutorApiClient = new TutorApiClient();
interface TabPlayback
{
    frameId: number;
    playback: PlaybackSnapshot;
}

const playbackByTab = new Map<number, TabPlayback>();

function createErrorResponse(
    code: ExtensionError["code"],
    message: string
): backgroundResponse
{
    return {
        ok: false,
        error: {
            code,
            message
        }
    };
}

function notifyTopFrame(tabId: number, notification: backgroundNotification): void
{
    chrome.tabs.sendMessage(tabId, notification, { frameId: 0 }, () =>
    {
        void chrome.runtime.lastError;
    });
}

async function observeMediaRequest(details: chrome.webRequest.OnBeforeRequestDetails): Promise<void>
{
    if (details.tabId < 0 || details.method !== "GET")
    {
        return;
    }

    const documentId = "documentId" in details && typeof details.documentId === "string"
        ? details.documentId
        : null;
    const media = parseObservedMedia(details.url, Date.now(), documentId);

    if (media === null)
    {
        return;
    }

    await observedMediaStore.record(details.tabId, media);
    notifyTopFrame(details.tabId, { kind: "mediaAvailabilityChanged" });
}

function handleObservedRequest(
    details: chrome.webRequest.OnBeforeRequestDetails
): chrome.webRequest.BlockingResponse
{
    void observeMediaRequest(details);
    return {};
}

chrome.webRequest.onBeforeRequest.addListener(
    handleObservedRequest,
    {
        urls: ["https://*.class.com/*"],
        types: ["media", "xmlhttprequest"]
    }
);

function chooseCurrentLectureId(
    mediaCandidates: Awaited<ReturnType<MediaStore["getForTab"]>>,
    pageLectureId: string | null
): string | null
{
    if (pageLectureId !== null && mediaCandidates.some((candidate) => candidate.lectureId === pageLectureId))
    {
        return pageLectureId;
    }

    return mediaCandidates[0]?.lectureId ?? pageLectureId;
}

function createLectureState(
    mediaCandidates: Awaited<ReturnType<MediaStore["getForTab"]>>,
    pageLectureId: string | null
): LectureState
{
    const lectureId = chooseCurrentLectureId(mediaCandidates, pageLectureId);
    const relevantCandidates = mediaCandidates.filter((candidate) =>
    {
        return candidate.lectureId === lectureId;
    });
    const mediaOptions: MediaOption[] = relevantCandidates.map((candidate) =>
    {
        return {
            assetKey: candidate.assetKey,
            kind: candidate.kind,
            label: candidate.label,
            expiresAt: candidate.expiresAt,
            isExpired: isMediaExpired(candidate)
        };
    });

    return {
        lectureId,
        mediaOptions,
        canDownload: selectPreferredMedia(relevantCandidates, lectureId) !== null
    };
}

async function getLectureState(
    tabId: number,
    documentId: string | null,
    pageLectureId: string | null
): Promise<backgroundResponse>
{
    const mediaCandidates = await observedMediaStore.getForTab(tabId, documentId);

    return {
        ok: true,
        data: createLectureState(mediaCandidates, pageLectureId)
    };
}

async function startDownload(
    tabId: number,
    documentId: string | null,
    request: Extract<contentRequest, { kind: "startDownload" }>
): Promise<backgroundResponse>
{
    const mediaCandidates = await observedMediaStore.getForTab(tabId, documentId);
    const selectedMedia = selectPreferredMedia(mediaCandidates, request.lectureId);

    if (selectedMedia === null)
    {
        const hasExpiredMedia = mediaCandidates.some((candidate) =>
        {
            return (request.lectureId === null || candidate.lectureId === request.lectureId)
                && isMediaExpired(candidate);
        });

        if (hasExpiredMedia)
        {
            return createErrorResponse(
                "signedUrlExpired",
                "The recording link expired. Replay or reload the lecture to renew it, then try again."
            );
        }

        return createErrorResponse(
            "mediaUnavailable",
            "No downloadable recording is available yet. Start lecture playback and try again."
        );
    }

    try
    {
        const downloadId = await lectureDownloadManager.start(tabId, selectedMedia, request.lectureTitle);

        return {
            ok: true,
            data: { downloadId }
        };
    }
    catch
    {
        return createErrorResponse(
            "downloadFailed",
            "Chrome could not start the download. Replay or reload the lecture and try again."
        );
    }
}

function relayPlayback(tabId: number, frameId: number, playback: PlaybackSnapshot): void
{
    const previous = playbackByTab.get(tabId);
    // Choose the most useful frame's snapshot instead of letting every iframe overwrite it.
    const shouldReplace = previous === undefined
        || previous.frameId === frameId
        || (playback.hasVideo && !previous.playback.hasVideo)
        || (!playback.isPaused && previous.playback.isPaused)
        || playback.visibleArea > previous.playback.visibleArea
        || playback.capturedAt - previous.playback.capturedAt > 2_000;

    if (!shouldReplace)
    {
        return;
    }

    playbackByTab.set(tabId, { frameId, playback });

    if (frameId !== 0)
    {
        notifyTopFrame(tabId, {
            kind: "playbackChanged",
            playback
        });
    }
}

async function handleContentRequest(
    request: contentRequest,
    sender: chrome.runtime.MessageSender
): Promise<backgroundResponse>
{
    const tabId = sender.tab?.id;

    if (tabId === undefined)
    {
        return createErrorResponse("invalidRequest", "The request is not associated with a browser tab.");
    }

    const documentId = typeof sender.documentId === "string" ? sender.documentId : null;

    switch (request.kind)
    {
        case "getLectureState":
        {
            return getLectureState(tabId, documentId, request.pageLectureId);
        }
        case "startDownload":
        {
            return startDownload(tabId, documentId, request);
        }
        case "reportPlayback":
        {
            relayPlayback(tabId, sender.frameId ?? 0, request.playback);
            return { ok: true };
        }
        case "resetPageState":
        {
            // Navigation invalidates both the old playback winner and old media requests.
            playbackByTab.delete(tabId);
            await observedMediaStore.clearObservedBefore(tabId, request.changedAt);
            return { ok: true };
        }
        case "seekPlayback":
        {
            chrome.tabs.sendMessage(tabId, {
                kind: "seekPlayback",
                seconds: request.seconds
            } satisfies backgroundNotification, () =>
            {
                void chrome.runtime.lastError;
            });
            return { ok: true };
        }
        case "askTutor":
        {
            const result = await tutorApiClient.ask(request.question);

            if (!result.ok)
            {
                return {
                    ok: false,
                    error: result.error
                };
            }

            return {
                ok: true,
                data: result.answer
            };
        }
    }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) =>
{
    if (!isContentRequest(message))
    {
        return false;
    }

    void handleContentRequest(message, sender)
        .then((response) =>
        {
            sendResponse(response);
        })
        .catch(() =>
        {
            sendResponse(createErrorResponse("unexpectedError", "The extension could not complete the request."));
        });

    return true;
});

chrome.tabs.onRemoved.addListener((tabId) =>
{
    playbackByTab.delete(tabId);
    void observedMediaStore.clearTab(tabId);
});
