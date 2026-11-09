// Verifies normalization of timestamped ASR WebVTT transcript cues.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseWebVtt } from "../server/vttParser";

describe("WebVTT parser", () =>
{
    test("parses hour and minute timestamps with cue identifiers", () =>
    {
        const segments = parseWebVtt([
            "WEBVTT",
            "",
            "42",
            "00:01:02.500 --> 00:01:05.750 align:start",
            "<v Professor>A &amp; B</v>",
            "",
            "00:06.000 --> 00:08.000",
            "Second cue"
        ].join("\n"));

        assert.deepEqual(segments, [
            {
                id: "transcript-42",
                startSeconds: 62.5,
                endSeconds: 65.75,
                text: "A & B"
            },
            {
                id: "transcript-00002",
                startSeconds: 6,
                endSeconds: 8,
                text: "Second cue"
            }
        ]);
    });
});
