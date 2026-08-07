import { useCallback, useEffect, type RefObject } from 'react';
import type { AutomationAgentMode } from '@/constants/agentModes';
import { cycleAgentMode } from '@/utils/cycleAgentMode';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import type { TerminalCommandHint } from '@/types';

interface UseAgentComposerShortcutsOptions {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isFocused: boolean;
  isVisible: boolean;
  isBusy: boolean;
  draft: string;
  hasPendingImages?: boolean;
  followUpCount?: number;
  activeMode: AutomationAgentMode;
  modelHints: TerminalCommandHint[];
  onSubmit: () => void;
  onForceSubmit: () => void;
  onFlushNextFollowUp?: () => boolean;
  onStop: () => void;
  onModeChange: (mode: AutomationAgentMode) => void;
  onRunModelCommand: (command: string) => void;
  mentionMenuOpen?: boolean;
}

export function useAgentComposerShortcuts({
  inputRef,
  isVisible,
  isBusy,
  draft,
  hasPendingImages = false,
  followUpCount = 0,
  activeMode,
  modelHints,
  onSubmit,
  onForceSubmit,
  onFlushNextFollowUp,
  onStop,
  onModeChange,
  onRunModelCommand,
  mentionMenuOpen = false,
}: UseAgentComposerShortcutsOptions) {
  const handleStopOrSubmit = useCallback(() => {
    const trimmed = draft.trim();

    if (trimmed || hasPendingImages) {
      onSubmit();
      return;
    }

    if (followUpCount > 0) {
      onFlushNextFollowUp?.();
      return;
    }

    if (isBusy) {
      onStop();
    }
  }, [
    draft,
    followUpCount,
    hasPendingImages,
    isBusy,
    onFlushNextFollowUp,
    onStop,
    onSubmit,
  ]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOverlayBlockingTerminalHints()) {
        return;
      }

      if (event.target !== inputRef.current) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;

      if (event.key === 'Tab' && event.shiftKey && !mentionMenuOpen) {
        event.preventDefault();
        event.stopPropagation();
        const nextMode = cycleAgentMode(activeMode);
        onModeChange(nextMode);
        return;
      }

      if (mod && event.shiftKey && event.key === 'Backspace') {
        if (isBusy) {
          event.preventDefault();
          onStop();
        }
        return;
      }

      if (mod && event.key === 'Enter') {
        event.preventDefault();
        onForceSubmit();
        return;
      }

      if (mod && (event.key === '/' || (event.altKey && event.key === '/'))) {
        event.preventDefault();

        if (modelHints.length === 0) {
          return;
        }

        const currentIndex = modelHints.findIndex((hint) => hint.command.includes(activeMode));
        const nextHint = modelHints[(currentIndex + 1) % modelHints.length];

        if (nextHint) {
          onRunModelCommand(nextHint.command);
        }
        return;
      }

      if (event.key === 'Escape' && mentionMenuOpen) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [
    activeMode,
    handleStopOrSubmit,
    inputRef,
    isBusy,
    isVisible,
    modelHints,
    onForceSubmit,
    onModeChange,
    mentionMenuOpen,
    onRunModelCommand,
    onStop,
  ]);

  return { handleStopOrSubmit };
}
