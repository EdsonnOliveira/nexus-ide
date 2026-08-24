import {
  Check,
  CircleHelp,
  ExternalLink,
  RefreshCw,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import type {
  CalendarFullEventItem,
  CalendarListItem,
  CalendarMutationSpan,
} from '@/types';
import type { HomeCalendarDraft } from '@/components/home/calendar/homeCalendarUtils';
import {
  formatTimeLabel,
  MONTH_NAMES,
} from '@/components/home/calendar/homeCalendarUtils';
import {
  formatCalendarLinkDisplayLabel,
  resolveCalendarMeetingInfo,
} from '@/utils/calendarEventStyle';

interface HomeCalendarInspectorProps {
  mode: 'create' | 'edit' | 'closed';
  draft: HomeCalendarDraft | null;
  event: CalendarFullEventItem | null;
  editableCalendars: CalendarListItem[];
  saving: boolean;
  onChangeDraft: (draft: HomeCalendarDraft) => void;
  onSave: (span?: CalendarMutationSpan) => void;
  onDelete: (span?: CalendarMutationSpan) => void;
  onClose: () => void;
  onOpenInCalendar: (startAt: number) => void;
}

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Não se repete' },
  { value: 'daily', label: 'Todos os dias' },
  { value: 'weekdays', label: 'Todos os dias úteis' },
  { value: 'weekly', label: 'Semanalmente' },
];

