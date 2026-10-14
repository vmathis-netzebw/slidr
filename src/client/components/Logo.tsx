import { logoUrl, type Theme } from '../../shared/theme.js';

export function Logo({ theme, className = '' }: { theme: Theme | undefined; className?: string }): JSX.Element | null {
  if (!theme?.logo) return null;
  return <img className={`logo ${className}`.trim()} src={logoUrl(theme.logo)} alt="Logo" />;
}
