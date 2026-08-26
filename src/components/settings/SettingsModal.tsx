import { Sparkles } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AI_PROVIDER_OPTIONS, type AiProviderId } from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';

type SettingsTabId = 'ia';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModalComponent({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('ia');
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const setPreferredAiProvider = useAppSettingsStore((state) => state.setPreferredAiProvider);

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
              aria-selected={activeTab === 'ia'}
              className={`settings-modal__tab app-button app-button--enter${activeTab === 'ia' ? ' settings-modal__tab--active' : ''}`}
              onClick={() => setActiveTab('ia')}
            >
              <Sparkles size={13} />
              <span>IA</span>
            </button>
          </div>

          <div className='settings-modal__body' role='tabpanel'>
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
