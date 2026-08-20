import { Check, Minus } from 'lucide-react';
import { memo, useCallback, type MouseEvent } from 'react';

interface AppCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

function AppCheckboxComponent({
  checked,
  indeterminate = false,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: AppCheckboxProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!disabled) {
        onChange(indeterminate ? true : !checked);
      }
    },
    [checked, disabled, indeterminate, onChange],
  );

  const isOn = checked || indeterminate;

  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`app-checkbox app-button app-button--enter${isOn ? ' app-checkbox--checked' : ''}${indeterminate ? ' app-checkbox--indeterminate' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
    >
      {indeterminate ? <Minus size={12} strokeWidth={2.5} /> : checked ? <Check size={12} strokeWidth={2.5} /> : null}
    </button>
  );
}

export const AppCheckbox = memo(AppCheckboxComponent);
