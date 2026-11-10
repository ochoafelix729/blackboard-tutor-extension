// Writes privacy-conscious JSONL model traces and summarizes API usage costs.

import { randomUUID } from "node:crypto";
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import type { TutorCostSummary } from "../src/shared/tutor";
import {
    estimateTokenCost,
    getModelPricing,
    type ModelPricing,
    type TokenUsage
} from "./modelPricing";

type traceStatus = "succeeded" | "failed";

interface CostTrace
{
    traceId: string;
    occurredAt: string;
    lectureId: string;
    strategy: string;
    provider: string;
    model: string;
    status: traceStatus;
    latencyMilliseconds: number;
    providerRequestId: string | null;
    usage: TokenUsage | null;
    estimatedCostUsd: number | null;
    pricing: ModelPricing | null;
    errorCategory: string | null;
}

export interface CostLedgerSummary
{
    requestCount: number;
    failedRequestCount: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    unpricedRequestCount: number;
}

function roundCurrency(value: number): number
{
    return Math.round(value * 100_000_000) / 100_000_000;
}

function isCostTrace(value: unknown): value is CostTrace
{
    if (typeof value !== "object" || value === null)
    {
        return false;
    }

    const candidate = value as Partial<CostTrace>;
    return typeof candidate.traceId === "string"
        && typeof candidate.lectureId === "string"
        && typeof candidate.status === "string";
}

export class CostLedger
{
    private readonly ledgerPath: string;

    constructor(ledgerPath: string)
    {
        this.ledgerPath = ledgerPath;
    }

    createTraceId(): string
    {
        return randomUUID();
    }

    async recordSuccess(input: {
        traceId: string;
        lectureId: string;
        strategy: string;
        provider: string;
        model: string;
        latencyMilliseconds: number;
        providerRequestId: string | null;
        usage: TokenUsage;
    }): Promise<TutorCostSummary>
    {
        const pricing = getModelPricing(input.model);
        const estimatedCostUsd = pricing === null
            ? null
            : roundCurrency(estimateTokenCost(input.usage, pricing));
        await this.append({
            traceId: input.traceId,
            occurredAt: new Date().toISOString(),
            lectureId: input.lectureId,
            strategy: input.strategy,
            provider: input.provider,
            model: input.model,
            status: "succeeded",
            latencyMilliseconds: input.latencyMilliseconds,
            providerRequestId: input.providerRequestId,
            usage: input.usage,
            estimatedCostUsd,
            pricing,
            errorCategory: null
        });

        return {
            traceId: input.traceId,
            provider: input.provider,
            model: input.model,
            inputTokens: input.usage.inputTokens,
            outputTokens: input.usage.outputTokens,
            estimatedCostUsd
        };
    }

    async recordFailure(input: {
        traceId: string;
        lectureId: string;
        strategy: string;
        provider: string;
        model: string;
        latencyMilliseconds: number;
        errorCategory: string;
    }): Promise<void>
    {
        await this.append({
            traceId: input.traceId,
            occurredAt: new Date().toISOString(),
            lectureId: input.lectureId,
            strategy: input.strategy,
            provider: input.provider,
            model: input.model,
            status: "failed",
            latencyMilliseconds: input.latencyMilliseconds,
            providerRequestId: null,
            usage: null,
            estimatedCostUsd: null,
            pricing: getModelPricing(input.model),
            errorCategory: input.errorCategory
        });
    }

    async summarize(lectureId: string | null = null): Promise<CostLedgerSummary>
    {
        let source: string;

        try
        {
            source = await fileSystem.readFile(this.ledgerPath, "utf8");
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
            {
                return {
                    requestCount: 0,
                    failedRequestCount: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    estimatedCostUsd: 0,
                    unpricedRequestCount: 0
                };
            }

            throw error;
        }

        const traces = source
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) =>
            {
                try
                {
                    return JSON.parse(line) as unknown;
                }
                catch
                {
                    return null;
                }
            })
            .filter(isCostTrace)
            .filter((trace) => lectureId === null || trace.lectureId === lectureId);

        return traces.reduce<CostLedgerSummary>((summary, trace) =>
        {
            summary.requestCount += 1;
            summary.failedRequestCount += trace.status === "failed" ? 1 : 0;
            summary.inputTokens += trace.usage?.inputTokens ?? 0;
            summary.outputTokens += trace.usage?.outputTokens ?? 0;
            summary.estimatedCostUsd += trace.estimatedCostUsd ?? 0;
            summary.unpricedRequestCount += trace.status === "succeeded" && trace.estimatedCostUsd === null ? 1 : 0;
            return summary;
        }, {
            requestCount: 0,
            failedRequestCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            unpricedRequestCount: 0
        });
    }

    private async append(trace: CostTrace): Promise<void>
    {
        await fileSystem.mkdir(path.dirname(this.ledgerPath), { recursive: true });
        await fileSystem.appendFile(this.ledgerPath, `${JSON.stringify(trace)}\n`, {
            encoding: "utf8",
            mode: 0o600
        });
    }
}
