import { memo, useMemo } from 'react';
import { Bug, Folder, Keyboard, Mic, Settings } from 'lucide-react';
import { useGitBranch } from '@/hooks/useGitBranch';
import { useProjectStore } from '@/stores/useProjectStore';
import { getActiveTerminalCwd } from '@/utils/gitRepoSelection';
import { shortenPath } from '@/utils/shortenPath';

function StatusBarComponent() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const displayPath = useMemo(
    () => (activeProject ? shortenPath(activeProject.path) : ''),
    [activeProject],
  );
  const terminalCwd = useMemo(
    () => (activeProject ? getActiveTerminalCwd(activeProject) : null),
    [activeProject],
  );
  const gitBranch = useGitBranch(activeProject?.path ?? null, terminalCwd);

  return (
    <footer className='status-bar'>
      <div className='status-bar__path'>
        <Folder size={12} />
        <div className='status-bar__info'>
          <span className='status-bar__path-text'>{displayPath || 'Nenhum projeto selecionado'}</span>
          {gitBranch ? (
            <>
              <span className='status-bar__separator' aria-hidden='true'>
                ·
              </span>
              <span className='status-bar__branch'>{gitBranch}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className='status-bar__actions'>
        <button type='button' className='status-bar__btn' aria-label='Depurar'>
          <Bug size={12} />
        </button>
        <button type='button' className='status-bar__btn' aria-label='Atalhos'>
          <Keyboard size={12} />
        </button>
        <button type='button' className='status-bar__btn' aria-label='Voz'>
          <Mic size={12} />
        </button>
        <button type='button' className='status-bar__btn' aria-label='Configurações'>
          <Settings size={12} />
        </button>
      </div>
    </footer>
  );
}

export const StatusBar = memo(StatusBarComponent);
