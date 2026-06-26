export function buildCursorAgentResumeCommand(chatId: string, workspacePath: string): string {
  const shellPath =
    workspacePath.includes(' ') || workspacePath.includes("'")
      ? `'${workspacePath.replace(/'/g, "'\\''")}'`
      : workspacePath;

  return `cursor-agent --resume ${chatId} --workspace ${shellPath}`;
}
