// Persists Phase 2 lecture registrations, leased jobs, stage states, and versioned artifacts.

import { createHash, randomUUID } from "node:crypto";
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import type {
    LectureProcessingStatus,
    processingStage,
    processingStatus
} from "../src/shared/ingestion";
import type {
    ArtifactRecord,
    artifactKind,
    LectureRecord,
    LectureSource,
    PhaseTwoState,
    ProcessingJobRecord,
    StageRecord
} from "./ingestionTypes";

const processingStages: processingStage[] = [
    "metadata",
    "transcript",
    "visuals",
    "segments",
    "embeddings"
];
const stateFileName = "registry.json";
const jobLeaseMilliseconds = 30 * 60 * 1_000;
const maximumJobAttempts = 3;

function createEmptyState(): PhaseTwoState
{
    return {
        version: 1,
        lectures: {},
        jobs: {},
        artifacts: []
    };
}

function createStageRecord(stage: processingStage, now: string): StageRecord
{
    return {
        stage,
        status: "notStarted",
        attempts: 0,
        error: null,
        updatedAt: now
    };
}

function createStageRecords(now: string): Record<processingStage, StageRecord>
{
    return {
        metadata: createStageRecord("metadata", now),
        transcript: createStageRecord("transcript", now),
        visuals: createStageRecord("visuals", now),
        segments: createStageRecord("segments", now),
        embeddings: createStageRecord("embeddings", now)
    };
}

function getJobKey(lectureId: string, pipelineVersion: number): string
{
    return `${lectureId}:pipeline:${pipelineVersion}`;
}

function getLectureKey(lectureId: string): string
{
    return createHash("sha256").update(lectureId).digest("hex").slice(0, 20);
}

function getOverallStatus(lecture: LectureRecord, job: ProcessingJobRecord | null): processingStatus
{
    const stages = processingStages.map((stage) => lecture.stages[stage]);

    if (stages.every((stage) => stage.status === "ready"))
    {
        return "ready";
    }

    if (stages.some((stage) => stage.status === "processing") || job?.status === "processing")
    {
        return "processing";
    }

    if (job?.status === "failed" && job.attempts >= job.maximumAttempts)
    {
        return "failed";
    }

    if (stages.some((stage) => stage.status === "queued") || job?.status === "queued")
    {
        return "queued";
    }

    if (stages.some((stage) => stage.status === "failed") || job?.status === "failed")
    {
        return "failed";
    }

    return "notStarted";
}

function getStatusMessage(status: processingStatus, lecture: LectureRecord): string
{
    if (status === "ready")
    {
        return "Transcript, visuals, segments, and semantic search are ready.";
    }

    if (status === "processing")
    {
        return lecture.stages.transcript.status === "ready"
            ? "Transcript tutoring is ready while remaining lecture evidence is processed."
            : "Lecture evidence is being processed. Transcript tutoring will become available first.";
    }

    if (status === "queued")
    {
        return "Lecture processing is queued.";
    }

    if (status === "failed")
    {
        return "Lecture processing stopped after a stage failed. Asking again will retry when attempts remain.";
    }

    return "Lecture is registered. Its first tutor question will start processing.";
}

export class PhaseTwoStore
{
    private readonly storageDirectory: string;
    private readonly statePath: string;
    private mutationQueue: Promise<unknown> = Promise.resolve();

    constructor(storageDirectory: string)
    {
        this.storageDirectory = storageDirectory;
        this.statePath = path.join(storageDirectory, stateFileName);
    }

    async initialize(): Promise<void>
    {
        await fileSystem.mkdir(this.storageDirectory, { recursive: true, mode: 0o700 });

        try
        {
            await fileSystem.access(this.statePath);
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            {
                throw error;
            }

            await this.writeState(createEmptyState(), "wx");
        }

        await this.recoverExpiredJobs();
    }

    async registerLecture(
        lectureId: string,
        title: string,
        source: LectureSource,
        pipelineVersion: number
    ): Promise<LectureRecord>
    {
        return this.mutate((state) =>
        {
            const existing = state.lectures[lectureId];

            if (existing !== undefined
                && existing.pipelineVersion === pipelineVersion
                && existing.source.fingerprint === source.fingerprint)
            {
                existing.title = title;
                existing.updatedAt = new Date().toISOString();
                return existing;
            }

            const now = new Date().toISOString();
            const lecture: LectureRecord = {
                lectureId,
                title,
                durationSeconds: null,
                pipelineVersion,
                source,
                stages: createStageRecords(now),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            };
            state.lectures[lectureId] = lecture;
            state.artifacts = state.artifacts.filter((artifact) => artifact.lectureId !== lectureId);

            for (const [key, job] of Object.entries(state.jobs))
            {
                if (job.lectureId === lectureId)
                {
                    delete state.jobs[key];
                }
            }

            return lecture;
        });
    }

    async getLecture(lectureId: string): Promise<LectureRecord | null>
    {
        const state = await this.readAfterMutations();
        return state.lectures[lectureId] ?? null;
    }

