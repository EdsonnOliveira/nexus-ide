import { ExternalLink } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor } from '@/components/file/CodeEditor';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  getProjectKindBadgeLabel,
  type ExplorerEnvHint,
} from '@/utils/explorerEnvHints';
import {
  getFileExternalRevision,
  subscribeFileExternalRevisions,
} from '@/utils/fileExternalRevision';

interface ExplorerEnvEditorModalProps {
  hint: ExplorerEnvHint;
  onClose: () => void;
  onOpenAsTab: (hint: ExplorerEnvHint) => void;
}

function ExplorerEnvEditorModalComponent({
  hint,
  onClose,
  onOpenAsTab,
}: ExplorerEnvEditorModalProps) {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const savedContentRef = useRef('');
  const contentRef = useRef('');
  const isSavingRef = useRef(false);
  const fileExternalRevision = useSyncExternalStore(
    subscribeFileExternalRevisions,
    () => getFileExternalRevision(hint.filePath),
  );

  contentRef.current = content;
  isSavingRef.current = isSaving;

  const loadFile = useCallback(
    (isCancelled: () => boolean, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      setError(null);
      setSaveError(null);

      void window.nexus.files.readTextFile(hint.filePath).then((result) => {
        if (isCancelled()) {
          return;
        }

        if (!result.ok) {
          setError(result.error);
          setContent('');
          savedContentRef.current = '';
          setIsDirty(false);
          setLoading(false);
          return;
        }

        setContent(result.content);
        savedContentRef.current = result.content;
        setIsDirty(false);
        setError(null);
        setLoading(false);
      });
    },
    [hint.filePath],
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

    if (contentRef.current !== savedContentRef.current) {
      return;
    }

    let cancelled = false;

    loadFile(() => cancelled, { silent: true });

    return () => {
      cancelled = true;
    };
  }, [fileExternalRevision, loadFile]);

  const persistContent = useCallback(async (): Promise<boolean> => {
    if (isSavingRef.current) {
      return false;
    }

    const nextContent = contentRef.current;

    if (nextContent === savedContentRef.current) {
      setIsDirty(false);
      return true;
    }

    setIsSaving(true);
    setSaveError(null);

    const result = await window.nexus.files.writeTextFile(hint.filePath, nextContent);

    setIsSaving(false);

    if (!result.ok) {
      setSaveError(result.error);
      return false;
    }

    savedContentRef.current = nextContent;
    setIsDirty(false);
    return true;
  }, [hint.filePath]);

  const handleContentChange = useCallback((value: string) => {
    setContent((current) => (current === value ? current : value));
    setIsDirty(value !== savedContentRef.current);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(() => {
    void persistContent();
  }, [persistContent]);

  const handleOpenAsTab = useCallback(
    (requestClose: () => void) => {
      onOpenAsTab(hint);
      requestClose();
    },
    [hint, onOpenAsTab],
  );

  return (
    <AnimatedModal
      onClose={onClose}
      panelClassName='project-dialog explorer-env-editor-modal'
      closeDisabled={isSaving}
    >
      {(requestClose) => (
        <>
          <div className='explorer-env-editor-modal__header'>
            <div className='explorer-env-editor-modal__title-row'>
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
              <span className='project-dialog__title explorer-env-editor-modal__title'>
                {hint.fileName}
              </span>
              {isDirty ? (
                <span className='explorer-env-editor-modal__dirty-dot' aria-label='Alterações não salvas' />
              ) : null}
            </div>
            <button
              type='button'
              className='explorer-env-editor-modal__open-tab app-button app-button--enter'
              onClick={() => handleOpenAsTab(requestClose)}
            >
              <ExternalLink size={13} strokeWidth={2.25} aria-hidden='true' />
              Abrir arquivo
            </button>
          </div>
          <p className='explorer-env-editor-modal__path' title={hint.filePath}>
            {hint.projectDirName}/{hint.fileName}
          </p>
          <div className='explorer-env-editor-modal__body'>
            {loading ? (
              <div className='explorer-env-editor-modal__state'>Carregando arquivo...</div>
            ) : null}
            {!loading && error ? (
              <div className='explorer-env-editor-modal__state explorer-env-editor-modal__state--error'>
                {error}
              </div>
            ) : null}
            {!loading && !error ? (
              <CodeEditor
                filePath={hint.filePath}
                value={content}
                isVisible
                onChange={handleContentChange}
                onSave={handleSave}
              />
            ) : null}
          </div>
          {isSaving || saveError ? (
            <div
              className={`explorer-env-editor-modal__save-status${saveError ? ' explorer-env-editor-modal__save-status--error' : ''}`}
            >
              {saveError ?? 'Salvando...'}
            </div>
          ) : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              disabled={isSaving}
              onClick={requestClose}
            >
              Fechar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button'
              disabled={isSaving || !isDirty}
              onClick={handleSave}
            >
              Salvar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const ExplorerEnvEditorModal = memo(ExplorerEnvEditorModalComponent);
