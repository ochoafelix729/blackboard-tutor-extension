// Verifies transparent token-cost calculation for configured model pricing.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { estimateTokenCost, getModelPricing } from "../server/modelPricing";

describe("model pricing", () =>
{
    test("prices uncached, cached, cache-write, and output tokens separately", () =>
    {
        const pricing = getModelPricing("gpt-6.1-terra");
        assert.notEqual(pricing, null);

        if (pricing !== null)
        {
            const cost = estimateTokenCost({
                inputTokens: 1_000_000,
                cachedInputTokens: 100_000,
                cacheWriteTokens: 100_000,
                outputTokens: 1_000_000,
                reasoningTokens: 0
            }, pricing);

            assert.equal(cost, 5.93);
        }
    });

    test("returns no estimate for an unknown model without explicit rates", () =>
    {
        assert.equal(getModelPricing("unconfigured-model"), null);
    });

    test("uses catalog pricing for a dated model snapshot", () =>
    {
        assert.deepEqual(
            getModelPricing("gpt-6.1-terra-2026-10-15"),
            getModelPricing("gpt-6.1-terra")
        );
    });
});
