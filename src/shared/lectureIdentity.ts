// Extracts stable recording IDs from UARK player URLs and Class recording asset paths.

export function getPageLectureId(pageUrl: URL): string | null
{
    const recordingId = pageUrl.pathname.match(/^\/player\/recording\/[^/]+\/([^/]+)\/?$/)?.[1];
    return recordingId === undefined ? null : `classcom:recording:${recordingId.toLowerCase()}`;
}

export function getMediaLectureId(mediaUrl: URL): string | null
{
    const recordingId = mediaUrl.pathname.match(/\/recording_([^/]+)\//)?.[1];
    return recordingId === undefined ? null : `classcom:recording:${recordingId.toLowerCase()}`;
}
