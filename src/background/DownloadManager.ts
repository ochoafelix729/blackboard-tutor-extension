// Starts lecture downloads and reports their lifecycle to the active tab.

import type { backgroundNotification } from "../shared/protocol";
import type { ObservedMedia } from "../shared/media";

interface ActiveDownload
{
    tabId: number;
    lectureId: string;
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

function getKindSuffix(media: ObservedMedia): string
{
    switch (media.kind)
    {
        case "sharedScreen":
        {
            return "shared-screen";
        }
        case "speaker":
        {
            return "speaker";
        }
        case "gallery":
        {
            return "gallery";
        }
        case "recording":
        {
            return "recording";
        }
    }
}

function normalizeActiveDownloads(value: unknown): activeDownloadMap
{
    if (typeof value !== "object" || value === null)
    {
        return {};
    }

    const normalized: activeDownloadMap = {};

    for (const [downloadId, candidate] of Object.entries(value))
    {
        if (typeof candidate === "object" && candidate !== null)
        {
            const entry = candidate as Partial<ActiveDownload>;

            if (typeof entry.tabId === "number" && typeof entry.lectureId === "string")
            {
                normalized[downloadId] = {
                    tabId: entry.tabId,
                    lectureId: entry.lectureId
                };
            }
        }
    }

    return normalized;
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

    async start(tabId: number, media: ObservedMedia, lectureTitle: string): Promise<number>
    {
        await this.ensureLoaded();

        const filename = `${sanitizeFilenamePart(lectureTitle)}-${getKindSuffix(media)}.mp4`;
        notifyTab(tabId, {
            kind: "downloadStatusChanged",
            status: "starting",
            message: "Starting download…"
        });

        const downloadId = await new Promise<number>((resolve, reject) =>
        {
            chrome.downloads.download({
                url: media.url,
                filename,
                conflictAction: "uniquify",
                saveAs: false
            }, (createdDownloadId) =>
            {
                const error = chrome.runtime.lastError;

                if (error !== undefined || createdDownloadId === undefined)
                {
                    reject(new Error(error?.message ?? "Chrome did not create the download."));
                    return;
                }

                resolve(createdDownloadId);
            });
        });

        this.activeDownloads[String(downloadId)] = {
            tabId,
            lectureId: media.lectureId
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
            this.loadPromise = new Promise((resolve) =>
            {
                chrome.storage.session.get(activeDownloadsStorageKey, (result) =>
                {
                    this.activeDownloads = normalizeActiveDownloads(result[activeDownloadsStorageKey]);
                    resolve();
                });
            });
        }

        await this.loadPromise;
    }

    private async persist(): Promise<void>
    {
        await new Promise<void>((resolve) =>
        {
            chrome.storage.session.set({ [activeDownloadsStorageKey]: this.activeDownloads }, () =>
            {
                resolve();
            });
        });
    }
}
