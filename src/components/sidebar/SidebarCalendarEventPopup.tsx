import { memo, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';
import { CalendarEventDetailsPanel } from '@/components/sidebar/CalendarEventDetailsPanel';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { CalendarEventItem } from '@/types';
import { resolveCalendarExternalUrl } from '@/utils/calendarEventStyle';

interface SidebarCalendarEventPopupProps {
  event: CalendarEventItem;
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenInCalendar: (startAt: number) => void;
}

function SidebarCalendarEventPopupComponent({
  event,
  anchorRect,
  anchorRef,
  onClose,
  onOpenInCalendar,
}: SidebarCalendarEventPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect, event.id, event.startAt],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const handleOpenInCalendar = useCallback(() => {
    onOpenInCalendar(event.startAt);
    requestClose();
  }, [event.startAt, onOpenInCalendar, requestClose]);

  const handleOpenExternalUrl = useCallback((url: string) => {
    if (!window.nexus?.tasks) {
      return;
    }

    const resolved = resolveCalendarExternalUrl(url);

    if (!resolved) {
      return;
    }

    void window.nexus.tasks.openExternalUrl(resolved);
  }, []);

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title={event.title}
      ariaLabel={`Detalhes do evento ${event.title}`}
      onClose={requestClose}
      actions={
        <button
          type='button'
          className='agent-cursor-usage__action app-button app-button--enter'
          onClick={handleOpenInCalendar}
        >
          Abrir no Calendário
        </button>
      }
    >
      <CalendarEventDetailsPanel
        event={event}
        onOpenExternalUrl={handleOpenExternalUrl}
      />
    </TitleBarPopupShell>,
    document.body,
  );
}

export const SidebarCalendarEventPopup = memo(SidebarCalendarEventPopupComponent);
