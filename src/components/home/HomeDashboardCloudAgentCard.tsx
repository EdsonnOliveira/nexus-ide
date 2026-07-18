import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Globe, X } from 'lucide-react';
import { closeAgentSession } from '@nexus/supabase';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { cloudSupabase } from '@/lib/nexusCloud';
import { useCloudAgentSessionsStore } from '@/stores/useCloudAgentSessionsStore';
import {
  useDeferredMarkdownHtml,
  useMarkdownCodeHighlight,
} from '@/hooks/useMarkdownCodeHighlight';
import type { CloudAgentSession, CloudAgentTurn } from '@/types/cloudAgent';

function CloudAgentThumbComponent({ logoUrl, color }: { logoUrl: string | null; color: string }) {
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

const CloudAgentThumb = memo(CloudAgentThumbComponent);

function CloudAgentCloseConfirmComponent({
  projectName,
  onConfirm,
  onClose,
}: {
  projectName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const handleConfirm = useCallback(
    (requestClose: () => void) => {
      onConfirm();
      requestClose();
    },
    [onConfirm],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Fechar agent?</span>
          <p className='project-dialog__message'>
            Tem certeza que deseja fechar o agent de <strong>{projectName}</strong>?
          </p>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
              onClick={() => handleConfirm(requestClose)}
            >
              Fechar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

const CloudAgentCloseConfirm = memo(CloudAgentCloseConfirmComponent);

function formatCloudThoughtDuration(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

function CloudAgentThoughtBlock({ turn }: { turn: CloudAgentTurn }) {
  const streaming = turn.status === 'running' && (turn.thoughtStreaming || !turn.response.trim());
  const [expanded, setExpanded] = useState(streaming || !turn.thought);
  const [elapsedSeconds, setElapsedSeconds] = useState(1);

  useEffect(() => {
    if (!streaming) {
      return;
    }

    const tick = () => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - turn.createdAt) / 1000)));
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [streaming, turn.createdAt]);

  useEffect(() => {
    setExpanded(streaming);
  }, [streaming]);

  const title = streaming
    ? `Pensando ${elapsedSeconds}s`
    : `Pensou por ${formatCloudThoughtDuration((turn.endedAt ?? Date.now()) - turn.createdAt)}`;

  return (
    <div
      className={`agent-view__thought${streaming ? ' agent-view__thought--streaming' : ''}${
        expanded ? ' agent-view__thought--expanded' : ''
      }`}
    >
      <button
        type='button'
        className='agent-view__thought-header app-button'
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span
          className={`agent-view__thought-title${
            streaming ? ' agent-view__thought-title--streaming' : ''
          }`}
        >
          {title}
        </span>
      </button>
      {expanded ? (
        <div className='agent-view__thought-body'>
          {turn.thought.trim() ? (
            <div className='agent-view__thought-prose'>{turn.thought}</div>
          ) : null}
          {streaming && !turn.thought.trim() ? (
            <div className='agent-view__thought-waiting'>
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CloudAgentResponseBody({
  text,
  streaming,
  projectPath,
}: {
  text: string;
  streaming: boolean;
  projectPath: string | null;
}) {
  const html = useDeferredMarkdownHtml(text, projectPath ?? undefined);
  const bodyRef = useMarkdownCodeHighlight<HTMLDivElement>(html);

  return (
    <div
      className={`agent-view__response${
        streaming ? ' agent-view__response--streaming' : ' agent-view__response--settled'
      }`}
    >
      <div
        ref={bodyRef}
        className='agent-view__response-body markdown-preview markdown-preview--monokai'
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function CloudAgentTurnView({
  turn,
  projectPath,
}: {
  turn: CloudAgentTurn;
  projectPath: string | null;
}) {
  const multiline = turn.prompt.includes('\n') || turn.prompt.length > 72;
  const running = turn.status === 'running';
  const showThought =
    running || Boolean(turn.thought) || Boolean(turn.response) || turn.status === 'error';
  const responseStreaming = running && Boolean(turn.response.trim());

  return (
    <div className='agent-view__turn app-button--enter'>
      <div className='agent-view__user-prompt'>
        <div
          className={`agent-view__user-bubble${
            multiline ? ' agent-view__user-bubble--multiline' : ''
          }`}
        >
          {turn.prompt}
        </div>
      </div>
      {showThought ? <CloudAgentThoughtBlock turn={turn} /> : null}
      {turn.response.trim() ? (
        <CloudAgentResponseBody
          text={turn.response}
          streaming={responseStreaming}
          projectPath={projectPath}
        />
      ) : null}
      {turn.status === 'error' && !turn.response.trim() ? (
        <div className='agent-view__response agent-view__response--settled'>
          <div className='agent-view__response-body cloud-agent-error'>
            Falha ao executar o agent na nuvem.
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface HomeDashboardCloudAgentCardProps {
  session: CloudAgentSession;
  enterDelayMs: number;
}

function HomeDashboardCloudAgentCardComponent({
  session,
  enterDelayMs,
}: HomeDashboardCloudAgentCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const removeSession = useCloudAgentSessionsStore((state) => state.removeSession);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => session.turns, [session.turns]);

  useEffect(() => {
    const node = transcriptRef.current;

    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [turns]);

  const handleOpenConfirm = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const handleCloseConfirm = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const handleConfirmClose = useCallback(() => {
    removeSession(session.id);

    if (cloudSupabase) {
      void closeAgentSession(cloudSupabase, session.id).catch(() => {});
    }
  }, [removeSession, session.id]);

  return (
    <article
      className='home-dashboard__agent-card home-dashboard__agent-card--cloud app-button--enter'
      style={{ animationDelay: `${enterDelayMs}ms` }}
    >
      <div className='home-dashboard__agent-card-head'>
        <span className='home-dashboard__agent-card-thumb-wrap'>
          <CloudAgentThumb logoUrl={session.logoUrl} color={session.projectColor} />
        </span>
        <div className='home-dashboard__agent-card-copy'>
          <span className='home-dashboard__agent-card-project'>{session.projectName}</span>
        </div>
        <div className='home-dashboard__agent-card-aside'>
          <span className='home-dashboard__agent-card-web-badge' title='Agent iniciado na web'>
            <Globe size={11} strokeWidth={2.25} aria-hidden='true' />
            <span>Web</span>
          </span>
          <button
            type='button'
            className='home-dashboard__agent-card-close app-button app-button--enter'
            aria-label='Fechar agent'
            onClick={handleOpenConfirm}
          >
            <X size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>
      </div>
      <div className='home-dashboard__agent-card-body'>
        <div className='agent-view' style={{ ['--agent-accent' as string]: session.projectColor }}>
          <div className='agent-view__transcript-shell'>
            <div className='agent-view__transcript' ref={transcriptRef}>
              {turns.map((turn) => (
                <CloudAgentTurnView
                  key={turn.id}
                  turn={turn}
                  projectPath={session.projectPath}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <span
        className={`home-dashboard__agent-card-progress${
          session.status === 'running' ? ' home-dashboard__agent-card-progress--busy' : ''
        }`}
        aria-hidden='true'
      />
      {confirmOpen ? (
        <CloudAgentCloseConfirm
          projectName={session.projectName}
          onConfirm={handleConfirmClose}
          onClose={handleCloseConfirm}
        />
      ) : null}
    </article>
  );
}

export const HomeDashboardCloudAgentCard = memo(HomeDashboardCloudAgentCardComponent);
