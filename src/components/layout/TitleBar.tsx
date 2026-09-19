import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Gauge,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { TitleBarBatteryCriticalAlert } from '@/components/layout/titlebar/TitleBarBatteryCriticalAlert';
import { TitleBarBatteryPopup } from '@/components/layout/titlebar/TitleBarBatteryPopup';
import { TitleBarPingPopup } from '@/components/layout/titlebar/TitleBarPingPopup';
import { TitleBarUsagePopup } from '@/components/layout/titlebar/TitleBarUsagePopup';
import { isVisibleAiUsageProvider } from '@/constants/aiProviders';
import { useAiProviderUsage } from '@/hooks/useAiProviderUsage';
import { useInternetPing } from '@/hooks/useInternetPing';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { startBatteryAlertSoundLoop, stopBatteryAlertSoundLoop } from '@/utils/batteryAlertSound';
import { closeAllAnchoredDropdowns } from '@/utils/overlayBlocking';

type TitleBarPopupId = 'battery' | 'ping' | 'usage';

function TitleBarComponent() {
  const latencyMs = useInternetPing(true);
  const { snapshot: systemStatus } = useSystemStatus(true);
  const { snapshot: aiUsage, isLoading: aiUsageLoading, refresh: refreshAiUsage } =
    useAiProviderUsage(true);
  const enabledAiProviders = useAppSettingsStore((state) => state.enabledAiProviders);
  const batteryButtonRef = useRef<HTMLButtonElement>(null);
  const pingButtonRef = useRef<HTMLButtonElement>(null);
  const usageButtonRef = useRef<HTMLButtonElement>(null);
  const [openPopup, setOpenPopup] = useState<TitleBarPopupId | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [batteryCriticalAlertDismissed, setBatteryCriticalAlertDismissed] = useState(false);

  const pingLabel = useMemo(() => (latencyMs === null ? '—' : `${latencyMs} ms`), [latencyMs]);
  const pingAriaLabel = useMemo(
    () => (latencyMs === null ? 'Sem conexão' : `Ping ${latencyMs} milissegundos`),
    [latencyMs],
  );
  const PingIcon = latencyMs === null ? WifiOff : Wifi;
  const pingToneClass = useMemo(() => {
    if (latencyMs === null) {
      return ' titlebar__ping--offline';
    }

    if (latencyMs <= 50) {
      return ' titlebar__ping--good';
    }

    if (latencyMs <= 150) {
      return ' titlebar__ping--normal';
    }

    return ' titlebar__ping--slow';
  }, [latencyMs]);

  const visibleUsageItems = useMemo(
    () => aiUsage.items.filter((item) => isVisibleAiUsageProvider(item.id, enabledAiProviders)),
    [aiUsage.items, enabledAiProviders],
  );

  const usagePercent = useMemo(() => {
    const percents = visibleUsageItems
      .map((item) => item.percent)
      .filter((value): value is number => value !== null);

    if (percents.length === 0) {
      return null;
    }

    return percents.reduce((sum, value) => sum + value, 0) / percents.length;
  }, [visibleUsageItems]);

  const usageLabel = useMemo(
    () => (usagePercent === null ? 'Limites de IA' : `Limites de IA ${Math.round(usagePercent)}%`),
    [usagePercent],
  );

  const usageToneClass = useMemo(() => {
    if (usagePercent === null) {
      return ' titlebar__usage--offline';
    }

    if (usagePercent >= 95) {
      return ' titlebar__usage--critical';
    }

    if (usagePercent >= 80) {
      return ' titlebar__usage--warning';
    }

    if (usagePercent <= 50) {
      return ' titlebar__usage--good';
    }

    return ' titlebar__usage--normal';
  }, [usagePercent]);

  const showBattery = systemStatus.batteryPresent && systemStatus.batteryLevel !== null;

  const batteryLabel = useMemo(() => {
    if (!showBattery) {
      return 'Bateria indisponível';
    }

    const suffix = systemStatus.batteryCharging ? ' — carregando' : '';
    return `Bateria ${systemStatus.batteryLevel}%${suffix}`;
  }, [showBattery, systemStatus.batteryCharging, systemStatus.batteryLevel]);

  const batteryToneClass = useMemo(() => {
    if (!showBattery) {
      return '';
    }

    if (systemStatus.batteryCharging) {
      return ' titlebar__item--battery-charging';
    }

    if ((systemStatus.batteryLevel ?? 0) <= 15) {
      return ' titlebar__item--battery-blink';
    }

    if ((systemStatus.batteryLevel ?? 0) < 20) {
      return ' titlebar__item--battery-low';
    }

    return ' titlebar__item--battery-high';
  }, [showBattery, systemStatus.batteryCharging, systemStatus.batteryLevel]);

  const isBatteryCritical =
    showBattery && (systemStatus.batteryLevel ?? 0) <= 15 && !systemStatus.batteryCharging;

  const showBatteryCriticalAlert =
    showBattery &&
    (systemStatus.batteryLevel ?? 0) <= 10 &&
    !systemStatus.batteryCharging &&
    !batteryCriticalAlertDismissed;

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

  useEffect(() => {
    if (
      systemStatus.batteryCharging ||
      systemStatus.batteryLevel === null ||
      systemStatus.batteryLevel > 10
    ) {
      setBatteryCriticalAlertDismissed(false);
    }
  }, [systemStatus.batteryCharging, systemStatus.batteryLevel]);

  useEffect(() => {
    if (isBatteryCritical) {
      startBatteryAlertSoundLoop(systemStatus.batteryLevel ?? 15);
    } else {
      stopBatteryAlertSoundLoop();
    }

    return () => {
      stopBatteryAlertSoundLoop();
    };
  }, [isBatteryCritical, systemStatus.batteryLevel]);

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

  const handleToggleUsagePopup = useCallback(() => {
    if (openPopup !== 'usage') {
      void refreshAiUsage(true);
    }

    handleTogglePopup('usage', usageButtonRef);
  }, [handleTogglePopup, openPopup, refreshAiUsage]);

  const handleDismissBatteryCriticalAlert = useCallback(() => {
    setBatteryCriticalAlertDismissed(true);
  }, []);

  return (
    <header className='titlebar' aria-label='Barra de status'>
      <div className='titlebar__tray'>
        <button
          ref={usageButtonRef}
          type='button'
          className={`titlebar__item titlebar__usage app-button app-button--enter${usageToneClass}${openPopup === 'usage' ? ' titlebar__item--active' : ''}`}
          title={usageLabel}
          aria-label={usageLabel}
          aria-expanded={openPopup === 'usage'}
          onClick={handleToggleUsagePopup}
        >
          <Gauge size={13} strokeWidth={2} aria-hidden='true' />
          <span className='titlebar__usage-level'>
            {aiUsageLoading && usagePercent === null
              ? '…'
              : usagePercent === null
                ? '—'
                : `${Math.round(usagePercent)}%`}
          </span>
        </button>

        {showBattery ? (
          <button
            ref={batteryButtonRef}
            type='button'
            className={`titlebar__item titlebar__item--battery app-button app-button--enter${batteryToneClass}${openPopup === 'battery' ? ' titlebar__item--active' : ''}`}
            title={batteryLabel}
            aria-label={batteryLabel}
            aria-expanded={openPopup === 'battery'}
            onClick={() => handleTogglePopup('battery', batteryButtonRef)}
          >
            <BatteryIcon size={13} strokeWidth={2} aria-hidden='true' />
            <span className='titlebar__battery-level'>{systemStatus.batteryLevel}%</span>
          </button>
        ) : null}

        <button
          ref={pingButtonRef}
          type='button'
          className={`titlebar__item titlebar__ping app-button app-button--enter${pingToneClass}${openPopup === 'ping' ? ' titlebar__item--active' : ''}`}
          title={pingAriaLabel}
          aria-label={pingAriaLabel}
          aria-expanded={openPopup === 'ping'}
          aria-live='polite'
          onClick={() => handleTogglePopup('ping', pingButtonRef)}
        >
          <PingIcon size={13} strokeWidth={2} aria-hidden='true' />
          {pingLabel}
        </button>
      </div>

      {openPopup === 'usage' && anchorRect ? (
        <TitleBarUsagePopup
          anchorRect={anchorRect}
          anchorRef={usageButtonRef}
          items={visibleUsageItems}
          isLoading={aiUsageLoading}
          onClose={handleClosePopup}
          onRefresh={() => {
            void refreshAiUsage(true);
          }}
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

      {openPopup === 'ping' && anchorRect ? (
        <TitleBarPingPopup
          anchorRect={anchorRect}
          anchorRef={pingButtonRef}
          snapshot={systemStatus}
          latencyMs={latencyMs}
          pingToneClass={pingToneClass}
          onClose={handleClosePopup}
        />
      ) : null}

      {showBatteryCriticalAlert ? (
        <TitleBarBatteryCriticalAlert
          batteryLevel={systemStatus.batteryLevel ?? 10}
          onDismiss={handleDismissBatteryCriticalAlert}
        />
      ) : null}
    </header>
  );
}

export const TitleBar = memo(TitleBarComponent);
