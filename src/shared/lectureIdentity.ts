// Derives stable lecture identities from page and media metadata.

export type lectureIdentitySource = "recording" | "session" | "meeting" | "page";

export interface LectureIdentity
{
    lectureId: string;
    source: lectureIdentitySource;
}

interface IdentityCandidate
{
    value: string;
    source: Exclude<lectureIdentitySource, "page">;
}

const identifierNames = [
    "recordingId",
    "recordingUuid",
    "recording",
    "sessionId",
    "sessionUuid",
    "session",
    "meetingId",
    "meetingUuid",
    "meeting"
];

function normalizeIdentifier(value: string): string | null
{
    const normalized = value.trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(normalized))
    {
        return null;
    }

    return normalized;
}

function sourceForName(name: string): Exclude<lectureIdentitySource, "page">
{
    const normalized = name.toLowerCase();

    if (normalized.includes("recording"))
    {
        return "recording";
    }

    if (normalized.includes("session"))
    {
        return "session";
    }

    return "meeting";
}

function createIdentity(candidate: IdentityCandidate): LectureIdentity | null
{
    const identifier = normalizeIdentifier(candidate.value);

    if (identifier === null)
    {
        return null;
    }

    return {
        lectureId: `classcom:${candidate.source}:${identifier}`,
        source: candidate.source
    };
}

function getQueryCandidate(pageUrl: URL): IdentityCandidate | null
{
    for (const [name, value] of pageUrl.searchParams)
    {
        const expectedName = identifierNames.find((identifierName) =>
        {
            return identifierName.toLowerCase() === name.toLowerCase();
        });

        if (expectedName !== undefined)
        {
            return {
                value,
                source: sourceForName(expectedName)
            };
        }
    }

    return null;
}

function getPathCandidate(pageUrl: URL): IdentityCandidate | null
{
    const patterns: Array<{ pattern: RegExp; source: Exclude<lectureIdentitySource, "page"> }> = [
        { pattern: /(?:^|\/)recordings?[_/-]([^/?#.]+)/i, source: "recording" },
        { pattern: /(?:^|\/)sessions?[_/-]([^/?#.]+)/i, source: "session" },
        { pattern: /(?:^|\/)meetings?[_/-]([^/?#.]+)/i, source: "meeting" }
    ];

    for (const entry of patterns)
    {
        const match = pageUrl.pathname.match(entry.pattern);
        const value = match?.[1];

        if (value !== undefined)
        {
            return {
                value,
                source: entry.source
            };
        }
    }

    return null;
}

function getDomCandidate(root: ParentNode): IdentityCandidate | null
{
    for (const name of identifierNames)
    {
        const attributeName = name.replace(/[A-Z]/g, (character) =>
        {
            return `-${character.toLowerCase()}`;
        });
        const attributeElement = root.querySelector(`[data-${attributeName}]`);
        const attributeValue = attributeElement?.getAttribute(`data-${attributeName}`);

        if (attributeValue !== null && attributeValue !== undefined)
        {
            return {
                value: attributeValue,
                source: sourceForName(name)
            };
        }

        const metaElement = root.querySelector(`meta[name="${attributeName}"], meta[property="${attributeName}"]`);
        const metaValue = metaElement?.getAttribute("content");

        if (metaValue !== null && metaValue !== undefined)
        {
            return {
                value: metaValue,
                source: sourceForName(name)
            };
        }
    }

    return null;
}

function hashString(value: string): string
{
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1)
    {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function createPageIdentity(pageUrl: URL): LectureIdentity
{
    const normalizedPath = pageUrl.pathname.replace(/\/+$/, "") || "/";
    const stableLocation = `${pageUrl.origin.toLowerCase()}${normalizedPath}`;

    return {
        lectureId: `classcom:page:${hashString(stableLocation)}`,
        source: "page"
    };
}

export function detectLectureIdentity(pageUrl: URL, root: ParentNode): LectureIdentity
{
    const candidates = [
        getQueryCandidate(pageUrl),
        getPathCandidate(pageUrl),
        getDomCandidate(root)
    ];

    for (const candidate of candidates)
    {
        if (candidate !== null)
        {
            const identity = createIdentity(candidate);

            if (identity !== null)
            {
                return identity;
            }
        }
    }

    return createPageIdentity(pageUrl);
}

export function getMediaLectureIdentity(mediaUrl: URL): LectureIdentity | null
{
    const recordingMatch = mediaUrl.pathname.match(/(?:^|\/)recording_([^/?.]+)/i);

    if (recordingMatch?.[1] !== undefined)
    {
        return createIdentity({ value: recordingMatch[1], source: "recording" });
    }

    const sessionMatch = mediaUrl.pathname.match(/(?:^|\/)session_([^/?.]+)/i);

    if (sessionMatch?.[1] !== undefined)
    {
        return createIdentity({ value: sessionMatch[1], source: "session" });
    }

    return null;
}
