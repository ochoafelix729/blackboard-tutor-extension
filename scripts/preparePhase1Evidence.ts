// Prepares a private Phase 1 manifest from an ASR WebVTT transcript and authorized lecture video.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fileSystem } from "node:fs";
import path from "node:path";

interface PreparationOptions
{
    lectureId: string;
    title: string;
    transcriptPath: string;
    videoPath: string;
    outputDirectory: string;
}

function getArgument(name: string): string | null
{
    const index = process.argv.indexOf(name);

    if (index < 0)
    {
        return null;
    }

    return process.argv[index + 1] ?? null;
}

function readOptions(): PreparationOptions
{
    const lectureId = getArgument("--lecture-id");
    const title = getArgument("--title");
    const transcriptPath = getArgument("--transcript");
    const videoPath = getArgument("--video");

    if (lectureId === null || title === null || transcriptPath === null || videoPath === null)
    {
        throw new Error([
            "Required arguments are missing.",
            "Usage: npm run phase1:prepare -- --lecture-id <id> --title <title>",
            "  --transcript <asr.vtt> --video <authorized.mp4>"
        ].join(" "));
    }

    return {
        lectureId,
        title,
        transcriptPath: path.resolve(transcriptPath),
        videoPath: path.resolve(videoPath),
        outputDirectory: path.resolve(getArgument("--output") ?? "phase1-data")
    };
}

async function ensureInputFile(filePath: string, label: string): Promise<void>
{
    const statistics = await fileSystem.stat(filePath);

    if (!statistics.isFile())
    {
        throw new Error(`${label} must be a file: ${filePath}`);
    }
}

function runFfmpeg(videoPath: string, framePattern: string): Promise<number[]>
{
    return new Promise((resolve, reject) =>
    {
        const filter = "select=eq(n\\,0)+gt(scene\\,0.18),scale=min(1600\\,iw):-2,showinfo";
        const child = spawn("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "info",
            "-i",
            videoPath,
            "-vf",
            filter,
            "-fps_mode",
            "vfr",
            "-frames:v",
            "120",
            "-q:v",
            "3",
            framePattern
        ], {
            stdio: ["ignore", "ignore", "pipe"]
        });
        let diagnosticOutput = "";

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) =>
        {
            diagnosticOutput += chunk;

            if (diagnosticOutput.length > 10_000_000)
            {
                diagnosticOutput = diagnosticOutput.slice(-10_000_000);
            }
        });
        child.on("error", (error) =>
        {
            reject(new Error(`Could not start ffmpeg: ${error.message}`));
        });
        child.on("close", (code) =>
        {
            if (code !== 0)
            {
                reject(new Error("ffmpeg could not extract representative lecture frames."));
                return;
            }

            const timestamps = Array.from(
                diagnosticOutput.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g),
                (match) => Number(match[1])
            ).filter(Number.isFinite);
            resolve(timestamps);
        });
    });
}

async function prepareEvidence(options: PreparationOptions): Promise<void>
{
    await ensureInputFile(options.transcriptPath, "Transcript");
    await ensureInputFile(options.videoPath, "Video");

    if (path.extname(options.transcriptPath).toLowerCase() !== ".vtt")
    {
        throw new Error("The ASR transcript must be a WebVTT (.vtt) file.");
    }

    const lectureKey = createHash("sha256").update(options.lectureId).digest("hex").slice(0, 16);
    const lectureDirectory = path.join(options.outputDirectory, lectureKey);
    const frameDirectory = path.join(lectureDirectory, "frames");
    const manifestPath = path.join(options.outputDirectory, `${lectureKey}.json`);

    try
    {
        await fileSystem.access(manifestPath);
        throw new Error(`Evidence already exists at ${manifestPath}. Remove it explicitly before rebuilding.`);
    }
    catch (error)
    {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        {
            throw error;
        }
    }

    await fileSystem.mkdir(frameDirectory, { recursive: true, mode: 0o700 });
    await fileSystem.copyFile(options.transcriptPath, path.join(lectureDirectory, "transcript.vtt"));
    const timestamps = await runFfmpeg(options.videoPath, path.join(frameDirectory, "frame-%05d.jpg"));
    const frameFiles = (await fileSystem.readdir(frameDirectory))
        .filter((name) => /^frame-\d+\.jpg$/i.test(name))
        .sort();

    if (frameFiles.length === 0)
    {
        throw new Error("No representative frames were extracted from the lecture video.");
    }

    const frames = frameFiles.map((name, index) =>
    {
        return {
            id: `frame-${String(index + 1).padStart(5, "0")}`,
            timestampSeconds: timestamps[index] ?? 0,
            path: `${lectureKey}/frames/${name}`,
            description: null
        };
    });
    const manifest = {
        version: 1,
        lectureId: options.lectureId,
        title: options.title,
        transcriptPath: `${lectureKey}/transcript.vtt`,
        frames
    };

    await fileSystem.mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
    await fileSystem.writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
    });
    console.log("Phase 1 evidence prepared", {
        manifestPath,
        transcriptCueSource: options.transcriptPath,
        representativeFrameCount: frames.length
    });
}

void prepareEvidence(readOptions()).catch((error: unknown) =>
{
    console.error(error instanceof Error ? error.message : "Evidence preparation failed.");
    process.exitCode = 1;
});
