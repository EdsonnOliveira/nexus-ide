import { useCallback, useState, type ReactNode } from 'react';
import { AgentPipDisplayPickerModal } from '@/components/home/AgentPipDisplayPickerModal';
import { useAgentPipStore } from '@/stores/useAgentPipStore';
import type { AgentPipDisplayInfo } from '@/types/agentPip';

interface UseAgentPipPinResult {
  isPinned: boolean;
  handleTogglePin: () => void;
  displayPicker: ReactNode;
}

export function useAgentPipPin(paneId: string): UseAgentPipPinResult {
  const pinnedPaneId = useAgentPipStore((state) => state.paneId);
  const pinAgent = useAgentPipStore((state) => state.pin);
  const unpinAgent = useAgentPipStore((state) => state.unpin);
  const isPinned = pinnedPaneId === paneId;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [displays, setDisplays] = useState<AgentPipDisplayInfo[]>([]);

  const handleClosePicker = useCallback(() => {
    setPickerOpen(false);
    setDisplays([]);
  }, []);

  const handleSelectDisplay = useCallback(
    (displayId: number) => {
      pinAgent(paneId, displayId);
      setPickerOpen(false);
      setDisplays([]);
    },
    [paneId, pinAgent],
  );

  const handleTogglePin = useCallback(() => {
    if (isPinned) {
      unpinAgent();
      return;
    }

    void (async () => {
      const nextDisplays = (await window.nexus.agentPip.listDisplays()) ?? [];

      if (nextDisplays.length <= 1) {
        pinAgent(paneId, nextDisplays[0]?.id ?? 0);
        return;
      }

      setDisplays(nextDisplays);
      setPickerOpen(true);
    })();
  }, [isPinned, paneId, pinAgent, unpinAgent]);

  const displayPicker = pickerOpen ? (
    <AgentPipDisplayPickerModal
      displays={displays}
      onClose={handleClosePicker}
      onSelect={handleSelectDisplay}
    />
  ) : null;

  return {
    isPinned,
    handleTogglePin,
    displayPicker,
  };
}
