// Builds the configured model provider behind the shared provider interface.

import type { ServerConfig } from "./config";
import type { ModelProvider } from "./ModelProvider";
import { OpenAiProvider } from "./OpenAiProvider";

export function createModelProvider(config: ServerConfig): ModelProvider
{
    switch (config.provider)
    {
        case "openai":
        {
            return new OpenAiProvider({
                apiKey: config.openAiApiKey,
                baseUrl: config.openAiBaseUrl
            });
        }
        default:
        {
            throw new Error(`Unsupported TUTOR_PROVIDER: ${config.provider}`);
        }
    }
}
