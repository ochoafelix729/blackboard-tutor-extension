// Verifies model routing, citation grounding, and per-request cost traces in the tutor service.

import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { ServerConfig } from "../server/config";
import { CostLedger } from "../server/CostLedger";
import { EvidenceRepository } from "../server/EvidenceRepository";
import type { ModelProvider, ModelRequest, ModelResult } from "../server/ModelProvider";
import { TutorService } from "../server/TutorService";

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
                inputTokens: 1_000,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                outputTokens: 100,
                reasoningTokens: 20
            }
        };
    }
}

describe("tutor service", () =>
{
    test("routes visual questions and retains only citations to retrieved evidence", async () =>
    {
        const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), "tutor-service-"));
        const evidenceDirectory = path.join(directory, "evidence");
        await fileSystem.mkdir(path.join(evidenceDirectory, "lecture", "frames"), { recursive: true });
        await fileSystem.writeFile(path.join(evidenceDirectory, "lecture", "transcript.vtt"), [
            "WEBVTT",
            "",
            "00:10.000 --> 00:15.000",
            "Independent eigenvectors are required."
        ].join("\n"));
        await fileSystem.writeFile(
            path.join(evidenceDirectory, "lecture", "frames", "slide.jpg"),
            Buffer.from("image")
        );
        await fileSystem.writeFile(path.join(evidenceDirectory, "lecture.json"), JSON.stringify({
            version: 1,
            lectureId: "classcom:recording:test",
            title: "Linear algebra",
            transcriptPath: "lecture/transcript.vtt",
            frames: [
                {
                    id: "slide-1",
                    timestampSeconds: 12,
                    path: "lecture/frames/slide.jpg"
                }
            ]
        }));
        const config: ServerConfig = {
            host: "127.0.0.1",
            port: 4387,
            evidenceDirectory,
            costLedgerPath: path.join(directory, "costs.jsonl"),
            provider: "openai",
            textModel: "gpt-6-luna",
            visionModel: "gpt-6.1-terra",
            reasoningEffort: "low",
            maxOutputTokens: 1_200,
            openAiApiKey: "test",
            openAiBaseUrl: "https://api.openai.com/v1"
        };
        const provider = new FakeModelProvider();
        const ledger = new CostLedger(config.costLedgerPath);
        const service = new TutorService(
            config,
            new EvidenceRepository(evidenceDirectory),
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
        }
        finally
        {
            await fileSystem.rm(directory, { recursive: true });
        }
    });
});
