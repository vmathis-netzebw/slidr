import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { contentTypeFor, resolveSafePath } from './staticFiles.js';

const ROOT = resolve('/srv/app/dist/client');

describe('resolveSafePath', () => {
  it('löst Pfade innerhalb des Wurzelverzeichnisses auf', () => {
    expect(resolveSafePath(ROOT, '/index.html')).toBe(resolve(ROOT, 'index.html'));
    expect(resolveSafePath(ROOT, '/assets/app.js')).toBe(resolve(ROOT, 'assets/app.js'));
  });

  it('verhindert Ausbrüche aus dem Wurzelverzeichnis', () => {
    for (const path of [
      '/../package.json',
      '/../../etc/passwd',
      '/assets/../../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
    ]) {
      const resolved = resolveSafePath(ROOT, path);
      if (resolved !== null) expect(resolved.startsWith(ROOT)).toBe(true);
    }
  });

  it('lehnt Null-Bytes und kaputtes Encoding ab', () => {
    expect(resolveSafePath(ROOT, '/index%00.html')).toBeNull();
    expect(resolveSafePath(ROOT, '/%')).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('erkennt gängige Dateitypen', () => {
    expect(contentTypeFor('/a/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/a/app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/a/style.CSS')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('/a/unknown.bin')).toBe('application/octet-stream');
  });
});
