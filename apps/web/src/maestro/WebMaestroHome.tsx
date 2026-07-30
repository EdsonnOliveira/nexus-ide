import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import {
  closeAgentSession,
  createAgentSession,
  isDeviceOnline,
  listOpenAgentSessionBundles,
  updateAgentSessionMeta,
} from '@nexus/supabase';
import { bridge, supabase } from '../lib/supabase';
import { useWebStore, type WebAgentSession } from '../store';
import nexusLogo from '../assets/nexus-logo-icon.png';
import { hydrateWebAgentsFromBundles } from './hydrateWebAgents';
import { WebLogoMenu } from './WebLogoMenu';
import { WebMacPairingModal } from './WebMacPairingModal';
import { WebMacSelect } from './WebMacSelect';
import { WebMaestroAgents } from './WebMaestroAgents';
import { WebMaestroAskBar } from './WebMaestroAskBar';
import { WebPushModal } from './WebPushModal';
import {
  dismissWebPushNudge,
  getWebPushStatus,
  isIosDevice,
  isStandaloneDisplay,
  shouldNudgeWebPush,
} from './webPush';
import { WebVercelDeployCard } from './WebVercelDeployCard';
import { WebVercelTokenModal } from './WebVercelTokenModal';
import { WebEmulatorPanel } from './WebEmulatorPanel';
import { WebPreviewPanel } from './WebPreviewPanel';
import { useWebEmulatorProjectIds } from './useWebEmulatorProjectIds';
import { useWebPreviewProjectIds } from './useWebPreviewProjectIds';
import { useWebNavHistory, type WebNavHistoryState } from './useWebNavHistory';
import { useWebVercelDeployments } from './useWebVercelDeployments';
import { WebMobileReleaseCard } from './WebMobileReleaseCard';
import { useWebMobileReleases } from './useWebMobileReleases';
import type { WebFileAttachmentPayload } from './webAgentPromptImages';
import {
  buildWebTaskPrompt,
  type WebProjectTask,
} from './webProjectTasks';
import {
  dismissWebAgentTerminal,
  handleWebAgentShellToolEvents,
} from './webShellTerminal';
import {
  createWebStreamJsonState,
  extractStreamChunk,
  feedWebStreamJson,
  looksLikeMidProgressWebResponse,
  type WebStreamJsonState,
} from './webStreamJson';

function formatUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

const WEB_AGENT_STALL_MESSAGE =
  'Agent sem resposta (travou ou ficou sem atividade). Pare e tente de novo.';
const WEB_AGENT_RECONCILE_MS = 20_000;
const WEB_AGENT_CLIENT_STALL_MS = 12 * 60 * 1000;
const WEB_AGENT_MAX_INCOMPLETE_CONTINUES = 3;
const WEB_AGENT_INCOMPLETE_CONTINUE_PROMPT =
  'Continue from where you left off. Finish the incomplete response.';

function resolveLastWebAgentResponse(agent: WebAgentSession): string {
  const lastTurn = agent.turns[agent.turns.length - 1];
  if (!lastTurn) {
    return '';
  }

  const fromActivities = [...(lastTurn.activities ?? [])]
    .reverse()
    .find((entry) => entry.kind === 'response' && entry.label.trim())
    ?.label.trim();

  return fromActivities || lastTurn.response.trim();
}

function resolveStoreWorkspaceId(): string | null {
  const state = useWebStore.getState();
  return (
    state.projects.find((item) => item.id === state.selectedProjectId)?.workspace_id ||
    state.activeWorkspaceId ||
    state.devices.find((item) => item.id === state.selectedDeviceId)?.workspace_id ||
    null
  );
}

async function resolveAgentWorkspaceId(projectId: string | null): Promise<string | null> {
  const state = useWebStore.getState();
  const device =
    state.devices.find((item) => item.id === state.selectedDeviceId) ?? null;
  if (device?.workspace_id) {
    return device.workspace_id;
  }
  const project = projectId
    ? state.projects.find((item) => item.id === projectId) ?? null
    : null;
  return (
    project?.workspace_id ||
    state.activeWorkspaceId ||
    (await bridge.getWorkspaceId())
  );
}

