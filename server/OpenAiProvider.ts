// Implements the model-provider boundary with OpenAI's multimodal Responses API.

import type {
    ModelAnswer,
    ModelProvider,
    ModelRequest,
    ModelResult
} from "./ModelProvider";
import type { TokenUsage } from "./modelPricing";

interface OpenAiProviderOptions
{
    apiKey: string;
    baseUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function getResponseText(response: Record<string, unknown>): string | null
{
    if (typeof response.output_text === "string")
    {
        return response.output_text;
    }

    if (!Array.isArray(response.output))
    {
        return null;
    }

    for (const outputItem of response.output)
    {
        if (!isRecord(outputItem) || !Array.isArray(outputItem.content))
        {
            continue;
        }

        for (const contentItem of outputItem.content)
        {
            if (isRecord(contentItem)
                && contentItem.type === "output_text"
                && typeof contentItem.text === "string")
            {
                return contentItem.text;
            }
        }
    }

    return null;
}

function readNonnegativeNumber(value: unknown): number
{
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readUsage(value: unknown): TokenUsage
{
    const usage = isRecord(value) ? value : {};
    const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
    const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};

    return {
        inputTokens: readNonnegativeNumber(usage.input_tokens),
        cachedInputTokens: readNonnegativeNumber(inputDetails.cached_tokens),
        cacheWriteTokens: readNonnegativeNumber(inputDetails.cache_write_tokens),
        outputTokens: readNonnegativeNumber(usage.output_tokens),
        reasoningTokens: readNonnegativeNumber(outputDetails.reasoning_tokens)
    };
}

function normalizeModelAnswer(value: unknown): ModelAnswer
{
    if (!isRecord(value)
        || typeof value.answer !== "string"
        || !Array.isArray(value.citations)
        || !Array.isArray(value.usedModalities)
        || !Array.isArray(value.limitations))
    {
        throw new Error("The model returned an invalid structured answer.");
    }

    const citations = value.citations.map((citation) =>
    {
        if (!isRecord(citation)
            || typeof citation.startSeconds !== "number"
            || typeof citation.endSeconds !== "number"
            || !Array.isArray(citation.evidenceIds)
            || !citation.evidenceIds.every((id) => typeof id === "string"))
        {
            throw new Error("The model returned an invalid citation.");
        }

        return {
            startSeconds: citation.startSeconds,
            endSeconds: citation.endSeconds,
            evidenceIds: citation.evidenceIds
        };
    });

    if (!value.usedModalities.every((item) => typeof item === "string")
        || !value.limitations.every((item) => typeof item === "string"))
    {
        throw new Error("The model returned invalid answer metadata.");
    }

    return {
        answer: value.answer,
        citations,
        usedModalities: value.usedModalities as string[],
        limitations: value.limitations as string[]
    };
}

const answerSchema = {
    type: "object",
    additionalProperties: false,
    required: ["answer", "citations", "usedModalities", "limitations"],
    properties: {
        answer: { type: "string" },
        citations: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["startSeconds", "endSeconds", "evidenceIds"],
                properties: {
                    startSeconds: { type: "number", minimum: 0 },
                    endSeconds: { type: "number", minimum: 0 },
                    evidenceIds: {
                        type: "array",
                        items: { type: "string" }
                    }
                }
            }
        },
        usedModalities: {
            type: "array",
            items: { type: "string" }
        },
        limitations: {
            type: "array",
            items: { type: "string" }
        }
    }
};

export class OpenAiProvider implements ModelProvider
{
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(options: OpenAiProviderOptions)
    {
        this.apiKey = options.apiKey;
        this.baseUrl = options.baseUrl;
    }

    async generate(request: ModelRequest): Promise<ModelResult>
    {
        if (this.apiKey.length === 0)
        {
            throw new Error("OPENAI_API_KEY is required to answer tutor questions.");
        }

        const userContent: Record<string, unknown>[] = [
            {
                type: "input_text",
                text: request.userPrompt
            }
        ];

        for (const image of request.images)
        {
            userContent.push({
                type: "input_text",
                text: `Visual evidence ${image.evidenceId} at ${image.timestampSeconds.toFixed(1)} seconds:`
            });
            userContent.push({
                type: "input_image",
                image_url: image.dataUrl,
                detail: "high"
            });
        }

        const response = await fetch(`${this.baseUrl}/responses`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: request.model,
                store: false,
                instructions: request.systemPrompt,
                input: [
                    {
                        role: "user",
                        content: userContent
                    }
                ],
                reasoning: {
                    effort: request.reasoningEffort
                },
                max_output_tokens: request.maxOutputTokens,
                text: {
                    verbosity: "low",
                    format: {
                        type: "json_schema",
                        name: "lecture_tutor_answer",
                        strict: true,
                        schema: answerSchema
                    }
                }
            }),
            signal: AbortSignal.timeout(90_000)
        });
        const responseValue: unknown = await response.json();

        if (!response.ok)
        {
            const errorMessage = isRecord(responseValue)
                && isRecord(responseValue.error)
                && typeof responseValue.error.message === "string"
                ? responseValue.error.message
                : `OpenAI returned HTTP ${response.status}.`;
            throw new Error(errorMessage);
        }

        if (!isRecord(responseValue))
        {
            throw new Error("OpenAI returned an invalid response body.");
        }

        const outputText = getResponseText(responseValue);

        if (outputText === null)
        {
            throw new Error("OpenAI returned no structured tutor answer.");
        }

        let parsedAnswer: unknown;

        try
        {
            parsedAnswer = JSON.parse(outputText);
        }
        catch
        {
            throw new Error("OpenAI returned malformed structured output.");
        }

        return {
            provider: "openai",
            model: typeof responseValue.model === "string" ? responseValue.model : request.model,
            providerRequestId: typeof responseValue.id === "string" ? responseValue.id : null,
            answer: normalizeModelAnswer(parsedAnswer),
            usage: readUsage(responseValue.usage)
        };
    }
}
