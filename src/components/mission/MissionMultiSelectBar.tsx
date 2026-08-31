import { memo, useCallback, useState } from 'react';
import { MessageSquare, Pause, X } from 'lucide-react';
import { useMissionStore } from '@/stores/useMissionStore';
import { askSelectedMaestroAgents } from '@/utils/missionContextActions';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

function MissionMultiSelectBarComponent() {
  const selectedPaneIds = useMissionStore((state) => state.selectedPaneIds);
  const clearSelectedPaneIds = useMissionStore((state) => state.clearSelectedPaneIds);
  const [askOpen, setAskOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const handleAsk = useCallback(async () => {
    if (!prompt.trim() || busy) {
      return;
    }
    setBusy(true);
    await askSelectedMaestroAgents(prompt);
    setBusy(false);
    setAskOpen(false);
    setPrompt('');
  }, [busy, prompt]);

  const handlePauseSelected = useCallback(() => {
    for (const paneId of selectedPaneIds) {
      window.nexus?.agentPrint?.stop(paneId);
      useTerminalSessionStore.getState().setAgentBusy(paneId, false);
    }
  }, [selectedPaneIds]);

  if (selectedPaneIds.length < 2) {
    return null;
  }

  return (
    <div className='mission-multiselect-bar app-button--enter'>
      <span>{selectedPaneIds.length} agents selecionados</span>
      <button
        type='button'
        className='project-dialog__btn app-button'
        onClick={() => setAskOpen((current) => !current)}
      >
        <MessageSquare size={13} /> Perguntar
      </button>
      <button type='button' className='project-dialog__btn app-button' onClick={handlePauseSelected}>
        <Pause size={13} /> Pausar
      </button>
      <button
        type='button'
        className='project-dialog__btn app-button'
        onClick={clearSelectedPaneIds}
      >
        <X size={13} /> Limpar
      </button>
      {askOpen ? (
        <div className='mission-multiselect-bar__ask'>
          <input
            className='project-dialog__input'
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder='Pergunta para todos os selecionados...'
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAsk();
              }
            }}
          />
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--primary app-button'
            disabled={busy || !prompt.trim()}
            onClick={() => {
              void handleAsk();
            }}
          >
            Enviar
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const MissionMultiSelectBar = memo(MissionMultiSelectBarComponent);
