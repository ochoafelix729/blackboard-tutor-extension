// Acquires and processes one local lecture at a time, reusing completed evidence stages.

import { createWriteStream, promises as fileSystem } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline as download } from "node:stream/promises";
import { processingStages, type LectureProcessingStatus } from "../src/shared/ingestion";
import type { LectureRecord } from "./ingestionTypes";
import { IngestionPipeline } from "./IngestionPipeline";
import { LectureStore } from "./LectureStore";
import { TutorServiceError } from "./TutorServiceError";

export interface AutoRegistrationRequest
{
    lectureId: string;
    title: string;
    mediaUrl: string;
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
            status: status === "processing" ? "notStarted" : "failed",
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
    private readonly store: LectureStore;
    private readonly pipeline: IngestionPipeline;
    private currentRun: LectureProcessingStatus | null = null;

    constructor(
        store: LectureStore,
        pipeline: IngestionPipeline
    )
    {
        this.store = store;
        this.pipeline = pipeline;
    }

    async begin(request: AutoRegistrationRequest): Promise<LectureProcessingStatus>
    {
        const existingStatus = this.store.getStatus(request.lectureId);

        if (existingStatus?.status === "ready")
        {
            return existingStatus;
        }

        const activeRun = this.currentRun;

        if (activeRun?.status === "processing")
        {
            if (activeRun.lectureId !== request.lectureId)
            {
                throw new TutorServiceError(
                    "lectureProcessing",
                    "Another lecture is being prepared. Ask again once it finishes."
                );
            }

            return this.getStatus(request.lectureId) ?? activeRun;
        }

        const title = request.title.trim() || "UARK Class recording";
        const status = createAcquisitionStatus(
            request.lectureId,
            title,
            "processing",
            existingStatus === null ? "Acquiring the recording for local processing." : "Preparing lecture evidence."
        );
        this.currentRun = status;
        void this.prepareLecture(request, title).then(() =>
        {
            this.currentRun = null;
        }).catch((error: unknown) =>
        {
            const message = error instanceof Error ? error.message : "Lecture processing failed.";
            this.currentRun = createAcquisitionStatus(request.lectureId, title, "failed", message);
        });
        return status;
    }

    getStatus(lectureId: string): LectureProcessingStatus | null
    {
        const storedStatus = this.store.getStatus(lectureId);
        const run = this.currentRun;

        if (run?.lectureId !== lectureId || storedStatus?.status === "ready")
        {
            return storedStatus;
        }

        if (storedStatus === null)
        {
            return run;
        }

        return {
            ...storedStatus,
            status: run.status,
            message: run.status === "failed"
                ? run.message
                : storedStatus.capabilities.hasTranscript
                    ? "Transcript ready. Preparing the remaining lecture evidence."
                    : "Preparing lecture evidence."
        };
    }

    private async prepareLecture(request: AutoRegistrationRequest, title: string): Promise<void>
    {
        const lecture = this.store.getLecture(request.lectureId)
            ?? await this.acquireAndRegister(request, title);
        await this.pipeline.process(lecture);
    }

    private async acquireAndRegister(request: AutoRegistrationRequest, title: string): Promise<LectureRecord>
    {
        await fileSystem.mkdir(this.store.getLectureDirectory(request.lectureId), { recursive: true });
        const response = await fetch(request.mediaUrl);

        if (!response.ok || response.body === null)
        {
            throw new Error("The recording could not be downloaded. Reload the lecture and try again.");
        }

        await download(
            Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
            createWriteStream(this.store.getRecordingPath(request.lectureId))
        );
        return this.store.registerLecture(request.lectureId, title);
    }
}
