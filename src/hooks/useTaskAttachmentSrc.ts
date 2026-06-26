import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskAttachment } from '@/types/task';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

function resolveAttachmentMimeType(attachment: Pick<TaskAttachment, 'path' | 'mimeType'>): string {
  if (attachment.mimeType?.trim()) {
    return attachment.mimeType.trim();
  }

  const extension = attachment.path.split('.').pop()?.toLowerCase() ?? '';

  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

export function useTaskAttachmentSrc(
  attachment: Pick<TaskAttachment, 'path' | 'mimeType'> | undefined,
): {
  src: string | null;
  failed: boolean;
  handleImageError: () => void;
} {
  const path = attachment?.path;
  const localUrl = useMemo(() => (path ? window.nexus.files.toLocalUrl(path) : null), [path]);
  const [src, setSrc] = useState<string | null>(localUrl);
  const [failed, setFailed] = useState(false);
  const fallbackLoadingRef = useRef(false);

  useEffect(() => {
    if (!path || !attachment) {
      setSrc(null);
      setFailed(false);
      fallbackLoadingRef.current = false;
      return;
    }

    setFailed(false);
    fallbackLoadingRef.current = false;
    setSrc(window.nexus.files.toLocalUrl(path));
  }, [attachment, path]);

  const loadBase64 = useCallback(async () => {
    if (!path || !attachment) {
      setFailed(true);
      setSrc(null);
      return;
    }

    try {
      const base64 = await window.nexus.tasks.readAttachment(path);
      const mime = resolveAttachmentMimeType(attachment);
      setSrc(`data:${mime};base64,${base64}`);
      setFailed(false);
    } catch {
      setFailed(true);
      setSrc(null);
    }
  }, [attachment, path]);

  const handleImageError = useCallback(() => {
    if (!path || !attachment) {
      setFailed(true);
      return;
    }

    if (src?.startsWith('data:')) {
      setFailed(true);
      setSrc(null);
      return;
    }

    if (fallbackLoadingRef.current) {
      return;
    }

    fallbackLoadingRef.current = true;
    void loadBase64().finally(() => {
      fallbackLoadingRef.current = false;
    });
  }, [attachment, loadBase64, path, src]);

  return { src, failed, handleImageError };
}
