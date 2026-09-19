import { memo, useCallback, type MouseEvent } from 'react';

interface AppRadioProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

function AppRadioComponent({
  checked,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: AppRadioProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!disabled && !checked) {
        onChange();
      }
    },
    [checked, disabled, onChange],
  );

  return (
    <button
      type='button'
      role='radio'
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`app-radio app-button app-button--enter${checked ? ' app-radio--checked' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleClick}
    >
      {checked ? <span className='app-radio__dot' /> : null}
    </button>
  );
}

export const AppRadio = memo(AppRadioComponent);
