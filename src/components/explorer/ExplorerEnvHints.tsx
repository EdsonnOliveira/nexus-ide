import { memo, useCallback } from 'react';
import {
  getProjectKindBadgeLabel,
  type ExplorerEnvHint,
} from '@/utils/explorerEnvHints';

interface ExplorerEnvHintsProps {
  hints: ExplorerEnvHint[];
  onOpenHint: (hint: ExplorerEnvHint) => void;
}

function ExplorerEnvHintsComponent({ hints, onOpenHint }: ExplorerEnvHintsProps) {
  const handleClick = useCallback(
    (hint: ExplorerEnvHint) => () => {
      onOpenHint(hint);
    },
    [onOpenHint],
  );

  if (hints.length === 0) {
    return null;
  }

  return (
    <div className='project-explorer__hints' role='listbox' aria-label='Sugestões do explorador'>
      <div className='project-explorer__hint-row'>
        {hints.map((hint) => (
          <button
            key={hint.id}
            type='button'
            className='project-explorer__hint app-button app-button--enter'
            role='option'
            title={`${hint.projectDirName}/${hint.fileName}`}
            onClick={handleClick(hint)}
          >
            {hint.projectKind ? (
              <span
                className='project-explorer__kind-badge'
                style={
                  hint.badgeColor
                    ? { backgroundColor: hint.badgeColor, color: '#000000' }
                    : undefined
                }
              >
                {getProjectKindBadgeLabel(hint.projectKind)}
              </span>
            ) : null}
            <span className='project-explorer__hint-label'>{hint.fileName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const ExplorerEnvHints = memo(ExplorerEnvHintsComponent);
