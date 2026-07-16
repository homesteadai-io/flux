# Flux MCPB

Flux MCPB gives Claude bounded access to the same local Flux state used by the desktop app and Control Room.

## Tools

- `flux_list_notes` lists note metadata with optional `folder` and `source` filters.
- `flux_read_note` reads one complete Markdown note by `noteId` and `folder`.
- `flux_create_note` saves user-provided text as a local Markdown note.
- `flux_fetch_youtube_transcript` fetches native YouTube captions and saves the complete transcript locally.
- `flux_read_working_list` reads the one current working list.
- `flux_save_working_list` replaces the current working list with an explicit title and items.

The server has no tool for arbitrary file access, deletion, shell commands, secrets, cloud sync, messaging, or agent routing. Note identifiers and folders cannot contain paths, and transcript fetching accepts only HTTPS YouTube URLs.

## Data

By default, Flux uses its standard local data directory at `C:\Users\Adam\Flux`. The MCP server uses the shared Flux core directly and does not require the desktop app or browser service to be running.

## Build

From the Flux repository root, run:

```powershell
node scripts/build-mcpb.mjs
```

The build compiles the MCP server and shared runtime into an isolated staging directory, installs production dependencies there, validates the staged manifest with the repository-local MCPB CLI, and writes `release/Flux.mcpb`.
