import {
  useLayoutEffect,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useRef,
  useState,
} from 'react';
import { ArrowUp, AtSign, Bot, FolderKanban, Globe, Layers, Paperclip } from 'lucide-react';
import type { CloudProject, DeviceRecord } from '@nexus/protocol';
import type { WebAgentSession } from '../store';
import { WebAskMenuSelect } from './WebAskMenuSelect';
import { WebMacSelect } from './WebMacSelect';

interface WebMaestroAskBarProps {
  projects: CloudProject[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  devices: DeviceRecord[];
  deviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
  agents: WebAgentSession[];
  agentFilterProjectId: string | null;
  onAgentFilterChange: (projectId: string | null) => void;
  submitting: boolean;
  onSubmit: (prompt: string) => void;
}

interface OpenAgentProjectEntry {
  key: string;
  projectId: string | null;
  name: string;
  color: string;
  logoUrl: string | null;
  icon: string | null;
}

function ProjectLeading({
  logoUrl,
  color,
  icon,
}: {
  logoUrl: string | null;
  color: string | null;
  icon: string | null;
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt='' className='home-dashboard__ask-project-logo' />;
  }
  return (
    <span
      className='home-dashboard__ask-project-icon'
      style={
        color
          ? { background: color }
          : { background: 'rgba(255,255,255,0.08)', color: '#fff' }
      }
    >
      {icon ? (
        <span className='web-ask-project-letter'>{icon.slice(0, 1)}</span>
      ) : (
        <FolderKanban size={12} />
      )}
    </span>
  );
}

function RoundProjectThumb({
  logoUrl,
  color,
  icon,
}: {
  logoUrl: string | null;
  color: string;
  icon: string | null;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=''
        className='home-dashboard__open-agent-project-logo'
        draggable={false}
      />
    );
  }

  return (
    <span className='home-dashboard__open-agent-project-icon' style={{ background: color }}>
      {icon ? (
        <span className='web-ask-project-letter'>{icon.slice(0, 1)}</span>
      ) : (
        <Bot size={16} aria-hidden='true' />
      )}
    </span>
  );
}

