// Observes UARK shared-screen recordings, starts downloads, and calls the local tutor API.

import { DownloadManager } from "./background/DownloadManager";
import { RecordingStore } from "./background/RecordingStore";
import { TutorApiClient } from "./background/TutorApiClient";
import { isRecordingExpired, parseObservedRecording, type ObservedRecording } from "./shared/media";
import {
    type backgroundNotification,
    type backgroundResponse,
    type contentRequest,
    type ExtensionError,
    type LectureState
} from "./shared/protocol";

const recordingStore = new RecordingStore();
const downloadManager = new DownloadManager();
const tutorApiClient = new TutorApiClient();

function createErrorResponse(code: ExtensionError["code"], message: string): backgroundResponse
{
    return { ok: false, error: { code, message } };
}

function createRecordingError(recording: ObservedRecording | null): backgroundResponse
{
    return recording === null
        ? createErrorResponse("mediaUnavailable", "Start lecture playback to detect its shared-screen recording.")
        : createErrorResponse("signedUrlExpired", "The recording link expired. Replay or reload the lecture to renew it.");
}

function notifyTopFrame(tabId: number, notification: backgroundNotification): void
{
    chrome.tabs.sendMessage(tabId, notification, { frameId: 0 }, () =>
    {
        void chrome.runtime.lastError;
    });
}

async function observeRecordingRequest(details: chrome.webRequest.OnBeforeRequestDetails): Promise<void>
{
    if (details.tabId < 0
        || details.frameId !== 0
        || details.initiator !== "https://uark.class.com"
        || details.method !== "GET")
    {
        return;
    }

    const recording = parseObservedRecording(details.url);

    if (recording !== null)
    {
        await recordingStore.record(details.tabId, recording);
        notifyTopFrame(details.tabId, { kind: "mediaAvailabilityChanged" });
    }
}

chrome.webRequest.onBeforeRequest.addListener(
    (details) =>
    {
        void observeRecordingRequest(details);
        return undefined;
    },
    {
        urls: ["https://*.class.com/*"],
        types: ["media", "xmlhttprequest"]
    }
);

async function getLectureState(
    tabId: number,
    lectureId: string | null
): Promise<backgroundResponse>
{
    const recording = await recordingStore.getForTab(tabId, lectureId);
    const state: LectureState = {
        lectureId,
        recordingStatus: recording === null ? "waiting" : isRecordingExpired(recording) ? "expired" : "ready"
    };
    return { ok: true, data: state };
}

async function startDownload(
    tabId: number,
    request: Extract<contentRequest, { kind: "startDownload" }>
): Promise<backgroundResponse>
{
    const recording = await recordingStore.getForTab(tabId, request.lectureId);

    if (recording === null || isRecordingExpired(recording))
    {
        return createRecordingError(recording);
    }

    try
    {
        const downloadId = await downloadManager.start(tabId, recording, request.lectureTitle);
        return { ok: true, data: { downloadId } };
    }
    catch
    {
        return createErrorResponse("downloadFailed", "Chrome could not start the download. Reload the recording and try again.");
    }
}

async function askTutor(
    tabId: number,
    request: Extract<contentRequest, { kind: "askTutor" }>
): Promise<backgroundResponse>
{
    const recording = await recordingStore.getForTab(tabId, request.question.lectureId);

    if (recording === null || isRecordingExpired(recording))
    {
        return createRecordingError(recording);
    }

    const registration = await tutorApiClient.registerLecture(
        request.question.lectureId,
        request.lectureTitle,
        recording.url
    );
    return registration.ok ? tutorApiClient.ask(request.question) : registration;
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

    switch (request.kind)
    {
        case "getLectureState":
        {
            return getLectureState(tabId, request.lectureId);
        }
        case "startDownload":
        {
            return startDownload(tabId, request);
        }
        case "askTutor":
        {
            return askTutor(tabId, request);
        }
        case "getTutorStatus":
        {
            return tutorApiClient.getStatus(request.lectureId);
        }
    }
}

chrome.runtime.onMessage.addListener((message: contentRequest, sender, sendResponse) =>
{
    void handleContentRequest(message, sender)
        .then(sendResponse)
        .catch(() =>
        {
            sendResponse(createErrorResponse("unexpectedError", "The extension could not complete the request."));
        });

    return true;
});

chrome.tabs.onRemoved.addListener((tabId) =>
{
    void recordingStore.clearTab(tabId);
});
