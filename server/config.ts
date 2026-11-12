// Reads local API, model, and storage settings from the environment.

import path from "node:path";

export interface ServerConfig
{
    host: string;
    port: number;
    storageDirectory: string;
    model: string;
    embeddingModel: string;
    transcriptionModel: string;
    reasoningEffort: string;
    maxOutputTokens: number;
    openAiApiKey: string;
    openAiBaseUrl: string;
}

export function loadServerConfig(): ServerConfig
{
    return {
        host: "127.0.0.1",
        port: 4387,
        storageDirectory: path.resolve(process.env.TUTOR_STORAGE_DIRECTORY ?? "phase2-data"),
        model: process.env.TUTOR_MODEL ?? "gpt-6.1-terra",
        embeddingModel: process.env.TUTOR_EMBEDDING_MODEL ?? "text-embedding-3-small",
        transcriptionModel: process.env.TUTOR_TRANSCRIPTION_MODEL ?? "whisper-1",
        reasoningEffort: process.env.TUTOR_REASONING_EFFORT ?? "low",
        maxOutputTokens: Number(process.env.TUTOR_MAX_OUTPUT_TOKENS ?? 1200),
        openAiApiKey: process.env.OPENAI_API_KEY ?? "",
        openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
    };
}
