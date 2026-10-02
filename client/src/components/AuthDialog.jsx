import { useState } from 'react';
import { describeError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Dialog } from './Dialog.jsx';

/**
 * Sign in / create account.
 *
 * @param {object} props
 * @param {'login' | 'register' | null} props.mode `null` keeps the dialog closed.
 * @param {(mode: 'login' | 'register') => void} props.onModeChange
 * @param {() => void} props.onClose
 */
export function AuthDialog({ mode, onModeChange, onClose }) {
  return (
    <Dialog open={mode !== null} onClose={onClose} labelledBy="auth-title">
      {mode !== null && <AuthForm mode={mode} onModeChange={onModeChange} onClose={onClose} />}
    </Dialog>
  );
}

function AuthForm({ mode, onModeChange, onClose }) {
  const { login, register } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (isLogin ? login : register)(email, password);
      toast(isLogin ? 'Signed in' : 'Account created');
      onClose();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 id="auth-title">{isLogin ? 'Sign in' : 'Create account'}</h2>
      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="btn link"
          type="button"
          onClick={() => onModeChange(isLogin ? 'register' : 'login')}
        >
          {isLogin ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={busy}>
          {isLogin ? 'Sign in' : 'Create account'}
        </button>
      </div>
    </form>
  );
}
