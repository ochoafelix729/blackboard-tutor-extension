// Calculates bounded sidebar widths while preserving lecture-player space.

export type sidebarWidthLimits =
{
    minimum: number;
    maximum: number;
};

const preferredSidebarWidth = 380;
const minimumSidebarWidth = 320;
const maximumSidebarWidth = 640;
const maximumViewportRatio = 0.55;

export function getSidebarWidthLimits(viewportWidth: number): sidebarWidthLimits
{
    const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
    const maximum = Math.min(
        maximumSidebarWidth,
        Math.floor(safeViewportWidth * maximumViewportRatio)
    );

    return {
        minimum: Math.min(minimumSidebarWidth, maximum),
        maximum
    };
}

export function clampSidebarWidth(requestedWidth: number, viewportWidth: number): number
{
    const limits = getSidebarWidthLimits(viewportWidth);
    const safeRequestedWidth = Number.isFinite(requestedWidth) ? requestedWidth : preferredSidebarWidth;
    return Math.min(limits.maximum, Math.max(limits.minimum, safeRequestedWidth));
}

export function getDefaultSidebarWidth(viewportWidth: number): number
{
    return clampSidebarWidth(preferredSidebarWidth, viewportWidth);
}
