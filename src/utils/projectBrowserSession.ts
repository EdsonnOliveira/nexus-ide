export function getProjectBrowserPartition(projectId: string): string {
  return `persist:nexus-browser-${projectId}`;
}
