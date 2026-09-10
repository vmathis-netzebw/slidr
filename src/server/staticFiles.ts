import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Löst einen URL-Pfad sicher innerhalb von `root` auf.
 * Gibt `null` zurück, wenn der Pfad das Wurzelverzeichnis verlassen würde.
 */
export function resolveSafePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const absoluteRoot = resolve(root);
  const candidate = resolve(join(absoluteRoot, normalized));

  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + sep)) return null;
  return candidate;
}

export interface ServeResult {
  served: boolean;
}

export async function serveStatic(
  root: string,
  urlPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  { immutable = false }: { immutable?: boolean } = {},
): Promise<ServeResult> {
  const filePath = resolveSafePath(root, urlPath);
  if (!filePath) return { served: false };

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return { served: false };
  }
  if (!stats.isFile()) return { served: false };

  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Content-Length', String(stats.size));
  res.setHeader(
    'Cache-Control',
    immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  );

  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return { served: true };
  }

  res.writeHead(200);
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
  return { served: true };
}
