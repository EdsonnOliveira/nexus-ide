import { useCallback, useState } from 'react';
import type { ApiEnvironment, ApiHttpResponse, ApiRequest } from '@/types/api';
import { substituteApiVariables, variablesFromEnvironment } from '@/utils/substituteApiVariables';

export function useApiRequest(activeEnvironment: ApiEnvironment | null) {
  const [request, setRequest] = useState<ApiRequest | null>(null);
  const [response, setResponse] = useState<ApiHttpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const sendRequest = useCallback(
    async (nextRequest: ApiRequest) => {
      setIsSending(true);
      setError(null);

      try {
        const variables = variablesFromEnvironment(activeEnvironment);
        const resolvedUrl = substituteApiVariables(nextRequest.url, variables);

        if (resolvedUrl.includes('{{')) {
          throw new Error('Defina as variáveis de ambiente antes de enviar.');
        }

        const result = await window.nexus.api.sendRequest({
          request: nextRequest,
          variables,
        });
        setResponse(result);
        return result;
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : 'Falha ao enviar request.';
        setError(message);
        setResponse(null);
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [activeEnvironment],
  );

  return {
    request,
    setRequest,
    response,
    setResponse,
    error,
    isSending,
    sendRequest,
  };
}
