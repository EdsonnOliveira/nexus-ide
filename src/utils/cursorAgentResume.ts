export function buildCursorAgentResumeCommand(chatId: string, workspacePath: string): string {
  const shellPath =
    workspacePath.includes(' ') || workspacePath.includes("'")
      ? `'${workspacePath.replace(/'/g, "'\\''")}'`
      : workspacePath;

  return `cursor-agent --resume ${chatId} --workspace ${shellPath}`;
}

export function parseResumeChatIdFromCommand(command: string): string | null {
  const match = command.match(/--resume\s+(\S+)/);

  return match?.[1] ?? null;
}
