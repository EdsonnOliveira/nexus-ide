export function isBrowserFocusUrlShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  if (event.key.toLowerCase() !== 'l') {
    return false;
  }

  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
