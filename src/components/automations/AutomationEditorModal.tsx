import { memo, type Dispatch, type SetStateAction } from 'react';
import { AutomationEditorView } from '@/components/automations/AutomationEditorView';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import type { Automation } from '@/types/automation';

interface AutomationEditorModalProps {
  draft: Automation;
  isExisting: boolean;
  onChange: Dispatch<SetStateAction<Automation>>;
  onClose: () => void;
  onSave: () => void;
  onPlay: () => void;
  onDelete?: () => void;
}

function AutomationEditorModalComponent({
  draft,
  isExisting,
  onChange,
  onClose,
  onSave,
  onPlay,
  onDelete,
}: AutomationEditorModalProps) {
  return (
    <AnimatedModal panelClassName='automation-editor-modal' onClose={onClose}>
      {() => (
        <AutomationEditorView
          draft={draft}
          isExisting={isExisting}
          onChange={onChange}
          onBack={onClose}
          onSave={onSave}
          onPlay={onPlay}
          onDelete={onDelete}
        />
      )}
    </AnimatedModal>
  );
}

export const AutomationEditorModal = memo(AutomationEditorModalComponent);
