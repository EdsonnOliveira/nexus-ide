import {
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { buildGitDiffLines } from '@/utils/gitDiffLines';

const MAX_DIFF_DECORATION_CELLS = 1_500_000;
const MAX_DIFF_DECORATION_CHARS = 180_000;
const DIFF_DECORATION_DEBOUNCE_MS = 200;

const setGitDiffDecorations = StateEffect.define<DecorationSet>();

class RemovedLinesWidget extends WidgetType {
  constructor(private readonly lines: string[]) {
    super();
  }

  eq(other: RemovedLinesWidget): boolean {
    return this.lines.length === other.lines.length && this.lines.every((line, index) => line === other.lines[index]);
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'git-diff-editor__removed-block';
    root.setAttribute('contenteditable', 'false');

    for (const line of this.lines) {
      const row = document.createElement('div');
      row.className = 'git-diff-editor__removed-line';
      row.textContent = line.length > 0 ? line : ' ';
      root.appendChild(row);
    }

    return root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function splitLineCount(text: string): number {
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const count = normalized.split('\n').length;
  return normalized.endsWith('\n') ? Math.max(count - 1, 0) : count;
}

function shouldSkipDiffDecorations(before: string, after: string): boolean {
  if (before.length + after.length > MAX_DIFF_DECORATION_CHARS) {
    return true;
  }

  return splitLineCount(before) * splitLineCount(after) > MAX_DIFF_DECORATION_CELLS;
}

function mapLineDecorations(
  before: string,
  after: string,
  doc: { line: (n: number) => { from: number; to: number }; lines: number },
): DecorationSet {
  if (shouldSkipDiffDecorations(before, after)) {
    return Decoration.none;
  }

  const diffLines = buildGitDiffLines(before, after);
  const builder = new RangeSetBuilder<Decoration>();
  let pendingRemoves: string[] = [];
  const events: Array<
    | { type: 'remove'; lineNumber: number; lines: string[]; side: -1 | 1 }
    | { type: 'add'; lineNumber: number }
  > = [];

  for (const line of diffLines) {
    if (line.kind === 'remove') {
      pendingRemoves.push(line.content);
      continue;
    }

    if (pendingRemoves.length > 0) {
      events.push({
        type: 'remove',
        lineNumber: line.newLineNumber ?? doc.lines + 1,
        lines: pendingRemoves,
        side: -1,
      });
      pendingRemoves = [];
    }

    if (line.kind === 'add' && line.newLineNumber !== null) {
      events.push({ type: 'add', lineNumber: line.newLineNumber });
    }
  }

  if (pendingRemoves.length > 0) {
    events.push({
      type: 'remove',
      lineNumber: Math.max(doc.lines, 1),
      lines: pendingRemoves,
      side: doc.lines === 0 ? -1 : 1,
    });
  }

  events.sort((left, right) => {
    if (left.lineNumber !== right.lineNumber) {
      return left.lineNumber - right.lineNumber;
    }

    if (left.type !== right.type) {
      return left.type === 'remove' ? -1 : 1;
    }

    return 0;
  });

  if (doc.lines === 0) {
    for (const event of events) {
      if (event.type === 'remove') {
        builder.add(
          0,
          0,
          Decoration.widget({
            widget: new RemovedLinesWidget(event.lines),
            block: true,
            side: -1,
          }),
        );
      }
    }

    return builder.finish();
  }

  for (const event of events) {
    if (event.type === 'remove') {
      const lineNumber = Math.min(Math.max(event.lineNumber, 1), doc.lines);
      const line = doc.line(lineNumber);
      const pos = event.side === 1 ? line.to : line.from;
      builder.add(
        pos,
        pos,
        Decoration.widget({
          widget: new RemovedLinesWidget(event.lines),
          block: true,
          side: event.side,
        }),
      );
      continue;
    }

    if (event.lineNumber < 1 || event.lineNumber > doc.lines) {
      continue;
    }

    const line = doc.line(event.lineNumber);
    builder.add(line.from, line.from, Decoration.line({ class: 'git-diff-editor__line--add' }));
  }

  return builder.finish();
}

export function createGitDiffHighlightExtension(before: string): Extension {
  const baseline = before;
  let debounceTimer: number | null = null;
  let pendingView: EditorView | null = null;
  let initialScheduled = false;

  const scheduleDecorations = (view: EditorView) => {
    pendingView = view;

    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      const target = pendingView;
      pendingView = null;

      if (!target) {
        return;
      }

      target.dispatch({
        effects: setGitDiffDecorations.of(
          mapLineDecorations(baseline, target.state.doc.toString(), target.state.doc),
        ),
      });
    }, DIFF_DECORATION_DEBOUNCE_MS);
  };

  const decorationsField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setGitDiffDecorations)) {
          return effect.value;
        }
      }

      if (transaction.docChanged) {
        return decorations.map(transaction.changes);
      }

      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return [
    decorationsField,
    ViewPlugin.fromClass(
      class {
        constructor(view: EditorView) {
          if (!initialScheduled) {
            initialScheduled = true;
            scheduleDecorations(view);
          }
        }

        update(update: ViewUpdate) {
          if (!update.docChanged) {
            return;
          }

          scheduleDecorations(update.view);
        }

        destroy() {
          if (debounceTimer !== null) {
            window.clearTimeout(debounceTimer);
            debounceTimer = null;
          }

          pendingView = null;
        }
      },
    ),
  ];
}

export function getGitDiffEditableChangeLineNumbers(before: string, after: string): number[] {
  if (shouldSkipDiffDecorations(before, after)) {
    return [];
  }

  const lineNumbers: number[] = [];
  let pendingRemoves = false;

  for (const line of buildGitDiffLines(before, after)) {
    if (line.kind === 'remove') {
      pendingRemoves = true;
      continue;
    }

    if (pendingRemoves && line.newLineNumber !== null) {
      lineNumbers.push(line.newLineNumber);
      pendingRemoves = false;
    }

    if (line.kind === 'add' && line.newLineNumber !== null) {
      if (lineNumbers[lineNumbers.length - 1] !== line.newLineNumber) {
        lineNumbers.push(line.newLineNumber);
      }
    }
  }

  return lineNumbers;
}
