import { holdIncompleteMarkerSuffix } from '@/utils/terminalMarkerStream';

const CMD_START = '\x1eNEXUS_CMD_START\x1e';
const CMD_EXIT_PREFIX = '\x1eNEXUS_CMD_EXIT\x1f';
const MARKER_SUFFIX = '\x1e';
const CMD_MARKERS = [CMD_START, CMD_EXIT_PREFIX];
const CMD_HOLD_MARKERS = [
  ...CMD_MARKERS,
  '\x1eNEXUS_CWD\x1f',
  '\x1eNEXUS_PROMPT\x1f',
  '\x1eNEXUS_PROMPT_HIDE\x1e',
];

export type TerminalCommandStatusEvent =
  | { type: 'start'; outputIndex: number }
  | { type: 'exit'; exitCode: number; outputIndex: number };

export function createNexusCommandStatusStreamParser(
  onEvent: (event: TerminalCommandStatusEvent) => void,
) {
  let pending = '';

  return (chunk: string): string => {
    const combined = pending + chunk;
    pending = '';
    let output = '';
    let cursor = 0;

    while (cursor < combined.length) {
      const startAt = combined.indexOf(CMD_START, cursor);
      const exitAt = combined.indexOf(CMD_EXIT_PREFIX, cursor);
      let at = -1;
      let kind: 'start' | 'exit' | null = null;

      if (startAt !== -1 && (exitAt === -1 || startAt <= exitAt)) {
        at = startAt;
        kind = 'start';
      } else if (exitAt !== -1) {
        at = exitAt;
        kind = 'exit';
      }

      if (at === -1 || !kind) {
        const remainder = combined.slice(cursor);
        const held = holdIncompleteMarkerSuffix(remainder, CMD_HOLD_MARKERS);
        const pendingIsCmdPrefix = CMD_MARKERS.some((marker) =>
          marker.startsWith(held.pending),
        );

        if (held.pending && !pendingIsCmdPrefix) {
          output += held.solid + held.pending;
          pending = '';
        } else {
          output += held.solid;
          pending = held.pending;
        }

        break;
      }

      output += combined.slice(cursor, at);

      if (kind === 'start') {
        onEvent({ type: 'start', outputIndex: output.length });
        cursor = at + CMD_START.length;
        continue;
      }

      const valueStart = at + CMD_EXIT_PREFIX.length;
      const end = combined.indexOf(MARKER_SUFFIX, valueStart);

      if (end === -1) {
        pending = combined.slice(at);
        break;
      }

      const rawCode = combined.slice(valueStart, end).trim();
      const exitCode = Number.parseInt(rawCode, 10);

      if (Number.isFinite(exitCode)) {
        onEvent({ type: 'exit', exitCode, outputIndex: output.length });
      }

      cursor = end + MARKER_SUFFIX.length;
    }

    return output;
  };
}

export function outputIndexToLine(baseLine: number, output: string, outputIndex: number): number {
  let line = baseLine;
  const limit = Math.max(0, Math.min(outputIndex, output.length));

  for (let index = 0; index < limit; index += 1) {
    if (output[index] === '\n') {
      line += 1;
    }
  }

  return line;
}
