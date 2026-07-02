import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentResponseCopyPill } from '@/components/agent/AgentResponseCopyPill';
import { DailyGenerateDateMenu } from '@/components/home/DailyGenerateDateMenu';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { useDeferredMarkdownHtml, useMarkdownCodeHighlight } from '@/hooks/useMarkdownCodeHighlight';
import type { DailyAgentResultModalState } from '@/hooks/useDailyAgentGeneration';
import {
  DAILY_RESPONSE_TONE_HINTS,
  DAILY_RESPONSE_TONE_LABELS,
  DAILY_RESPONSE_TONES,
  type DailyResponseTone,
} from '@/utils/dailyResponseTone';

interface DailyAgentResultModalProps {
  modal: DailyAgentResultModalState;
  isRunning: boolean;
  onClose: () => void;
  onRegenerate: (targetDate: Date) => void;
}

interface DailyAgentResultBodyProps {
  content: string;
}

function DailyAgentResultBody({ content }: DailyAgentResultBodyProps) {
  const previewHtml = useDeferredMarkdownHtml(content);
  const bodyRef = useMarkdownCodeHighlight<HTMLDivElement>(previewHtml);

  if (!content.trim()) {
    return <p className='home-dashboard__daily-empty-inline'>Nenhuma resposta gerada.</p>;
  }

  return (
    <div
      ref={bodyRef}
      className='home-dashboard__daily-modal-body agent-view__response-body markdown-preview markdown-preview--monokai'
      dangerouslySetInnerHTML={{ __html: previewHtml }}
    />
  );
}

function DailyAgentResultModalComponent({
  modal,
  isRunning,
  onClose,
  onRegenerate,
}: DailyAgentResultModalProps) {
  const [activeTone, setActiveTone] = useState<DailyResponseTone>('non-technical');
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [regenerateMenuOpen, setRegenerateMenuOpen] = useState(false);
  const [regenerateMenuAnchor, setRegenerateMenuAnchor] = useState<DOMRect | null>(null);
  const regenerateButtonRef = useRef<HTMLButtonElement>(null);

  const activeResponse = modal.responses[activeTone];
  const isAnyLoading = useMemo(
    () => DAILY_RESPONSE_TONES.some((tone) => modal.responses[tone].status === 'loading'),
    [modal.responses],
  );
  const canRegenerate = !isRunning && !isAnyLoading;
  const canCopy = !isAnyLoading && activeResponse.content.trim().length > 0;

  useEffect(() => {
    setActiveTone('non-technical');
  }, [modal.project.id]);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!modal.project.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(modal.project.logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [modal.project.logo]);

  const handleRegenerateMenuClose = useCallback(() => {
    setRegenerateMenuOpen(false);
    setRegenerateMenuAnchor(null);
  }, []);

  const handleRegenerateClick = useCallback(() => {
    const button = regenerateButtonRef.current;

    if (!button) {
      return;
    }

    setRegenerateMenuAnchor(button.getBoundingClientRect());
    setRegenerateMenuOpen(true);
  }, []);

  const handleRegenerateDateSelect = useCallback(
    (targetDate: Date) => {
      onRegenerate(targetDate);
      handleRegenerateMenuClose();
    },
    [handleRegenerateMenuClose, onRegenerate],
  );

  const showLogo = Boolean(logoSrc) && !logoFailed;

  return (
    <>
      <AnimatedModal onClose={onClose} panelClassName='project-dialog home-dashboard__daily-modal'>
        {(requestClose) => (
          <>
            <header className='home-dashboard__daily-modal-header'>
              <div className='home-dashboard__daily-modal-heading'>
                <span className='home-dashboard__daily-modal-icon' aria-hidden='true'>
                  <Sparkles size={16} strokeWidth={2} />
                </span>
                <h2 className='home-dashboard__daily-modal-title'>Daily</h2>
              </div>
              <div className='home-dashboard__daily-modal-project'>
                <span className='home-dashboard__daily-project-icon-wrap' aria-hidden='true'>
                  {showLogo ? (
                    <img src={logoSrc ?? undefined} alt='' className='home-dashboard__daily-project-logo' />
                  ) : (
                    <span
                      className='home-dashboard__daily-project-icon'
                      style={{ backgroundColor: modal.project.color }}
                    >
                      <ProjectIconMark icon={modal.project.icon} />
                    </span>
                  )}
                </span>
                <span className='home-dashboard__daily-project-copy'>
                  <span className='home-dashboard__daily-project-name'>{modal.project.name}</span>
                  <span className='home-dashboard__daily-project-meta'>{modal.projectMeta}</span>
                </span>
              </div>
            </header>
            <div
              className='home-dashboard__daily-modal-tone-tabs'
              role='tablist'
              aria-label='Tipo de resposta'
            >
              {DAILY_RESPONSE_TONES.map((tone) => {
                const response = modal.responses[tone];
                const isActive = activeTone === tone;
                const isLoading = response.status === 'loading';

                return (
                  <button
                    key={tone}
                    type='button'
                    role='tab'
                    aria-selected={isActive}
                    title={DAILY_RESPONSE_TONE_HINTS[tone]}
                    className={`home-dashboard__daily-modal-tone-tab app-button${isActive ? ' home-dashboard__daily-modal-tone-tab--active' : ''}`}
                    onClick={() => setActiveTone(tone)}
                  >
                    {isLoading ? (
                      <Loader2 size={12} className='home-dashboard__daily-modal-spinner' aria-hidden='true' />
                    ) : null}
                    <span>{DAILY_RESPONSE_TONE_LABELS[tone]}</span>
                  </button>
                );
              })}
            </div>
            {activeResponse.status === 'loading' ? (
              <div className='home-dashboard__daily-modal-loading'>
                <Loader2 size={18} className='home-dashboard__daily-modal-spinner' aria-hidden='true' />
                <span>Gerando {DAILY_RESPONSE_TONE_LABELS[activeTone].toLowerCase()}...</span>
              </div>
            ) : (
              <DailyAgentResultBody content={activeResponse.content} />
            )}
            {activeResponse.status === 'error' && activeResponse.errorMessage ? (
              <p className='automation-prompt-modal__error'>{activeResponse.errorMessage}</p>
            ) : null}
            <div className='project-dialog__actions project-dialog__actions--split home-dashboard__daily-modal-actions'>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button'
                onClick={requestClose}
              >
                Fechar
              </button>
              <div className='project-dialog__actions-group'>
                {canRegenerate ? (
                  <button
                    ref={regenerateButtonRef}
                    type='button'
                    className={`home-dashboard__daily-regenerate project-dialog__btn app-button app-button--enter${regenerateMenuOpen ? ' home-dashboard__daily-regenerate--open' : ''}`}
                    aria-expanded={regenerateMenuOpen}
                    aria-haspopup='menu'
                    onClick={handleRegenerateClick}
                  >
                    <RefreshCw size={14} strokeWidth={2.25} />
                    <span>Gerar novamente</span>
                  </button>
                ) : null}
                {canCopy ? <AgentResponseCopyPill content={activeResponse.content} nexusGo /> : null}
              </div>
            </div>
          </>
        )}
      </AnimatedModal>
      {regenerateMenuOpen && regenerateMenuAnchor ? (
        <DailyGenerateDateMenu
          anchorRect={regenerateMenuAnchor}
          triggerRef={regenerateButtonRef}
          onClose={handleRegenerateMenuClose}
          onSelect={handleRegenerateDateSelect}
        />
      ) : null}
    </>
  );
}

export const DailyAgentResultModal = memo(DailyAgentResultModalComponent);
