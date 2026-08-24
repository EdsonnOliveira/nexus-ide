import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import type { HomeCalendarViewKind } from '@/components/home/calendar/homeCalendarUtils';

interface HomeCalendarToolbarProps {
  viewKind: HomeCalendarViewKind;
  title: string;
  searchQuery: string;
  onChangeView: (kind: HomeCalendarViewKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
}

const VIEW_OPTIONS: { value: HomeCalendarViewKind; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'year', label: 'Ano' },
];

function HomeCalendarToolbarComponent({
  viewKind,
  title,
  searchQuery,
  onChangeView,
  onPrev,
  onNext,
  onToday,
  onCreate,
  onSearchChange,
}: HomeCalendarToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  const handleToggleSearch = useCallback(() => {
    setSearchOpen((current) => {
      if (current) {
        onSearchChange('');
      }
      return !current;
    });
  }, [onSearchChange]);

  return (
    <header className='home-calendar__toolbar'>
      <div className='home-calendar__toolbar-left'>
        <button
          type='button'
          className='home-calendar__icon-btn home-calendar__icon-btn--accent app-button app-button--enter'
          aria-label='Novo evento'
          onClick={onCreate}
        >
          <Plus size={16} strokeWidth={2.2} />
        </button>
        <h2 className='home-calendar__toolbar-title'>{title}</h2>
      </div>

      <div className='home-calendar__view-switch' role='tablist' aria-label='Vista do calendário'>
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type='button'
            role='tab'
            aria-selected={viewKind === option.value}
            className={`home-calendar__view-btn app-button${viewKind === option.value ? ' home-calendar__view-btn--active' : ''}`}
            onClick={() => onChangeView(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className='home-calendar__toolbar-right'>
        {searchOpen ? (
          <div className='home-calendar__search'>
            <Search size={14} strokeWidth={2} aria-hidden='true' />
            <input
              type='text'
              className='home-calendar__search-input'
              placeholder='Buscar eventos'
              value={searchQuery}
              autoFocus
              onChange={(event) => onSearchChange(event.target.value)}
            />
            <button
              type='button'
              className='home-calendar__icon-btn app-button'
              aria-label='Fechar busca'
              onClick={handleToggleSearch}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <button
            type='button'
            className='home-calendar__icon-btn app-button'
            aria-label='Buscar'
            onClick={handleToggleSearch}
          >
            <Search size={15} strokeWidth={2} />
          </button>
        )}
        <button
          type='button'
          className='home-calendar__icon-btn app-button'
          aria-label='Anterior'
          onClick={onPrev}
        >
          <ChevronLeft size={16} strokeWidth={2.2} />
        </button>
        <button type='button' className='home-calendar__today-btn app-button' onClick={onToday}>
          Hoje
        </button>
        <button
          type='button'
          className='home-calendar__icon-btn app-button'
          aria-label='Próximo'
          onClick={onNext}
        >
          <ChevronRight size={16} strokeWidth={2.2} />
        </button>
      </div>
    </header>
  );
}

export const HomeCalendarToolbar = memo(HomeCalendarToolbarComponent);
