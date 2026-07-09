import { memo, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';
import {
  CalendarEventDetailsPanel,
  CalendarEventFooterActions,
} from '@/components/sidebar/CalendarEventDetailsPanel';
import { CalendarMeetingIcon } from '@/components/sidebar/CalendarMeetingIcon';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { CalendarEventItem } from '@/types';
import { startCalendarEventCall } from '@/utils/calendarEventStartCall';
import { resolveCalendarExternalUrl, resolveCalendarMeetingInfo } from '@/utils/calendarEventStyle';

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

  const meetingInfo = useMemo(() => resolveCalendarMeetingInfo(event), [event]);

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

  const handleStartCall = useCallback(() => {
    void startCalendarEventCall(event);
    requestClose();
  }, [event, requestClose]);

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title={event.title}
      titleLeading={
        meetingInfo ? <CalendarMeetingIcon provider={meetingInfo.provider} /> : undefined
      }
      ariaLabel={`Detalhes do evento ${event.title}`}
      panelClassName='sidebar-calendar-popup__panel'
      onClose={requestClose}
      actions={
        <CalendarEventFooterActions
          onOpenInCalendar={handleOpenInCalendar}
          onStartCall={handleStartCall}
          showStartCall
        />
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
