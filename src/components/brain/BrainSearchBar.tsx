import { memo, useCallback, type ChangeEvent } from 'react';
import { Search } from 'lucide-react';
import { BRAIN_SEARCH_EXAMPLES } from '@/components/brain/brainConstants';

interface BrainSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

function BrainSearchBarComponent({ value, onChange }: BrainSearchBarProps) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  const handleExampleClick = useCallback(
    (example: string) => {
      onChange(example);
    },
    [onChange],
  );

  return (
    <div className='brain-view__search'>
      <label className='brain-view__search-field'>
        <Search size={15} strokeWidth={2} aria-hidden='true' />
        <input
          type='search'
          className='brain-view__search-input'
          placeholder='Pesquisar qualquer coisa...'
          value={value}
          onChange={handleChange}
          aria-label='Pesquisar no Cérebro do Projeto'
        />
      </label>
      <div className='brain-view__search-examples'>
        {BRAIN_SEARCH_EXAMPLES.map((example) => (
          <button
            key={example}
            type='button'
            className='brain-view__search-example app-button app-button--enter'
            onClick={() => handleExampleClick(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

export const BrainSearchBar = memo(BrainSearchBarComponent);
