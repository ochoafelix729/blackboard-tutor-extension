// Verifies durable evidence routing, citation grounding, and cost traces in the tutor service.

import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { ServerConfig } from "../server/config";
import { AutoRegistrationService } from "../server/AutoRegistrationService";
import { CostLedger } from "../server/CostLedger";
import { EvidenceRepository } from "../server/EvidenceRepository";
import { IngestionCoordinator } from "../server/IngestionCoordinator";
import { IngestionPipeline } from "../server/IngestionPipeline";
import type {
    EmbeddingRequest,
    EmbeddingResult,
    ModelProvider,
    ModelRequest,
    ModelResult
} from "../server/ModelProvider";
import { PhaseTwoStore } from "../server/PhaseTwoStore";
import { TutorService } from "../server/TutorService";
import { TutorServiceError } from "../server/TutorServiceError";

class FakeModelProvider implements ModelProvider
{
    latestRequest: ModelRequest | null = null;

    async generate(request: ModelRequest): Promise<ModelResult>
    {
        this.latestRequest = request;
        return {
            provider: "openai",
            model: request.model,
            providerRequestId: "response-1",
            answer: {
                answer: "Independent eigenvectors form the change-of-basis matrix.",
                citations: [
                    {
                        startSeconds: 0,
                        endSeconds: 0,
                        evidenceIds: ["transcript-00001", "invented-id"]
                    }
                ],
                usedModalities: ["transcript", "slide"],
                limitations: []
            },
            usage: {
                inputTokens: 1000,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                outputTokens: 100,
                reasoningTokens: 20
            }
        };
    }

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult>
    {
        return {
            model: request.model,
            vectors: request.inputs.map(() => [1, 0])
        };
    }

    async transcribe(): Promise<never>
    {
        throw new Error("Transcription is not used by this test.");
    }
}

describe("tutor service", () =>
{
    test("routes visual questions and retains only citations to retrieved evidence", async () =>
    {
        const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), "tutor-service-"));
        const storageDirectory = path.join(directory, "storage");
        const store = new PhaseTwoStore(storageDirectory);
        await store.initialize();
        await store.registerLecture(
            "classcom:recording:test",
            "Linear algebra",
            {
                transcriptPath: "/private/transcript.vtt",
                videoPath: "/private/video.mp4",
                fingerprint: "fixture",
                isManaged: false
            },
            1
        );
        await store.writeArtifact("classcom:recording:test", "transcript", 1, {
            segments: [
                {
                    id: "transcript-00001",
                    startSeconds: 10,
                    endSeconds: 15,
                    text: "Independent eigenvectors are required."
                }
            ]
        });
        await store.writeArtifact("classcom:recording:test", "segments", 1, {
            segments: [
                {
                    id: "segment-00001",
                    startSeconds: 10,
                    endSeconds: 15,
                    topic: "eigenvectors",
                    summary: "Independent eigenvectors are required.",
                    transcriptIds: ["transcript-00001"],
                    visualIds: ["frame-00001"],
                    searchText: "Independent eigenvectors are required."
                }
            ]
        });
        await store.writeArtifact("classcom:recording:test", "embeddings", 1, {
            model: "fixture-embedding",
            dimensions: 2,
            embeddings: [{ segmentId: "segment-00001", vector: [1, 0] }]
        });
        await store.writeArtifact("classcom:recording:test", "visuals", 1, {
            frames: [
                {
                    id: "frame-00001",
                    timestampSeconds: 12,
                    endSeconds: 20,
                    relativeImagePath: "frames-v1/slide.jpg",
                    description: null
                }
            ]
        });
        await store.writeArtifact("classcom:recording:test", "metadata", 1, {
            durationSeconds: 60,
            formatName: "mp4",
            videoCodec: "h264",
            audioCodec: "aac"
        });
        const frameDirectory = store.getArtifactImageDirectory("classcom:recording:test", 1);
        await fileSystem.mkdir(frameDirectory, { recursive: true });
        await fileSystem.writeFile(path.join(frameDirectory, "slide.jpg"), Buffer.from("image"));

        for (const stage of ["metadata", "transcript", "visuals", "segments", "embeddings"] as const)
        {
            await store.setStageStatus("classcom:recording:test", stage, "ready");
        }

        const config: ServerConfig = {
            host: "127.0.0.1",
            port: 4387,
            storageDirectory,
            costLedgerPath: path.join(directory, "costs.jsonl"),
            provider: "openai",
            textModel: "gpt-6-luna",
            visionModel: "gpt-6.1-terra",
            embeddingModel: "fixture-embedding",
            transcriptionModel: "whisper-1",
            maximumMediaBytes: 2_000_000_000,
            reasoningEffort: "low",
            maxOutputTokens: 1_200,
            openAiApiKey: "test",
            openAiBaseUrl: "https://api.openai.com/v1"
        };
        const provider = new FakeModelProvider();
        const ledger = new CostLedger(config.costLedgerPath);
        const repository = new EvidenceRepository(store, provider, config.embeddingModel);
        const coordinator = new IngestionCoordinator(
            store,
            new IngestionPipeline(
                store,
                provider,
                config.embeddingModel,
                config.transcriptionModel
            )
        );
        const autoRegistrationService = new AutoRegistrationService(
            store,
            coordinator,
            config.maximumMediaBytes
        );
        const service = new TutorService(
            config,
            repository,
            autoRegistrationService,
            coordinator,
            store,
            provider,
            ledger
        );

        try
        {
            const answer = await service.answer({
                lectureId: "classcom:recording:test",
                timestampSeconds: 20,
                question: "Why are independent eigenvectors required?",
                strategy: "multimodal",
                currentFrameDataUrl: null
            });

            assert.equal(provider.latestRequest?.model, "gpt-6.1-terra");
            assert.equal(provider.latestRequest?.images.length, 1);
            assert.deepEqual(answer.citations[0]?.evidenceIds, ["transcript-00001"]);
            assert.equal(answer.cost.estimatedCostUsd, 0.0015);
            assert.equal((await ledger.summarize()).requestCount, 1);

            provider.latestRequest = null;
            await assert.rejects(
                service.answer({
                    lectureId: "classcom:recording:test",
                    timestampSeconds: 20,
                    question: "Summarize the entire lecture.",
                    strategy: "multimodal",
                    currentFrameDataUrl: null
                }),
                (error: unknown) =>
                {
                    return error instanceof TutorServiceError
                        && error.code === "questionOutOfScope";
                }
            );
            assert.equal(provider.latestRequest, null);
            assert.equal((await ledger.summarize()).requestCount, 1);
        }
        finally
        {
            await fileSystem.rm(directory, { recursive: true });
        }
    });
});
