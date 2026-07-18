import { create } from 'zustand';
import type { CloudAgentSession, CloudAgentTurn, CloudAgentTurnStatus } from '@/types/cloudAgent';

interface CloudAgentSessionsState {
  sessions: CloudAgentSession[];
  mergeSessions: (incoming: CloudAgentSession[]) => void;
  patchRunningTurn: (
    sessionId: string,
    patch: Partial<Pick<CloudAgentTurn, 'thought' | 'thoughtStreaming' | 'response'>>,
  ) => void;
  setSessionStatus: (sessionId: string, status: CloudAgentTurnStatus) => void;
  removeSession: (sessionId: string) => void;
  clearSessions: () => void;
}

function mergeSession(
  existing: CloudAgentSession | undefined,
  incoming: CloudAgentSession,
): CloudAgentSession {
  if (
    existing &&
    existing.status === 'running' &&
    incoming.status === 'running' &&
    existing.turns.length === incoming.turns.length
  ) {
    return { ...incoming, turns: existing.turns };
  }

  return incoming;
}

export const useCloudAgentSessionsStore = create<CloudAgentSessionsState>((set) => ({
  sessions: [],
  mergeSessions: (incoming) =>
    set((state) => {
      const existingById = new Map(state.sessions.map((session) => [session.id, session]));

      return {
        sessions: incoming.map((session) => mergeSession(existingById.get(session.id), session)),
      };
    }),
  patchRunningTurn: (sessionId, patch) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        let patched = false;

        const turns = session.turns
          .slice()
          .reverse()
          .map((turn) => {
            if (!patched && turn.status === 'running') {
              patched = true;
              return { ...turn, ...patch };
            }

            return turn;
          })
          .reverse();

        return { ...session, turns };
      }),
    })),
  setSessionStatus: (sessionId, status) =>
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          status,
          turns: session.turns.map((turn) =>
            turn.status === 'running'
              ? { ...turn, status, thoughtStreaming: false, endedAt: Date.now() }
              : turn,
          ),
        };
      }),
    })),
  removeSession: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== sessionId),
    })),
  clearSessions: () => set({ sessions: [] }),
}));
