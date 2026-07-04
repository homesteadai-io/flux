# FLUX Phase 5 Card Layout Handoff

## Current Branch

- Branch: `phase-5-card-layout`
- State: uncommitted working tree changes
- Do not merge `phase-5-per-note-chat` yet. That PR was parked/drafted until the layout is accepted.

## Product Direction Locked In

Adam approved the two-page glass workbench direction:

- Front page:
  - Left: Capture / voice / pasted text
  - Right: YouTube transcript
- Back page:
  - Left: Screenshot tray
  - Right: One working list
- Transparent desktop glass is mandatory. Do not add a fake/static background behind Flux.
- Keep the design quiet and functional. No card-flip gimmick, no phone-demo feeling.

## What Works Now

- Voice capture works.
- Copy `.md` for voice/capture works.
- Export notes to folder works.
- YouTube transcript generation works through `yt-dlp` captions, not Whisper.
- YouTube copy/export works.
- YouTube output is transcript-only. No AI analysis on the YouTube page.
- YouTube URL row now has one `Generate` button. The old Paste button and arrow button were removed.
- Capture, YouTube, and List each have Clear behavior.
- List title works.
- List add item works.
- List copy/export works.
- List clear works.
- Highlighted list row deletes with `Delete` or `Backspace`.
- List state stays inside the list box and no longer hijacks Capture/YouTube surfaces.

## Recent Fixes In This Window

### `.env.local` Save

The visible `Save .env` button was removed from the active Capture card after desktop QA showed the OS folder-picker flow still failed in Adam's live app.

The Electron IPC code still exists, but do not expose it again without a focused desktop QA pass.

### YouTube Button Simplification

Files:

- `src/main.tsx`
- `src/styles.css`

The YouTube row now has:

- URL textarea
- `Generate` button

No separate Paste button. Mouse paste and Ctrl+V work directly in the URL field.

## Screenshot Tray Status

Screenshot tray is now wired as a tray, not an editor:

- Capture writes a PNG to `C:\Users\Adam\Flux\Screenshots`.
- Existing PNGs load into the tray.
- Thumbnails are selectable.
- Copy image copies the selected/latest PNG to the clipboard through Electron.
- Save image exports the selected PNG through a save dialog.
- Open folder opens `C:\Users\Adam\Flux\Screenshots`.

Needs Adam desktop QA after the fresh Electron restart.

## Important Paths

- Repo: `C:\Users\Adam\OneDrive\Desktop\Flux Cowork\flux`
- Saved voice/capture exports: `C:\Users\Adam\OneDrive\Desktop\Flux Cowork\Saved Flux Notes`
- YouTube transcript notes: `C:\Users\Adam\Flux\Transcript Notes`
- List exports: `C:\Users\Adam\Flux\Lists`

## Files Changed In Working Tree

- `electron/main.ts`
- `electron/preload.ts`
- `src/main.tsx`
- `src/styles.css`
- `src/tokens.ts`
- `src/vite-env.d.ts`

## Verification Already Run

```powershell
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Results:

- Typecheck passed.
- Build passed.
- `git diff --check` only reported normal LF-to-CRLF working-copy warnings.
- Local preview returned HTTP `200`.
- Browser QA confirmed:
  - One `Generate` button exists.
  - No `Paste` button exists.
  - List add/select/delete works.
  - Capture and YouTube render after returning from List.
  - No console warnings/errors in the tested flow.
- Electron was fully killed and restarted after main/preload changes.

## Dev App State

Flux was restarted after the latest `.env.local` and YouTube button changes.

If the next agent needs to restart it:

```powershell
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Flux Cowork*flux*' -and ($_.Name -match 'node|electron|cmd') }
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$workdir = 'C:\Users\Adam\OneDrive\Desktop\Flux Cowork\flux'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm.cmd run dev' -WorkingDirectory $workdir -WindowStyle Hidden
```

## Next Agent Order Of Operations

1. Do not start per-note chat.
2. Have Adam QA:
   - YouTube right-click paste
   - Capture Copy `.md` / Export notes
   - List Copy / Export
   - Screenshot capture/copy/save/open folder
4. Run:

```powershell
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

5. Restart Flux after any Electron main/preload changes.
6. Let Adam visually approve before merging.

## Notes For The Next Agent

- Adam prefers design-first. If the page looks wrong, stop and fix the look before deeper behavior.
- Do not claim a feature is done unless it was implemented and verified.
- Do not add AI analysis to YouTube transcripts.
- Do not turn screenshot tray into an editor.
- Keep PR/review/tag gates for accepted phases.
