import path from 'node:path';

export function assertPathInsideSandbox(filePath: string, allowedRoots: string[]): string {
  const resolved = path.resolve(filePath);
  const allowed = allowedRoots.some((root) => {
    const rootResolved = path.resolve(root);
    return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
  });

  if (!allowed) {
    throw new Error(`Path outside sandbox: ${resolved}`);
  }

  return resolved;
}

export function relativeToRoot(filePath: string, root: string): string {
  return path.relative(path.resolve(root), path.resolve(filePath));
}
