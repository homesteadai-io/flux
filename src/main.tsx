import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { tokens } from './tokens';
import './theme.css';
import './styles.css';

type IconProps = {
  size?: number;
};

type TokenStyle = React.CSSProperties & Record<`--${string}`, string>;

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

function Chip({ children, count, tone }: { children: React.ReactNode; count?: string; tone?: string }) {
  return (
    <button type="button" className="chip">
      <IconFolder />
      <span>{children}</span>
      {count ? <strong style={{ '--tone': tone } as React.CSSProperties}>{count}</strong> : null}
    </button>
  );
}

function CapturePane() {
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
        <Chip count="12" tone="rgba(92, 213, 219, 0.35)">
          Inbox
        </Chip>
        <Chip count="8" tone="rgba(255, 153, 100, 0.32)">
          Video Ideas
        </Chip>
        <button type="button" className="icon-pill" aria-label="Add folder">
          <IconPlus />
        </button>
      </div>

      <div className="record-zone">
        <button type="button" className="record-button" aria-label="Start recording">
          <span className="record-halo record-halo-one" />
          <span className="record-halo record-halo-two" />
          <span className="record-glass">
            <span className="record-core">
              <IconMic />
            </span>
          </span>
        </button>
        <p>Listening...</p>
        <time>00:01:24</time>
      </div>

      <article className="transcript-preview">
        <div className="preview-copy">
          <IconWave />
          <p>
            So the idea is simple. I talk, you capture, you write it all down, then you give me
            the topline and the next steps. I can drag it out into any app.
          </p>
        </div>
        <footer>
          <span className="live-dot" />
          <span>Live transcription</span>
          <span className="micro-wave" />
        </footer>
      </article>

      <div className="url-bar">
        <IconLink />
        <span>Paste YouTube URL</span>
        <button type="button" aria-label="Submit YouTube URL">
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

function NotePane() {
  return (
    <section className="glass-pane note-pane" aria-label="Flux note detail mockup">
      <header className="pane-header">
        <button type="button" className="back-button" aria-label="Back">
          <span />
        </button>
        <button type="button" className="folder-pill">
          <IconFolder />
          <span>Inbox</span>
        </button>
        <WindowControls />
      </header>

      <div className="note-title">
        <div>
          <h1>Talking through the FLUX idea</h1>
          <p>May 1, 2025 - 10:28 AM - voice</p>
        </div>
        <button type="button" aria-label="More actions">
          <span />
          <span />
          <span />
        </button>
      </div>

      <DetailCard title="AI Analysis" icon={<IconSpark />} action={<IconChevron />}>
        <p>
          FLUX is a transparent desktop capture pane that turns voice and YouTube content into
          clean markdown notes for other agents. The point is getting ideas out of your head and
          into the next tool without ceremony.
        </p>
      </DetailCard>

      <DetailCard title="Next Steps" icon={<IconCheck />} action={<IconChevron />}>
        <ul className="next-steps">
          <li className="done">
            <span>
              <IconCheck size={14} />
            </span>
            Build the glass UI
          </li>
          <li>
            <span />
            Record {'->'} transcript {'->'} analyzed note
          </li>
          <li>
            <span />
            YouTube URL {'->'} transcript + analysis
          </li>
          <li>
            <span />
            Drag out .md and copy
          </li>
        </ul>
      </DetailCard>

      <DetailCard title="Transcript" icon={<IconWave />} action={<span className="show-action">Show</span>}>
        <p>
          00:00 So the idea is simple. I need a little pane of glass on my desktop that catches
          the thought, cleans it up, and lets me hand the markdown to the next agent.
        </p>
      </DetailCard>

      <div className="action-grid">
        <button type="button">
          <IconPlus />
          <span>
            <strong>Add to note</strong>
            <small>Append a new recording</small>
          </span>
        </button>
        <button type="button">
          <span className="chat-icon" />
          <span>
            <strong>Chat</strong>
            <small>Ask about this note</small>
          </span>
        </button>
      </div>

      <footer className="export-row">
        <strong>Export</strong>
        <button type="button">
          <IconCopy />
          Copy as .md
        </button>
        <div className="drag-handle">
          <IconDrag />
          <span>
            <strong>Drag out</strong>
            <small>Drag the file anywhere</small>
          </span>
        </div>
      </footer>
    </section>
  );
}

function App() {
  const [isIdle, setIsIdle] = useState(false);

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

  return (
    <main className={isIdle ? 'flux-stage is-idle' : 'flux-stage'} style={tokenStyle}>
      <CapturePane />
      <NotePane />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
