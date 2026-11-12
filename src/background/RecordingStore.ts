// Keeps one observed shared-screen recording per tab across service-worker suspensions.

import type { ObservedRecording } from "../shared/media";

type recordingsByTab = Record<string, ObservedRecording>;

const storageKey = "sharedScreenRecordingsByTab";

export class RecordingStore
{
    private recordings: recordingsByTab = {};
    private loadPromise: Promise<void> | null = null;

    async record(tabId: number, recording: ObservedRecording): Promise<void>
    {
        await this.ensureLoaded();
        this.recordings[String(tabId)] = recording;
        await this.persist();
    }

    async getForTab(tabId: number, lectureId: string | null): Promise<ObservedRecording | null>
    {
        await this.ensureLoaded();
        const recording = this.recordings[String(tabId)];

        if (recording === undefined || recording.lectureId !== lectureId)
        {
            return null;
        }

        return recording;
    }

    async clearTab(tabId: number): Promise<void>
    {
        await this.ensureLoaded();
        delete this.recordings[String(tabId)];
        await this.persist();
    }

    private async ensureLoaded(): Promise<void>
    {
        if (this.loadPromise === null)
        {
            this.loadPromise = chrome.storage.session.get(storageKey).then((result) =>
            {
                this.recordings = (result[storageKey] as recordingsByTab | undefined) ?? {};
            });
        }

        await this.loadPromise;
    }

    private persist(): Promise<void>
    {
        return chrome.storage.session.set({ [storageKey]: this.recordings });
    }
}
