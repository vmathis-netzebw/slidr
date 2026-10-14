import {
  POLE_LABEL_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  RESPONSE_ID_PATTERN,
  SESSION_ID_PATTERN,
  type ClientMessage,
} from '../shared/protocol.js';
import { parseTheme } from '../shared/theme.js';
import { isValidValue } from './sessionStore.js';

export const MAX_MESSAGE_BYTES = 4 * 1024;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function isValidResponseId(value: unknown): value is string {
  return typeof value === 'string' && RESPONSE_ID_PATTERN.test(value);
}

function isOptionalQuestion(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= QUESTION_MAX_LENGTH * 4);
}

function isOptionalPoleLabel(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'string' && value.length <= POLE_LABEL_MAX_LENGTH * 4)
  );
}

/** Übernimmt nur tatsächlich gesetzte Label-Felder, damit `undefined` "unverändert" bedeutet. */
function poleLabelsOf(message: Record<string, unknown>): {
  leftLabel?: string;
  rightLabel?: string;
} {
  return {
    ...(typeof message.leftLabel === 'string' ? { leftLabel: message.leftLabel } : {}),
    ...(typeof message.rightLabel === 'string' ? { rightLabel: message.rightLabel } : {}),
  };
}

/**
 * Parst und validiert eine eingehende WebSocket-Nachricht.
 * Gibt `null` zurück, wenn die Nachricht nicht dem Protokoll entspricht.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (typeof message.type !== 'string') return null;

  switch (message.type) {
    case 'presenter:hello':
      if (message.sessionId !== undefined && !isValidSessionId(message.sessionId)) return null;
      if (!isOptionalQuestion(message.question)) return null;
      if (!isOptionalPoleLabel(message.leftLabel) || !isOptionalPoleLabel(message.rightLabel)) return null;
      return {
        type: 'presenter:hello',
        ...(typeof message.sessionId === 'string' ? { sessionId: message.sessionId } : {}),
        ...(typeof message.question === 'string' ? { question: message.question } : {}),
        ...poleLabelsOf(message),
      };

    case 'presenter:new-session': {
      if (!isOptionalQuestion(message.question)) return null;
      if (!isOptionalPoleLabel(message.leftLabel) || !isOptionalPoleLabel(message.rightLabel)) return null;
      const theme = parseTheme(message.theme);
      if (theme === null) return null;
      return {
        type: 'presenter:new-session',
        ...(typeof message.question === 'string' ? { question: message.question } : {}),
        ...poleLabelsOf(message),
        ...(theme ? { theme } : {}),
      };
    }

    case 'presenter:update-question':
      if (!isValidSessionId(message.sessionId)) return null;
      if (typeof message.question !== 'string' || !isOptionalQuestion(message.question)) return null;
      if (!isOptionalPoleLabel(message.leftLabel) || !isOptionalPoleLabel(message.rightLabel)) return null;
      return {
        type: 'presenter:update-question',
        sessionId: message.sessionId,
        question: message.question,
        ...poleLabelsOf(message),
      };

    case 'presenter:clear-responses':
      if (!isValidSessionId(message.sessionId)) return null;
      return { type: 'presenter:clear-responses', sessionId: message.sessionId };

    case 'presenter:reset-session':
      if (!isValidSessionId(message.sessionId)) return null;
      return { type: 'presenter:reset-session', sessionId: message.sessionId };

    case 'presenter:set-results-visible':
      if (!isValidSessionId(message.sessionId)) return null;
      if (typeof message.visible !== 'boolean') return null;
      return {
        type: 'presenter:set-results-visible',
        sessionId: message.sessionId,
        visible: message.visible,
      };

    case 'voter:hello':
      if (!isValidSessionId(message.sessionId)) return null;
      if (!isValidResponseId(message.responseId)) return null;
      return {
        type: 'voter:hello',
        sessionId: message.sessionId,
        responseId: message.responseId,
      };

    case 'voter:submit':
      if (!isValidSessionId(message.sessionId)) return null;
      if (!isValidResponseId(message.responseId)) return null;
      if (!isValidValue(message.value)) return null;
      return {
        type: 'voter:submit',
        sessionId: message.sessionId,
        responseId: message.responseId,
        value: message.value,
      };

    default:
      return null;
  }
}
