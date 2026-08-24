import { memo, useCallback } from 'react';
import { CalendarEventAlertModal } from '@/components/sidebar/CalendarEventAlertModal';
import { openAppleCalendarEvent, useAppleCalendarEvents } from '@/hooks/useAppleCalendarEvents';
import { useCalendarEventNotifications } from '@/hooks/useCalendarEventNotifications';
import { useCalendarEventNotificationStore } from '@/stores/useCalendarEventNotificationStore';
import type { CalendarEventItem } from '@/types';

const EMPTY_EVENTS: CalendarEventItem[] = [];

function CalendarEventAlertHostComponent() {
  const { snapshot, hydrated } = useAppleCalendarEvents(true);
  const urgentEvent = useCalendarEventNotificationStore((state) => state.urgentEvent);
  const dismissUrgentEvent = useCalendarEventNotificationStore((state) => state.dismissUrgentEvent);
  const events = hydrated && snapshot.available ? snapshot.events : EMPTY_EVENTS;

  useCalendarEventNotifications(events, hydrated && snapshot.available);

  const handleCloseUrgentModal = useCallback(() => {
    if (!urgentEvent) {
      return;
    }

    dismissUrgentEvent(urgentEvent);
  }, [dismissUrgentEvent, urgentEvent]);

  const handleOpenInCalendar = useCallback((startAt: number) => {
    void openAppleCalendarEvent(startAt);
  }, []);

  if (!urgentEvent) {
    return null;
  }

  return (
    <CalendarEventAlertModal
      event={urgentEvent}
      onClose={handleCloseUrgentModal}
      onOpenInCalendar={handleOpenInCalendar}
    />
  );
}

export const CalendarEventAlertHost = memo(CalendarEventAlertHostComponent);
