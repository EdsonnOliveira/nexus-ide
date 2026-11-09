import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Terminal, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTerminalQuickCommand } from '@/types';

const MAX_TERMINAL_QUICK_COMMANDS = 3;
const MAX_TERMINAL_QUICK_COMMAND_NAME = 48;

interface TerminalQuickCommandPillsProps {
  projectId: string;
  onRunCommand: (command: string) => void;
}

interface SuggestedQuickCommand {
  command: string;
  name: string | null;
}

interface QuickCommandContextMenuState {
  commandId: string;
  x: number;
  y: number;
}

export interface QuickCommandContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete?: () => void;
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

function suggestionLabel(suggestion: SuggestedQuickCommand): string {
  return suggestion.name ?? suggestion.command;
}

function buildQuickCommandEntry(
  id: string,
  draftCommand: string,
  draftName: string,
): ProjectTerminalQuickCommand | null {
  const command = ensureCommandNewline(draftCommand);
  const normalized = normalizeQuickCommand(command);
  const name = normalizeQuickCommand(draftName);

  if (!normalized) {
    return null;
  }

  return {
    id,
    label: name || shortenCommandLabel(command),
    command,
    ...(name ? { name } : {}),
  };
}

export function QuickCommandContextMenu({
  x,
  y,
  onClose,
  onEdit,
  onDelete,
}: QuickCommandContextMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, requestClose]);

  const runAction = useCallback(
    (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
      requestClose();
    },
    [requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type='button'
        className='context-menu__item'
        role='menuitem'
        onMouseDown={runAction(onEdit)}
      >
        <Pencil size={14} strokeWidth={2} aria-hidden />
        <span>Editar</span>
      </button>
      {onDelete ? (
        <>
          <div className='context-menu__separator' />
          <button
            type='button'
            className='context-menu__item context-menu__item--danger'
            role='menuitem'
            onMouseDown={runAction(onDelete)}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden />
            <span>Excluir</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function TerminalQuickCommandPillsComponent({
  projectId,
  onRunCommand,
}: TerminalQuickCommandPillsProps) {
  const updateProject = useProjectStore((state) => state.updateProject);
  const projects = useProjectStore((state) => state.projects);
  const projectExists = useMemo(
    () => projects.some((project) => project.id === projectId),
    [projectId, projects],
  );
  const configuredCommands = useMemo(
    () => projects.find((project) => project.id === projectId)?.terminalQuickCommands ?? [],
    [projectId, projects],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftCommand, setDraftCommand] = useState('');
  const [draftName, setDraftName] = useState('');
  const [contextMenu, setContextMenu] = useState<QuickCommandContextMenuState | null>(null);
  const [editCommandId, setEditCommandId] = useState<string | null>(null);
  const [editDraftCommand, setEditDraftCommand] = useState('');
  const [editDraftName, setEditDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editCommandInputRef = useRef<HTMLInputElement>(null);
  const editCommand = useMemo(
    () => configuredCommands.find((entry) => entry.id === editCommandId) ?? null,
    [configuredCommands, editCommandId],
  );

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
    const byCommand = new Map<string, SuggestedQuickCommand>();

    for (const project of projects) {
      if (project.id === projectId) {
        continue;
      }

      for (const entry of project.terminalQuickCommands ?? []) {
        const normalized = normalizeQuickCommand(entry.command);

        if (!normalized || configuredCommandKeys.has(normalized)) {
          continue;
        }

        const name = normalizeQuickCommand(entry.name ?? '') || null;
        const existing = byCommand.get(normalized);

        if (!existing || (!existing.name && name)) {
          byCommand.set(normalized, { command: normalized, name });
        }
      }
    }

    return [...byCommand.values()].sort((left, right) =>
      suggestionLabel(left).localeCompare(suggestionLabel(right)),
    );
  }, [configuredCommandKeys, projectId, projects]);

  const filteredSuggestedCommands = useMemo(() => {
    const commandQuery = normalizeQuickCommand(draftCommand).toLowerCase();
    const nameQuery = normalizeQuickCommand(draftName).toLowerCase();

    if (!commandQuery && !nameQuery) {
      return suggestedCommands;
    }

    return suggestedCommands.filter((suggestion) => {
      const command = suggestion.command.toLowerCase();
      const label = suggestionLabel(suggestion).toLowerCase();
      const matchesCommand =
        !commandQuery || command.includes(commandQuery) || label.includes(commandQuery);
      const matchesName = !nameQuery || label.includes(nameQuery) || command.includes(nameQuery);

      return matchesCommand && matchesName;
    });
  }, [draftCommand, draftName, suggestedCommands]);

  const draftAlreadyConfigured = configuredCommandKeys.has(normalizeQuickCommand(draftCommand));
  const canSaveCommand = Boolean(normalizeQuickCommand(draftCommand)) && !draftAlreadyConfigured;

  const editOriginalCommand = editCommand ? normalizeQuickCommand(editCommand.command) : '';
  const editNormalizedCommand = normalizeQuickCommand(editDraftCommand);
  const editCommandTaken =
    Boolean(editNormalizedCommand) &&
    editNormalizedCommand !== editOriginalCommand &&
    configuredCommandKeys.has(editNormalizedCommand);
  const canSaveEdit = Boolean(editNormalizedCommand) && !editCommandTaken;

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [dialogOpen]);

  useEffect(() => {
    if (!editCommand) {
      return;
    }

    editCommandInputRef.current?.focus();
    editCommandInputRef.current?.select();
  }, [editCommand]);

  const handleOpenDialog = useCallback(() => {
    if (!canAddCommand) {
      return;
    }

    setDraftCommand('');
    setDraftName('');
    setDialogOpen(true);
  }, [canAddCommand]);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setDraftCommand('');
    setDraftName('');
  }, []);

  const handleAddCommand = useCallback(
    (requestClose: () => void) => (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextCommand = buildQuickCommandEntry(crypto.randomUUID(), draftCommand, draftName);
      const normalized = nextCommand ? normalizeQuickCommand(nextCommand.command) : '';

      if (!nextCommand || !canAddCommand || configuredCommandKeys.has(normalized)) {
        return;
      }

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
      draftName,
      projectId,
      updateProject,
    ],
  );

  const handleSelectSuggestedCommand = useCallback((suggestion: SuggestedQuickCommand) => {
    setDraftCommand(suggestion.command);
    setDraftName(suggestion.name ?? '');
    inputRef.current?.focus();
  }, []);

  const handleOpenContextMenu = useCallback((commandId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ commandId, x: event.clientX, y: event.clientY });
  }, []);

  const handleOpenEdit = useCallback(
    (commandId: string) => {
      const entry = configuredCommands.find((item) => item.id === commandId);

      if (!entry) {
        return;
      }

      setEditDraftCommand(normalizeQuickCommand(entry.command));
      setEditDraftName(normalizeQuickCommand(entry.name ?? '') || '');
      setEditCommandId(commandId);
    },
    [configuredCommands],
  );

  const handleCloseEdit = useCallback(() => {
    setEditCommandId(null);
    setEditDraftCommand('');
    setEditDraftName('');
  }, []);

  const handleEditConfirm = useCallback(
    (requestClose: () => void) => (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!editCommandId || !canSaveEdit) {
        return;
      }

      const nextCommand = buildQuickCommandEntry(editCommandId, editDraftCommand, editDraftName);

      if (!nextCommand) {
        return;
      }

      void updateProject(projectId, {
        terminalQuickCommands: configuredCommands.map((entry) =>
          entry.id === editCommandId ? nextCommand : entry,
        ),
      });
      requestClose();
    },
    [
      canSaveEdit,
      configuredCommands,
      editCommandId,
      editDraftCommand,
      editDraftName,
      projectId,
      updateProject,
    ],
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

  if (!projectExists) {
    return null;
  }

  return (
    <>
      <div className='terminal-footer__quick-commands'>
        {configuredCommands.map((entry) => (
          <div
            key={entry.id}
            className='terminal-footer__quick-command-wrap'
            onContextMenu={(event) => handleOpenContextMenu(entry.id, event)}
          >
            <button
              type='button'
              className='terminal-footer__quick-command terminal-footer__quick-command--saved app-button app-button--enter'
              aria-label={
                entry.name
                  ? `Executar ${entry.label}: ${normalizeQuickCommand(entry.command)}`
                  : `Executar comando ${entry.label}`
              }
              title={entry.name ? normalizeQuickCommand(entry.command) : undefined}
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
      {contextMenu ? (
        <QuickCommandContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEdit={() => handleOpenEdit(contextMenu.commandId)}
          onDelete={() => handleRemoveCommand(contextMenu.commandId)}
        />
      ) : null}
      {editCommand ? (
        <AnimatedModal panelClassName='project-dialog' onClose={handleCloseEdit}>
          {(requestClose) => (
            <form onSubmit={handleEditConfirm(requestClose)}>
              <span className='project-dialog__title'>Editar comando</span>
              <label className='project-dialog__label'>
                Comando
                <input
                  ref={editCommandInputRef}
                  className='project-dialog__input'
                  value={editDraftCommand}
                  maxLength={200}
                  placeholder='ex.: npm run dev'
                  onChange={(event) => setEditDraftCommand(event.target.value)}
                />
              </label>
              <label className='project-dialog__label terminal-quick-command-dialog__name'>
                Nomear comando
                <input
                  className='project-dialog__input'
                  value={editDraftName}
                  maxLength={MAX_TERMINAL_QUICK_COMMAND_NAME}
                  placeholder='opcional'
                  onChange={(event) => setEditDraftName(event.target.value)}
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
                  disabled={!canSaveEdit}
                >
                  Salvar
                </button>
              </div>
            </form>
          )}
        </AnimatedModal>
      ) : null}
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
              <label className='project-dialog__label terminal-quick-command-dialog__name'>
                Nomear comando
                <input
                  className='project-dialog__input'
                  value={draftName}
                  maxLength={MAX_TERMINAL_QUICK_COMMAND_NAME}
                  placeholder='opcional'
                  onChange={(event) => setDraftName(event.target.value)}
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
                      {filteredSuggestedCommands.map((suggestion) => {
                        const label = suggestionLabel(suggestion);
                        const isActive = normalizeQuickCommand(draftCommand) === suggestion.command;

                        return (
                          <button
                            key={suggestion.command}
                            type='button'
                            role='option'
                            aria-selected={isActive}
                            aria-label={
                              suggestion.name
                                ? `${suggestion.name}. ${suggestion.command}`
                                : suggestion.command
                            }
                            className={`project-dialog__preset-command app-button app-button--enter${suggestion.name ? ' project-dialog__preset-command--named' : ''}${isActive ? ' project-dialog__preset-command--active' : ''}`}
                            title={suggestion.command}
                            onClick={() => handleSelectSuggestedCommand(suggestion)}
                          >
                            <Terminal size={13} strokeWidth={2} aria-hidden='true' />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className='project-dialog__presets-empty'>
                      Nenhum comando correspondente
                    </span>
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
