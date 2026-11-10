// Verifies durable job idempotency, leases, retries, and partial-readiness state.

import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { PhaseTwoStore } from "../server/PhaseTwoStore";

describe("phase two store", () =>
{
    test("deduplicates leased jobs and preserves partial readiness across retries", async () =>
    {
        const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), "phase-two-store-"));
        const store = new PhaseTwoStore(directory);

        try
        {
            await store.initialize();
            await store.registerLecture(
                "classcom:recording:test",
                "Test lecture",
                {
                    transcriptPath: "/private/transcript.vtt",
                    videoPath: "/private/video.mp4",
                    fingerprint: "fixture",
                    isManaged: false
                },
                1
            );
            const firstJob = await store.ensureJob("classcom:recording:test");
            const duplicateJob = await store.ensureJob("classcom:recording:test");
            assert.equal(firstJob?.id, duplicateJob?.id);

            const claimedJob = await store.claimJob("classcom:recording:test");
            assert.equal(claimedJob?.attempts, 1);
            assert.equal(await store.claimJob("classcom:recording:test"), null);

            await store.setStageStatus("classcom:recording:test", "transcript", "ready");
            await store.failJob("classcom:recording:test", "visual extraction failed");
            const status = await store.getStatus("classcom:recording:test");
            assert.equal(status?.capabilities.hasTranscript, true);
            assert.equal(status?.status, "queued");

            const retry = await store.claimJob("classcom:recording:test");
            assert.equal(retry?.attempts, 2);
        }
        finally
        {
            await fileSystem.rm(directory, { recursive: true });
        }
    });
});
