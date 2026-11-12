// Runs the loopback API for the local extension and its single ingestion pipeline.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TutorQuestion } from "../src/shared/tutor";
import { AutoRegistrationService, type AutoRegistrationRequest } from "./AutoRegistrationService";
import { loadServerConfig } from "./config";
import { EvidenceRepository } from "./EvidenceRepository";
import { IngestionPipeline } from "./IngestionPipeline";
import { LectureStore } from "./LectureStore";
import { OpenAiProvider } from "./OpenAiProvider";
import { TutorService } from "./TutorService";
import { TutorServiceError } from "./TutorServiceError";

const config = loadServerConfig();
const store = new LectureStore(config.storageDirectory);
const provider = new OpenAiProvider({ apiKey: config.openAiApiKey, baseUrl: config.openAiBaseUrl });
const registration = new AutoRegistrationService(
    store,
    new IngestionPipeline(store, provider, config.embeddingModel, config.transcriptionModel)
);
const tutor = new TutorService(
    config,
    new EvidenceRepository(store, provider, config.embeddingModel),
    registration,
    provider
);

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void
{
    response.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}

async function readJson<bodyType>(request: IncomingMessage): Promise<bodyType>
{
    const chunks: Buffer[] = [];

    for await (const chunk of request)
    {
        chunks.push(Buffer.from(chunk));
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as bodyType;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void>
{
    const url = new URL(request.url ?? "/", `http://${config.host}:${config.port}`);

    if (request.method === "GET" && url.pathname === "/health")
    {
        writeJson(response, 200, { ok: true, model: config.model });
    }
    else if (request.method === "GET" && url.pathname === "/v1/lectures/status")
    {
        const status = registration.getStatus(url.searchParams.get("lectureId") ?? "");

        if (status === null)
        {
            throw new TutorServiceError("evidenceUnavailable", "Waiting for the recording page to prepare this lecture.");
        }

        writeJson(response, 200, status);
    }
    else if (request.method === "POST" && url.pathname === "/v1/lectures/auto-register")
    {
        writeJson(response, 202, await registration.begin(await readJson<AutoRegistrationRequest>(request)));
    }
    else if (request.method === "POST" && url.pathname === "/v1/questions")
    {
        writeJson(response, 200, await tutor.answer(await readJson<TutorQuestion>(request)));
    }
    else
    {
        writeJson(response, 404, { error: { code: "notFound", message: "Unknown tutor endpoint." } });
    }
}

const server = createServer((request, response) =>
{
    void handleRequest(request, response).catch((error: unknown) =>
    {
        if (error instanceof TutorServiceError)
        {
            const statusCode = error.code === "lectureProcessing" ? 409
                : error.code === "evidenceUnavailable" ? 404
                    : error.code === "questionOutOfScope" ? 422 : 502;
            writeJson(response, statusCode, { error: { code: error.code, message: error.message } });
        }
        else
        {
            console.error("Local tutor request failed", { errorName: error instanceof Error ? error.name : "unknown" });
            writeJson(response, 500, { error: { code: "unexpectedError", message: "The local tutor API encountered an error." } });
        }
    });
});

async function start(): Promise<void>
{
    await store.initialize();
    server.on("error", (error) =>
    {
        console.error("Local tutor API could not listen", { errorName: error.name });
        process.exitCode = 1;
    });
    server.listen(config.port, config.host, () =>
    {
        console.log(`Local tutor API ready at http://${config.host}:${config.port}`);
    });
}

void start().catch((error: unknown) =>
{
    console.error("Local tutor API could not start", { errorName: error instanceof Error ? error.name : "unknown" });
    process.exitCode = 1;
});
