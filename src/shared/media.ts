// Parses, classifies, and selects authorized Class.com recording assets.

import { getMediaLectureIdentity } from "./lectureIdentity";
import type { mediaKind } from "./protocol";

export interface ObservedMedia
{
    assetKey: string;
    lectureId: string;
    url: string;
    kind: mediaKind;
    label: string;
    expiresAt: number | null;
    observedAt: number;
    documentId: string | null;
}

const expirySafetyWindowMilliseconds = 30_000;

export function isClassHost(hostname: string): boolean
{
    const normalized = hostname.toLowerCase();
    return normalized === "class.com" || normalized.endsWith(".class.com");
}

function getQueryValue(searchParams: URLSearchParams, expectedName: string): string | null
{
    for (const [name, value] of searchParams)
    {
        if (name.toLowerCase() === expectedName.toLowerCase())
        {
            return value;
        }
    }

    return null;
}

export function getSignedUrlExpiry(mediaUrl: URL): number | null
{
    const cloudFrontExpiry = getQueryValue(mediaUrl.searchParams, "Expires");

    if (cloudFrontExpiry !== null)
    {
        const seconds = Number(cloudFrontExpiry);

        if (Number.isFinite(seconds) && seconds > 0)
        {
            return seconds * 1000;
        }
    }

    const amazonDate = getQueryValue(mediaUrl.searchParams, "X-Amz-Date");
    const amazonLifetime = getQueryValue(mediaUrl.searchParams, "X-Amz-Expires");

    if (amazonDate !== null && amazonLifetime !== null && /^\d{8}T\d{6}Z$/.test(amazonDate))
    {
        const issuedAt = Date.parse(amazonDate.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
            "$1-$2-$3T$4:$5:$6Z"
        ));
        const lifetimeSeconds = Number(amazonLifetime);

        if (Number.isFinite(issuedAt) && Number.isFinite(lifetimeSeconds))
        {
            return issuedAt + lifetimeSeconds * 1000;
        }
    }

    return null;
}

function getMediaKind(pathname: string): mediaKind
{
    const filename = pathname.split("/").pop()?.toLowerCase() ?? "";

    if (filename.includes("shared_screen") || filename.includes("shared-screen"))
    {
        return "sharedScreen";
    }

    if (filename.includes("active_speaker") || filename.includes("speaker"))
    {
        return "speaker";
    }

    if (filename.includes("gallery"))
    {
        return "gallery";
    }

    return "recording";
}

function getMediaLabel(kind: mediaKind): string
{
    switch (kind)
    {
        case "sharedScreen":
        {
            return "Shared screen recording";
        }
        case "speaker":
        {
            return "Speaker recording";
        }
        case "gallery":
        {
            return "Gallery recording";
        }
        case "recording":
        {
            return "Lecture recording";
        }
    }
}

export function parseObservedMedia(
    urlValue: string,
    observedAt: number,
    documentId: string | null
): ObservedMedia | null
{
    let mediaUrl: URL;

    try
    {
        mediaUrl = new URL(urlValue);
    }
    catch
    {
        return null;
    }

    if (mediaUrl.protocol !== "https:" || !isClassHost(mediaUrl.hostname) || !/\.mp4$/i.test(mediaUrl.pathname))
    {
        return null;
    }

    const identity = getMediaLectureIdentity(mediaUrl);

    if (identity === null)
    {
        return null;
    }

    const kind = getMediaKind(mediaUrl.pathname);

    return {
        assetKey: `${mediaUrl.origin}${mediaUrl.pathname}`,
        lectureId: identity.lectureId,
        url: mediaUrl.href,
        kind,
        label: getMediaLabel(kind),
        expiresAt: getSignedUrlExpiry(mediaUrl),
        observedAt,
        documentId
    };
}

export function isMediaExpired(media: ObservedMedia, now: number = Date.now()): boolean
{
    return media.expiresAt !== null && media.expiresAt <= now + expirySafetyWindowMilliseconds;
}

function getKindPriority(kind: mediaKind): number
{
    switch (kind)
    {
        case "sharedScreen":
        {
            return 4;
        }
        case "recording":
        {
            return 3;
        }
        case "speaker":
        {
            return 2;
        }
        case "gallery":
        {
            return 1;
        }
    }
}

export function selectPreferredMedia(
    mediaCandidates: ObservedMedia[],
    lectureId: string | null,
    now: number = Date.now()
): ObservedMedia | null
{
    // Prefer shared-screen video, then fall back by media kind and observation recency.
    return mediaCandidates
        .filter((candidate) =>
        {
            return (lectureId === null || candidate.lectureId === lectureId) && !isMediaExpired(candidate, now);
        })
        .sort((first, second) =>
        {
            const priorityDifference = getKindPriority(second.kind) - getKindPriority(first.kind);

            if (priorityDifference !== 0)
            {
                return priorityDifference;
            }

            return second.observedAt - first.observedAt;
        })[0] ?? null;
}
