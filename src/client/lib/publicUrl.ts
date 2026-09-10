/**
 * Basis-URL für die Teilnehmer-Links.
 * PUBLIC_URL vom Server hat Vorrang, sonst wird die aktuelle Browser-URL verwendet.
 */
export async function fetchPublicOrigin(signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch('/api/config', signal ? { signal } : undefined);
    if (response.ok) {
      const data: unknown = await response.json();
      if (typeof data === 'object' && data !== null) {
        const publicUrl = (data as { publicUrl?: unknown }).publicUrl;
        if (typeof publicUrl === 'string' && publicUrl.length > 0) {
          return publicUrl.replace(/\/+$/, '');
        }
      }
    }
  } catch {
    // Fallback unten
  }
  return window.location.origin;
}

export function voteUrlFor(origin: string, sessionId: string): string {
  return `${origin.replace(/\/+$/, '')}/vote/${sessionId}`;
}
