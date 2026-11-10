// Defines the replaceable model-provider boundary used by the tutor service.

import type { TokenUsage } from "./modelPricing";

export interface ModelImage
{
    dataUrl: string;
    evidenceId: string;
    timestampSeconds: number;
}

export interface ModelRequest
{
    model: string;
    systemPrompt: string;
    userPrompt: string;
    images: ModelImage[];
    reasoningEffort: string;
    maxOutputTokens: number;
}

export interface ModelCitation
{
    startSeconds: number;
    endSeconds: number;
    evidenceIds: string[];
}

export interface ModelAnswer
{
    answer: string;
    citations: ModelCitation[];
    usedModalities: string[];
    limitations: string[];
}

export interface ModelResult
{
    provider: string;
    model: string;
    providerRequestId: string | null;
    answer: ModelAnswer;
    usage: TokenUsage;
}

export interface ModelProvider
{
    generate(request: ModelRequest): Promise<ModelResult>;
}
