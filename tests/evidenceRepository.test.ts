// Verifies durable watched-context retrieval across transcript, semantic, and visual artifacts.

import assert from "node:assert/strict";
import { promises as fileSystem } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { EvidenceRepository } from "../server/EvidenceRepository";
import type {
    EmbeddingRequest,
    EmbeddingResult,
    ModelProvider,
    ModelRequest,
    ModelResult
} from "../server/ModelProvider";
import { PhaseTwoStore } from "../server/PhaseTwoStore";

class FakeEvidenceProvider implements ModelProvider
{
    async generate(_request: ModelRequest): Promise<ModelResult>
    {
        throw new Error("Answer generation is not used by this test.");
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

describe("evidence repository", () =>
{
    test("retrieves relevant watched transcript and visual evidence", async () =>
    {
        const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), "lecture-evidence-"));
        const store = new PhaseTwoStore(directory);
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
                    text: "Old material about a matrix and independent eigenvectors."
                },
                {
                    id: "transcript-00002",
                    startSeconds: 650,
                    endSeconds: 655,
                    text: "A matrix needs independent eigenvectors to be diagonalizable."
                },
                {
                    id: "transcript-00003",
                    startSeconds: 800,
                    endSeconds: 805,
                    text: "This later material should not be retrieved yet."
                }
            ]
        });
        await store.writeArtifact("classcom:recording:test", "segments", 1, {
            segments: [
                {
                    id: "segment-00001",
                    startSeconds: 10,
                    endSeconds: 15,
                    topic: "old matrix eigenvectors",
                    summary: "Old independent-eigenvector material.",
                    transcriptIds: ["transcript-00001"],
                    visualIds: ["frame-00001"],
                    searchText: "matrix eigenvectors diagonalizable"
                },
                {
                    id: "segment-00002",
                    startSeconds: 650,
                    endSeconds: 655,
                    topic: "matrix eigenvectors",
                    summary: "Independent eigenvectors are required.",
                    transcriptIds: ["transcript-00002"],
                    visualIds: ["frame-00002"],
                    searchText: "matrix eigenvectors diagonalizable"
                },
                {
                    id: "segment-00003",
                    startSeconds: 800,
                    endSeconds: 805,
                    topic: "later",
                    summary: "Later material.",
                    transcriptIds: ["transcript-00003"],
                    visualIds: [],
                    searchText: "later material"
                }
            ]
        });
        await store.writeArtifact("classcom:recording:test", "embeddings", 1, {
            model: "fixture-embedding",
            dimensions: 2,
            embeddings: [
                { segmentId: "segment-00001", vector: [1, 0] },
                { segmentId: "segment-00002", vector: [1, 0] },
                { segmentId: "segment-00003", vector: [0, 1] }
            ]
        });
        await store.writeArtifact("classcom:recording:test", "visuals", 1, {
            frames: [
                {
                    id: "frame-00001",
                    timestampSeconds: 12,
                    endSeconds: 90,
                    relativeImagePath: "frames-v1/slide.png",
                    description: "Old matrix and eigenvectors"
                },
                {
                    id: "frame-00002",
                    timestampSeconds: 652,
                    endSeconds: 700,
                    relativeImagePath: "frames-v1/slide.png",
                    description: "Current matrix and its eigenvectors"
                }
            ]
        });
        const frameDirectory = store.getArtifactImageDirectory("classcom:recording:test", 1);
        await fileSystem.mkdir(frameDirectory, { recursive: true });
        await fileSystem.writeFile(
            path.join(frameDirectory, "slide.png"),
            Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64")
        );

        try
        {
            const repository = new EvidenceRepository(store, new FakeEvidenceProvider(), "fixture-embedding");
            const evidence = await repository.retrieve(
                "classcom:recording:test",
                700,
                "Why does this matrix need eigenvectors?",
                "multimodal"
            );

            assert.equal(evidence.transcript.length, 1);
            assert.equal(evidence.transcript[0]?.id, "transcript-00002");
            assert.match(evidence.transcript[0]?.text ?? "", /eigenvectors/);
            assert.equal(evidence.frames.length, 1);
            assert.equal(evidence.frames[0]?.id, "frame-00002");
            assert.match(evidence.frames[0]?.dataUrl ?? "", /^data:image\/png;base64,/);

            await store.writeArtifact("classcom:recording:test", "segments", 1, { segments: [] });
            const fallbackEvidence = await repository.retrieve(
                "classcom:recording:test",
                700,
                "Tell me about the old material.",
                "transcriptOnly"
            );

            assert.deepEqual(
                fallbackEvidence.transcript.map((segment) => segment.id),
                ["transcript-00002"]
            );
        }
        finally
        {
            await fileSystem.rm(directory, { recursive: true });
        }
    });
});
