// Loads private Phase 1 lecture manifests and retrieves time-aligned transcript and frame evidence.

import { promises as fileSystem } from "node:fs";
import path from "node:path";
import type { tutorStrategy } from "../src/shared/tutor";
import { parseWebVtt, type TranscriptSegment } from "./vttParser";

interface LectureFrameManifest
{
    id: string;
    timestampSeconds: number;
    path: string;
    description: string | null;
}

interface LectureEvidenceManifest
{
    version: number;
    lectureId: string;
    title: string;
    transcriptPath: string;
    frames: LectureFrameManifest[];
}

export interface RetrievedFrame
{
    id: string;
    timestampSeconds: number;
    description: string | null;
    dataUrl: string;
}

export interface RetrievedEvidence
{
    lectureId: string;
    lectureTitle: string;
    transcript: TranscriptSegment[];
    frames: RetrievedFrame[];
}

const maximumManifestBytes = 1_000_000;
const maximumTranscriptBytes = 25_000_000;
const maximumFrameBytes = 6_000_000;
const ignoredTerms = new Set([
    "about",
    "does",
    "explain",
    "from",
    "have",
    "lecture",
    "professor",
    "that",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would"
]);

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function normalizeManifest(value: unknown): LectureEvidenceManifest | null
{
    if (!isRecord(value)
        || value.version !== 1
        || typeof value.lectureId !== "string"
        || typeof value.title !== "string"
        || typeof value.transcriptPath !== "string"
        || !Array.isArray(value.frames))
    {
        return null;
    }

    const frames: LectureFrameManifest[] = [];

    for (const item of value.frames)
    {
        if (!isRecord(item)
            || typeof item.id !== "string"
            || typeof item.timestampSeconds !== "number"
            || !Number.isFinite(item.timestampSeconds)
            || item.timestampSeconds < 0
            || typeof item.path !== "string"
            || !(item.description === undefined
                || item.description === null
                || typeof item.description === "string"))
        {
            return null;
        }

        frames.push({
            id: item.id,
            timestampSeconds: item.timestampSeconds,
            path: item.path,
            description: typeof item.description === "string" ? item.description : null
        });
    }

    return {
        version: 1,
        lectureId: value.lectureId,
        title: value.title,
        transcriptPath: value.transcriptPath,
        frames
    };
}

function resolveContainedPath(parentDirectory: string, relativePath: string): string
{
    const resolvedParent = path.resolve(parentDirectory);
    const resolvedPath = path.resolve(resolvedParent, relativePath);

    if (resolvedPath !== resolvedParent && !resolvedPath.startsWith(`${resolvedParent}${path.sep}`))
    {
        throw new Error("Evidence paths must stay inside the manifest directory.");
    }

    return resolvedPath;
}

async function readLimitedFile(filePath: string, maximumBytes: number): Promise<Buffer>
{
    const statistics = await fileSystem.stat(filePath);

    if (!statistics.isFile() || statistics.size > maximumBytes)
    {
        throw new Error(`Evidence file is missing or exceeds ${maximumBytes} bytes.`);
    }

    return fileSystem.readFile(filePath);
}

function getQuestionTerms(question: string): Set<string>
{
    const terms = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return new Set(terms.filter((term) => term.length > 2 && !ignoredTerms.has(term)));
}

