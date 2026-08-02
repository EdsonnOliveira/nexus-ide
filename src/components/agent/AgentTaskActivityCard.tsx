import { memo, useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { AgentActivityIcon } from '@/components/agent/AgentActivityIcon';
import { ExplorerFileIcon } from '@/components/explorer/ExplorerTreeIcon';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { useTabActions } from '@/stores/useTabStore';
import type { AgentActivity } from '@/types';
import { resolveAgentActivityFilePath } from '@/utils/agentTranscriptParser';

interface AgentTaskActivityCardProps {
  activity: AgentActivity;
  projectPath: string;
  relatedFiles?: string[];
  showToolsHeader?: boolean;
}

interface ExploreTreeNode {
  name: string;
  path: string;
  children: ExploreTreeNode[];
  isFile: boolean;
}

function formatSubagentTypeLabel(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';

  if (!normalized) {
    return 'Task';
  }

  if (normalized === 'explore' || normalized === 'explorer') {
    return 'Explorer';
  }

  if (normalized === 'shell') {
    return 'Shell';
  }

  if (normalized === 'browser_use' || normalized === 'browser') {
    return 'Browser';
  }

  if (normalized === 'computer_use') {
    return 'Computer Use';
  }

  if (normalized === 'generalpurpose' || normalized === 'general_purpose') {
    return 'General';
  }

  return normalized
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDurationLabel(durationMs: number | undefined, streaming: boolean | undefined): string {
  if (streaming) {
    return 'Em execução…';
  }

  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '';
  }

  if (durationMs < 1000) {
    return `Thought for ${Math.max(1, Math.round(durationMs / 1000))}s`;
  }

  const seconds = durationMs / 1000;

  if (seconds < 60) {
    return `Thought for ${seconds < 10 ? seconds.toFixed(0) : Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `Worked for ${minutes}m ${rest}s`;
}

function toRelativePath(projectPath: string, filePath: string): string {
  const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');

  if (normalizedFile.startsWith(`${normalizedProject}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1);
  }

  return normalizedFile;
}

function buildExploreTree(projectPath: string, files: string[]): ExploreTreeNode[] {
  const root: ExploreTreeNode[] = [];

  for (const filePath of files) {
    const relative = toRelativePath(projectPath, filePath);
    const parts = relative.split('/').filter(Boolean);

    if (parts.length === 0) {
      continue;
    }

    let cursor = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? '';
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = cursor.find((entry) => entry.name === part && entry.isFile === isFile);

      if (!node) {
        node = {
          name: part,
          path: isFile ? filePath : currentPath,
          children: [],
          isFile,
        };
        cursor.push(node);
      }

      cursor = node.children;
    }
  }

  const sortNodes = (nodes: ExploreTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.isFile !== right.isFile) {
        return left.isFile ? 1 : -1;
      }

      return left.name.localeCompare(right.name);
    });

    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(root);
  return root;
}

