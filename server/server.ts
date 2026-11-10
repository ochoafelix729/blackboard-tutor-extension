// Runs the local Phase 1 tutor HTTP API without exposing provider credentials to the extension.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isTutorQuestion } from "../src/shared/tutor";
import { loadServerConfig } from "./config";
import { CostLedger } from "./CostLedger";
import { EvidenceRepository } from "./EvidenceRepository";
import { createModelProvider } from "./providerFactory";
import { TutorService } from "./TutorService";
import { TutorServiceError } from "./TutorServiceError";

const maximumRequestBytes = 9_000_000;
const config = loadServerConfig();
const costLedger = new CostLedger(config.costLedgerPath);
const tutorService = new TutorService(
    config,
    new EvidenceRepository(config.evidenceDirectory),
    createModelProvider(config),
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

server.listen(config.port, config.host, () =>
{
    console.log("Phase 1 tutor API ready", {
        url: `http://${config.host}:${config.port}`,
        provider: config.provider,
        textModel: config.textModel,
        visionModel: config.visionModel,
        evidenceDirectory: config.evidenceDirectory,
        costLedgerPath: config.costLedgerPath
    });
});
