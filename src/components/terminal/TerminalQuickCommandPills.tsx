import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Terminal, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTerminalQuickCommand } from '@/types';

const MAX_TERMINAL_QUICK_COMMANDS = 3;

interface TerminalQuickCommandPillsProps {
  projectId: string;
  onRunCommand: (command: string) => void;
}

function shortenCommandLabel(command: string): string {
  const trimmed = command.trim().replace(/\n$/, '');

  if (trimmed.length <= 28) {
    return trimmed;
  }

  return `${trimmed.slice(0, 27)}…`;
}

function ensureCommandNewline(command: string): string {
  const trimmed = command.trim().replace(/\n$/, '');

  return trimmed ? `${trimmed}\n` : '';
}

function TerminalQuickCommandPillsComponent({
  projectId,
  onRunCommand,
}: TerminalQuickCommandPillsProps) {
  const updateProject = useProjectStore((state) => state.updateProject);
  const configuredCommands = useProjectStore(
    (state) => state.projects.find((project) => project.id === projectId)?.terminalQuickCommands ?? [],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftCommand, setDraftCommand] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const canAddCommand = configuredCommands.length < MAX_TERMINAL_QUICK_COMMANDS;

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [dialogOpen]);

  const handleOpenDialog = useCallback(() => {
    if (!canAddCommand) {
      return;
    }

    setDraftCommand('');
    setDialogOpen(true);
  }, [canAddCommand]);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setDraftCommand('');
  }, []);

  const handleAddCommand = useCallback(
    (requestClose: () => void) => (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const command = ensureCommandNewline(draftCommand);

      if (!command || !canAddCommand) {
        return;
      }

      const nextCommand: ProjectTerminalQuickCommand = {
        id: crypto.randomUUID(),
        label: shortenCommandLabel(command),
        command,
      };

      void updateProject(projectId, {
        terminalQuickCommands: [...configuredCommands, nextCommand],
      });
      requestClose();
    },
    [canAddCommand, configuredCommands, draftCommand, projectId, updateProject],
  );

  const handleRemoveCommand = useCallback(
    (commandId: string) => {
      void updateProject(projectId, {
        terminalQuickCommands: configuredCommands.filter((entry) => entry.id !== commandId),
      });
    },
    [configuredCommands, projectId, updateProject],
  );

  const handleRunCommand = useCallback(
    (entry: ProjectTerminalQuickCommand) => {
      const command = ensureCommandNewline(entry.command);

      if (!command) {
        return;
      }

      onRunCommand(command);
    },
    [onRunCommand],
  );

  return (
    <>
      <div className='terminal-footer__quick-commands'>
        {configuredCommands.map((entry) => (
          <div key={entry.id} className='terminal-footer__quick-command-wrap'>
            <button
              type='button'
              className='terminal-footer__quick-command terminal-footer__quick-command--saved app-button app-button--enter'
              aria-label={`Executar comando ${entry.label}`}
              onClick={() => handleRunCommand(entry)}
            >
              <Terminal size={12} strokeWidth={2} aria-hidden='true' />
              <span className='terminal-footer__quick-command-label'>{entry.label}</span>
            </button>
            <button
              type='button'
              className='terminal-footer__quick-command-remove app-button app-button--enter'
              aria-label={`Remover comando ${entry.label}`}
              onClick={() => handleRemoveCommand(entry.id)}
            >
              <X size={10} strokeWidth={2} aria-hidden='true' />
            </button>
          </div>
        ))}
        {canAddCommand ? (
          <button
            type='button'
            className='terminal-footer__quick-command terminal-footer__quick-command--add app-button app-button--enter'
            aria-label='Adicionar comando'
            onClick={handleOpenDialog}
          >
            <Plus size={12} strokeWidth={2} aria-hidden='true' />
            <span className='terminal-footer__quick-command-label'>Comando</span>
          </button>
        ) : null}
      </div>
      {dialogOpen ? (
        <AnimatedModal panelClassName='project-dialog' onClose={handleCloseDialog}>
          {(requestClose) => (
            <form onSubmit={handleAddCommand(requestClose)}>
              <span className='project-dialog__title'>Adicionar comando</span>
              <label className='project-dialog__label'>
                Comando
                <input
                  ref={inputRef}
                  className='project-dialog__input'
                  value={draftCommand}
                  maxLength={200}
                  placeholder='ex.: npm run dev'
                  onChange={(event) => setDraftCommand(event.target.value)}
                />
              </label>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='submit'
                  className='project-dialog__btn project-dialog__btn--primary'
                  disabled={!draftCommand.trim()}
                >
                  Salvar
                </button>
              </div>
            </form>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const TerminalQuickCommandPills = memo(TerminalQuickCommandPillsComponent);