    async getStatus(lectureId: string): Promise<LectureProcessingStatus | null>
    {
        const state = await this.readAfterMutations();
        const lecture = state.lectures[lectureId];

        if (lecture === undefined)
        {
            return null;
        }

        const job = state.jobs[getJobKey(lectureId, lecture.pipelineVersion)] ?? null;
        const status = getOverallStatus(lecture, job);
        return {
            lectureId,
            title: lecture.title,
            status,
            stages: processingStages.map((stage) => ({
                stage,
                status: lecture.stages[stage].status,
                attempts: lecture.stages[stage].attempts,
                error: lecture.stages[stage].error
            })),
            capabilities: {
                hasTranscript: lecture.stages.transcript.status === "ready",
                hasVisuals: lecture.stages.visuals.status === "ready",
                hasSegments: lecture.stages.segments.status === "ready",
                hasSemanticSearch: lecture.stages.embeddings.status === "ready"
            },
            message: getStatusMessage(status, lecture)
        };
    }

    async ensureJob(lectureId: string): Promise<ProcessingJobRecord | null>
    {
        return this.mutate((state) =>
        {
            const lecture = state.lectures[lectureId];

            if (lecture === undefined)
            {
                return null;
            }

            const key = getJobKey(lectureId, lecture.pipelineVersion);
            const existing = state.jobs[key];

            if (existing !== undefined)
            {
                return existing;
            }

            const now = new Date().toISOString();
            const job: ProcessingJobRecord = {
                id: randomUUID(),
                idempotencyKey: key,
                lectureId,
                pipelineVersion: lecture.pipelineVersion,
                status: "queued",
                attempts: 0,
                maximumAttempts: maximumJobAttempts,
                leaseExpiresAt: null,
                error: null,
                createdAt: now,
                updatedAt: now
            };
            state.jobs[key] = job;

            for (const stage of processingStages)
            {
                if (lecture.stages[stage].status !== "ready")
                {
                    lecture.stages[stage].status = "queued";
                    lecture.stages[stage].updatedAt = now;
                }
            }

            lecture.updatedAt = now;
            return job;
        });
    }

    async claimJob(lectureId: string): Promise<ProcessingJobRecord | null>
    {
        return this.mutate((state) =>
        {
            const lecture = state.lectures[lectureId];

            if (lecture === undefined)
            {
                return null;
            }

            const key = getJobKey(lectureId, lecture.pipelineVersion);
            const job = state.jobs[key];

            if (job === undefined || job.status === "ready" || job.attempts >= job.maximumAttempts)
            {
                return null;
            }

            const leaseIsActive = job.status === "processing"
                && job.leaseExpiresAt !== null
                && Date.parse(job.leaseExpiresAt) > Date.now();

            if (leaseIsActive)
            {
                return null;
            }

            const now = new Date();
            job.status = "processing";
            job.attempts += 1;
            job.leaseExpiresAt = new Date(now.getTime() + jobLeaseMilliseconds).toISOString();
            job.error = null;
            job.updatedAt = now.toISOString();
            return job;
        });
    }

    async setStageStatus(
        lectureId: string,
        stage: processingStage,
        status: processingStatus,
        error: string | null = null
    ): Promise<void>
    {
        await this.mutate((state) =>
        {
            const lecture = state.lectures[lectureId];

            if (lecture === undefined)
            {
                throw new Error(`Lecture is not registered: ${lectureId}`);
            }

            const now = new Date().toISOString();
            const record = lecture.stages[stage];

            if (status === "processing")
            {
                record.attempts += 1;
            }

            record.status = status;
            record.error = error;
            record.updatedAt = now;
            lecture.updatedAt = now;
        });
    }

    async setLectureDuration(lectureId: string, durationSeconds: number): Promise<void>
    {
        await this.mutate((state) =>
        {
            const lecture = state.lectures[lectureId];

            if (lecture === undefined)
            {
                throw new Error(`Lecture is not registered: ${lectureId}`);
            }

            lecture.durationSeconds = durationSeconds;
            lecture.updatedAt = new Date().toISOString();
        });
    }

    async completeJob(lectureId: string): Promise<void>
    {
        await this.updateJob(lectureId, "ready", null);
    }

    async failJob(lectureId: string, error: string): Promise<void>
    {
        await this.updateJob(lectureId, "failed", error);
    }

    async writeArtifact(
        lectureId: string,
        kind: artifactKind,
        pipelineVersion: number,
        value: unknown
    ): Promise<ArtifactRecord>
    {
        const lectureKey = getLectureKey(lectureId);
        const relativePath = path.join("artifacts", lectureKey, `${kind}-v${pipelineVersion}.json`);
        const absolutePath = path.join(this.storageDirectory, relativePath);
        const serialized = `${JSON.stringify(value, null, 4)}\n`;
        const checksum = createHash("sha256").update(serialized).digest("hex");
        await fileSystem.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
        await this.writeFileAtomically(absolutePath, serialized);

        return this.mutate((state) =>
        {
            const artifact: ArtifactRecord = {
                id: `${lectureKey}:${kind}:v${pipelineVersion}`,
                lectureId,
                kind,
                relativePath,
                checksum,
                pipelineVersion,
                createdAt: new Date().toISOString()
            };
            state.artifacts = state.artifacts.filter((candidate) =>
            {
                return candidate.lectureId !== lectureId || candidate.kind !== kind;
            });
            state.artifacts.push(artifact);
            return artifact;
        });
    }

