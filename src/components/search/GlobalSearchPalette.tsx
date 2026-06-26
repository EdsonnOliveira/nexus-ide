import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Braces,
  FileCode2,
  FolderKanban,
  GitBranch,
  Globe,
  Layers,
  ListChecks,
  Lock,
  Music,
  Play,
  Search,
  Slash,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react';
import { GLOBAL_SEARCH_NAME, GLOBAL_SEARCH_PLACEHOLDER } from '@/constants/globalSearch';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ExplorerFileIcon } from '@/components/explorer/ExplorerTreeIcon';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { useGlobalSearchPalette } from '@/hooks/useGlobalSearchPalette';
import { useProjectStore } from '@/stores/useProjectStore';
import { registerModalOpen } from '@/utils/overlayBlocking';
import type { Project } from '@/types';
import type {
  GlobalSearchFilePayload,
  GlobalSearchGitPayload,
  GlobalSearchProjectPayload,
  GlobalSearchResult,
  GlobalSearchResultGroup,
  SlashCommandId,
  SlashCommandQuery,
} from '@/utils/globalSearchTypes';

const SLASH_COMMAND_ICON_SIZE = 12;
const RESULT_KIND_ICON_SIZE = 16;
const GLOBAL_SEARCH_SKELETON_ROWS = 5;

function shouldShowGroupProjectLogo(group: GlobalSearchResultGroup, project: Project | null): boolean {
  if (!project || !group.label) {
    return false;
  }

  return group.label === project.name;
}

function highlightMatchingText(text: string, query: string): ReactNode {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return text;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, cursor);

    if (matchIndex === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    parts.push(
      <span key={`${matchIndex}-${partIndex}`} className='global-search__item-title-match'>
        {text.slice(matchIndex, matchIndex + normalizedQuery.length)}
      </span>,
    );

    cursor = matchIndex + normalizedQuery.length;
    partIndex += 1;
  }

  return parts.length === 1 ? parts[0] : parts;
}

function resolveHighlightQuery(
  mode: 'free' | 'slash',
  freeText: string,
  slash: SlashCommandQuery | null,
): string {
  if (mode === 'slash' && slash) {
    if (slash.phase === 'payload') {
      return slash.payload;
    }

    return slash.filterText;
  }

  return freeText;
}

function resolveResultFileName(item: GlobalSearchResult): string | null {
  if (item.kind === 'file') {
    const payload = item.payload as GlobalSearchFilePayload;
    return payload.relativePath.split(/[/\\]/).pop() ?? payload.relativePath;
  }

  if (item.kind === 'git') {
    const payload = item.payload as GlobalSearchGitPayload;
    return payload.path.split(/[/\\]/).pop() ?? payload.path;
  }

  return null;
}

function GlobalSearchResultKindIcon({ item }: { item: GlobalSearchResult }) {
  const fileName = useMemo(() => resolveResultFileName(item), [item]);

  if (fileName) {
    return (
      <span className='global-search__item-icon'>
        <ExplorerFileIcon name={fileName} />
      </span>
    );
  }

  switch (item.kind) {
    case 'tab':
      if (item.subtitle === 'Terminal') {
        return <Terminal size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
      }

      if (item.subtitle === 'Navegador') {
        return <Globe size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
      }

      if (item.subtitle === 'API') {
        return <Braces size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
      }

      if (item.subtitle === 'Emulador') {
        return <Smartphone size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
      }

      return <FileCode2 size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'task':
      return <ListChecks size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'form':
      return <Lock size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'automation':
      return (
        <Play
          size={RESULT_KIND_ICON_SIZE}
          strokeWidth={2.25}
          className='global-search__item-kind-icon global-search__item-kind-icon--automation'
          aria-hidden='true'
        />
      );
    case 'music-track':
    case 'music-playlist':
      return <Music size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'emulator':
      return <Smartphone size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'api-route':
      return <Braces size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'agent-target':
      return <Bot size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'agent-session':
      return <Bot size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'terminal-target':
      return <Terminal size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'task-target':
      return <ListChecks size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'form-target':
      return <Lock size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'automation-target':
      return (
        <Play
          size={RESULT_KIND_ICON_SIZE}
          strokeWidth={2.25}
          className='global-search__item-kind-icon global-search__item-kind-icon--automation'
          aria-hidden='true'
        />
      );
    case 'file-target':
      return <FileCode2 size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    case 'git':
      return <GitBranch size={RESULT_KIND_ICON_SIZE} strokeWidth={2.25} className='global-search__item-kind-icon' aria-hidden='true' />;
    default:
      return null;
  }
}

