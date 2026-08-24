import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import type { CalendarAccountItem } from '@/types';
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  addMonths,
  getMonthGridDays,
  isSameDay,
  isToday,
  startOfMonth,
} from '@/components/home/calendar/homeCalendarUtils';

interface HomeCalendarSidebarProps {
  accounts: CalendarAccountItem[];
  enabledCalendarIds: Set<string>;
  focusDate: Date;
  onToggleCalendar: (calendarId: string, enabled: boolean) => void;
  onSelectDate: (date: Date) => void;
}

function HomeCalendarSidebarComponent({
  accounts,
  enabledCalendarIds,
  focusDate,
  onToggleCalendar,
  onSelectDate,
}: HomeCalendarSidebarProps) {
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(() => new Set());
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(focusDate));

  const miniDays = useMemo(() => getMonthGridDays(miniMonth), [miniMonth]);

  const handlePrevMini = useCallback(() => {
    setMiniMonth((current) => addMonths(current, -1));
  }, []);

  const handleNextMini = useCallback(() => {
    setMiniMonth((current) => addMonths(current, 1));
  }, []);

  const toggleAccount = useCallback((accountId: string) => {
    setCollapsedAccounts((current) => {
      const next = new Set(current);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  return (
    <aside className='home-calendar__sidebar'>
      <div className='home-calendar__accounts'>
        {accounts.map((account) => {
          const collapsed = collapsedAccounts.has(account.id);
          return (
            <section key={account.id} className='home-calendar__account'>
              <button
                type='button'
                className='home-calendar__account-toggle app-button'
                onClick={() => toggleAccount(account.id)}
              >
                <ChevronDown
                  size={12}
                  strokeWidth={2.2}
                  className={`home-calendar__account-chevron${collapsed ? ' home-calendar__account-chevron--collapsed' : ''}`}
                  aria-hidden='true'
                />
                <span>{account.title}</span>
              </button>
              {!collapsed ? (
                <ul className='home-calendar__calendar-list'>
                  {account.calendars.map((calendar) => {
                    const checked = enabledCalendarIds.has(calendar.id);
                    const style = {
                      '--home-calendar-check-color': calendar.colorHex,
                    } as CSSProperties;
                    return (
                      <li key={calendar.id} className='home-calendar__calendar-item' style={style}>
                        <AppCheckbox
                          checked={checked}
                          aria-label={calendar.title}
                          className='home-calendar__calendar-check'
                          onChange={(next) => onToggleCalendar(calendar.id, next)}
                        />
                        <span className='home-calendar__calendar-name' title={calendar.title}>
                          {calendar.title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className='home-calendar__mini'>
        <div className='home-calendar__mini-header'>
          <span className='home-calendar__mini-title'>
            {MONTH_NAMES[miniMonth.getMonth()]} {miniMonth.getFullYear()}
          </span>
          <div className='home-calendar__mini-nav'>
            <button
              type='button'
              className='home-calendar__icon-btn app-button'
              aria-label='Mês anterior'
              onClick={handlePrevMini}
            >
              <ChevronLeft size={14} strokeWidth={2.2} />
            </button>
            <button
              type='button'
              className='home-calendar__icon-btn app-button'
              aria-label='Próximo mês'
              onClick={handleNextMini}
            >
              <ChevronRight size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <div className='home-calendar__mini-weekdays'>
          {WEEKDAY_SHORT.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className='home-calendar__mini-grid'>
          {miniDays.map((day) => {
            const outside = day.getMonth() !== miniMonth.getMonth();
            const selected = isSameDay(day, focusDate);
            const today = isToday(day);
            return (
              <button
                key={day.toISOString()}
                type='button'
                className={`home-calendar__mini-day app-button${outside ? ' home-calendar__mini-day--outside' : ''}${selected ? ' home-calendar__mini-day--selected' : ''}${today ? ' home-calendar__mini-day--today' : ''}`}
                onClick={() => onSelectDate(day)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export const HomeCalendarSidebar = memo(HomeCalendarSidebarComponent);