    async readArtifact<valueType>(lectureId: string, kind: artifactKind): Promise<valueType | null>
    {
        const state = await this.readAfterMutations();
        const lecture = state.lectures[lectureId];
        const artifact = state.artifacts.find((candidate) =>
        {
            return candidate.lectureId === lectureId
                && candidate.kind === kind
                && candidate.pipelineVersion === lecture?.pipelineVersion;
        });

        if (artifact === undefined)
        {
            return null;
        }

        const absolutePath = this.resolveContainedPath(artifact.relativePath);
        const serialized = await fileSystem.readFile(absolutePath, "utf8");
        const checksum = createHash("sha256").update(serialized).digest("hex");

        if (checksum !== artifact.checksum)
        {
            throw new Error(`Artifact checksum does not match: ${artifact.id}`);
        }

        return JSON.parse(serialized) as valueType;
    }

    getArtifactImagePath(lectureId: string, relativeImagePath: string): string
    {
        return this.resolveContainedPath(path.join("artifacts", getLectureKey(lectureId), relativeImagePath));
    }

    getArtifactImageDirectory(lectureId: string, pipelineVersion: number): string
    {
        return this.resolveContainedPath(path.join(
            "artifacts",
            getLectureKey(lectureId),
            `frames-v${pipelineVersion}`
        ));
    }

    getSourceDirectory(lectureId: string): string
    {
        return this.resolveContainedPath(path.join("sources", getLectureKey(lectureId)));
    }

    async removeManagedSources(lecture: LectureRecord): Promise<void>
    {
        if (!lecture.source.isManaged)
        {
            return;
        }

        await fileSystem.rm(this.getSourceDirectory(lecture.lectureId), {
            recursive: true,
            force: true
        });
    }

    private async recoverExpiredJobs(): Promise<void>
    {
        await this.mutate((state) =>
        {
            const now = new Date().toISOString();

            for (const job of Object.values(state.jobs))
            {
                if (job.status === "processing"
                    && (job.leaseExpiresAt === null || Date.parse(job.leaseExpiresAt) <= Date.now()))
                {
                    job.status = "queued";
                    job.leaseExpiresAt = null;
                    job.error = "The previous worker stopped before completing its lease.";
                    job.updatedAt = now;
                }
            }
        });
    }

    private async updateJob(
        lectureId: string,
        status: processingStatus,
        error: string | null
    ): Promise<void>
    {
        await this.mutate((state) =>
        {
            const lecture = state.lectures[lectureId];

            if (lecture === undefined)
            {
                throw new Error(`Lecture is not registered: ${lectureId}`);
            }

            const job = state.jobs[getJobKey(lectureId, lecture.pipelineVersion)];

            if (job === undefined)
            {
                throw new Error(`Processing job is missing: ${lectureId}`);
            }

            job.status = status;
            job.error = error;
            job.leaseExpiresAt = null;
            job.updatedAt = new Date().toISOString();
        });
    }

    private mutate<resultType>(callback: (state: PhaseTwoState) => resultType): Promise<resultType>
    {
        const operation = this.mutationQueue.then(async () =>
        {
            const state = await this.readState();
            const result = callback(state);
            await this.writeState(state, "w");
            return result;
        });
        this.mutationQueue = operation.catch(() => undefined);
        return operation;
    }

    private async readAfterMutations(): Promise<PhaseTwoState>
    {
        await this.mutationQueue;
        return this.readState();
    }

    private async readState(): Promise<PhaseTwoState>
    {
        const serialized = await fileSystem.readFile(this.statePath, "utf8");
        const value = JSON.parse(serialized) as PhaseTwoState;

        if (value.version !== 1)
        {
            throw new Error("Phase 2 registry version is not supported.");
        }

        return value;
    }

    private async writeState(state: PhaseTwoState, flag: "w" | "wx"): Promise<void>
    {
        const serialized = `${JSON.stringify(state, null, 4)}\n`;

        if (flag === "wx")
        {
            await fileSystem.writeFile(this.statePath, serialized, {
                encoding: "utf8",
                mode: 0o600,
                flag
            });
            return;
        }

        await this.writeFileAtomically(this.statePath, serialized);
    }

    private async writeFileAtomically(filePath: string, contents: string): Promise<void>
    {
        const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
        await fileSystem.writeFile(temporaryPath, contents, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx"
        });
        await fileSystem.rename(temporaryPath, filePath);
    }

    private resolveContainedPath(relativePath: string): string
    {
        const resolvedRoot = path.resolve(this.storageDirectory);
        const resolvedPath = path.resolve(resolvedRoot, relativePath);

        if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`))
        {
            throw new Error("Artifact paths must stay inside Phase 2 storage.");
        }

        return resolvedPath;
    }
}