function ExploreTreeList({
  nodes,
  depth = 0,
  onOpenFile,
}: {
  nodes: ExploreTreeNode[];
  depth?: number;
  onOpenFile: (path: string) => void;
}) {
  return (
    <ul className='agent-task-modal__tree' style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {nodes.map((node) => (
        <li key={`${node.path}:${node.name}:${node.isFile ? 'file' : 'dir'}`}>
          {node.isFile ? (
            <button
              type='button'
              className='agent-task-modal__tree-file app-button'
              onClick={() => onOpenFile(node.path)}
            >
              <ExplorerFileIcon name={node.name} />
              <span>{node.name}</span>
            </button>
          ) : (
            <>
              <div className='agent-task-modal__tree-dir'>
                <span className='agent-task-modal__tree-branch'>└</span>
                <span>{node.name}</span>
              </div>
              {node.children.length > 0 ? (
                <ExploreTreeList nodes={node.children} depth={depth + 1} onOpenFile={onOpenFile} />
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function AgentTaskActivityCardComponent({
  activity,
  projectPath,
  relatedFiles = [],
  showToolsHeader = false,
}: AgentTaskActivityCardProps) {
  const [open, setOpen] = useState(false);
  const { openFileTab } = useTabActions();
  const title = activity.label.trim() || 'Subagent task';
  const toolLabel = formatSubagentTypeLabel(activity.taskSubagentType);
  const summary = activity.taskSummary?.trim() || activity.taskPrompt?.trim() || '';
  const durationLabel = formatDurationLabel(activity.durationMs, activity.streaming);
  const keyFiles = useMemo(() => {
    const unique = new Set<string>();

    for (const filePath of relatedFiles) {
      const trimmed = filePath.trim();

      if (trimmed) {
        unique.add(trimmed);
      }
    }

    return [...unique];
  }, [relatedFiles]);
  const tree = useMemo(
    () => buildExploreTree(projectPath, keyFiles),
    [keyFiles, projectPath],
  );

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      const absolute = resolveAgentActivityFilePath(projectPath, filePath) || filePath;
      const fileName = absolute.split(/[/\\]/).pop() || absolute;
      void openFileTab(absolute, fileName);
    },
    [openFileTab, projectPath],
  );

  return (
    <>
      <div className='agent-task-card app-button--enter'>
        {showToolsHeader ? (
          <div className='agent-task-card__tools-header'>
            <AgentActivityIcon kind='tools' />
            <span>Explored available tools</span>
          </div>
        ) : null}
        <button
          type='button'
          className='agent-task-card__row app-button'
          onClick={handleOpen}
          aria-label={`Abrir detalhes de ${title}`}
        >
          <AgentActivityIcon kind='task' className='agent-task-card__icon' />
          <span className='agent-task-card__body'>
            <span className='agent-task-card__title-row'>
              <span className='agent-task-card__title'>{title}</span>
              <span className='agent-task-card__tool'>{toolLabel}</span>
            </span>
            {summary ? <span className='agent-task-card__summary'>{summary}</span> : null}
          </span>
        </button>
        {durationLabel ? <div className='agent-task-card__duration'>{durationLabel}</div> : null}
      </div>
      {open ? (
        <AnimatedModal panelClassName='project-dialog agent-task-modal' onClose={handleClose}>
          {(requestClose) => (
            <>
              <div className='agent-task-modal__header'>
                <div className='agent-task-modal__heading'>
                  <h2 className='agent-task-modal__title'>{title}</h2>
                  {durationLabel ? (
                    <p className='agent-task-modal__meta'>{durationLabel.replace('Thought for', 'Worked for')}</p>
                  ) : null}
                </div>
                <button
                  type='button'
                  className='project-dialog__close app-button'
                  aria-label='Fechar'
                  onClick={requestClose}
                >
                  <X size={16} />
                </button>
              </div>
              <div className='agent-task-modal__body'>
                {activity.taskPrompt?.trim() ? (
                  <section className='agent-task-modal__section'>
                    <div className='agent-task-modal__prompt'>{activity.taskPrompt.trim()}</div>
                  </section>
                ) : null}
                {tree.length > 0 ? (
                  <section className='agent-task-modal__section'>
                    <h3 className='agent-task-modal__section-title'>Hierarquia de renderização</h3>
                    <ExploreTreeList nodes={tree} onOpenFile={handleOpenFile} />
                  </section>
                ) : null}
                {keyFiles.length > 0 ? (
                  <section className='agent-task-modal__section'>
                    <h3 className='agent-task-modal__section-title'>Arquivos-chave e papéis</h3>
                    <div className='agent-task-modal__files'>
                      {keyFiles.map((filePath) => {
                        const relative = toRelativePath(projectPath, filePath);
                        const fileName = relative.split('/').pop() || relative;

                        return (
                          <button
                            key={filePath}
                            type='button'
                            className='agent-task-modal__file-pill app-button'
                            onClick={() => handleOpenFile(filePath)}
                            title={relative}
                          >
                            <ExplorerFileIcon name={fileName} />
                            <span>{relative}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {!activity.taskPrompt?.trim() && keyFiles.length === 0 ? (
                  <p className='agent-task-modal__empty'>
                    Detalhes do subagent indisponíveis neste turno.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const AgentTaskActivityCard = memo(AgentTaskActivityCardComponent);
