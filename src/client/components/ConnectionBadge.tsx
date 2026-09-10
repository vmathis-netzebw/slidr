import type { ConnectionStatus } from '../lib/socket.js';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Verbinde …',
  open: 'Verbunden',
  reconnecting: 'Verbindung unterbrochen – neuer Versuch …',
  closed: 'Getrennt',
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }): JSX.Element {
  return (
    <span className={`badge badge--${status}`} role="status" aria-live="polite">
      <span className="badge__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
