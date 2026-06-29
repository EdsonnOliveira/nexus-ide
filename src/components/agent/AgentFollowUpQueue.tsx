import { memo, useCallback } from 'react';
import { ArrowUp, CornerDownLeft, Pencil, X } from 'lucide-react';
import type { AgentFollowUp } from '@/types';

interface AgentFollowUpQueueProps {
  items: AgentFollowUp[];
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
}

function AgentFollowUpQueueComponent({ items, onEdit, onSendNow, onRemove }: AgentFollowUpQueueProps) {
  const handleEdit = useCallback(
    (id: string) => () => {
      onEdit(id);
    },
    [onEdit],
  );

  const handleSendNow = useCallback(
    (id: string) => () => {
      onSendNow(id);
    },
    [onSendNow],
  );

  const handleRemove = useCallback(
    (id: string) => () => {
      onRemove(id);
    },
    [onRemove],
  );

  if (items.length === 0) {
    return null;
  }

  const queueCountLabel = `${items.length} na fila`;

  return (
    <div className='agent-view__follow-up-queue app-button--enter'>
      <div className='agent-view__follow-up-card'>
        <div className='agent-view__follow-up-header'>
          <div className='agent-view__follow-up-header-main'>
            <span className='agent-view__follow-up-count'>{queueCountLabel}</span>
            <span className='agent-view__follow-up-hint'>
              <CornerDownLeft size={11} strokeWidth={2} aria-hidden='true' />
              Enter para enviar
            </span>
          </div>
        </div>
        <ul className='agent-view__follow-up-list'>
          {items.map((item) => {
            const isMultiline = item.content.includes('\n') || item.content.length > 72;

            return (
              <li key={item.id} className='agent-view__follow-up-item'>
                <div className='agent-view__follow-up-item-body'>
                  {item.attachments.length > 0 ? (
                    <div className='agent-view__follow-up-attachments'>
                      {item.attachments.map((attachment) => (
                        <img
                          key={attachment.id}
                          src={attachment.dataUrl}
                          alt=''
                          className='agent-view__follow-up-attachment'
                        />
                      ))}
                    </div>
                  ) : null}
                  <p
                    className={`agent-view__follow-up-text${isMultiline ? ' agent-view__follow-up-text--multiline' : ''}`}
                  >
                    {item.content}
                  </p>
                </div>
                <div className='agent-view__follow-up-item-actions'>
                  <button
                    type='button'
                    className='agent-view__follow-up-action app-button app-button--enter'
                    aria-label='Editar follow-up'
                    onClick={handleEdit(item.id)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type='button'
                    className='agent-view__follow-up-action agent-view__follow-up-action--send app-button app-button--enter'
                    aria-label='Enviar follow-up agora'
                    onClick={handleSendNow(item.id)}
                  >
                    <ArrowUp size={13} strokeWidth={2.25} />
                  </button>
                  <button
                    type='button'
                    className='agent-view__follow-up-action app-button app-button--enter'
                    aria-label='Excluir follow-up'
                    onClick={handleRemove(item.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export const AgentFollowUpQueue = memo(AgentFollowUpQueueComponent);
