import { memo, useMemo } from 'react';
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  getMonthGridDays,
  isToday,
  startOfMonth,
} from '@/components/home/calendar/homeCalendarUtils';

interface HomeCalendarYearViewProps {
  focusDate: Date;
  onSelectDay: (date: Date) => void;
  onSelectMonth: (date: Date) => void;
}

function HomeCalendarYearViewComponent({
  focusDate,
  onSelectDay,
  onSelectMonth,
}: HomeCalendarYearViewProps) {
  const year = focusDate.getFullYear();
  const now = useMemo(() => new Date(), []);
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, index) => startOfMonth(new Date(year, index, 1))),
    [year],
  );

  return (
    <div className='home-calendar__year'>
      {months.map((month) => {
        const days = getMonthGridDays(month);
        return (
          <section key={month.toISOString()} className='home-calendar__year-month'>
            <button
              type='button'
              className='home-calendar__year-month-title app-button'
              onClick={() => onSelectMonth(month)}
            >
              {MONTH_NAMES[month.getMonth()]}
            </button>
            <div className='home-calendar__year-weekdays'>
              {WEEKDAY_SHORT.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div className='home-calendar__year-grid'>
              {days.map((day) => {
                const outside = day.getMonth() !== month.getMonth();
                const today = isToday(day, now);
                return (
                  <button
                    key={day.toISOString()}
                    type='button'
                    className={`home-calendar__year-day app-button${outside ? ' home-calendar__year-day--outside' : ''}${today ? ' home-calendar__year-day--today' : ''}`}
                    onClick={() => onSelectDay(day)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export const HomeCalendarYearView = memo(HomeCalendarYearViewComponent);