export function WebMaestroHome() {
  const projects = useWebStore((state) => state.projects);
  const devices = useWebStore((state) => state.devices);
  const selectedProjectId = useWebStore((state) => state.selectedProjectId);
  const setSelectedProjectId = useWebStore((state) => state.setSelectedProjectId);
  const selectedDeviceId = useWebStore((state) => state.selectedDeviceId);
  const setSelectedDeviceId = useWebStore((state) => state.setSelectedDeviceId);
  const activeWorkspaceId = useWebStore((state) => state.activeWorkspaceId);
  const setProjects = useWebStore((state) => state.setProjects);
  const setActiveWorkspaceId = useWebStore((state) => state.setActiveWorkspaceId);
  const agents = useWebStore((state) => state.agents);
  const setAgents = useWebStore((state) => state.setAgents);
  const addAgent = useWebStore((state) => state.addAgent);
  const addAgentTurn = useWebStore((state) => state.addAgentTurn);
  const patchAgentTurn = useWebStore((state) => state.patchAgentTurn);
  const setAgentCursorSessionId = useWebStore((state) => state.setAgentCursorSessionId);
  const setAgentModelId = useWebStore((state) => state.setAgentModelId);
  const setAgentModeId = useWebStore((state) => state.setAgentModeId);
  const setAgentStatus = useWebStore((state) => state.setAgentStatus);
  const removeAgent = useWebStore((state) => state.removeAgent);
  const session = useWebStore((state) => state.session);
  const hydratedWorkspaceRef = useRef<string | null>(null);
  const pinnedDesktopAgentIdsRef = useRef(new Set<string>());
  const [submitting, setSubmitting] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [vercelTokenOpen, setVercelTokenOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushNudgeVisible, setPushNudgeVisible] = useState(false);
  const [emulatorOpen, setEmulatorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [agentFilterProjectId, setAgentFilterProjectId] = useState<string | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const [desktopAgentsCatalog, setDesktopAgentsCatalog] = useState<WebAgentSession[]>([]);
  const [heroScrolled, setHeroScrolled] = useState(false);
  const parsersRef = useRef(new Map<string, WebStreamJsonState>());
  const agentActivityRef = useRef(new Map<string, number>());
  const incompleteContinueCountRef = useRef(new Map<string, number>());
  const incompleteContinueInFlightRef = useRef(new Set<string>());
  const tryContinueIncompleteWebAgentRef = useRef<(agentId: string) => Promise<boolean>>(
    async () => false,
  );
  const heroRef = useRef<HTMLElement>(null);
  const visibleAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.source !== 'desktop_pane' || pinnedDesktopAgentIdsRef.current.has(agent.id),
      ),
    [agents],
  );
  const compact = visibleAgents.length >= 5;
  const emulatorWorkspaceId = useMemo(() => resolveStoreWorkspaceId(), [
    activeWorkspaceId,
    selectedProjectId,
    projects,
    devices,
    selectedDeviceId,
  ]);
  const [deviceOnlineNowMs, setDeviceOnlineNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setDeviceOnlineNowMs(Date.now());
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const selectedDeviceOnline = useMemo(() => {
    const device =
      devices.find((item) => item.id === selectedDeviceId) ??
      devices.find((item) => item.is_default) ??
      devices[0] ??
      null;
    void deviceOnlineNowMs;
    return device ? isDeviceOnline(device.last_seen_at) : false;
  }, [deviceOnlineNowMs, devices, selectedDeviceId]);
  const emulatorProjectIds = useWebEmulatorProjectIds({
    workspaceId: emulatorWorkspaceId,
    deviceId: selectedDeviceId,
    projects,
    enabled: Boolean(selectedDeviceId) && selectedDeviceOnline,
  });
  const previewProjectIds = useWebPreviewProjectIds({
    workspaceId: emulatorWorkspaceId,
    deviceId: selectedDeviceId,
    projects,
    enabled: Boolean(selectedDeviceId) && selectedDeviceOnline,
  });

  const handleOpenEmulator = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      setAgentFilterProjectId(projectId);
      const project = projects.find((item) => item.id === projectId);
      if (project?.workspace_id) {
        setActiveWorkspaceId(project.workspace_id);
      }
      setPreviewOpen(false);
      setEmulatorOpen(true);
    },
    [projects, setActiveWorkspaceId, setSelectedProjectId],
  );

  const handleOpenPreview = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      setAgentFilterProjectId(projectId);
      const project = projects.find((item) => item.id === projectId);
      if (project?.workspace_id) {
        setActiveWorkspaceId(project.workspace_id);
      }
      setEmulatorOpen(false);
      setPreviewOpen(true);
    },
    [projects, setActiveWorkspaceId, setSelectedProjectId],
  );

  useEffect(() => {
    if (!session?.user?.id) {
      setPushNudgeVisible(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const status = await getWebPushStatus(session.user.id);
        if (cancelled) {
          return;
        }
        if (status.enabled) {
          setPushNudgeVisible(false);
          return;
        }
        const needsHomeScreen = isIosDevice() && !isStandaloneDisplay();
        const shouldShow =
          shouldNudgeWebPush() &&
          (needsHomeScreen || isStandaloneDisplay() || status.localSubscription);
        setPushNudgeVisible(shouldShow);
      } catch {
        if (!cancelled) {
          setPushNudgeVisible(shouldNudgeWebPush() && isStandaloneDisplay());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!agentFilterProjectId) {
      return;
    }
    if (!projects.some((project) => project.id === agentFilterProjectId)) {
      setAgentFilterProjectId(null);
      setOpenAgentId(null);
      setFocusedAgentId(null);
    }
  }, [agentFilterProjectId, projects]);

  const handleSelectProjectAgents = useCallback(
    (projectId: string) => {
      setAgentFilterProjectId(projectId);
      setSelectedProjectId(projectId);
      const project = projects.find((item) => item.id === projectId);
      if (project?.workspace_id) {
        setActiveWorkspaceId(project.workspace_id);
      }
    },
    [projects, setActiveWorkspaceId, setSelectedProjectId],
  );

  const navState = useMemo<WebNavHistoryState>(
    () => ({
      projectId: agentFilterProjectId,
      agentId: openAgentId,
      emulator: emulatorOpen,
      preview: previewOpen,
    }),
    [agentFilterProjectId, emulatorOpen, openAgentId, previewOpen],
  );

  const applyNavState = useCallback((next: WebNavHistoryState) => {
    setAgentFilterProjectId(next.projectId);
    setOpenAgentId(next.agentId);
    setFocusedAgentId(null);
    setEmulatorOpen(next.emulator);
    setPreviewOpen(next.preview);
  }, []);

  const { goBack } = useWebNavHistory({
    state: navState,
    onPop: applyNavState,
  });

  const handleBackToProjects = useCallback(() => {
    goBack();
  }, [goBack]);

  const handleBackFromAgent = useCallback(() => {
    goBack();
  }, [goBack]);

  const handleCloseEmulator = useCallback(() => {
    goBack();
  }, [goBack]);

  const handleClosePreview = useCallback(() => {
    goBack();
  }, [goBack]);

  const overlayOpen = emulatorOpen || previewOpen;
  const projectScreenOpen = Boolean(agentFilterProjectId) && !overlayOpen;
  const agentScreenOpen = Boolean(openAgentId) && projectScreenOpen;

  const {
    tokenConfigured: vercelTokenConfigured,
    activeDeployment: vercelActiveDeployment,
    deployments: vercelDeployments,
    dismiss: dismissVercelDeployCard,
    saveToken: saveVercelToken,
    clearToken: clearVercelToken,
  } = useWebVercelDeployments(true);

  const {
    activeRelease: mobileActiveRelease,
    deviceId: mobileReleaseDeviceId,
    dismiss: dismissMobileReleaseCard,
  } = useWebMobileReleases(true);

  const resolveDeviceId = useCallback(() => {
    return (
      selectedDeviceId ??
      devices.find((device) => device.is_default && isDeviceOnline(device.last_seen_at))?.id ??
      devices.find((device) => isDeviceOnline(device.last_seen_at))?.id ??
      devices[0]?.id ??
      null
    );
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    if (!agentFilterProjectId) {
      return;
    }

    let cancelled = false;

    const refreshProjectTasks = async () => {
      const deviceId = resolveDeviceId();
      if (
        deviceId &&
        isDeviceOnline(devices.find((device) => device.id === deviceId)?.last_seen_at ?? null)
      ) {
        try {
          await bridge.requestLocalSync(deviceId);
        } catch {
        }
      }

      try {
        const projectList = await bridge.listProjects(activeWorkspaceId);
        if (!cancelled) {
          setProjects(projectList);
        }
      } catch {
      }
    };

    void refreshProjectTasks();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, agentFilterProjectId, devices, resolveDeviceId, setProjects]);

  const syncHeroChromeHeight = useCallback(() => {
    const hero = heroRef.current;
    if (!hero) {
      return;
    }
    document.documentElement.style.setProperty(
      '--web-hero-chrome-height',
      `${Math.ceil(hero.getBoundingClientRect().height)}px`,
    );
  }, []);

  useLayoutEffect(() => {
    syncHeroChromeHeight();

    const hero = heroRef.current;
    const resizeObserver =
      hero && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncHeroChromeHeight();
          })
        : null;

    if (hero && resizeObserver) {
      resizeObserver.observe(hero);
    }

    window.addEventListener('resize', syncHeroChromeHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncHeroChromeHeight);
    };
  }, [syncHeroChromeHeight, compact, devices.length]);

  const subscribeAgent = useCallback(
    (agentId: string, commandId: string) => {
      const parserKey = `${agentId}:${commandId}`;
      parsersRef.current.set(parserKey, createWebStreamJsonState());
      if (!agentActivityRef.current.has(agentId)) {
        agentActivityRef.current.set(agentId, Date.now());
      }

      bridge.subscribeToExecution(commandId, (payload) => {
        const envelope = payload as {
          type?: string;
          payload?: { chunk?: string; status?: string; format?: string; reason?: string };
        };
        const chunk = extractStreamChunk(payload);

        if (chunk) {
          agentActivityRef.current.set(agentId, Date.now());
          const parser =
            parsersRef.current.get(parserKey) ?? createWebStreamJsonState();
          parsersRef.current.set(parserKey, parser);
          const update = feedWebStreamJson(parser, chunk);
          patchAgentTurn(agentId, {
            thought: update.thought,
            thoughtStreaming: update.thoughtStreaming,
            response: update.response,
            activities: update.activities,
          });
          if (update.shellToolEvents.length > 0) {
            handleWebAgentShellToolEvents(agentId, update.shellToolEvents);
          }
          if (update.sessionId) {
            setAgentCursorSessionId(agentId, update.sessionId);
            void updateAgentSessionMeta(supabase, agentId, {
              cursor_chat_id: update.sessionId,
            });
          }
          if (update.done) {
            void tryContinueIncompleteWebAgentRef.current(agentId).then((continued) => {
              if (continued) {
                return;
              }
              setAgentStatus(agentId, 'done');
              void updateAgentSessionMeta(supabase, agentId, { status: 'active' });
            });
          }
        }

        const type = envelope?.type ?? '';
        const status = envelope?.payload?.status ?? '';
        const reason = envelope?.payload?.reason ?? '';
        if (
          type === 'completed' ||
          type === 'agent.completed' ||
          type === 'command.cancelled' ||
          status === 'completed' ||
          status === 'cancelled'
        ) {
          agentActivityRef.current.set(agentId, Date.now());
          if (type === 'command.cancelled' || status === 'cancelled') {
            setAgentStatus(agentId, 'done');
            void updateAgentSessionMeta(supabase, agentId, { status: 'active' });
          } else {
            void tryContinueIncompleteWebAgentRef.current(agentId).then((continued) => {
              if (continued) {
                return;
              }
              setAgentStatus(agentId, 'done');
              void updateAgentSessionMeta(supabase, agentId, { status: 'active' });
            });
          }
        }
        if (type === 'failed' || type === 'agent.failed' || status === 'failed') {
          agentActivityRef.current.set(agentId, Date.now());
          if (reason === 'stalled') {
            patchAgentTurn(agentId, { response: WEB_AGENT_STALL_MESSAGE });
          }
          setAgentStatus(agentId, 'error');
          void updateAgentSessionMeta(supabase, agentId, { status: 'error' });
        }
        if (type === 'agent.waiting_user') {
          agentActivityRef.current.set(agentId, Date.now());
          setAgentStatus(agentId, 'running');
          void updateAgentSessionMeta(supabase, agentId, { status: 'waiting_user' });
        }
      });
    },
    [patchAgentTurn, setAgentCursorSessionId, setAgentStatus],
  );

  useEffect(() => {
    setAgents(
      useWebStore
        .getState()
        .agents.filter(
          (agent) =>
            agent.source !== 'desktop_pane' || pinnedDesktopAgentIdsRef.current.has(agent.id),
        ),
    );
  }, [setAgents]);

  useEffect(() => {
    const workspaceId = resolveStoreWorkspaceId();
    if (!workspaceId || hydratedWorkspaceRef.current === workspaceId) {
      return;
    }
    let cancelled = false;
    const hydrate = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          return;
        }
        const bundles = await listOpenAgentSessionBundles(supabase, workspaceId, user.id);
        if (cancelled) {
          return;
        }
        const hydrated = hydrateWebAgentsFromBundles(bundles);
        const desktopCatalog = hydrated.filter((agent) => agent.source === 'desktop_pane');
        const cloudAgents = hydrated.filter((agent) => agent.source !== 'desktop_pane');
        const pinnedDesktop = desktopCatalog.filter((agent) =>
          pinnedDesktopAgentIdsRef.current.has(agent.id),
        );
        setDesktopAgentsCatalog(desktopCatalog);
        setAgents([...cloudAgents, ...pinnedDesktop]);
        hydratedWorkspaceRef.current = workspaceId;
        for (const agent of [...cloudAgents, ...pinnedDesktop]) {
          if (agent.status === 'running' && agent.commandId) {
            const lastTurn = agent.turns[agent.turns.length - 1];
            agentActivityRef.current.set(
              agent.id,
              lastTurn?.createdAt ?? agent.createdAt,
            );
            subscribeAgent(agent.id, agent.commandId);
          }
        }
      } catch {
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, selectedProjectId, selectedDeviceId, setAgents, subscribeAgent]);

  useEffect(() => {
    const reconcileRunningAgents = async () => {
      const runningAgents = useWebStore
        .getState()
        .agents.filter((agent) => agent.status === 'running' && agent.commandId);

      if (runningAgents.length === 0) {
        return;
      }

      const now = Date.now();

      for (const agent of runningAgents) {
        const lastActivity =
          agentActivityRef.current.get(agent.id) ?? agent.createdAt ?? now;
        const idleMs = now - lastActivity;

        try {
          const { data: execution } = await supabase
            .from('agent_executions')
            .select('status,result')
            .eq('command_id', agent.commandId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const executionStatus =
            execution && typeof execution.status === 'string' ? execution.status : '';
          const result =
            execution?.result && typeof execution.result === 'object'
              ? (execution.result as { stalled?: unknown })
              : null;
          const stalled = result?.stalled === true;

          if (
            executionStatus === 'completed' ||
            executionStatus === 'cancelled'
          ) {
            if (
              executionStatus === 'completed' &&
              (await tryContinueIncompleteWebAgentRef.current(agent.id))
            ) {
              continue;
            }
            agentActivityRef.current.set(agent.id, Date.now());
            setAgentStatus(agent.id, 'done');
            void updateAgentSessionMeta(supabase, agent.id, { status: 'active' });
            continue;
          }

          if (executionStatus === 'failed') {
            agentActivityRef.current.set(agent.id, Date.now());
            if (stalled) {
              patchAgentTurn(agent.id, { response: WEB_AGENT_STALL_MESSAGE });
            }
            setAgentStatus(agent.id, 'error');
            void updateAgentSessionMeta(supabase, agent.id, { status: 'error' });
            continue;
          }
        } catch {
        }

        if (idleMs < WEB_AGENT_CLIENT_STALL_MS) {
          continue;
        }

        const lastTurn = agent.turns[agent.turns.length - 1];
        const hasProgress = Boolean(
          lastTurn?.thought?.trim() || lastTurn?.response?.trim(),
        );
        if (hasProgress) {
          continue;
        }

        agentActivityRef.current.set(agent.id, Date.now());
        patchAgentTurn(agent.id, { response: WEB_AGENT_STALL_MESSAGE });
        setAgentStatus(agent.id, 'error');
        void updateAgentSessionMeta(supabase, agent.id, { status: 'error' });

        const deviceId = resolveDeviceId();
        if (!deviceId) {
          continue;
        }

        try {
          const workspaceId = await resolveAgentWorkspaceId(agent.projectId);
          if (!workspaceId) {
            continue;
          }
          await bridge.executeCommand({
            workspace_id: workspaceId,
            project_id: agent.projectId,
            target_device_id: deviceId,
            agent_id: agent.id,
            type: 'agent_cancel',
            payload: {
              command_id: agent.commandId,
              session_id: agent.id,
            },
            idempotency_key: crypto.randomUUID(),
          });
        } catch {
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void reconcileRunningAgents();
    }, WEB_AGENT_RECONCILE_MS);

    void reconcileRunningAgents();

    return () => {
      window.clearInterval(intervalId);
    };
  }, [patchAgentTurn, resolveDeviceId, setAgentStatus]);

  const handleProjectChange = useCallback(
    (projectId: string | null) => {
      setSelectedProjectId(projectId);
      const project = projects.find((item) => item.id === projectId);
      if (project?.workspace_id) {
        setActiveWorkspaceId(project.workspace_id);
      }
    },
    [projects, setActiveWorkspaceId, setSelectedProjectId],
  );

  const handleSubmit = useCallback(
    async (
      prompt: string,
      imageDataUrls: string[] = [],
      fileAttachments: WebFileAttachmentPayload[] = [],
    ): Promise<boolean> => {
      const deviceId = resolveDeviceId();
      if (!deviceId) {
        window.alert('Nenhum Mac cadastrado. Clique no logo e escolha Cadastrar Mac.');
        setPairingOpen(true);
        return false;
      }
      if (!isDeviceOnline(devices.find((device) => device.id === deviceId)?.last_seen_at ?? null)) {
        window.alert('Nenhum Mac online. Inicie o Runtime no Mac e tente de novo.');
        return false;
      }
      const project = projects.find((item) => item.id === selectedProjectId) ?? null;
      if (!project || !selectedProjectId) {
        window.alert('Escolha um projeto para continuar.');
        return false;
      }
      const device = devices.find((item) => item.id === deviceId) ?? null;
      const workspaceId = project.workspace_id || device?.workspace_id || null;
      if (!workspaceId) {
        window.alert('Workspace do projeto não encontrado. Faça login novamente.');
        return false;
      }
      if (device?.workspace_id && device.workspace_id !== workspaceId) {
        window.alert(
          'O Mac selecionado está em outro workspace do projeto. Selecione o Mac correto.',
        );
        return false;
      }

      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt && imageDataUrls.length === 0 && fileAttachments.length === 0) {
        return false;
      }

      setSubmitting(true);
      let createdSessionId: string | null = null;
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          throw new Error('Usuário não autenticado');
        }
        const agentId = crypto.randomUUID();
        const titleSource = trimmedPrompt || (imageDataUrls.length > 0 ? 'Imagem anexada' : 'Arquivo anexado');
        await createAgentSession(supabase, {
          id: agentId,
          workspace_id: workspaceId,
          project_id: selectedProjectId,
          device_id: deviceId,
          title: titleSource.slice(0, 80),
          created_by: user.id,
          model_id: 'auto',
        });
        createdSessionId = agentId;
        const commandId = await bridge.executeCommand({
          workspace_id: workspaceId,
          project_id: selectedProjectId,
          target_device_id: deviceId,
          agent_id: agentId,
          type: 'agent_prompt',
          payload: {
            prompt: trimmedPrompt,
            ...(imageDataUrls.length > 0 ? { image_data_urls: imageDataUrls } : {}),
            ...(fileAttachments.length > 0 ? { file_attachments: fileAttachments } : {}),
            agent_command: 'cursor-agent',
            model: 'auto',
            session_id: agentId,
          },
          idempotency_key: crypto.randomUUID(),
        });

        const createdAt = Date.now();
        addAgent({
          id: agentId,
          commandId,
          prompt: titleSource,
          projectId: selectedProjectId,
          deviceId,
          projectName: project.name,
          projectColor: project.color || '#8b5cf6',
          logoUrl: project.logo_url ?? null,
          cursorSessionId: null,
          modelId: 'auto',
          modeId: 'agent',
          source: 'cloud',
          stream: '',
          status: 'running',
          createdAt,
          terminals: [],
          turns: [
            {
              id: crypto.randomUUID(),
              prompt: titleSource,
              thought: '',
              thoughtStreaming: true,
              response: '',
              activities: [
                {
                  id: crypto.randomUUID(),
                  kind: 'thought',
                  label: '',
                  streaming: true,
                  startedAt: createdAt,
                },
              ],
              status: 'running',
              createdAt,
              commandId,
            },
          ],
        });
        setAgentFilterProjectId(selectedProjectId);
        setFocusedAgentId(agentId);

        agentActivityRef.current.set(agentId, createdAt);
        incompleteContinueCountRef.current.set(agentId, 0);
        subscribeAgent(agentId, commandId);
        return true;
      } catch (error) {
        if (createdSessionId) {
          try {
            await closeAgentSession(supabase, createdSessionId);
          } catch {
          }
        }
        window.alert(formatUnknownError(error, 'Falha ao enviar prompt'));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [
      addAgent,
      devices,
      projects,
      resolveDeviceId,
      selectedProjectId,
      subscribeAgent,
    ],
  );

  const handleFollowUp = useCallback(
    async (
      agentId: string,
      prompt: string,
      imageDataUrls: string[] = [],
      fileAttachments: WebFileAttachmentPayload[] = [],
    ): Promise<boolean> => {
      const agent = useWebStore.getState().agents.find((item) => item.id === agentId);
      if (!agent) {
        return false;
      }

      const deviceId = resolveDeviceId();
      if (!deviceId) {
        window.alert('Nenhum Mac cadastrado. Clique no logo e escolha Cadastrar Mac.');
        setPairingOpen(true);
        return false;
      }
      if (!isDeviceOnline(devices.find((device) => device.id === deviceId)?.last_seen_at ?? null)) {
        window.alert('Nenhum Mac online. Inicie o Runtime no Mac e tente de novo.');
        return false;
      }

      try {
        const device = devices.find((item) => item.id === deviceId) ?? null;
        const workspaceId = await resolveAgentWorkspaceId(agent.projectId);
        if (!workspaceId) {
          throw new Error('Workspace não encontrado');
        }
        if (device?.workspace_id && device.workspace_id !== workspaceId) {
          throw new Error(
            'O Mac selecionado está em outro workspace do projeto. Selecione o Mac correto.',
          );
        }
        const commandId = await bridge.executeCommand({
          workspace_id: workspaceId,
          project_id: agent.projectId,
          target_device_id: deviceId,
          agent_id: agentId,
          type: 'agent_prompt',
          payload: {
            prompt,
            ...(imageDataUrls.length > 0 ? { image_data_urls: imageDataUrls } : {}),
            ...(fileAttachments.length > 0 ? { file_attachments: fileAttachments } : {}),
            agent_command: 'cursor-agent',
            model: agent.modelId || 'auto',
            mode: agent.modeId && agent.modeId !== 'agent' ? agent.modeId : undefined,
            session_id: agent.id,
            resume_chat_id: agent.cursorSessionId,
            continue_session: !agent.cursorSessionId,
          },
          idempotency_key: crypto.randomUUID(),
        });

        addAgentTurn(agentId, {
          id: crypto.randomUUID(),
          prompt,
          thought: '',
          thoughtStreaming: true,
          response: '',
          activities: [
            {
              id: crypto.randomUUID(),
              kind: 'thought',
              label: '',
              streaming: true,
              startedAt: Date.now(),
            },
          ],
          status: 'running',
          createdAt: Date.now(),
          commandId,
        });
        agentActivityRef.current.set(agentId, Date.now());
        if (prompt !== WEB_AGENT_INCOMPLETE_CONTINUE_PROMPT) {
          incompleteContinueCountRef.current.set(agentId, 0);
        }
        subscribeAgent(agentId, commandId);
        return true;
      } catch (error) {
        window.alert(formatUnknownError(error, 'Falha ao enviar follow-up'));
        return false;
      }
    },
    [addAgentTurn, devices, resolveDeviceId, subscribeAgent],
  );

  tryContinueIncompleteWebAgentRef.current = async (agentId: string) => {
    const agent = useWebStore.getState().agents.find((item) => item.id === agentId);
    if (!agent || agent.source === 'desktop_pane') {
      return false;
    }

    if (incompleteContinueInFlightRef.current.has(agentId)) {
      return false;
    }

    if (!looksLikeMidProgressWebResponse(resolveLastWebAgentResponse(agent))) {
      return false;
    }

    const count = incompleteContinueCountRef.current.get(agentId) ?? 0;
    if (count >= WEB_AGENT_MAX_INCOMPLETE_CONTINUES) {
      return false;
    }

    if (!agent.cursorSessionId?.trim()) {
      return false;
    }

    incompleteContinueInFlightRef.current.add(agentId);
    incompleteContinueCountRef.current.set(agentId, count + 1);
    setAgentStatus(agentId, 'done');
    try {
      const continued = await handleFollowUp(agentId, WEB_AGENT_INCOMPLETE_CONTINUE_PROMPT);
      if (!continued) {
        incompleteContinueCountRef.current.set(agentId, count);
        useWebStore.setState((state) => ({
          agents: state.agents.map((entry) => {
            if (entry.id !== agentId) {
              return entry;
            }
            const lastIndex = entry.turns.length - 1;
            return {
              ...entry,
              status: 'running',
              turns: entry.turns.map((turn, index) =>
                index === lastIndex
                  ? {
                      ...turn,
                      status: 'running',
                      thoughtStreaming: false,
                      endedAt: undefined,
                    }
                  : turn,
              ),
            };
          }),
        }));
      }
      return continued;
    } finally {
      incompleteContinueInFlightRef.current.delete(agentId);
    }
  };

  const handleStop = useCallback(
    async (agentId: string) => {
      const agent = useWebStore.getState().agents.find((item) => item.id === agentId);
      if (!agent || agent.status !== 'running') {
        return;
      }

      const deviceId = resolveDeviceId();
      if (!deviceId) {
        window.alert('Nenhum Mac cadastrado. Clique no logo e escolha Cadastrar Mac.');
        setPairingOpen(true);
        return;
      }

      setAgentStatus(agentId, 'done');
      void updateAgentSessionMeta(supabase, agentId, { status: 'active' });

      try {
        const device = devices.find((item) => item.id === deviceId) ?? null;
        const workspaceId = await resolveAgentWorkspaceId(agent.projectId);
        if (!workspaceId) {
          throw new Error('Workspace não encontrado');
        }
        if (device?.workspace_id && device.workspace_id !== workspaceId) {
          throw new Error(
            'O Mac selecionado está em outro workspace do projeto. Selecione o Mac correto.',
          );
        }
        await bridge.executeCommand({
          workspace_id: workspaceId,
          project_id: agent.projectId,
          target_device_id: deviceId,
          agent_id: agentId,
          type: 'agent_cancel',
          payload: {
            command_id: agent.commandId,
            session_id: agentId,
          },
          idempotency_key: crypto.randomUUID(),
        });
      } catch (error) {
        window.alert(formatUnknownError(error, 'Falha ao parar o agent'));
      }
    },
    [devices, resolveDeviceId, setAgentStatus],
  );

  const handleRemove = useCallback(
    async (agentId: string) => {
      const agent = useWebStore.getState().agents.find((entry) => entry.id === agentId);
      if (agent?.source === 'desktop_pane') {
        pinnedDesktopAgentIdsRef.current.delete(agentId);
        removeAgent(agentId);
        return;
      }
      const deviceId = resolveDeviceId();
      if (agent?.terminals?.length && deviceId) {
        try {
          const workspaceId = await resolveAgentWorkspaceId(agent.projectId);
          if (workspaceId) {
            await Promise.all(
              agent.terminals.map((terminal) =>
                dismissWebAgentTerminal(agentId, terminal, {
                  deviceId,
                  projectId: agent.projectId,
                  workspaceId,
                }),
              ),
            );
          }
        } catch {
        }
      }
      try {
        await closeAgentSession(supabase, agentId);
      } catch {
      }
      removeAgent(agentId);
    },
    [removeAgent, resolveDeviceId],
  );

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      const fromCatalog = desktopAgentsCatalog.find((item) => item.id === agentId);
      const fromStore = useWebStore.getState().agents.find((item) => item.id === agentId);
      const agent = fromCatalog ?? fromStore;
      if (!agent) {
        return;
      }
      if (agent.source === 'desktop_pane') {
        pinnedDesktopAgentIdsRef.current.add(agent.id);
      }
      addAgent(agent);
      if (agent.projectId) {
        setSelectedProjectId(agent.projectId);
        setAgentFilterProjectId(agent.projectId);
        const project = projects.find((item) => item.id === agent.projectId);
        if (project?.workspace_id) {
          setActiveWorkspaceId(project.workspace_id);
        }
      }
      setFocusedAgentId(agentId);

      if (agent.source !== 'desktop_pane') {
        return;
      }

      void (async () => {
        const workspaceId = resolveStoreWorkspaceId();
        if (!workspaceId) {
          return;
        }
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            return;
          }
          const bundles = await listOpenAgentSessionBundles(supabase, workspaceId, user.id);
          const hydrated = hydrateWebAgentsFromBundles(bundles);
          const fresh = hydrated.find((item) => item.id === agentId);
          if (!fresh) {
            return;
          }
          setDesktopAgentsCatalog(hydrated.filter((item) => item.source === 'desktop_pane'));
          if (pinnedDesktopAgentIdsRef.current.has(agentId)) {
            addAgent(fresh);
          }
        } catch {
        }
      })();
    },
    [addAgent, desktopAgentsCatalog, projects, setActiveWorkspaceId, setSelectedProjectId],
  );

  const handleRequestDesktopAgents = useCallback(async () => {
    const workspaceId = resolveStoreWorkspaceId();
    if (!workspaceId) {
      return;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return;
      }
      const bundles = await listOpenAgentSessionBundles(supabase, workspaceId, user.id);
      const hydrated = hydrateWebAgentsFromBundles(bundles);
      setDesktopAgentsCatalog(hydrated.filter((agent) => agent.source === 'desktop_pane'));
    } catch {
    }
  }, []);

  const handleExecuteTask = useCallback(
    async (task: WebProjectTask) => {
      const prompt = buildWebTaskPrompt(task);
      if (!prompt) {
        return;
      }
      await handleSubmit(prompt);
    },
    [handleSubmit],
  );

  const handleModelChange = useCallback(
    (agentId: string, modelId: string) => {
      setAgentModelId(agentId, modelId);
      void updateAgentSessionMeta(supabase, agentId, { model_id: modelId });
    },
    [setAgentModelId],
  );

  const handleModeChange = useCallback(
    (agentId: string, modeId: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask') => {
      setAgentModeId(agentId, modeId);
    },
    [setAgentModeId],
  );

  return (
    <div
      className={`home-dashboard nexus-hero home-dashboard--maestro${
        emulatorOpen ? ' home-dashboard--emulator-open' : ''
      }${previewOpen ? ' home-dashboard--preview-open' : ''}${
        projectScreenOpen ? ' home-dashboard--project-open' : ''
      }${agentScreenOpen ? ' home-dashboard--agent-open' : ''}`}
    >
      <header
        ref={heroRef}
        className={`home-dashboard__hero app-button--enter${
          compact ? ' home-dashboard__hero--compact' : ''
        }${heroScrolled ? ' home-dashboard__hero--scrolled' : ''}${
          overlayOpen || projectScreenOpen ? ' home-dashboard__hero--exit' : ''
        }`}
        aria-hidden={overlayOpen || projectScreenOpen}
      >
        <div className='home-dashboard__hero-brand'>
          <WebLogoMenu
            onRegisterMac={() => setPairingOpen(true)}
            onConfigureVercel={() => setVercelTokenOpen(true)}
            onConfigureNotifications={() => setPushOpen(true)}
            onSignOut={() => void supabase.auth.signOut()}
          >
            <img
              src={nexusLogo}
              alt='Nexus'
              width={compact ? 28 : 56}
              height={compact ? 28 : 56}
              className='nexus-brand-logo home-dashboard__hero-logo'
              draggable={false}
            />
          </WebLogoMenu>
          <div className='home-dashboard__hero-copy'>
            <h1 className='home-dashboard__greeting'>Olá.</h1>
            <p className='home-dashboard__hero-subtitle'>
              O mesmo agente de programação poderoso, agora na web.
            </p>
          </div>
        </div>
        <div className='home-dashboard__hero-mac'>
          <WebMacSelect
            devices={devices}
            deviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            disabled={submitting}
            className='web-ask-mac-select--header'
          />
        </div>
      </header>
      {pushNudgeVisible && !overlayOpen && !agentScreenOpen ? (
        <div className='web-push-nudge app-button--enter' role='status'>
          <Bell size={16} aria-hidden='true' />
          <span>
            {isIosDevice() && !isStandaloneDisplay()
              ? 'Para receber aviso quando o agent terminar, abra o Nexus pela Tela de Início e ative as notificações.'
              : 'Ative as notificações para saber quando o agent concluir.'}
          </span>
          <button
            type='button'
            className='app-button web-push-nudge__action'
            onClick={() => setPushOpen(true)}
          >
            Ativar
          </button>
          <button
            type='button'
            className='app-button web-push-nudge__dismiss'
            aria-label='Dispensar aviso de notificações'
            onClick={() => {
              dismissWebPushNudge();
              setPushNudgeVisible(false);
            }}
          >
            Agora não
          </button>
        </div>
      ) : null}
      {!overlayOpen && !agentScreenOpen ? (
        <div className='home-dashboard__hero-ask'>
          <WebMaestroAskBar
            projects={projects}
            projectId={selectedProjectId}
            onProjectChange={handleProjectChange}
            devices={devices}
            deviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            submitting={submitting}
            onSubmit={(prompt, imageDataUrls, fileAttachments) =>
              handleSubmit(prompt, imageDataUrls, fileAttachments)
            }
            desktopAgents={desktopAgentsCatalog}
            onSelectAgent={handleSelectAgent}
            onRequestDesktopAgents={handleRequestDesktopAgents}
            hideProjectSelect={Boolean(agentFilterProjectId)}
          />
        </div>
      ) : null}
      {!overlayOpen ? (
        <WebMaestroAgents
          agents={visibleAgents}
          projects={projects}
          selectedProjectId={agentFilterProjectId}
          deviceId={resolveDeviceId()}
          focusedAgentId={focusedAgentId}
          openAgentId={openAgentId}
          emulatorProjectIds={emulatorProjectIds}
          previewProjectIds={previewProjectIds}
          headerMacSelect={
            <WebMacSelect
              devices={devices}
              deviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
              disabled={submitting}
              iconOnly
              className='web-ask-mac-select--header'
            />
          }
          onOpenEmulator={handleOpenEmulator}
          onOpenPreview={handleOpenPreview}
          onSelectProject={handleSelectProjectAgents}
          onBackToProjects={handleBackToProjects}
          onBackFromAgent={handleBackFromAgent}
          onFocusedAgentHandled={() => setFocusedAgentId(null)}
          onOpenAgentChange={setOpenAgentId}
          onRemove={(agentId) => void handleRemove(agentId)}
          onFollowUp={(agentId, prompt, imageDataUrls, fileAttachments) =>
            handleFollowUp(agentId, prompt, imageDataUrls, fileAttachments)
          }
          onStop={(agentId) => void handleStop(agentId)}
          onModelChange={handleModelChange}
          onModeChange={handleModeChange}
          onExecuteTask={(task) => void handleExecuteTask(task)}
          onScrollChange={setHeroScrolled}
        />
      ) : null}
      {!overlayOpen && (mobileActiveRelease || vercelActiveDeployment)
        ? createPortal(
            <div className='web-vercel-deploy-dock'>
              {mobileActiveRelease ? (
                <WebMobileReleaseCard
                  release={mobileActiveRelease}
                  deviceId={mobileReleaseDeviceId ?? resolveDeviceId()}
                  onDismiss={() => dismissMobileReleaseCard(mobileActiveRelease.uid)}
                />
              ) : null}
              {vercelActiveDeployment ? (
                <WebVercelDeployCard
                  deployment={vercelActiveDeployment}
                  deployments={vercelDeployments}
                  onDismiss={() => dismissVercelDeployCard(vercelActiveDeployment.uid)}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
      <WebMacPairingModal open={pairingOpen} onClose={() => setPairingOpen(false)} />
      <WebVercelTokenModal
        open={vercelTokenOpen}
        tokenConfigured={vercelTokenConfigured}
        onClose={() => setVercelTokenOpen(false)}
        onSave={saveVercelToken}
        onClear={clearVercelToken}
      />
      <WebPushModal
        open={pushOpen}
        onClose={() => {
          setPushOpen(false);
          if (session?.user?.id) {
            void getWebPushStatus(session.user.id).then((status) => {
              if (status.enabled) {
                setPushNudgeVisible(false);
              }
            });
          }
        }}
      />
      <WebEmulatorPanel
        open={emulatorOpen}
        onClose={handleCloseEmulator}
        workspaceId={resolveStoreWorkspaceId()}
        projectId={selectedProjectId}
        deviceId={selectedDeviceId}
        headerMacSelect={
          <WebMacSelect
            devices={devices}
            deviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            disabled={submitting}
            iconOnly
            className='web-ask-mac-select--header'
          />
        }
      />
      <WebPreviewPanel
        open={previewOpen}
        onClose={handleClosePreview}
        workspaceId={resolveStoreWorkspaceId()}
        projectId={selectedProjectId}
        deviceId={selectedDeviceId}
        headerMacSelect={
          <WebMacSelect
            devices={devices}
            deviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            disabled={submitting}
            iconOnly
            className='web-ask-mac-select--header'
          />
        }
      />
    </div>
  );
}