function GlobalSearchResultsSkeleton() {
  return (
    <div className='global-search__skeleton' aria-hidden='true'>
      {Array.from({ length: GLOBAL_SEARCH_SKELETON_ROWS }).map((_, index) => (
        <div key={index} className='global-search__skeleton-row app-button--enter'>
          <span className='global-search__skeleton-icon' />
          <span className='global-search__skeleton-lines'>
            <span className='global-search__skeleton-line global-search__skeleton-line--title' />
            <span className='global-search__skeleton-line global-search__skeleton-line--subtitle' />
          </span>
        </div>
      ))}
    </div>
  );
}

function GlobalSearchSlashIcon({ command }: { command: SlashCommandId }) {
  switch (command) {
    case 'project':
      return <FolderKanban size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'tab':
      return <Layers size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'file':
      return <FileCode2 size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'git':
      return <GitBranch size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'task':
      return <ListChecks size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'form':
      return <Lock size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'automation':
      return <Play size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'agent':
      return <Bot size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'terminal':
      return <Terminal size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'browser':
      return <Globe size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'emulator':
      return <Smartphone size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'api':
      return <Braces size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    case 'music':
      return <Music size={SLASH_COMMAND_ICON_SIZE} strokeWidth={2.25} aria-hidden='true' />;
    default:
      return null;
  }
}

const GlobalSearchFooterHints = memo(function GlobalSearchFooterHintsComponent({
  mode,
  command,
  isCurlPayload,
}: {
  mode: 'free' | 'slash';
  command: SlashCommandId | null;
  isCurlPayload: boolean;
}) {
  const hintGroups = useMemo(() => {
    if (mode === 'slash' && command === 'agent') {
      return [
        { keys: ['Ctrl', 'V'], label: 'colar imagem' },
        { keys: ['Enter'], label: 'envia prompt ao agent' },
      ];
    }

    if (mode === 'slash' && command === 'terminal') {
      return [{ keys: ['Enter'], label: 'abre terminal e executa' }];
    }

    if (mode === 'slash' && command === 'browser') {
      return [{ keys: ['Enter'], label: 'abre navegador' }];
    }

    if (mode === 'slash' && command === 'api' && isCurlPayload) {
      return [{ keys: ['Enter'], label: 'importa cURL e envia request' }];
    }

    return [
      { keys: ['↑', '↓'], label: 'navegar' },
      { keys: ['Enter'], label: 'executar' },
      { keys: ['Esc'], label: 'fechar' },
    ];
  }, [command, isCurlPayload, mode]);

  return (
    <div className='global-search__footer'>
      {hintGroups.map((group, index) => (
        <span key={`${group.label}-${index}`} className='global-search__footer-group'>
          {index > 0 ? <span className='global-search__footer-separator'>·</span> : null}
          <span className='global-search__footer-keys'>
            {group.keys.map((key) => (
              <kbd key={key} className='global-search__key-badge'>
                {key}
              </kbd>
            ))}
          </span>
          <span className='global-search__footer-label'>{group.label}</span>
        </span>
      ))}
    </div>
  );
});

