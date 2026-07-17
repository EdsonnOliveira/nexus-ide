import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Gauge, X } from 'lucide-react';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { CursorPeriodUsageSnapshot } from '@/types';

interface AgentCursorUsageIndicatorProps {
  usage: CursorPeriodUsageSnapshot | null;
  isLoading: boolean;
  visible: boolean;
  onRefresh: () => void;
  onRequestComposerFocus?: () => void;
}

function resolveUsageTone(percent: number): 'normal' | 'warning' | 'critical' {
  if (percent >= 95) {
    return 'critical';
  }

  if (percent >= 80) {
    return 'warning';
  }

  return 'normal';
}

function formatUsageDate(timestampMs: number | null): string | null {
  if (!timestampMs) {
    return null;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(timestampMs));
}

interface AgentCursorUsagePanelProps {
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  usage: CursorPeriodUsageSnapshot;
  isLoading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

function AgentCursorUsagePanelSkeleton() {
  return (
    <div className='agent-cursor-usage__skeleton' aria-hidden='true'>
      <div className='agent-cursor-usage__skeleton-summary'>
        <span className='agent-cursor-usage__skeleton-block agent-cursor-usage__skeleton-block--percent' />
        <span className='agent-cursor-usage__skeleton-block agent-cursor-usage__skeleton-block--plan' />
      </div>
      <div className='agent-cursor-usage__skeleton-list'>
        {[0, 1, 2].map((index) => (
          <div key={index} className='agent-cursor-usage__skeleton-row'>
            <span className='agent-cursor-usage__skeleton-block agent-cursor-usage__skeleton-block--label' />
            <span className='agent-cursor-usage__skeleton-block agent-cursor-usage__skeleton-block--value' />
          </div>
        ))}
      </div>
      <span className='agent-cursor-usage__skeleton-block agent-cursor-usage__skeleton-block--period' />
    </div>
  );
}

function AgentCursorUsagePanelComponent({
  anchorRect,
  triggerRef,
  usage,
  isLoading,
  onClose,
  onRefresh,
}: AgentCursorUsagePanelProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect, usage.updatedAt, isLoading],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuRef, requestClose, triggerRef]);

  const billingStart = formatUsageDate(usage.billingCycleStartMs);
  const billingEnd = formatUsageDate(usage.billingCycleEndMs);
  const billingLabel =
    billingStart && billingEnd ? `${billingStart} – ${billingEnd}` : null;

  const handleOpenDashboard = useCallback(() => {
    void window.nexus.tasks.openExternalUrl('https://cursor.com/dashboard/usage');
  }, []);

  return (
    <div
      ref={menuRef}
      className={`agent-cursor-usage__popover overlay-popup ${animationClass}`}
      role='dialog'
      aria-label='Uso do Cursor'
    >
      <div className='agent-cursor-usage__panel'>
        <div className='agent-cursor-usage__header'>
          <span className='agent-cursor-usage__title'>Uso do Cursor</span>
          <button
            type='button'
            className='agent-cursor-usage__close app-button app-button--enter'
            aria-label='Fechar'
            onClick={requestClose}
          >
            <X size={14} />
          </button>
        </div>

        {isLoading ? (
          <AgentCursorUsagePanelSkeleton />
        ) : (
          <>
            <div className='agent-cursor-usage__summary'>
              <span className='agent-cursor-usage__summary-percent'>{Math.round(usage.percent)}%</span>
              {usage.membershipType ? (
                <span className='agent-cursor-usage__summary-plan'>{usage.membershipType}</span>
              ) : null}
            </div>

            <ul className='agent-cursor-usage__list'>
              <li className='agent-cursor-usage__item'>
                <span className='agent-cursor-usage__item-label'>Total incluído</span>
                <span className='agent-cursor-usage__item-value'>
                  {Math.round(usage.totalPercentUsed)}%
                </span>
              </li>
              <li className='agent-cursor-usage__item'>
                <span className='agent-cursor-usage__item-label'>Auto + Composer</span>
                <span className='agent-cursor-usage__item-value'>
                  {Math.round(usage.autoPercentUsed)}%
                </span>
              </li>
              <li className='agent-cursor-usage__item'>
                <span className='agent-cursor-usage__item-label'>API</span>
                <span className='agent-cursor-usage__item-value'>
                  {Math.round(usage.apiPercentUsed)}%
                </span>
              </li>
            </ul>

            {billingLabel ? (
              <p className='agent-cursor-usage__period'>Período: {billingLabel}</p>
            ) : null}
          </>
        )}

        <div className='agent-cursor-usage__actions'>
          <button
            type='button'
            className='agent-cursor-usage__action app-button app-button--enter'
            onClick={() => {
              onRefresh();
            }}
          >
            Atualizar
          </button>
          <button
            type='button'
            className='agent-cursor-usage__action app-button app-button--enter'
            onClick={handleOpenDashboard}
          >
            <ExternalLink size={13} aria-hidden='true' />
            Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

const AgentCursorUsagePanel = memo(AgentCursorUsagePanelComponent);

function AgentCursorUsageIndicatorComponent({
  usage,
  isLoading,
  visible,
  onRefresh,
  onRequestComposerFocus,
}: AgentCursorUsageIndicatorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const percent = usage?.percent ?? 0;
  const percentText = `${Math.round(percent)}%`;
  const tone = useMemo(() => resolveUsageTone(percent), [percent]);

  const handleOpen = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAnchorRect(rect);
    setOpen(true);
    onRefresh();
  }, [onRefresh]);

  const handleClose = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      onRequestComposerFocus?.();
    });
  }, [onRequestComposerFocus]);

  if (!visible || !usage?.available) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={`agent-cursor-usage app-button app-button--enter agent-cursor-usage--${tone}${open ? ' agent-cursor-usage--open' : ''}`}
        aria-label={`Uso do Cursor ${percentText}`}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            handleClose();
            return;
          }

          handleOpen();
        }}
      >
        <Gauge size={14} strokeWidth={2} className='agent-cursor-usage__icon' aria-hidden='true' />
        <span className='agent-cursor-usage__value'>{isLoading ? '…' : percentText}</span>
      </button>

      {open && anchorRect ? (
        createPortal(
          <AgentCursorUsagePanel
            anchorRect={anchorRect}
            triggerRef={triggerRef}
            usage={usage}
            isLoading={isLoading}
            onClose={handleClose}
            onRefresh={onRefresh}
          />,
          document.body,
        )
      ) : null}
    </>
  );
}

export const AgentCursorUsageIndicator = memo(AgentCursorUsageIndicatorComponent);
