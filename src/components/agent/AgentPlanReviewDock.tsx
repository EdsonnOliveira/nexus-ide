import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Maximize2, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { useMarkdownCodeHighlight } from '@/hooks/useMarkdownCodeHighlight';
import type { AgentActivity, AgentPlanStatus } from '@/types';
import { useDeferredMarkdownHtml } from '@/hooks/useMarkdownCodeHighlight';

type AgentPlanReviewMode = 'pending' | 'archive';

interface AgentPlanReviewDockProps {
  activity: AgentActivity;
  mode?: AgentPlanReviewMode;
  isBusy?: boolean;
  onAccept?: (activityId: string) => boolean | Promise<boolean>;
  onReject?: (activityId: string) => boolean;
}

interface PlanReviewBuildButtonProps {
  isBuilding: boolean;
  isSubmitting: boolean;
  isBusy: boolean;
  isContentReady: boolean;
  isLoadingContent: boolean;
  onClick: () => void;
}

function buildPlanPreviewMarkdown(activity: AgentActivity): string {
  const sections: string[] = [];

  if (activity.planOverview?.trim()) {
    sections.push(activity.planOverview.trim());
  }

  if (activity.planBody?.trim()) {
    if (sections.length > 0) {
      sections.push('');
    }

    sections.push(activity.planBody.trim());
  }

  return sections.join('\n');
}

function resolvePlanEmptyMessage(activity: AgentActivity, loadTimedOut: boolean): string {
  const hasBody = Boolean(activity.planBody?.trim() || activity.planOverview?.trim());

  if (hasBody) {
    return 'Plano pronto para revisão.';
  }

  if (activity.planUri?.trim() && !loadTimedOut) {
    return 'Carregando conteúdo do plano…';
  }

  return 'Conteúdo do plano indisponível. Descarte e peça um novo plano.';
}

function resolvePlanArchiveStatusLabel(status: AgentPlanStatus | undefined): string {
  if (status === 'building') {
    return 'Executando plano…';
  }

  if (status === 'accepted') {
    return 'Plano executado';
  }

  if (status === 'rejected') {
    return 'Plano descartado';
  }

  return 'Plano';
}

function PlanReviewBuildButtonComponent({
  isBuilding,
  isSubmitting,
  isBusy,
  isContentReady,
  isLoadingContent,
  onClick,
}: PlanReviewBuildButtonProps) {
  return (
    <button
      type='button'
      className='agent-view__plan-review-build app-button app-button--enter'
      disabled={isBusy || isSubmitting || isBuilding || !isContentReady}
      onClick={onClick}
    >
      <span className='app-button__label'>
        {isBuilding || isSubmitting
          ? 'Executando plano…'
          : isLoadingContent
            ? 'Carregando…'
            : 'Build'}
      </span>
      {!isLoadingContent ? (
        <span className='agent-view__plan-review-build-shortcut'>⌘↵</span>
      ) : null}
      <ChevronDown size={14} strokeWidth={2.25} className='agent-view__plan-review-build-chevron' />
    </button>
  );
}

const PlanReviewBuildButton = memo(PlanReviewBuildButtonComponent);

interface PlanReviewBodyProps {
  previewHtml: string;
  emptyMessage: string;
  className?: string;
}

function PlanReviewBodyComponent({ previewHtml, emptyMessage, className }: PlanReviewBodyProps) {
  const bodyRef = useMarkdownCodeHighlight<HTMLDivElement>(previewHtml);

  if (previewHtml) {
    return (
      <div
        ref={bodyRef}
        className={`agent-view__plan-review-body markdown-preview markdown-preview--monokai${className ? ` ${className}` : ''}`}
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    );
  }

  return (
    <div
      className={`agent-view__plan-review-body agent-view__plan-review-body--empty${className ? ` ${className}` : ''}`}
    >
      {emptyMessage}
    </div>
  );
}

const PlanReviewBody = memo(PlanReviewBodyComponent);

