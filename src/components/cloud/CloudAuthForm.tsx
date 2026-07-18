import { memo, useState } from 'react';
import { cloudSupabase } from '@/lib/nexusCloud';
import { useCloudStore } from '@/stores/useCloudStore';

function CloudAuthFormComponent() {
  const refresh = useCloudStore((state) => state.refresh);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const client = cloudSupabase;
  if (!client) {
    return null;
  }

  return (
    <div className='cloud-devices-drawer__item'>
      <strong>Entrar no Nexus Cloud</strong>
      <input
        className='anchored-select__trigger'
        style={{ width: '100%', padding: '0.5rem' }}
        type='email'
        placeholder='Email'
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        className='anchored-select__trigger'
        style={{ width: '100%', padding: '0.5rem' }}
        type='password'
        placeholder='Senha'
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? <span className='badge badge--danger'>{error}</span> : null}
      <button
        type='button'
        className='app-button app-button--enter'
        disabled={loading || !email || !password}
        onClick={() => {
          void (async () => {
            setLoading(true);
            setError(null);
            const { error: loginError } = await client.auth.signInWithPassword({
              email,
              password,
            });
            if (loginError) {
              const signUp = await client.auth.signUp({ email, password });
              if (signUp.error) {
                setError(signUp.error.message);
                setLoading(false);
                return;
              }
            }
            await refresh();
            setLoading(false);
          })();
        }}
      >
        Entrar / Criar conta
      </button>
    </div>
  );
}

export const CloudAuthForm = memo(CloudAuthFormComponent);
