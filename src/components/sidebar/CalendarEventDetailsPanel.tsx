import { memo, useCallback, useMemo, type ReactNode } from 'react';
import type { CalendarEventItem } from '@/types';
import {
  formatCalendarEventDate,
  formatCalendarEventSchedule,
  formatCalendarEventTime,
  normalizeCalendarEventNotes,
  resolveCalendarExternalUrl,
  splitCalendarTextLinks,
} from '@/utils/calendarEventStyle';

interface CalendarLinkedTextProps {
  text: string;
  onOpenUrl: (url: string) => void;
}

function CalendarLinkedTextComponent({ text, onOpenUrl }: CalendarLinkedTextProps) {
  const normalizedText = useMemo(() => normalizeCalendarEventNotes(text), [text]);
  const segments = useMemo(() => splitCalendarTextLinks(normalizedText), [normalizedText]);

  const handleLinkClick = useCallback(
    (url: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenUrl(url);
    },
    [onOpenUrl],
  );

  const content = useMemo(() => {
    const nodes: ReactNode[] = [];

    segments.forEach((segment, index) => {
      if (segment.kind === 'text') {
        const lines = segment.value.split('\n');

        lines.forEach((line, lineIndex) => {
          if (lineIndex > 0) {
            nodes.push(<br key={`${index}-br-${lineIndex}`} />);
          }

          if (line) {
            nodes.push(line);
          }
        });

        return;
      }

      nodes.push(
        <button
          key={`${index}-${segment.value}`}
          type='button'
          className='sidebar-calendar-popup__inline-link app-button'
          title={segment.value}
          onClick={handleLinkClick(segment.value)}
        >
          {segment.label}
        </button>,
      );
    });

    return nodes;
  }, [handleLinkClick, segments]);

  return <>{content}</>;
}

const CalendarLinkedText = memo(CalendarLinkedTextComponent);

interface CalendarEventDetailsPanelProps {
  event: CalendarEventItem;
  onOpenExternalUrl: (url: string) => void;
  onOpenInCalendar?: () => void;
}

function CalendarEventDetailsPanelComponent({
  event,
  onOpenExternalUrl,
  onOpenInCalendar,
}: CalendarEventDetailsPanelProps) {
  const scheduleLabel = useMemo(() => formatCalendarEventSchedule(event), [event]);
  const dateLabel = useMemo(() => formatCalendarEventDate(event.startAt), [event.startAt]);
  const durationLabel = useMemo(() => {
    if (event.allDay) {
      return 'Dia inteiro';
    }

    if (!Number.isFinite(event.startAt) || !Number.isFinite(event.endAt) || event.endAt <= event.startAt) {
      return '—';
    }

    const minutes = Math.round((event.endAt - event.startAt) / 60_000);

    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    if (remainder === 0) {
      return `${hours} h`;
    }

    return `${hours} h ${remainder} min`;
  }, [event.allDay, event.endAt, event.startAt]);

  const resolvedEventUrl = useMemo(() => resolveCalendarExternalUrl(event.url), [event.url]);
  const notesText = event.notes.trim();

  return (
    <>
      <div className='sidebar-calendar-popup__summary agent-cursor-usage__summary'>
        <span
          className='sidebar-calendar-popup__accent'
          style={{ backgroundColor: event.colorHex }}
          aria-hidden='true'
        />
        <div className='sidebar-calendar-popup__summary-copy'>
          <span className='agent-cursor-usage__summary-percent sidebar-calendar-popup__schedule'>{scheduleLabel}</span>
          <span className='agent-cursor-usage__summary-plan'>{dateLabel}</span>
        </div>
      </div>

      <ul className='agent-cursor-usage__list'>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Calendário</span>
          <span className='agent-cursor-usage__item-value'>{event.calendarName || '—'}</span>
        </li>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Início</span>
          <span className='agent-cursor-usage__item-value'>
            {event.allDay ? dateLabel : `${dateLabel}, ${formatCalendarEventTime(event.startAt, false)}`}
          </span>
        </li>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Término</span>
          <span className='agent-cursor-usage__item-value'>
            {event.allDay
              ? dateLabel
              : `${formatCalendarEventDate(event.endAt)}, ${formatCalendarEventTime(event.endAt, false)}`}
          </span>
        </li>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Duração</span>
          <span className='agent-cursor-usage__item-value'>{durationLabel}</span>
        </li>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Local</span>
          <span className='agent-cursor-usage__item-value sidebar-calendar-popup__multiline'>
            {event.location.trim() || '—'}
          </span>
        </li>
        {notesText ? (
          <li className='agent-cursor-usage__item sidebar-calendar-popup__item--stacked'>
            <span className='agent-cursor-usage__item-label'>Notas</span>
            <span className='agent-cursor-usage__item-value sidebar-calendar-popup__multiline'>
              <CalendarLinkedText text={notesText} onOpenUrl={onOpenExternalUrl} />
            </span>
          </li>
        ) : null}
        {resolvedEventUrl ? (
          <li className='agent-cursor-usage__item'>
            <span className='agent-cursor-usage__item-label'>Link</span>
            <button
              type='button'
              className='agent-cursor-usage__item-value sidebar-calendar-popup__link app-button'
              title={resolvedEventUrl}
              onClick={() => onOpenExternalUrl(event.url)}
            >
              {resolvedEventUrl}
            </button>
          </li>
        ) : null}
      </ul>

      {onOpenInCalendar ? (
        <div className='agent-cursor-usage__actions'>
          <button
            type='button'
            className='agent-cursor-usage__action app-button app-button--enter'
            onClick={onOpenInCalendar}
          >
            Abrir no Calendário
          </button>
        </div>
      ) : null}
    </>
  );
}

export const CalendarEventDetailsPanel = memo(CalendarEventDetailsPanelComponent);
