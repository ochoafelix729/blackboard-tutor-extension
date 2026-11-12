// Calls the local tutor API and reports connection or request failures to the sidebar.

import type { backgroundResponse, ExtensionError } from "../shared/protocol";
import type { TutorQuestion, tutorStreamEvent } from "../shared/tutor";

const tutorApiBaseUrl = "http://127.0.0.1:4387";

export class TutorApiClient
{
    registerLecture(lectureId: string, title: string, mediaUrl: string): Promise<backgroundResponse>
    {
        return this.request("/v1/lectures/auto-register", { lectureId, title, mediaUrl });
    }

    getStatus(lectureId: string): Promise<backgroundResponse>
    {
        const query = new URLSearchParams({ lectureId });
        return this.request(`/v1/lectures/status?${query.toString()}`);
    }

    async streamAnswer(question: TutorQuestion, onEvent: (event: tutorStreamEvent) => void, signal: AbortSignal): Promise<void>
    {
        try
        {
            const response = await fetch(`${tutorApiBaseUrl}/v1/questions/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(question),
                signal: AbortSignal.any([signal, AbortSignal.timeout(100_000)])
            });

            if (!response.ok || response.body === null)
            {
                throw new Error("The local tutor did not start streaming.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = "";
            let finished = false;

            while (true)
            {
                const chunk = await reader.read();
                pending += decoder.decode(chunk.value, { stream: !chunk.done });
                const lines = pending.split("\n");
                pending = lines.pop() ?? "";

                for (const line of lines)
                {
                    if (line.length > 0)
                    {
                        const event = JSON.parse(line) as tutorStreamEvent;
                        onEvent(event);
                        finished ||= event.kind === "complete" || event.kind === "error";
                    }
                }

                if (chunk.done)
                {
                    break;
                }
            }

            if (!finished)
            {
                throw new Error("The tutor response stream ended early.");
            }
        }
        catch
        {
            if (!signal.aborted)
            {
                onEvent({
                    kind: "error",
                    error: {
                        code: "tutorUnavailable",
                        message: "The tutor response was interrupted. Check that the local API is running, then try again."
                    }
                });
            }
        }
    }

    private async request(endpoint: string, body?: unknown): Promise<backgroundResponse>
    {
        try
        {
            const options: RequestInit = { signal: AbortSignal.timeout(100_000) };

            if (body !== undefined)
            {
                options.method = "POST";
                options.headers = { "Content-Type": "application/json" };
                options.body = JSON.stringify(body);
            }

            const response = await fetch(`${tutorApiBaseUrl}${endpoint}`, options);
            const data = await response.json();
            return response.ok ? { ok: true, data } : { ok: false, error: data.error as ExtensionError };
        }
        catch
        {
            return {
                ok: false,
                error: {
                    code: "tutorUnavailable",
                    message: "The local tutor API is unavailable. Start it with npm run server."
                }
            };
        }
    }
}
