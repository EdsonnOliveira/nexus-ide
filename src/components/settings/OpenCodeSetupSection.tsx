import { Check, Download, Loader2 } from 'lucide-react';
import { memo } from 'react';
import logoClaude from '@/assets/logo-claude.svg';
import logoCodex from '@/assets/logo-codex.svg';
import logoGemini from '@/assets/logo-gemini.svg';
import logoOpencode from '@/assets/logo-opencode.svg';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import type { CliSetupStatus } from '@/types';

const OPENCODE_AI_LOGOS = [
  { src: logoOpencode, label: 'OpenCode' },
  { src: logoClaude, label: 'Claude' },
  { src: logoCodex, label: 'GPT' },
  { src: logoGemini, label: 'Gemini' },
] as const;

interface OpenCodeSetupSectionProps {
  status: CliSetupStatus | null;
  installing: boolean;
  error: string | null;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onInstall: () => void;
}

function OpenCodeSetupSectionComponent({
  status,
  installing,
  error,
  selectable = false,
  selected = true,
  onSelectedChange,
  onInstall,
}: OpenCodeSetupSectionProps) {
  const installed = status?.opencodeInstalled === true;

  return (
    <div className='settings-modal__section'>
      <span className='settings-modal__section-label'>OpenCode</span>
      <p className='settings-modal__section-hint'>
        Um único CLI com as principais IAs: Claude, GPT, Gemini e modelos gratuitos do OpenCode.
      </p>
      <div className='settings-modal__ai-logos' aria-label='IAs incluídas'>
        {OPENCODE_AI_LOGOS.map((item) => (
          <span key={item.label} className='settings-modal__ai-logo' title={item.label}>
            <img src={item.src} alt='' draggable={false} />
            <span>{item.label}</span>
          </span>
        ))}
      </div>
      {selectable && onSelectedChange ? (
        <div className='settings-modal__check'>
          <AppCheckbox
            checked={selected}
            disabled={installing || installed}
            aria-label={installed ? 'OpenCode instalado' : 'Baixar OpenCode'}
            onChange={onSelectedChange}
          />
          <button
            type='button'
            className='settings-modal__check-label app-button'
            disabled={installing || installed}
            onClick={() => onSelectedChange(!selected)}
          >
            {installed ? 'OpenCode já está instalado' : 'Baixar OpenCode com as principais IAs'}
          </button>
        </div>
      ) : null}
      {error ? <p className='settings-modal__error'>{error}</p> : null}
      {selectable ? null : (
        <button
          type='button'
          className='settings-modal__download app-button app-button--enter'
          disabled={installing || installed || !status}
          onClick={onInstall}
        >
          {installing ? (
            <Loader2 size={14} className='settings-modal__download-spinner' />
          ) : installed ? (
            <Check size={14} />
          ) : (
            <Download size={14} />
          )}
          <span>
            {installing
              ? 'Baixando OpenCode...'
              : installed
                ? 'OpenCode instalado'
                : 'Baixar OpenCode'}
          </span>
        </button>
      )}
    </div>
  );
}

export const OpenCodeSetupSection = memo(OpenCodeSetupSectionComponent);
