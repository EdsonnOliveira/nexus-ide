import { Settings, Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import logoAntigravity from '@/assets/logo-antigravity.svg';
import logoClaude from '@/assets/logo-claude.svg';
import logoCodex from '@/assets/logo-codex.svg';
import logoCursor from '@/assets/logo-cursor.svg';
import logoOpencode from '@/assets/logo-opencode.svg';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AppRadio } from '@/components/overlay/AppRadio';
import { OpenCodeSetupSection } from '@/components/settings/OpenCodeSetupSection';
import {
  AI_PROVIDER_OPTIONS,
  type AiProviderId,
  type SelectableAiProviderId,
} from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { useToastStore } from '@/stores/useToastStore';
import {
  playAgentNotificationSound,
  stopAgentNotificationSoundLoop,
} from '@/utils/agentNotificationSound';
import {
  stopCalendarEventAlertSound,
  stopCalendarEventUrgentSoundLoop,
} from '@/utils/calendarEventNotificationSound';
import type { CliSetupStatus } from '@/types';

type SettingsTabId = 'geral' | 'ia';

const AI_PROVIDER_LOGOS: Record<SelectableAiProviderId, string> = {
  cursor: logoCursor,
  claude: logoClaude,
  codex: logoCodex,
  opencode: logoOpencode,
  antigravity: logoAntigravity,
};

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModalComponent({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('geral');
  const [cliStatus, setCliStatus] = useState<CliSetupStatus | null>(null);
  const [installingOpenCode, setInstallingOpenCode] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const enabledAiProviders = useAppSettingsStore((state) => state.enabledAiProviders);
  const noAttachmentAiProvider = useAppSettingsStore((state) => state.noAttachmentAiProvider);
  const setPreferredAiProvider = useAppSettingsStore((state) => state.setPreferredAiProvider);
  const setEnabledAiProvider = useAppSettingsStore((state) => state.setEnabledAiProvider);
  const setNoAttachmentAiProvider = useAppSettingsStore((state) => state.setNoAttachmentAiProvider);
  const notificationSoundEnabled = useAppSettingsStore((state) => state.notificationSoundEnabled);
  const setNotificationSoundEnabled = useAppSettingsStore(
    (state) => state.setNotificationSoundEnabled,
  );
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    if (!window.nexus?.cliSetup) {
      return;
    }

    let cancelled = false;

    void window.nexus.cliSetup
      .getStatus()
      .then((nextStatus) => {
        if (!cancelled) {
          setCliStatus(nextStatus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCliStatus({
            opencodeInstalled: false,
            pendingInstall: false,
            shouldOfferSetup: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectableProviders = useMemo(
    () => AI_PROVIDER_OPTIONS.filter((option) => !option.disabled),
    [],
  );

  const providerOptions = useMemo(
    () =>
      selectableProviders
        .filter((option) => enabledAiProviders.includes(option.id as SelectableAiProviderId))
        .map((option) => ({
          value: option.id,
          label: option.label,
        })),
    [enabledAiProviders, selectableProviders],
  );

  const handleProviderChange = useCallback(
    (value: AiProviderId | '') => {
      if (value) {
        setPreferredAiProvider(value);
      }
    },
    [setPreferredAiProvider],
  );

  const handleEnabledProviderChange = useCallback(
    (provider: SelectableAiProviderId, enabled: boolean) => {
      setEnabledAiProvider(provider, enabled);
    },
    [setEnabledAiProvider],
  );

  const handleNoAttachmentProviderChange = useCallback(
    (provider: SelectableAiProviderId | null) => {
      setNoAttachmentAiProvider(provider);
    },
    [setNoAttachmentAiProvider],
  );

  const handleNotificationSoundChange = useCallback(
    (enabled: boolean) => {
      setNotificationSoundEnabled(enabled);

      if (enabled) {
        playAgentNotificationSound();
        return;
      }

      stopAgentNotificationSoundLoop();
      stopCalendarEventAlertSound();
      stopCalendarEventUrgentSoundLoop();
    },
    [setNotificationSoundEnabled],
  );

  const handleInstallOpenCode = useCallback(async () => {
    if (!window.nexus?.cliSetup || installingOpenCode) {
      return;
    }

    setInstallingOpenCode(true);
    setInstallError(null);

    try {
      const result = await window.nexus.cliSetup.installOpenCode();

      if (!result.ok) {
        setInstallError(result.error);
        return;
      }

      setCliStatus({
        opencodeInstalled: true,
        pendingInstall: false,
        shouldOfferSetup: false,
      });
      showToast(result.alreadyInstalled ? 'OpenCode já estava instalado' : 'OpenCode instalado');
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : 'Não foi possível baixar o OpenCode',
      );
    } finally {
      setInstallingOpenCode(false);
    }
  }, [installingOpenCode, showToast]);

  return (
    <AnimatedModal
      panelClassName='project-dialog settings-modal settings-modal--setup'
      onClose={onClose}
    >
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
              <>
                <div className='settings-modal__section'>
                  <span className='settings-modal__section-label'>IAs nos Agents</span>
                  <p className='settings-modal__section-hint'>
                    Marque as IAs que aparecem nos agents. Para ver as outras, habilite aqui.
                  </p>
                  <div className='settings-modal__ai-toggles'>
                    {selectableProviders.map((option) => {
                      const providerId = option.id as SelectableAiProviderId;
                      const enabled = enabledAiProviders.includes(providerId);
                      const locked = enabled && enabledAiProviders.length === 1;

                      return (
                        <div key={option.id} className='settings-modal__check'>
                          <AppCheckbox
                            checked={enabled}
                            disabled={locked}
                            aria-label={
                              enabled
                                ? `Ocultar ${option.label} nos agents`
                                : `Mostrar ${option.label} nos agents`
                            }
                            onChange={(checked) => handleEnabledProviderChange(providerId, checked)}
                          />
                          <button
                            type='button'
                            className='settings-modal__check-label settings-modal__ai-toggle-label app-button'
                            disabled={locked}
                            onClick={() => handleEnabledProviderChange(providerId, !enabled)}
                          >
                            <img src={AI_PROVIDER_LOGOS[providerId]} alt='' draggable={false} />
                            <span>{option.label}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className='settings-modal__section'>
                  <span className='settings-modal__section-label'>Padrão nas novas abas</span>
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
                <div className='settings-modal__section'>
                  <span className='settings-modal__section-label'>Sem anexo</span>
                  <p className='settings-modal__section-hint'>
                    Sem anexo, muda para esta IA. Com anexo, fica na IA padrão.
                  </p>
                  <div
                    className='settings-modal__ai-toggles'
                    role='radiogroup'
                    aria-label='IA sem anexo'
                  >
                    <div className='settings-modal__check'>
                      <AppRadio
                        checked={noAttachmentAiProvider === null}
                        aria-label='Não mudar de IA sem anexo'
                        onChange={() => handleNoAttachmentProviderChange(null)}
                      />
                      <button
                        type='button'
                        className='settings-modal__check-label settings-modal__ai-toggle-label app-button'
                        onClick={() => handleNoAttachmentProviderChange(null)}
                      >
                        <span>Nenhuma</span>
                      </button>
                    </div>
                    {selectableProviders.map((option) => {
                      const providerId = option.id as SelectableAiProviderId;

                      return (
                        <div key={option.id} className='settings-modal__check'>
                          <AppRadio
                            checked={noAttachmentAiProvider === providerId}
                            aria-label={`Mudar para ${option.label} quando não tiver anexo`}
                            onChange={() => handleNoAttachmentProviderChange(providerId)}
                          />
                          <button
                            type='button'
                            className='settings-modal__check-label settings-modal__ai-toggle-label app-button'
                            onClick={() => handleNoAttachmentProviderChange(providerId)}
                          >
                            <img src={AI_PROVIDER_LOGOS[providerId]} alt='' draggable={false} />
                            <span>{option.label}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <OpenCodeSetupSection
                  status={cliStatus}
                  installing={installingOpenCode}
                  error={installError}
                  onInstall={() => {
                    void handleInstallOpenCode();
                  }}
                />
              </>
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
