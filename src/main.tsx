import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { tokens } from './tokens';
import './theme.css';
import './styles.css';

type IconProps = {
  size?: number;
};

type TokenStyle = React.CSSProperties & Record<`--${string}`, string>;
type CaptureStatus = 'idle' | 'recording' | 'saving' | 'error';

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
  onSelectFolder,
  onCreateFolder,
  onToggleRecording
}: {
  library: FluxLibrarySnapshot | null;
  selectedFolder: string;
  selectedNote: FluxNoteSummary | null;
  captureStatus: CaptureStatus;
  elapsedSeconds: number;
  errorMessage: string | null;
  onSelectFolder: (folder: string) => void;
  onCreateFolder: (name: string) => void;
  onToggleRecording: () => void;
}) {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const folders = library?.folders ?? [{ name: 'Inbox', count: 0 }];
  const preview =
    errorMessage ??
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
          disabled={captureStatus === 'saving'}
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
              : selectedNote
                ? `Latest in ${selectedNote.folder}`
                : 'File-backed Inbox'}
          </span>
          <span className="micro-wave" />
        </footer>
      </article>

      <div className="url-bar" aria-disabled="true">
        <IconLink />
        <span>Paste YouTube URL</span>
        <button type="button" aria-label="YouTube URL is held for Phase 4" disabled>
          <IconChevron />
        </button>
      </div>
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
  onMoveNote
}: {
  selectedNote: FluxNoteSummary | null;
  folders: FluxFolder[];
  onMoveNote: (targetFolder: string) => void;
}) {
  const title = selectedNote?.title ?? 'Record your first FLUX note';
  const transcript =
    selectedNote?.transcriptPreview ??
    'A saved transcript will appear here after you stop recording.';

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

      <DetailCard title="AI Analysis" icon={<IconSpark />} action={<IconChevron />}>
        <p>Held for Phase 3. Phase 2 writes the real transcript to disk first.</p>
      </DetailCard>

      <DetailCard title="Next Steps" icon={<IconCheck />} action={<IconChevron />}>
        <ul className="next-steps">
          <li className={selectedNote ? 'done' : ''}>
            <span>{selectedNote ? <IconCheck size={14} /> : null}</span>
            Record audio into a local file
          </li>
          <li className={selectedNote ? 'done' : ''}>
            <span>{selectedNote ? <IconCheck size={14} /> : null}</span>
            OpenAI transcription writes markdown
          </li>
          <li>
            <span />
            Analysis and copy export are Phase 3
          </li>
        </ul>
      </DetailCard>

      <DetailCard title="Transcript" icon={<IconWave />} action={<span className="show-action">Show</span>}>
        <p>{transcript}</p>
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
        <button type="button" disabled>
          <IconCopy />
          Copy as .md
        </button>
        <div className="drag-handle" aria-disabled="true">
          <IconDrag />
          <span>
            <strong>Drag out</strong>
            <small>Held for Phase 5</small>
          </span>
        </div>
      </footer>
    </section>
  );
}

function App() {
  const [isIdle, setIsIdle] = useState(false);
  const [library, setLibrary] = useState<FluxLibrarySnapshot | null>(null);
  const [selectedFolder, setSelectedFolder] = useState('Inbox');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const refreshLibrary = useCallback(async () => {
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
          .then((audioData) => window.fluxLibrary.saveRecording({ audioData, mimeType }))
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
    if (captureStatus === 'saving') {
      return;
    }
    void startRecording();
  }, [captureStatus, startRecording, stopRecording]);

  const createFolder = useCallback(async (name: string) => {
    try {
      setErrorMessage(null);
      const result = await window.fluxLibrary.createFolder(name);
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
      const snapshot = await window.fluxLibrary.moveNote(selectedNote.id, targetFolder);
      setLibrary(snapshot);
      setSelectedFolder(targetFolder.trim());
      setSelectedNoteId(selectedNote.id);
    } catch (error) {
      setCaptureStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not move note.');
    }
  }, [library, selectedNote]);

  return (
    <main className={isIdle ? 'flux-stage is-idle' : 'flux-stage'} style={tokenStyle}>
      <CapturePane
        library={library}
        selectedFolder={selectedFolder}
        selectedNote={selectedNote}
        captureStatus={captureStatus}
        elapsedSeconds={elapsedSeconds}
        errorMessage={errorMessage}
        onSelectFolder={setSelectedFolder}
        onCreateFolder={createFolder}
        onToggleRecording={toggleRecording}
      />
      <NotePane
        selectedNote={selectedNote}
        folders={library?.folders ?? []}
        onMoveNote={moveSelectedNote}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
