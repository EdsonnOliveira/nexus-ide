import { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';
import type { AiProviderUsageItem, AiUsageProviderId } from '@/types';
import logoAntigravity from '@/assets/logo-antigravity.svg';
import logoClaude from '@/assets/logo-claude.svg';
import logoCodex from '@/assets/logo-codex.svg';
import logoCursor from '@/assets/logo-cursor.svg';
import logoGemini from '@/assets/logo-gemini.svg';
import logoOpencode from '@/assets/logo-opencode.svg';

const PROVIDER_LOGOS: Record<AiUsageProviderId, string> = {
  cursor: logoCursor,
  claude: logoClaude,
  opencode: logoOpencode,
  gemini: logoGemini,
  codex: logoCodex,
  antigravity: logoAntigravity,
};

interface TitleBarUsagePopupProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  items: AiProviderUsageItem[];
  isLoading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

function usageToneClass(percent: number | null): string {
  if (percent === null) {
    return ' titlebar-panel__usage-value--muted';
  }

  if (percent >= 95) {
    return ' titlebar-panel__usage-value--critical';
  }

  if (percent >= 80) {
    return ' titlebar-panel__usage-value--warning';
  }

  if (percent <= 50) {
    return ' titlebar-panel__usage-value--good';
  }

  return '';
}

function TitleBarUsagePopupComponent({
  anchorRect,
  anchorRef,
  items,
  isLoading,
  onClose,
  onRefresh,
}: TitleBarUsagePopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect, items, isLoading],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const rows = useMemo(() => items, [items]);

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title='Limites de IA'
      onClose={requestClose}
      actions={
        <button
          type='button'
          className='agent-cursor-usage__action app-button app-button--enter'
          onClick={() => {
            onRefresh();
          }}
        >
          Atualizar
        </button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={Gauge} message='Nenhum limite de IA encontrado' compact />
      ) : (
        <ul className='titlebar-panel__usage-list'>
          {rows.map((item) => (
            <li key={item.id} className='titlebar-panel__usage-row'>
              <span className='titlebar-panel__output-item'>
                <span className={`titlebar-panel__output-icon titlebar-panel__usage-icon--${item.id}`} aria-hidden='true'>
                  <img
                    src={PROVIDER_LOGOS[item.id]}
                    alt=''
                    className='titlebar-panel__usage-logo'
                    draggable={false}
                  />
                </span>
                <span className='titlebar-panel__usage-copy'>
                  <span className='titlebar-panel__output-name'>{item.label}</span>
                  {item.detail ? (
                    <span className='titlebar-panel__usage-detail'>{item.detail}</span>
                  ) : null}
                </span>
              </span>
              <span className={`titlebar-panel__usage-value${usageToneClass(item.percent)}`}>
                {isLoading && item.percent === null
                  ? '…'
                  : item.percent === null
                    ? '—'
                    : `${Math.round(item.percent)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TitleBarPopupShell>,
    document.body,
  );
}

export const TitleBarUsagePopup = memo(TitleBarUsagePopupComponent);
