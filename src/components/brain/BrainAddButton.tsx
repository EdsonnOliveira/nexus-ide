import { memo } from 'react';
import { Plus } from 'lucide-react';

interface BrainAddButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

function BrainAddButtonComponent({ onClick, disabled = false }: BrainAddButtonProps) {
  return (
    <button
      type='button'
      className='brain-add-button app-button app-button--enter'
      onClick={onClick}
      disabled={disabled}
    >
      <Plus size={14} strokeWidth={2.2} />
      <span className='app-button__label'>Adicionar</span>
    </button>
  );
}

export const BrainAddButton = memo(BrainAddButtonComponent);
