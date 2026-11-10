// Verifies deterministic question-scope guardrails for recent and full-lecture requests.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateQuestionScope } from "../src/shared/questionScope";

describe("question scope", () =>
{
    test("allows questions about the current result and recent lecture context", () =>
    {
        assert.deepEqual(
            evaluateQuestionScope("Can you further explain how my professor got this result?", 2_400),
            { isAllowed: true }
        );
        assert.deepEqual(
            evaluateQuestionScope("A few minutes ago, why did she transpose that matrix?", 2_400),
            { isAllowed: true }
        );
        assert.deepEqual(
            evaluateQuestionScope("What was happening 10 minutes ago?", 2_400),
            { isAllowed: true }
        );
    });

    test("rejects full-lecture analysis and recommends the download workflow", () =>
    {
        const decision = evaluateQuestionScope("Summarize the entire lecture for me.", 300);

        assert.equal(decision.isAllowed, false);

        if (!decision.isAllowed)
        {
            assert.equal(decision.reason, "fullLecture");
            assert.match(decision.message, /Download/);
            assert.match(decision.message, /chat model/);
        }
    });

    test("rejects vague earlier references only after the first ten minutes", () =>
    {
        assert.deepEqual(
            evaluateQuestionScope("Earlier in the lecture, why did he use that theorem?", 600),
            { isAllowed: true }
        );

        const decision = evaluateQuestionScope(
            "Earlier in the lecture, why did he use that theorem?",
            601
        );
        assert.equal(decision.isAllowed, false);

        if (!decision.isAllowed)
        {
            assert.equal(decision.reason, "ambiguousEarlierReference");
            assert.match(decision.message, /last 10 minutes/);
        }
    });

    test("rejects explicit references beyond the ten-minute evidence window", () =>
    {
        const decision = evaluateQuestionScope("What equation did he show 11 minutes ago?", 2_400);

        assert.equal(decision.isAllowed, false);

        if (!decision.isAllowed)
        {
            assert.equal(decision.reason, "distantTimeReference");
        }
    });

    test("does not confuse subject terminology with a full-lecture request", () =>
    {
        assert.deepEqual(
            evaluateQuestionScope("Why does this matrix need full rank?", 2_400),
            { isAllowed: true }
        );
    });
});
