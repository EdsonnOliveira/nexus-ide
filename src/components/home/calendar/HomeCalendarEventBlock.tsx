import { RefreshCw } from 'lucide-react';
import { memo, useCallback, useMemo, type CSSProperties, type MouseEvent } from 'react';
import type { CalendarFullEventItem } from '@/types';
import { formatTimeLabel } from '@/components/home/calendar/homeCalendarUtils';

interface HomeCalendarEventBlockProps {
  event: CalendarFullEventItem;
  style?: CSSProperties;
  compact?: boolean;
  selected?: boolean;
  onSelect: (event: CalendarFullEventItem) => void;
}

function HomeCalendarEventBlockComponent({
  event,
  style,
  compact = false,
  selected = false,
  onSelect,
}: HomeCalendarEventBlockProps) {
  const canceled = event.status === 'canceled';
  const tentative = event.status === 'tentative';

  const blockStyle = useMemo(
    () =>
      ({
        ...style,
        '--home-calendar-event-color': event.colorHex || '#8b5cf6',
      }) as CSSProperties,
    [event.colorHex, style],
  );

  const handleClick = useCallback(
    (mouseEvent: MouseEvent<HTMLButtonElement>) => {
      mouseEvent.stopPropagation();
      onSelect(event);
    },
    [event, onSelect],
  );

  const timeLabel = event.allDay
    ? 'Dia inteiro'
    : `${formatTimeLabel(event.startAt)} – ${formatTimeLabel(event.endAt)}`;

  return (
    <button
      type='button'
      className={`home-calendar__event app-button app-button--enter${compact ? ' home-calendar__event--compact' : ''}${canceled ? ' home-calendar__event--canceled' : ''}${tentative ? ' home-calendar__event--tentative' : ''}${selected ? ' home-calendar__event--selected' : ''}`}
      style={blockStyle}
      title={event.title}
      onClick={handleClick}
    >
      <span className='home-calendar__event-accent' aria-hidden='true' />
      <span className='home-calendar__event-body'>
        <span className='home-calendar__event-title-row'>
          <span className='home-calendar__event-title'>{event.title}</span>
          {event.hasRecurrence ? (
            <RefreshCw size={11} strokeWidth={2.2} className='home-calendar__event-recur' aria-hidden='true' />
          ) : null}
        </span>
        {!compact ? <span className='home-calendar__event-meta'>{event.location || timeLabel}</span> : null}
      </span>
    </button>
  );
}

export const HomeCalendarEventBlock = memo(HomeCalendarEventBlockComponent);
