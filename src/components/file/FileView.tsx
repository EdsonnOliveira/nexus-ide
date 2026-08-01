import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor } from '@/components/file/CodeEditor';
import { GitDiffView } from '@/components/file/GitDiffView';
import type { FileTab } from '@/types';
import { useFileDirtyStore } from '@/stores/useFileDirtyStore';
import { isImageFileName } from '@/utils/fileViewMode';
import { resolveAgentGitPromptsForFile } from '@/utils/resolveAgentGitPromptsForFile';
import {
  getFileExternalRevision,
  subscribeFileExternalRevisions,
} from '@/utils/fileExternalRevision';
import { renderMarkdownPreview } from '@/utils/markdownPreview';

interface FileViewProps {
  tab: FileTab;
  isVisible: boolean;
  projectId?: string;
}

function FileViewComponent({ tab, isVisible, projectId }: FileViewProps) {
  const [content, setContent] = useState('');
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const savedContentRef = useRef('');
  const contentRef = useRef('');
  const isSavingRef = useRef(false);
  const fileExternalRevision = useSyncExternalStore(
    subscribeFileExternalRevisions,
    () => getFileExternalRevision(tab.filePath),
  );

  contentRef.current = content;
  isSavingRef.current = isSaving;

  const fileName = useMemo(
    () => tab.filePath.replace(/\\/g, '/').split('/').pop() ?? tab.title,
    [tab.filePath, tab.title],
  );
  const isDiffImage = tab.viewMode === 'diff' && isImageFileName(fileName);
  const isDiffTextEditable = tab.viewMode === 'diff' && !isDiffImage;

  const diffAgentPromptTurns = useMemo(() => {
    if (tab.viewMode !== 'diff') {
      return [];
    }

    if (!projectId) {
      return [];
    }

    const turns = resolveAgentGitPromptsForFile(projectId, tab.filePath, tab.diffRepoPath);

    if (turns.length > 0) {
      return turns;
    }

    const fallbackPrompt = tab.diffAgentPrompt?.trim();

    if (!fallbackPrompt) {
      return [];
    }

    return [
      {
        prompt: fallbackPrompt,
        changeCount: 1,
        completedAt: 0,
      },
    ];
  }, [projectId, tab.diffAgentPrompt, tab.diffRepoPath, tab.filePath, tab.viewMode]);

  const loadFile = useCallback(
    (isCancelled: () => boolean, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (tab.viewMode === 'diff' && isImageFileName(fileName)) {
        setLoading(false);
        setError(null);
        setSaveError(null);
        setMediaSrc(null);
        setContent('');
        savedContentRef.current = '';
        useFileDirtyStore.getState().setDirty(tab.id, false);
        return;
      }

      if (tab.viewMode === 'code' || tab.viewMode === 'preview' || isDiffTextEditable) {
        if (!silent) {
          setLoading(true);
        }

        setError(null);
        setSaveError(null);
        setMediaSrc(null);

        const applyContent = (nextContent: string) => {
          if (isCancelled()) {
            return;
          }

          setContent(nextContent);
          savedContentRef.current = nextContent;
          useFileDirtyStore.getState().setDirty(tab.id, false);
          setError(null);
          setLoading(false);
        };

        void window.nexus.files.readTextFile(tab.filePath).then((result) => {
          if (isCancelled()) {
            return;
          }

          if (result.ok) {
            applyContent(result.content);
            return;
          }

          if (tab.viewMode === 'diff' && typeof tab.diffAfter === 'string') {
            applyContent(tab.diffAfter);
            return;
          }

          setError(result.error);
          setContent('');
          savedContentRef.current = '';
          useFileDirtyStore.getState().setDirty(tab.id, false);
          setLoading(false);
        });

        return;
      }

      if (tab.viewMode === 'image' || tab.viewMode === 'pdf') {
        if (!silent) {
          setLoading(true);
        }

        setError(null);
        setContent('');
        useFileDirtyStore.getState().setDirty(tab.id, false);

        void window.nexus.files.readImageAsDataUrl(tab.filePath).then((dataUrl) => {
          if (isCancelled()) {
            return;
          }

          if (!dataUrl) {
            setError('Não foi possível carregar o arquivo');
            setMediaSrc(null);
            setLoading(false);
            return;
          }

          setMediaSrc(dataUrl);
          setError(null);
          setLoading(false);
        });

        return;
      }

      setLoading(false);
    },
    [fileName, isDiffTextEditable, tab.diffAfter, tab.filePath, tab.id, tab.viewMode],
  );

  useEffect(() => {
    let cancelled = false;

    loadFile(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadFile]);

  useEffect(() => {
    if (fileExternalRevision === 0) {
      return;
    }

    if (
      (tab.viewMode === 'code' || isDiffTextEditable) &&
      contentRef.current !== savedContentRef.current
    ) {
      return;
    }

    let cancelled = false;

    loadFile(() => cancelled, { silent: true });

    return () => {
      cancelled = true;
    };
  }, [fileExternalRevision, isDiffTextEditable, loadFile, tab.viewMode]);

  const isReadOnly = tab.viewMode === 'preview';
  const canEdit = (tab.viewMode === 'code' || isDiffTextEditable) && !isReadOnly;
  const fileDirPath = useMemo(
    () => tab.filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, ''),
    [tab.filePath],
  );
  const previewHtml = useMemo(
    () => (tab.viewMode === 'preview' && content ? renderMarkdownPreview(content, fileDirPath) : ''),
    [content, fileDirPath, tab.viewMode],
  );

  const persistContent = useCallback(async (): Promise<boolean> => {
    if (!canEdit || isSavingRef.current) {
      return false;
    }

    const nextContent = contentRef.current;

    if (nextContent === savedContentRef.current) {
      useFileDirtyStore.getState().setDirty(tab.id, false);
      return true;
    }

    setIsSaving(true);
    setSaveError(null);

    const result = await window.nexus.files.writeTextFile(tab.filePath, nextContent);

    setIsSaving(false);

    if (!result.ok) {
      setSaveError(result.error);
      return false;
    }

    savedContentRef.current = nextContent;
    useFileDirtyStore.getState().setDirty(tab.id, false);
    return true;
  }, [canEdit, tab.filePath, tab.id]);

  useEffect(() => {
    if (!canEdit) {
      useFileDirtyStore.getState().setDirty(tab.id, false);
      useFileDirtyStore.getState().registerSaveHandler(tab.id, null);
      return;
    }

    useFileDirtyStore.getState().setDirty(tab.id, content !== savedContentRef.current);
  }, [canEdit, content, tab.id]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }

    useFileDirtyStore.getState().registerSaveHandler(tab.id, persistContent);

    return () => {
      useFileDirtyStore.getState().registerSaveHandler(tab.id, null);
    };
  }, [canEdit, persistContent, tab.id]);

  const handleContentChange = useCallback((value: string) => {
    setContent((current) => (current === value ? current : value));
    setSaveError(null);
  }, []);

  const handleSave = useCallback(() => {
    void persistContent();
  }, [persistContent]);

  if (tab.viewMode === 'diff') {
    if (isDiffImage) {
      return (
        <GitDiffView
          filePath={tab.filePath}
          before={tab.diffBefore ?? ''}
          after={tab.diffAfter ?? ''}
          isVisible={isVisible}
          agentPromptTurns={diffAgentPromptTurns}
          diffRepoPath={tab.diffRepoPath}
          diffStaged={tab.diffStaged}
          diffUntracked={tab.diffUntracked}
        />
      );
    }

    if (loading) {
      return <div className='file-view file-view__state'>Carregando arquivo...</div>;
    }

    if (error) {
      return <div className='file-view file-view__state file-view__state--error'>{error}</div>;
    }

    return (
      <GitDiffView
        filePath={tab.filePath}
        before={tab.diffBefore ?? ''}
        after={content}
        isVisible={isVisible}
        agentPromptTurns={diffAgentPromptTurns}
        diffRepoPath={tab.diffRepoPath}
        diffStaged={tab.diffStaged}
        diffUntracked={tab.diffUntracked}
        onChange={handleContentChange}
        onSave={handleSave}
        saveStatus={isSaving || saveError ? (saveError ?? 'Salvando...') : null}
        saveError={Boolean(saveError)}
      />
    );
  }

  if (loading) {
    return <div className='file-view file-view__state'>Carregando arquivo...</div>;
  }

  if (error) {
    return <div className='file-view file-view__state file-view__state--error'>{error}</div>;
  }

  if (tab.viewMode === 'image' && mediaSrc) {
    return (
      <div className={`file-view file-view--image${isVisible ? '' : ' file-view--hidden'}`}>
        <img src={mediaSrc} alt={tab.title} className='file-view__image' draggable={false} />
      </div>
    );
  }

  if (tab.viewMode === 'pdf' && mediaSrc) {
    return (
      <div className={`file-view file-view--pdf${isVisible ? '' : ' file-view--hidden'}`}>
        <iframe src={mediaSrc} title={tab.title} className='file-view__pdf' />
      </div>
    );
  }

  if (tab.viewMode === 'preview') {
    return (
      <div className={`file-view file-view--preview${isVisible ? '' : ' file-view--hidden'}`}>
        <article
          className='markdown-preview file-view__preview-content'
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    );
  }

  return (
    <div className={`file-view file-view--code${isVisible ? '' : ' file-view--hidden'}`}>
      <CodeEditor
        filePath={tab.filePath}
        value={content}
        isVisible={isVisible}
        readOnly={isReadOnly}
        onChange={handleContentChange}
        onSave={handleSave}
      />
      {!isReadOnly && (isSaving || saveError) ? (
        <div className={`file-view__save-status${saveError ? ' file-view__save-status--error' : ''}`}>
          {saveError ?? 'Salvando...'}
        </div>
      ) : null}
    </div>
  );
}

export const FileView = memo(FileViewComponent);
