import { memo, useCallback } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { PROJECT_COLORS } from '@/types';

interface ProjectColorPickerProps {
  selectedColor: string;
  onSelect: (color: string) => void;
  onClose: () => void;
}

function ProjectColorPickerComponent({
  selectedColor,
  onSelect,
  onClose,
}: ProjectColorPickerProps) {
  const handleSelect = useCallback(
    (color: string, requestClose: () => void) => {
      onSelect(color);
      requestClose();
    },
    [onSelect],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-color-picker'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Definir cor do ícone</span>
          <div className='project-color-picker__grid'>
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type='button'
                className={`project-color-picker__swatch${selectedColor === color ? ' project-color-picker__swatch--active' : ''}`}
                style={{ backgroundColor: color }}
                aria-label={color}
                onClick={() => handleSelect(color, requestClose)}
              />
            ))}
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const ProjectColorPicker = memo(ProjectColorPickerComponent);
