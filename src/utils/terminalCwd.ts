import { holdIncompleteMarkerSuffix } from '@/utils/terminalMarkerStream';

const NEXUS_CWD_MARKER_PREFIX = '\x1eNEXUS_CWD\x1f';
const NEXUS_CWD_MARKER_SUFFIX = '\x1e';
const CWD_MARKERS = [NEXUS_CWD_MARKER_PREFIX];
const CWD_HOLD_MARKERS = [
  NEXUS_CWD_MARKER_PREFIX,
  '\x1eNEXUS_CMD_START\x1e',
  '\x1eNEXUS_CMD_EXIT\x1f',
  '\x1eNEXUS_PROMPT\x1f',
  '\x1eNEXUS_PROMPT_HIDE\x1e',
];

export function createNexusCwdStreamParser(onCwdChange: (cwd: string) => void) {
  let pending = '';

  return (chunk: string): string => {
    const combined = pending + chunk;
    pending = '';
    let output = '';
    let cursor = 0;

    while (cursor < combined.length) {
      const start = combined.indexOf(NEXUS_CWD_MARKER_PREFIX, cursor);

      if (start === -1) {
        const remainder = combined.slice(cursor);
        const held = holdIncompleteMarkerSuffix(remainder, CWD_HOLD_MARKERS);
        const pendingIsCwdPrefix = CWD_MARKERS.some((marker) =>
          marker.startsWith(held.pending),
        );

        if (held.pending && !pendingIsCwdPrefix) {
          output += held.solid + held.pending;
          pending = '';
        } else {
          output += held.solid;
          pending = held.pending;
        }

        break;
      }

      output += combined.slice(cursor, start);
      const valueStart = start + NEXUS_CWD_MARKER_PREFIX.length;
      const end = combined.indexOf(NEXUS_CWD_MARKER_SUFFIX, valueStart);

      if (end === -1) {
        pending = combined.slice(start);
        break;
      }

      onCwdChange(combined.slice(valueStart, end));
      cursor = end + NEXUS_CWD_MARKER_SUFFIX.length;
    }

    return output;
  };
}

export function buildCdCommand(folderName: string): string {
  if (/^[a-zA-Z0-9._-]+$/.test(folderName)) {
    return `cd ${folderName}\n`;
  }

  return `cd '${folderName.replace(/'/g, "'\\''")}'\n`;
}

export function parseCdCommandLine(line: string): string | null {
  const trimmed = line.trim();

  if (!trimmed.startsWith('cd')) {
    return null;
  }

  const target = trimmed.slice(2).trim();

  if (!target || target === '-') {
    return null;
  }

  if (
    (target.startsWith("'") && target.endsWith("'")) ||
    (target.startsWith('"') && target.endsWith('"'))
  ) {
    return target.slice(1, -1);
  }

  return target;
}
