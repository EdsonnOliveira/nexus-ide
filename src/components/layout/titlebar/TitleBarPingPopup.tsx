import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { WifiOff } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { SystemStatusSnapshot } from '@/types';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';

interface TitleBarPingPopupProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  snapshot: SystemStatusSnapshot;
  latencyMs: number | null;
  pingToneClass: string;
  onClose: () => void;
}

function TitleBarPingPopupComponent({
  anchorRect,
  anchorRef,
  snapshot,
  latencyMs,
  pingToneClass,
  onClose,
}: TitleBarPingPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const [connectedSsid, setConnectedSsid] = useState<string | null>(snapshot.wifiNetwork);

  useEffect(() => {
    let cancelled = false;

    void window.nexus.systemStatus.getConnectedWifiNetwork().then((ssid) => {
      if (!cancelled && ssid) {
        setConnectedSsid(ssid);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const networkLabel = useMemo(() => {
    if (connectedSsid) {
      return connectedSsid;
    }

    if (snapshot.wifiConnected) {
      return 'Wi-Fi';
    }

    return 'Sem conexão';
  }, [connectedSsid, snapshot.wifiConnected]);

  const statusLabel = snapshot.wifiConnected ? 'Internet conectada' : 'Sem conexão';
  const pingValue = latencyMs === null ? '—' : `${latencyMs} ms`;

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title='Internet'
      onClose={requestClose}
    >
      {snapshot.wifiConnected ? (
        <>
          <div className='agent-cursor-usage__summary'>
            <span className='agent-cursor-usage__summary-percent titlebar-panel__network-name'>
              {networkLabel}
            </span>
            <span className='agent-cursor-usage__summary-plan'>{statusLabel}</span>
          </div>

          <ul className='agent-cursor-usage__list'>
            <li className='agent-cursor-usage__item'>
              <span className='agent-cursor-usage__item-label'>Rede</span>
              <span className='agent-cursor-usage__item-value'>{networkLabel}</span>
            </li>
            <li className='agent-cursor-usage__item'>
              <span className='agent-cursor-usage__item-label'>Status</span>
              <span className='agent-cursor-usage__item-value'>{statusLabel}</span>
            </li>
            <li className='agent-cursor-usage__item'>
              <span className='agent-cursor-usage__item-label'>Ping</span>
              <span className={`agent-cursor-usage__item-value${pingToneClass}`}>{pingValue}</span>
            </li>
          </ul>
        </>
      ) : (
        <EmptyState icon={WifiOff} message='Nenhuma internet conectada' compact />
      )}
    </TitleBarPopupShell>,
    document.body,
  );
}

export const TitleBarPingPopup = memo(TitleBarPingPopupComponent);
