import { memo, useCallback, useMemo, useRef, type ChangeEvent, type MouseEvent } from 'react';

const API_VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

interface ApiVariableSegment {
  type: 'text' | 'variable';
  value: string;
  name?: string;
  start: number;
  end: number;
}

function parseApiVariableSegments(text: string): ApiVariableSegment[] {
  if (!text) {
    return [];
  }

  const segments: ApiVariableSegment[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(API_VARIABLE_PATTERN.source, 'g');
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      const value = text.slice(lastIndex, match.index);
      segments.push({
        type: 'text',
        value,
        start: lastIndex,
        end: lastIndex + value.length,
      });
    }

    const value = match[0];
    segments.push({
      type: 'variable',
      value,
      name: match[1].trim(),
      start: match.index,
      end: match.index + value.length,
    });
    lastIndex = match.index + value.length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    const value = text.slice(lastIndex);
    segments.push({
      type: 'text',
      value,
      start: lastIndex,
      end: lastIndex + value.length,
    });
  }

  return segments;
}

function findVariableAtPosition(text: string, position: number): string | null {
  const segments = parseApiVariableSegments(text);

  for (const segment of segments) {
    if (segment.type === 'variable' && position >= segment.start && position < segment.end) {
      return segment.name ?? null;
    }
  }

  return null;
}

interface ApiVariableInputProps {
  value: string;
  onChange: (value: string) => void;
  onVariableDoubleClick?: (variableName: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

function ApiVariableInputComponent({
  value,
  onChange,
  onVariableDoubleClick,
  placeholder,
  className,
  disabled,
  'aria-label': ariaLabel,
}: ApiVariableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => parseApiVariableSegments(value), [value]);
  const isEmpty = value.length === 0;
  const isVariableEditable = Boolean(onVariableDoubleClick) && !disabled;

  const syncScroll = useCallback(() => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, []);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
      syncScroll();
    },
    [onChange, syncScroll],
  );

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLInputElement>) => {
      if (!onVariableDoubleClick) {
        return;
      }

      const position = event.currentTarget.selectionStart ?? 0;
      const variableName = findVariableAtPosition(value, position);

      if (variableName) {
        event.preventDefault();
        onVariableDoubleClick(variableName);
      }
    },
    [onVariableDoubleClick, value],
  );

  return (
    <div
      className={`api-variable-input${isVariableEditable ? ' api-variable-input--editable' : ''}${className ? ` ${className}` : ''}`}
    >
      <div ref={mirrorRef} className='api-variable-input__mirror' aria-hidden='true'>
        {isEmpty && placeholder ? (
          <span className='api-variable-input__placeholder'>{placeholder}</span>
        ) : (
          <span className='api-variable-input__mirror-line'>
            {segments.map((segment, index) =>
              segment.type === 'variable' ? (
                <span
                  key={`${segment.value}-${index}`}
                  className={`api-variable-input__badge${isVariableEditable ? ' api-variable-input__badge--editable' : ''}`}
                  title={isVariableEditable ? 'Duplo clique para editar' : undefined}
                >
                  <span className='api-variable-input__badge-text'>{segment.value}</span>
                </span>
              ) : (
                <span key={`${segment.value}-${index}`} className='api-variable-input__text'>
                  {segment.value}
                </span>
              ),
            )}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type='text'
        className='api-variable-input__field'
        value={value}
        disabled={disabled}
        spellCheck={false}
        aria-label={ariaLabel}
        onChange={handleChange}
        onDoubleClick={handleDoubleClick}
        onInput={syncScroll}
        onSelect={syncScroll}
        onKeyUp={syncScroll}
      />
    </div>
  );
}

export const ApiVariableInput = memo(ApiVariableInputComponent);