const ALERT_OPTIONS = [
  { value: '0', label: 'Nenhum' },
  { value: '5', label: '5 minutos antes' },
  { value: '15', label: '15 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
];

function toDatetimeLocalValue(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDatetimeLocalValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function attendeeIcon(status: string) {
  if (status === 'accepted') {
    return <Check size={12} strokeWidth={2.4} className='home-calendar__attendee-icon home-calendar__attendee-icon--ok' />;
  }
  if (status === 'declined') {
    return <X size={12} strokeWidth={2.4} className='home-calendar__attendee-icon home-calendar__attendee-icon--no' />;
  }
  return <CircleHelp size={12} strokeWidth={2.4} className='home-calendar__attendee-icon' />;
}

function HomeCalendarInspectorComponent({
  mode,
  draft,
  event,
  editableCalendars,
  saving,
  onChangeDraft,
  onSave,
  onDelete,
  onClose,
  onOpenInCalendar,
}: HomeCalendarInspectorProps) {
  const [spanChoice, setSpanChoice] = useState<CalendarMutationSpan>('thisEvent');

  useEffect(() => {
    setSpanChoice('thisEvent');
  }, [event?.id, mode]);

  const calendarOptions = useMemo(
    () =>
      editableCalendars.map((item) => ({
        value: item.id,
        label: item.title,
      })),
    [editableCalendars],
  );

  const meetingUrl = useMemo(() => {
    if (mode === 'edit' && event) {
      return resolveCalendarMeetingInfo(event)?.url ?? null;
    }
    if (draft?.url) {
      return draft.url;
    }
    return null;
  }, [draft?.url, event, mode]);

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!draft) {
        return;
      }
      onChangeDraft({ ...draft, title: value });
    },
    [draft, onChangeDraft],
  );

  const handleCalendarChange = useCallback(
    (value: string) => {
      if (!draft || !value) {
        return;
      }
      onChangeDraft({ ...draft, calendarId: value });
    },
    [draft, onChangeDraft],
  );

  const handleStartChange = useCallback(
    (value: string) => {
      if (!draft) {
        return;
      }
      const startAt = fromDatetimeLocalValue(value);
      const duration = Math.max(15 * 60_000, draft.endAt - draft.startAt);
      onChangeDraft({ ...draft, startAt, endAt: startAt + duration });
    },
    [draft, onChangeDraft],
  );

  const handleEndChange = useCallback(
    (value: string) => {
      if (!draft) {
        return;
      }
      const endAt = fromDatetimeLocalValue(value);
      onChangeDraft({ ...draft, endAt: Math.max(endAt, draft.startAt + 15 * 60_000) });
    },
    [draft, onChangeDraft],
  );

  if (mode === 'closed' || !draft) {
    return null;
  }

  const readOnly = mode === 'edit' && event ? !event.allowsEdit : false;
  const hasRecurrence = mode === 'edit' && Boolean(event?.hasRecurrence);
  const weekdayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const date = new Date(draft.startAt);
  const scheduleLabel = `${weekdayNames[date.getDay()]}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;

  return (
    <aside className='home-calendar__inspector app-button--enter'>
      <div className='home-calendar__inspector-header'>
        <input
          className='home-calendar__inspector-title'
          value={draft.title}
          placeholder='Novo evento'
          disabled={readOnly || saving}
          onChange={(eventChange) => handleTitleChange(eventChange.target.value)}
        />
        <button
          type='button'
          className='home-calendar__icon-btn app-button'
          aria-label='Fechar'
          onClick={onClose}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className='home-calendar__inspector-row'>
        <span
          className='home-calendar__inspector-dot'
          style={{ background: editableCalendars.find((item) => item.id === draft.calendarId)?.colorHex ?? '#FFCC00' }}
          aria-hidden='true'
        />
        <AnchoredSelect
          value={draft.calendarId}
          options={calendarOptions}
          onChange={handleCalendarChange}
          disabled={readOnly || saving || calendarOptions.length === 0}
          triggerClassName='home-calendar__inspector-select'
        />
      </div>

      {meetingUrl ? (
        <div className='home-calendar__inspector-meeting'>
          <Video size={14} strokeWidth={2} aria-hidden='true' />
          <span className='home-calendar__inspector-meeting-label'>
            {formatCalendarLinkDisplayLabel(meetingUrl)}
          </span>
          <button
            type='button'
            className='home-calendar__join-btn app-button'
            onClick={() => void window.nexus.tasks.openExternalUrl(meetingUrl)}
          >
            Entrar
          </button>
        </div>
      ) : null}

      <div className='home-calendar__inspector-section'>
        <p className='home-calendar__inspector-date'>{scheduleLabel}</p>
        {!draft.allDay ? (
          <div className='home-calendar__inspector-times'>
            <input
              type='datetime-local'
              className='home-calendar__inspector-datetime'
              value={toDatetimeLocalValue(draft.startAt)}
              disabled={readOnly || saving}
              onChange={(eventChange) => handleStartChange(eventChange.target.value)}
            />
            <span>–</span>
            <input
              type='datetime-local'
              className='home-calendar__inspector-datetime'
              value={toDatetimeLocalValue(draft.endAt)}
              disabled={readOnly || saving}
              onChange={(eventChange) => handleEndChange(eventChange.target.value)}
            />
          </div>
        ) : (
          <p className='home-calendar__inspector-muted'>
            {formatTimeLabel(draft.startAt)} – {formatTimeLabel(draft.endAt)}
          </p>
        )}
        <label className='home-calendar__inspector-check'>
          <AppCheckbox
            checked={draft.allDay}
            disabled={readOnly || saving}
            onChange={(checked) => onChangeDraft({ ...draft, allDay: checked })}
          />
          <span>Dia inteiro</span>
        </label>
      </div>

      <div className='home-calendar__inspector-section'>
        <div className='home-calendar__inspector-field'>
          <RefreshCw size={13} strokeWidth={2} aria-hidden='true' />
          <AnchoredSelect
            value={draft.recurrence}
            options={RECURRENCE_OPTIONS}
            onChange={(value) =>
              onChangeDraft({
                ...draft,
                recurrence: (value || 'none') as HomeCalendarDraft['recurrence'],
              })
            }
            disabled={readOnly || saving}
            triggerClassName='home-calendar__inspector-select'
          />
        </div>
        <div className='home-calendar__inspector-field'>
          <span className='home-calendar__inspector-field-label'>Alerta</span>
          <AnchoredSelect
            value={String(draft.alertMinutes)}
            options={ALERT_OPTIONS}
            onChange={(value) =>
              onChangeDraft({
                ...draft,
                alertMinutes: Number.parseInt(value || '0', 10) || 0,
              })
            }
            disabled={readOnly || saving}
            triggerClassName='home-calendar__inspector-select'
          />
        </div>
      </div>

      <div className='home-calendar__inspector-section'>
        <input
          className='home-calendar__inspector-input'
          placeholder='Local'
          value={draft.location}
          disabled={readOnly || saving}
          onChange={(eventChange) => onChangeDraft({ ...draft, location: eventChange.target.value })}
        />
        <textarea
          className='home-calendar__inspector-notes'
          placeholder='Notas'
          value={draft.notes}
          disabled={readOnly || saving}
          rows={4}
          onChange={(eventChange) => onChangeDraft({ ...draft, notes: eventChange.target.value })}
        />
      </div>

      {mode === 'edit' && event && event.attendees.length > 0 ? (
        <div className='home-calendar__inspector-section'>
          <p className='home-calendar__inspector-section-title'>Participantes</p>
          <ul className='home-calendar__attendees'>
            {event.attendees.map((attendee, index) => (
              <li key={`${attendee.email}-${index}`} className='home-calendar__attendee'>
                {attendeeIcon(attendee.status)}
                <div className='home-calendar__attendee-copy'>
                  <span className='home-calendar__attendee-name'>
                    {attendee.name || attendee.email || 'Participante'}
                    {attendee.isOrganizer ? ' (organizer)' : ''}
                    {attendee.isOptional ? ' (optional)' : ''}
                  </span>
                  {attendee.email ? (
                    <span className='home-calendar__attendee-email'>{attendee.email}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <button
            type='button'
            className='home-calendar__rsvp-btn app-button'
            onClick={() => onOpenInCalendar(event.startAt)}
          >
            <ExternalLink size={13} strokeWidth={2} />
            Alterar RSVP no Calendário
          </button>
        </div>
      ) : null}

      {hasRecurrence ? (
        <div className='home-calendar__inspector-section'>
          <p className='home-calendar__inspector-section-title'>Aplicar a</p>
          <div className='home-calendar__span-switch'>
            <button
              type='button'
              className={`home-calendar__span-btn app-button${spanChoice === 'thisEvent' ? ' home-calendar__span-btn--active' : ''}`}
              onClick={() => setSpanChoice('thisEvent')}
            >
              Somente este
            </button>
            <button
              type='button'
              className={`home-calendar__span-btn app-button${spanChoice === 'futureEvents' ? ' home-calendar__span-btn--active' : ''}`}
              onClick={() => setSpanChoice('futureEvents')}
            >
              Este e futuros
            </button>
          </div>
        </div>
      ) : null}

      <div className='home-calendar__inspector-actions'>
        {mode === 'edit' && !readOnly ? (
          <button
            type='button'
            className='home-calendar__danger-btn app-button'
            disabled={saving}
            onClick={() => onDelete(hasRecurrence ? spanChoice : 'thisEvent')}
          >
            <Trash2 size={14} strokeWidth={2} />
            Excluir
          </button>
        ) : null}
        {!readOnly ? (
          <button
            type='button'
            className='home-calendar__save-btn app-button'
            disabled={saving || !draft.calendarId}
            onClick={() => onSave(hasRecurrence ? spanChoice : 'thisEvent')}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        ) : (
          <button
            type='button'
            className='home-calendar__save-btn app-button'
            onClick={() => event && onOpenInCalendar(event.startAt)}
          >
            Abrir no Calendário
          </button>
        )}
      </div>
    </aside>
  );
}

export const HomeCalendarInspector = memo(HomeCalendarInspectorComponent);

export function draftFromEvent(event: CalendarFullEventItem): HomeCalendarDraft {
  const recurrence =
    event.recurrenceLabel === 'daily' ||
    event.recurrenceLabel === 'weekdays' ||
    event.recurrenceLabel === 'weekly'
      ? (event.recurrenceLabel as HomeCalendarDraft['recurrence'])
      : 'none';

  return {
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    calendarId: event.calendarId,
    allDay: event.allDay,
    location: event.location,
    notes: event.notes,
    url: event.url,
    alertMinutes: event.alarms[0]?.relativeOffsetMinutes ?? 0,
    recurrence,
  };
}
