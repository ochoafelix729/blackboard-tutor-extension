// Stores lecture progress and evidence files in one local folder per recording.

import { promises as fileSystem } from "node:fs";
import path from "node:path";
import {
    processingStages,
    type LectureProcessingStatus,
    type processingStage,
    type processingStatus,
    type TranscriptProgress
} from "../src/shared/ingestion";
import type { LectureRecord } from "./ingestionTypes";

export class LectureStore
{
    private lectures: Record<string, LectureRecord> = {};
    private readonly registryPath: string;

    constructor(private readonly directory: string)
    {
        this.registryPath = path.join(directory, "registry.json");
    }

    async initialize(): Promise<void>
    {
        await fileSystem.mkdir(this.directory, { recursive: true });

        try
        {
            this.lectures = JSON.parse(await fileSystem.readFile(this.registryPath, "utf8")).lectures;
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            {
                throw error;
            }
        }

        for (const lecture of Object.values(this.lectures))
        {
            for (const stage of Object.values(lecture.stages))
            {
                if (stage.status === "processing")
                {
                    delete stage.startedAt;
                    stage.status = "notStarted";
                }
            }
        }

        await this.save();
    }

    getLecture(lectureId: string): LectureRecord | null
    {
        return this.lectures[lectureId] ?? null;
    }

    async registerLecture(
        lectureId: string,
        title: string,
        acquisitionDurationMilliseconds: number
    ): Promise<LectureRecord>
    {
        const stages = Object.fromEntries(processingStages.map((stage) =>
        {
            return [stage, { status: "notStarted", error: null }];
        })) as LectureRecord["stages"];
        const lecture: LectureRecord = {
            lectureId,
            title,
            durationSeconds: null,
            stages,
            acquisitionDurationMilliseconds
        };
        this.lectures[lectureId] = lecture;
        await fileSystem.mkdir(this.getLectureDirectory(lectureId), { recursive: true });
        await this.save();
        return lecture;
    }

    getStatus(lectureId: string): LectureProcessingStatus | null
    {
        const lecture = this.getLecture(lectureId);

        if (lecture === null)
        {
            return null;
        }

        const stages = processingStages.map((stage) =>
        {
            const record = lecture.stages[stage];
            return {
                stage,
                ...record,
                ...(record.startedAt === undefined ? {} : {
                    durationMilliseconds: (record.durationMilliseconds ?? 0) + Date.now() - record.startedAt
                })
            };
        });
        let status: processingStatus = "notStarted";

        if (stages.every((stage) => stage.status === "ready"))
        {
            status = "ready";
        }
        else if (stages.some((stage) => stage.status === "processing"))
        {
            status = "processing";
        }
        else if (stages.some((stage) => stage.status === "failed"))
        {
            status = "failed";
        }

        const messages = {
            ready: "Lecture evidence is ready.",
            processing: lecture.stages.transcript.status === "processing"
                ? "Transcribing lecture audio. Completed portions become available as processing continues."
                : lecture.stages.transcript.status === "ready"
                    ? "Transcript ready. Preparing the remaining lecture evidence."
                    : "Preparing lecture evidence.",
            failed: "Lecture processing failed. Ask again to retry the unfinished stages.",
            notStarted: "Lecture preparation will start when authorized media is detected."
        };
        return {
            lectureId,
            title: lecture.title,
            status,
            stages,
            capabilities: {
                hasTranscript: lecture.stages.transcript.status === "ready"
                    || (lecture.transcriptProgress?.segmentCount ?? 0) > 0,
                hasVisuals: lecture.stages.visuals.status === "ready",
                hasSegments: lecture.stages.segments.status === "ready",
                hasSemanticSearch: lecture.stages.embeddings.status === "ready"
            },
            message: messages[status],
            ...(lecture.transcriptProgress === undefined ? {} : { transcriptProgress: lecture.transcriptProgress }),
            ...(lecture.acquisitionDurationMilliseconds === undefined ? {} : {
                acquisitionDurationMilliseconds: lecture.acquisitionDurationMilliseconds
            })
        };
    }

    async setStageStatus(
        lecture: LectureRecord,
        stage: processingStage,
        status: processingStatus,
        error: string | null = null
    ): Promise<void>
    {
        const previous = lecture.stages[stage];
        const durationMilliseconds = (previous.durationMilliseconds ?? 0)
            + (previous.startedAt === undefined ? 0 : Date.now() - previous.startedAt);
        lecture.stages[stage] = {
            status,
            error,
            durationMilliseconds,
            ...(status === "processing" ? { startedAt: Date.now() } : {})
        };
        await this.save();
    }

    async setTranscriptProgress(lecture: LectureRecord, progress: TranscriptProgress): Promise<void>
    {
        const transcript = lecture.stages.transcript;

        if (transcript.startedAt !== undefined)
        {
            const now = Date.now();
            transcript.durationMilliseconds = (transcript.durationMilliseconds ?? 0) + now - transcript.startedAt;
            transcript.startedAt = now;
        }

        lecture.transcriptProgress = progress;
        await this.save();
    }

    async setLectureDuration(lecture: LectureRecord, durationSeconds: number): Promise<void>
    {
        lecture.durationSeconds = durationSeconds;
        await this.save();
    }

    async writeArtifact(lectureId: string, kind: processingStage, value: unknown): Promise<void>
    {
        const artifactPath = path.join(this.getLectureDirectory(lectureId), `${kind}.json`);
        await fileSystem.writeFile(`${artifactPath}.tmp`, JSON.stringify(value));
        await fileSystem.rename(`${artifactPath}.tmp`, artifactPath);
    }

    async readArtifact<valueType>(lectureId: string, kind: processingStage): Promise<valueType | null>
    {
        try
        {
            const content = await fileSystem.readFile(path.join(this.getLectureDirectory(lectureId), `${kind}.json`), "utf8");
            return JSON.parse(content) as valueType;
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
            {
                return null;
            }

            throw error;
        }
    }

    getLectureDirectory(lectureId: string): string
    {
        return path.join(this.directory, lectureId.replace("classcom:recording:", ""));
    }

    getRecordingPath(lectureId: string): string
    {
        return path.join(this.getLectureDirectory(lectureId), "recording.mp4");
    }

    getFramesDirectory(lectureId: string): string
    {
        return path.join(this.getLectureDirectory(lectureId), "frames");
    }

    getFramePath(lectureId: string, relativePath: string): string
    {
        return path.join(this.getLectureDirectory(lectureId), relativePath);
    }

    removeSourceMedia(lectureId: string): Promise<void>
    {
        return fileSystem.rm(this.getRecordingPath(lectureId), { force: true });
    }

    private async save(): Promise<void>
    {
        await fileSystem.writeFile(`${this.registryPath}.tmp`, JSON.stringify({ lectures: this.lectures }, null, 4));
        await fileSystem.rename(`${this.registryPath}.tmp`, this.registryPath);
    }
}
