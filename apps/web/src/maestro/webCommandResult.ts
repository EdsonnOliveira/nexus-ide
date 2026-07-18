import { supabase } from '../lib/supabase';

export async function waitForCommandResult(
  commandId: string,
  timeoutMs = 20000,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { data, error } = await supabase
      .from('commands')
      .select('status,result,error_message')
      .eq('id', commandId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data?.status === 'completed' && data.result && typeof data.result === 'object') {
      return data.result as Record<string, unknown>;
    }

    if (data?.status === 'failed' || data?.status === 'cancelled') {
      throw new Error(
        typeof data.error_message === 'string' && data.error_message
          ? data.error_message
          : 'Falha ao executar comando remoto',
      );
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 250);
    });
  }

  throw new Error('Timeout ao aguardar comando remoto');
}
