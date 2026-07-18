import { Bell } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { AppCheckbox } from '../components/AppCheckbox';
import { useWebStore } from '../store';
import {
  disableWebPush,
  enableWebPush,
  getCurrentPushSubscription,
  getPushPermissionState,
  isIosDevice,
  isStandaloneDisplay,
  isWebPushSupported,
  loadPushPreferences,
  savePushPreferences,
} from './webPush';

interface WebPushModalProps {
  open: boolean;
  onClose: () => void;
}

function WebPushModalComponent({ open, onClose }: WebPushModalProps) {
  const session = useWebStore((state) => state.session);
  const userId = session?.user?.id ?? null;
  const [enabled, setEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [deployEnabled, setDeployEnabled] = useState(true);
  const [deviceEnabled, setDeviceEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'default',
  );

  const needsHomeScreen = isIosDevice() && !isStandaloneDisplay();

  useEffect(() => {
    if (!open || !userId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [permissionState, subscription, preferences] = await Promise.all([
          getPushPermissionState(),
          getCurrentPushSubscription(),
          loadPushPreferences(userId),
        ]);
        if (cancelled) {
          return;
        }
        setPermission(permissionState);
        setEnabled(Boolean(subscription) && permissionState === 'granted');
        setAgentEnabled(preferences.agent_enabled);
        setDeployEnabled(preferences.deploy_enabled);
        setDeviceEnabled(preferences.device_enabled);
        setError(null);
      } catch {
        if (!cancelled) {
          setError('Não foi possível carregar as preferências');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const persistPreferences = useCallback(
    async (next: {
      agent_enabled: boolean;
      deploy_enabled: boolean;
      device_enabled: boolean;
    }) => {
      if (!userId) {
        return;
      }
      await savePushPreferences(userId, next);
    },
    [userId],
  );

  const handleToggleEnabled = useCallback(async () => {
    if (!userId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await disableWebPush(userId);
        setEnabled(false);
      } else {
        await enableWebPush(userId);
        setEnabled(true);
        setPermission('granted');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar notificações');
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, userId]);

  const handlePreferenceChange = useCallback(
    async (
      key: 'agent_enabled' | 'deploy_enabled' | 'device_enabled',
      value: boolean,
    ) => {
      const next = {
        agent_enabled: key === 'agent_enabled' ? value : agentEnabled,
        deploy_enabled: key === 'deploy_enabled' ? value : deployEnabled,
        device_enabled: key === 'device_enabled' ? value : deviceEnabled,
      };
      if (key === 'agent_enabled') {
        setAgentEnabled(value);
      }
      if (key === 'deploy_enabled') {
        setDeployEnabled(value);
      }
      if (key === 'device_enabled') {
        setDeviceEnabled(value);
      }
      try {
        await persistPreferences(next);
      } catch {
        setError('Não foi possível salvar preferências');
      }
    },
    [agentEnabled, deployEnabled, deviceEnabled, persistPreferences],
  );

  if (!open) {
    return null;
  }

  return (
    <div className='web-modal web-modal--viewport app-button--enter' role='presentation' onClick={onClose}>
      <div
        className='web-modal__card web-push-modal app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-label='Notificações'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='web-vercel-token-modal__header'>
          <span className='web-vercel-token-modal__badge' aria-hidden='true'>
            <Bell size={16} />
          </span>
          <div className='stack'>
            <strong>Notificações</strong>
            <span className='muted'>
              Receba avisos de agent, deploy e Mac mesmo com o app fechado.
            </span>
          </div>
        </div>

        {!isWebPushSupported() ? (
          <p className='web-vercel-token-modal__error'>
            Este navegador não suporta notificações push.
          </p>
        ) : null}

        {needsHomeScreen ? (
          <p className='web-push-modal__hint'>
            No iPhone: toque em Compartilhar → Adicionar à Tela de Início e abra o Nexus por esse
            ícone para ativar o push.
          </p>
        ) : null}

        <div className='web-push-modal__row'>
          <div className='stack'>
            <strong>Ativar push</strong>
            <span className='muted'>
              {enabled
                ? 'Ativo neste dispositivo'
                : permission === 'denied'
                  ? 'Permissão bloqueada no navegador'
                  : 'Desativado'}
            </span>
          </div>
          <button
            type='button'
            className='app-button web-vercel-token-modal__primary'
            disabled={busy || !isWebPushSupported() || (needsHomeScreen && !enabled)}
            onClick={() => void handleToggleEnabled()}
          >
            {busy ? 'Aguarde...' : enabled ? 'Desativar' : 'Ativar'}
          </button>
        </div>

        <div className='web-push-modal__prefs'>
          <label className='web-push-modal__pref'>
            <AppCheckbox
              checked={agentEnabled}
              disabled={!enabled || busy}
              aria-label='Notificar agent'
              onChange={(checked) => void handlePreferenceChange('agent_enabled', checked)}
            />
            <span>Agent concluiu, falhou ou pede resposta</span>
          </label>
          <label className='web-push-modal__pref'>
            <AppCheckbox
              checked={deployEnabled}
              disabled={!enabled || busy}
              aria-label='Notificar deploy'
              onChange={(checked) => void handlePreferenceChange('deploy_enabled', checked)}
            />
            <span>Deploy pronto ou com erro</span>
          </label>
          <label className='web-push-modal__pref'>
            <AppCheckbox
              checked={deviceEnabled}
              disabled={!enabled || busy}
              aria-label='Notificar Mac offline'
              onChange={(checked) => void handlePreferenceChange('device_enabled', checked)}
            />
            <span>Mac offline</span>
          </label>
        </div>

        {error ? <p className='web-vercel-token-modal__error'>{error}</p> : null}

        <div className='web-vercel-token-modal__actions'>
          <button
            type='button'
            className='app-button web-vercel-token-modal__secondary'
            disabled={busy}
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export const WebPushModal = memo(WebPushModalComponent);
