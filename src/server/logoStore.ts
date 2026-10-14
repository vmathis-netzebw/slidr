import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOGO_ID_PATTERN } from '../shared/theme.js';

export const LOGO_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const;

export type LogoExtension = keyof typeof LOGO_TYPES;

/** Erkennt das Bildformat anhand des Inhalts statt des angegebenen Content-Types. */
export function detectLogoType(data: Buffer): LogoExtension | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 6).toString('latin1') === 'GIF87a' || data.subarray(0, 6).toString('latin1') === 'GIF89a') return 'gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = data.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

/** Logos liegen inhaltsadressiert im Dateisystem, damit Sessions und Bögen nur eine kurze ID tragen. */
export class LogoStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async save(data: Buffer): Promise<string | null> {
    const ext = detectLogoType(data);
    if (!ext) return null;
    const id = `${createHash('sha256').update(data).digest('hex').slice(0, 32)}.${ext}`;
    await writeFile(join(this.dir, id), data, { flag: 'w' });
    return id;
  }

  async read(id: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (!LOGO_ID_PATTERN.test(id)) return null;
    try {
      const data = await readFile(join(this.dir, id));
      const ext = id.slice(id.lastIndexOf('.') + 1) as LogoExtension;
      return { data, contentType: LOGO_TYPES[ext] };
    } catch {
      return null;
    }
  }
}
