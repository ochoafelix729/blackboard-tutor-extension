// Starts lecture downloads and reports their lifecycle to the active tab.

import type { backgroundNotification } from "../shared/protocol";
import type { ObservedRecording } from "../shared/media";

interface ActiveDownload
{
    tabId: number;
}

type activeDownloadMap = Record<string, ActiveDownload>;

const activeDownloadsStorageKey = "activeLectureDownloads";

function sanitizeFilenamePart(value: string): string
{
    const sanitized = value
        .normalize("NFKD")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

    return sanitized.length > 0 ? sanitized : "lecture";
}

function notifyTab(tabId: number, notification: backgroundNotification): void
{
    chrome.tabs.sendMessage(tabId, notification, { frameId: 0 }, () =>
    {
        void chrome.runtime.lastError;
    });
}

export class DownloadManager
{
    private activeDownloads: activeDownloadMap = {};
    private loadPromise: Promise<void> | null = null;

    constructor()
    {
        chrome.downloads.onChanged.addListener((delta) =>
        {
            void this.handleDownloadChange(delta);
        });
    }

    async start(tabId: number, recording: ObservedRecording, lectureTitle: string): Promise<number>
    {
        await this.ensureLoaded();

        const filename = `${sanitizeFilenamePart(lectureTitle)}.mp4`;
        notifyTab(tabId, {
            kind: "downloadStatusChanged",
            status: "starting",
            message: "Starting download…"
        });

        const downloadId = await chrome.downloads.download({
            url: recording.url,
            filename,
            conflictAction: "uniquify",
            saveAs: false
        });

        this.activeDownloads[String(downloadId)] = {
            tabId
        };
        await this.persist();
        notifyTab(tabId, {
            kind: "downloadStatusChanged",
            status: "downloading",
            message: "Download in progress"
        });

        return downloadId;
    }

    private async handleDownloadChange(delta: chrome.downloads.DownloadDelta): Promise<void>
    {
        if (delta.state?.current !== "complete" && delta.state?.current !== "interrupted")
        {
            return;
        }

        await this.ensureLoaded();

        const activeDownload = this.activeDownloads[String(delta.id)];

        if (activeDownload === undefined)
        {
            return;
        }

        const didComplete = delta.state.current === "complete";
        notifyTab(activeDownload.tabId, {
            kind: "downloadStatusChanged",
            status: didComplete ? "complete" : "failed",
            message: didComplete
                ? "Download complete"
                : "Download failed. Replay or reload the lecture to renew its media link, then try again."
        });

        delete this.activeDownloads[String(delta.id)];
        await this.persist();
    }

    private async ensureLoaded(): Promise<void>
    {
        if (this.loadPromise === null)
        {
            this.loadPromise = chrome.storage.session.get(activeDownloadsStorageKey).then((result) =>
            {
                this.activeDownloads = (result[activeDownloadsStorageKey] as activeDownloadMap | undefined) ?? {};
            });
        }

        await this.loadPromise;
    }

    private persist(): Promise<void>
    {
        return chrome.storage.session.set({ [activeDownloadsStorageKey]: this.activeDownloads });
    }
}
