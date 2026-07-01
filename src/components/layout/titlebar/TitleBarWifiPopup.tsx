import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, Wifi } from 'lucide-react';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { WifiNetworkItem } from '@/types';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';

interface TitleBarWifiPopupProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRefresh: () => void;
}

function TitleBarWifiPopupComponent({
  anchorRect,
  anchorRef,
  onClose,
  onRefresh,
}: TitleBarWifiPopupProps) {
  const [wifiEnabled, setWifiEnabled] = useState(true);
  const [networks, setNetworks] = useState<WifiNetworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningNetworks, setScanningNetworks] = useState(false);
  const [connectingSsid, setConnectingSsid] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [passwordSsid, setPasswordSsid] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectedSsid, setConnectedSsid] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const loadWifiState = useCallback(async () => {
    setLoading(true);
    setScanningNetworks(false);
    setError(null);

    try {
      const state = await window.nexus.systemStatus.getWifiPopupState();

      setWifiEnabled(state.wifiEnabled);
      setConnectedSsid(state.connectedNetwork);
      setNetworks(state.networks);
    } catch {
      setError('Não foi possível carregar as redes Wi-Fi.');
    } finally {
      setLoading(false);
      setScanningNetworks(false);
    }
  }, []);

  useEffect(() => {
    void loadWifiState();
  }, [loadWifiState]);

  const handleConnect = useCallback(
    async (ssid: string, password?: string) => {
      setConnectingSsid(ssid);
      setError(null);

      try {
        const result = await window.nexus.systemStatus.connectWifiNetwork(ssid, password);

        if (result.ok) {
          setPasswordSsid(null);
          setPasswordValue('');
          onRefresh();
          await loadWifiState();
          return;
        }

        if (result.needsPassword) {
          setPasswordSsid(ssid);
          setPasswordValue('');
          setError(result.error ?? 'Informe a senha da rede.');
          return;
        }

        setError(result.error ?? 'Não foi possível conectar.');
      } finally {
        setConnectingSsid(null);
      }
    },
    [loadWifiState, onRefresh],
  );

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    setError(null);

    try {
      const ok = await window.nexus.systemStatus.disconnectWifiNetwork();

      if (!ok) {
        setError('Não foi possível desconectar.');
        return;
      }

      onRefresh();
      await loadWifiState();
    } finally {
      setDisconnecting(false);
    }
  }, [loadWifiState, onRefresh]);

  const handleSelectNetwork = useCallback(
    (network: WifiNetworkItem) => {
      if (connectingSsid || disconnecting) {
        return;
      }

      if (network.connected) {
        void handleDisconnect();
        return;
      }

      void handleConnect(network.ssid);
    },
    [connectingSsid, disconnecting, handleConnect, handleDisconnect],
  );

  const handleSubmitPassword = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!passwordSsid) {
        return;
      }

      void handleConnect(passwordSsid, passwordValue);
    },
    [handleConnect, passwordSsid, passwordValue],
  );

  const availableNetworks = useMemo(
    () => networks.filter((network) => network.ssid !== connectedSsid),
    [connectedSsid, networks],
  );

  const isBusy = Boolean(connectingSsid) || disconnecting;

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title='Wi-Fi'
      onClose={requestClose}
      actions={
        <button
          type='button'
          className='agent-cursor-usage__action app-button app-button--enter'
          onClick={() => {
            void loadWifiState();
          }}
        >
          Atualizar
        </button>
      }
    >
      {loading ? (
        <p className='agent-cursor-usage__period'>Carregando...</p>
      ) : !wifiEnabled ? (
        <p className='agent-cursor-usage__period'>Wi-Fi desligado no sistema.</p>
      ) : (
        <div className='titlebar-panel__select-list'>
          {connectedSsid ? (
            <>
              <p className='titlebar-panel__section-label'>Conectada</p>
              <button
                type='button'
                className='titlebar-panel__select-item titlebar-panel__select-item--output titlebar-panel__select-item--active app-button app-button--enter'
                disabled={isBusy}
                aria-label={`Desconectar de ${connectedSsid}`}
                onClick={() => {
                  void handleDisconnect();
                }}
              >
                <span className='titlebar-panel__output-item'>
                  <span className='titlebar-panel__output-icon titlebar-panel__output-icon--wifi' aria-hidden='true'>
                    <Wifi size={14} />
                  </span>
                  <span className='titlebar-panel__output-name'>{connectedSsid}</span>
                </span>
                <Check size={13} aria-hidden='true' />
              </button>
            </>
          ) : null}

          {scanningNetworks ? (
            <p className='agent-cursor-usage__period'>Buscando redes...</p>
          ) : availableNetworks.length > 0 ? (
            <>
              <p className='titlebar-panel__section-label'>Redes</p>
              {availableNetworks.map((network) => (
                <button
                  key={network.ssid}
                  type='button'
                  className='titlebar-panel__select-item titlebar-panel__select-item--output app-button app-button--enter'
                  disabled={isBusy}
                  onClick={() => handleSelectNetwork(network)}
                >
                  <span className='titlebar-panel__output-item'>
                    <span className='titlebar-panel__output-icon titlebar-panel__output-icon--wifi' aria-hidden='true'>
                      <Wifi size={14} />
                    </span>
                    <span className='titlebar-panel__output-name'>{network.ssid}</span>
                  </span>
                  {network.secured ? <Lock size={12} aria-hidden='true' /> : null}
                </button>
              ))}
            </>
          ) : !connectedSsid ? (
            <p className='agent-cursor-usage__period'>Nenhuma rede encontrada.</p>
          ) : null}
        </div>
      )}

      {passwordSsid ? (
        <form className='titlebar-panel__password-form' onSubmit={handleSubmitPassword}>
          <label className='titlebar-panel__password-field'>
            <span className='agent-cursor-usage__item-label'>Senha de {passwordSsid}</span>
            <input
              type='password'
              className='titlebar-panel__password-input'
              value={passwordValue}
              autoComplete='off'
              onChange={(event) => setPasswordValue(event.target.value)}
            />
          </label>
          <button
            type='submit'
            className='agent-cursor-usage__action app-button app-button--enter'
            disabled={!passwordValue.trim() || isBusy}
          >
            Conectar
          </button>
        </form>
      ) : null}

      {error ? <p className='titlebar-panel__error'>{error}</p> : null}
    </TitleBarPopupShell>,
    document.body,
  );
}

export const TitleBarWifiPopup = memo(TitleBarWifiPopupComponent);