function getTranscriptScore(
    segment: TranscriptSegment,
    timestampSeconds: number,
    questionTerms: Set<string>
): number
{
    const midpoint = (segment.startSeconds + segment.endSeconds) / 2;
    const temporalScore = Math.max(0, 1 - Math.abs(timestampSeconds - midpoint) / 180);
    const segmentTerms = new Set(segment.text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    let matchingTermCount = 0;

    for (const term of questionTerms)
    {
        if (segmentTerms.has(term))
        {
            matchingTermCount += 1;
        }
    }

    const lexicalScore = questionTerms.size === 0 ? 0 : matchingTermCount / questionTerms.size;
    return temporalScore + lexicalScore * 2;
}

function selectTranscript(
    segments: TranscriptSegment[],
    timestampSeconds: number,
    question: string
): TranscriptSegment[]
{
    const watchedCutoff = timestampSeconds + 15;
    const watchedSegments = segments.filter((segment) => segment.startSeconds <= watchedCutoff);
    const terms = getQuestionTerms(question);
    return watchedSegments
        .map((segment) => ({
            segment,
            score: getTranscriptScore(segment, timestampSeconds, terms)
        }))
        .sort((first, second) => second.score - first.score)
        .slice(0, 10)
        .map((item) => item.segment)
        .sort((first, second) => first.startSeconds - second.startSeconds);
}

function getFrameMimeType(filePath: string): string
{
    switch (path.extname(filePath).toLowerCase())
    {
        case ".png":
        {
            return "image/png";
        }
        case ".webp":
        {
            return "image/webp";
        }
        case ".gif":
        {
            return "image/gif";
        }
        case ".jpg":
        case ".jpeg":
        {
            return "image/jpeg";
        }
        default:
        {
            throw new Error("Representative frames must be PNG, JPEG, WEBP, or GIF files.");
        }
    }
}

export class EvidenceRepository
{
    private readonly evidenceDirectory: string;

    constructor(evidenceDirectory: string)
    {
        this.evidenceDirectory = evidenceDirectory;
    }

    async retrieve(
        lectureId: string,
        timestampSeconds: number,
        question: string,
        strategy: tutorStrategy
    ): Promise<RetrievedEvidence>
    {
        const located = await this.findManifest(lectureId);
        const manifestDirectory = path.dirname(located.path);
        const transcriptPath = resolveContainedPath(manifestDirectory, located.manifest.transcriptPath);
        const transcriptBuffer = await readLimitedFile(transcriptPath, maximumTranscriptBytes);
        const allTranscript = parseWebVtt(transcriptBuffer.toString("utf8"));
        const transcript = selectTranscript(allTranscript, timestampSeconds, question);

        if (transcript.length === 0)
        {
            throw new Error("The lecture transcript has no evidence at or before this timestamp.");
        }

        const frames = strategy === "multimodal"
            ? await this.loadNearbyFrames(located.manifest, manifestDirectory, timestampSeconds)
            : [];

        return {
            lectureId: located.manifest.lectureId,
            lectureTitle: located.manifest.title,
            transcript,
            frames
        };
    }

    private async findManifest(lectureId: string): Promise<{
        path: string;
        manifest: LectureEvidenceManifest;
    }>
    {
        let entries;

        try
        {
            entries = await fileSystem.readdir(this.evidenceDirectory, { withFileTypes: true });
        }
        catch
        {
            throw new Error(`Evidence directory is unavailable: ${this.evidenceDirectory}`);
        }

        for (const entry of entries)
        {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json")
            {
                continue;
            }

            const manifestPath = path.join(this.evidenceDirectory, entry.name);
            const buffer = await readLimitedFile(manifestPath, maximumManifestBytes);
            let parsed: unknown;

            try
            {
                parsed = JSON.parse(buffer.toString("utf8"));
            }
            catch
            {
                continue;
            }

            const manifest = normalizeManifest(parsed);

            if (manifest?.lectureId === lectureId)
            {
                return { path: manifestPath, manifest };
            }
        }

        throw new Error(`No Phase 1 evidence manifest matches lecture ID ${lectureId}.`);
    }

    private async loadNearbyFrames(
        manifest: LectureEvidenceManifest,
        manifestDirectory: string,
        timestampSeconds: number
    ): Promise<RetrievedFrame[]>
    {
        const nearbyFrames = manifest.frames
            .filter((frame) => frame.timestampSeconds <= timestampSeconds + 15)
            .sort((first, second) =>
            {
                return Math.abs(first.timestampSeconds - timestampSeconds)
                    - Math.abs(second.timestampSeconds - timestampSeconds);
            })
            .slice(0, 2);

        return Promise.all(nearbyFrames.map(async (frame) =>
        {
            const framePath = resolveContainedPath(manifestDirectory, frame.path);
            const buffer = await readLimitedFile(framePath, maximumFrameBytes);
            const mimeType = getFrameMimeType(framePath);
            return {
                id: frame.id,
                timestampSeconds: frame.timestampSeconds,
                description: frame.description,
                dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`
            };
        }));
    }
}
