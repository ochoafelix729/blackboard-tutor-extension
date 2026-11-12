// Calls OpenAI for transcript-and-visual answers, embeddings, and audio transcription.

import { createParser } from "eventsource-parser";
import { isTutorAnswer, type TutorAnswer } from "../src/shared/tutor";
import { getStreamedAnswerText } from "./streamedAnswerText";

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

    async generate(request: ModelRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<TutorAnswer>
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
                stream: true,
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
            signal: signal === undefined ? AbortSignal.timeout(90_000) : AbortSignal.any([signal, AbortSignal.timeout(90_000)])
        });

        if (!response.ok)
        {
            const responseValue: unknown = await response.json();
            const errorMessage = isRecord(responseValue)
                && isRecord(responseValue.error)
                && typeof responseValue.error.message === "string"
                ? responseValue.error.message
                : `OpenAI returned HTTP ${response.status}.`;
            throw new Error(errorMessage);
        }

        if (response.body === null)
        {
            throw new Error("OpenAI returned no tutor response stream.");
        }

        let outputText = "";
        let previousText = "";
        let completed = false;
        let streamFailed = false;
        const parser = createParser({
            onEvent: (event) =>
            {
                if (event.data === "[DONE]")
                {
                    return;
                }

                const value: unknown = JSON.parse(event.data);

                if (!isRecord(value))
                {
                    throw new Error("OpenAI returned an invalid stream event.");
                }

                if (value.type === "response.output_text.delta" && typeof value.delta === "string")
                {
                    outputText += value.delta;
                    const text = getStreamedAnswerText(outputText);

                    if (text !== null && text !== previousText)
                    {
                        previousText = text;
                        onText(text);
                    }
                }
                else if (value.type === "response.completed")
                {
                    completed = true;
                }
                else if (value.type === "response.failed" || value.type === "response.incomplete" || value.type === "error")
                {
                    streamFailed = true;
                }
            }
        });
        const decoder = new TextDecoder();

        const reader = response.body.getReader();

        while (true)
        {
            const chunk = await reader.read();
            parser.feed(decoder.decode(chunk.value, { stream: !chunk.done }));

            if (chunk.done)
            {
                break;
            }
        }

        if (!completed || streamFailed)
        {
            throw new Error("OpenAI did not complete the tutor response.");
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
