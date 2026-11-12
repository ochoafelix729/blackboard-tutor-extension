// Calls the local tutor API and reports connection or request failures to the sidebar.

import type { backgroundResponse, ExtensionError } from "../shared/protocol";
import type { TutorQuestion } from "../shared/tutor";

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

    ask(question: TutorQuestion): Promise<backgroundResponse>
    {
        return this.request("/v1/questions", question);
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
