// Defines validated contracts for grounded tutor questions, answers, and cost summaries.

export type tutorStrategy = "transcriptOnly" | "multimodal";

export interface TutorQuestion
{
    lectureId: string;
    timestampSeconds: number;
    question: string;
    strategy: tutorStrategy;
    currentFrameDataUrl: string | null;
}

export interface TutorCitation
{
    startSeconds: number;
    endSeconds: number;
    evidenceIds: string[];
}

export interface TutorCostSummary
{
    traceId: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
}

export interface TutorAnswer
{
    answer: string;
    citations: TutorCitation[];
    usedModalities: string[];
    limitations: string[];
    strategy: tutorStrategy;
    cost: TutorCostSummary;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function isTutorStrategy(value: unknown): value is tutorStrategy
{
    return value === "transcriptOnly" || value === "multimodal";
}

function isFiniteNonnegativeNumber(value: unknown): value is number
{
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[]
{
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isTutorQuestion(value: unknown): value is TutorQuestion
{
    if (!isRecord(value))
    {
        return false;
    }

    return typeof value.lectureId === "string"
        && value.lectureId.length > 0
        && isFiniteNonnegativeNumber(value.timestampSeconds)
        && typeof value.question === "string"
        && value.question.trim().length > 0
        && isTutorStrategy(value.strategy)
        && (value.currentFrameDataUrl === null || typeof value.currentFrameDataUrl === "string");
}

function isTutorCitation(value: unknown): value is TutorCitation
{
    if (!isRecord(value))
    {
        return false;
    }

    return isFiniteNonnegativeNumber(value.startSeconds)
        && isFiniteNonnegativeNumber(value.endSeconds)
        && value.endSeconds >= value.startSeconds
        && isStringArray(value.evidenceIds);
}

function isTutorCostSummary(value: unknown): value is TutorCostSummary
{
    if (!isRecord(value))
    {
        return false;
    }

    return typeof value.traceId === "string"
        && typeof value.provider === "string"
        && typeof value.model === "string"
        && isFiniteNonnegativeNumber(value.inputTokens)
        && isFiniteNonnegativeNumber(value.outputTokens)
        && (value.estimatedCostUsd === null || isFiniteNonnegativeNumber(value.estimatedCostUsd));
}

export function isTutorAnswer(value: unknown): value is TutorAnswer
{
    if (!isRecord(value))
    {
        return false;
    }

    return typeof value.answer === "string"
        && value.answer.length > 0
        && Array.isArray(value.citations)
        && value.citations.every(isTutorCitation)
        && isStringArray(value.usedModalities)
        && isStringArray(value.limitations)
        && isTutorStrategy(value.strategy)
        && isTutorCostSummary(value.cost);
}
