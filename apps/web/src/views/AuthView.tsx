import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useWebStore } from '../store';
import nexusLogo from '../assets/nexus-logo-icon.png';

function authErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message);
    if (message.toLowerCase().includes('invalid login')) {
      return 'Email ou senha inválidos';
    }
    if (message.toLowerCase().includes('email not confirmed')) {
      return 'Confirme o email antes de entrar';
    }
    return message;
  }
  return 'Falha na autenticação';
}

export function AuthView() {
  const setSession = useWebStore((state) => state.setSession);
  const [email, setEmail] = useState('edsonpinheiroliveira@gmail.com');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || !email.trim() || !password) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === 'login') {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (loginError) {
          throw loginError;
        }
        setSession(data.session);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          throw signUpError;
        }
        if (data.session) {
          setSession(data.session);
        } else {
          setError('Conta criada. Entre com o email e a senha.');
          setMode('login');
        }
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='auth'>
      <form className='auth__card glass-panel app-button--enter' onSubmit={(event) => void submit(event)}>
        <div className='auth__brand'>
          <img src={nexusLogo} alt='Nexus' width={48} height={48} className='auth__logo' draggable={false} />
          <div>
            <h1>Nexus</h1>
            <p className='muted'>Maestro · o mesmo agente, agora no Nexus</p>
          </div>
        </div>
        <label className='stack'>
          <span className='muted'>Email</span>
          <input
            className='input'
            type='email'
            autoComplete='email'
            value={email}
            disabled={loading}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className='stack'>
          <span className='muted'>Senha</span>
          <input
            className='input'
            type='password'
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <div className='auth__error'>{error}</div> : null}
        <button
          type='submit'
          className='app-button app-button--primary app-button--enter'
          disabled={loading || !email.trim() || !password}
        >
          {loading ? (
            <span className='row'>
              <LoaderCircle size={16} className='spin' />
              {mode === 'login' ? 'Entrando...' : 'Criando...'}
            </span>
          ) : mode === 'login' ? (
            'Entrar'
          ) : (
            'Criar conta'
          )}
        </button>
        <button
          type='button'
          className='app-button'
          disabled={loading}
          onClick={() => {
            setError(null);
            setMode((current) => (current === 'login' ? 'signup' : 'login'));
          }}
        >
          {mode === 'login' ? 'Criar conta' : 'Já tenho conta'}
        </button>
      </form>
    </div>
  );
}
