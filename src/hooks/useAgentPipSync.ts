import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCloudAgentSessionsStore } from '@/stores/useCloudAgentSessionsStore';
import { useAgentPipStore } from '@/stores/useAgentPipStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import type { AgentPipHostRequest } from '@/types/agentPip';
import type { AgentTab, Project } from '@/types';
import type { AgentContextUsageSnapshot } from '@/utils/agentContextUsageParser';
import {
  acceptAgentPanePlan,
  cancelAgentPaneEdit,
  editAgentPaneFollowUp,
  editAgentPaneTurn,
  flushAgentPaneFollowUp,
  getAgentPaneLiveTranscript,
  rejectAgentPanePlan,
  removeAgentPaneFollowUp,
  sendAgentPaneFollowUpNow,
  stopAgentPane,
  submitAgentPanePrompt,
  submitAgentPaneQuestion,
  writeAgentPaneDraft,
  runAgentPaneCommand,
  redoAgentPaneTurn,
} from '@/utils/agentPaneRegistry';
import {
  buildCloudAgentPipSnapshot,
  buildDesktopAgentPipSnapshot,
  CLOUD_AGENT_PIP_PREFIX,
  readLogoDataUrl,
} from '@/utils/agentPipSnapshot';
import { sanitizeAgentFollowUps, slimAgentTurnsForPip } from '@/utils/trimAgentTurnHistory';

interface DesktopAgentSlot {
  project: Project;
  pane: AgentTab;
}

async function handleHostCommand(request: AgentPipHostRequest): Promise<boolean> {
  switch (request.type) {
    case 'submit':
      return submitAgentPanePrompt(request.paneId, request.prompt, request.options);
    case 'stop':
      return stopAgentPane(request.paneId);
    case 'write':
      return writeAgentPaneDraft(request.paneId, request.text);
    case 'runCommand':
      return runAgentPaneCommand(request.paneId, request.command);
    case 'redo':
      return redoAgentPaneTurn(request.paneId, request.turnId);
    case 'editTurn':
      return editAgentPaneTurn(request.paneId, request.turnId);
    case 'cancelEdit':
      return cancelAgentPaneEdit(request.paneId);
    case 'flushFollowUp':
      return flushAgentPaneFollowUp(request.paneId);
    case 'sendFollowUpNow':
      return sendAgentPaneFollowUpNow(request.paneId, request.id);
    case 'removeFollowUp':
      return removeAgentPaneFollowUp(request.paneId, request.id);
    case 'editFollowUp':
      return editAgentPaneFollowUp(request.paneId, request.id);
    case 'question':
      return submitAgentPaneQuestion(request.paneId, request.activityId, request.answers);
    case 'acceptPlan':
      return acceptAgentPanePlan(request.paneId, request.activityId);
    case 'rejectPlan':
      return rejectAgentPanePlan(request.paneId, request.activityId);
    case 'ackViewed': {
      const rawId = request.paneId;
      const cloudId = rawId.startsWith(CLOUD_AGENT_PIP_PREFIX)
        ? rawId.slice(CLOUD_AGENT_PIP_PREFIX.length)
        : rawId;
      useProjectNotificationStore.getState().clearNotificationForPane(rawId);
      useProjectNotificationStore.getState().clearNotificationForPane(cloudId);
      return true;
    }
    default:
      return false;
  }
}

const PIP_SYNC_MS = 400;

function liveAgentTabParts(pane: AgentTab): {
  turns: AgentTab['turns'];
  followUps: NonNullable<AgentTab['followUps']>;
  contextUsage: AgentContextUsageSnapshot | null;
} {
  const live = getAgentPaneLiveTranscript(pane.id);

  return {
    turns: live?.turns ?? pane.turns ?? [],
    followUps: live?.followUps ?? pane.followUps ?? [],
    contextUsage: live?.contextUsage ?? null,
  };
}

