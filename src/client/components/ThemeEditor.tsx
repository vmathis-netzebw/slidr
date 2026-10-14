import { useState } from 'react';
import { DEFAULT_THEME, LOGO_MAX_BYTES, THEME_KEYS, THEME_LABELS, logoUrl, type Theme } from '../../shared/theme.js';

interface ThemeEditorProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

export function ThemeEditor({ theme, onChange }: ThemeEditorProps): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<void> => {
    setError(null);
    if (file.size > LOGO_MAX_BYTES) {
      setError('Logo zu groß (max. 512 KB).');
      return;
    }
    setUploading(true);
    try {
      const response = await fetch('/api/logos', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/octet-stream' },
        body: file,
      });
      const data = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !data?.id) throw new Error(data?.error ?? `Fehler ${response.status}`);
      onChange({ ...theme, logo: data.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload fehlgeschlagen.');
    } finally {
      setUploading(false);
    }
  };

  const { logo, ...colors } = theme;

  return (
    <div className="theme-editor">
      {THEME_KEYS.map((key) => (
        <label key={key} className="theme-editor__item">
          <input
            type="color"
            className="theme-editor__swatch"
            value={theme[key]}
            onChange={(e) => onChange({ ...theme, [key]: e.target.value })}
          />
          <span>
            {THEME_LABELS[key]}
            <code>{theme[key]}</code>
          </span>
        </label>
      ))}
      <button
        type="button"
        className="link-button"
        onClick={() => onChange({ ...DEFAULT_THEME, ...(logo ? { logo } : {}) })}
      >
        Standardfarben
      </button>

      <div className="theme-editor__logo">
        {logo ? <img className="theme-editor__logo-preview" src={logoUrl(logo)} alt="Logo" /> : null}
        <label className="button">
          {uploading ? 'Lade hoch …' : logo ? 'Logo ersetzen' : 'Logo hochladen'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
        {logo ? (
          <button type="button" className="link-button" onClick={() => onChange(colors)}>
            Logo entfernen
          </button>
        ) : null}
        {error ? <span className="theme-editor__error">{error}</span> : null}
      </div>
    </div>
  );
}
