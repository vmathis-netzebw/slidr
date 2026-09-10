/**
 * Gemeinsame Typen & Konstanten für Client und Server.
 * Diese Datei darf keine Node- oder DOM-spezifischen APIs verwenden.
 */

export const VALUE_MIN = 0;
export const VALUE_MAX = 100;
export const VALUE_STEP = 1;

export const SESSION_ID_LENGTH = 10;
export const SESSION_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8,12}$/;
export const RESPONSE_ID_PATTERN = /^[a-z0-9]{16,64}$/;

export const QUESTION_MAX_LENGTH = 200;
export const MAX_RESPONSES_PER_SESSION = 10_000;

export type PresenterRole = 'presenter';
export type VoterRole = 'voter';

/** Öffentlich sichtbarer Zustand einer Session (ohne Rohdaten der Teilnehmer). */
export interface SessionStats {
  count: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** 101 Buckets, Index = Wert 0..100 */
  histogram: number[];
}

export interface PresenterSessionState {
  sessionId: string;
  question: string;
  createdAt: number;
  resultsVisible: boolean;
  stats: SessionStats;
}

export interface VoterSessionState {
  sessionId: string;
  question: string;
  /** Hat dieser Browser (responseId) bereits abgestimmt? */
  hasVoted: boolean;
  /** Zuvor abgegebener Wert, falls vorhanden. */
  value: number | null;
  /** Session nimmt keine weiteren Antworten an (Limit erreicht). */
  full: boolean;
}

/* ------------------------------- Client -> Server ------------------------------ */

export interface PresenterHelloMessage {
  type: 'presenter:hello';
  /** Beim ersten Start leer -> Server erzeugt eine neue Session. */
  sessionId?: string;
  question?: string;
}

export interface PresenterUpdateQuestionMessage {
  type: 'presenter:update-question';
  sessionId: string;
  question: string;
}

export interface PresenterClearResponsesMessage {
  type: 'presenter:clear-responses';
  sessionId: string;
}

export interface PresenterResetSessionMessage {
  type: 'presenter:reset-session';
  sessionId: string;
}

export interface PresenterNewSessionMessage {
  type: 'presenter:new-session';
  question?: string;
}

export interface PresenterSetResultsVisibleMessage {
  type: 'presenter:set-results-visible';
  sessionId: string;
  visible: boolean;
}

export interface VoterHelloMessage {
  type: 'voter:hello';
  sessionId: string;
  responseId: string;
}

export interface VoterSubmitMessage {
  type: 'voter:submit';
  sessionId: string;
  responseId: string;
  value: number;
}

export type ClientMessage =
  | PresenterHelloMessage
  | PresenterUpdateQuestionMessage
  | PresenterClearResponsesMessage
  | PresenterResetSessionMessage
  | PresenterNewSessionMessage
  | PresenterSetResultsVisibleMessage
  | VoterHelloMessage
  | VoterSubmitMessage;

/* ------------------------------- Server -> Client ------------------------------ */

export interface PresenterStateMessage {
  type: 'presenter:state';
  state: PresenterSessionState;
}

export interface VoterStateMessage {
  type: 'voter:state';
  state: VoterSessionState;
}

export interface VoterAcceptedMessage {
  type: 'voter:accepted';
  value: number;
}

export type ServerErrorCode =
  | 'invalid-message'
  | 'invalid-session'
  | 'session-not-found'
  | 'invalid-value'
  | 'already-voted'
  | 'session-full'
  | 'rate-limited'
  | 'not-authorized';

export interface ServerErrorMessage {
  type: 'error';
  code: ServerErrorCode;
  message: string;
}

export type ServerMessage =
  | PresenterStateMessage
  | VoterStateMessage
  | VoterAcceptedMessage
  | ServerErrorMessage;
