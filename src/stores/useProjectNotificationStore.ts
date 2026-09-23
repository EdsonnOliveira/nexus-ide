import { create } from 'zustand';
import {
  playAgentNotificationSound,
  startAgentNotificationSoundLoop,
  stopAgentNotificationSoundLoop,
} from '@/utils/agentNotificationSound';
import {
  findAgentPaneLatestTurn,
  findProjectIdByPaneId,
  resolveAgentFinishProject,
} from '@/utils/findProjectIdByPaneId';
import { notifyDesktopAgentWebPush } from '@/utils/notifyDesktopAgentWebPush';
import { buildAgentPromptNotify, isAgentGitFinishPrompt } from '@/utils/agentPromptNotify';

interface ProjectNotificationState {
  notifiedAgentPaneByProject: Record<string, string>;
  notifiedAtByProject: Record<string, number>;
  markProjectReady: (projectId: string, paneId: string, options?: { gitNotify?: boolean }) => void;
  restoreProjectNotification: (projectId: string, paneId: string) => void;
  clearProjectNotification: (projectId: string) => void;
  clearNotificationForPane: (paneId: string) => void;
}

function emitAgentReadyPing(): void {
  playAgentNotificationSound();
  startAgentNotificationSoundLoop();
}

function omitProjectNotification(
  notifiedAgentPaneByProject: Record<string, string>,
  notifiedAtByProject: Record<string, number>,
  projectId: string,
): Pick<ProjectNotificationState, 'notifiedAgentPaneByProject' | 'notifiedAtByProject'> {
  const nextPanes = { ...notifiedAgentPaneByProject };
  delete nextPanes[projectId];
  const nextAt = { ...notifiedAtByProject };
  delete nextAt[projectId];

  if (Object.keys(nextPanes).length === 0) {
    stopAgentNotificationSoundLoop();
  }

  window.nexus?.agentFinish?.dismiss?.(projectId);

  return {
    notifiedAgentPaneByProject: nextPanes,
    notifiedAtByProject: nextAt,
  };
}

export const useProjectNotificationStore = create<ProjectNotificationState>((set, get) => ({
  notifiedAgentPaneByProject: {},
  notifiedAtByProject: {},
  markProjectReady: (projectId, paneId, options) => {
    const resolved = resolveAgentFinishProject({ projectId, paneId });
    const resolvedProjectId = resolved.projectId || projectId;

    if (get().notifiedAgentPaneByProject[resolvedProjectId] === paneId) {
      startAgentNotificationSoundLoop();
      return;
    }

    emitAgentReadyPing();

    const latestTurn = findAgentPaneLatestTurn(paneId);
    const prompt = buildAgentPromptNotify(latestTurn?.activities ?? []);
    const allowGitNotify =
      options?.gitNotify !== false && !prompt && !isAgentGitFinishPrompt(latestTurn?.user);
    const notify = window.nexus?.agentFinish?.notify;

    if (prompt && notify) {
      void notify({
        projectId: resolvedProjectId,
        paneId,
        projectName: resolved.projectName,
        projectLogo: resolved.projectLogo,
        kind: prompt.kind,
        body: prompt.body,
        activityId: prompt.activityId,
        questionId: prompt.questionId,
        actions: prompt.options,
      }).catch(() => undefined);
    } else if (allowGitNotify) {
      notifyDesktopAgentWebPush(resolvedProjectId, paneId);
      if (notify) {
        void notify({
          projectId: resolvedProjectId,
          paneId,
          projectName: resolved.projectName,
          projectLogo: resolved.projectLogo,
        }).catch(() => undefined);
      }
    }

    set((state) => ({
      notifiedAgentPaneByProject: {
        ...state.notifiedAgentPaneByProject,
        [resolvedProjectId]: paneId,
      },
      notifiedAtByProject: {
        ...state.notifiedAtByProject,
        [resolvedProjectId]: Date.now(),
      },
    }));
  },

  restoreProjectNotification: (projectId, paneId) => {
    set((state) => ({
      notifiedAgentPaneByProject: {
        ...state.notifiedAgentPaneByProject,
        [projectId]: paneId,
      },
      notifiedAtByProject: {
        ...state.notifiedAtByProject,
        [projectId]: state.notifiedAtByProject[projectId] ?? Date.now(),
      },
    }));
  },
  clearProjectNotification: (projectId) => {
    set((state) => {
      if (!state.notifiedAgentPaneByProject[projectId]) {
        return state;
      }

      return omitProjectNotification(
        state.notifiedAgentPaneByProject,
        state.notifiedAtByProject,
        projectId,
      );
    });
  },
  clearNotificationForPane: (paneId) => {
    set((state) => {
      const matchedProjectId = Object.entries(state.notifiedAgentPaneByProject).find(
        ([, notifiedPaneId]) => notifiedPaneId === paneId,
      )?.[0];
      const projectId = findProjectIdByPaneId(paneId) ?? matchedProjectId;

      if (!projectId || state.notifiedAgentPaneByProject[projectId] !== paneId) {
        return state;
      }

      return omitProjectNotification(
        state.notifiedAgentPaneByProject,
        state.notifiedAtByProject,
        projectId,
      );
    });
  },
}));
