// Runs the local Phase 2 ingestion and tutor API without exposing provider credentials to the extension.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isTutorQuestion } from "../src/shared/tutor";
import { AutoRegistrationService, type AutoRegistrationRequest } from "./AutoRegistrationService";
import { loadServerConfig } from "./config";
import { CostLedger } from "./CostLedger";
import { EvidenceRepository } from "./EvidenceRepository";
import { IngestionCoordinator } from "./IngestionCoordinator";
import { IngestionPipeline } from "./IngestionPipeline";
import { PhaseTwoStore } from "./PhaseTwoStore";
import { createModelProvider } from "./providerFactory";
import { TutorService } from "./TutorService";
import { TutorServiceError } from "./TutorServiceError";

const maximumRequestBytes = 9_000_000;
const config = loadServerConfig();
const costLedger = new CostLedger(config.costLedgerPath);
const store = new PhaseTwoStore(config.storageDirectory);
const provider = createModelProvider(config);
const ingestionCoordinator = new IngestionCoordinator(
    store,
    new IngestionPipeline(store, provider, config.embeddingModel, config.transcriptionModel)
);
const autoRegistrationService = new AutoRegistrationService(
    store,
    ingestionCoordinator,
    config.maximumMediaBytes
);
const tutorService = new TutorService(
    config,
    new EvidenceRepository(store, provider, config.embeddingModel),
    autoRegistrationService,
    ingestionCoordinator,
    store,
    provider,
    costLedger
);

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void
{
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

function isAutoRegistrationRequest(value: unknown): value is AutoRegistrationRequest
{
    return isRecord(value)
        && typeof value.lectureId === "string"
        && value.lectureId.length > 0
        && typeof value.title === "string"
        && typeof value.mediaUrl === "string";
}

async function readJson(request: IncomingMessage): Promise<unknown>
{
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of request)
    {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;

        if (totalBytes > maximumRequestBytes)
        {
            throw new TutorServiceError("invalidRequest", "The tutor request is too large.");
        }

        chunks.push(buffer);
    }

    try
    {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch
    {
        throw new TutorServiceError("invalidRequest", "The tutor request body must be valid JSON.");
    }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void>
{
    const requestUrl = new URL(request.url ?? "/", `http://${config.host}:${config.port}`);

    if (request.method === "GET" && requestUrl.pathname === "/health")
    {
        writeJson(response, 200, {
            ok: true,
            provider: config.provider,
            textModel: config.textModel,
            visionModel: config.visionModel
        });
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/costs")
    {
        const lectureId = requestUrl.searchParams.get("lectureId");
        writeJson(response, 200, await costLedger.summarize(lectureId));
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/lectures/status")
    {
        const lectureId = requestUrl.searchParams.get("lectureId");

        if (lectureId === null || lectureId.length === 0)
        {
            throw new TutorServiceError("invalidRequest", "A lectureId query parameter is required.");
        }

        const status = await autoRegistrationService.getStatus(lectureId);

        if (status === null)
        {
            throw new TutorServiceError("evidenceUnavailable", "This lecture is not registered for Phase 2.");
        }

        writeJson(response, 200, status);
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/lectures/auto-register")
    {
        if (request.headers["x-blackboard-tutor"] !== "1")
        {
            writeJson(response, 403, {
                error: {
                    code: "invalidRequest",
                    message: "The registration request did not come from the extension client."
                }
            });
            return;
        }

        const body = await readJson(request);

        if (!isAutoRegistrationRequest(body))
        {
            throw new TutorServiceError("invalidRequest", "The automatic lecture registration request is invalid.");
        }

        try
        {
            writeJson(response, 202, await autoRegistrationService.begin(body));
        }
        catch
        {
            throw new TutorServiceError(
                "invalidRequest",
                "Automatic processing requires an authorized Class.com MP4 observed by the extension."
            );
        }
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/questions")
    {
        if (request.headers["x-blackboard-tutor"] !== "1")
        {
            writeJson(response, 403, {
                error: {
                    code: "invalidRequest",
                    message: "The tutor request did not come from the extension client."
                }
            });
            return;
        }

        const body = await readJson(request);

        if (!isTutorQuestion(body))
        {
            throw new TutorServiceError("invalidRequest", "The tutor question is incomplete or invalid.");
        }

        writeJson(response, 200, await tutorService.answer(body));
        return;
    }

    writeJson(response, 404, {
        error: {
            code: "notFound",
            message: "The requested tutor endpoint does not exist."
        }
    });
}

const server = createServer((request, response) =>
{
    void handleRequest(request, response).catch((error: unknown) =>
    {
        if (error instanceof TutorServiceError)
        {
            const statusCode = error.code === "invalidRequest"
                ? 400
                : error.code === "questionOutOfScope"
                    ? 422
                : error.code === "lectureProcessing"
                    ? 409
                : error.code === "evidenceUnavailable"
                    ? 404
                    : 502;
            writeJson(response, statusCode, {
                error: {
                    code: error.code,
                    message: error.message
                }
            });
            return;
        }

        console.error("Tutor request failed", {
            errorName: error instanceof Error ? error.name : "unknown"
        });
        writeJson(response, 500, {
            error: {
                code: "unexpectedError",
                message: "The local tutor API encountered an unexpected error."
            }
        });
    });
});

async function startServer(): Promise<void>
{
    await store.initialize();
    await new Promise<void>((resolve, reject) =>
    {
        const handleError = (error: Error): void =>
        {
            server.off("listening", handleListening);
            reject(error);
        };
        const handleListening = (): void =>
        {
            server.off("error", handleError);
            console.log("Phase 2 tutor API ready", {
                url: `http://${config.host}:${config.port}`,
                provider: config.provider,
                textModel: config.textModel,
                visionModel: config.visionModel,
                storageDirectory: config.storageDirectory,
                costLedgerPath: config.costLedgerPath
            });
            resolve();
        };
        server.once("error", handleError);
        server.once("listening", handleListening);
        server.listen(config.port, config.host);
    });
}

void startServer().catch((error: unknown) =>
{
    console.error("Phase 2 tutor API could not start", {
        errorName: error instanceof Error ? error.name : "unknown"
    });
    process.exitCode = 1;
});
