// Calls the local Phase 2 tutor API and validates statuses and answers before they enter extension state.

import { isLectureProcessingStatus, type LectureProcessingStatus } from "../shared/ingestion";
import { isTutorAnswer, type TutorAnswer, type TutorQuestion } from "../shared/tutor";
import type { ExtensionError } from "../shared/protocol";

type tutorApiResult =
    | {
        ok: true;
        answer: TutorAnswer;
    }
    | {
        ok: false;
        error: ExtensionError;
    };

type tutorStatusResult =
    | {
        ok: true;
        status: LectureProcessingStatus;
    }
    | {
        ok: false;
        error: ExtensionError;
    };

type registrationResult =
    | {
        ok: true;
    }
    | {
        ok: false;
        error: ExtensionError;
    };

const tutorApiBaseUrl = "http://127.0.0.1:4387";

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function getApiError(value: unknown): ExtensionError | null
{
    if (!isRecord(value)
        || !isRecord(value.error)
        || typeof value.error.code !== "string"
        || typeof value.error.message !== "string")
    {
        return null;
    }

    const supportedCodes: ExtensionError["code"][] = [
        "invalidRequest",
        "questionOutOfScope",
        "evidenceUnavailable",
        "lectureProcessing",
        "modelFailed",
        "unexpectedError"
    ];

    if (!supportedCodes.includes(value.error.code as ExtensionError["code"]))
    {
        return null;
    }

    return {
        code: value.error.code as ExtensionError["code"],
        message: value.error.message
    };
}

export class TutorApiClient
{
    async registerLecture(
        lectureId: string,
        title: string,
        mediaUrl: string
    ): Promise<registrationResult>
    {
        let response: Response;

        try
        {
            response = await fetch(`${tutorApiBaseUrl}/v1/lectures/auto-register`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Blackboard-Tutor": "1"
                },
                body: JSON.stringify({ lectureId, title, mediaUrl }),
                signal: AbortSignal.timeout(10_000)
            });
        }
        catch
        {
            return {
                ok: false,
                error: {
                    code: "tutorUnavailable",
                    message: "The local Phase 2 tutor API is not running."
                }
            };
        }

        if (response.ok)
        {
            return { ok: true };
        }

        let responseBody: unknown;

        try
        {
            responseBody = await response.json();
        }
        catch
        {
            responseBody = null;
        }

        return {
            ok: false,
            error: getApiError(responseBody) ?? {
                code: "unexpectedError",
                message: "The local tutor API could not begin automatic lecture processing."
            }
        };
    }

    async getStatus(lectureId: string): Promise<tutorStatusResult>
    {
        let response: Response;

        try
        {
            const query = new URLSearchParams({ lectureId });
            response = await fetch(`${tutorApiBaseUrl}/v1/lectures/status?${query.toString()}`, {
                signal: AbortSignal.timeout(5_000)
            });
        }
        catch
        {
            return {
                ok: false,
                error: {
                    code: "tutorUnavailable",
                    message: "The local Phase 2 tutor API is not running."
                }
            };
        }

        let responseBody: unknown;

        try
        {
            responseBody = await response.json();
        }
        catch
        {
            responseBody = null;
        }

        if (!response.ok)
        {
            return {
                ok: false,
                error: getApiError(responseBody) ?? {
                    code: "unexpectedError",
                    message: "The local tutor API returned an unreadable status error."
                }
            };
        }

        if (!isLectureProcessingStatus(responseBody))
        {
            return {
                ok: false,
                error: {
                    code: "unexpectedError",
                    message: "The local tutor API returned an invalid lecture status."
                }
            };
        }

        return {
            ok: true,
            status: responseBody
        };
    }

    async ask(question: TutorQuestion): Promise<tutorApiResult>
    {
        let response: Response;

        try
        {
            response = await fetch(`${tutorApiBaseUrl}/v1/questions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Blackboard-Tutor": "1"
                },
                body: JSON.stringify(question),
                signal: AbortSignal.timeout(100_000)
            });
        }
        catch
        {
            return {
                ok: false,
                error: {
                    code: "tutorUnavailable",
                    message: "The local tutor API is not running. Start it with npm run phase2:server."
                }
            };
        }

        let responseBody: unknown;

        try
        {
            responseBody = await response.json();
        }
        catch
        {
            responseBody = null;
        }

        if (!response.ok)
        {
            return {
                ok: false,
                error: getApiError(responseBody) ?? {
                    code: "unexpectedError",
                    message: "The local tutor API returned an unreadable error."
                }
            };
        }

        if (!isTutorAnswer(responseBody))
        {
            return {
                ok: false,
                error: {
                    code: "unexpectedError",
                    message: "The local tutor API returned an invalid answer."
                }
            };
        }

        return {
            ok: true,
            answer: responseBody
        };
    }
}
