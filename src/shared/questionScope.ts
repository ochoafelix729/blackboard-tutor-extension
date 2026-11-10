// Defines deterministic scope guardrails for playback-aware tutor questions.

export const lectureContextLookbackSeconds = 10 * 60;
export const lectureFutureToleranceSeconds = 15;

export type questionScopeRejectionReason =
    | "fullLecture"
    | "ambiguousEarlierReference"
    | "distantTimeReference";

export type questionScopeDecision =
    | {
        isAllowed: true;
    }
    | {
        isAllowed: false;
        reason: questionScopeRejectionReason;
        message: string;
    };

const fullLecturePatterns = [
    /\b(?:entire|whole|full)\s+(?:lecture|video|recording)\b/i,
    /\b(?:summarize|recap|outline)\s+(?:(?:this|the)\s+)?(?:lecture|video|recording)\b/i,
    /\b(?:summary|recap|overview)\s+of\s+(?:(?:this|the)\s+)?(?:lecture|video|recording)\b/i,
    /\b(?:across|throughout)\s+(?:this|the)\s+(?:lecture|video|recording)\b/i,
    /\b(?:main|key)\s+(?:topics?|points?|concepts?)\b.{0,40}\b(?:lecture|video|recording)\b/i,
    /\bwhat\s+(?:did|does)\s+(?:the\s+)?professor\s+cover\s+in\s+(?:this|the)\s+lecture\b/i
];
const ambiguousEarlierPatterns = [
    /\bearlier\s+in\s+(?:this|the)\s+(?:lecture|video|recording)\b/i,
    /\b(?:at|from)\s+(?:the\s+)?(?:beginning|start)\s+of\s+(?:this|the)\s+(?:lecture|video|recording)\b/i,
    /\bback\s+(?:at|in)\s+(?:the\s+)?(?:beginning|start)\b/i
];

function asksAboutFullLecture(question: string): boolean
{
    return fullLecturePatterns.some((pattern) => pattern.test(question));
}

function hasAmbiguousEarlierReference(question: string): boolean
{
    return ambiguousEarlierPatterns.some((pattern) => pattern.test(question));
}

function getExplicitLookbackSeconds(question: string): number | null
{
    const numericMatch = question.match(
        /\b(\d+(?:\.\d+)?)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+ago\b/i
    );

    if (numericMatch !== null)
    {
        const amount = Number(numericMatch[1]);
        const unit = numericMatch[2]?.toLowerCase() ?? "seconds";

        if (unit.startsWith("hour") || unit.startsWith("hr"))
        {
            return amount * 3_600;
        }

        if (unit.startsWith("minute") || unit.startsWith("min"))
        {
            return amount * 60;
        }

        return amount;
    }

    if (/\b(?:half an hour|an hour|one hour)\s+ago\b/i.test(question))
    {
        return /\bhalf an hour\s+ago\b/i.test(question) ? 1_800 : 3_600;
    }

    return null;
}

export function evaluateQuestionScope(
    question: string,
    timestampSeconds: number
): questionScopeDecision
{
    const normalizedQuestion = question.replace(/\s+/g, " ").trim();

    if (asksAboutFullLecture(normalizedQuestion))
    {
        return {
            isAllowed: false,
            reason: "fullLecture",
            message: "This tutor is designed for the current moment and the preceding 10 minutes, not full-lecture analysis. Use Download to save the recording, then share it with a chat model for questions about the entire lecture."
        };
    }

    const explicitLookbackSeconds = getExplicitLookbackSeconds(normalizedQuestion);

    if (explicitLookbackSeconds !== null && explicitLookbackSeconds > lectureContextLookbackSeconds)
    {
        return {
            isAllowed: false,
            reason: "distantTimeReference",
            message: "I can only inspect the current moment and the preceding 10 minutes. Seek closer to that part of the lecture, then ask again."
        };
    }

    if (timestampSeconds > lectureContextLookbackSeconds
        && hasAmbiguousEarlierReference(normalizedQuestion))
    {
        return {
            isAllowed: false,
            reason: "ambiguousEarlierReference",
            message: "“Earlier in the lecture” is outside the tutor’s reliable scope here. Ask about the last 10 minutes, or seek back to the earlier moment and ask again."
        };
    }

    return { isAllowed: true };
}
