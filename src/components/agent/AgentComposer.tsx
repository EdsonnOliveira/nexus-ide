import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ArrowUp, Square, X } from 'lucide-react';
import {
  AGENT_MODE_INPUT_PLACEHOLDERS,
  getAgentModeOption,
} from '@/constants/agentModes';
import { AgentComposerModeChip } from '@/components/agent/AgentComposerModeChip';
import {
  AgentComposerModelSelect,
  AgentComposerPlusMenu,
  useAgentModelHints,
} from '@/components/agent/AgentHintBar';
import { AgentLiveStatus } from '@/components/agent/AgentLiveStatus';
import { AgentContextUsageIndicator } from '@/components/agent/AgentContextUsageIndicator';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { useAgentComposerShortcuts } from '@/hooks/useAgentComposerShortcuts';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import type { TerminalAgent } from '@/types';
import {
  attachAgentPromptImageToPane,
  readDroppedImageDataUrls,
  readImagePathAsDataUrl,
} from '@/utils/attachAgentPromptImage';
import { writeAgentPaneDraft } from '@/utils/agentPaneRegistry';
import type { AgentContextUsageSnapshot } from '@/utils/agentContextUsageParser';

interface AgentComposerProps {
  paneId: string;
  projectPath: string;
  terminalAgent: TerminalAgent;
  isVisible: boolean;
  isFocused: boolean;
  isBusy: boolean;
  isBootstrapping: boolean;
  isSubmitting: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  contextUsage: AgentContextUsageSnapshot | null;
  contextUsageLoading: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (draft: string) => boolean | Promise<boolean>;
  onStop: () => boolean;
  onRunCommand: (command: string) => boolean;
  onRequestContextUsageReport: () => void;
}

const EMPTY_PASTE_IMAGES: never[] = [];

