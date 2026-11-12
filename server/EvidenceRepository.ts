// Retrieves watched, time-aligned local tutor evidence using temporal, lexical, and semantic ranking.

import { promises as fileSystem } from "node:fs";
import {
    lectureContextLookbackSeconds,
    lectureFutureToleranceSeconds
} from "../src/shared/questionScope";
import type { OpenAiProvider } from "./OpenAiProvider";
import { LectureStore } from "./LectureStore";
import type {
    EmbeddingArtifact,
    LectureSegment,
    SegmentArtifact,
    TranscriptArtifact,
    TranscriptSegment,
    VisualArtifact
} from "./ingestionTypes";

export interface RetrievedFrame
{
    id: string;
    timestampSeconds: number;
    description: string | null;
    dataUrl: string;
}

export interface RetrievedEvidence
{
    lectureId: string;
    lectureTitle: string;
    transcript: TranscriptSegment[];
    frames: RetrievedFrame[];
}

const ignoredTerms = new Set([
    "about",
    "does",
    "explain",
    "from",
    "have",
    "lecture",
    "professor",
    "that",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would"
]);

function getQuestionTerms(question: string): Set<string>
{
    const terms = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return new Set(terms.filter((term) => term.length > 2 && !ignoredTerms.has(term)));
}

function getLexicalScore(text: string, questionTerms: Set<string>): number
{
    if (questionTerms.size === 0)
    {
        return 0;
    }

    const candidateTerms = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    let matchingTermCount = 0;

    for (const term of questionTerms)
    {
        if (candidateTerms.has(term))
        {
            matchingTermCount += 1;
        }
    }

    return matchingTermCount / questionTerms.size;
}

function getTemporalScore(startSeconds: number, endSeconds: number, timestampSeconds: number): number
{
    const midpoint = (startSeconds + endSeconds) / 2;
    return Math.max(0, 1 - Math.abs(timestampSeconds - midpoint) / 300);
}

function getCosineSimilarity(first: number[], second: number[]): number
{
    if (first.length === 0 || first.length !== second.length)
    {
        return 0;
    }

    let dotProduct = 0;
    let firstMagnitude = 0;
    let secondMagnitude = 0;

    for (let index = 0; index < first.length; index += 1)
    {
        const firstValue = first[index] ?? 0;
        const secondValue = second[index] ?? 0;
        dotProduct += firstValue * secondValue;
        firstMagnitude += firstValue * firstValue;
        secondMagnitude += secondValue * secondValue;
    }

    if (firstMagnitude === 0 || secondMagnitude === 0)
    {
        return 0;
    }

    return dotProduct / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
}

function selectTranscriptWithoutSegments(
    transcript: TranscriptSegment[],
    timestampSeconds: number,
    questionTerms: Set<string>
): TranscriptSegment[]
{
    const earliestContextSeconds = Math.max(0, timestampSeconds - lectureContextLookbackSeconds);
    const latestContextSeconds = timestampSeconds + lectureFutureToleranceSeconds;

    return transcript
        .filter((segment) =>
        {
            return segment.endSeconds >= earliestContextSeconds
                && segment.startSeconds <= latestContextSeconds;
        })
        .map((segment) => ({
            segment,
            score: getTemporalScore(segment.startSeconds, segment.endSeconds, timestampSeconds)
                + getLexicalScore(segment.text, questionTerms) * 2
        }))
        .sort((first, second) => second.score - first.score)
        .slice(0, 12)
        .map((item) => item.segment)
        .sort((first, second) => first.startSeconds - second.startSeconds);
}

export class EvidenceRepository
{
    private readonly store: LectureStore;
    private readonly provider: OpenAiProvider;
    private readonly embeddingModel: string;

    constructor(store: LectureStore, provider: OpenAiProvider, embeddingModel: string)
    {
        this.store = store;
        this.provider = provider;
        this.embeddingModel = embeddingModel;
    }

    async retrieve(
        lectureId: string,
        timestampSeconds: number,
        question: string
    ): Promise<RetrievedEvidence>
    {
        const lecture = await this.store.getLecture(lectureId);
        const transcriptArtifact = await this.store.readArtifact<TranscriptArtifact>(lectureId, "transcript");

        if (lecture === null || transcriptArtifact === null)
        {
            throw new Error("The durable lecture transcript is not ready.");
        }

        const questionTerms = getQuestionTerms(question);
        const segments = await this.store.readArtifact<SegmentArtifact>(lectureId, "segments");
        const selectedSegments = segments === null
            ? []
            : await this.selectSegments(lectureId, segments.segments, timestampSeconds, question, questionTerms);
        const selectedTranscript = selectedSegments.length === 0
            ? selectTranscriptWithoutSegments(
                transcriptArtifact.segments,
                timestampSeconds,
                questionTerms
            )
            : this.selectTranscriptForSegments(
                transcriptArtifact.segments,
                selectedSegments,
                timestampSeconds,
                questionTerms
            );

        if (selectedTranscript.length === 0)
        {
            throw new Error("The lecture transcript has no evidence at or before this timestamp.");
        }

        const frames = await this.loadFrames(lectureId, timestampSeconds, selectedSegments);
        return {
            lectureId,
            lectureTitle: lecture.title,
            transcript: selectedTranscript,
            frames
        };
    }

