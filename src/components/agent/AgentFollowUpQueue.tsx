import { memo, useCallback } from 'react';
import { ArrowUp, Pencil, X } from 'lucide-react';
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

  return (
    <div className='agent-view__follow-up-queue app-button--enter'>
      {items.map((item) => (
        <div key={item.id} className='agent-view__follow-up'>
          <div className='agent-view__follow-up-body'>
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
            <p className='agent-view__follow-up-text'>{item.content}</p>
          </div>
          <div className='agent-view__follow-up-actions'>
            <button
              type='button'
              className='agent-view__follow-up-action app-button app-button--enter'
              aria-label='Editar follow-up'
              onClick={handleEdit(item.id)}
            >
              <Pencil size={13} />
            </button>
            <button
              type='button'
              className='agent-view__follow-up-action agent-view__follow-up-action--send app-button app-button--enter'
              aria-label='Enviar follow-up agora'
              onClick={handleSendNow(item.id)}
            >
              <ArrowUp size={14} strokeWidth={2.25} />
            </button>
            <button
              type='button'
              className='agent-view__follow-up-action app-button app-button--enter'
              aria-label='Excluir follow-up'
              onClick={handleRemove(item.id)}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export const AgentFollowUpQueue = memo(AgentFollowUpQueueComponent);