function AgentComposerComponent({
  paneId,
  projectPath,
  terminalAgent,
  isVisible,
  isFocused,
  isBusy,
  isBootstrapping,
  isSubmitting,
  inputRef,
  draft,
  contextUsage,
  contextUsageLoading,
  onDraftChange,
  onSubmit,
  onStop,
  onRunCommand,
  onRequestContextUsageReport,
}: AgentComposerProps) {
  const agentConfig = TERMINAL_AGENTS[terminalAgent];
  const images = useTerminalPasteImageStore((state) => state.imagesByPane[paneId] ?? EMPTY_PASTE_IMAGES);
  const removeImage = useTerminalPasteImageStore((state) => state.removeImage);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const activeMode = useTerminalSessionStore(
    (state) => state.activeAgentModeByPane[paneId] ?? 'agent',
  );
  const activeModeOption = getAgentModeOption(activeMode);
  const modelHints = useAgentModelHints(paneId, projectPath, isVisible);

  const inputPlaceholder = useMemo(() => {
    if (activeMode !== 'agent') {
      return AGENT_MODE_INPUT_PLACEHOLDERS[activeMode];
    }

    return agentConfig.inputPlaceholder;
  }, [activeMode, agentConfig.inputPlaceholder]);

  const handleClearMode = useCallback(() => {
    onRunCommand('/agent\n');
    inputRef.current?.focus();
  }, [inputRef, onRunCommand]);

  const canStop = isBusy && !draft.trim();
  const hasDraft = Boolean(draft.trim()) || images.length > 0;
  const canSend = hasDraft && !canStop;
  const isActionDisabled = !canStop && !canSend;
  const waitingLabel = isSubmitting ? 'Enviando…' : 'Iniciando agent…';
  const showWaitingStatus = isSubmitting || isBootstrapping;
  const showContextUsage = Boolean(contextUsage) || contextUsageLoading || canStop;

  const handleSubmit = useCallback(() => {
    if (canStop) {
      onStop();
      return;
    }

    void (async () => {
      const result = await onSubmit(draft);

      if (result) {
        onDraftChange('');
      }
    })();
  }, [canStop, draft, onDraftChange, onStop, onSubmit]);

  const handleForceSubmit = useCallback(() => {
    void (async () => {
      const result = await onSubmit(draft);

      if (result) {
        onDraftChange('');
      }
    })();
  }, [draft, onDraftChange, onSubmit]);

  const handleModeChange = useCallback(
    (mode: typeof activeMode) => {
      onRunCommand(`/${mode}\n`);
    },
    [onRunCommand],
  );

  const { handleStopOrSubmit } = useAgentComposerShortcuts({
    inputRef,
    isFocused,
    isVisible,
    isBusy,
    draft,
    activeMode,
    modelHints,
    onSubmit: handleSubmit,
    onForceSubmit: handleForceSubmit,
    onStop: () => {
      onStop();
    },
    onModeChange: handleModeChange,
    onRunModelCommand: onRunCommand,
  });

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleStopOrSubmit();
      }
    },
    [handleStopOrSubmit],
  );

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onDraftChange(event.target.value);
    },
    [onDraftChange],
  );

  const handleAttach = useCallback(async () => {
    const sourcePath = await window.nexus.dialog.openImage();

    if (!sourcePath) {
      return;
    }

    const dataUrl = await readImagePathAsDataUrl(sourcePath);

    if (!dataUrl) {
      return;
    }

    await attachAgentPromptImageToPane(projectPath, paneId, dataUrl, false);
  }, [paneId, projectPath]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (!item.type.startsWith('image/')) {
          continue;
        }

        const file = item.getAsFile();

        if (!file) {
          continue;
        }

        event.preventDefault();
        void file.arrayBuffer().then(async (buffer) => {
          const blob = new Blob([buffer], { type: file.type });
          const reader = new FileReader();

          reader.onload = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : null;

            if (dataUrl) {
              void attachAgentPromptImageToPane(projectPath, paneId, dataUrl, false);
            }
          };

          reader.readAsDataURL(blob);
        });
        return;
      }
    },
    [paneId, projectPath],
  );

  const pendingImages = useMemo(
    () =>
      images.map((image) => (
        <div key={image.id} className='agent-view__paste-image'>
          <button
            type='button'
            className='agent-view__paste-image-thumb-btn app-button'
            onClick={() => setPreviewUrl(image.dataUrl)}
          >
            <img src={image.dataUrl} alt='' className='agent-view__paste-image-thumb' />
          </button>
          <button
            type='button'
            className='agent-view__paste-image-remove app-button app-button--enter'
            aria-label={`Remover ${image.label}`}
            onClick={() => removeImage(paneId, image.id)}
          >
            <X size={12} />
          </button>
        </div>
      )),
    [images, paneId, removeImage],
  );

  return (
    <>
      <div className='agent-view__composer'>
        <div className='agent-view__composer-card'>
          {pendingImages.length > 0 ? (
            <div className='agent-view__composer-attachments'>{pendingImages}</div>
          ) : null}
          <div className='agent-view__composer-input-row'>
            <textarea
              ref={inputRef}
              className='agent-view__composer-input'
              value={draft}
              rows={1}
              placeholder={inputPlaceholder}
              onChange={handleDraftChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>
          <div className='agent-view__composer-bar'>
            <div className='agent-view__composer-bar-left'>
              <AgentComposerPlusMenu
                paneId={paneId}
                cwd={projectPath}
                isVisible={isVisible}
                onRunCommand={onRunCommand}
                onAttachImage={() => void handleAttach()}
              />
              {activeMode !== 'agent' && activeModeOption ? (
                <AgentComposerModeChip
                  mode={activeMode}
                  option={activeModeOption}
                  onClear={handleClearMode}
                />
              ) : null}
              <AgentComposerModelSelect
                paneId={paneId}
                cwd={projectPath}
                isVisible={isVisible}
                onRunCommand={onRunCommand}
              />
              {showWaitingStatus ? (
                <AgentLiveStatus label={waitingLabel} />
              ) : null}
            </div>
            <div className='agent-view__composer-bar-actions'>
              <button
                type='button'
                className={`agent-view__composer-send app-button app-button--enter${canStop ? ' agent-view__composer-send--stop' : ''}${canSend || canStop ? ' agent-view__composer-send--ready' : ''}`}
                aria-label={canStop ? 'Parar agent' : 'Enviar prompt'}
                disabled={isActionDisabled}
                onClick={handleSubmit}
              >
                {canStop ? (
                  <Square size={13} strokeWidth={2.25} fill='currentColor' aria-hidden='true' />
                ) : (
                  <ArrowUp size={16} strokeWidth={2.25} aria-hidden='true' />
                )}
              </button>
              {showContextUsage ? (
                <AgentContextUsageIndicator
                  usage={contextUsage}
                  isLoading={contextUsageLoading}
                  visible={showContextUsage}
                  onRequestReport={onRequestContextUsageReport}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {previewUrl ? (
        <AnimatedModal panelClassName='project-dialog' onClose={() => setPreviewUrl(null)}>
          {() => <img src={previewUrl} alt='' className='agent-view__attachment-preview' />}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const AgentComposer = memo(AgentComposerComponent);

export async function handleAgentComposerDrop(
  projectPath: string,
  paneId: string,
  dataTransfer: DataTransfer,
): Promise<void> {
  const dataUrls = await readDroppedImageDataUrls(dataTransfer);

  for (const dataUrl of dataUrls) {
    await attachAgentPromptImageToPane(projectPath, paneId, dataUrl, false);
  }
}

export function appendAgentComposerDraft(paneId: string, text: string): void {
  writeAgentPaneDraft(paneId, text);
}
