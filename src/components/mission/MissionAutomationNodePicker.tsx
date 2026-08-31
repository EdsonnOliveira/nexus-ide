import { ChevronDown, Plus, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MISSION_AUTOMATION_CATALOG,
  MISSION_AUTOMATION_CATEGORY_ORDER,
  getMissionAutomationCategoryLabel,
  searchMissionAutomationCatalog,
  type MissionAutomationCatalogEntry,
} from '@/constants/missionAutomationCatalog';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';

interface MissionAutomationNodePickerProps {
  onSelect: (entry: MissionAutomationCatalogEntry) => void;
  triggerClassName?: string;
  menuClassName?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
}

function MissionAutomationNodePickerMenu({
  anchorRect,
  anchorRef,
  align,
  menuClassName,
  onClose,
  onSelect,
}: {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  align: 'start' | 'end';
  menuClassName?: string;
  onClose: () => void;
  onSelect: (entry: MissionAutomationCatalogEntry) => void;
}) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, align),
    [anchorRect, align],
  );
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      requestClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, menuRef, requestClose]);

  const grouped = useMemo(() => {
    const filtered = query.trim()
      ? searchMissionAutomationCatalog(query)
      : MISSION_AUTOMATION_CATALOG;
    const byCategory = new Map<string, MissionAutomationCatalogEntry[]>();
    for (const entry of filtered) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry);
      byCategory.set(entry.category, list);
    }
    return MISSION_AUTOMATION_CATEGORY_ORDER.map((category) => ({
      category,
      label: getMissionAutomationCategoryLabel(category),
      entries: byCategory.get(category) ?? [],
    })).filter((group) => group.entries.length > 0);
  }, [query]);

  const handlePick = useCallback(
    (entry: MissionAutomationCatalogEntry) =>
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(entry);
        requestClose();
      },
    [onSelect, requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu mission-automation-picker overlay-popup--anchor-${align} ${animationClass}${
        menuClassName ? ` ${menuClassName}` : ''
      }`}
      role='menu'
    >
      <div className='mission-automation-picker__search'>
        <Search size={14} strokeWidth={2.25} aria-hidden='true' />
        <input
          ref={inputRef}
          className='mission-automation-picker__input'
          value={query}
          placeholder='Buscar nó...'
          aria-label='Buscar nó de automação'
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </div>
      <div className='mission-automation-picker__list'>
        {grouped.length === 0 ? (
          <div className='mission-automation-picker__empty'>Nenhum nó encontrado</div>
        ) : (
          grouped.map((group) => (
            <div key={group.category} className='mission-automation-picker__group'>
              <div className='mission-automation-picker__group-label'>{group.label}</div>
              {group.entries.map((entry) => {
                const visual = getMissionAgentVisual({
                  kind: 'automation',
                  automationCategory: entry.category,
                });
                const Icon = visual.icon;
                return (
                  <button
                    key={entry.id}
                    type='button'
                    className='context-menu__item mission-automation-picker__item'
                    role='menuitem'
                    onMouseDown={handlePick(entry)}
                  >
                    <span
                      className='mission-graph-view__template-icon'
                      style={{
                        color: visual.accent,
                        background: visual.accentSoft,
                        borderColor: visual.accentBorder,
                      }}
                      aria-hidden='true'
                    >
                      <Icon size={14} strokeWidth={2.25} />
                    </span>
                    <span className='mission-automation-picker__item-copy'>
                      <span className='mission-automation-picker__item-label'>{entry.label}</span>
                      {entry.provider ? (
                        <span className='mission-automation-picker__item-sub'>
                          {entry.provider}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}

function MissionAutomationNodePickerComponent({
  onSelect,
  triggerClassName,
  menuClassName,
  align = 'end',
  disabled = false,
}: MissionAutomationNodePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchorRect(rect);
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (disabled) {
      return;
    }
    updateRect();
    setOpen((current) => !current);
  }, [disabled, updateRect]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onResize = () => updateRect();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, updateRect]);

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={`anchored-select__trigger app-button app-button--enter mission-graph-view__tool mission-graph-view__add-agent${
          open ? ' anchored-select__trigger--open' : ''
        }${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-haspopup='menu'
        aria-expanded={open}
        disabled={disabled}
        onClick={handleToggle}
      >
        <Plus size={14} strokeWidth={2.25} aria-hidden='true' />
        <span className='anchored-select__trigger-label'>Nó</span>
        <ChevronDown
          size={14}
          strokeWidth={2.25}
          className={`anchored-select__chevron${open ? ' anchored-select__chevron--open' : ''}`}
          aria-hidden='true'
        />
      </button>
      {open && anchorRect ? (
        <MissionAutomationNodePickerMenu
          anchorRect={anchorRect}
          anchorRef={triggerRef}
          align={align}
          menuClassName={menuClassName}
          onClose={() => setOpen(false)}
          onSelect={onSelect}
        />
      ) : null}
    </>
  );
}

export const MissionAutomationNodePicker = memo(MissionAutomationNodePickerComponent);