function AgentPlanReviewDockComponent({
  activity,
  mode = 'pending',
  isBusy = false,
  onAccept,
  onReject,
}: AgentPlanReviewDockProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const isArchive = mode === 'archive';
  const isPending = mode === 'pending';
  const isBuilding = activity.planStatus === 'building';
  const hasPlanContent = Boolean(activity.planBody?.trim() || activity.planOverview?.trim());
  const isLoadingPlanBody = Boolean(
    isPending && activity.planUri?.trim() && !hasPlanContent && !loadTimedOut,
  );
  const isContentReady = hasPlanContent;
  const emptyMessage = useMemo(
    () => resolvePlanEmptyMessage(activity, loadTimedOut),
    [activity, loadTimedOut],
  );
  const previewMarkdown = useMemo(() => buildPlanPreviewMarkdown(activity), [activity]);
  const previewHtml = useDeferredMarkdownHtml(previewMarkdown);
  const archiveStatusLabel = useMemo(
    () => resolvePlanArchiveStatusLabel(activity.planStatus),
    [activity.planStatus],
  );

  useEffect(() => {
    if (!isPending || hasPlanContent || !activity.planUri?.trim()) {
      setLoadTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLoadTimedOut(true);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activity.planUri, hasPlanContent, isPending]);

  const handleAccept = useCallback(() => {
    if (!isPending || !onAccept || isBusy || isSubmitting || isBuilding || !isContentReady) {
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        await onAccept(activity.id);
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [activity.id, isBuilding, isBusy, isContentReady, isPending, isSubmitting, onAccept]);

  const handleReject = useCallback(() => {
    if (!isPending || !onReject || isBusy || isSubmitting || isBuilding) {
      return;
    }

    onReject(activity.id);
  }, [activity.id, isBuilding, isBusy, isPending, isSubmitting, onReject]);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  useEffect(() => {
    if (!isPending) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      if (isBusy || isSubmitting || isBuilding || !isContentReady) {
        return;
      }

      event.preventDefault();
      handleAccept();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleAccept, isBuilding, isBusy, isContentReady, isPending, isSubmitting]);

  return (
    <>
      <div
        className={`agent-view__plan-review-dock app-button--enter${isArchive ? ' agent-view__plan-review-dock--archive' : ''}`}
      >
        <div className='agent-view__plan-review-dock-card'>
          <div className='agent-view__plan-review-header'>
            <span className='agent-view__plan-review-label'>Review Plan</span>
            {isArchive ? (
              <span className='agent-view__plan-review-status app-button--enter'>{archiveStatusLabel}</span>
            ) : (
              <button
                type='button'
                className='agent-view__plan-review-dismiss app-button app-button--enter'
                aria-label='Descartar plano'
                disabled={isBusy || isSubmitting || isBuilding}
                onClick={handleReject}
              >
                <X size={14} strokeWidth={2.25} />
              </button>
            )}
          </div>

          {activity.planName ? (
            <div className='agent-view__plan-review-title'>{activity.planName}</div>
          ) : null}

          <div className='agent-view__plan-review-shell'>
            <PlanReviewBody previewHtml={previewHtml} emptyMessage={emptyMessage} />

            <div className='agent-view__plan-review-actions-float'>
              <button
                type='button'
                className='agent-view__plan-review-expand app-button app-button--enter'
                aria-label='Abrir plano em tela cheia'
                disabled={isPending && (isBusy || isSubmitting || isBuilding)}
                onClick={handleOpenModal}
              >
                <Maximize2 size={14} strokeWidth={2.25} />
              </button>
              {isPending ? (
                <PlanReviewBuildButton
                  isBuilding={isBuilding}
                  isBusy={isBusy}
                  isContentReady={isContentReady}
                  isLoadingContent={isLoadingPlanBody}
                  isSubmitting={isSubmitting}
                  onClick={handleAccept}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {isModalOpen ? (
        <AnimatedModal
          panelClassName='project-dialog agent-plan-review-modal'
          onClose={handleCloseModal}
        >
          {(requestClose) => (
            <>
              <div className='agent-plan-review-modal__header'>
                <div className='agent-plan-review-modal__heading'>
                  <span className='agent-view__plan-review-label'>Review Plan</span>
                  {activity.planName ? (
                    <div className='agent-plan-review-modal__title'>{activity.planName}</div>
                  ) : null}
                </div>
                <button
                  type='button'
                  className='agent-view__plan-review-dismiss app-button app-button--enter'
                  aria-label='Fechar revisão do plano'
                  onClick={requestClose}
                >
                  <X size={14} strokeWidth={2.25} />
                </button>
              </div>

              <div className='agent-plan-review-modal__shell'>
                <PlanReviewBody
                  previewHtml={previewHtml}
                  emptyMessage={emptyMessage}
                  className='agent-plan-review-modal__body'
                />
                {isPending ? (
                  <div className='agent-plan-review-modal__build-float'>
                    <PlanReviewBuildButton
                      isBuilding={isBuilding}
                      isBusy={isBusy}
                      isContentReady={isContentReady}
                      isLoadingContent={isLoadingPlanBody}
                      isSubmitting={isSubmitting}
                      onClick={handleAccept}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const AgentPlanReviewDock = memo(AgentPlanReviewDockComponent);
