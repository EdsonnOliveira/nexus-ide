import { Check } from 'lucide-react';
import { memo, useCallback } from 'react';

interface AppCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

function AppCheckboxComponent({
  checked,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: AppCheckboxProps) {
  const handleClick = useCallback(() => {
    if (!disabled) {
      onChange(!checked);
    }
  }, [checked, disabled, onChange]);

  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`app-checkbox app-button app-button--enter${checked ? ' app-checkbox--checked' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
    >
      {checked ? <Check size={12} strokeWidth={2.5} /> : null}
    </button>
  );
}

export const AppCheckbox = memo(AppCheckboxComponent);