function cloneAgentTab(
  pane: AgentTab,
  turns: AgentTab['turns'],
  followUps: NonNullable<AgentTab['followUps']>,
): AgentTab {
  const slimTurns = slimAgentTurnsForPip(turns ?? []);
  const slimFollowUps = sanitizeAgentFollowUps(followUps);

  try {
    return {
      ...pane,
      turns: structuredClone(slimTurns),
      followUps: structuredClone(slimFollowUps),
    };
  } catch {
    return {
      ...pane,
      turns: slimTurns,
      followUps: slimFollowUps,
    };
  }
}

function transcriptFingerprint(
  turns: AgentTab['turns'],
  followUps: NonNullable<AgentTab['followUps']>,
  busy: boolean,
  contextPercent = 0,
  pinging = false,
): string {
  const list = turns ?? [];
  const lastTurn = list[list.length - 1];
  const activities = lastTurn?.activities ?? [];
  const activityKey = activities
    .map(
      (activity) =>
        `${activity.id}:${activity.kind}:${activity.label.length}:${activity.streaming ? 1 : 0}`,
    )
    .join(',');

  return [
    busy ? '1' : '0',
    list.length,
    lastTurn?.id ?? '',
    lastTurn?.running ? '1' : '0',
    lastTurn?.activities[lastTurn.activities.length - 1]?.label.length ?? 0,
    lastTurn?.activities[lastTurn.activities.length - 1]?.kind ?? '',
    activityKey,
    followUps.length,
    followUps[followUps.length - 1]?.id ?? '',
    followUps[followUps.length - 1]?.content.length ?? 0,
    contextPercent,
    pinging ? '1' : '0',
  ].join('|');
}

function resolveDesktopPipBusy(pane: AgentTab, turns: AgentTab['turns']): boolean {
  if ((turns ?? []).some((turn) => turn.running)) {
    return true;
  }

  const session = useTerminalSessionStore.getState();

  if (!pane.ptyId && session.pendingLaunchCommands[pane.id]) {
    return true;
  }

  if (session.agentPrintRunTokenByPane[pane.id]) {
    return true;
  }

  return Boolean(session.awaitingResponseByPane[pane.id] && session.agentBusyByPane[pane.id]);
}

function cloudFingerprint(
  session: {
    id: string;
    status: string;
    turns: Array<{ id: string; status: string; response: string; thought: string }>;
  },
  pinging: boolean,
): string {
  const last = session.turns[session.turns.length - 1];

  return [
    session.id,
    session.status,
    session.turns.length,
    last?.id ?? '',
    last?.status ?? '',
    last?.response.length ?? 0,
    last?.thought.length ?? 0,
    pinging ? '1' : '0',
  ].join('|');
}

