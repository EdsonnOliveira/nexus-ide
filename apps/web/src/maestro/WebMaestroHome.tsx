import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
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
import { WebVercelDeployCard } from './WebVercelDeployCard';
import { WebVercelTokenModal } from './WebVercelTokenModal';
import { WebEmulatorPanel } from './WebEmulatorPanel';
import { useWebEmulatorProjectIds } from './useWebEmulatorProjectIds';
import { useWebVercelDeployments } from './useWebVercelDeployments';
import { WebMobileReleaseCard } from './WebMobileReleaseCard';
import { useWebMobileReleases } from './useWebMobileReleases';
import type { WebFileAttachmentPayload } from './webAgentPromptImages';
import {
  dismissWebAgentTerminal,
  handleWebAgentShellToolEvents,
} from './webShellTerminal';
import {
  createWebStreamJsonState,
  extractStreamChunk,
  feedWebStreamJson,
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
  const project = projectId
    ? state.projects.find((item) => item.id === projectId) ?? null
    : null;
  const device =
    state.devices.find((item) => item.id === state.selectedDeviceId) ?? null;
  return (
    project?.workspace_id ||
    device?.workspace_id ||
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
  const hydratedWorkspaceRef = useRef<string | null>(null);
  const pinnedDesktopAgentIdsRef = useRef(new Set<string>());
  const [submitting, setSubmitting] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [vercelTokenOpen, setVercelTokenOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [emulatorOpen, setEmulatorOpen] = useState(false);
  const [agentFilterProjectId, setAgentFilterProjectId] = useState<string | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [desktopAgentsCatalog, setDesktopAgentsCatalog] = useState<WebAgentSession[]>([]);
  const [heroScrolled, setHeroScrolled] = useState(false);
  const parsersRef = useRef(new Map<string, WebStreamJsonState>());
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
  const emulatorProjectIds = useWebEmulatorProjectIds({
    workspaceId: emulatorWorkspaceId,
    deviceId: selectedDeviceId,
    projects,
    enabled: Boolean(selectedDeviceId),
  });

  const handleOpenEmulator = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      setAgentFilterProjectId(projectId);
      const project = projects.find((item) => item.id === projectId);
      if (project?.workspace_id) {
        setActiveWorkspaceId(project.workspace_id);
      }
      setEmulatorOpen(true);
    },
    [projects, setActiveWorkspaceId, setSelectedProjectId],
  );

  useEffect(() => {
    if (!agentFilterProjectId) {
      return;
    }
    if (!visibleAgents.some((agent) => agent.projectId === agentFilterProjectId)) {
      setAgentFilterProjectId(null);
    }
  }, [agentFilterProjectId, visibleAgents]);

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

  const handleBackToProjects = useCallback(() => {
    setAgentFilterProjectId(null);
    setFocusedAgentId(null);
  }, []);

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

      bridge.subscribeToExecution(commandId, (payload) => {
        const envelope = payload as {
          type?: string;
          payload?: { chunk?: string; status?: string; format?: string };
        };
        const chunk = extractStreamChunk(payload);

        if (chunk) {
          const parser =
            parsersRef.current.get(parserKey) ?? createWebStreamJsonState();
          parsersRef.current.set(parserKey, parser);
          const update = feedWebStreamJson(parser, chunk);
          patchAgentTurn(agentId, {
            thought: update.thought,
            thoughtStreaming: update.thoughtStreaming,
            response: update.response,
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
            setAgentStatus(agentId, 'done');
            void updateAgentSessionMeta(supabase, agentId, { status: 'active' });
          }
        }

        const type = envelope?.type ?? '';
        const status = envelope?.payload?.status ?? '';
        if (
          type === 'completed' ||
          type === 'agent.completed' ||
          type === 'command.cancelled' ||
          status === 'completed' ||
          status === 'cancelled'
        ) {
          setAgentStatus(agentId, 'done');
          void updateAgentSessionMeta(supabase, agentId, { status: 'active' });
        }
        if (type === 'failed' || type === 'agent.failed' || status === 'failed') {
          setAgentStatus(agentId, 'error');
          void updateAgentSessionMeta(supabase, agentId, { status: 'error' });
        }
        if (type === 'agent.waiting_user') {
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
              status: 'running',
              createdAt,
              commandId,
            },
          ],
        });
        setAgentFilterProjectId(selectedProjectId);
        setFocusedAgentId(agentId);

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
          status: 'running',
          createdAt: Date.now(),
          commandId,
        });
        subscribeAgent(agentId, commandId);
        return true;
      } catch (error) {
        window.alert(formatUnknownError(error, 'Falha ao enviar follow-up'));
        return false;
      }
    },
    [addAgentTurn, devices, resolveDeviceId, subscribeAgent],
  );

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
    <div className='home-dashboard nexus-hero home-dashboard--maestro'>
      <header
        ref={heroRef}
        className={`home-dashboard__hero app-button--enter${
          compact ? ' home-dashboard__hero--compact' : ''
        }${heroScrolled ? ' home-dashboard__hero--scrolled' : ''}`}
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
          {agentFilterProjectId && emulatorProjectIds.has(agentFilterProjectId) ? (
            <button
              type='button'
              className='web-emulator-header-btn app-button'
              aria-label='Abrir emulador'
              title='Emulador rodando'
              onClick={() => handleOpenEmulator(agentFilterProjectId)}
            >
              <Smartphone size={15} aria-hidden='true' />
            </button>
          ) : null}
          <WebMacSelect
            devices={devices}
            deviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            disabled={submitting}
            className='web-ask-mac-select--header'
          />
        </div>
      </header>
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
      <WebMaestroAgents
        agents={visibleAgents}
        selectedProjectId={agentFilterProjectId}
        deviceId={resolveDeviceId()}
        focusedAgentId={focusedAgentId}
        emulatorProjectIds={emulatorProjectIds}
        onOpenEmulator={handleOpenEmulator}
        onSelectProject={handleSelectProjectAgents}
        onBackToProjects={handleBackToProjects}
        onFocusedAgentHandled={() => setFocusedAgentId(null)}
        onRemove={(agentId) => void handleRemove(agentId)}
        onFollowUp={(agentId, prompt, imageDataUrls, fileAttachments) =>
          handleFollowUp(agentId, prompt, imageDataUrls, fileAttachments)
        }
        onStop={(agentId) => void handleStop(agentId)}
        onModelChange={handleModelChange}
        onModeChange={handleModeChange}
        onScrollChange={setHeroScrolled}
      />
      {mobileActiveRelease || vercelActiveDeployment ? (
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
        </div>
      ) : null}
      <WebMacPairingModal open={pairingOpen} onClose={() => setPairingOpen(false)} />
      <WebVercelTokenModal
        open={vercelTokenOpen}
        tokenConfigured={vercelTokenConfigured}
        onClose={() => setVercelTokenOpen(false)}
        onSave={saveVercelToken}
        onClear={clearVercelToken}
      />
      <WebPushModal open={pushOpen} onClose={() => setPushOpen(false)} />
      <WebEmulatorPanel
        open={emulatorOpen}
        onClose={() => setEmulatorOpen(false)}
        workspaceId={resolveStoreWorkspaceId()}
        projectId={selectedProjectId}
        deviceId={selectedDeviceId}
      />
    </div>
  );
}
