// Defines lecture-processing stages and progress shown by the sidebar.

export const processingStages = ["metadata", "transcript", "visuals", "segments", "embeddings"] as const;

export type processingStage = typeof processingStages[number];

export type processingStatus = "notStarted" | "processing" | "ready" | "failed";

export interface StageProcessingStatus
{
    stage: processingStage;
    status: processingStatus;
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
