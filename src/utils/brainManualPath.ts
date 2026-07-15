export function resolveBrainManualPath(projectPath: string): string {
  const normalized = projectPath.replace(/[\\/]+$/, '');
  return `${normalized}/.nexus/brain/manual.json`;
}