    private async selectSegments(
        lectureId: string,
        segments: LectureSegment[],
        timestampSeconds: number,
        question: string,
        questionTerms: Set<string>
    ): Promise<LectureSegment[]>
    {
        const earliestContextSeconds = Math.max(0, timestampSeconds - lectureContextLookbackSeconds);
        const latestContextSeconds = timestampSeconds + lectureFutureToleranceSeconds;
        const watchedSegments = segments.filter((segment) =>
        {
            return segment.endSeconds >= earliestContextSeconds
                && segment.startSeconds <= latestContextSeconds;
        });
        const embeddingArtifact = await this.store.readArtifact<EmbeddingArtifact>(lectureId, "embeddings");
        const embeddingBySegment = new Map(
            embeddingArtifact?.embeddings.map((embedding) => [embedding.segmentId, embedding.vector]) ?? []
        );
        let questionVector: number[] = [];

        if (embeddingArtifact !== null)
        {
            try
            {
                const result = await this.provider.embed({
                    model: embeddingArtifact.model || this.embeddingModel,
                    inputs: [question]
                });
                questionVector = result.vectors[0] ?? [];
            }
            catch
            {
                // Semantic retrieval is an optional enrichment; temporal and lexical search stay usable.
            }
        }

        return watchedSegments
            .map((segment) =>
            {
                const semanticScore = getCosineSimilarity(
                    questionVector,
                    embeddingBySegment.get(segment.id) ?? []
                );
                return {
                    segment,
                    score: getTemporalScore(segment.startSeconds, segment.endSeconds, timestampSeconds)
                        + getLexicalScore(segment.searchText, questionTerms) * 2
                        + Math.max(0, semanticScore) * 1.5
                };
            })
            .sort((first, second) => second.score - first.score)
            .slice(0, 4)
            .map((item) => item.segment)
            .sort((first, second) => first.startSeconds - second.startSeconds);
    }

    private selectTranscriptForSegments(
        transcript: TranscriptSegment[],
        selectedSegments: LectureSegment[],
        timestampSeconds: number,
        questionTerms: Set<string>
    ): TranscriptSegment[]
    {
        const transcriptIds = new Set(selectedSegments.flatMap((segment) => segment.transcriptIds));
        const earliestContextSeconds = Math.max(0, timestampSeconds - lectureContextLookbackSeconds);
        const latestContextSeconds = timestampSeconds + lectureFutureToleranceSeconds;
        return transcript
            .filter((segment) =>
            {
                return transcriptIds.has(segment.id)
                    && segment.endSeconds >= earliestContextSeconds
                    && segment.startSeconds <= latestContextSeconds;
            })
            .map((segment) => ({
                segment,
                score: getTemporalScore(segment.startSeconds, segment.endSeconds, timestampSeconds)
                    + getLexicalScore(segment.text, questionTerms) * 2
            }))
            .sort((first, second) => second.score - first.score)
            .slice(0, 12)
            .map((item) => item.segment)
            .sort((first, second) => first.startSeconds - second.startSeconds);
    }

    private async loadFrames(
        lectureId: string,
        timestampSeconds: number,
        selectedSegments: LectureSegment[]
    ): Promise<RetrievedFrame[]>
    {
        const visuals = await this.store.readArtifact<VisualArtifact>(lectureId, "visuals");

        if (visuals === null)
        {
            return [];
        }

        const selectedVisualIds = new Set(selectedSegments.flatMap((segment) => segment.visualIds));
        const earliestContextSeconds = Math.max(0, timestampSeconds - lectureContextLookbackSeconds);
        const latestContextSeconds = timestampSeconds + lectureFutureToleranceSeconds;
        const watchedFrames = visuals.frames.filter((frame) =>
        {
            return frame.timestampSeconds >= earliestContextSeconds
                && frame.timestampSeconds <= latestContextSeconds;
        });
        const frames = watchedFrames
            .sort((first, second) =>
            {
                const firstSelected = selectedVisualIds.has(first.id) ? 1 : 0;
                const secondSelected = selectedVisualIds.has(second.id) ? 1 : 0;

                if (firstSelected !== secondSelected)
                {
                    return secondSelected - firstSelected;
                }

                return Math.abs(first.timestampSeconds - timestampSeconds)
                    - Math.abs(second.timestampSeconds - timestampSeconds);
            })
            .slice(0, 2);
        return Promise.all(frames.map(async (frame) =>
        {
            const framePath = this.store.getFramePath(lectureId, frame.relativeImagePath);
            const buffer = await fileSystem.readFile(framePath);
            return {
                id: frame.id,
                timestampSeconds: frame.timestampSeconds,
                description: frame.description,
                dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`
            };
        }));
    }
}
