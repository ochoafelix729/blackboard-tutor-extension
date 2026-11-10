// Verifies automatic local acquisition registers browser-observed recordings without persisting their URLs.

import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { AutoRegistrationService } from "../server/AutoRegistrationService";
import { IngestionCoordinator } from "../server/IngestionCoordinator";
import { IngestionPipeline } from "../server/IngestionPipeline";
import type {
    EmbeddingRequest,
    EmbeddingResult,
    ModelProvider,
    ModelRequest,
    ModelResult,
    TranscriptionRequest,
    TranscriptionResult
} from "../server/ModelProvider";
import { PhaseTwoStore } from "../server/PhaseTwoStore";

class FakeAutoRegistrationProvider implements ModelProvider
{
    async generate(_request: ModelRequest): Promise<ModelResult>
    {
        throw new Error("Answer generation is not used by this test.");
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult>
    {
        return {
            model: request.model,
            vectors: request.inputs.map(() => [1])
        };
    }

    async transcribe(_request: TranscriptionRequest): Promise<TranscriptionResult>
    {
        return {
            model: "fixture",
            segments: []
        };
    }
}

class FakeIngestionCoordinator extends IngestionCoordinator
{
    async ensureProcessing(): Promise<boolean>
    {
        return true;
    }
}

function waitForRegistration(store: PhaseTwoStore, lectureId: string): Promise<void>
{
    return new Promise((resolve, reject) =>
    {
        let attempts = 0;
        const interval = setInterval(() =>
        {
            attempts += 1;
            void store.getLecture(lectureId).then((lecture) =>
            {
                if (lecture !== null)
                {
                    clearInterval(interval);
                    resolve();
                    return;
                }

                if (attempts >= 50)
                {
                    clearInterval(interval);
                    reject(new Error("Automatic registration did not persist the lecture."));
                }
            });
        }, 10);
    });
}

describe("automatic registration service", () =>
{
    test("acquires an observed recording and stores only its local source reference", async () =>
    {
        const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), "auto-registration-"));
        const store = new PhaseTwoStore(directory);
        await store.initialize();
        const provider = new FakeAutoRegistrationProvider();
        const coordinator = new FakeIngestionCoordinator(
            store,
            new IngestionPipeline(store, provider, "fixture-embedding", "fixture-transcription")
        );
        const service = new AutoRegistrationService(
            store,
            coordinator,
            1_000_000,
            async () => new Response(Buffer.from("not-a-real-mp4"), {
                status: 200,
                headers: {
                    "content-length": "16"
                }
            })
        );

        try
        {
            const initialStatus = await service.begin({
                lectureId: "classcom:recording:test",
                title: "Test lecture",
                mediaUrl: "https://recordings.class.com/test.mp4?signature=private"
            });
            assert.equal(initialStatus.status, "processing");
            await waitForRegistration(store, "classcom:recording:test");
            const lecture = await store.getLecture("classcom:recording:test");
            assert.equal(lecture?.source.isManaged, true);
            assert.equal(lecture?.source.transcriptPath, null);
            assert.equal(lecture?.source.videoPath.includes("signature"), false);
            assert.equal(
                await fileSystem.stat(lecture?.source.videoPath ?? "").then(() => true),
                true
            );
        }
        finally
        {
            await fileSystem.rm(directory, { recursive: true });
        }
    });
});
