// Defines validated contracts for grounded transcript-and-visual tutor questions and answers.

export interface TutorQuestion
{
    lectureId: string;
    timestampSeconds: number;
    question: string;
    currentFrameDataUrl: string | null;
}

export interface TutorCitation
{
    startSeconds: number;
    endSeconds: number;
    evidenceIds: string[];
}

export interface TutorAnswer
{
    answer: string;
    citations: TutorCitation[];
    limitations: string[];
}

export type tutorStreamEvent =
    | { kind: "text"; text: string }
    | { kind: "complete"; answer: TutorAnswer }
    | { kind: "error"; error: import("./protocol").ExtensionError };

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function isFiniteNonnegativeNumber(value: unknown): value is number
{
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[]
{
    return Array.isArray(value) && value.every((item) => typeof item === "string");
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
        && isStringArray(value.limitations);
}
