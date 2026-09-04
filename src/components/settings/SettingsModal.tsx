import { Settings, Sparkles } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AI_PROVIDER_OPTIONS, type AiProviderId } from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { stopAgentNotificationSoundLoop } from '@/utils/agentNotificationSound';
import {
  stopCalendarEventAlertSound,
  stopCalendarEventUrgentSoundLoop,
} from '@/utils/calendarEventNotificationSound';

type SettingsTabId = 'geral' | 'ia';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModalComponent({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('geral');
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const setPreferredAiProvider = useAppSettingsStore((state) => state.setPreferredAiProvider);
  const notificationSoundEnabled = useAppSettingsStore((state) => state.notificationSoundEnabled);
  const setNotificationSoundEnabled = useAppSettingsStore(
    (state) => state.setNotificationSoundEnabled,
  );

  const providerOptions = useMemo(
    () =>
      AI_PROVIDER_OPTIONS.filter((option) => !option.disabled).map((option) => ({
        value: option.id,
        label: option.label,
      })),
    [],
  );

  const handleProviderChange = useCallback(
    (value: AiProviderId | '') => {
      if (value) {
        setPreferredAiProvider(value);
      }
    },
    [setPreferredAiProvider],
  );

  const handleNotificationSoundChange = useCallback(
    (enabled: boolean) => {
      setNotificationSoundEnabled(enabled);

      if (!enabled) {
        stopAgentNotificationSoundLoop();
        stopCalendarEventAlertSound();
        stopCalendarEventUrgentSoundLoop();
      }
    },
    [setNotificationSoundEnabled],
  );

  return (
    <AnimatedModal panelClassName='project-dialog settings-modal' onClose={onClose}>
      {(requestClose) => (
        <div className='settings-modal__content'>
          <div className='settings-modal__header'>
            <span className='project-dialog__title settings-modal__title'>Configurações</span>
          </div>

          <div className='settings-modal__tabs' role='tablist' aria-label='Seções de configurações'>
            <button
              type='button'
              role='tab'
              aria-selected={activeTab === 'geral'}
              className={`settings-modal__tab app-button app-button--enter${activeTab === 'geral' ? ' settings-modal__tab--active' : ''}`}
              onClick={() => setActiveTab('geral')}
            >
              <Settings size={13} />
              <span>Geral</span>
            </button>
            <button
              type='button'
              role='tab'
              aria-selected={activeTab === 'ia'}
              className={`settings-modal__tab app-button app-button--enter${activeTab === 'ia' ? ' settings-modal__tab--active' : ''}`}
              onClick={() => setActiveTab('ia')}
            >
              <Sparkles size={13} />
              <span>IA</span>
            </button>
          </div>

          <div className='settings-modal__body' role='tabpanel'>
            {activeTab === 'geral' ? (
              <div className='settings-modal__section'>
                <span className='settings-modal__section-label'>Ping</span>
                <p className='settings-modal__section-hint'>
                  Quando desativado, as notificações do Agent, Vercel, Render e similares ficam sem
                  som.
                </p>
                <div className='settings-modal__check'>
                  <AppCheckbox
                    checked={notificationSoundEnabled}
                    onChange={handleNotificationSoundChange}
                    aria-label='Emitir som de notificação'
                  />
                  <button
                    type='button'
                    className='settings-modal__check-label app-button'
                    onClick={() => handleNotificationSoundChange(!notificationSoundEnabled)}
                  >
                    Emitir som de notificação
                  </button>
                </div>
              </div>
            ) : null}

            {activeTab === 'ia' ? (
              <div className='settings-modal__section'>
                <span className='settings-modal__section-label'>Provedor do Agent</span>
                <p className='settings-modal__section-hint'>
                  Define qual IA será usada nas novas abas Agent.
                </p>
                <AnchoredSelect
                  value={preferredAiProvider}
                  options={providerOptions}
                  onChange={handleProviderChange}
                  triggerClassName='settings-modal__provider-select'
                />
              </div>
            ) : null}
          </div>

          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
              onClick={requestClose}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}

export const SettingsModal = memo(SettingsModalComponent);
