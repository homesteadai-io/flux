# Flux MCPB

Flux MCPB gives a Codex task bounded access to the same local Flux state shown in browser Flux.

## Tools

- `flux_list_notes` lists note metadata with optional `folder` and `source` filters.
- `flux_read_note` reads one complete Markdown note by `noteId` and `folder`.
- `flux_create_note` saves user-provided text as a local Markdown note.
- `flux_fetch_youtube_transcript` fetches native YouTube captions and saves the complete transcript locally.
- `flux_bind_current_codex_task` binds browser Flux to the explicit `CODEX_THREAD_ID`. It does not wake or message the task.
- `flux_claim_video_handoff` claims the exact visible handoff ID for this task and returns its source URL and preserved raw transcript.
- `flux_complete_video_handoff` publishes downstream analysis without replacing the raw transcript.
- `flux_fail_video_handoff` records a bounded failure reason without replacing the raw transcript.
- `flux_read_working_list` reads the one current working list.
- `flux_save_working_list` replaces the current working list with an explicit title and items.

The server has no tool for video execution, arbitrary file access, deletion, shell commands, secrets, cloud sync, messaging, or autonomous task routing. A browser queue action creates local state only; Adam must message the intended Codex task, which then explicitly claims the handoff. Note identifiers and folders cannot contain paths, and transcript fetching accepts only HTTPS YouTube URLs.

## Control Room desk loop

When a Codex task opens the Flux desk, call `flux_bind_current_codex_task` once so browser Flux displays the exact task ID. After Adam queues a video and messages the task, read the visible handoff ID and pass that exact ID to `flux_claim_video_handoff`. Work from the returned source URL and preserved raw transcript, then call `flux_complete_video_handoff` or `flux_fail_video_handoff` with the same ID. Never imply that queueing alone wakes or messages Codex.

## Data

By default, Flux uses its standard local data directory at `C:\Users\Adam\Flux`. The MCP server uses the shared Flux core directly and does not require the desktop app or browser service to be running.

## Build

From the Flux repository root, run:

```powershell
node scripts/build-mcpb.mjs
```

The build compiles the MCP server and shared runtime into an isolated staging directory, installs production dependencies there, validates the staged manifest with the repository-local MCPB CLI, and writes `release/Flux.mcpb`.
