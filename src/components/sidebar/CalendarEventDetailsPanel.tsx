import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CalendarEventItem } from '@/types';
import {
  formatCalendarEventDate,
  formatCalendarEventSchedule,
  formatCalendarEventStartsInLabel,
  formatCalendarLinkDisplayLabel,
  isCalendarEventLive,
  normalizeCalendarEventNotes,
  resolveCalendarExternalUrl,
  splitCalendarTextLinks,
} from '@/utils/calendarEventStyle';

interface CalendarEventFooterActionsProps {
  onOpenInCalendar: () => void;
  onStartCall?: () => void;
  showStartCall: boolean;
}

function CalendarEventFooterActionsComponent({
  onOpenInCalendar,
  onStartCall,
  showStartCall,
}: CalendarEventFooterActionsProps) {
  return (
    <div className='agent-cursor-usage__actions sidebar-calendar-popup__actions'>
      <button
        type='button'
        className='agent-cursor-usage__action sidebar-calendar-popup__open-calendar app-button app-button--enter'
        onClick={onOpenInCalendar}
      >
        Abrir no Calendário
      </button>
      {showStartCall && onStartCall ? (
        <button
          type='button'
          className='sidebar-calendar-popup__start-call app-button app-button--enter'
          onClick={onStartCall}
        >
          Iniciar chamada
        </button>
      ) : null}
    </div>
  );
}

export const CalendarEventFooterActions = memo(CalendarEventFooterActionsComponent);

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
          {formatCalendarLinkDisplayLabel(segment.value)}
        </button>,
      );
    });

    return nodes;
  }, [handleLinkClick, segments]);

  return <>{content}</>;
}

const CalendarLinkedText = memo(CalendarLinkedTextComponent);

interface CalendarEventSummaryHeaderProps {
  event: CalendarEventItem;
  showStartsInHint: boolean;
}

function CalendarEventSummaryHeaderComponent({ event, showStartsInHint }: CalendarEventSummaryHeaderProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const scheduleLabel = useMemo(() => formatCalendarEventSchedule(event), [event]);
  const dateLabel = useMemo(() => formatCalendarEventDate(event.startAt), [event.startAt]);
  const isLive = useMemo(() => isCalendarEventLive(event, now), [event, now]);
  const startsInLabel = useMemo(
    () => (showStartsInHint ? formatCalendarEventStartsInLabel(event, now) : null),
    [event, now, showStartsInHint],
  );

  return (
    <div className='sidebar-calendar-popup__summary agent-cursor-usage__summary'>
      <span
        className='sidebar-calendar-popup__accent'
        style={{ backgroundColor: event.colorHex }}
        aria-hidden='true'
      />
      <div className='sidebar-calendar-popup__summary-copy'>
        {startsInLabel ? <span className='sidebar-calendar-popup__starts-in'>{startsInLabel}</span> : null}
        <div className='sidebar-calendar-popup__schedule-row'>
          <span className='agent-cursor-usage__summary-percent sidebar-calendar-popup__schedule'>{scheduleLabel}</span>
          {isLive ? (
            <span className='sidebar-calendar-popup__live' aria-label='Reunião em andamento'>
              <span className='sidebar-calendar-popup__live-dot' aria-hidden='true' />
            </span>
          ) : null}
        </div>
        <span className='agent-cursor-usage__summary-plan'>{dateLabel}</span>
      </div>
    </div>
  );
}

const CalendarEventSummaryHeader = memo(CalendarEventSummaryHeaderComponent);

interface CalendarEventNotesBodyProps {
  notesText: string;
  eventUrl: string;
  resolvedEventUrl: string | null;
  onOpenExternalUrl: (url: string) => void;
}

function CalendarEventNotesBodyComponent({
  notesText,
  eventUrl,
  resolvedEventUrl,
  onOpenExternalUrl,
}: CalendarEventNotesBodyProps) {
  const handleOpenEventUrl = useCallback(() => {
    onOpenExternalUrl(eventUrl);
  }, [eventUrl, onOpenExternalUrl]);

  return (
    <ul className='agent-cursor-usage__list sidebar-calendar-popup__notes-list'>
      {notesText ? (
        <li className='agent-cursor-usage__item sidebar-calendar-popup__item--stacked sidebar-calendar-popup__item--notes'>
          <span className='agent-cursor-usage__item-value sidebar-calendar-popup__multiline sidebar-calendar-popup__notes-body'>
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
            onClick={handleOpenEventUrl}
          >
            {formatCalendarLinkDisplayLabel(resolvedEventUrl)}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

const CalendarEventNotesBody = memo(CalendarEventNotesBodyComponent);

interface CalendarEventDetailsPanelProps {
  event: CalendarEventItem;
  onOpenExternalUrl: (url: string) => void;
  showStartsInHint?: boolean;
}

function CalendarEventDetailsPanelComponent({
  event,
  onOpenExternalUrl,
  showStartsInHint = false,
}: CalendarEventDetailsPanelProps) {
  const resolvedEventUrl = useMemo(() => resolveCalendarExternalUrl(event.url), [event.url]);
  const notesText = event.notes.trim();
  const hasDetails = Boolean(notesText || resolvedEventUrl);

  return (
    <div className='sidebar-calendar-popup__scroll'>
      <CalendarEventSummaryHeader event={event} showStartsInHint={showStartsInHint} />
      {hasDetails ? (
        <CalendarEventNotesBody
          notesText={notesText}
          eventUrl={event.url}
          resolvedEventUrl={resolvedEventUrl}
          onOpenExternalUrl={onOpenExternalUrl}
        />
      ) : null}
    </div>
  );
}

export const CalendarEventDetailsPanel = memo(CalendarEventDetailsPanelComponent);
