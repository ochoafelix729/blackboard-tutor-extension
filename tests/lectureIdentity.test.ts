// Verifies stable lecture identity extraction and query-secret exclusion.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectLectureIdentity, getMediaLectureIdentity } from "../src/shared/lectureIdentity";

const emptyRoot = {
    querySelector(): null
    {
        return null;
    }
} as unknown as ParentNode;

describe("lecture identity", () =>
{
    test("prefers an explicit recording query parameter", () =>
    {
        const identity = detectLectureIdentity(
            new URL("https://uark.class.com/player?recordingUuid=51C3B8AE-7C1D-5BA8-BF08-CE12E82241F1"),
            emptyRoot
        );

        assert.deepEqual(identity, {
            lectureId: "classcom:recording:51c3b8ae-7c1d-5ba8-bf08-ce12e82241f1",
            source: "recording"
        });
    });

    test("extracts a stable recording identity from the media path", () =>
    {
        const identity = getMediaLectureIdentity(new URL(
            "https://recordings.prod.class.com/artifacts/session_session-1/recording_recording-123/shared_screen.MP4?Expires=9999999999"
        ));

        assert.deepEqual(identity, {
            lectureId: "classcom:recording:recording-123",
            source: "recording"
        });
    });

    test("uses a deterministic page identity without retaining query secrets", () =>
    {
        const first = detectLectureIdentity(
            new URL("https://uark.class.com/player?token=secret-one"),
            emptyRoot
        );
        const second = detectLectureIdentity(
            new URL("https://uark.class.com/player?token=secret-two"),
            emptyRoot
        );

        assert.equal(first.lectureId, second.lectureId);
        assert.match(first.lectureId, /^classcom:page:/);
        assert.equal(first.lectureId.includes("secret"), false);
    });
});
