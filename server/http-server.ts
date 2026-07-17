import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { fluxWorkingListItemLimit } from '../shared/flux-contract.js';

export const fluxHttpHost = '127.0.0.1';
export const fluxHttpPort = 4783;

type FluxHttpCore = {
  listLibrary: () => unknown;
  readNote: (payload: { noteId: string; folder: string }) => unknown;
  createTextNote: (payload: { title: string; content: string; folder?: string }) => unknown;
  saveRecording: (payload: { audioData: Uint8Array; mimeType: string }) => Promise<unknown>;
  saveYouTubeUrl: (payload: { url: string }) => Promise<unknown>;
  readVideoDigestRequest: () => unknown;
  saveVideoDigestRequest: (payload: {
    url: string;
    sourceNote?: { noteId: string; folder: string };
  }) => unknown;
  createFolder: (name: string) => unknown;
  moveNote: (locator: { noteId: string; folder: string }, targetFolder: string) => unknown;
  readWorkingList: () => unknown;
  saveWorkingList: (payload: { title: string; items: string[] }) => unknown;
  readCaptureDraft?: () => unknown;
  saveCaptureDraft?: (payload: { text: string }) => unknown;
};

type FluxHttpServerOptions = {
  core: FluxHttpCore;
  staticDir: string;
  host?: string;
  port?: number;
};

const jsonLimit = 2 * 1024 * 1024;
const recordingLimit = 36 * 1024 * 1024;
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isAllowedHost(hostHeader: string | undefined) {
  if (!hostHeader) {
    return false;
  }
  return /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(hostHeader.trim());
}

function setBaseHeaders(response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  setBaseHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, error: unknown) {
  const message = error instanceof Error ? error.message : 'Flux could not complete that request.';
  sendJson(response, status, { error: message });
}

