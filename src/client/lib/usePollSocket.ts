import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { PollSocket, type ConnectionStatus } from './socket.js';

export type SendMessage = (message: ClientMessage) => void;

export interface UsePollSocketResult {
  status: ConnectionStatus;
  send: SendMessage;
}

/**
 * Baut eine WebSocket-Verbindung auf und hält sie am Leben.
 * `onOpen` wird nach jedem Reconnect erneut ausgeführt, um den Serverzustand zu holen.
 */
export function usePollSocket(
  onMessage: (message: ServerMessage) => void,
  onOpen: (send: SendMessage) => void,
): UsePollSocketResult {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const messageRef = useRef(onMessage);
  const openRef = useRef(onOpen);
  const socketRef = useRef<PollSocket | null>(null);

  messageRef.current = onMessage;
  openRef.current = onOpen;

  useEffect(() => {
    const socket = new PollSocket({
      onMessage: (message) => messageRef.current(message),
      onStatus: setStatus,
      onOpen: () => openRef.current((message) => socket.send(message)),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      status,
      send: (message: ClientMessage) => socketRef.current?.send(message),
    }),
    [status],
  );
}
