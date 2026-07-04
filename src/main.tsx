import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { tokens } from './tokens';
import './theme.css';
import './styles.css';

type IconProps = {
  size?: number;
};

type TokenStyle = React.CSSProperties & Record<`--${string}`, string>;
type CaptureStatus = 'idle' | 'recording' | 'saving' | 'importing' | 'savingEnv' | 'error';

const tokenStyle: TokenStyle = {
  '--glass-pane': tokens.glass.paneFill,
  '--glass-card': tokens.glass.cardFill,
  '--glass-strong': tokens.glass.strongFill,
  '--glass-line': tokens.glass.border,
  '--glass-line-strong': tokens.glass.borderStrong,
  '--glass-shadow': tokens.glass.shadow,
  '--text': tokens.color.text,
  '--text-muted': tokens.color.muted,
  '--text-faint': tokens.color.faint,
  '--accent-cyan': tokens.color.cyan,
  '--accent-red': tokens.color.red,
  '--accent-green': tokens.color.green,
  '--radius-pane': tokens.radius.pane,
  '--radius-card': tokens.radius.card,
  '--radius-pill': tokens.radius.pill,
  '--blur-pane': tokens.blur.pane,
  '--blur-card': tokens.blur.card
};

const fallbackLibrary: FluxLibrarySnapshot = {
  folders: [{ name: 'Inbox', count: 0 }],
  notes: []
};

function requireFluxLibrary() {
  if (!window.fluxLibrary) {
    throw new Error('Flux desktop bridge is not available in browser preview.');
  }
  return window.fluxLibrary;
}

function IconMic({ size = 26 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3.5a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 0 0 7 0V7A3.5 3.5 0 0 0 12 3.5Z" />
      <path d="M5.75 11.5a6.25 6.25 0 0 0 12.5 0M12 17.75v3M8.75 20.75h6.5" />
    </svg>
  );
}

function IconStop({ size = 24 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8 8h8v8H8z" />
    </svg>
  );
}

function IconSpark({ size = 22 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2.75 13.9 8.1 19.25 10 13.9 11.9 12 17.25 10.1 11.9 4.75 10l5.35-1.9L12 2.75Z" />
      <path d="m18 15.25.9 2.35 2.35.9-2.35.9L18 21.75l-.9-2.35-2.35-.9 2.35-.9.9-2.35Z" />
    </svg>
  );
}

function IconFolder({ size = 18 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3.75 6.75h5.3l1.6 2h9.6v8.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z" />
      <path d="M3.75 8.75h16.5" />
    </svg>
  );
}

function IconLink({ size = 20 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10.5 13.5 13.5 10.5" />
      <path d="M9.7 7.25 11 5.95a4.25 4.25 0 1 1 6.01 6.01l-1.45 1.45" />
      <path d="m14.3 16.75-1.3 1.3a4.25 4.25 0 1 1-6.01-6.01l1.45-1.45" />
    </svg>
  );
}

function IconCheck({ size = 18 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="m6.5 12.35 3.35 3.35 7.65-8.05" />
    </svg>
  );
}

