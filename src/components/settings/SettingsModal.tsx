import { Check, Sparkles } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  AI_PROVIDER_OPTIONS,
  type AiProviderId,
} from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';

type SettingsTabId = 'ia';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModalComponent({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('ia');
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const setPreferredAiProvider = useAppSettingsStore((state) => state.setPreferredAiProvider);

  const handleSelectProvider = useCallback(
    (provider: AiProviderId) => () => {
      setPreferredAiProvider(provider);
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
                <div className='settings-modal__provider-list' role='radiogroup' aria-label='Provedor de IA'>
                  {AI_PROVIDER_OPTIONS.map((option) => {
                    const isSelected = preferredAiProvider === option.id;

                    return (
                      <button
                        key={option.id}
                        type='button'
                        role='radio'
                        aria-checked={isSelected}
                        disabled={option.disabled}
                        className={`settings-modal__provider app-button app-button--enter${isSelected ? ' settings-modal__provider--active' : ''}${option.disabled ? ' settings-modal__provider--disabled' : ''}`}
                        onClick={handleSelectProvider(option.id)}
                      >
                        <span className='settings-modal__provider-copy'>
                          <span className='settings-modal__provider-label'>{option.label}</span>
                          {option.subtitle ? (
                            <span className='settings-modal__provider-subtitle'>{option.subtitle}</span>
                          ) : null}
                        </span>
                        {isSelected ? (
                          <Check
                            size={14}
                            strokeWidth={2}
                            className='settings-modal__provider-check'
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
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
