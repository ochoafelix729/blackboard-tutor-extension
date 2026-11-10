// Starts idempotent lecture ingestion jobs, prevents duplicate workers, and retries failed attempts.

import { IngestionPipeline } from "./IngestionPipeline";
import { PhaseTwoStore } from "./PhaseTwoStore";

function wait(milliseconds: number): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, milliseconds);
    });
}

export class IngestionCoordinator
{
    private readonly store: PhaseTwoStore;
    private readonly pipeline: IngestionPipeline;
    private readonly activeJobs = new Map<string, Promise<void>>();

    constructor(store: PhaseTwoStore, pipeline: IngestionPipeline)
    {
        this.store = store;
        this.pipeline = pipeline;
    }

    async ensureProcessing(lectureId: string): Promise<boolean>
    {
        const lecture = await this.store.getLecture(lectureId);

        if (lecture === null)
        {
            return false;
        }

        const status = await this.store.getStatus(lectureId);

        if (status?.status === "ready")
        {
            return true;
        }

        await this.store.ensureJob(lectureId);

        if (!this.activeJobs.has(lectureId))
        {
            const operation = this.runWithRetries(lectureId).finally(() =>
            {
                this.activeJobs.delete(lectureId);
            });
            this.activeJobs.set(lectureId, operation);
        }

        return true;
    }

    private async runWithRetries(lectureId: string): Promise<void>
    {
        while (true)
        {
            const job = await this.store.claimJob(lectureId);

            if (job === null)
            {
                return;
            }

            try
            {
                await this.pipeline.process(lectureId);
                await this.store.completeJob(lectureId);
                return;
            }
            catch (error)
            {
                const message = error instanceof Error ? error.message : "Lecture ingestion failed.";
                await this.store.failJob(lectureId, message);

                if (job.attempts >= job.maximumAttempts)
                {
                    return;
                }

                await wait(500 * (2 ** (job.attempts - 1)));
            }
        }
    }
}
