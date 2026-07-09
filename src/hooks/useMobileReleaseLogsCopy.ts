import { useCallback, useEffect, useRef, useState } from 'react';
import { useMobileReleaseStore } from '@/stores/useMobileReleaseStore';

const COPY_FEEDBACK_MS = 1500;

export function useMobileReleaseLogsCopy(releaseUid: string) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const getReleaseLogs = useMobileReleaseStore((state) => state.getReleaseLogs);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const copyLogs = useCallback(
    async (event?: React.MouseEvent) => {
      event?.stopPropagation();

      if (loading) {
        return;
      }

      setLoading(true);

      try {
        const logs = getReleaseLogs(releaseUid);
        await navigator.clipboard.writeText(logs);
        setCopied(true);

        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current);
        }

        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopied(false);
          copyFeedbackTimeoutRef.current = null;
        }, COPY_FEEDBACK_MS);
      } catch {
        return;
      } finally {
        setLoading(false);
      }
    },
    [getReleaseLogs, loading, releaseUid],
  );

  return { copyLogs, loading, copied };
}