function IconChevron({ size = 18 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

function IconFile({ size = 18 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6.75 3.75h7.4l3.1 3.1v13.4H6.75z" />
      <path d="M14.25 3.95v3h2.95" />
      <path d="M9.25 12.25h5.5M9.25 15.25h4" />
    </svg>
  );
}

function IconPlus({ size = 18 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconCopy({ size = 19 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8.25 8.25h9.5v11.5h-9.5z" />
      <path d="M5.25 15.75h-1v-11.5h9.5v1" />
    </svg>
  );
}

function IconDrag({ size = 20 }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="8" cy="6" r="1.15" />
      <circle cx="16" cy="6" r="1.15" />
      <circle cx="8" cy="12" r="1.15" />
      <circle cx="16" cy="12" r="1.15" />
      <circle cx="8" cy="18" r="1.15" />
      <circle cx="16" cy="18" r="1.15" />
    </svg>
  );
}

function IconWave({ size = 24 }: IconProps) {
  const bars = [8, 14, 20, 12, 24, 18, 10];

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 44 24" fill="none">
      {bars.map((height, index) => (
        <path
          key={height + index}
          d={`M${5 + index * 5} ${12 - height / 2}v${height}`}
          className="wavebar"
        />
      ))}
    </svg>
  );
}

function WindowControls() {
  return (
    <div className="window-controls">
      <button type="button" aria-label="Minimize" onClick={() => window.fluxWindow?.minimize()}>
        <span />
      </button>
      <button type="button" aria-label="Close" onClick={() => window.fluxWindow?.close()}>
        <span />
        <span />
      </button>
    </div>
  );
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatNoteDate(iso?: string) {
  if (!iso) {
    return 'No saved note yet';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

function statusCopy(status: CaptureStatus) {
  if (status === 'recording') {
    return 'Recording...';
  }
  if (status === 'saving') {
    return 'Transcribing...';
  }
  if (status === 'importing') {
    return 'Importing...';
  }
  if (status === 'savingEnv') {
    return 'Saving .env.local...';
  }
  if (status === 'error') {
    return 'Needs attention';
  }
  return 'Ready';
}

function Chip({
  folder,
  selected,
  onClick,
  tone
}: {
  folder: FluxFolder;
  selected: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button type="button" className={selected ? 'chip is-selected' : 'chip'} onClick={onClick}>
      <IconFolder />
      <span>{folder.name}</span>
      <strong style={{ '--tone': tone } as React.CSSProperties}>{folder.count}</strong>
    </button>
  );
}

function CapturePane({
  library,
  selectedFolder,
  selectedNote,
  captureStatus,
  elapsedSeconds,
  errorMessage,
  envStatusMessage,
  onSelectFolder,
  onCreateFolder,
  onToggleRecording,
  onSubmitYouTube,
  onSaveEnvLocal
}: {
  library: FluxLibrarySnapshot | null;
  selectedFolder: string;
  selectedNote: FluxNoteSummary | null;
  captureStatus: CaptureStatus;
  elapsedSeconds: number;
  errorMessage: string | null;
  envStatusMessage: string | null;
  onSelectFolder: (folder: string) => void;
  onCreateFolder: (name: string) => void;
  onToggleRecording: () => void;
  onSubmitYouTube: (url: string) => void;
  onSaveEnvLocal: (content: string) => Promise<boolean>;
}) {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const folders = library?.folders ?? [{ name: 'Inbox', count: 0 }];
  const isBusy =
    captureStatus === 'recording' ||
    captureStatus === 'saving' ||
    captureStatus === 'importing' ||
    captureStatus === 'savingEnv';
  const preview =
    errorMessage ??
    envStatusMessage ??
    selectedNote?.transcriptPreview ??
    'Tap record, say a thought, and Flux will write a real markdown note into your Inbox.';

  const submitFolder = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = folderName.trim();
    if (!nextName) {
      return;
    }
    onCreateFolder(nextName);
    setFolderName('');
    setIsCreatingFolder(false);
  };

  const submitYouTube = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = pasteValue.trim();
    if (!url || isBusy) {
      return;
    }
    onSubmitYouTube(url);
    setPasteValue('');
  };

  const saveEnvLocal = async () => {
    if (!pasteValue.trim() || isBusy) {
      return;
    }

    const didSave = await onSaveEnvLocal(pasteValue);
    if (didSave) {
      setPasteValue('');
    }
  };

  return (
    <section className="glass-pane capture-pane" aria-label="Flux capture screen">
      <header className="pane-header">
        <div className="brand">
          <IconSpark />
          <span>FLUX</span>
        </div>
        <WindowControls />
      </header>

      <div className="folder-row">
        {folders.map((folder, index) => (
          <Chip
            key={folder.name}
            folder={folder}
            selected={folder.name === selectedFolder}
            tone={index % 2 === 0 ? 'rgba(92, 213, 219, 0.35)' : 'rgba(255, 153, 100, 0.32)'}
            onClick={() => onSelectFolder(folder.name)}
          />
        ))}
        <button
          type="button"
          className="icon-pill"
          aria-label="Add folder"
          onClick={() => setIsCreatingFolder((current) => !current)}
        >
          <IconPlus />
        </button>
      </div>

      {isCreatingFolder ? (
        <form className="folder-create" onSubmit={submitFolder}>
          <input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="New folder"
            aria-label="New folder name"
          />
          <button type="submit">Create</button>
        </form>
      ) : null}

      <div className="record-zone">
        <button
          type="button"
          className={captureStatus === 'recording' ? 'record-button is-recording' : 'record-button'}
          aria-label={captureStatus === 'recording' ? 'Stop recording' : 'Start recording'}
          onClick={onToggleRecording}
          disabled={captureStatus === 'saving' || captureStatus === 'importing' || captureStatus === 'savingEnv'}
        >
          <span className="record-halo record-halo-one" />
          <span className="record-halo record-halo-two" />
          <span className="record-glass">
            <span className="record-core">
              {captureStatus === 'recording' ? <IconStop /> : <IconMic />}
            </span>
          </span>
        </button>
        <p>{statusCopy(captureStatus)}</p>
        <time>{formatClock(elapsedSeconds)}</time>
      </div>

      <article className="transcript-preview">
        <div className="preview-copy">
          <IconWave />
          <p>{preview}</p>
        </div>
        <footer>
          <span className={captureStatus === 'error' ? 'live-dot is-error' : 'live-dot'} />
          <span>
            {captureStatus === 'recording'
              ? 'Recording audio'
              : captureStatus === 'savingEnv'
                ? 'Writing .env.local'
              : selectedNote
                ? `Latest in ${selectedNote.folder}`
                : 'File-backed Inbox'}
          </span>
          <span className="micro-wave" />
        </footer>
      </article>

      <form className="url-bar" onSubmit={submitYouTube}>
        <IconLink />
        <textarea
          value={pasteValue}
          onChange={(event) => setPasteValue(event.target.value)}
          placeholder="Paste YouTube URL or env text"
          aria-label="YouTube URL or env text"
          disabled={isBusy}
          rows={1}
        />
        <div className="url-actions">
          <button type="button" className="env-save-button" onClick={saveEnvLocal} disabled={!pasteValue.trim() || isBusy}>
            <IconFile />
            <span>Save as .env</span>
          </button>
          <button type="submit" className="youtube-import-button" aria-label="Import YouTube transcript" disabled={!pasteValue.trim() || isBusy}>
            <IconChevron />
          </button>
        </div>
      </form>
    </section>
  );
}

function DetailCard({
  title,
  icon,
  children,
  action
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <article className="detail-card">
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
        {action ? <div className="card-action">{action}</div> : null}
      </header>
      <div className="card-body">{children}</div>
    </article>
  );
}

function NotePane({
  selectedNote,
  folders,
  onMoveNote,
  onCopyMarkdown,
  onExportMarkdown
}: {
  selectedNote: FluxNoteSummary | null;
  folders: FluxFolder[];
  onMoveNote: (targetFolder: string) => void;
  onCopyMarkdown: (note: FluxNoteSummary) => Promise<boolean>;
  onExportMarkdown: (note: FluxNoteSummary) => Promise<boolean>;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'exported'>('idle');
  const title = selectedNote?.title ?? 'Record your first FLUX note';
  const analysis = selectedNote?.analysis;
  const transcript =
    selectedNote?.transcriptPreview ??
    'A saved transcript will appear here after you stop recording.';
  const nextSteps = analysis?.nextSteps.length
    ? analysis.nextSteps
    : selectedNote
      ? ['No explicit next steps captured.']
      : ['Record audio into a local file', 'OpenAI transcription writes markdown'];

  useEffect(() => {
    setCopyStatus('idle');
    setExportStatus('idle');
  }, [selectedNote?.id, selectedNote?.folder]);

  const copyMarkdown = async () => {
    if (!selectedNote || copyStatus === 'copying') {
      return;
    }

    setCopyStatus('copying');
    const copied = await onCopyMarkdown(selectedNote);
    setCopyStatus(copied ? 'copied' : 'idle');
  };

  const exportMarkdown = async () => {
    if (!selectedNote || exportStatus === 'exporting') {
      return;
    }

    setExportStatus('exporting');
    const exported = await onExportMarkdown(selectedNote);
    setExportStatus(exported ? 'exported' : 'idle');
  };

  return (
    <section className="glass-pane note-pane" aria-label="Flux note detail">
      <header className="pane-header">
        <button type="button" className="back-button" aria-label="Back">
          <span />
        </button>
        <label className="folder-pill folder-select" aria-label="Move note to folder">
          <IconFolder />
          <select
            value={selectedNote?.folder ?? 'Inbox'}
            onChange={(event) => onMoveNote(event.target.value)}
            disabled={!selectedNote || folders.length < 2}
          >
            {folders.length ? (
              folders.map((folder) => (
                <option key={folder.name} value={folder.name}>
                  {folder.name}
                </option>
              ))
            ) : (
              <option value="Inbox">Inbox</option>
            )}
          </select>
        </label>
        <WindowControls />
      </header>

      <div className="note-title">
        <div>
          <h1>{title}</h1>
          <p>{selectedNote ? `${formatNoteDate(selectedNote.created)} - ${selectedNote.source}` : 'Waiting for voice capture'}</p>
        </div>
        <button type="button" aria-label="More actions">
          <span />
          <span />
          <span />
        </button>
      </div>

      <DetailCard
        title="AI Analysis"
        icon={<IconSpark />}
        action={analysis ? <span className="model-tag">{analysis.model}</span> : <IconChevron />}
      >
        <p>{analysis?.topline ?? 'Record a note to generate a grounded breakdown.'}</p>
      </DetailCard>

      <DetailCard title="Next Steps" icon={<IconCheck />} action={<IconChevron />}>
        <ul className="next-steps">
          {nextSteps.map((step) => (
            <li key={step} className={analysis ? '' : selectedNote ? 'done' : ''}>
              <span>{analysis ? null : selectedNote ? <IconCheck size={14} /> : null}</span>
              {step}
            </li>
          ))}
        </ul>
      </DetailCard>

      <DetailCard
        title="Transcript"
        icon={<IconWave />}
        action={
          <button
            type="button"
            className="show-action"
            onClick={() => setShowTranscript((current) => !current)}
          >
            {showTranscript ? 'Hide' : 'Show'}
          </button>
        }
      >
        {showTranscript ? <p>{transcript}</p> : null}
      </DetailCard>

      <div className="action-grid">
        <button type="button" disabled>
          <IconPlus />
          <span>
            <strong>Add to note</strong>
            <small>Held for Phase 5</small>
          </span>
        </button>
        <button type="button" disabled>
          <span className="chat-icon" />
          <span>
            <strong>Chat</strong>
            <small>Held for Phase 5</small>
          </span>
        </button>
      </div>

      <footer className="export-row">
        <strong>Export</strong>
        <button
          type="button"
          onClick={copyMarkdown}
          disabled={!selectedNote || copyStatus === 'copying'}
        >
          <IconCopy />
          {copyStatus === 'copying' ? 'Copying...' : copyStatus === 'copied' ? 'Copied' : 'Copy as .md'}
        </button>
        <button
          type="button"
          className="export-folder-button"
          onClick={exportMarkdown}
          disabled={!selectedNote || exportStatus === 'exporting'}
        >
          <IconDrag />
          <span>
            <strong>
              {exportStatus === 'exporting'
                ? 'Exporting...'
                : exportStatus === 'exported'
                  ? 'Exported'
                  : 'Export to folder'}
            </strong>
            <small>{selectedNote ? 'Save .md copy' : 'Held for Phase 5'}</small>
          </span>
        </button>
      </footer>
    </section>
  );
}

type WorkbenchFace = 'front' | 'back';

type WorkbenchProps = {
  face: WorkbenchFace;
  setFace: (face: WorkbenchFace) => void;
  captureNote: FluxNoteSummary | null;
  youtubeNote: FluxNoteSummary | null;
  captureStatus: CaptureStatus;
  elapsedSeconds: number;
  errorMessage: string | null;
  envStatusMessage: string | null;
  onToggleRecording: () => void;
  onSubmitYouTube: (url: string) => void;
  onSaveEnvLocal: (content: string) => Promise<boolean>;
  onCopyMarkdown: (note: FluxNoteSummary) => Promise<boolean>;
  onExportMarkdown: (note: FluxNoteSummary) => Promise<boolean>;
};

function GlassButton({
  children,
  onClick,
  disabled,
  className = ''
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`glass-button ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function WorkbenchHeader() {
  return (
    <header className="workbench-header">
      <div className="brand compact-brand">
        <IconSpark />
        <span>FLUX</span>
      </div>
      <WindowControls />
    </header>
  );
}

function CaptureCard({
  captureNote,
  captureStatus,
  elapsedSeconds,
  errorMessage,
  envStatusMessage,
  onToggleRecording,
  onSaveEnvLocal,
  onCopyMarkdown,
  onExportMarkdown
}: Pick<
  WorkbenchProps,
  | 'captureNote'
  | 'captureStatus'
  | 'elapsedSeconds'
  | 'errorMessage'
  | 'envStatusMessage'
  | 'onToggleRecording'
  | 'onSaveEnvLocal'
  | 'onCopyMarkdown'
  | 'onExportMarkdown'
>) {
  const [scratchValue, setScratchValue] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'exported'>('idle');
  const [clearedCaptureKey, setClearedCaptureKey] = useState('');
  const captureKey = captureNote ? `${captureNote.folder}/${captureNote.id}` : '';
  const activeCaptureNote = clearedCaptureKey === captureKey ? null : captureNote;
  const isBusy =
    captureStatus === 'recording' ||
    captureStatus === 'saving' ||
    captureStatus === 'importing' ||
    captureStatus === 'savingEnv';
  const preview =
    errorMessage ??
    envStatusMessage ??
    activeCaptureNote?.transcript ??
    'Capture a thought, paste raw text, or drop a key here before sending it somewhere useful.';

  useEffect(() => {
    setCopyStatus('idle');
    setExportStatus('idle');
    setClearedCaptureKey('');
  }, [captureNote?.id, captureNote?.folder]);

  const saveEnvLocal = async () => {
    if (!scratchValue.trim() || isBusy) {
      return;
    }
    const didSave = await onSaveEnvLocal(scratchValue);
    if (didSave) {
      setScratchValue('');
    }
  };

  const copyMarkdown = async () => {
    if (!activeCaptureNote || copyStatus === 'copying') {
      return;
    }
    setCopyStatus('copying');
    try {
      const copied = await onCopyMarkdown(activeCaptureNote);
      setCopyStatus(copied ? 'copied' : 'idle');
    } catch {
      setCopyStatus('idle');
    }
  };

  const exportMarkdown = async () => {
    if (!activeCaptureNote || exportStatus === 'exporting') {
      return;
    }
    setExportStatus('exporting');
    try {
      const exported = await onExportMarkdown(activeCaptureNote);
      setExportStatus(exported ? 'exported' : 'idle');
    } catch {
      setExportStatus('idle');
    }
  };

  const clearCapture = () => {
    setScratchValue('');
    if (captureKey) {
      setClearedCaptureKey(captureKey);
    }
    setCopyStatus('idle');
    setExportStatus('idle');
  };

  return (
    <section className="glass-pane workbench-card capture-card" aria-label="Flux capture">
      <WorkbenchHeader />
      <div className="card-topline">
        <GlassButton onClick={saveEnvLocal} disabled={!scratchValue.trim() || isBusy}>
          Save .env
        </GlassButton>
        <button
          type="button"
          className={captureStatus === 'recording' ? 'mini-mic is-recording' : 'mini-mic'}
          aria-label={captureStatus === 'recording' ? 'Stop recording' : 'Start recording'}
          onClick={onToggleRecording}
          disabled={captureStatus === 'saving' || captureStatus === 'importing' || captureStatus === 'savingEnv'}
        >
          {captureStatus === 'recording' ? <IconStop /> : <IconMic />}
        </button>
      </div>

      <label className="large-capture-box">
        <span>Capture</span>
        <textarea
          value={scratchValue}
          onChange={(event) => setScratchValue(event.target.value)}
          placeholder={preview}
          rows={8}
          disabled={isBusy && captureStatus !== 'recording'}
        />
      </label>

      <div className="capture-status-row">
        <span className={captureStatus === 'error' ? 'live-dot is-error' : 'live-dot'} />
        <span>{statusCopy(captureStatus)}</span>
        <time>{formatClock(elapsedSeconds)}</time>
      </div>

      <div className="card-actions">
        <GlassButton onClick={copyMarkdown} disabled={!activeCaptureNote || copyStatus === 'copying'}>
          {copyStatus === 'copying' ? 'Copying...' : copyStatus === 'copied' ? 'Copied' : 'Copy .md'}
        </GlassButton>
        <GlassButton onClick={exportMarkdown} disabled={!activeCaptureNote || exportStatus === 'exporting'}>
          {exportStatus === 'exporting' ? 'Exporting...' : exportStatus === 'exported' ? 'Exported' : 'Export notes'}
        </GlassButton>
        <GlassButton onClick={clearCapture} disabled={!scratchValue.trim() && !activeCaptureNote}>
          Clear
        </GlassButton>
      </div>
    </section>
  );
}

function YouTubeCard({
  youtubeNote,
  captureStatus,
  onSubmitYouTube,
  onCopyMarkdown,
  onExportMarkdown
}: Pick<
  WorkbenchProps,
  'youtubeNote' | 'captureStatus' | 'onSubmitYouTube' | 'onCopyMarkdown' | 'onExportMarkdown'
>) {
  const [url, setUrl] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'exported'>('idle');
  const [clearedTranscriptKey, setClearedTranscriptKey] = useState('');
  const transcriptKey = youtubeNote ? `${youtubeNote.folder}/${youtubeNote.id}` : '';
  const activeYoutubeNote = clearedTranscriptKey === transcriptKey ? null : youtubeNote;
  const isBusy = captureStatus === 'importing' || captureStatus === 'saving' || captureStatus === 'recording';
  const transcript = activeYoutubeNote?.transcript || activeYoutubeNote?.transcriptPreview || '';

  useEffect(() => {
    setCopyStatus('idle');
    setExportStatus('idle');
    setClearedTranscriptKey('');
  }, [youtubeNote?.id, youtubeNote?.folder]);

  const submitUrl = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = url.trim();
    if (!nextUrl || isBusy) {
      return;
    }
    onSubmitYouTube(nextUrl);
    setUrl('');
  };

  const copyMarkdown = async () => {
    if (!activeYoutubeNote || copyStatus === 'copying') {
      return;
    }
    setCopyStatus('copying');
    try {
      const copied = await onCopyMarkdown(activeYoutubeNote);
      setCopyStatus(copied ? 'copied' : 'idle');
    } catch {
      setCopyStatus('idle');
    }
  };

  const exportMarkdown = async () => {
    if (!activeYoutubeNote || exportStatus === 'exporting') {
      return;
    }
    setExportStatus('exporting');
    try {
      const exported = await onExportMarkdown(activeYoutubeNote);
      setExportStatus(exported ? 'exported' : 'idle');
    } catch {
      setExportStatus('idle');
    }
  };

  const clearTranscript = () => {
    setUrl('');
    if (transcriptKey) {
      setClearedTranscriptKey(transcriptKey);
    }
    setCopyStatus('idle');
    setExportStatus('idle');
  };

  return (
    <section className="glass-pane workbench-card youtube-card" aria-label="YouTube analysis">
      <WorkbenchHeader />
      <div className="analysis-box transcript-box">
        <span>Transcript: YouTube</span>
        <pre>{transcript || 'Paste a YouTube URL and Flux will pull every captioned word into this box.'}</pre>
      </div>

      <form className="inline-paste-box" onSubmit={submitUrl}>
        <IconLink />
        <textarea
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste URL: YouTube"
          aria-label="Paste YouTube URL"
          rows={2}
          disabled={isBusy}
        />
        <button
          type="submit"
          className="generate-button"
          disabled={!url.trim() || isBusy}
          aria-label="Generate YouTube transcript"
        >
          Generate
        </button>
      </form>

      <div className="card-actions">
        <GlassButton onClick={copyMarkdown} disabled={!activeYoutubeNote || copyStatus === 'copying'}>
          {copyStatus === 'copying' ? 'Copying...' : copyStatus === 'copied' ? 'Copied' : 'Copy .md'}
        </GlassButton>
        <GlassButton onClick={exportMarkdown} disabled={!activeYoutubeNote || exportStatus === 'exporting'}>
          {exportStatus === 'exporting' ? 'Exporting...' : exportStatus === 'exported' ? 'Exported' : 'Export to folder'}
        </GlassButton>
        <GlassButton onClick={clearTranscript} disabled={!url.trim() && !activeYoutubeNote}>
          Clear
        </GlassButton>
      </div>
    </section>
  );
}

function ScreenshotTrayCard() {
  const [screenshots, setScreenshots] = useState<FluxScreenshot[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [status, setStatus] = useState<'idle' | 'capturing' | 'copying' | 'copied' | 'saving' | 'saved'>('idle');
  const selectedScreenshot =
    screenshots.find((screenshot) => screenshot.filePath === selectedPath) ?? screenshots[0] ?? null;

  useEffect(() => {
    if (!window.fluxLibrary?.listScreenshots) {
      return;
    }

    void window.fluxLibrary
      .listScreenshots()
      .then((nextScreenshots) => {
        setScreenshots(nextScreenshots);
        setSelectedPath((current) => current || nextScreenshots[0]?.filePath || '');
      })
      .catch(() => {
        setScreenshots([]);
      });
  }, []);

  const capture = async () => {
    if (status === 'capturing') {
      return;
    }

    setStatus('capturing');
    try {
      const result = await requireFluxLibrary().captureScreenshot();
      setScreenshots(result.screenshots);
      setSelectedPath(result.screenshot.filePath);
      setStatus('idle');
    } catch {
      setStatus('idle');
    }
  };

  const copyImage = async () => {
    if (!selectedScreenshot || status === 'copying') {
      return;
    }

    setStatus('copying');
    try {
      await requireFluxLibrary().copyScreenshot({ filePath: selectedScreenshot.filePath });
      setStatus('copied');
    } catch {
      setStatus('idle');
    }
  };

  const saveImage = async () => {
    if (!selectedScreenshot || status === 'saving') {
      return;
    }

    setStatus('saving');
    try {
      const result = await requireFluxLibrary().saveScreenshot({ filePath: selectedScreenshot.filePath });
      setStatus(result.canceled ? 'idle' : 'saved');
    } catch {
      setStatus('idle');
    }
  };

  const openFolder = async () => {
    try {
      await requireFluxLibrary().openScreenshotsFolder();
    } catch {
      // Desktop bridge only.
    }
  };

  return (
    <section className="glass-pane workbench-card screenshot-card" aria-label="Screenshot tray">
      <WorkbenchHeader />
      <div className="card-topline">
        <GlassButton onClick={copyImage} disabled={!selectedScreenshot || status === 'copying'}>
          {status === 'copying' ? 'Copying...' : status === 'copied' ? 'Copied' : 'Copy image'}
        </GlassButton>
        <button
          type="button"
          className="mini-mic screen-capture-button"
          aria-label="Capture screenshot"
          onClick={capture}
          disabled={status === 'capturing'}
        >
          <IconFile />
        </button>
      </div>

      <div className="screenshot-tray">
        <span>Screenshot tray</span>
        <div className="thumbnail-grid">
          {screenshots.length ? (
            screenshots.map((screenshot) => (
              <button
                key={screenshot.filePath}
                type="button"
                className={selectedScreenshot?.filePath === screenshot.filePath ? 'is-selected' : ''}
                onClick={() => setSelectedPath(screenshot.filePath)}
                title={screenshot.fileName}
              >
                <img src={screenshot.dataUrl} alt={screenshot.fileName} />
              </button>
            ))
          ) : (
            <p>{status === 'capturing' ? 'Capturing...' : 'No screenshots yet.'}</p>
          )}
        </div>
      </div>

      <div className="card-actions">
        <GlassButton onClick={saveImage} disabled={!selectedScreenshot || status === 'saving'}>
          {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : 'Save image'}
        </GlassButton>
        <GlassButton onClick={openFolder}>Open folder</GlassButton>
      </div>
    </section>
  );
}

function ListCard() {
  const [title, setTitle] = useState('Working list');
  const [draftItem, setDraftItem] = useState('');
  const [items, setItems] = useState<string[]>(['Review Flux layout', 'Keep transcript in YouTube box']);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'exported'>('idle');
  const hasListContent = Boolean(title.trim() || items.length);

  useEffect(() => {
    setCopyStatus('idle');
    setExportStatus('idle');
  }, [title, items.length]);

  const listMarkdown = () => {
    const safeTitle = title.trim() || 'Flux list';
    const body = items.length ? items.map((item) => `- [ ] ${item}`).join('\n') : '- [ ] ';
    return `# ${safeTitle}\n\n${body}\n`;
  };

  const addItem = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextItem = draftItem.trim();
    if (!nextItem) {
      return;
    }
    setItems((current) => [...current, nextItem]);
    setSelectedIndex(items.length);
    setDraftItem('');
  };

  const removeSelectedItem = () => {
    if (selectedIndex === null) {
      return;
    }
    setItems((current) => current.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(null);
  };

  const copyMarkdown = async () => {
    if (!hasListContent || copyStatus === 'copying') {
      return;
    }
    setCopyStatus('copying');
    try {
      await requireFluxLibrary().copyListMarkdown({
        title: title.trim() || 'Flux list',
        markdown: listMarkdown()
      });
      setCopyStatus('copied');
    } catch {
      setCopyStatus('idle');
    }
  };

  const exportMarkdown = async () => {
    if (!hasListContent || exportStatus === 'exporting') {
      return;
    }
    setExportStatus('exporting');
    try {
      await requireFluxLibrary().exportListMarkdown({
        title: title.trim() || 'Flux list',
        markdown: listMarkdown()
      });
      setExportStatus('exported');
    } catch {
      setExportStatus('idle');
    }
  };

  const clearList = () => {
    setTitle('');
    setDraftItem('');
    setItems([]);
    setSelectedIndex(null);
    setCopyStatus('idle');
    setExportStatus('idle');
  };

  return (
    <section className="glass-pane workbench-card list-card" aria-label="Flux list">
      <WorkbenchHeader />
      <div className="list-box">
        <input
          className="list-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="List title"
          aria-label="List title"
        />
        <form className="list-add-row" onSubmit={addItem}>
          <input
            value={draftItem}
            onChange={(event) => setDraftItem(event.target.value)}
            placeholder="Add item"
            aria-label="Add list item"
          />
          <button type="submit" disabled={!draftItem.trim()}>
            <IconPlus />
          </button>
        </form>
        <div
          className="note-list"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              removeSelectedItem();
            }
          }}
        >
          {items.length ? (
            items.map((item, index) => (
              <button
                key={`${item}-${index}`}
                type="button"
                className={selectedIndex === index ? 'is-selected' : ''}
                onClick={() => setSelectedIndex(index)}
              >
                <i />
                <span>{item}</span>
              </button>
            ))
          ) : (
            <p>No list items.</p>
          )}
        </div>
      </div>

      <div className="card-actions">
        <GlassButton onClick={copyMarkdown} disabled={!hasListContent || copyStatus === 'copying'}>
          {copyStatus === 'copying' ? 'Copying...' : copyStatus === 'copied' ? 'Copied' : 'Copy .md'}
        </GlassButton>
        <GlassButton onClick={exportMarkdown} disabled={!hasListContent || exportStatus === 'exporting'}>
          {exportStatus === 'exporting' ? 'Exporting...' : exportStatus === 'exported' ? 'Exported' : 'Export to folder'}
        </GlassButton>
        <GlassButton onClick={clearList} disabled={!hasListContent && !draftItem.trim()}>
          Clear
        </GlassButton>
      </div>
    </section>
  );
}

function WorkbenchDock({ face, setFace }: { face: WorkbenchFace; setFace: (face: WorkbenchFace) => void }) {
  return (
    <nav className="face-dock" aria-label="Flux pages">
      <button
        type="button"
        className={face === 'front' ? 'is-active' : ''}
        onClick={() => setFace('front')}
        aria-label="Capture and YouTube"
      >
        <IconMic size={18} />
      </button>
      <button
        type="button"
        className={face === 'back' ? 'is-active' : ''}
        onClick={() => setFace('back')}
        aria-label="Screenshots and list"
      >
        <IconFolder size={18} />
      </button>
    </nav>
  );
}

function CardWorkbench(props: WorkbenchProps) {
  return (
    <>
      <section className={`workbench-face ${props.face === 'front' ? 'is-active' : 'is-hidden'}`}>
        <CaptureCard
          captureNote={props.captureNote}
          captureStatus={props.captureStatus}
          elapsedSeconds={props.elapsedSeconds}
          errorMessage={props.errorMessage}
          envStatusMessage={props.envStatusMessage}
          onToggleRecording={props.onToggleRecording}
          onSaveEnvLocal={props.onSaveEnvLocal}
          onCopyMarkdown={props.onCopyMarkdown}
          onExportMarkdown={props.onExportMarkdown}
        />
        <YouTubeCard
          youtubeNote={props.youtubeNote}
          captureStatus={props.captureStatus}
          onSubmitYouTube={props.onSubmitYouTube}
          onCopyMarkdown={props.onCopyMarkdown}
          onExportMarkdown={props.onExportMarkdown}
        />
      </section>

      <section className={`workbench-face ${props.face === 'back' ? 'is-active' : 'is-hidden'}`}>
        <ScreenshotTrayCard />
        <ListCard />
      </section>

      <WorkbenchDock face={props.face} setFace={props.setFace} />
    </>
  );
}

function App() {
  const [isIdle, setIsIdle] = useState(false);
  const [activeFace, setActiveFace] = useState<WorkbenchFace>('front');
  const [library, setLibrary] = useState<FluxLibrarySnapshot | null>(null);
  const [selectedFolder, setSelectedFolder] = useState('Inbox');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [envStatusMessage, setEnvStatusMessage] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);

  const notesInFolder = useMemo(
    () => library?.notes.filter((note) => note.folder === selectedFolder) ?? [],
    [library, selectedFolder]
  );

  const selectedNote = useMemo(() => {
    if (!library) {
      return null;
    }

    return (
      library.notes.find((note) => note.id === selectedNoteId) ??
      notesInFolder[0] ??
      library.notes[0] ??
      null
    );
  }, [library, notesInFolder, selectedNoteId]);

  const captureNote = useMemo(
    () => library?.notes.find((note) => note.source === 'voice') ?? null,
    [library]
  );

  const youtubeNote = useMemo(
    () => library?.notes.find((note) => note.source === 'youtube') ?? null,
    [library]
  );

  const refreshLibrary = useCallback(async () => {
    if (!window.fluxLibrary) {
      setLibrary(fallbackLibrary);
      return;
    }

    const snapshot = await window.fluxLibrary.list();
    setLibrary(snapshot);
    if (!snapshot.folders.some((folder) => folder.name === selectedFolder)) {
      setSelectedFolder('Inbox');
    }
  }, [selectedFolder]);

  useEffect(() => {
    void refreshLibrary().catch((error: unknown) => {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not load Flux library.');
    });
  }, [refreshLibrary]);

  useEffect(() => {
    let timeout = window.setTimeout(() => setIsIdle(true), 4200);
    const wake = () => {
      setIsIdle(false);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setIsIdle(true), 4200);
    };

    window.addEventListener('mousemove', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('keydown', wake);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  useEffect(() => {
    if (captureStatus !== 'recording') {
      return;
    }

    const interval = window.setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSeconds((Date.now() - startedAtRef.current) / 1000);
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [captureStatus]);

  const startRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setCaptureStatus('saving');

        void blob
          .arrayBuffer()
          .then((audioData) => requireFluxLibrary().saveRecording({ audioData, mimeType }))
          .then((result) => {
            setLibrary(result.library);
            setSelectedFolder(result.note.folder);
            setSelectedNoteId(result.note.id);
            setCaptureStatus('idle');
            setElapsedSeconds(0);
          })
          .catch((error: unknown) => {
            setCaptureStatus('error');
            setErrorMessage(error instanceof Error ? error.message : 'Could not save recording.');
          });
      });

      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setCaptureStatus('recording');
      recorder.start();
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Microphone capture failed.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    startedAtRef.current = null;
  }, []);

  const toggleRecording = useCallback(() => {
    if (captureStatus === 'recording') {
      stopRecording();
      return;
    }
    if (captureStatus === 'saving' || captureStatus === 'importing' || captureStatus === 'savingEnv') {
      return;
    }
    setEnvStatusMessage(null);
    void startRecording();
  }, [captureStatus, startRecording, stopRecording]);

  const submitYouTube = useCallback(async (url: string) => {
    try {
      setErrorMessage(null);
      setEnvStatusMessage(null);
      setCaptureStatus('importing');
      const result = await requireFluxLibrary().saveYouTubeUrl({ url });
      setLibrary(result.library);
      setSelectedFolder(result.note.folder);
      setSelectedNoteId(result.note.id);
      setCaptureStatus('idle');
      setElapsedSeconds(0);
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not import YouTube transcript.');
    }
  }, []);

  const saveEnvLocal = useCallback(async (content: string) => {
    try {
      setErrorMessage(null);
      setEnvStatusMessage(null);
      setCaptureStatus('savingEnv');
      const result = await requireFluxLibrary().saveEnvLocal({ content });
      setCaptureStatus('idle');

      if (result.canceled) {
        return false;
      }

      setEnvStatusMessage(`Saved .env.local to ${result.directory}.`);
      return true;
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not save .env.local.');
      return false;
    }
  }, []);

  const copyMarkdown = useCallback(async (note: FluxNoteSummary) => {
    try {
      setErrorMessage(null);
      setEnvStatusMessage(null);
      await requireFluxLibrary().copyMarkdown({ noteId: note.id, folder: note.folder });
      return true;
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not copy markdown.');
      return false;
    }
  }, []);

  const exportMarkdown = useCallback(async (note: FluxNoteSummary) => {
    try {
      setErrorMessage(null);
      setEnvStatusMessage(null);
      const result = await requireFluxLibrary().exportMarkdown({
        noteId: note.id,
        folder: note.folder
      });

      if (result.canceled) {
        return false;
      }

      setEnvStatusMessage(`Exported ${note.id}.md to ${result.directory}.`);
      return true;
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not export markdown.');
      return false;
    }
  }, []);

  const createFolder = useCallback(async (name: string) => {
    try {
      setErrorMessage(null);
      setEnvStatusMessage(null);
      const result = await requireFluxLibrary().createFolder(name);
      setLibrary(result.library);
      setSelectedFolder(result.folder);
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not create folder.');
    }
  }, []);

  const moveSelectedNote = useCallback(async (targetFolder: string) => {
    if (!selectedNote || !library) {
      return;
    }

    if (!targetFolder || targetFolder === selectedNote.folder) {
      return;
    }

    try {
      setErrorMessage(null);
      setEnvStatusMessage(null);
      const snapshot = await requireFluxLibrary().moveNote(selectedNote.id, targetFolder);
      setLibrary(snapshot);
      setSelectedFolder(targetFolder.trim());
      setSelectedNoteId(selectedNote.id);
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not move note.');
    }
  }, [library, selectedNote]);

  return (
    <main className={isIdle ? 'flux-stage card-workbench is-idle' : 'flux-stage card-workbench'} style={tokenStyle}>
      <CardWorkbench
        face={activeFace}
        setFace={setActiveFace}
        captureNote={captureNote}
        youtubeNote={youtubeNote}
        captureStatus={captureStatus}
        elapsedSeconds={elapsedSeconds}
        errorMessage={errorMessage}
        envStatusMessage={envStatusMessage}
        onToggleRecording={toggleRecording}
        onSubmitYouTube={submitYouTube}
        onSaveEnvLocal={saveEnvLocal}
        onCopyMarkdown={copyMarkdown}
        onExportMarkdown={exportMarkdown}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
