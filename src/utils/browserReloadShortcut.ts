export function isBrowserReloadShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  if (event.key === 'F5') {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  }

  if (event.key.toLowerCase() !== 'r') {
    return false;
  }

  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
