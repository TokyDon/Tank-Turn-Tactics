import { useState } from 'react';
import { useGame } from '../../context/GameContext';
import './Login.css';

export default function Login() {
  const { login, register, loading, error } = useGame();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'An error occurred');
    }
  }

  return (
    <div className="login-screen grid-texture">
      <div className="login-content">
        <header className="login-header">
          <div className="login-icon">⊕</div>
          <h1 className="login-title display">TANK TURN TACTICS</h1>
          <p className="login-sub tactical">STRATEGIC COMMAND INTERFACE</p>
        </header>

        <div className="login-card card">
          <div className="login-tabs">
            <button
              className={`login-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
            >
              SIGN IN
            </button>
            <button
              className={`login-tab ${mode === 'register' ? 'active' : ''}`}
              onClick={() => setMode('register')}
            >
              ENLIST
            </button>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label tactical">CALLSIGN</label>
              <input
                className="input"
                type="text"
                placeholder="Enter your callsign"
                value={username}
                onChange={e => setUsername(e.target.value)}
                maxLength={20}
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label tactical">PASSPHRASE</label>
              <input
                className="input"
                type="password"
                placeholder="Enter passphrase"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </div>

            {(error || localError) && (
              <div className="error-msg">{localError || error}</div>
            )}

            <button
              type="submit"
              className="btn btn-amber btn-full"
              disabled={loading || !username || !password}
            >
              {loading ? 'CONNECTING...' : mode === 'login' ? 'DEPLOY' : 'ENLIST NOW'}
            </button>
          </form>
        </div>

        <p className="login-footer tactical">
          PERSISTENT TACTICAL GRID GAME · DAILY AP DROPS
        </p>
      </div>
    </div>
  );
}
