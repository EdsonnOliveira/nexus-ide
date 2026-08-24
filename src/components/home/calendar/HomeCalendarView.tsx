import { CalendarDays } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { HomeCalendarSidebar } from '@/components/home/calendar/HomeCalendarSidebar';
import { HomeCalendarToolbar } from '@/components/home/calendar/HomeCalendarToolbar';
import { HomeCalendarTimeGrid } from '@/components/home/calendar/HomeCalendarTimeGrid';
import { HomeCalendarMonthView } from '@/components/home/calendar/HomeCalendarMonthView';
import { HomeCalendarYearView } from '@/components/home/calendar/HomeCalendarYearView';
import {
  HomeCalendarInspector,
  draftFromEvent,
} from '@/components/home/calendar/HomeCalendarInspector';
import {
  type HomeCalendarDraft,
  type HomeCalendarViewKind,
  addDays,
  addMonths,
  addYears,
  createDefaultDraft,
  formatDaySubtitle,
  formatHeaderTitle,
  getViewRange,
  startOfDay,
} from '@/components/home/calendar/homeCalendarUtils';
import { useHomeCalendar } from '@/hooks/useHomeCalendar';
import type { CalendarFullEventItem, CalendarMutationSpan } from '@/types';

function HomeCalendarViewComponent() {
  const [viewKind, setViewKind] = useState<HomeCalendarViewKind>('week');
  const [focusDate, setFocusDate] = useState(() => startOfDay(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CalendarFullEventItem | null>(null);
  const [draft, setDraft] = useState<HomeCalendarDraft | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [saving, setSaving] = useState(false);

  const {
    accounts,
    editableCalendars,
    events,
    enabledCalendarIds,
    accessGranted,
    platformSupported,
    hydrated,
    setVisibleRange,
    toggleCalendar,
    requestAccess,
    createEvent,
    updateEvent,
    deleteEvent,
    openEvent,
  } = useHomeCalendar(true);

  useEffect(() => {
    const range = getViewRange(viewKind, focusDate);
    setVisibleRange(range.startAt, range.endAt);
  }, [focusDate, setVisibleRange, viewKind]);

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return events;
    }
    return events.filter((event) => event.title.toLowerCase().includes(query));
  }, [events, searchQuery]);

  const title = useMemo(() => formatHeaderTitle(viewKind, focusDate), [focusDate, viewKind]);
  const daySubtitle = useMemo(() => formatDaySubtitle(focusDate), [focusDate]);

  const defaultCalendarId = useMemo(() => {
    if (editableCalendars.length === 0) {
      return '';
    }
    return editableCalendars[0].id;
  }, [editableCalendars]);

  const handlePrev = useCallback(() => {
    setFocusDate((current) => {
      if (viewKind === 'day') {
        return addDays(current, -1);
      }
      if (viewKind === 'week') {
        return addDays(current, -7);
      }
      if (viewKind === 'month') {
        return addMonths(current, -1);
      }
      return addYears(current, -1);
    });
  }, [viewKind]);

  const handleNext = useCallback(() => {
    setFocusDate((current) => {
      if (viewKind === 'day') {
        return addDays(current, 1);
      }
      if (viewKind === 'week') {
        return addDays(current, 7);
      }
      if (viewKind === 'month') {
        return addMonths(current, 1);
      }
      return addYears(current, 1);
    });
  }, [viewKind]);

  const handleToday = useCallback(() => {
    setFocusDate(startOfDay(new Date()));
  }, []);

  const handleSelectDate = useCallback((date: Date) => {
    setFocusDate(startOfDay(date));
  }, []);

  const handleCreate = useCallback(() => {
    if (!defaultCalendarId) {
      return;
    }
    const now = new Date();
    now.setMinutes(0, 0, 0);
    if (now.getHours() < 23) {
      now.setHours(now.getHours() + 1);
    }
    setSelectedEvent(null);
    setDraft(createDefaultDraft(now.getTime(), defaultCalendarId));
    setInspectorMode('create');
  }, [defaultCalendarId]);

  const handleEmptySlot = useCallback(
    (startAt: number) => {
      if (!defaultCalendarId) {
        return;
      }
      setSelectedEvent(null);
      setDraft(createDefaultDraft(startAt, defaultCalendarId));
      setInspectorMode('create');
    },
    [defaultCalendarId],
  );

  const handleSelectEvent = useCallback((event: CalendarFullEventItem) => {
    setSelectedEvent(event);
    setDraft(draftFromEvent(event));
    setInspectorMode('edit');
  }, []);

  const handleCloseInspector = useCallback(() => {
    setInspectorMode('closed');
    setSelectedEvent(null);
    setDraft(null);
  }, []);

  const handleSave = useCallback(
    async (span: CalendarMutationSpan = 'thisEvent') => {
      if (!draft || !draft.calendarId) {
        return;
      }

      setSaving(true);
      try {
        if (inspectorMode === 'create') {
          const result = await createEvent({
            title: draft.title.trim() || '(Sem título)',
            startAt: draft.startAt,
            endAt: draft.endAt,
            calendarId: draft.calendarId,
            allDay: draft.allDay,
            location: draft.location,
            notes: draft.notes,
            url: draft.url,
            alertMinutes: draft.alertMinutes,
            recurrence: draft.recurrence,
          });
          if (result.ok && result.event) {
            setSelectedEvent(result.event);
            setDraft(draftFromEvent(result.event));
            setInspectorMode('edit');
          }
          return;
        }

        if (!selectedEvent) {
          return;
        }

        const result = await updateEvent({
          id: selectedEvent.id,
          title: draft.title.trim() || '(Sem título)',
          startAt: draft.startAt,
          endAt: draft.endAt,
          calendarId: draft.calendarId,
          allDay: draft.allDay,
          location: draft.location,
          notes: draft.notes,
          url: draft.url,
          alertMinutes: draft.alertMinutes,
          recurrence: draft.recurrence,
          span,
        });
        if (result.ok && result.event) {
          setSelectedEvent(result.event);
          setDraft(draftFromEvent(result.event));
        }
      } finally {
        setSaving(false);
      }
    },
    [createEvent, draft, inspectorMode, selectedEvent, updateEvent],
  );

  const handleDelete = useCallback(
    async (span: CalendarMutationSpan = 'thisEvent') => {
      if (!selectedEvent) {
        return;
      }
      setSaving(true);
      try {
        const result = await deleteEvent({ id: selectedEvent.id, span });
        if (result.ok) {
          handleCloseInspector();
        }
      } finally {
        setSaving(false);
      }
    },
    [deleteEvent, handleCloseInspector, selectedEvent],
  );

  const handleSelectDayFromMonth = useCallback((date: Date) => {
    setFocusDate(startOfDay(date));
    setViewKind('day');
  }, []);

  const handleSelectMonthFromYear = useCallback((date: Date) => {
    setFocusDate(startOfDay(date));
    setViewKind('month');
  }, []);

  const handleEmptyDay = useCallback(
    (date: Date) => {
      if (!defaultCalendarId) {
        return;
      }
      const start = startOfDay(date);
      start.setHours(10, 0, 0, 0);
      setSelectedEvent(null);
      setDraft(createDefaultDraft(start.getTime(), defaultCalendarId));
      setInspectorMode('create');
    },
    [defaultCalendarId],
  );

  if (!hydrated) {
    return (
      <div className='home-calendar home-calendar--loading'>
        <div className='home-calendar__skeleton' />
      </div>
    );
  }

  if (!platformSupported) {
    return (
      <div className='home-calendar home-calendar--empty'>
        <EmptyState icon={CalendarDays} title='Calendário' message='Disponível apenas no macOS' />
      </div>
    );
  }

  if (!accessGranted) {
    return (
      <div className='home-calendar home-calendar--empty'>
        <EmptyState
          icon={CalendarDays}
          title='Acesso ao Calendário'
          message='Permita o acesso para ver e gerenciar seus eventos'
        >
          <button
            type='button'
            className='empty-state__action app-button app-button--enter'
            onClick={() => void requestAccess()}
          >
            Permitir acesso ao Calendário
          </button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={`home-calendar${inspectorMode !== 'closed' ? ' home-calendar--inspector-open' : ''}`}>
      <HomeCalendarSidebar
        accounts={accounts}
        enabledCalendarIds={enabledCalendarIds}
        focusDate={focusDate}
        onToggleCalendar={toggleCalendar}
        onSelectDate={(date) => {
          handleSelectDate(date);
          if (viewKind === 'year') {
            setViewKind('day');
          }
        }}
      />

      <div className='home-calendar__main'>
        <HomeCalendarToolbar
          viewKind={viewKind}
          title={viewKind === 'day' ? title : title}
          searchQuery={searchQuery}
          onChangeView={setViewKind}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          onCreate={handleCreate}
          onSearchChange={setSearchQuery}
        />

        {viewKind === 'day' ? (
          <div className='home-calendar__day-layout'>
            <div className='home-calendar__day-copy'>
              <h3 className='home-calendar__day-title'>{title}</h3>
              <p className='home-calendar__day-subtitle'>{daySubtitle}</p>
            </div>
            <HomeCalendarTimeGrid
              focusDate={focusDate}
              mode='day'
              events={filteredEvents}
              selectedEventId={selectedEvent?.id ?? null}
              onSelectEvent={handleSelectEvent}
              onEmptySlot={handleEmptySlot}
              showDayHeader={false}
            />
          </div>
        ) : null}

        {viewKind === 'week' ? (
          <HomeCalendarTimeGrid
            focusDate={focusDate}
            mode='week'
            events={filteredEvents}
            selectedEventId={selectedEvent?.id ?? null}
            onSelectEvent={handleSelectEvent}
            onEmptySlot={handleEmptySlot}
          />
        ) : null}

        {viewKind === 'month' ? (
          <HomeCalendarMonthView
            focusDate={focusDate}
            events={filteredEvents}
            selectedEventId={selectedEvent?.id ?? null}
            onSelectEvent={handleSelectEvent}
            onSelectDay={handleSelectDayFromMonth}
            onEmptyDay={handleEmptyDay}
          />
        ) : null}

        {viewKind === 'year' ? (
          <HomeCalendarYearView
            focusDate={focusDate}
            onSelectDay={handleSelectDayFromMonth}
            onSelectMonth={handleSelectMonthFromYear}
          />
        ) : null}
      </div>

      <HomeCalendarInspector
        mode={inspectorMode}
        draft={draft}
        event={selectedEvent}
        editableCalendars={editableCalendars}
        saving={saving}
        onChangeDraft={setDraft}
        onSave={(span) => void handleSave(span)}
        onDelete={(span) => void handleDelete(span)}
        onClose={handleCloseInspector}
        onOpenInCalendar={(startAt) => void openEvent(startAt)}
      />
    </div>
  );
}

export const HomeCalendarView = memo(HomeCalendarViewComponent);
