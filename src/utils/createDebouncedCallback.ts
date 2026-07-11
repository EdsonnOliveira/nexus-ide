export function createDebouncedCallback(
  callback: () => void,
  delayMs: number,
): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule: () => {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
