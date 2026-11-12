// Defines local lecture, stage, artifact, and indexed-evidence records.

import type { processingStage, processingStatus } from "../src/shared/ingestion";

export interface StageRecord
{
    status: processingStatus;
    error: string | null;
}

export interface LectureRecord
{
    lectureId: string;
    title: string;
    durationSeconds: number | null;
    stages: Record<processingStage, StageRecord>;
}

export interface TranscriptSegment
{
    id: string;
    startSeconds: number;
    endSeconds: number;
    text: string;
}

export interface TranscriptArtifact
{
    segments: TranscriptSegment[];
}

export interface VisualEvidence
{
    id: string;
    timestampSeconds: number;
    endSeconds: number;
    relativeImagePath: string;
    description: string | null;
}

export interface VisualArtifact
{
    frames: VisualEvidence[];
}

export interface LectureSegment
{
    id: string;
    startSeconds: number;
    endSeconds: number;
    topic: string;
    summary: string;
    transcriptIds: string[];
    visualIds: string[];
    searchText: string;
}

export interface SegmentArtifact
{
    segments: LectureSegment[];
}

export interface SegmentEmbedding
{
    segmentId: string;
    vector: number[];
}

export interface EmbeddingArtifact
{
    model: string;
    embeddings: SegmentEmbedding[];
}