export function useAgentPipSync(slots: DesktopAgentSlot[]) {
  const paneId = useAgentPipStore((state) => state.paneId);
  const clearLocal = useAgentPipStore((state) => state.clearLocal);
  const unpin = useAgentPipStore((state) => state.unpin);
  const cloudSessions = useCloudAgentSessionsStore(useShallow((state) => state.sessions));
  const notifiedPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );
  const lastPaneIdRef = useRef<string | null>(null);
  const lastFingerprintRef = useRef<string | null>(null);
  const snapshotRevisionRef = useRef(0);
  const slotsRef = useRef(slots);
  const cloudSessionsRef = useRef(cloudSessions);
  const notifiedPaneByProjectRef = useRef(notifiedPaneByProject);
  const logoCacheRef = useRef<{ key: string; value: string | null } | null>(null);
  const unpinRef = useRef(unpin);

  slotsRef.current = slots;
  cloudSessionsRef.current = cloudSessions;
  notifiedPaneByProjectRef.current = notifiedPaneByProject;
  unpinRef.current = unpin;

  useEffect(() => window.nexus.agentPip?.onUnpinned(clearLocal), [clearLocal]);

  useEffect(() => {
    if (!window.nexus?.agentPip?.onHostCommand) {
      return;
    }

    return window.nexus.agentPip.onHostCommand((request) => {
      void handleHostCommand(request).then((ok) => {
        window.nexus.agentPip.replyHostCommand(request.requestId, ok);
      });
    });
  }, []);

  useEffect(() => {
    if (!paneId || !window.nexus?.agentPip) {
    lastPaneIdRef.current = null;
    lastFingerprintRef.current = null;
    snapshotRevisionRef.current = 0;
      return;
    }

    let stopped = false;
    let inFlight = false;
    let queued = false;

    const publish = async () => {
      if (stopped || inFlight) {
        queued = true;
        return;
      }

      inFlight = true;

      try {
        const desktop = slotsRef.current.find((slot) => slot.pane.id === paneId);
        const cloudId = paneId.startsWith(CLOUD_AGENT_PIP_PREFIX)
          ? paneId.slice(CLOUD_AGENT_PIP_PREFIX.length)
          : null;
        const cloud = cloudId
          ? (cloudSessionsRef.current.find((session) => session.id === cloudId) ?? null)
          : null;

        if (!desktop && !cloud) {
          unpinRef.current();
          return;
        }

        const snapshot = desktop
          ? await (async () => {
              const { turns, followUps, contextUsage } = liveAgentTabParts(desktop.pane);
              const busy = resolveDesktopPipBusy(desktop.pane, turns);
              const pinging =
                notifiedPaneByProjectRef.current[desktop.project.id] === desktop.pane.id;
              const fingerprint = transcriptFingerprint(
                turns,
                followUps,
                busy,
                contextUsage?.percent ?? 0,
                pinging,
              );

              if (lastPaneIdRef.current === paneId && lastFingerprintRef.current === fingerprint) {
                return null;
              }

              const logoKey = desktop.project.logo ?? '';
              let logoDataUrl =
                logoCacheRef.current?.key === logoKey ? logoCacheRef.current.value : null;

              if (logoCacheRef.current?.key !== logoKey) {
                logoDataUrl = await readLogoDataUrl(desktop.project.logo);
                logoCacheRef.current = { key: logoKey, value: logoDataUrl };
              }

              snapshotRevisionRef.current += 1;

              return {
                fingerprint,
                payload: buildDesktopAgentPipSnapshot({
                  paneId: desktop.pane.id,
                  project: desktop.project,
                  logoDataUrl,
                  busy,
                  revision: snapshotRevisionRef.current,
                  contextUsage,
                  pinging,
                  tab: cloneAgentTab(desktop.pane, turns, followUps),
                }),
              };
            })()
          : cloud
            ? (() => {
                const projectId = cloud.projectId;
                const pinging = Boolean(
                  projectId &&
                    (notifiedPaneByProjectRef.current[projectId] === cloud.id ||
                      notifiedPaneByProjectRef.current[projectId] ===
                        `${CLOUD_AGENT_PIP_PREFIX}${cloud.id}`),
                );
                const fingerprint = cloudFingerprint(cloud, pinging);

                if (
                  lastPaneIdRef.current === paneId &&
                  lastFingerprintRef.current === fingerprint
                ) {
                  return null;
                }

                return {
                  fingerprint,
                  payload: buildCloudAgentPipSnapshot(cloud, pinging),
                };
              })()
            : null;

        if (stopped || !snapshot) {
          return;
        }

        try {
          if (lastPaneIdRef.current !== snapshot.payload.paneId) {
            await window.nexus.agentPip.pin(snapshot.payload);
          } else {
            const applied = await Promise.resolve(window.nexus.agentPip.update(snapshot.payload));
            if (applied === false) {
              await window.nexus.agentPip.pin(snapshot.payload);
            }
          }

          lastPaneIdRef.current = snapshot.payload.paneId;
          lastFingerprintRef.current = snapshot.fingerprint;
        } catch {
          return;
        }
      } finally {
        inFlight = false;

        if (queued && !stopped) {
          queued = false;
          void publish();
        }
      }
    };

    void publish();
    const timer = window.setInterval(() => {
      void publish();
    }, PIP_SYNC_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [paneId]);
}
