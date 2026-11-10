# Private Phase 1 evidence

This directory is the local boundary for lecture evidence. Generated manifests, transcripts, and frames are ignored by Git so private course material is not committed.

Prepare an experiment from an authorized MP4 and an ASR-generated WebVTT transcript:

```sh
npm run phase1:prepare -- \
    --lecture-id "classcom:recording:recording-123" \
    --title "Lecture title" \
    --transcript "/absolute/path/to/transcript.vtt" \
    --video "/absolute/path/to/authorized-recording.mp4"
```

The lecture ID must exactly match the ID detected by the extension. The preparation command uses FFmpeg scene changes to select up to 120 representative frames. It does not upload the video, transcript, or frames. At question time the local API sends only retrieved transcript excerpts and, for the multimodal strategy, nearby frames to the configured provider.
