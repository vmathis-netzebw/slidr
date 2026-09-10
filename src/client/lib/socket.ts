import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Wird nach jedem (Re-)Connect aufgerufen, um den Serverzustand neu zu laden. */
  onOpen?: () => void;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Dünne Hülle um WebSocket mit automatischem Reconnect und Sende-Puffer. */
export class PollSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private closedByUser = false;
  private readonly queue: string[] = [];

  constructor(private readonly handlers: SocketHandlers) {}

  connect(): void {
    if (this.closedByUser) return;
    this.clearTimer();

    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus('open');
      while (this.queue.length > 0) {
        const payload = this.queue.shift();
        if (payload !== undefined) socket.send(payload);
      }
      this.handlers.onOpen?.();
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
        this.handlers.onMessage(parsed as ServerMessage);
      }
    };

    socket.onerror = () => {
      /* onclose übernimmt den Reconnect. */
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.closedByUser) {
        this.handlers.onStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  send(message: ClientMessage): void {
    const payload = JSON.stringify(message);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
      return;
    }
    if (this.queue.length < 20) this.queue.push(payload);
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimer();
    this.socket?.close();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    this.handlers.onStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 15000;
    this.attempt += 1;
    this.clearTimer();
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
