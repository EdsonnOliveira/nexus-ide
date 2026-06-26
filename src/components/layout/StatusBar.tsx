import { memo, useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Bug, Folder, GitBranch, Keyboard, Mic, Settings } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { StatusBarBranchMenu } from '@/components/layout/StatusBarBranchMenu';
import { useGitBranch } from '@/hooks/useGitBranch';
import { useProjectStore } from '@/stores/useProjectStore';
import { getActiveTerminalCwd, type GitBranchBarEntry } from '@/utils/gitRepoSelection';
import { getGitPendingWorkMessage, gitRepoHasPendingWork } from '@/utils/gitPendingWork';
import { shortenPath } from '@/utils/shortenPath';
import { APP_VERSION_LABEL } from '@/constants/appVersion';

interface BranchMenuState {
  entry: GitBranchBarEntry;
  anchorRect: DOMRect;
}

interface BlockedCheckoutState {
  message: string;
  repoLabel: string;
}

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
  const { entries: gitBranchEntries, refresh: refreshGitBranches } = useGitBranch(
    activeProject?.path ?? null,
    terminalCwd,
  );
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const [blockedCheckout, setBlockedCheckout] = useState<BlockedCheckoutState | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleBranchClick = useCallback(
    (entry: GitBranchBarEntry, event: MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();

      setBranchMenu({
        entry,
        anchorRect: rect,
      });
    },
    [],
  );

  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!branchMenu) {
        return;
      }

      const { entry } = branchMenu;
      setCheckoutLoading(true);

      try {
        const status = await window.nexus.git.getStatus(entry.repoPath);

        if (gitRepoHasPendingWork(status)) {
          setBlockedCheckout({
            message: getGitPendingWorkMessage(status),
            repoLabel: entry.label,
          });
          return;
        }

        const result = await window.nexus.git.checkout(entry.repoPath, branch);

        if (!result.ok) {
          setBlockedCheckout({
            message: result.error,
            repoLabel: entry.label,
          });
          return;
        }

        refreshGitBranches();
      } finally {
        setCheckoutLoading(false);
        setBranchMenu(null);
      }
    },
    [branchMenu, refreshGitBranches],
  );

  const handleCreateBranch = useCallback(
    async (name: string) => {
      if (!branchMenu) {
        return;
      }

      const { entry } = branchMenu;
      setCheckoutLoading(true);

      try {
        const result = await window.nexus.git.createBranch(entry.repoPath, name);

        if (!result.ok) {
          setBlockedCheckout({
            message: result.error,
            repoLabel: entry.label,
          });
          return;
        }

        refreshGitBranches();
      } finally {
        setCheckoutLoading(false);
        setBranchMenu(null);
      }
    },
    [branchMenu, refreshGitBranches],
  );

  const handlePathClick = useCallback(async () => {
    if (!activeProject) {
      return;
    }

    const resolvedPath = await window.nexus.files.resolveCdPath('/', activeProject.path);
    void window.nexus.files.revealInFolder(resolvedPath);
  }, [activeProject]);

  return (
    <>
      <footer className='status-bar'>
        <div className='status-bar__path'>
          <div className='status-bar__info'>
            {activeProject ? (
              <button
                type='button'
                className='status-bar__path-open app-button app-button--enter'
                aria-label='Abrir pasta no Finder'
                onClick={() => {
                  void handlePathClick();
                }}
              >
                <Folder size={12} />
                <span className='status-bar__path-text'>{displayPath}</span>
              </button>
            ) : (
              <span className='status-bar__path-empty'>
                <Folder size={12} />
                <span className='status-bar__path-text'>Nenhum projeto selecionado</span>
              </span>
            )}
            {gitBranchEntries.length > 0
              ? gitBranchEntries.map((entry) => (
                  <span key={entry.id} className='status-bar__branch-group'>
                    <span className='status-bar__separator' aria-hidden='true'>
                      ·
                    </span>
                    <button
                      type='button'
                      className='status-bar__branch app-button app-button--enter'
                      disabled={checkoutLoading}
                      aria-label={`Trocar branch de ${entry.label}`}
                      onClick={(event) => handleBranchClick(entry, event)}
                    >
                      <GitBranch size={12} strokeWidth={2} />
                      <span>{entry.label}</span>
                    </button>
                  </span>
                ))
              : null}
          </div>
        </div>

        <div className='status-bar__right'>
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
          <span className='status-bar__version'>{APP_VERSION_LABEL}</span>
        </div>
      </footer>

      {branchMenu ? (
        <StatusBarBranchMenu
          anchorRect={branchMenu.anchorRect}
          repoPath={branchMenu.entry.repoPath}
          currentBranch={branchMenu.entry.branch}
          onClose={() => setBranchMenu(null)}
          onCheckout={(branch) => {
            void handleCheckout(branch);
          }}
          onCreateBranch={(name) => {
            void handleCreateBranch(name);
          }}
        />
      ) : null}

      {blockedCheckout ? (
        <AnimatedModal
          panelClassName='project-dialog status-bar__checkout-dialog'
          onClose={() => setBlockedCheckout(null)}
        >
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Não é possível trocar de branch</span>
              <p className='project-dialog__message'>{blockedCheckout.message}</p>
              <p className='status-bar__checkout-dialog-repo'>{blockedCheckout.repoLabel}</p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                  onClick={requestClose}
                >
                  Entendi
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const StatusBar = memo(StatusBarComponent);
