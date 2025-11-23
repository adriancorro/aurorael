import crypto from "crypto";
import { SESSION_DURATION_MS } from "../config/constants.js";

const SESSIONS = new Map();

export function getOrCreateSession(id) {
  if (id && SESSIONS.has(id)) {
    const s = SESSIONS.get(id);
    if (Date.now() - s.createdAt < SESSION_DURATION_MS)
      return { id, session: s };
    SESSIONS.delete(id);
  }
  const newId = crypto.randomUUID();
  const session = {
    history: [],
    lastLocation: null,
    createdAt: Date.now(),
  };
  SESSIONS.set(newId, session);
  return { id: newId, session };
}

export function pushHistory(session, role, content) {
  session.history.push({ role, content });
}
