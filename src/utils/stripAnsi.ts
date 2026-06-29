const ANSI_PATTERN =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

const CSI_ORPHAN_PATTERN = /\[\??[\d;]*[A-Za-z]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

export function cleanAgentPtyChunk(value: string): string {
  return stripAnsi(value)
    .replace(CSI_ORPHAN_PATTERN, '')
    .replace(/(?:\x9b|\x1b)\[[0-9:;]*[A-Za-z]/g, '')
    .replace(/\x1b/g, '');
}
