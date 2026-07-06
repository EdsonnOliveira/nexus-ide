import { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { SystemStatusSnapshot } from '@/types';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';

interface TitleBarBatteryPopupProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  snapshot: SystemStatusSnapshot;
  onClose: () => void;
}

function TitleBarBatteryPopupComponent({
  anchorRect,
  anchorRef,
  snapshot,
  onClose,
}: TitleBarBatteryPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const batteryPercentClass = useMemo(() => {
    if (!snapshot.batteryPresent || snapshot.batteryLevel === null) {
      return '';
    }

    if (snapshot.batteryCharging) {
      return ' titlebar-panel__battery-percent--charging';
    }

    if (snapshot.batteryLevel <= 15) {
      return ' titlebar-panel__battery-percent--blink';
    }

    if (snapshot.batteryLevel < 20) {
      return ' titlebar-panel__battery-percent--low';
    }

    return ' titlebar-panel__battery-percent--high';
  }, [snapshot.batteryCharging, snapshot.batteryLevel, snapshot.batteryPresent]);

  const statusLabel = useMemo(() => {
    if (!snapshot.batteryPresent || snapshot.batteryLevel === null) {
      return 'Indisponível';
    }

    if (snapshot.batteryCharging) {
      return 'Carregando';
    }

    return 'Descarregando';
  }, [snapshot.batteryCharging, snapshot.batteryLevel, snapshot.batteryPresent]);

  const timeLabel = snapshot.batteryTimeRemaining
    ? `${snapshot.batteryTimeRemaining} restantes`
    : 'Indisponível';

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title='Bateria'
      onClose={requestClose}
    >
      <div className='agent-cursor-usage__summary'>
        <span className={`agent-cursor-usage__summary-percent${batteryPercentClass}`}>
          {snapshot.batteryLevel !== null ? `${snapshot.batteryLevel}%` : '—'}
        </span>
        <span className='agent-cursor-usage__summary-plan'>{statusLabel}</span>
      </div>

      <ul className='agent-cursor-usage__list'>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Nível</span>
          <span className='agent-cursor-usage__item-value'>
            {snapshot.batteryLevel !== null ? `${snapshot.batteryLevel}%` : '—'}
          </span>
        </li>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Tempo restante</span>
          <span className='agent-cursor-usage__item-value'>{timeLabel}</span>
        </li>
        <li className='agent-cursor-usage__item'>
          <span className='agent-cursor-usage__item-label'>Fonte</span>
          <span className='agent-cursor-usage__item-value'>
            {snapshot.batteryPresent ? 'Bateria interna' : 'Indisponível'}
          </span>
        </li>
      </ul>
    </TitleBarPopupShell>,
    document.body,
  );
}

export const TitleBarBatteryPopup = memo(TitleBarBatteryPopupComponent);
