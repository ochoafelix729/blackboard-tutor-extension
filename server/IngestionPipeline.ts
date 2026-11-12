// Builds reusable timestamped transcript, visual, segment, and embedding artifacts for one lecture.

import { spawn } from "node:child_process";
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import type { processingStage } from "../src/shared/ingestion";
import type { OpenAiProvider } from "./OpenAiProvider";
import { LectureStore } from "./LectureStore";
import type {
    EmbeddingArtifact,
    LectureRecord,
    LectureSegment,
    SegmentArtifact,
    TranscriptArtifact,
    TranscriptSegment,
    VisualArtifact,
    VisualEvidence
} from "./ingestionTypes";

const maximumFrames = 240;
const embeddingBatchSize = 64;
const audioChunkSeconds = 120;
const ignoredTopicTerms = new Set([
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "being",
    "could",
    "does",
    "from",
    "going",
    "have",
    "here",
    "into",
    "just",
    "like",
    "more",
    "only",
    "other",
    "some",
    "that",
    "their",
    "then",
    "there",
    "these",
    "they",
    "this",
    "through",
    "what",
    "when",
    "which",
    "with",
    "would",
    "your"
]);

interface CommandResult
{
    stdout: string;
    stderr: string;
}

function runCommand(command: string, arguments_: string[]): Promise<CommandResult>
{
    return new Promise((resolve, reject) =>
    {
        const child = spawn(command, arguments_, {
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) =>
        {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) =>
        {
            stderr += chunk;
        });
        child.on("error", (error) =>
        {
            reject(new Error(`Could not start ${command}: ${error.message}`));
        });
        child.on("close", (code) =>
        {
            if (code !== 0)
            {
                reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

function getTopic(transcript: TranscriptSegment[]): string
{
    const counts = new Map<string, number>();

    for (const segment of transcript)
    {
        const terms = segment.text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? [];

        for (const term of terms)
        {
            if (!ignoredTopicTerms.has(term))
            {
                counts.set(term, (counts.get(term) ?? 0) + 1);
            }
        }
    }

    const terms = [...counts.entries()]
        .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
        .slice(0, 4)
        .map(([term]) => term);
    return terms.length > 0 ? terms.join(" · ") : "Lecture segment";
}

function createLectureSegment(
    index: number,
    transcript: TranscriptSegment[],
    frames: VisualEvidence[]
): LectureSegment
{
    const first = transcript[0];
    const last = transcript.at(-1);

    if (first === undefined || last === undefined)
    {
        throw new Error("Cannot build an empty lecture segment.");
    }

    const matchingFrames = frames.filter((frame) =>
    {
        return frame.timestampSeconds <= last.endSeconds && frame.endSeconds >= first.startSeconds;
    });
    const transcriptText = transcript.map((segment) => segment.text).join(" ");
    const topic = getTopic(transcript);
    return {
        id: `segment-${String(index + 1).padStart(5, "0")}`,
        startSeconds: first.startSeconds,
        endSeconds: last.endSeconds,
        topic,
        summary: transcriptText.length <= 320
            ? transcriptText
            : `${transcriptText.slice(0, 317).trimEnd()}...`,
        transcriptIds: transcript.map((segment) => segment.id),
        visualIds: matchingFrames.map((frame) => frame.id),
        searchText: [topic, transcriptText, ...matchingFrames.flatMap((frame) => frame.description ?? [])].join("\n")
    };
}

function buildSemanticSegments(
    transcript: TranscriptSegment[],
    frames: VisualEvidence[]
): LectureSegment[]
{
    const groups: TranscriptSegment[][] = [];
    let current: TranscriptSegment[] = [];

    for (const segment of transcript)
    {
        const first = current[0];
        const previous = current.at(-1);
        const duration = first === undefined ? 0 : segment.endSeconds - first.startSeconds;
        const pause = previous === undefined ? 0 : segment.startSeconds - previous.endSeconds;
        const isBoundary = current.length > 0
            && (duration >= 90 || (duration >= 25 && pause >= 5));

        if (isBoundary)
        {
            groups.push(current);
            current = [];
        }

        current.push(segment);
    }

    if (current.length > 0)
    {
        groups.push(current);
    }

    return groups.map((group, index) => createLectureSegment(index, group, frames));
}

async function getMediaDuration(filePath: string): Promise<number>
{
    const result = await runCommand("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath
    ]);
    const durationSeconds = Number(result.stdout.trim());

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    {
        throw new Error("The media file has no usable duration.");
    }

    return durationSeconds;
}

export class IngestionPipeline
{
    private readonly store: LectureStore;
    private readonly provider: OpenAiProvider;
    private readonly embeddingModel: string;
    private readonly transcriptionModel: string;

    constructor(
        store: LectureStore,
        provider: OpenAiProvider,
        embeddingModel: string,
        transcriptionModel: string
    )
    {
        this.store = store;
        this.provider = provider;
        this.embeddingModel = embeddingModel;
        this.transcriptionModel = transcriptionModel;
    }

    async process(lecture: LectureRecord): Promise<void>
    {
        await this.processMetadata(lecture);
        await this.processTranscript(lecture);
        await this.processVisuals(lecture);
        await this.processSegments(lecture);
        await this.processEmbeddings(lecture);
        await this.store.removeSourceMedia(lecture.lectureId);
    }

    private async processMetadata(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "metadata", async () =>
        {
            const durationSeconds = await getMediaDuration(this.store.getRecordingPath(lecture.lectureId));
            await this.store.setLectureDuration(lecture, durationSeconds);
        });
    }

    private async processTranscript(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "transcript", async () =>
        {
            await this.transcribeVideo(lecture);
        });
    }

    private async transcribeVideo(lecture: LectureRecord): Promise<void>
    {
        const durationSeconds = lecture.durationSeconds;

        if (durationSeconds === null)
        {
            throw new Error("Media duration must be available before transcription.");
        }

        const previous = await this.store.readArtifact<TranscriptArtifact>(lecture.lectureId, "transcript");
        // Only checkpointed artifacts can safely identify which audio is still unfinished.
        const segments = previous?.processedThroughSeconds === undefined ? [] : previous.segments;
        let processedThroughSeconds = previous?.processedThroughSeconds ?? 0;
        const audioDirectory = path.join(this.store.getLectureDirectory(lecture.lectureId), "audio");
        await fileSystem.rm(audioDirectory, { recursive: true, force: true });
        await fileSystem.mkdir(audioDirectory, { recursive: true, mode: 0o700 });
        const chunkPath = path.join(audioDirectory, "chunk.mp3");

        try
        {
            await this.store.setTranscriptProgress(lecture, {
                processedThroughSeconds,
                durationSeconds,
                segmentCount: segments.length
            });

            while (processedThroughSeconds < durationSeconds)
            {
                const startSeconds = processedThroughSeconds;
                const endSeconds = Math.min(durationSeconds, startSeconds + audioChunkSeconds);
                const extractionStartedAt = Date.now();
                await runCommand("ffmpeg", [
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    String(startSeconds),
                    "-i",
                    this.store.getRecordingPath(lecture.lectureId),
                    "-t",
                    String(endSeconds - startSeconds),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "32k",
                    chunkPath
                ]);
                const extractionDurationMilliseconds = Date.now() - extractionStartedAt;
                const audio = await fileSystem.readFile(chunkPath);
                const transcriptionStartedAt = Date.now();
                const result = await this.provider.transcribe({
                    model: this.transcriptionModel,
                    audio,
                    filename: "chunk.mp3",
                    mimeType: "audio/mpeg"
                });

                for (const segment of result.segments)
                {
                    segments.push({
                        id: `transcript-asr-${String(segments.length + 1).padStart(5, "0")}`,
                        startSeconds: Math.min(endSeconds, startSeconds + segment.startSeconds),
                        endSeconds: Math.min(endSeconds, startSeconds + segment.endSeconds),
                        text: segment.text
                    });
                }

                const transcriptionDurationMilliseconds = Date.now() - transcriptionStartedAt;
                processedThroughSeconds = endSeconds;
                const artifact: TranscriptArtifact = { segments, processedThroughSeconds };
                await this.store.writeArtifact(lecture.lectureId, "transcript", artifact);
                await this.store.setTranscriptProgress(lecture, {
                    processedThroughSeconds,
                    durationSeconds,
                    segmentCount: segments.length
                });
                console.info("Lecture audio chunk completed", {
                    startSeconds,
                    endSeconds,
                    extractionDurationMilliseconds,
                    transcriptionDurationMilliseconds
                });
            }

            if (segments.length === 0)
            {
                throw new Error("The lecture transcript contains no usable timestamped cues.");
            }
        }
        finally
        {
            await fileSystem.rm(audioDirectory, { recursive: true, force: true });
        }
    }

    private async processVisuals(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "visuals", async () =>
        {
            const frameDirectory = this.store.getFramesDirectory(lecture.lectureId);
            await fileSystem.rm(frameDirectory, { recursive: true, force: true });
            await fileSystem.mkdir(frameDirectory, { recursive: true, mode: 0o700 });
            const framePattern = path.join(frameDirectory, "frame-%05d.jpg");
            const result = await runCommand("ffmpeg", [
                "-hide_banner",
                "-loglevel",
                "info",
                "-i",
                this.store.getRecordingPath(lecture.lectureId),
                "-vf",
                "select=eq(n\\,0)+gt(scene\\,0.18),scale=min(1600\\,iw):-2,showinfo",
                "-fps_mode",
                "vfr",
                "-frames:v",
                String(maximumFrames),
                "-q:v",
                "3",
                framePattern
            ]);
            const timestamps = Array.from(
                result.stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g),
                (match) => Number(match[1])
            ).filter(Number.isFinite);
            const frameFiles = (await fileSystem.readdir(frameDirectory))
                .filter((name) => /^frame-\d+\.jpg$/i.test(name))
                .sort();

            if (frameFiles.length === 0)
            {
                throw new Error("No representative frames were extracted from the lecture video.");
            }

            const frames: VisualEvidence[] = frameFiles.map((name, index) =>
            {
                const timestampSeconds = timestamps[index] ?? 0;
                const nextTimestamp = timestamps[index + 1];
                return {
                    id: `frame-${String(index + 1).padStart(5, "0")}`,
                    timestampSeconds,
                    endSeconds: nextTimestamp ?? lecture.durationSeconds ?? timestampSeconds,
                    relativeImagePath: `frames/${name}`,
                    description: null
                };
            });
            const artifact: VisualArtifact = { frames };
            await this.store.writeArtifact(lecture.lectureId, "visuals", artifact);
        });
    }

    private async processSegments(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "segments", async () =>
        {
            const transcript = await this.store.readArtifact<TranscriptArtifact>(
                lecture.lectureId,
                "transcript"
            );
            const visuals = await this.store.readArtifact<VisualArtifact>(lecture.lectureId, "visuals");

            if (transcript === null || visuals === null)
            {
                throw new Error("Transcript and visual artifacts must be ready before segmentation.");
            }

            const artifact: SegmentArtifact = {
                segments: buildSemanticSegments(transcript.segments, visuals.frames)
            };
            await this.store.writeArtifact(lecture.lectureId, "segments", artifact);
        });
    }

    private async processEmbeddings(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "embeddings", async () =>
        {
            const segments = await this.store.readArtifact<SegmentArtifact>(lecture.lectureId, "segments");

            if (segments === null || segments.segments.length === 0)
            {
                throw new Error("Lecture segments must be ready before embedding.");
            }

            const vectors: number[][] = [];
            let resolvedModel = this.embeddingModel;

            for (let index = 0; index < segments.segments.length; index += embeddingBatchSize)
            {
                const batch = segments.segments.slice(index, index + embeddingBatchSize);
                const result = await this.provider.embed({
                    model: this.embeddingModel,
                    inputs: batch.map((segment) => segment.searchText)
                });
                resolvedModel = result.model;
                vectors.push(...result.vectors);
            }

            const artifact: EmbeddingArtifact = {
                model: resolvedModel,
                embeddings: segments.segments.map((segment, index) => ({
                    segmentId: segment.id,
                    vector: vectors[index] ?? []
                }))
            };
            await this.store.writeArtifact(lecture.lectureId, "embeddings", artifact);
        });
    }

    private async runStage(
        lecture: LectureRecord,
        stage: processingStage,
        operation: () => Promise<void>
    ): Promise<void>
    {
        if (lecture.stages[stage].status === "ready")
        {
            return;
        }

        await this.store.setStageStatus(lecture, stage, "processing");

        try
        {
            await operation();
            await this.store.setStageStatus(lecture, stage, "ready");
            console.info("Lecture stage completed", {
                stage,
                durationMilliseconds: lecture.stages[stage].durationMilliseconds
            });
        }
        catch (error)
        {
            const message = error instanceof Error ? error.message : "The ingestion stage failed.";
            await this.store.setStageStatus(lecture, stage, "failed", message);
            console.error("Lecture stage failed", {
                stage,
                durationMilliseconds: lecture.stages[stage].durationMilliseconds
            });
            throw error;
        }
    }
}