function GlobalSearchPaletteComponent() {
  const {
    visible,
    animationPhase,
    inputValue,
    commandInputValue,
    resolvedSlashProject,
    query,
    groups,
    flatResults,
    activeIndex,
    isSearching,
    slashMeta,
    parsed,
    agentPromptImages,
    inputRef,
    handleQueryChange,
    handleClose,
    handleExecute,
    handleKeyDown,
    handleRemoveAgentPromptImage,
    handlePromptDrop,
    handlePromptDragOver,
    selectActiveIndex,
  } = useGlobalSearchPalette();
  const projects = useProjectStore((state) => state.projects);

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();

    for (const project of projects) {
      map.set(project.id, project);
    }

    return map;
  }, [projects]);

  const highlightQuery = useMemo(
    () => resolveHighlightQuery(parsed.mode, parsed.freeText, parsed.slash),
    [parsed.freeText, parsed.mode, parsed.slash],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    return registerModalOpen();
  }, [visible]);

  const handleBackdropMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        handleClose();
      }
    },
    [handleClose],
  );

  const handleSelectResult = useCallback(
    (index: number) => () => {
      selectActiveIndex(index);
      void handleExecute();
    },
    [handleExecute, selectActiveIndex],
  );

  if (!visible) {
    return null;
  }

  const placeholder =
    parsed.mode === 'slash' && slashMeta
      ? slashMeta.placeholder
      : GLOBAL_SEARCH_PLACEHOLDER;

  return createPortal(
    <div
      className={`project-dialog-overlay global-search-backdrop overlay-backdrop--${animationPhase}`}
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className={`global-search overlay-popup--${animationPhase}`}
        role='dialog'
        aria-label={GLOBAL_SEARCH_NAME}
        onDragOver={handlePromptDragOver}
        onDrop={handlePromptDrop}
      >
        <div className='global-search__header'>
          {slashMeta ? (
            <span
              className={`global-search__badge global-search__badge--${slashMeta.id} app-button--enter`}
            >
              <GlobalSearchSlashIcon command={slashMeta.id} />
              {slashMeta.badge}
            </span>
          ) : parsed.mode === 'slash' ? (
            <Slash size={16} strokeWidth={2.25} className='global-search__icon' aria-hidden='true' />
          ) : (
            <Search size={16} strokeWidth={2.25} className='global-search__icon' aria-hidden='true' />
          )}
          {resolvedSlashProject ? (
            <span className='global-search__project-badge app-button--enter'>
              <GlobalSearchProjectThumb
                logo={resolvedSlashProject.logo}
                icon={resolvedSlashProject.icon}
                color={resolvedSlashProject.color}
                compact
              />
              <span className='global-search__project-badge-label'>{resolvedSlashProject.name}</span>
            </span>
          ) : null}
          <input
            ref={inputRef}
            type='text'
            className='global-search__input'
            value={commandInputValue}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete='off'
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {parsed.slash?.command === 'agent' && agentPromptImages.length > 0 ? (
          <div className='global-search__agent-images' role='list' aria-label='Imagens do prompt'>
            {agentPromptImages.map((image, index) => (
              <div key={image.id} className='global-search__agent-image' role='listitem'>
                <button
                  type='button'
                  className='global-search__agent-image-remove app-button app-button--enter'
                  aria-label={`Remover imagem ${index + 1}`}
                  onClick={() => handleRemoveAgentPromptImage(image.id)}
                >
                  <X size={12} strokeWidth={2.25} />
                </button>
                <img
                  src={image.dataUrl}
                  alt={`Imagem ${index + 1}`}
                  className='global-search__agent-image-thumb'
                  draggable={false}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className='global-search__results' role='listbox'>
          {groups.length === 0 && isSearching && query.trim() ? (
            <GlobalSearchResultsSkeleton />
          ) : (
            groups.map((group) => {
              if (group.kind === 'separator') {
                return (
                  <div key={group.id} className='global-search__separator' role='presentation'>
                    {group.label ?? 'Outros projetos'}
                  </div>
                );
              }

              const groupProject = group.projectId ? projectById.get(group.projectId) ?? null : null;
              const showGroupProjectLogo = shouldShowGroupProjectLogo(group, groupProject);

              return (
                <div key={group.id} className='global-search__group'>
                  {group.label ? (
                    <div
                      className={`global-search__group-label${showGroupProjectLogo ? ' global-search__group-label--project' : ''}`}
                    >
                      {showGroupProjectLogo && groupProject ? (
                        <GlobalSearchProjectThumb
                          logo={groupProject.logo}
                          icon={groupProject.icon}
                          color={groupProject.color}
                          compact
                        />
                      ) : null}
                      <span>{group.label}</span>
                    </div>
                  ) : null}
                  {group.items.map((item) => {
                    const flatIndex = flatResults.findIndex((entry) => entry.id === item.id);
                    const isActive = flatIndex === activeIndex;
                    const itemProject =
                      !showGroupProjectLogo &&
                      item.kind !== 'project' &&
                      item.projectId
                        ? projectById.get(item.projectId) ?? null
                        : null;

                    return (
                    <GlobalSearchResultItem
                      key={item.id}
                      item={item}
                      project={itemProject}
                      highlightQuery={highlightQuery}
                      isActive={isActive}
                      onSelect={handleSelectResult(flatIndex)}
                    />
                    );
                  })}
                </div>
              );
            })
          )}

          {isSearching && query.trim() && groups.length > 0 ? (
            <div className='global-search__loading-more' aria-hidden='true'>
              <div className='global-search__skeleton-row app-button--enter'>
                <span className='global-search__skeleton-icon' />
                <span className='global-search__skeleton-lines'>
                  <span className='global-search__skeleton-line global-search__skeleton-line--title' />
                  <span className='global-search__skeleton-line global-search__skeleton-line--subtitle' />
                </span>
              </div>
            </div>
          ) : null}

          {!isSearching && flatResults.length === 0 && query.trim() ? (
            <EmptyState
              icon={Search}
              message='Nenhum resultado encontrado'
              compact
              className='global-search__empty'
            />
          ) : null}
        </div>

        <GlobalSearchFooterHints
          mode={parsed.mode}
          command={parsed.slash?.command ?? null}
          isCurlPayload={parsed.slash?.isCurlPayload ?? false}
        />
      </div>
    </div>,
    document.body,
  );
}

interface GlobalSearchProjectThumbProps {
  logo: string | null;
  icon: string;
  color: string;
  compact?: boolean;
}

function GlobalSearchProjectThumbComponent({
  logo,
  icon,
  color,
  compact = false,
}: GlobalSearchProjectThumbProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(logo).then((dataUrl) => {
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
  }, [logo]);

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  const showLogo = Boolean(logoSrc) && !logoFailed;

  if (compact && !showLogo) {
    return <ProjectIconMark icon={icon} size={10} />;
  }

  if (showLogo) {
    return (
      <img
        key={logo}
        src={logoSrc ?? undefined}
        alt=''
        className={`global-search__project-logo${compact ? ' global-search__project-logo--compact' : ''}`}
        onError={handleLogoError}
      />
    );
  }

  return (
    <span
      className={`global-search__project-icon${compact ? ' global-search__project-icon--compact' : ''}`}
      style={{ backgroundColor: color }}
    >
      <ProjectIconMark icon={icon} size={compact ? 10 : 12} />
    </span>
  );
}

const GlobalSearchProjectThumb = memo(GlobalSearchProjectThumbComponent);

interface GlobalSearchResultItemProps {
  item: GlobalSearchResult;
  project: Project | null;
  highlightQuery: string;
  isActive: boolean;
  onSelect: () => void;
}

function GlobalSearchResultItemComponent({
  item,
  project,
  highlightQuery,
  isActive,
  onSelect,
}: GlobalSearchResultItemProps) {
  const slashCommandId =
    item.kind === 'slash-command'
      ? (item.payload as { command: string }).command
      : null;
  const projectPayload =
    item.kind === 'project' ? (item.payload as GlobalSearchProjectPayload) : null;

  return (
    <button
      type='button'
      role='option'
      aria-selected={isActive}
      className={`global-search__item app-button${isActive ? ' global-search__item--active' : ''}`}
      onClick={onSelect}
    >
      {projectPayload ? (
        <GlobalSearchProjectThumb
          logo={projectPayload.logo}
          icon={projectPayload.icon}
          color={projectPayload.color}
        />
      ) : slashCommandId ? (
        <span className={`global-search__badge global-search__badge--${slashCommandId}`}>
          <GlobalSearchSlashIcon command={slashCommandId as SlashCommandId} />
          {item.badge}
        </span>
      ) : (
        <div className='global-search__item-leading'>
          {project ? (
            <GlobalSearchProjectThumb
              logo={project.logo}
              icon={project.icon}
              color={project.color}
              compact
            />
          ) : null}
          <GlobalSearchResultKindIcon item={item} />
          {item.badge ? (
            <span
              className='global-search__item-badge'
              style={item.badgeColor ? { backgroundColor: item.badgeColor } : undefined}
            >
              {item.badge}
            </span>
          ) : null}
        </div>
      )}
      <span className='global-search__item-body'>
        <span className='global-search__item-title'>
          {highlightMatchingText(item.title, highlightQuery)}
        </span>
        {item.subtitle ? (
          <span className='global-search__item-subtitle'>{item.subtitle}</span>
        ) : null}
      </span>
    </button>
  );
}

const GlobalSearchResultItem = memo(GlobalSearchResultItemComponent);

export const GlobalSearchPalette = memo(GlobalSearchPaletteComponent);
