import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { CalendarFullEventItem } from '@/types';
import { HomeCalendarEventBlock } from '@/components/home/calendar/HomeCalendarEventBlock';
import {
  WEEKDAY_LABELS,
  addDays,
  formatHourLabel,
  formatTimeLabel,
  getWeekDays,
  isToday,
  minutesFromDayStart,
  startOfDay,
} from '@/components/home/calendar/homeCalendarUtils';

const HOUR_HEIGHT = 56;
const START_HOUR = 0;
const END_HOUR = 24;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index);

interface HomeCalendarTimeGridProps {
  focusDate: Date;
  mode: 'day' | 'week';
  events: CalendarFullEventItem[];
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarFullEventItem) => void;
  onEmptySlot: (startAt: number) => void;
  showDayHeader?: boolean;
}

function HomeCalendarTimeGridComponent({
  focusDate,
  mode,
  events,
  selectedEventId,
  onSelectEvent,
  onEmptySlot,
  showDayHeader = true,
}: HomeCalendarTimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const days = useMemo(
    () => (mode === 'day' ? [startOfDay(focusDate)] : getWeekDays(focusDate)),
    [focusDate, mode],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const targetHour = Math.max(7, new Date(nowMs).getHours() - 1);
    node.scrollTop = targetHour * HOUR_HEIGHT;
  }, [focusDate, mode]);

  const allDayByDay = useMemo(() => {
    return days.map((day) => {
      const dayStart = startOfDay(day).getTime();
      const dayEnd = addDays(day, 1).getTime();
      return events.filter(
        (event) =>
          event.allDay &&
          event.startAt < dayEnd &&
          event.endAt > dayStart,
      );
    });
  }, [days, events]);

  const timedByDay = useMemo(() => {
    return days.map((day) => {
      const dayStart = startOfDay(day).getTime();
      const dayEnd = addDays(day, 1).getTime();
      return events.filter(
        (event) =>
          !event.allDay &&
          event.startAt < dayEnd &&
          event.endAt > dayStart,
      );
    });
  }, [days, events]);

  const now = new Date(nowMs);
  const nowDayIndex = days.findIndex((day) => isToday(day, now));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowDayIndex >= 0;

  const handleGridClick = useCallback(
    (day: Date, event: MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0);
      const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR_HEIGHT * 60)));
      const snapped = Math.round(minutes / 30) * 30;
      const start = startOfDay(day);
      start.setMinutes(snapped);
      onEmptySlot(start.getTime());
    },
    [onEmptySlot],
  );

  return (
    <div className={`home-calendar__time-grid home-calendar__time-grid--${mode}`}>
      {showDayHeader ? (
        <div className='home-calendar__time-header'>
          <div className='home-calendar__time-gutter' />
          {days.map((day) => {
            const today = isToday(day, now);
            return (
              <div
                key={day.toISOString()}
                className={`home-calendar__time-day-head${today ? ' home-calendar__time-day-head--today' : ''}`}
              >
                <span className='home-calendar__time-day-name'>{WEEKDAY_LABELS[day.getDay()]}</span>
                <span className={`home-calendar__time-day-num${today ? ' home-calendar__time-day-num--today' : ''}`}>
                  {day.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className='home-calendar__all-day-row'>
        <div className='home-calendar__time-gutter home-calendar__all-day-label'>dia todo</div>
        {days.map((day, index) => (
          <div key={`allday-${day.toISOString()}`} className='home-calendar__all-day-cell'>
            {allDayByDay[index].map((event) => (
              <HomeCalendarEventBlock
                key={`${event.id}-${event.startAt}`}
                event={event}
                compact
                selected={selectedEventId === event.id}
                onSelect={onSelectEvent}
              />
            ))}
          </div>
        ))}
      </div>

      <div className='home-calendar__time-scroll' ref={scrollRef}>
        <div className='home-calendar__time-body' style={{ height: HOURS.length * HOUR_HEIGHT }}>
          <div className='home-calendar__time-gutter home-calendar__time-hours'>
              {HOURS.map((hour) => (
                <div key={hour} className='home-calendar__time-hour' style={{ height: HOUR_HEIGHT }}>
                  {hour === 0 ? null : formatHourLabel(hour)}
                </div>
              ))}
          </div>

          {days.map((day, dayIndex) => (
            <div
              key={`col-${day.toISOString()}`}
              className='home-calendar__time-column'
              onClick={(event) => handleGridClick(day, event)}
            >

              {timedByDay[dayIndex].map((event) => {
                const dayStart = startOfDay(day).getTime();
                const clampedStart = Math.max(event.startAt, dayStart);
                const clampedEnd = Math.min(event.endAt, addDays(day, 1).getTime());
                const top = (minutesFromDayStart(clampedStart) / 60) * HOUR_HEIGHT;
                const height = Math.max(
                  22,
                  ((clampedEnd - clampedStart) / 3_600_000) * HOUR_HEIGHT,
                );
                return (
                  <HomeCalendarEventBlock
                    key={`${event.id}-${event.startAt}`}
                    event={event}
                    selected={selectedEventId === event.id}
                    onSelect={onSelectEvent}
                    style={{
                      position: 'absolute',
                      top,
                      left: 4,
                      right: 4,
                      height,
                    }}
                  />
                );
              })}

              {showNowLine && dayIndex === nowDayIndex ? (
                <div
                  className='home-calendar__now-line'
                  style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                >
                  <span className='home-calendar__now-badge'>{formatTimeLabel(nowMs)}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const HomeCalendarTimeGrid = memo(HomeCalendarTimeGridComponent);