function rejectUnsafeApiMutation(request: IncomingMessage, response: ServerResponse, url: URL) {
  const method = request.method ?? 'GET';
  if (!mutatingMethods.has(method)) {
    return false;
  }

  const origin = request.headers.origin;
  if (origin && origin !== url.origin) {
    sendError(response, 403, new Error('Flux rejected this origin.'));
    return true;
  }

  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') {
    sendError(response, 403, new Error('Flux rejected this cross-origin request.'));
    return true;
  }

  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    sendError(response, 415, new Error('Flux API mutations require application/json.'));
    return true;
  }

  return false;
}
async function readJson(request: IncomingMessage, limit = jsonLimit) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > limit) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {} as Record<string, unknown>;
  }

  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength = 1_000_000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} is too long.`);
  }
  return value;
}

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveStatic(response: ServerResponse, staticDir: string, pathname: string) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(staticDir, requested);
  const safeRoot = `${path.resolve(staticDir)}${path.sep}`;
  const selected = candidate.startsWith(safeRoot) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : path.join(staticDir, 'index.html');

  if (!existsSync(selected) || !statSync(selected).isFile()) {
    sendError(response, 503, new Error('Flux browser files are not built yet.'));
    return;
  }

  setBaseHeaders(response);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(selected));
  if (path.basename(selected) === 'index.html') {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
    );
  }
  createReadStream(selected).pipe(response);
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  core: FluxHttpCore
) {
  const method = request.method ?? 'GET';
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { ok: true, product: 'Flux' });
    return;
  }
  if (method === 'GET' && pathname === '/api/library') {
    sendJson(response, 200, await core.listLibrary());
    return;
  }
  if (method === 'GET' && pathname === '/api/notes/read') {
    const noteId = requireString(url.searchParams.get('noteId'), 'noteId', 160);
    const folder = requireString(url.searchParams.get('folder'), 'folder', 64);
    sendJson(response, 200, await core.readNote({ noteId, folder }));
    return;
  }
  if (method === 'POST' && pathname === '/api/notes/text') {
    const body = await readJson(request);
    sendJson(
      response,
      201,
      await core.createTextNote({
        title: requireString(body.title, 'title', 120),
        content: requireString(body.content, 'content'),
        folder: typeof body.folder === 'string' ? body.folder : undefined
      })
    );
    return;
  }
  if (method === 'POST' && pathname === '/api/youtube') {
    const body = await readJson(request);
    sendJson(response, 201, await core.saveYouTubeUrl({ url: requireString(body.url, 'url', 2048) }));
    return;
  }
  if (method === 'GET' && pathname === '/api/video-digest-request') {
    sendJson(response, 200, await core.readVideoDigestRequest());
    return;
  }
  if (method === 'PUT' && pathname === '/api/video-digest-request') {
    const body = await readJson(request);
    let sourceNote: { noteId: string; folder: string } | undefined;
    if (body.sourceNote !== undefined) {
      if (!body.sourceNote || typeof body.sourceNote !== 'object' || Array.isArray(body.sourceNote)) {
        throw new Error('sourceNote must be a note identifier and folder.');
      }
      const source = body.sourceNote as Record<string, unknown>;
      sourceNote = {
        noteId: requireString(source.noteId, 'sourceNote.noteId', 160),
        folder: requireString(source.folder, 'sourceNote.folder', 64)
      };
    }
    sendJson(
      response,
      200,
      await core.saveVideoDigestRequest({
        url: requireString(body.url, 'url', 2048),
        ...(sourceNote ? { sourceNote } : {})
      })
    );
    return;
  }
  if (method === 'POST' && pathname === '/api/recordings') {
    const body = await readJson(request, recordingLimit);
    const audioBase64 = requireString(body.audioBase64, 'audioBase64', recordingLimit);
    const mimeType = requireString(body.mimeType, 'mimeType', 120);
    sendJson(
      response,
      201,
      await core.saveRecording({ audioData: Uint8Array.from(Buffer.from(audioBase64, 'base64')), mimeType })
    );
    return;
  }
  if (method === 'POST' && pathname === '/api/folders') {
    const body = await readJson(request);
    sendJson(response, 201, await core.createFolder(requireString(body.name, 'name', 64)));
    return;
  }
  if (method === 'POST' && pathname === '/api/notes/move') {
    const body = await readJson(request);
    sendJson(
      response,
      200,
      await core.moveNote(
        {
          noteId: requireString(body.noteId, 'noteId', 160),
          folder: requireString(body.folder, 'folder', 64)
        },
        requireString(body.targetFolder, 'targetFolder', 64)
      )
    );
    return;
  }
  if (method === 'GET' && pathname === '/api/working-list') {
    sendJson(response, 200, await core.readWorkingList());
    return;
  }
  if (method === 'PUT' && pathname === '/api/working-list') {
    const body = await readJson(request);
    if (!Array.isArray(body.items) || body.items.some((item) => typeof item !== 'string')) {
      throw new Error('items must be an array of text values.');
    }
    if (body.items.length > fluxWorkingListItemLimit) {
      throw new Error('The working list has too many items.');
    }
    sendJson(
      response,
      200,
      await core.saveWorkingList({
        title: typeof body.title === 'string' ? body.title : '',
        items: body.items as string[]
      })
    );
    return;
  }
  if (method === 'GET' && pathname === '/api/capture-draft' && core.readCaptureDraft) {
    sendJson(response, 200, await core.readCaptureDraft());
    return;
  }
  if (method === 'PUT' && pathname === '/api/capture-draft' && core.saveCaptureDraft) {
    const body = await readJson(request);
    sendJson(response, 200, await core.saveCaptureDraft({ text: typeof body.text === 'string' ? body.text : '' }));
    return;
  }

  sendError(response, 404, new Error('Flux route not found.'));
}

export async function startFluxHttpServer({
  core,
  staticDir,
  host = fluxHttpHost,
  port = fluxHttpPort
}: FluxHttpServerOptions) {
  const server = createServer(async (request, response) => {
    if (!isAllowedHost(request.headers.host)) {
      sendError(response, 403, new Error('Flux rejected this host.'));
      return;
    }

    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        if (rejectUnsafeApiMutation(request, response, url)) {
          return;
        }
        await handleApi(request, response, url, core);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendError(response, 405, new Error('Method not allowed.'));
        return;
      }
      serveStatic(response, staticDir, url.pathname);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendError(response, 400, new Error('Request body must contain valid JSON.'));
        return;
      }
      sendError(response, 422, new Error('Flux could not complete that request.'));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    url: `http://${host}:${activePort}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
