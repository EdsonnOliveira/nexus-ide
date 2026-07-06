import { memo, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  CalendarEventDetailsPanel,
  CalendarEventFooterActions,
} from '@/components/sidebar/CalendarEventDetailsPanel';
import { CalendarMeetingIcon } from '@/components/sidebar/CalendarMeetingIcon';
import type { CalendarEventItem } from '@/types';
import { resolveCalendarExternalUrl, resolveCalendarMeetingInfo } from '@/utils/calendarEventStyle';

interface CalendarEventAlertModalProps {
  event: CalendarEventItem;
  onClose: () => void;
  onOpenInCalendar: (startAt: number) => void;
}

function CalendarEventAlertModalComponent({ event, onClose, onOpenInCalendar }: CalendarEventAlertModalProps) {
  const meetingInfo = useMemo(() => resolveCalendarMeetingInfo(event), [event]);

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

  const handleStartCall = useCallback(() => {
    if (!meetingInfo?.url) {
      return;
    }

    handleOpenExternalUrl(meetingInfo.url);
  }, [handleOpenExternalUrl, meetingInfo?.url]);

  return (
    <AnimatedModal
      panelClassName='calendar-event-alert-modal calendar-event-alert-modal--ping'
      onClose={onClose}
    >
      {(requestClose) => (
        <div className='calendar-event-alert-modal__panel agent-cursor-usage__panel'>
          <div className='agent-cursor-usage__header'>
            <div className='agent-cursor-usage__title-wrap'>
              {meetingInfo ? (
                <span className='agent-cursor-usage__title-leading'>
                  <CalendarMeetingIcon provider={meetingInfo.provider} />
                </span>
              ) : null}
              <span className='agent-cursor-usage__title'>{event.title}</span>
            </div>
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
            showStartsInHint
          />

          <CalendarEventFooterActions
            onOpenInCalendar={handleOpenInCalendar}
            onStartCall={handleStartCall}
            showStartCall={Boolean(meetingInfo?.url)}
          />
        </div>
      )}
    </AnimatedModal>
  );
}

export const CalendarEventAlertModal = memo(CalendarEventAlertModalComponent);
