import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { AgentActivity } from '@/types';
import { normalizeMarkdownSource, renderMarkdownPreview } from '@/utils/markdownPreview';

interface AgentPlanReviewDockProps {
  activity: AgentActivity;
  isBusy: boolean;
  onAccept: (activityId: string) => boolean | Promise<boolean>;
  onReject: (activityId: string) => boolean;
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

function AgentPlanReviewDockComponent({
  activity,
  isBusy,
  onAccept,
  onReject,
}: AgentPlanReviewDockProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBuilding = activity.planStatus === 'building';
  const previewMarkdown = useMemo(() => buildPlanPreviewMarkdown(activity), [activity]);
  const previewHtml = useMemo(
    () => (previewMarkdown ? renderMarkdownPreview(normalizeMarkdownSource(previewMarkdown)) : ''),
    [previewMarkdown],
  );

  const handleAccept = useCallback(() => {
    if (isBusy || isSubmitting || isBuilding) {
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
  }, [activity.id, isBuilding, isBusy, isSubmitting, onAccept]);

  const handleReject = useCallback(() => {
    if (isBusy || isSubmitting || isBuilding) {
      return;
    }

    onReject(activity.id);
  }, [activity.id, isBuilding, isBusy, isSubmitting, onReject]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      if (isBusy || isSubmitting || isBuilding) {
        return;
      }

      event.preventDefault();
      handleAccept();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleAccept, isBuilding, isBusy, isSubmitting]);

  return (
    <div className='agent-view__plan-review-dock app-button--enter'>
      <div className='agent-view__plan-review-dock-card'>
        <div className='agent-view__plan-review-header'>
          <span className='agent-view__plan-review-label'>Review Plan</span>
          <button
            type='button'
            className='agent-view__plan-review-dismiss app-button app-button--enter'
            aria-label='Descartar plano'
            disabled={isBusy || isSubmitting || isBuilding}
            onClick={handleReject}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        {activity.planName ? (
          <div className='agent-view__plan-review-title'>{activity.planName}</div>
        ) : null}

        {previewHtml ? (
          <div
            className='agent-view__plan-review-body markdown-preview'
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <div className='agent-view__plan-review-body agent-view__plan-review-body--empty'>
            Plano pronto para revisão.
          </div>
        )}

        <div className='agent-view__plan-review-actions'>
          <button
            type='button'
            className='agent-view__plan-review-build app-button app-button--enter'
            disabled={isBusy || isSubmitting || isBuilding}
            onClick={handleAccept}
          >
            <span className='app-button__label'>
              {isBuilding || isSubmitting ? 'Executando plano…' : 'Build'}
            </span>
            <span className='agent-view__plan-review-build-shortcut'>⌘↵</span>
            <ChevronDown size={14} strokeWidth={2.25} className='agent-view__plan-review-build-chevron' />
          </button>
        </div>
      </div>
    </div>
  );
}

export const AgentPlanReviewDock = memo(AgentPlanReviewDockComponent);
