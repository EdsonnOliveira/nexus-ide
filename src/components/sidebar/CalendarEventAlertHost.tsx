import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarEventAlertModal } from '@/components/sidebar/CalendarEventAlertModal';
import { useAppleCalendarEvents } from '@/hooks/useAppleCalendarEvents';
import { useCalendarEventNotifications } from '@/hooks/useCalendarEventNotifications';
import { useCalendarEventNotificationStore } from '@/stores/useCalendarEventNotificationStore';
import { isCalendarEventStillVisible } from '@/utils/calendarEventStyle';

function CalendarEventAlertHostComponent() {
  const { snapshot, hydrated, openEvent } = useAppleCalendarEvents(true);
  const [now, setNow] = useState(() => Date.now());
  const urgentEvent = useCalendarEventNotificationStore((state) => state.urgentEvent);
  const dismissUrgentEvent = useCalendarEventNotificationStore((state) => state.dismissUrgentEvent);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const visibleEventsForNotifications = useMemo(() => {
    if (!hydrated || !snapshot.available || snapshot.events.length === 0) {
      return [];
    }

    return snapshot.events.filter((event) => isCalendarEventStillVisible(event, now));
  }, [hydrated, now, snapshot.available, snapshot.events]);

  useCalendarEventNotifications(visibleEventsForNotifications, hydrated && snapshot.available);

  const handleCloseUrgentModal = useCallback(() => {
    if (!urgentEvent) {
      return;
    }

    dismissUrgentEvent(urgentEvent);
  }, [dismissUrgentEvent, urgentEvent]);

  const handleOpenInCalendar = useCallback(
    (startAt: number) => {
      void openEvent(startAt);
    },
    [openEvent],
  );

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
