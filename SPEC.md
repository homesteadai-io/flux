# Flux Phase 6 - Desktop, Control Room, and MCPB

## Authority and baseline

- Adam approved the existing four-card glass workbench on `phase-5-card-layout`.
- This phase branches from that exact head and must not redesign the glass.
- PR #11 is still open. This phase is a stacked branch and its PR targets
  `phase-5-card-layout`; it does not merge PR #11 or `main` without Adam's call.

## Goal

Restore Flux as one durable local product with three ways to use the same state:

1. A packaged desktop app opened from Adam's existing taskbar pin.
2. A browser version at a loopback-only URL for the Codex Control Room.
3. A `.mcpb` bundle that lets Claude use Flux through bounded MCP tools.

All three surfaces must use the existing file-backed Flux state under
`C:\Users\Adam\Flux`. There must not be a second browser library or an MCP-only
copy of a note.

## Product rules

- Preserve the transparent desktop glass and the approved four-card layout.
- Preserve the manual-first path. Flux remains usable without Claude or Codex.
- Preserve exact YouTube caption retrieval through `yt-dlp`; no AI summary may
  replace the full transcript.
- Preserve copy-to-clipboard and export-to-Markdown behavior.
- Do not delete or rewrite existing notes, transcripts, screenshots, or lists as
  part of the migration.
- Browser and MCP failures must not prevent the desktop app from opening.
- Bind the browser service to `127.0.0.1` only. Never expose it to the LAN.
- Never expose API keys, environment values, or unrestricted filesystem paths
  through HTTP or MCP.

## Architecture

```text
Packaged Electron UI -----------+
Control Room browser UI --------+--> shared Flux core --> C:\Users\Adam\Flux
Claude MCPB server -------------+          |
                                           +--> yt-dlp captions
                                           +--> OpenAI voice transcription/analysis
```

- Shared Flux core owns note, transcript, capture-draft, and working-list
  operations.
- Electron keeps native-only capabilities: transparent window controls,
  desktop capture, settings, native clipboard image support, exports, and native
  file/folder dialogs.
- A small HTTP server serves the built UI and a bounded `/api` on
  `http://127.0.0.1:4783` while Flux is running.
- The browser client uses the HTTP API. The Electron client may use the same API
  for shared operations and its preload bridge for native-only operations.
- The MCPB server uses the same shared core directly. It never requires the
  browser to be open.

## MCPB tool surface

Only the following existing Flux jobs are in scope:

- `flux_list_notes`: list note metadata with optional folder/source filters.
- `flux_read_note`: return one complete Markdown note by stable identifier.
- `flux_create_note`: save user-provided text as a local Markdown note.
- `flux_fetch_youtube_transcript`: fetch native captions and save the complete
  transcript as a local Markdown note.
- `flux_read_working_list`: return the one current working list.
- `flux_save_working_list`: replace the current working list with explicit title
  and items.

No arbitrary file read/write, shell command, note deletion, cloud sync, message
sending, or agent routing is added in this phase.

## Browser behavior

- The front and back cards render with the same layout and visual tokens as the
  desktop app.
- Capture text, YouTube transcripts, and the working list read/write the shared
  Flux state rather than browser-only component memory.
- Browser microphone recording uses browser permission and the shared API.
- Native-only screenshot and folder-dialog actions must show an honest unavailable
  state in the browser; they must not silently fail or pretend to work.
- Browser clipboard actions require a user gesture and show success/failure.

## Desktop packaging

- Build a self-contained Windows unpacked application or installer outside
  `node_modules`.
- Update the existing pinned `Flux.lnk` target only after the packaged executable
  has passed launch QA.
- The taskbar pin must not depend on Vite, TypeScript watch mode, a terminal, or
  generated development output.
- Preserve `C:\Users\Adam\Flux` as the product data directory across packaging.

## Pass/fail checks

1. `npm.cmd run typecheck` exits `0`.
2. `npm.cmd test` exits `0` and covers shared core, HTTP API, and MCP tool handlers.
3. `npm.cmd run build` exits `0`.
4. The packaged executable opens the approved transparent four-card workbench.
5. The exact pinned `Flux.lnk` opens the packaged executable, not Electron under
   `node_modules`.
6. `http://127.0.0.1:4783` loads Flux in the in-app browser with no blank frame or
   fake background.
7. A harmless browser capture-draft round trip appears through the shared API,
   proving shared state, and the test value is cleared afterward.
8. The MCP server initializes, lists its six tools, and a harmless fixture read
   proves it sees the same Flux library.
9. `mcpb validate` and `mcpb pack` succeed and produce a `.mcpb` file.
10. A fresh reviewer checks the final diff against this specification and reports
    no unresolved correctness or stated-requirement gaps.

## Out of scope

- Visual redesign, new cards, cloud hosting, authentication accounts, sync, mobile,
  marketplace publishing, auto-start at Windows login, note deletion, and cleanup
  of agent-generated test content.
- Installing the MCPB into Claude or sending a Claude message without Adam's
  action-time approval.

# Flux Phase 7 - Video Digest Queue

## Authority and baseline

- Adam selected the lightweight queue path, not video processing inside Flux.
- This phase is stacked on the reviewed Phase 6 head
  `38f8b3d16f64997eb857d8f32cd33a885d0babf9`.
- Phase 6 PR #12 remains open and is not merged by this phase.
- The approved four-card glass layout and existing YouTube transcript path remain
  unchanged except for the new bounded action on the YouTube card.

## Goal

Let Adam mark one YouTube video as the current **Digest** request so a Control
Room coding agent can read that request through Flux MCP, invoke its installed
video-watching skill, and return a visual-plus-transcript summary without Adam
watching the video or touching the clipboard.

## Product contract

- Add a `Digest` button beside `Generate` on the YouTube card.
- The button may use either the URL currently pasted into the card or the source
  URL of the displayed YouTube transcript.
- Pressing `Digest` stores one current request in the shared Flux data directory.
  A later explicit request replaces the prior request.
- The UI reports `Queued` only after the request is durably stored. It must not
  claim that the video was watched, analyzed, summarized, or delivered.
- The complete native-caption transcript remains available and unchanged.
- Desktop, browser, and MCP read the same request under `C:\Users\Adam\Flux`.
- The request contains a validated HTTPS YouTube URL, request timestamp, and
  optional source-note identity/title. It contains no API key or arbitrary path.
- Add one read-only MCP tool, `flux_read_video_digest_request`, which returns the
  current request. The agent decides whether and how to invoke its available
  video-watching skill.

## Hard boundaries

- Flux does not download video, extract frames, call Whisper, invoke a shell, or
  duplicate the Watch skill.
- Flux does not send a message to Claude or Codex and does not claim control of
  the active Control Room task.
- No polling agent, background worker, cloud sync, delete operation, or arbitrary
  filesystem access is added.
- Existing six MCP tools keep their behavior; Phase 7 adds exactly one bounded
  read-only tool.

## Pass/fail checks

1. A valid pasted YouTube URL can be queued from desktop and browser Flux.
2. A displayed transcript with a source URL can be queued when the paste box is
   empty.
3. Invalid or non-YouTube URLs are rejected before durable state changes.
4. Restarting Flux preserves the current digest request.
5. `flux_read_video_digest_request` returns the same queued request and is marked
   read-only, non-destructive, idempotent, and closed-world.
6. The MCP server lists exactly seven tools and exposes no video execution or
   shell capability.
7. The transcript generation, copy, export, and clear controls still work.
8. Typecheck, tests, browser build, desktop package, MCPB validation, visual QA,
   and fresh review all pass on the final commit.
