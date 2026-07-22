import { FolderOpen, Mic, Sparkles } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { ExplorerFileIcon } from '@/components/explorer/ExplorerTreeIcon';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { Project } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { LinkedTranscriptionSummary } from '@/utils/brainTranscriptionLinks';
import type { GitFlatChange } from '@/utils/gitFlatChanges';
import {
  formatMacParakeetDate,
  formatMacParakeetDuration,
  resolveMacParakeetSourceLabel,
} from '@/utils/macParakeetLabels';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

interface DailyProjectDetailModalProps {
  project: Project;
  metaLabel: string;
  visibleGroups: AgentGitChangeGroup[];
  fallbackGitChanges: GitFlatChange[];
  gitLoading: boolean;
  hasPromptGroups: boolean;
  hasGitChanges: boolean;
  transcriptions: LinkedTranscriptionSummary[];
  transcriptionsLoading: boolean;
  hasTranscriptions: boolean;
  onClose: () => void;
}

function resolveFileNameFromPath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

function DailyProjectDetailModalComponent({
  project,
  metaLabel,
  visibleGroups,
  fallbackGitChanges,
  gitLoading,
  hasPromptGroups,
  hasGitChanges,
  transcriptions,
  transcriptionsLoading,
  hasTranscriptions,
  onClose,
}: DailyProjectDetailModalProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!project.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(project.logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [project.logo]);

  const showLogo = Boolean(logoSrc) && !logoFailed;
  const showEmpty =
    !gitLoading &&
    !transcriptionsLoading &&
    !hasPromptGroups &&
    !hasGitChanges &&
    !hasTranscriptions;

  return (
    <AnimatedModal
      onClose={onClose}
      panelClassName='project-dialog home-dashboard__daily-modal home-dashboard__daily-detail-modal'
    >
      {(requestClose) => (
        <>
          <header className='home-dashboard__daily-modal-header'>
            <div className='home-dashboard__daily-modal-heading'>
              <span className='home-dashboard__daily-modal-icon' aria-hidden='true'>
                <Sparkles size={16} strokeWidth={2} />
              </span>
              <h2 className='home-dashboard__daily-modal-title'>Daily</h2>
            </div>
            <div className='home-dashboard__daily-modal-project'>
              <span className='home-dashboard__daily-project-icon-wrap' aria-hidden='true'>
                {showLogo ? (
                  <img src={logoSrc ?? undefined} alt='' className='home-dashboard__daily-project-logo' />
                ) : (
                  <span
                    className='home-dashboard__daily-project-icon'
                    style={{ backgroundColor: project.color }}
                  >
                    <ProjectIconMark icon={project.icon} />
                  </span>
                )}
              </span>
              <span className='home-dashboard__daily-project-copy'>
                <span className='home-dashboard__daily-project-name'>{project.name}</span>
                <span className='home-dashboard__daily-project-meta'>{metaLabel}</span>
              </span>
            </div>
          </header>
          <div className='home-dashboard__daily-detail-modal-body'>
            {gitLoading && !hasPromptGroups ? (
              <p className='home-dashboard__daily-empty-inline'>Carregando alterações git...</p>
            ) : null}
            {transcriptionsLoading && !hasTranscriptions ? (
              <p className='home-dashboard__daily-empty-inline'>Carregando transcrições...</p>
            ) : null}
            {showEmpty ? (
              <EmptyState
                icon={FolderOpen}
                message='Sem alterações locais. O Gerar usa o histórico git do projeto.'
                compact
              />
            ) : null}
            {hasPromptGroups ? (
              <div className='home-dashboard__daily-prompt-list'>
                {visibleGroups.map((group) => (
                  <section key={group.id} className='home-dashboard__daily-prompt-group'>
                    <p className='home-dashboard__daily-prompt-label'>
                      &ldquo;{sanitizeAgentPrompt(group.prompt)}&rdquo;
                    </p>
                    <ul className='home-dashboard__daily-file-list'>
                      {group.files.map((file) => (
                        <li key={`${group.id}-${file.path}`} className='home-dashboard__daily-file-row'>
                          <span className='home-dashboard__daily-file-leading'>
                            <span className='home-dashboard__daily-file-icon' aria-hidden='true'>
                              <ExplorerFileIcon name={resolveFileNameFromPath(file.path)} />
                            </span>
                            <span className='home-dashboard__daily-file-path'>{file.path}</span>
                          </span>
                          <span className='home-dashboard__daily-file-stats'>
                            +{file.additions} -{file.deletions}
                          </span>
                          <span className='home-dashboard__daily-file-status'>{file.status}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : null}
            {!hasPromptGroups && hasGitChanges ? (
              <section className='home-dashboard__daily-prompt-group'>
                <p className='home-dashboard__daily-prompt-label home-dashboard__daily-prompt-label--git'>
                  Alterações git
                </p>
                <ul className='home-dashboard__daily-file-list'>
                  {fallbackGitChanges.map((change) => (
                    <li key={change.path} className='home-dashboard__daily-file-row'>
                      <span className='home-dashboard__daily-file-leading'>
                        <span className='home-dashboard__daily-file-icon' aria-hidden='true'>
                          <ExplorerFileIcon name={resolveFileNameFromPath(change.path)} />
                        </span>
                        <span className='home-dashboard__daily-file-path'>{change.path}</span>
                      </span>
                      <span className='home-dashboard__daily-file-stats'>
                        +{change.additions} -{change.deletions}
                      </span>
                      <span className='home-dashboard__daily-file-status'>
                        {change.status}
                        {change.staged ? ' · staged' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {hasTranscriptions ? (
              <section className='home-dashboard__daily-prompt-group'>
                <p className='home-dashboard__daily-prompt-label home-dashboard__daily-prompt-label--transcriptions'>
                  Transcrições vinculadas
                </p>
                <ul className='home-dashboard__daily-transcription-list'>
                  {transcriptions.map((item) => (
                    <li key={item.id} className='home-dashboard__daily-transcription-row'>
                      <span className='home-dashboard__daily-transcription-leading' aria-hidden='true'>
                        <Mic size={13} strokeWidth={2} />
                      </span>
                      <span className='home-dashboard__daily-transcription-copy'>
                        <span className='home-dashboard__daily-transcription-title'>{item.title}</span>
                        <span className='home-dashboard__daily-transcription-meta'>
                          {resolveMacParakeetSourceLabel(item.sourceType)} ·{' '}
                          {formatMacParakeetDuration(item.durationMs)} ·{' '}
                          {formatMacParakeetDate(item.createdAt)}
                        </span>
                        {item.snippet ? (
                          <span className='home-dashboard__daily-transcription-snippet'>
                            {item.snippet}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <div className='project-dialog__actions home-dashboard__daily-modal-actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Fechar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const DailyProjectDetailModal = memo(DailyProjectDetailModalComponent);
