export function holdIncompleteMarkerSuffix(
  value: string,
  markers: string[],
): { solid: string; pending: string } {
  if (!value) {
    return { solid: '', pending: '' };
  }

  const maxLen = markers.reduce((max, marker) => Math.max(max, marker.length), 0);

  for (let len = Math.min(value.length, Math.max(0, maxLen - 1)); len >= 1; len -= 1) {
    const suffix = value.slice(-len);

    if (markers.some((marker) => marker.startsWith(suffix))) {
      return {
        solid: value.slice(0, -len),
        pending: suffix,
      };
    }
  }

  return { solid: value, pending: '' };
}
