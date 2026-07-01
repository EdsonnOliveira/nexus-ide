import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { TitleBarBatteryPopup } from '@/components/layout/titlebar/TitleBarBatteryPopup';
import { TitleBarNotificationsPopup } from '@/components/layout/titlebar/TitleBarNotificationsPopup';
import { TitleBarVolumePopup } from '@/components/layout/titlebar/TitleBarVolumePopup';
import { TitleBarWifiPopup } from '@/components/layout/titlebar/TitleBarWifiPopup';
import { useSystemNotifications } from '@/hooks/useSystemNotifications';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useTitleBarClock } from '@/hooks/useTitleBarClock';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { closeAllAnchoredDropdowns } from '@/utils/overlayBlocking';
import { getRecentSystemNotificationCount } from '@/utils/notificationRelativeTime';

type TitleBarPopupId = 'volume' | 'battery' | 'wifi' | 'notifications';

function TitleBarComponent() {
  const { snapshot: systemStatus, refresh } = useSystemStatus(true);
  const clockLabel = useTitleBarClock(true);
  const notifiedAgentPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );
  const { snapshot: systemNotifications } = useSystemNotifications(true);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const batteryButtonRef = useRef<HTMLButtonElement>(null);
  const wifiButtonRef = useRef<HTMLButtonElement>(null);
  const clockButtonRef = useRef<HTMLButtonElement>(null);
  const [openPopup, setOpenPopup] = useState<TitleBarPopupId | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const hasNotifications = useMemo(() => {
    const agentCount = Object.keys(notifiedAgentPaneByProject).length;
    const systemCount = getRecentSystemNotificationCount(systemNotifications.items);

    return agentCount > 0 || systemCount > 0;
  }, [notifiedAgentPaneByProject, systemNotifications.items]);

  const volumeLabel = systemStatus.muted
    ? 'Sem som'
    : `Volume ${systemStatus.volume}%`;

  const batteryLabel = useMemo(() => {
    if (!systemStatus.batteryPresent || systemStatus.batteryLevel === null) {
      return 'Bateria indisponível';
    }

    const suffix = systemStatus.batteryCharging ? ' — carregando' : '';
    return `Bateria ${systemStatus.batteryLevel}%${suffix}`;
  }, [systemStatus.batteryCharging, systemStatus.batteryLevel, systemStatus.batteryPresent]);

  const wifiLabel = systemStatus.wifiConnected
    ? systemStatus.wifiNetwork
      ? `Wi-Fi: ${systemStatus.wifiNetwork}`
      : 'Wi-Fi conectado'
    : 'Wi-Fi desconectado';

  const batteryToneClass = useMemo(() => {
    if (!systemStatus.batteryPresent || systemStatus.batteryLevel === null) {
      return '';
    }

    if (systemStatus.batteryCharging) {
      return ' titlebar__item--battery-charging';
    }

    if (systemStatus.batteryLevel < 10) {
      return ' titlebar__item--battery-critical';
    }

    if (systemStatus.batteryLevel < 20) {
      return ' titlebar__item--battery-low';
    }

    return ' titlebar__item--battery-high';
  }, [
    systemStatus.batteryCharging,
    systemStatus.batteryLevel,
    systemStatus.batteryPresent,
  ]);

  const BatteryIcon = useMemo(() => {
    if (systemStatus.batteryCharging) {
      return BatteryCharging;
    }

    const level = systemStatus.batteryLevel ?? 0;

    if (level >= 90) {
      return BatteryFull;
    }

    if (level >= 45) {
      return BatteryMedium;
    }

    if (level >= 15) {
      return Battery;
    }

    return BatteryLow;
  }, [systemStatus.batteryCharging, systemStatus.batteryLevel]);

  const VolumeIcon = systemStatus.muted ? VolumeX : Volume2;
  const WifiIcon = systemStatus.wifiConnected ? Wifi : WifiOff;

  const handleClosePopup = useCallback(() => {
    setOpenPopup(null);
    setAnchorRect(null);
  }, []);

  const handleTogglePopup = useCallback(
    (popupId: TitleBarPopupId, buttonRef: React.RefObject<HTMLButtonElement | null>) => {
      if (openPopup === popupId) {
        handleClosePopup();
        return;
      }

      closeAllAnchoredDropdowns();
      const rect = buttonRef.current?.getBoundingClientRect() ?? null;

      if (!rect) {
        return;
      }

      setAnchorRect(rect);
      setOpenPopup(popupId);
    },
    [handleClosePopup, openPopup],
  );

  return (
    <header className='titlebar' aria-label='Barra de status'>
      <div className='titlebar__tray'>
        <button
          ref={volumeButtonRef}
          type='button'
          className={`titlebar__item app-button app-button--enter${systemStatus.muted ? ' titlebar__item--muted' : ''}${openPopup === 'volume' ? ' titlebar__item--active' : ''}`}
          title={volumeLabel}
          aria-label={volumeLabel}
          aria-expanded={openPopup === 'volume'}
          onClick={() => handleTogglePopup('volume', volumeButtonRef)}
        >
          <VolumeIcon size={13} strokeWidth={1.75} aria-hidden='true' />
        </button>

        <button
          ref={batteryButtonRef}
          type='button'
          className={`titlebar__item app-button app-button--enter${batteryToneClass}${openPopup === 'battery' ? ' titlebar__item--active' : ''}`}
          title={batteryLabel}
          aria-label={batteryLabel}
          aria-expanded={openPopup === 'battery'}
          onClick={() => handleTogglePopup('battery', batteryButtonRef)}
        >
          <BatteryIcon size={13} strokeWidth={1.75} aria-hidden='true' />
          {systemStatus.batteryPresent && systemStatus.batteryLevel !== null ? (
            <span className='titlebar__battery-level'>{systemStatus.batteryLevel}%</span>
          ) : null}
        </button>

        <button
          ref={wifiButtonRef}
          type='button'
          className={`titlebar__item app-button app-button--enter${systemStatus.wifiConnected ? '' : ' titlebar__item--muted'}${openPopup === 'wifi' ? ' titlebar__item--active' : ''}`}
          title={wifiLabel}
          aria-label={wifiLabel}
          aria-expanded={openPopup === 'wifi'}
          onClick={() => handleTogglePopup('wifi', wifiButtonRef)}
        >
          <WifiIcon size={13} strokeWidth={1.75} aria-hidden='true' />
        </button>

        <button
          ref={clockButtonRef}
          type='button'
          className={`titlebar__item titlebar__item--clock app-button app-button--enter${openPopup === 'notifications' ? ' titlebar__item--active' : ''}`}
          title={hasNotifications ? 'Notificações pendentes' : clockLabel}
          aria-label={hasNotifications ? 'Notificações pendentes' : clockLabel}
          aria-expanded={openPopup === 'notifications'}
          onClick={() => handleTogglePopup('notifications', clockButtonRef)}
        >
          <span className='titlebar__clock'>{clockLabel}</span>
          {hasNotifications ? <span className='titlebar__notify-dot' aria-hidden='true' /> : null}
        </button>
      </div>

      {openPopup === 'volume' && anchorRect ? (
        <TitleBarVolumePopup
          anchorRect={anchorRect}
          anchorRef={volumeButtonRef}
          snapshot={systemStatus}
          onClose={handleClosePopup}
          onRefresh={refresh}
        />
      ) : null}

      {openPopup === 'battery' && anchorRect ? (
        <TitleBarBatteryPopup
          anchorRect={anchorRect}
          anchorRef={batteryButtonRef}
          snapshot={systemStatus}
          onClose={handleClosePopup}
        />
      ) : null}

      {openPopup === 'wifi' && anchorRect ? (
        <TitleBarWifiPopup
          anchorRect={anchorRect}
          anchorRef={wifiButtonRef}
          onClose={handleClosePopup}
          onRefresh={refresh}
        />
      ) : null}

      {openPopup === 'notifications' && anchorRect ? (
        <TitleBarNotificationsPopup
          anchorRect={anchorRect}
          anchorRef={clockButtonRef}
          onClose={handleClosePopup}
        />
      ) : null}
    </header>
  );
}

export const TitleBar = memo(TitleBarComponent);
