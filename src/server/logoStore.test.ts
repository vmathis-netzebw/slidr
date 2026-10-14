import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTheme } from '../shared/theme.js';
import { LogoStore, detectLogoType } from './logoStore.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('LogoStore', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('erkennt Formate am Inhalt', () => {
    expect(detectLogoType(PNG)).toBe('png');
    expect(detectLogoType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(detectLogoType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });

  it('speichert inhaltsadressiert und liest wieder', async () => {
    dir = mkdtempSync(join(tmpdir(), 'logos-'));
    const store = new LogoStore(dir);
    const id = await store.save(PNG);
    expect(id).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(await store.save(PNG)).toBe(id);
    expect((await store.read(id!))?.contentType).toBe('image/png');
    expect(await store.read('../feedback.sqlite')).toBeNull();
  });

  it('Theme akzeptiert nur gültige Logo-IDs', () => {
    expect(parseTheme({ logo: `${'a'.repeat(32)}.png` })?.logo).toBe(`${'a'.repeat(32)}.png`);
    expect(parseTheme({ logo: 'https://evil.example/x.png' })).toBeNull();
  });
});
