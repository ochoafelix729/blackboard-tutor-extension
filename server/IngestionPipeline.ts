// Builds reusable timestamped transcript, visual, segment, and embedding artifacts for one lecture.

import { spawn } from "node:child_process";
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import type { processingStage } from "../src/shared/ingestion";
import type { ModelProvider } from "./ModelProvider";
import { PhaseTwoStore } from "./PhaseTwoStore";
import type {
    EmbeddingArtifact,
    LectureRecord,
    LectureSegment,
    MediaMetadataArtifact,
    SegmentArtifact,
    TranscriptArtifact,
    VisualArtifact,
    VisualEvidence
} from "./ingestionTypes";
import { parseWebVtt, type TranscriptSegment } from "./vttParser";

export const pipelineVersion = 1;
const maximumTranscriptBytes = 25_000_000;
const maximumAudioChunkBytes = 24_000_000;
const maximumDiagnosticBytes = 10_000_000;
const maximumFrames = 240;
const embeddingBatchSize = 64;
const audioChunkSeconds = 600;
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

            if (stdout.length > maximumDiagnosticBytes)
            {
                stdout = stdout.slice(-maximumDiagnosticBytes);
            }
        });
        child.stderr.on("data", (chunk: string) =>
        {
            stderr += chunk;

            if (stderr.length > maximumDiagnosticBytes)
            {
                stderr = stderr.slice(-maximumDiagnosticBytes);
            }
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

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function readCodecName(streams: unknown[], codecType: string): string | null
{
    const stream = streams.find((candidate) =>
    {
        return isRecord(candidate) && candidate.codec_type === codecType;
    });
    return isRecord(stream) && typeof stream.codec_name === "string" ? stream.codec_name : null;
}

function parseMediaMetadata(source: string): MediaMetadataArtifact
{
    const value: unknown = JSON.parse(source);

    if (!isRecord(value) || !isRecord(value.format) || !Array.isArray(value.streams))
    {
        throw new Error("ffprobe returned invalid lecture metadata.");
    }

    const durationSeconds = Number(value.format.duration);

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    {
        throw new Error("The lecture video has no usable duration.");
    }

    return {
        durationSeconds,
        formatName: typeof value.format.format_name === "string" ? value.format.format_name : "unknown",
        videoCodec: readCodecName(value.streams, "video"),
        audioCodec: readCodecName(value.streams, "audio")
    };
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
        throw new Error("The extracted audio chunk has no usable duration.");
    }

    return durationSeconds;
}

export class IngestionPipeline
{
    private readonly store: PhaseTwoStore;
    private readonly provider: ModelProvider;
    private readonly embeddingModel: string;
    private readonly transcriptionModel: string;

    constructor(
        store: PhaseTwoStore,
        provider: ModelProvider,
        embeddingModel: string,
        transcriptionModel: string
    )
    {
        this.store = store;
        this.provider = provider;
        this.embeddingModel = embeddingModel;
        this.transcriptionModel = transcriptionModel;
    }

    async process(lectureId: string): Promise<void>
    {
        const lecture = await this.store.getLecture(lectureId);

        if (lecture === null)
        {
            throw new Error(`Lecture is not registered: ${lectureId}`);
        }

        const extractionResults = await Promise.allSettled([
            this.processMetadata(lecture),
            this.processTranscript(lecture),
            this.processVisuals(lecture)
        ]);

        const extractionFailure = extractionResults.find((result) => result.status === "rejected");

        if (extractionFailure?.status === "rejected")
        {
            throw extractionFailure.reason;
        }

        await this.processSegments(lecture);
        await this.processEmbeddings(lecture);
        await this.store.removeManagedSources(lecture);
    }

    private async processMetadata(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "metadata", async () =>
        {
            const result = await runCommand("ffprobe", [
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
                lecture.source.videoPath
            ]);
            const metadata = parseMediaMetadata(result.stdout);
            await this.store.writeArtifact(lecture.lectureId, "metadata", pipelineVersion, metadata);
            await this.store.setLectureDuration(lecture.lectureId, metadata.durationSeconds);
        });
    }

    private async processTranscript(lecture: LectureRecord): Promise<void>
    {
        await this.runStage(lecture, "transcript", async () =>
        {
            const segments = lecture.source.transcriptPath === null
                ? await this.transcribeVideo(lecture)
                : await this.readWebVttTranscript(lecture.source.transcriptPath);
            const artifact: TranscriptArtifact = { segments };

            if (artifact.segments.length === 0)
            {
                throw new Error("The lecture transcript contains no usable timestamped cues.");
            }

            await this.store.writeArtifact(lecture.lectureId, "transcript", pipelineVersion, artifact);
        });
    }

    private async readWebVttTranscript(transcriptPath: string): Promise<TranscriptSegment[]>
    {
        const statistics = await fileSystem.stat(transcriptPath);

        if (!statistics.isFile() || statistics.size > maximumTranscriptBytes)
        {
            throw new Error("The transcript is missing or exceeds the supported size.");
        }

        const source = await fileSystem.readFile(transcriptPath, "utf8");
        const segments = parseWebVtt(source);

        if (segments.length === 0)
        {
            throw new Error("The WebVTT transcript contains no usable timestamped cues.");
        }

        return segments;
    }

    private async transcribeVideo(lecture: LectureRecord): Promise<TranscriptSegment[]>
    {
        const audioDirectory = path.join(this.store.getSourceDirectory(lecture.lectureId), "audio");
        await fileSystem.rm(audioDirectory, { recursive: true, force: true });
        await fileSystem.mkdir(audioDirectory, { recursive: true, mode: 0o700 });
        const audioPattern = path.join(audioDirectory, "chunk-%04d.mp3");

        try
        {
            await runCommand("ffmpeg", [
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                lecture.source.videoPath,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "32k",
                "-f",
                "segment",
                "-segment_time",
                String(audioChunkSeconds),
                "-reset_timestamps",
                "1",
                audioPattern
            ]);
            const chunkNames = (await fileSystem.readdir(audioDirectory))
                .filter((name) => /^chunk-\d+\.mp3$/i.test(name))
                .sort();

            if (chunkNames.length === 0)
            {
                throw new Error("The lecture video has no extractable audio for transcription.");
            }

            const segments: TranscriptSegment[] = [];
            let timeOffsetSeconds = 0;

            for (const chunkName of chunkNames)
            {
                const chunkPath = path.join(audioDirectory, chunkName);
                const statistics = await fileSystem.stat(chunkPath);

                if (!statistics.isFile() || statistics.size > maximumAudioChunkBytes)
                {
                    throw new Error("An extracted audio chunk exceeds the transcription upload limit.");
                }

                const [audio, durationSeconds] = await Promise.all([
                    fileSystem.readFile(chunkPath),
                    getMediaDuration(chunkPath)
                ]);
                const result = await this.provider.transcribe({
                    model: this.transcriptionModel,
                    audio,
                    filename: chunkName,
                    mimeType: "audio/mpeg"
                });

                for (const segment of result.segments)
                {
                    segments.push({
                        id: `transcript-asr-${String(segments.length + 1).padStart(5, "0")}`,
                        startSeconds: timeOffsetSeconds + segment.startSeconds,
                        endSeconds: timeOffsetSeconds + segment.endSeconds,
                        text: segment.text
                    });
                }

                timeOffsetSeconds += durationSeconds;
            }

            return segments;
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
            const frameDirectory = this.store.getArtifactImageDirectory(
                lecture.lectureId,
                pipelineVersion
            );
            await fileSystem.rm(frameDirectory, { recursive: true, force: true });
            await fileSystem.mkdir(frameDirectory, { recursive: true, mode: 0o700 });
            const framePattern = path.join(frameDirectory, "frame-%05d.jpg");
            const result = await runCommand("ffmpeg", [
                "-hide_banner",
                "-loglevel",
                "info",
                "-i",
                lecture.source.videoPath,
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

            const currentLecture = await this.store.getLecture(lecture.lectureId);

            const frames: VisualEvidence[] = frameFiles.map((name, index) =>
            {
                const timestampSeconds = timestamps[index] ?? 0;
                const nextTimestamp = timestamps[index + 1];
                return {
                    id: `frame-${String(index + 1).padStart(5, "0")}`,
                    timestampSeconds,
                    endSeconds: nextTimestamp ?? currentLecture?.durationSeconds ?? timestampSeconds,
                    relativeImagePath: `frames-v${pipelineVersion}/${name}`,
                    description: null
                };
            });
            const artifact: VisualArtifact = { frames };
            await this.store.writeArtifact(lecture.lectureId, "visuals", pipelineVersion, artifact);
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
            await this.store.writeArtifact(lecture.lectureId, "segments", pipelineVersion, artifact);
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

            const dimensions = vectors[0]?.length ?? 0;

            if (dimensions === 0
                || vectors.length !== segments.segments.length
                || vectors.some((vector) => vector.length !== dimensions))
            {
                throw new Error("The embedding provider returned inconsistent vectors.");
            }

            const artifact: EmbeddingArtifact = {
                model: resolvedModel,
                dimensions,
                embeddings: segments.segments.map((segment, index) => ({
                    segmentId: segment.id,
                    vector: vectors[index] ?? []
                }))
            };
            await this.store.writeArtifact(lecture.lectureId, "embeddings", pipelineVersion, artifact);
        });
    }

    private async runStage(
        lecture: LectureRecord,
        stage: processingStage,
        operation: () => Promise<void>
    ): Promise<void>
    {
        const current = await this.store.getLecture(lecture.lectureId);

        if (current?.stages[stage].status === "ready")
        {
            return;
        }

        await this.store.setStageStatus(lecture.lectureId, stage, "processing");

        try
        {
            await operation();
            await this.store.setStageStatus(lecture.lectureId, stage, "ready");
        }
        catch (error)
        {
            const message = error instanceof Error ? error.message : "The ingestion stage failed.";
            await this.store.setStageStatus(lecture.lectureId, stage, "failed", message);
            throw error;
        }
    }
}
