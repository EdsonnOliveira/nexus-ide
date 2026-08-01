import { monokaiInit } from '@uiw/codemirror-theme-monokai';
import CodeMirror from '@uiw/react-codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { memo, useMemo, useRef } from 'react';
import { getCodeEditorExtensions } from '@/utils/codeEditorLanguage';
import { createGitDiffHighlightExtension } from '@/utils/gitDiffEditorExtensions';

const editorTheme = monokaiInit({
  settings: {
    background: 'transparent',
    gutterBackground: 'transparent',
    lineHighlight: 'transparent',
    gutterForeground: 'rgba(255, 255, 255, 0.38)',
  },
});

interface CodeEditorProps {
  filePath: string;
  value: string;
  isVisible: boolean;
  readOnly?: boolean;
  diffBefore?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCreateEditor?: (view: EditorView) => void;
}

function CodeEditorComponent({
  filePath,
  value,
  isVisible,
  readOnly = false,
  diffBefore,
  onChange,
  onSave,
  onCreateEditor,
}: CodeEditorProps) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const isDiffEditor = typeof diffBefore === 'string';

  const extensions = useMemo(
    () => [
      ...getCodeEditorExtensions(filePath),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      ...(isDiffEditor ? [createGitDiffHighlightExtension(diffBefore)] : []),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            if (!readOnly) {
              onSaveRef.current();
            }

            return true;
          },
        },
      ]),
      EditorView.theme({
        '&': {
          height: '100%',
          backgroundColor: 'transparent',
        },
        '.cm-scroller': {
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          lineHeight: '1.6',
        },
        '.cm-gutters': {
          borderRight: 'none',
        },
        '.cm-content': {
          caretColor: '#f8f8f2',
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: '#f8f8f2',
        },
      }),
      EditorView.lineWrapping,
    ],
    [diffBefore, filePath, isDiffEditor, readOnly],
  );

  return (
    <CodeMirror
      value={value}
      theme={editorTheme}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={onCreateEditor}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: false,
      }}
      className={`file-view__editor${isDiffEditor ? ' file-view__editor--diff' : ''}${isVisible ? '' : ' file-view__editor--hidden'}`}
    />
  );
}

export const CodeEditor = memo(CodeEditorComponent);
