import { useCallback, useEffect, useRef, useState } from 'react';

const COPY_FEEDBACK_MS = 1500;

export function useVercelDeploymentLogsCopy(deploymentUid: string) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

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

      if (loading || !window.nexus?.vercel) {
        return;
      }

      setLoading(true);

      try {
        const logs = await window.nexus.vercel.getDeploymentLogs(deploymentUid);
        const text = logs.trim() || 'Nenhum log disponível para este deploy.';

        await navigator.clipboard.writeText(text);
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
    [deploymentUid, loading],
  );

  return { copyLogs, loading, copied };
}
