import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '@/components/file/CodeEditor';
import type { FileTab } from '@/types';

interface FileViewProps {
  tab: FileTab;
  isVisible: boolean;
}

function FileViewComponent({ tab, isVisible }: FileViewProps) {
  const [content, setContent] = useState('');
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const savedContentRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    if (tab.viewMode === 'diff') {
      setLoading(false);
      setError(null);
      setSaveError(null);
      setMediaSrc(null);
      setContent(tab.diffPatch ?? '');
      savedContentRef.current = tab.diffPatch ?? '';
      return undefined;
    }

    if (tab.viewMode === 'code') {
      setLoading(true);
      setError(null);
      setSaveError(null);
      setMediaSrc(null);

      void window.nexus.files.readTextFile(tab.filePath).then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok) {
          setError(result.error);
          setContent('');
          savedContentRef.current = '';
          setLoading(false);
          return;
        }

        setContent(result.content);
        savedContentRef.current = result.content;
        setError(null);
        setLoading(false);
      });

      return () => {
        cancelled = true;
      };
    }

    if (tab.viewMode === 'image' || tab.viewMode === 'pdf') {
      setLoading(true);
      setError(null);
      setContent('');

      void window.nexus.files.readImageAsDataUrl(tab.filePath).then((dataUrl) => {
        if (cancelled) {
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

      return () => {
        cancelled = true;
      };
    }

    setLoading(false);
    return undefined;
  }, [tab.diffPatch, tab.filePath, tab.viewMode]);

  const isReadOnly = tab.viewMode === 'diff';

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving || content === savedContentRef.current) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    const result = await window.nexus.files.writeTextFile(tab.filePath, content);

    setIsSaving(false);

    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    savedContentRef.current = content;
  }, [content, isSaving, tab.filePath]);

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

  return (
    <div className={`file-view file-view--code${isVisible ? '' : ' file-view--hidden'}${isReadOnly ? ' file-view--diff' : ''}`}>
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
