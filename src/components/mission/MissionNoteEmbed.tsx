import { memo, useCallback, useMemo } from 'react';
import { StickyNote } from 'lucide-react';
import type { MissionAgentNode } from '@/types/mission';
import { EmptyState } from '@/components/overlay/EmptyState';
import { useMissionStore } from '@/stores/useMissionStore';

interface MissionNoteEmbedProps {
  node: MissionAgentNode;
  missionId: string;
  focused?: boolean;
}

function MissionNoteEmbedComponent({
  node,
  missionId,
  focused = false,
}: MissionNoteEmbedProps) {
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const content = node.noteContent ?? '';

  const handleChange = useCallback(
    (value: string) => {
      void upsertNode(missionId, {
        ...node,
        noteContent: value,
      });
      void window.nexus?.missions?.writeNoteFile?.(missionId, node.id, value);
    },
    [missionId, node, upsertNode],
  );

  const empty = useMemo(() => content.trim().length === 0, [content]);

  return (
    <div
      className={`mission-note-embed${focused ? ' mission-note-embed--focused' : ''} nodrag nopan nowheel`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className='mission-note-embed__header'>
        <StickyNote size={14} strokeWidth={2.2} aria-hidden='true' />
        <span>{node.name?.trim() || 'Nota'}</span>
      </div>
      {empty ? (
        <EmptyState
          icon={StickyNote}
          message='Escreva aqui ou conecte um agent Live para editar'
          compact
        />
      ) : null}
      <textarea
        className='mission-note-embed__editor'
        value={content}
        placeholder='Markdown da nota…'
        onChange={(event) => handleChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

export const MissionNoteEmbed = memo(MissionNoteEmbedComponent);
