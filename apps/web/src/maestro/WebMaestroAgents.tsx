import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, X } from 'lucide-react';
import type { WebAgentSession } from '../store';
import { WebAgentChat } from './WebAgentChat';
import type { WebAgentMode } from './WebAgentPlusMenu';
import { WebAgentShellTerminals } from './WebAgentShellTerminals';

interface WebMaestroAgentsProps {
  agents: WebAgentSession[];
  deviceId: string | null;
  onRemove: (id: string) => void;
  onFollowUp: (agentId: string, prompt: string) => boolean | Promise<boolean>;
  onStop: (agentId: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onModeChange: (agentId: string, modeId: WebAgentMode) => void;
  onScrollChange?: (scrolled: boolean) => void;
}

function AgentThumb({
  logoUrl,
  color,
}: {
  logoUrl: string | null;
  color: string;
}) {
  if (logoUrl) {
    return (
      <img src={logoUrl} alt='' className='home-dashboard__agent-card-logo' draggable={false} />
    );
  }

  return (
    <span className='home-dashboard__agent-card-icon' style={{ background: color }}>
      <Bot size={14} />
    </span>
  );
}

function AgentCloseConfirm({
  projectName,
  onConfirm,
  onClose,
}: {
  projectName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className='web-modal web-modal--viewport' role='presentation' onClick={onClose}>
      <div
        className='web-modal__card project-dialog app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-labelledby='web-agent-close-title'
        onClick={(event) => event.stopPropagation()}
      >
        <span id='web-agent-close-title' className='project-dialog__title'>
          Fechar agent?
        </span>
        <p className='project-dialog__message'>
          Tem certeza que deseja fechar o agent de <strong>{projectName}</strong>?
        </p>
        <div className='project-dialog__actions'>
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--ghost app-button'
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
            onClick={onConfirm}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AgentCard({
  agent,
  deviceId,
  onRemove,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
}: {
  agent: WebAgentSession;
  deviceId: string | null;
  onRemove: (id: string) => void;
  onFollowUp: (agentId: string, prompt: string) => boolean | Promise<boolean>;
  onStop: (agentId: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onModeChange: (agentId: string, modeId: WebAgentMode) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <article className='home-dashboard__agent-card home-dashboard__agent-card--spawn'>
      <div className='home-dashboard__agent-card-head'>
        <div className='home-dashboard__agent-card-thumb-wrap'>
          <AgentThumb logoUrl={agent.logoUrl} color={agent.projectColor} />
        </div>
        <div className='home-dashboard__agent-card-copy'>
          <span className='home-dashboard__agent-card-project'>{agent.projectName}</span>
        </div>
        <div className='home-dashboard__agent-card-aside'>
          <WebAgentShellTerminals agent={agent} deviceId={deviceId} />
          <button
            type='button'
            className='home-dashboard__agent-card-close app-button app-button--enter'
            aria-label='Fechar agent'
            onClick={() => setConfirmOpen(true)}
          >
            <X size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>
      </div>
      <div className='home-dashboard__agent-card-body'>
        <WebAgentChat
          agent={agent}
          onFollowUp={onFollowUp}
          onStop={onStop}
          onModelChange={onModelChange}
          onModeChange={onModeChange}
        />
      </div>
      <span
        className={`home-dashboard__agent-card-progress${
          agent.status === 'running' ? ' home-dashboard__agent-card-progress--busy' : ''
        }`}
        aria-hidden='true'
      />
      {confirmOpen ? (
        <AgentCloseConfirm
          projectName={agent.projectName}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onRemove(agent.id);
          }}
        />
      ) : null}
    </article>
  );
}

export function WebMaestroAgents({
  agents,
  deviceId,
  onRemove,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
  onScrollChange,
}: WebMaestroAgentsProps) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) {
      onScrollChange?.(false);
      return;
    }

    const syncScroll = () => {
      onScrollChange?.(node.scrollTop > 8);
    };

    syncScroll();
    node.addEventListener('scroll', syncScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', syncScroll);
    };
  }, [agents.length, onScrollChange]);

  if (agents.length === 0) {
    return (
      <section
        ref={sectionRef}
        className='home-dashboard__agent-mode app-button--enter'
      >
        <div className='empty-state home-dashboard__agent-mode-empty'>
          <div className='empty-state__icon'>
            <Bot size={28} aria-hidden='true' />
          </div>
          <strong className='empty-state__title'>Nenhum agent na área</strong>
          <p className='empty-state__message'>
            Escolha um projeto e pergunte algo ao Nexus para criar um agent aqui.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className='home-dashboard__agent-mode app-button--enter'>
      <div className='home-dashboard__agent-grid'>
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            deviceId={deviceId}
            onRemove={onRemove}
            onFollowUp={onFollowUp}
            onStop={onStop}
            onModelChange={onModelChange}
            onModeChange={onModeChange}
          />
        ))}
      </div>
    </section>
  );
}
