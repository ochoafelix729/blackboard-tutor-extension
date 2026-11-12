// Extracts a growing answer string from the model's structured JSON output.

export function getStreamedAnswerText(json: string): string | null
{
    // Structured Outputs emits properties in schema order, with answer first.
    const match = /^\s*\{\s*"answer"\s*:\s*"/.exec(json);

    if (match === null)
    {
        return null;
    }

    const start = match[0].length;
    let end = start;

    while (end < json.length)
    {
        const character = json[end];

        if (character === '"')
        {
            break;
        }

        if (character === "\\")
        {
            if (end + 1 >= json.length)
            {
                break;
            }

            if (json[end + 1] === "u")
            {
                if (end + 6 > json.length)
                {
                    break;
                }
                end += 6;
                continue;
            }

            end += 2;
            continue;
        }

        end++;
    }

    try
    {
        return JSON.parse(`"${json.slice(start, end)}"`) as string;
    }
    catch
    {
        return null;
    }
}