export function WebMaestroAskBar({
  projects,
  projectId,
  onProjectChange,
  devices,
  deviceId,
  onDeviceChange,
  agents,
  agentFilterProjectId,
  onAgentFilterChange,
  submitting,
  onSubmit,
}: WebMaestroAskBarProps) {
  const [prompt, setPrompt] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askFormRef = useRef<HTMLFormElement>(null);

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const canSubmit =
    prompt.trim().length > 0 && !submitting && Boolean(selectedProject);

  const resizeAskInput = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
  }, []);

  const syncAskBarHeight = useCallback(() => {
    const form = askFormRef.current;
    if (!form) {
      return;
    }
    document.documentElement.style.setProperty(
      '--web-ask-bar-height',
      `${Math.ceil(form.getBoundingClientRect().height)}px`,
    );
  }, []);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        leading: (
          <ProjectLeading
            logoUrl={project.logo_url}
            color={project.color}
            icon={project.icon}
          />
        ),
      })),
    [projects],
  );

  const openAgentProjects = useMemo(() => {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const byKey = new Map<string, OpenAgentProjectEntry>();

    for (const agent of agents) {
      const project = agent.projectId ? projectsById.get(agent.projectId) : null;
      const key = agent.projectId ?? `agent:${agent.id}`;

      if (byKey.has(key)) {
        continue;
      }

      byKey.set(key, {
        key,
        projectId: agent.projectId,
        name: project?.name ?? agent.projectName,
        color: project?.color || agent.projectColor || '#8b5cf6',
        logoUrl: project?.logo_url ?? agent.logoUrl,
        icon: project?.icon ?? null,
      });
    }

    return Array.from(byKey.values());
  }, [agents, projects]);

  const showOpenAgentProjects = openAgentProjects.length >= 2;

  useLayoutEffect(() => {
    syncAskBarHeight();

    const form = askFormRef.current;
    const resizeObserver =
      form && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncAskBarHeight();
          })
        : null;

    if (form && resizeObserver) {
      resizeObserver.observe(form);
    }

    window.addEventListener('resize', syncAskBarHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncAskBarHeight);
    };
  }, [syncAskBarHeight, prompt]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const text = prompt.trim();
    setPrompt('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    onSubmit(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        const text = prompt.trim();
        setPrompt('');
        if (inputRef.current) {
          inputRef.current.style.height = 'auto';
        }
        onSubmit(text);
      }
    }
  };

  return (
    <div className='home-dashboard__ask-bar'>
      {showOpenAgentProjects ? (
        <div
          className='home-dashboard__open-agent-projects app-button--enter'
          aria-label='Filtrar agents por projeto'
        >
          <div className='home-dashboard__open-agent-projects-track'>
            <button
              type='button'
              className={`home-dashboard__open-agent-project app-button app-button--enter${
                agentFilterProjectId === null
                  ? ' home-dashboard__open-agent-project--active'
                  : ''
              }`}
              title='Todos'
              aria-label='Mostrar todos os agents'
              aria-pressed={agentFilterProjectId === null}
              disabled={submitting}
              onClick={() => onAgentFilterChange(null)}
            >
              <span className='home-dashboard__open-agent-project-icon home-dashboard__open-agent-project-icon--all'>
                <Layers size={16} aria-hidden='true' />
              </span>
            </button>
            {openAgentProjects.map((entry) => {
              const isActive =
                entry.projectId !== null && entry.projectId === agentFilterProjectId;
              return (
                <button
                  key={entry.key}
                  type='button'
                  className={`home-dashboard__open-agent-project app-button app-button--enter${
                    isActive ? ' home-dashboard__open-agent-project--active' : ''
                  }`}
                  title={entry.name}
                  aria-label={`Mostrar agents de ${entry.name}`}
                  aria-pressed={isActive}
                  disabled={submitting || !entry.projectId}
                  onClick={() => {
                    if (!entry.projectId) {
                      return;
                    }
                    onAgentFilterChange(entry.projectId);
                    onProjectChange(entry.projectId);
                  }}
                >
                  <RoundProjectThumb
                    logoUrl={entry.logoUrl}
                    color={entry.color}
                    icon={entry.icon}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <form
        ref={askFormRef}
        className='home-dashboard__ask app-button--enter'
        onSubmit={handleSubmit}
      >
        <div className='home-dashboard__ask-selects'>
          <WebAskMenuSelect
            value={projectId ?? ''}
            options={projectOptions}
            disabled={projects.length === 0 || submitting}
            ariaLabel='Projeto'
            triggerLabel={selectedProject?.name ?? 'Escolha um projeto'}
            triggerLeading={
              <ProjectLeading
                logoUrl={selectedProject?.logo_url ?? null}
                color={selectedProject?.color ?? null}
                icon={selectedProject?.icon ?? null}
              />
            }
            onChange={(next) => {
              if (next) {
                onProjectChange(next);
              }
            }}
          />
          <WebMacSelect
            devices={devices}
            deviceId={deviceId}
            onDeviceChange={onDeviceChange}
            disabled={submitting}
            className='web-ask-mac-select--bar'
          />
        </div>
        <div className='home-dashboard__ask-main'>
          <div className='home-dashboard__ask-input-wrap'>
            <textarea
              ref={inputRef}
              className='home-dashboard__ask-input'
              value={prompt}
              rows={1}
              placeholder='Pergunte algo ao Nexus...'
              disabled={submitting}
              spellCheck={false}
              aria-label='Pergunte algo ao Nexus'
              onChange={(event) => {
                setPrompt(event.target.value);
                resizeAskInput(event.target);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className='home-dashboard__ask-actions'>
          <button
            type='button'
            className='home-dashboard__ask-action app-button'
            aria-label='Anexar'
            disabled
            title='Em breve'
          >
            <Paperclip size={16} strokeWidth={2} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='home-dashboard__ask-action app-button'
            aria-label='Mencionar arquivo'
            disabled
            title='Em breve'
          >
            <AtSign size={16} strokeWidth={2} aria-hidden='true' />
          </button>
          <button
            type='button'
            className={`home-dashboard__ask-action app-button${
              webSearchEnabled ? ' home-dashboard__ask-action--active' : ''
            }`}
            aria-label='Pesquisar na web'
            aria-pressed={webSearchEnabled}
            disabled={submitting}
            onClick={() => setWebSearchEnabled((current) => !current)}
          >
            <Globe size={16} strokeWidth={2} aria-hidden='true' />
          </button>
          <button
            type='submit'
            className='home-dashboard__ask-send app-button app-button--enter'
            aria-label='Enviar'
            disabled={!canSubmit}
          >
            <ArrowUp size={16} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>
      </form>
    </div>
  );
}
