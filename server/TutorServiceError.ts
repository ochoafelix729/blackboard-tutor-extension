// Represents safe, categorized failures returned by the local tutor API.

export type tutorServiceErrorCode =
    | "invalidRequest"
    | "evidenceUnavailable"
    | "modelFailed"
    | "unexpectedError";

export class TutorServiceError extends Error
{
    readonly code: tutorServiceErrorCode;

    constructor(code: tutorServiceErrorCode, message: string)
    {
        super(message);
        this.name = "TutorServiceError";
        this.code = code;
    }
}
