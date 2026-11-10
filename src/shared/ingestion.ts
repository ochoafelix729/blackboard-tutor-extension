// Defines validated Phase 2 lecture-processing status contracts shared with the extension UI.

export type processingStage = "metadata" | "transcript" | "visuals" | "segments" | "embeddings";

export type processingStatus = "notStarted" | "queued" | "processing" | "ready" | "failed";

export interface StageProcessingStatus
{
    stage: processingStage;
    status: processingStatus;
    attempts: number;
    error: string | null;
}

export interface LectureCapabilities
{
    hasTranscript: boolean;
    hasVisuals: boolean;
    hasSegments: boolean;
    hasSemanticSearch: boolean;
}

export interface LectureProcessingStatus
{
    lectureId: string;
    title: string;
    status: processingStatus;
    stages: StageProcessingStatus[];
    capabilities: LectureCapabilities;
    message: string;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function isProcessingStage(value: unknown): value is processingStage
{
    return value === "metadata"
        || value === "transcript"
        || value === "visuals"
        || value === "segments"
        || value === "embeddings";
}

function isProcessingStatus(value: unknown): value is processingStatus
{
    return value === "notStarted"
        || value === "queued"
        || value === "processing"
        || value === "ready"
        || value === "failed";
}

function isStageProcessingStatus(value: unknown): value is StageProcessingStatus
{
    return isRecord(value)
        && isProcessingStage(value.stage)
        && isProcessingStatus(value.status)
        && typeof value.attempts === "number"
        && Number.isInteger(value.attempts)
        && value.attempts >= 0
        && (value.error === null || typeof value.error === "string");
}

function isLectureCapabilities(value: unknown): value is LectureCapabilities
{
    return isRecord(value)
        && typeof value.hasTranscript === "boolean"
        && typeof value.hasVisuals === "boolean"
        && typeof value.hasSegments === "boolean"
        && typeof value.hasSemanticSearch === "boolean";
}

export function isLectureProcessingStatus(value: unknown): value is LectureProcessingStatus
{
    return isRecord(value)
        && typeof value.lectureId === "string"
        && typeof value.title === "string"
        && isProcessingStatus(value.status)
        && Array.isArray(value.stages)
        && value.stages.every(isStageProcessingStatus)
        && isLectureCapabilities(value.capabilities)
        && typeof value.message === "string";
}
