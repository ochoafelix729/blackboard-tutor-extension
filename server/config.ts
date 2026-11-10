// Reads and validates Phase 1 API, provider, model, and storage configuration.

import path from "node:path";

export type reasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ServerConfig
{
    host: string;
    port: number;
    evidenceDirectory: string;
    costLedgerPath: string;
    provider: string;
    textModel: string;
    visionModel: string;
    reasoningEffort: reasoningEffort;
    maxOutputTokens: number;
    openAiApiKey: string;
    openAiBaseUrl: string;
}

function readPositiveInteger(name: string, fallback: number): number
{
    const rawValue = process.env[name];

    if (rawValue === undefined)
    {
        return fallback;
    }

    const value = Number(rawValue);

    if (!Number.isInteger(value) || value <= 0)
    {
        throw new Error(`${name} must be a positive integer.`);
    }

    return value;
}

function readReasoningEffort(): reasoningEffort
{
    const value = process.env.TUTOR_REASONING_EFFORT ?? "low";
    const supported: reasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

    if (!supported.includes(value as reasoningEffort))
    {
        throw new Error("TUTOR_REASONING_EFFORT is not supported.");
    }

    return value as reasoningEffort;
}

export function loadServerConfig(rootDirectory: string = process.cwd()): ServerConfig
{
    return {
        host: "127.0.0.1",
        port: 4387,
        evidenceDirectory: path.resolve(
            rootDirectory,
            process.env.TUTOR_EVIDENCE_DIRECTORY ?? "phase1-data"
        ),
        costLedgerPath: path.resolve(
            rootDirectory,
            process.env.TUTOR_COST_LEDGER_PATH ?? "logs/tutor-costs.jsonl"
        ),
        provider: process.env.TUTOR_PROVIDER ?? "openai",
        textModel: process.env.TUTOR_TEXT_MODEL ?? "gpt-6.1-terra",
        visionModel: process.env.TUTOR_VISION_MODEL ?? "gpt-6.1-terra",
        reasoningEffort: readReasoningEffort(),
        maxOutputTokens: readPositiveInteger("TUTOR_MAX_OUTPUT_TOKENS", 1_200),
        openAiApiKey: process.env.OPENAI_API_KEY ?? "",
        openAiBaseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
    };
}
