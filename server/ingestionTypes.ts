// Defines durable Phase 2 lecture, job, artifact, and indexed-evidence records.

import type { processingStage, processingStatus } from "../src/shared/ingestion";
import type { TranscriptSegment } from "./vttParser";

export interface LectureSource
{
    transcriptPath: string | null;
    videoPath: string;
    fingerprint: string;
    isManaged: boolean;
}

export interface StageRecord
{
    stage: processingStage;
    status: processingStatus;
    attempts: number;
    error: string | null;
    updatedAt: string;
}

export interface LectureRecord
{
    lectureId: string;
    title: string;
    durationSeconds: number | null;
    pipelineVersion: number;
    source: LectureSource;
    stages: Record<processingStage, StageRecord>;
    createdAt: string;
    updatedAt: string;
}

export interface ProcessingJobRecord
{
    id: string;
    idempotencyKey: string;
    lectureId: string;
    pipelineVersion: number;
    status: processingStatus;
    attempts: number;
    maximumAttempts: number;
    leaseExpiresAt: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
}

export type artifactKind = "metadata" | "transcript" | "visuals" | "segments" | "embeddings";

export interface ArtifactRecord
{
    id: string;
    lectureId: string;
    kind: artifactKind;
    pipelineVersion: number;
    relativePath: string;
    checksum: string;
    createdAt: string;
}

export interface MediaMetadataArtifact
{
    durationSeconds: number;
    formatName: string;
    videoCodec: string | null;
    audioCodec: string | null;
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
    dimensions: number;
    embeddings: SegmentEmbedding[];
}

export interface PhaseTwoState
{
    version: 1;
    lectures: Record<string, LectureRecord>;
    jobs: Record<string, ProcessingJobRecord>;
    artifacts: ArtifactRecord[];
}
