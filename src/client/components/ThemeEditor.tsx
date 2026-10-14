import { DEFAULT_THEME, THEME_KEYS, THEME_LABELS, type Theme } from '../../shared/theme.js';

interface ThemeEditorProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

export function ThemeEditor({ theme, onChange }: ThemeEditorProps): JSX.Element {
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
      <button type="button" className="link-button" onClick={() => onChange({ ...DEFAULT_THEME })}>
        Standardfarben
      </button>
    </div>
  );
}
