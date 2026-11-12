// Calls OpenAI for transcript-and-visual answers, embeddings, and audio transcription.

import { isTutorAnswer, type TutorAnswer } from "../src/shared/tutor";

export interface ModelImage
{
    dataUrl: string;
    evidenceId: string;
    timestampSeconds: number;
}

interface ModelRequest
{
    model: string;
    systemPrompt: string;
    userPrompt: string;
    images: ModelImage[];
    reasoningEffort: string;
    maxOutputTokens: number;
}

interface EmbeddingRequest
{
    model: string;
    inputs: string[];
}

interface EmbeddingResult
{
    model: string;
    vectors: number[][];
}

interface TranscriptionSegment
{
    startSeconds: number;
    endSeconds: number;
    text: string;
}

interface TranscriptionRequest
{
    model: string;
    audio: Buffer;
    filename: string;
    mimeType: string;
}

interface TranscriptionResult
{
    segments: TranscriptionSegment[];
}

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

const answerSchema = {
    type: "object",
    additionalProperties: false,
    required: ["answer", "citations", "limitations"],
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
        limitations: {
            type: "array",
            items: { type: "string" }
        }
    }
};

export class OpenAiProvider
{
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(options: OpenAiProviderOptions)
    {
        this.apiKey = options.apiKey;
        this.baseUrl = options.baseUrl;
    }

    async generate(request: ModelRequest): Promise<TutorAnswer>
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

        if (!isTutorAnswer(parsedAnswer))
        {
            throw new Error("OpenAI returned an invalid structured tutor answer.");
        }

        return parsedAnswer;
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult>
    {
        if (this.apiKey.length === 0)
        {
            throw new Error("OPENAI_API_KEY is required to create lecture embeddings.");
        }

        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: request.model,
                input: request.inputs,
                encoding_format: "float"
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
                : `OpenAI returned HTTP ${response.status} while creating embeddings.`;
            throw new Error(errorMessage);
        }

        if (!isRecord(responseValue) || !Array.isArray(responseValue.data))
        {
            throw new Error("OpenAI returned an invalid embedding response.");
        }

        const indexedVectors = responseValue.data.map((item) =>
        {
            if (!isRecord(item)
                || typeof item.index !== "number"
                || !Array.isArray(item.embedding)
                || !item.embedding.every((value) => typeof value === "number" && Number.isFinite(value)))
            {
                throw new Error("OpenAI returned an invalid embedding vector.");
            }

            return {
                index: item.index,
                vector: item.embedding as number[]
            };
        }).sort((first, second) => first.index - second.index);

        if (indexedVectors.length !== request.inputs.length)
        {
            throw new Error("OpenAI returned an unexpected number of embedding vectors.");
        }

        return {
            model: typeof responseValue.model === "string" ? responseValue.model : request.model,
            vectors: indexedVectors.map((item) => item.vector)
        };
    }

    async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>
    {
        if (this.apiKey.length === 0)
        {
            throw new Error("OPENAI_API_KEY is required to transcribe lecture audio.");
        }

        const formData = new FormData();
        const audioBuffer = new ArrayBuffer(request.audio.byteLength);
        new Uint8Array(audioBuffer).set(request.audio);
        formData.set("model", request.model);
        formData.set("response_format", "verbose_json");
        formData.set("timestamp_granularities[]", "segment");
        formData.set("file", new Blob([audioBuffer], { type: request.mimeType }), request.filename);
        const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`
            },
            body: formData,
            signal: AbortSignal.timeout(120_000)
        });
        const responseValue: unknown = await response.json();

        if (!response.ok)
        {
            const errorMessage = isRecord(responseValue)
                && isRecord(responseValue.error)
                && typeof responseValue.error.message === "string"
                ? responseValue.error.message
                : `OpenAI returned HTTP ${response.status} while transcribing audio.`;
            throw new Error(errorMessage);
        }

        if (!isRecord(responseValue) || !Array.isArray(responseValue.segments))
        {
            throw new Error("OpenAI returned an invalid timestamped transcription response.");
        }

        const segments = responseValue.segments.map((segment) =>
        {
            if (!isRecord(segment)
                || typeof segment.start !== "number"
                || !Number.isFinite(segment.start)
                || typeof segment.end !== "number"
                || !Number.isFinite(segment.end)
                || segment.end < segment.start
                || typeof segment.text !== "string"
                || segment.text.trim().length === 0)
            {
                throw new Error("OpenAI returned an invalid transcription segment.");
            }

            return {
                startSeconds: segment.start,
                endSeconds: segment.end,
                text: segment.text.trim()
            };
        });

        return { segments };
    }
}
