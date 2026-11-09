// Calculates estimated token costs from a small, explicitly versioned model price catalog.

export interface ModelPricing
{
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    cacheWriteUsdPerMillion: number;
    outputUsdPerMillion: number;
    effectiveDate: string;
    source: string;
}

export interface TokenUsage
{
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningTokens: number;
}

const pricingByModel: Readonly<Record<string, ModelPricing>> = {
    "gpt-6-astra": {
        inputUsdPerMillion: 10,
        cachedInputUsdPerMillion: 1,
        cacheWriteUsdPerMillion: 12.5,
        outputUsdPerMillion: 50,
        effectiveDate: "2026-11-08",
        source: "https://developers.openai.com/api/docs/pricing"
    },
    "gpt-6.1-sol": {
        inputUsdPerMillion: 2,
        cachedInputUsdPerMillion: 0.1,
        cacheWriteUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
        effectiveDate: "2026-11-08",
        source: "https://developers.openai.com/api/docs/pricing"
    },
    "gpt-6.1-terra": {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.05,
        cacheWriteUsdPerMillion: 1.25,
        outputUsdPerMillion: 5,
        effectiveDate: "2026-11-08",
        source: "https://developers.openai.com/api/docs/pricing"
    },
    "gpt-6-luna": {
        inputUsdPerMillion: 0.1,
        cachedInputUsdPerMillion: 0.01,
        cacheWriteUsdPerMillion: 0.125,
        outputUsdPerMillion: 0.5,
        effectiveDate: "2026-11-08",
        source: "https://developers.openai.com/api/docs/pricing"
    }
};

function readOptionalRate(name: string): number | null
{
    const value = process.env[name];

    if (value === undefined || value.trim().length === 0)
    {
        return null;
    }

    const numberValue = Number(value);

    if (!Number.isFinite(numberValue) || numberValue < 0)
    {
        throw new Error(`${name} must be a nonnegative number.`);
    }

    return numberValue;
}

function getCustomModelPricing(model: string): ModelPricing | null
{
    const rawValue = process.env.TUTOR_MODEL_PRICING_JSON;

    if (rawValue === undefined || rawValue.trim().length === 0)
    {
        return null;
    }

    let value: unknown;

    try
    {
        value = JSON.parse(rawValue);
    }
    catch
    {
        throw new Error("TUTOR_MODEL_PRICING_JSON must be valid JSON.");
    }

    if (typeof value !== "object" || value === null)
    {
        throw new Error("TUTOR_MODEL_PRICING_JSON must contain a model-price object.");
    }

    const candidate = (value as Record<string, unknown>)[model];

    if (typeof candidate !== "object" || candidate === null)
    {
        return null;
    }

    const pricing = candidate as Record<string, unknown>;
    const requiredRates = [
        pricing.inputUsdPerMillion,
        pricing.cachedInputUsdPerMillion,
        pricing.cacheWriteUsdPerMillion,
        pricing.outputUsdPerMillion
    ];

    if (!requiredRates.every((rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0))
    {
        throw new Error(`Custom pricing for ${model} must define four nonnegative token rates.`);
    }

    return {
        inputUsdPerMillion: pricing.inputUsdPerMillion as number,
        cachedInputUsdPerMillion: pricing.cachedInputUsdPerMillion as number,
        cacheWriteUsdPerMillion: pricing.cacheWriteUsdPerMillion as number,
        outputUsdPerMillion: pricing.outputUsdPerMillion as number,
        effectiveDate: typeof pricing.effectiveDate === "string" ? pricing.effectiveDate : "custom",
        source: "TUTOR_MODEL_PRICING_JSON"
    };
}

export function getModelPricing(model: string): ModelPricing | null
{
    const catalogPricing = pricingByModel[model] ?? Object.entries(pricingByModel).find(([modelName]) =>
    {
        return model.startsWith(modelName)
            && /^-\d{4}-\d{2}-\d{2}$/.test(model.slice(modelName.length));
    })?.[1];

    if (catalogPricing !== undefined)
    {
        return catalogPricing;
    }

    const customPricing = getCustomModelPricing(model);

    if (customPricing !== null)
    {
        return customPricing;
    }

    const inputRate = readOptionalRate("TUTOR_INPUT_USD_PER_MILLION");
    const outputRate = readOptionalRate("TUTOR_OUTPUT_USD_PER_MILLION");

    if (inputRate === null || outputRate === null)
    {
        return null;
    }

    return {
        inputUsdPerMillion: inputRate,
        cachedInputUsdPerMillion: readOptionalRate("TUTOR_CACHED_INPUT_USD_PER_MILLION") ?? inputRate,
        cacheWriteUsdPerMillion: readOptionalRate("TUTOR_CACHE_WRITE_USD_PER_MILLION") ?? inputRate,
        outputUsdPerMillion: outputRate,
        effectiveDate: process.env.TUTOR_PRICING_EFFECTIVE_DATE ?? "custom",
        source: "environment"
    };
}

export function estimateTokenCost(usage: TokenUsage, pricing: ModelPricing): number
{
    const uncachedInputTokens = Math.max(
        0,
        usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens
    );
    const total = uncachedInputTokens * pricing.inputUsdPerMillion
        + usage.cachedInputTokens * pricing.cachedInputUsdPerMillion
        + usage.cacheWriteTokens * pricing.cacheWriteUsdPerMillion
        + usage.outputTokens * pricing.outputUsdPerMillion;

    return total / 1_000_000;
}
