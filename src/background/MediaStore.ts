// Persists recently observed media links across service-worker suspensions.

import type { ObservedMedia } from "../shared/media";

type storedMediaByTab = Record<string, ObservedMedia[]>;

const storageKey = "observedMediaByTab";
const maximumCandidatesPerTab = 12;

function isStoredMedia(value: unknown): value is ObservedMedia
{
    if (typeof value !== "object" || value === null)
    {
        return false;
    }

    const candidate = value as Partial<ObservedMedia>;

    return typeof candidate.assetKey === "string"
        && typeof candidate.lectureId === "string"
        && typeof candidate.url === "string"
        && typeof candidate.kind === "string"
        && typeof candidate.label === "string"
        && (candidate.expiresAt === null || typeof candidate.expiresAt === "number")
        && typeof candidate.observedAt === "number"
        && (candidate.documentId === null || typeof candidate.documentId === "string");
}

function normalizeStoredMedia(value: unknown): storedMediaByTab
{
    if (typeof value !== "object" || value === null)
    {
        return {};
    }

    const normalized: storedMediaByTab = {};

    for (const [tabId, candidates] of Object.entries(value))
    {
        if (Array.isArray(candidates))
        {
            normalized[tabId] = candidates.filter(isStoredMedia).slice(0, maximumCandidatesPerTab);
        }
    }

    return normalized;
}

export class MediaStore
{
    private mediaByTab: storedMediaByTab = {};
    private loadPromise: Promise<void> | null = null;

    async record(tabId: number, candidate: ObservedMedia): Promise<void>
    {
        await this.ensureLoaded();

        const tabKey = String(tabId);
        const existingCandidates = this.mediaByTab[tabKey] ?? [];
        const candidates = existingCandidates.filter((existing) =>
        {
            return existing.assetKey !== candidate.assetKey;
        });

        candidates.unshift(candidate);
        this.mediaByTab[tabKey] = candidates.slice(0, maximumCandidatesPerTab);
        await this.persist();
    }

    async getForTab(tabId: number, documentId: string | null): Promise<ObservedMedia[]>
    {
        await this.ensureLoaded();

        const candidates = this.mediaByTab[String(tabId)] ?? [];

        if (documentId === null)
        {
            return [...candidates];
        }

        const documentCandidates = candidates.filter((candidate) =>
        {
            return candidate.documentId === null || candidate.documentId === documentId;
        });

        return documentCandidates.length > 0 ? documentCandidates : [...candidates];
    }

    async clearObservedBefore(tabId: number, changedAt: number): Promise<void>
    {
        await this.ensureLoaded();

        const tabKey = String(tabId);
        const candidates = this.mediaByTab[tabKey] ?? [];
        const remainingCandidates = candidates.filter((candidate) =>
        {
            return candidate.observedAt >= changedAt;
        });

        if (remainingCandidates.length === 0)
        {
            delete this.mediaByTab[tabKey];
        }
        else
        {
            this.mediaByTab[tabKey] = remainingCandidates;
        }

        await this.persist();
    }

    async clearTab(tabId: number): Promise<void>
    {
        await this.ensureLoaded();
        delete this.mediaByTab[String(tabId)];
        await this.persist();
    }

    private async ensureLoaded(): Promise<void>
    {
        if (this.loadPromise === null)
        {
            this.loadPromise = new Promise((resolve) =>
            {
                chrome.storage.session.get(storageKey, (result) =>
                {
                    this.mediaByTab = normalizeStoredMedia(result[storageKey]);
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
            chrome.storage.session.set({ [storageKey]: this.mediaByTab }, () =>
            {
                resolve();
            });
        });
    }
}
