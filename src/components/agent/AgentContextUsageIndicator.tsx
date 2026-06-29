import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import {
  AGENT_CONTEXT_CATEGORY_COLORS,
  buildFallbackAgentContextUsage,
  type AgentContextUsageSnapshot,
} from '@/utils/agentContextUsageParser';

interface AgentContextUsageIndicatorProps {
  usage: AgentContextUsageSnapshot | null;
  isLoading: boolean;
  visible: boolean;
  onRequestReport: () => void;
}

const RING_SIZE = 18;
const RING_STROKE = 2.25;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ContextUsageRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      aria-hidden='true'
      className='agent-context-usage__ring'
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill='none'
        stroke='currentColor'
        strokeOpacity={0.18}
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill='none'
        stroke='currentColor'
        strokeWidth={RING_STROKE}
        strokeLinecap='round'
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
      />
    </svg>
  );
}

function ContextUsageBar({
  categories,
  totalTokensUsed,
  contextWindowSize,
}: {
  categories: AgentContextUsageSnapshot['categories'];
  totalTokensUsed: number;
  contextWindowSize: number;
}) {
  const denominator = contextWindowSize > 0 ? contextWindowSize : totalTokensUsed;

  if (denominator <= 0 || categories.length === 0) {
    const width = Math.max(0, Math.min(100, (totalTokensUsed / (contextWindowSize || 1)) * 100));

    return (
      <div className='agent-context-usage__bar' aria-hidden='true'>
        <span
          className='agent-context-usage__bar-segment agent-context-usage__bar-segment--fallback'
          style={{ width: `${width}%` }}
        />
      </div>
    );
  }

  return (
    <div className='agent-context-usage__bar' aria-hidden='true'>
      {categories.map((category) => (
        <span
          key={category.id}
          className='agent-context-usage__bar-segment'
          style={{
            width: `${Math.max(0, (category.tokens / denominator) * 100)}%`,
            backgroundColor:
              AGENT_CONTEXT_CATEGORY_COLORS[category.id] ?? AGENT_CONTEXT_CATEGORY_COLORS.uncategorized,
          }}
        />
      ))}
    </div>
  );
}

interface AgentContextUsagePanelProps {
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  usage: AgentContextUsageSnapshot;
  isLoading: boolean;
  onClose: () => void;
}

function AgentContextUsagePanelComponent({
  anchorRect,
  triggerRef,
  usage,
  isLoading,
  onClose,
}: AgentContextUsagePanelProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'end'),
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

  const percentLabel = `${Math.round(usage.percent)}% Full`;
  const tokensLabel = `${usage.totalTokensLabel} / ${usage.contextWindowLabel} Tokens`;

  return (
    <div
      ref={menuRef}
      className={`agent-context-usage__popover overlay-popup ${animationClass}`}
      role='dialog'
      aria-label='Context Usage'
    >
      <div className='agent-context-usage__panel'>
        <div className='agent-context-usage__header'>
          <span className='agent-context-usage__title'>Context Usage</span>
          <button
            type='button'
            className='agent-context-usage__close app-button app-button--enter'
            aria-label='Fechar uso de contexto'
            onClick={requestClose}
          >
            <X size={14} strokeWidth={2} aria-hidden='true' />
          </button>
        </div>

        <div className='agent-context-usage__summary'>
          <span className='agent-context-usage__summary-percent'>{percentLabel}</span>
          <span className='agent-context-usage__summary-tokens'>{tokensLabel}</span>
        </div>

        <ContextUsageBar
          categories={usage.categories}
          totalTokensUsed={usage.totalTokensUsed}
          contextWindowSize={usage.contextWindowSize}
        />

        {isLoading ? (
          <div className='agent-context-usage__loading'>Carregando detalhes…</div>
        ) : null}

        {usage.categories.length > 0 ? (
          <ul className='agent-context-usage__list'>
            {usage.categories.map((category) => (
              <li key={category.id} className='agent-context-usage__item app-button'>
                <span
                  className='agent-context-usage__swatch'
                  style={{
                    backgroundColor:
                      AGENT_CONTEXT_CATEGORY_COLORS[category.id] ??
                      AGENT_CONTEXT_CATEGORY_COLORS.uncategorized,
                  }}
                  aria-hidden='true'
                />
                <span className='agent-context-usage__item-label'>{category.label}</span>
                <span className='agent-context-usage__item-tokens'>{category.displayTokens}</span>
              </li>
            ))}
          </ul>
        ) : !isLoading ? (
          <div className='agent-context-usage__empty'>Detalhes por categoria indisponíveis no momento.</div>
        ) : null}
      </div>
    </div>
  );
}

const AgentContextUsagePanel = memo(AgentContextUsagePanelComponent);

function AgentContextUsageIndicatorComponent({
  usage,
  isLoading,
  visible,
  onRequestReport,
}: AgentContextUsageIndicatorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const handleOpen = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAnchorRect(rect);
    setOpen(true);
    onRequestReport();
  }, [onRequestReport]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const percent = usage?.percent ?? 0;
  const percentText = `${Math.round(percent)}%`;
  const panelUsage = usage ?? buildFallbackAgentContextUsage(0);

  if (!visible) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={`agent-context-usage app-button app-button--enter${open ? ' agent-context-usage--open' : ''}`}
        aria-label={`Uso de contexto ${percentText}`}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            handleClose();
            return;
          }

          handleOpen();
        }}
      >
        <ContextUsageRing percent={percent} />
        <span className='agent-context-usage__value'>{percentText}</span>
      </button>

      {open && anchorRect
        ? createPortal(
            <AgentContextUsagePanel
              anchorRect={anchorRect}
              triggerRef={triggerRef}
              usage={panelUsage}
              isLoading={isLoading}
              onClose={handleClose}
            />,
            document.body,
          )
        : null}
    </>
  );
}

export const AgentContextUsageIndicator = memo(AgentContextUsageIndicatorComponent);
