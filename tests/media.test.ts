// Verifies supported media parsing, expiry handling, and asset selection.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isMediaExpired, parseObservedMedia, selectPreferredMedia } from "../src/shared/media";

const futureExpiry = 2_000_000_000;

describe("observed media", () =>
{
    test("accepts a supported signed Class.com MP4 without exposing query data in its asset key", () =>
    {
        const media = parseObservedMedia(
            `https://recordings.prod.class.com/artifacts/recording_recording-123/shared_screen.MP4?Expires=${futureExpiry}&Signature=secret`,
            100,
            "document-1"
        );

        assert.notEqual(media, null);
        assert.equal(media?.lectureId, "classcom:recording:recording-123");
        assert.equal(media?.kind, "sharedScreen");
        assert.equal(media?.assetKey.includes("Signature"), false);
        assert.equal(media?.expiresAt, futureExpiry * 1000);
    });

    test("rejects unsupported hosts and non-MP4 assets", () =>
    {
        assert.equal(parseObservedMedia(
            "https://example.com/recording_recording-123/shared_screen.MP4",
            100,
            null
        ), null);
        assert.equal(parseObservedMedia(
            "https://recordings.prod.class.com/recording_recording-123/playlist.m3u8",
            100,
            null
        ), null);
    });

    test("treats links near expiry as expired", () =>
    {
        const now = 1_900_000_000_000;
        const media = parseObservedMedia(
            `https://recordings.prod.class.com/recording_recording-123/shared_screen.MP4?Expires=${Math.floor((now + 20_000) / 1000)}`,
            now,
            null
        );

        assert.notEqual(media, null);
        assert.equal(media === null ? false : isMediaExpired(media, now), true);
    });

    test("prefers a shared-screen asset over a newer speaker asset", () =>
    {
        const sharedScreen = parseObservedMedia(
            `https://recordings.prod.class.com/recording_recording-123/shared_screen.MP4?Expires=${futureExpiry}`,
            100,
            null
        );
        const speaker = parseObservedMedia(
            `https://recordings.prod.class.com/recording_recording-123/active_speaker.MP4?Expires=${futureExpiry}`,
            200,
            null
        );

        assert.notEqual(sharedScreen, null);
        assert.notEqual(speaker, null);

        if (sharedScreen !== null && speaker !== null)
        {
            assert.equal(
                selectPreferredMedia([speaker, sharedScreen], sharedScreen.lectureId, 100)?.kind,
                "sharedScreen"
            );
        }
    });
});
