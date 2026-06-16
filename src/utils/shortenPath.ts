export function shortenPath(fullPath: string): string {
  const homePrefix = '/Users/';

  if (fullPath.includes('/Users/')) {
    const parts = fullPath.split('/');
    const userIndex = parts.indexOf('Users');

    if (userIndex !== -1 && parts.length > userIndex + 1) {
      return `~/${parts.slice(userIndex + 2).join('/')}`;
    }
  }

  if (fullPath.startsWith(homePrefix)) {
    return fullPath.replace(/^\/Users\/[^/]+/, '~');
  }

  return fullPath;
}
