import { Play, Plus, Workflow } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { AutomationContextMenu } from '@/components/automations/AutomationContextMenu';
import { EmptyState } from '@/components/overlay/EmptyState';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import type { Automation } from '@/types/automation';
import { formatAutomationTrigger, summarizeAutomationSteps } from '@/utils/automationLabels';

interface AutomationListViewProps {
  automations: Automation[];
  onCreate: () => void;
  onEdit: (automation: Automation) => void;
  onPlay: (automation: Automation) => void;
  onCopyPrompt: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
}

interface ContextMenuState {
  automation: Automation;
  x: number;
  y: number;
}

function AutomationListViewComponent({
  automations,
  onCreate,
  onEdit,
  onPlay,
  onCopyPrompt,
  onDelete,
}: AutomationListViewProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);

  const handleRowClick = useCallback(
    (automation: Automation) => () => {
      onEdit(automation);
    },
    [onEdit],
  );

  const handlePlayClick = useCallback(
    (automation: Automation) => (event: React.MouseEvent) => {
      event.stopPropagation();
      onPlay(automation);
    },
    [onPlay],
  );

  const handleContextMenu = useCallback(
    (automation: Automation) => (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        automation,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );

  const handleDeleteRequest = useCallback((automation: Automation) => {
    setDeleteTarget(automation);
  }, []);

  const handleDeleteConfirm = useCallback(
    (requestClose: () => void) => {
      if (!deleteTarget) {
        return;
      }

      onDelete(deleteTarget);
      requestClose();
      setDeleteTarget(null);
    },
    [deleteTarget, onDelete],
  );

  return (
    <aside className='project-explorer-drawer automations-drawer'>
      <div className='project-explorer__header'>
        <span className='project-explorer__title'>Automações</span>
        <button
          type='button'
          className='project-explorer__header-btn app-button app-button--enter'
          aria-label='Nova automação'
          onClick={onCreate}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>
      <div className='automations-drawer__list'>
        {automations.length === 0 ? (
          <EmptyState
            icon={Workflow}
            message='Nenhuma automação criada'
            compact
            className='automations-drawer__empty'
          />
        ) : (
          automations.map((automation) => (
            <div
              key={automation.id}
              className='automations-drawer__row app-button--enter'
              role='button'
              tabIndex={0}
              onClick={handleRowClick(automation)}
              onContextMenu={handleContextMenu(automation)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onEdit(automation);
                }
              }}
            >
              <div className='automations-drawer__row-main'>
                <span className='automations-drawer__name'>{automation.name}</span>
                <span className='automations-drawer__meta'>
                  {formatAutomationTrigger(automation.trigger, automation.intervalMinutes)}
                </span>
                <span className='automations-drawer__summary'>
                  {summarizeAutomationSteps(automation.steps.map((step) => step.type))}
                </span>
              </div>
              <div className='automations-drawer__actions'>
                <button
                  type='button'
                  className='automations-drawer__action automations-drawer__action--play app-button app-button--enter'
                  aria-label={`Executar ${automation.name}`}
                  onClick={handlePlayClick(automation)}
                >
                  <Play size={13} strokeWidth={2.25} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {contextMenu ? (
        <AutomationContextMenu
          automation={contextMenu.automation}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopyPrompt={onCopyPrompt}
          onDelete={handleDeleteRequest}
        />
      ) : null}

      {deleteTarget ? (
        <AnimatedModal onClose={() => setDeleteTarget(null)} panelClassName='project-dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir automação</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir <strong>{deleteTarget.name}</strong>?
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button'
                  onClick={() => handleDeleteConfirm(requestClose)}
                >
                  Excluir
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </aside>
  );
}

export const AutomationListView = memo(AutomationListViewComponent);
