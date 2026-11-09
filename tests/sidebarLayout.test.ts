// Verifies sidebar width bounds and preservation of lecture-player space.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    clampSidebarWidth,
    getDefaultSidebarWidth,
    getSidebarWidthLimits
} from "../src/content/sidebarLayout";

describe("sidebar layout", () =>
{
    test("uses the preferred default width on a desktop viewport", () =>
    {
        assert.equal(getDefaultSidebarWidth(1_440), 380);
    });

    test("enforces absolute and viewport-relative maximum widths", () =>
    {
        assert.deepEqual(getSidebarWidthLimits(1_440), {
            minimum: 320,
            maximum: 640
        });
        assert.deepEqual(getSidebarWidthLimits(1_000), {
            minimum: 320,
            maximum: 550
        });
    });

    test("clamps resizing at both limits", () =>
    {
        assert.equal(clampSidebarWidth(100, 1_000), 320);
        assert.equal(clampSidebarWidth(900, 1_000), 550);
    });

    test("scales below the preferred minimum on a narrow viewport", () =>
    {
        assert.deepEqual(getSidebarWidthLimits(500), {
            minimum: 275,
            maximum: 275
        });
    });
});
