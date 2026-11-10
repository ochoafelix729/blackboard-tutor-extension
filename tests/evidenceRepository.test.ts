// Verifies private evidence loading, watched-context retrieval, and nearby frame selection.

import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { EvidenceRepository } from "../server/EvidenceRepository";

describe("evidence repository", () =>
{
    test("retrieves relevant watched transcript and visual evidence", async () =>
    {
        const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), "lecture-evidence-"));
        await fileSystem.mkdir(path.join(directory, "lecture", "frames"), { recursive: true });
        await fileSystem.writeFile(path.join(directory, "lecture", "transcript.vtt"), [
            "WEBVTT",
            "",
            "00:10.000 --> 00:15.000",
            "A matrix needs independent eigenvectors to be diagonalizable.",
            "",
            "01:30.000 --> 01:35.000",
            "This later material should not be retrieved yet."
        ].join("\n"));
        await fileSystem.writeFile(
            path.join(directory, "lecture", "frames", "slide.png"),
            Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64")
        );
        await fileSystem.writeFile(path.join(directory, "lecture.json"), JSON.stringify({
            version: 1,
            lectureId: "classcom:recording:test",
            title: "Linear algebra",
            transcriptPath: "lecture/transcript.vtt",
            frames: [
                {
                    id: "slide-1",
                    timestampSeconds: 12,
                    path: "lecture/frames/slide.png",
                    description: "A matrix and its eigenvectors"
                }
            ]
        }));

        try
        {
            const repository = new EvidenceRepository(directory);
            const evidence = await repository.retrieve(
                "classcom:recording:test",
                20,
                "Why does this matrix need eigenvectors?",
                "multimodal"
            );

            assert.equal(evidence.transcript.length, 1);
            assert.match(evidence.transcript[0]?.text ?? "", /eigenvectors/);
            assert.equal(evidence.frames.length, 1);
            assert.match(evidence.frames[0]?.dataUrl ?? "", /^data:image\/png;base64,/);
        }
        finally
        {
            await fileSystem.rm(directory, { recursive: true });
        }
    });
});
