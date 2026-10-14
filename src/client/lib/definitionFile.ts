import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseDefinition, type FeedbackDefinition, type ParseResult } from '../../shared/feedback.js';

export type DefinitionFormat = 'json' | 'yaml';

/** Liest eine Definition aus JSON oder YAML (YAML ist eine Obermenge von JSON). */
export function importDefinition(text: string): ParseResult<FeedbackDefinition> {
  let data: unknown;
  try {
    data = parseYaml(text, { maxAliasCount: 100 });
  } catch (error) {
    return { ok: false, errors: [`Datei konnte nicht gelesen werden: ${(error as Error).message}`] };
  }
  return parseDefinition(data);
}

export function exportDefinition(definition: FeedbackDefinition, format: DefinitionFormat): string {
  return format === 'json' ? `${JSON.stringify(definition, null, 2)}\n` : stringifyYaml(definition);
}

export function downloadText(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'feedback'
  );
}

export function downloadDefinition(definition: FeedbackDefinition, format: DefinitionFormat): void {
  downloadText(
    `${slugify(definition.title)}.${format === 'json' ? 'json' : 'yaml'}`,
    exportDefinition(definition, format),
    format === 'json' ? 'application/json' : 'application/yaml',
  );
}
