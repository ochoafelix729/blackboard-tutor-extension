// Parses timestamped WebVTT cues into normalized lecture transcript segments.

export interface TranscriptSegment
{
    id: string;
    startSeconds: number;
    endSeconds: number;
    text: string;
}

function parseTimestamp(value: string): number | null
{
    const parts = value.trim().replace(",", ".").split(":");

    if (parts.length < 2 || parts.length > 3)
    {
        return null;
    }

    const seconds = Number(parts.at(-1));
    const minutes = Number(parts.at(-2));
    const hours = parts.length === 3 ? Number(parts[0]) : 0;

    if (![seconds, minutes, hours].every(Number.isFinite))
    {
        return null;
    }

    return hours * 3_600 + minutes * 60 + seconds;
}

function normalizeCueText(lines: string[]): string
{
    return lines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

export function parseWebVtt(source: string): TranscriptSegment[]
{
    const normalizedSource = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const blocks = normalizedSource.split(/\n{2,}/);
    const segments: TranscriptSegment[] = [];

    for (const block of blocks)
    {
        const lines = block.split("\n").map((line) => line.trim());
        const timingIndex = lines.findIndex((line) => line.includes("-->"));

        if (timingIndex < 0)
        {
            continue;
        }

        const timingParts = lines[timingIndex]?.split("-->");

        if (timingParts === undefined || timingParts.length !== 2)
        {
            continue;
        }

        const startSeconds = parseTimestamp(timingParts[0] ?? "");
        const endValue = (timingParts[1] ?? "").trim().split(/\s+/)[0] ?? "";
        const endSeconds = parseTimestamp(endValue);
        const text = normalizeCueText(lines.slice(timingIndex + 1));

        if (startSeconds === null || endSeconds === null || endSeconds < startSeconds || text.length === 0)
        {
            continue;
        }

        const suppliedId = timingIndex > 0 ? lines[timingIndex - 1] : undefined;
        segments.push({
            id: suppliedId !== undefined && suppliedId.length > 0
                ? `transcript-${suppliedId}`
                : `transcript-${String(segments.length + 1).padStart(5, "0")}`,
            startSeconds,
            endSeconds,
            text
        });
    }

    return segments;
}
