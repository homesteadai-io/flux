const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const YTDLP_TIMEOUT_MS = 180000;

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      shell: false
    });

    let stdout = '';
    let stderr = '';
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
        }, options.timeoutMs)
      : null;

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ ok: false, code: null, stdout, stderr, error });
    });
    child.on('close', (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function ytDlpCandidates() {
  const candidates = [];
  if (process.env.FLUX_YTDLP_PATH) {
    candidates.push({ command: process.env.FLUX_YTDLP_PATH, args: [] });
  }

  candidates.push(
    { command: 'yt-dlp', args: [] },
    { command: 'py', args: ['-m', 'yt_dlp'] },
    { command: 'python', args: ['-m', 'yt_dlp'] },
    { command: 'python3', args: ['-m', 'yt_dlp'] }
  );
  return candidates;
}

async function usableYtDlp() {
  for (const candidate of ytDlpCandidates()) {
    const result = await runCommand(candidate.command, [...candidate.args, '--version'], {
      timeoutMs: 15000
    });
    if (result.ok) {
      return candidate;
    }
  }
  return null;
}

async function installYtDlp() {
  const installers = [
    { command: 'py', args: ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'] },
    { command: 'python', args: ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'] },
    { command: 'python3', args: ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'] }
  ];

  for (const installer of installers) {
    const result = await runCommand(installer.command, installer.args, {
      timeoutMs: YTDLP_TIMEOUT_MS
    });
    if (result.ok) {
      return usableYtDlp();
    }
  }
  return null;
}

async function ensureYtDlp() {
  return (await usableYtDlp()) || installYtDlp();
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function cleanCueLine(line) {
  return decodeEntities(line)
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLine(line) {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function vttLines(vttText) {
  const lines = [];
  const rawLines = vttText.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) {
      continue;
    }
    if (line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
      continue;
    }
    if (/^\d+$/.test(line)) {
      continue;
    }
    if (line.includes('-->')) {
      continue;
    }

    const cleaned = cleanCueLine(line);
    if (cleaned) {
      lines.push(cleaned);
    }
  }

  return lines;
}

function dedupeLines(lines) {
  const deduped = [];

  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (!normalized) {
      continue;
    }

    const previous = deduped[deduped.length - 1];
    const previousNormalized = previous ? normalizeLine(previous) : '';

    if (normalized === previousNormalized) {
      continue;
    }
    if (previousNormalized && previousNormalized.endsWith(normalized)) {
      continue;
    }

    if (previousNormalized && normalized.startsWith(previousNormalized)) {
      deduped[deduped.length - 1] = line;
      continue;
    }

    deduped.push(line);
  }

  return deduped;
}

function paragraphize(lines) {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  const pieces = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const paragraphs = [];
  let current = '';

  for (const piece of pieces.map((item) => item.trim()).filter(Boolean)) {
    if (current && `${current} ${piece}`.length > 680) {
      paragraphs.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }

  if (current) {
    paragraphs.push(current);
  }
  return paragraphs.join('\n\n');
}

function cleanVttTranscript(vttText) {
  return paragraphize(dedupeLines(vttLines(vttText)));
}

async function collectVttFiles(directory) {
  const entries = await fs.readdir(directory, { recursive: true });
  return entries
    .filter((entry) => entry.toLowerCase().endsWith('.vtt'))
    .map((entry) => path.join(directory, entry));
}

async function getCleanTranscript(url) {
  const trimmedUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    return { ok: false, reason: 'BAD_URL', message: 'Paste a full video URL first.' };
  }

  const ytDlp = await ensureYtDlp();
  if (!ytDlp) {
    return {
      ok: false,
      reason: 'YTDLP_MISSING',
      message: 'Could not find or auto-install yt-dlp. Install Python, then try again.'
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-youtube-'));
  try {
    const outputTemplate = path.join(tempDir, 'caption.%(ext)s');
    const result = await runCommand(
      ytDlp.command,
      [
        ...ytDlp.args,
        '--skip-download',
        '--no-playlist',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'en.*,en',
        '--sub-format',
        'vtt/best',
        '--output',
        outputTemplate,
        trimmedUrl
      ],
      { timeoutMs: YTDLP_TIMEOUT_MS }
    );

    const files = await collectVttFiles(tempDir);
    if (!files.length) {
      return {
        ok: false,
        reason: 'NO_CAPTIONS',
        message:
          'No caption track was found for this video. Audio-only transcription can be added later; no video was downloaded.',
        detail: result.stderr || result.stdout
      };
    }

    const chunks = [];
    for (const file of files) {
      chunks.push(await fs.readFile(file, 'utf8'));
    }

    const transcript = cleanVttTranscript(chunks.join('\n\n'));
    if (!transcript) {
      return {
        ok: false,
        reason: 'EMPTY_TRANSCRIPT',
        message: 'A caption file was found, but it did not contain readable transcript text.'
      };
    }

    return { ok: true, transcript };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  cleanVttTranscript,
  getCleanTranscript
};
