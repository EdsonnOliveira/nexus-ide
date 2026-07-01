import { memo, useCallback } from 'react';
import { X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { CalendarEventDetailsPanel } from '@/components/sidebar/CalendarEventDetailsPanel';
import type { CalendarEventItem } from '@/types';
import { resolveCalendarExternalUrl } from '@/utils/calendarEventStyle';

interface CalendarEventAlertModalProps {
  event: CalendarEventItem;
  onClose: () => void;
  onOpenInCalendar: (startAt: number) => void;
}

function CalendarEventAlertModalComponent({ event, onClose, onOpenInCalendar }: CalendarEventAlertModalProps) {
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

  const handleOpenInCalendar = useCallback(() => {
    onOpenInCalendar(event.startAt);
    onClose();
  }, [event.startAt, onClose, onOpenInCalendar]);

  return (
    <AnimatedModal panelClassName='calendar-event-alert-modal' onClose={onClose}>
      {(requestClose) => (
        <div className='calendar-event-alert-modal__panel agent-cursor-usage__panel'>
          <div className='agent-cursor-usage__header'>
            <span className='agent-cursor-usage__title'>{event.title}</span>
            <button
              type='button'
              className='agent-cursor-usage__close app-button app-button--enter'
              aria-label='Fechar'
              onClick={requestClose}
            >
              <X size={14} />
            </button>
          </div>

          <CalendarEventDetailsPanel
            event={event}
            onOpenExternalUrl={handleOpenExternalUrl}
            onOpenInCalendar={handleOpenInCalendar}
          />
        </div>
      )}
    </AnimatedModal>
  );
}

export const CalendarEventAlertModal = memo(CalendarEventAlertModalComponent);
