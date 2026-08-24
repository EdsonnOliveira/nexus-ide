import { memo, useMemo } from 'react';
import type { CalendarFullEventItem } from '@/types';
import { HomeCalendarEventBlock } from '@/components/home/calendar/HomeCalendarEventBlock';
import {
  WEEKDAY_LABELS,
  addDays,
  getMonthGridDays,
  isSameDay,
  isToday,
  startOfDay,
} from '@/components/home/calendar/homeCalendarUtils';

interface HomeCalendarMonthViewProps {
  focusDate: Date;
  events: CalendarFullEventItem[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarFullEventItem) => void;
  onSelectDay: (date: Date) => void;
  onEmptyDay: (date: Date) => void;
}

function HomeCalendarMonthViewComponent({
  focusDate,
  events,
  selectedEventId,
  onSelectEvent,
  onSelectDay,
  onEmptyDay,
}: HomeCalendarMonthViewProps) {
  const days = useMemo(() => getMonthGridDays(focusDate), [focusDate]);
  const now = useMemo(() => new Date(), []);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarFullEventItem[]>();
    for (const day of days) {
      const key = startOfDay(day).toISOString();
      const dayStart = startOfDay(day).getTime();
      const dayEnd = addDays(day, 1).getTime();
      map.set(
        key,
        events.filter((event) => event.startAt < dayEnd && event.endAt > dayStart),
      );
    }
    return map;
  }, [days, events]);

  return (
    <div className='home-calendar__month'>
      <div className='home-calendar__month-weekdays'>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className='home-calendar__month-grid'>
        {days.map((day) => {
          const key = startOfDay(day).toISOString();
          const dayEvents = eventsByDay.get(key) ?? [];
          const outside = day.getMonth() !== focusDate.getMonth();
          const today = isToday(day, now);
          const selected = isSameDay(day, focusDate);
          return (
            <button
              key={key}
              type='button'
              className={`home-calendar__month-cell app-button${outside ? ' home-calendar__month-cell--outside' : ''}${today ? ' home-calendar__month-cell--today' : ''}${selected ? ' home-calendar__month-cell--selected' : ''}`}
              onClick={() => onSelectDay(day)}
              onDoubleClick={() => onEmptyDay(day)}
            >
              <span className={`home-calendar__month-day-num${today ? ' home-calendar__month-day-num--today' : ''}`}>
                {day.getDate()}
              </span>
              <div className='home-calendar__month-events'>
                {dayEvents.slice(0, 4).map((event) => (
                  <HomeCalendarEventBlock
                    key={`${event.id}-${event.startAt}`}
                    event={event}
                    compact
                    selected={selectedEventId === event.id}
                    onSelect={onSelectEvent}
                  />
                ))}
                {dayEvents.length > 4 ? (
                  <span className='home-calendar__month-more'>+{dayEvents.length - 4}</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const HomeCalendarMonthView = memo(HomeCalendarMonthViewComponent);
