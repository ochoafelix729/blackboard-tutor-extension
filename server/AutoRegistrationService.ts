// Acquires an authorized browser-observed recording locally and registers it without persisting signed URLs.

import { createHash, randomUUID } from "node:crypto";
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import type { LectureProcessingStatus, processingStage } from "../src/shared/ingestion";
import { IngestionCoordinator } from "./IngestionCoordinator";
import { pipelineVersion } from "./IngestionPipeline";
import { PhaseTwoStore } from "./PhaseTwoStore";

export interface AutoRegistrationRequest
{
    lectureId: string;
    title: string;
    mediaUrl: string;
}

const processingStages: processingStage[] = [
    "metadata",
    "transcript",
    "visuals",
    "segments",
    "embeddings"
];

function isClassHost(hostname: string): boolean
{
    const normalized = hostname.toLowerCase();
    return normalized === "class.com" || normalized.endsWith(".class.com");
}

function validateMediaUrl(mediaUrl: string): URL
{
    let parsed: URL;

    try
    {
        parsed = new URL(mediaUrl);
    }
    catch
    {
        throw new Error("The observed recording URL is invalid.");
    }

    if (parsed.protocol !== "https:" || !isClassHost(parsed.hostname) || !/\.mp4$/i.test(parsed.pathname))
    {
        throw new Error("The observed recording URL is not an authorized Class.com MP4.");
    }

    return parsed;
}

function createAcquisitionStatus(
    lectureId: string,
    title: string,
    status: "processing" | "failed",
    message: string
): LectureProcessingStatus
{
    return {
        lectureId,
        title,
        status,
        stages: processingStages.map((stage) => ({
            stage,
            status: status === "processing" ? "queued" : "failed",
            attempts: 0,
            error: status === "failed" ? message : null
        })),
        capabilities: {
            hasTranscript: false,
            hasVisuals: false,
            hasSegments: false,
            hasSemanticSearch: false
        },
        message
    };
}

export class AutoRegistrationService
{
    private readonly store: PhaseTwoStore;
    private readonly ingestionCoordinator: IngestionCoordinator;
    private readonly maximumMediaBytes: number;
    private readonly fetchImplementation: typeof fetch;
    private readonly activeRegistrations = new Map<string, Promise<void>>();
    private readonly registrationTitles = new Map<string, string>();
    private readonly failures = new Map<string, string>();

    constructor(
        store: PhaseTwoStore,
        ingestionCoordinator: IngestionCoordinator,
        maximumMediaBytes: number,
        fetchImplementation: typeof fetch = fetch
    )
    {
        this.store = store;
        this.ingestionCoordinator = ingestionCoordinator;
        this.maximumMediaBytes = maximumMediaBytes;
        this.fetchImplementation = fetchImplementation;
    }

    async begin(request: AutoRegistrationRequest): Promise<LectureProcessingStatus>
    {
        validateMediaUrl(request.mediaUrl);
        const title = request.title.trim() || "Class.com lecture";
        const existingStatus = await this.store.getStatus(request.lectureId);

        if (existingStatus !== null)
        {
            return existingStatus;
        }

        this.registrationTitles.set(request.lectureId, title);
        this.failures.delete(request.lectureId);

        if (!this.activeRegistrations.has(request.lectureId))
        {
            const registration = this.acquireAndRegister(request, title).catch((error: unknown) =>
            {
                const message = error instanceof Error
                    ? error.message
                    : "The authorized lecture recording could not be acquired.";
                this.failures.set(request.lectureId, message);
            }).finally(() =>
            {
                this.activeRegistrations.delete(request.lectureId);
            });
            this.activeRegistrations.set(request.lectureId, registration);
        }

        return createAcquisitionStatus(
            request.lectureId,
            title,
            "processing",
            "Acquiring the authorized recording for local processing."
        );
    }

    async getStatus(lectureId: string): Promise<LectureProcessingStatus | null>
    {
        const persistedStatus = await this.store.getStatus(lectureId);

        if (persistedStatus !== null)
        {
            return persistedStatus;
        }

        const title = this.registrationTitles.get(lectureId);

        if (title === undefined)
        {
            return null;
        }

        const failure = this.failures.get(lectureId);

        if (failure !== undefined)
        {
            return createAcquisitionStatus(lectureId, title, "failed", failure);
        }

        return createAcquisitionStatus(
            lectureId,
            title,
            "processing",
            "Acquiring the authorized recording for local processing."
        );
    }

    async isAcquiring(lectureId: string): Promise<boolean>
    {
        return this.activeRegistrations.has(lectureId);
    }

    private async acquireAndRegister(request: AutoRegistrationRequest, title: string): Promise<void>
    {
        const mediaUrl = validateMediaUrl(request.mediaUrl);
        const sourceDirectory = this.store.getSourceDirectory(request.lectureId);
        await fileSystem.rm(sourceDirectory, { recursive: true, force: true });
        await fileSystem.mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
        const videoPath = path.join(sourceDirectory, "recording.mp4");
        const fingerprint = await this.downloadRecording(mediaUrl, videoPath);
        await this.store.registerLecture(
            request.lectureId,
            title,
            {
                transcriptPath: null,
                videoPath,
                fingerprint,
                isManaged: true
            },
            pipelineVersion
        );
        await this.ingestionCoordinator.ensureProcessing(request.lectureId);
    }

    private async downloadRecording(mediaUrl: URL, videoPath: string): Promise<string>
    {
        const response = await this.fetchImplementation(mediaUrl, {
            redirect: "error",
            signal: AbortSignal.timeout(30 * 60 * 1_000)
        });

        if (!response.ok || response.body === null)
        {
            throw new Error("The authorized recording could not be downloaded. Replay the lecture and try again.");
        }

        const contentLength = Number(response.headers.get("content-length"));

        if (Number.isFinite(contentLength) && contentLength > this.maximumMediaBytes)
        {
            throw new Error("The recording exceeds the local processing size limit.");
        }

        const temporaryPath = `${videoPath}.${process.pid}.${randomUUID()}.partial`;
        const hash = createHash("sha256");
        const file = await fileSystem.open(temporaryPath, "wx", 0o600);
        let totalBytes = 0;

        try
        {
            const reader = response.body.getReader();

            while (true)
            {
                const chunk = await reader.read();

                if (chunk.done)
                {
                    break;
                }

                const buffer = Buffer.from(chunk.value);
                totalBytes += buffer.length;

                if (totalBytes > this.maximumMediaBytes)
                {
                    throw new Error("The recording exceeds the local processing size limit.");
                }

                hash.update(buffer);
                await file.write(buffer);
            }
        }
        catch (error)
        {
            await file.close();
            await fileSystem.unlink(temporaryPath).catch(() => undefined);
            throw error;
        }

        await file.close();
        await fileSystem.rename(temporaryPath, videoPath);
        return hash.digest("hex");
    }
}
