import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Terminal, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTerminalQuickCommand } from '@/types';

const MAX_TERMINAL_QUICK_COMMANDS = 3;

interface TerminalQuickCommandPillsProps {
  projectId: string;
  onRunCommand: (command: string) => void;
}

function normalizeQuickCommand(command: string): string {
  return command.trim().replace(/\n$/, '');
}

function shortenCommandLabel(command: string): string {
  const trimmed = normalizeQuickCommand(command);

  if (trimmed.length <= 28) {
    return trimmed;
  }

  return `${trimmed.slice(0, 27)}…`;
}

function ensureCommandNewline(command: string): string {
  const trimmed = normalizeQuickCommand(command);

  return trimmed ? `${trimmed}\n` : '';
}

function TerminalQuickCommandPillsComponent({
  projectId,
  onRunCommand,
}: TerminalQuickCommandPillsProps) {
  const updateProject = useProjectStore((state) => state.updateProject);
  const projects = useProjectStore((state) => state.projects);
  const configuredCommands = useMemo(
    () => projects.find((project) => project.id === projectId)?.terminalQuickCommands ?? [],
    [projectId, projects],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftCommand, setDraftCommand] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const canAddCommand = configuredCommands.length < MAX_TERMINAL_QUICK_COMMANDS;

  const configuredCommandKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const entry of configuredCommands) {
      const normalized = normalizeQuickCommand(entry.command);

      if (normalized) {
        keys.add(normalized);
      }
    }

    return keys;
  }, [configuredCommands]);

  const suggestedCommands = useMemo(() => {
    const seen = new Set(configuredCommandKeys);
    const suggestions: string[] = [];

    for (const project of projects) {
      if (project.id === projectId) {
        continue;
      }

      for (const entry of project.terminalQuickCommands ?? []) {
        const normalized = normalizeQuickCommand(entry.command);

        if (!normalized || seen.has(normalized)) {
          continue;
        }

        seen.add(normalized);
        suggestions.push(normalized);
      }
    }

    return suggestions.sort((left, right) => left.localeCompare(right));
  }, [configuredCommandKeys, projectId, projects]);

  const filteredSuggestedCommands = useMemo(() => {
    const query = normalizeQuickCommand(draftCommand).toLowerCase();

    if (!query) {
      return suggestedCommands;
    }

    return suggestedCommands.filter((command) => command.toLowerCase().includes(query));
  }, [draftCommand, suggestedCommands]);

  const draftAlreadyConfigured = configuredCommandKeys.has(normalizeQuickCommand(draftCommand));
  const canSaveCommand = Boolean(normalizeQuickCommand(draftCommand)) && !draftAlreadyConfigured;

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
      const normalized = normalizeQuickCommand(command);

      if (!command || !canAddCommand || configuredCommandKeys.has(normalized)) {
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
    [
      canAddCommand,
      configuredCommandKeys,
      configuredCommands,
      draftCommand,
      projectId,
      updateProject,
    ],
  );

  const handleSelectSuggestedCommand = useCallback((command: string) => {
    setDraftCommand(command);
    inputRef.current?.focus();
  }, []);

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
              {suggestedCommands.length > 0 ? (
                <div className='project-dialog__presets'>
                  <span className='project-dialog__presets-label'>De outros projetos</span>
                  {filteredSuggestedCommands.length > 0 ? (
                    <div
                      className='project-dialog__presets-list'
                      role='listbox'
                      aria-label='Comandos de outros projetos'
                    >
                      {filteredSuggestedCommands.map((command) => {
                        const isActive = normalizeQuickCommand(draftCommand) === command;

                        return (
                          <button
                            key={command}
                            type='button'
                            role='option'
                            aria-selected={isActive}
                            className={`project-dialog__preset-command app-button app-button--enter${isActive ? ' project-dialog__preset-command--active' : ''}`}
                            title={command}
                            onClick={() => handleSelectSuggestedCommand(command)}
                          >
                            <Terminal size={13} strokeWidth={2} aria-hidden='true' />
                            <span>{command}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className='project-dialog__presets-empty'>Nenhum comando correspondente</span>
                  )}
                </div>
              ) : null}
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
                  disabled={!canSaveCommand}
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
