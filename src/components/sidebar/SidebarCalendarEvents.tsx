import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { SidebarCalendarEventPopup } from '@/components/sidebar/SidebarCalendarEventPopup';
import { useAppleCalendarEvents } from '@/hooks/useAppleCalendarEvents';
import { useCalendarEventNotificationStore } from '@/stores/useCalendarEventNotificationStore';
import type { CalendarEventItem } from '@/types';
import {
  buildCalendarEventStyle,
  formatCalendarEventTime,
  getCalendarEventKey,
  getVisibleCalendarEvents,
  isCalendarEventLive,
} from '@/utils/calendarEventStyle';
import { getProjectPingTone } from '@/utils/projectPingTone';

interface SidebarCalendarEventRowProps {
  event: CalendarEventItem;
  isActive: boolean;
  isLive: boolean;
  isPinging: boolean;
  onSelect: (event: CalendarEventItem, anchorRef: React.RefObject<HTMLButtonElement | null>) => void;
}

function SidebarCalendarEventRowComponent({ event, isActive, isLive, isPinging, onSelect }: SidebarCalendarEventRowProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const style = useMemo(() => buildCalendarEventStyle(event.colorHex), [event.colorHex]);
  const pingTone = useMemo(() => getProjectPingTone(event.colorHex), [event.colorHex]);
  const startLabel = useMemo(
    () => formatCalendarEventTime(event.startAt, event.allDay),
    [event.allDay, event.startAt],
  );
  const endLabel = useMemo(
    () => formatCalendarEventTime(event.endAt, event.allDay),
    [event.allDay, event.endAt],
  );
  const locationLabel = event.location.trim() || event.calendarName;

  const handleOpen = useCallback(() => {
    onSelect(event, buttonRef);
  }, [event, onSelect]);

  return (
    <button
      ref={buttonRef}
      type='button'
      className={`sidebar-calendar-event app-button app-button--enter${isActive ? ' sidebar-calendar-event--active' : ''}${isPinging ? ' sidebar-calendar-event--ping' : ''}`}
      style={style}
      title={event.title}
      onClick={handleOpen}
    >
      {isPinging ? (
        <span
          className={`sidebar-calendar-event__ping project-item__ping project-item__ping--${pingTone}`}
          aria-hidden='true'
        />
      ) : null}
      <span className='sidebar-calendar-event__accent' aria-hidden='true' />
      <span className='sidebar-calendar-event__content'>
        <span className='sidebar-calendar-event__title'>{event.title}</span>
        <span className='sidebar-calendar-event__meta'>
          <MapPin size={11} strokeWidth={2} className='sidebar-calendar-event__meta-icon' aria-hidden='true' />
          <span className='sidebar-calendar-event__meta-text'>{locationLabel}</span>
        </span>
        <span className='sidebar-calendar-event__times'>
          {isLive ? (
            <span className='sidebar-calendar-event__live' aria-label='Reunião em andamento'>
              <span className='sidebar-calendar-event__live-dot' aria-hidden='true' />
            </span>
          ) : null}
          <span className='sidebar-calendar-event__times-copy'>
            <span className='sidebar-calendar-event__time sidebar-calendar-event__time--primary'>{startLabel}</span>
            {!event.allDay ? (
              <span className='sidebar-calendar-event__time sidebar-calendar-event__time--secondary'>{endLabel}</span>
            ) : null}
          </span>
        </span>
      </span>
    </button>
  );
}

const SidebarCalendarEventRow = memo(SidebarCalendarEventRowComponent);

function SidebarCalendarAccessCardComponent({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <button
      type='button'
      className='sidebar-calendar-access app-button app-button--enter'
      title='Permitir acesso ao Calendário'
      onClick={onOpenSettings}
    >
      <span className='sidebar-calendar-access__icon' aria-hidden='true'>
        <CalendarDays size={14} />
      </span>
      <span className='sidebar-calendar-access__copy'>
        <span className='sidebar-calendar-access__title'>Calendário bloqueado</span>
        <span className='sidebar-calendar-access__subtitle'>Clique para solicitar acesso ao Calendário</span>
      </span>
    </button>
  );
}

const SidebarCalendarAccessCard = memo(SidebarCalendarAccessCardComponent);

interface ActiveCalendarEventPopupState {
  event: CalendarEventItem;
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

function SidebarCalendarEventsComponent() {
  const { snapshot, loading, hydrated, openEvent, refresh } = useAppleCalendarEvents(true);
  const [now, setNow] = useState(() => Date.now());
  const [activePopup, setActivePopup] = useState<ActiveCalendarEventPopupState | null>(null);
  const isEventPinging = useCalendarEventNotificationStore((state) => state.isEventPinging);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      void refresh();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [refresh]);

  const handleSelectEvent = useCallback(
    (event: CalendarEventItem, anchorRef: React.RefObject<HTMLButtonElement | null>) => {
      const anchorRect = anchorRef.current?.getBoundingClientRect();

      if (!anchorRect) {
        return;
      }

      setActivePopup({ event, anchorRect, anchorRef });
    },
    [],
  );

  const handleClosePopup = useCallback(() => {
    setActivePopup(null);
  }, []);

  const handleOpenInCalendar = useCallback(
    (startAt: number) => {
      void openEvent(startAt);
    },
    [openEvent],
  );

  const handleOpenSettings = useCallback(() => {
    if (!window.nexus?.calendar) {
      return;
    }

    void window.nexus.calendar.requestAccess().then((nextSnapshot) => {
      if (nextSnapshot.accessGranted) {
        void refresh();
        return;
      }

      void window.nexus?.calendar?.openPrivacySettings();
    });
  }, [refresh]);

  const visibleEvents = useMemo(() => {
    if (!hydrated || !snapshot.available) {
      return [];
    }

    return getVisibleCalendarEvents(snapshot.events, now);
  }, [hydrated, now, snapshot.available, snapshot.events]);

  useEffect(() => {
    if (!activePopup) {
      return;
    }

    const stillVisible = visibleEvents.some(
      (event) => event.id === activePopup.event.id && event.startAt === activePopup.event.startAt,
    );

    if (!stillVisible) {
      setActivePopup(null);
    }
  }, [activePopup, visibleEvents]);

  const showAccessCard = hydrated && !loading && snapshot.platformSupported && snapshot.permissionDenied;

  if (visibleEvents.length === 0 && !showAccessCard) {
    return null;
  }

  return (
    <>
      <div className='sidebar-calendar-events app-button--enter'>
        {showAccessCard ? <SidebarCalendarAccessCard onOpenSettings={handleOpenSettings} /> : null}
        {visibleEvents.map((event) => {
          const eventKey = getCalendarEventKey(event);

          return (
            <SidebarCalendarEventRow
              key={eventKey}
              event={event}
              isActive={activePopup?.event.id === event.id && activePopup.event.startAt === event.startAt}
              isLive={isCalendarEventLive(event, now)}
              isPinging={isEventPinging(eventKey, now)}
              onSelect={handleSelectEvent}
            />
          );
        })}
      </div>

      {activePopup ? (
        <SidebarCalendarEventPopup
          event={activePopup.event}
          anchorRect={activePopup.anchorRect}
          anchorRef={activePopup.anchorRef}
          onClose={handleClosePopup}
          onOpenInCalendar={handleOpenInCalendar}
        />
      ) : null}
    </>
  );
}

export const SidebarCalendarEvents = memo(SidebarCalendarEventsComponent);
