import { useState } from 'react';
import { useGame } from '../../context/GameContext';
import * as api from '../../services/api';
import { ApiError } from '../../services/api';
import './Login.css';

type View = 'auth' | 'codes' | 'recover';

export default function Login() {
  const { login, register, confirmRegistration, loading } = useGame();

  const [view, setView]         = useState<View>('auth');
  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [localError, setLocalError]   = useState('');

  // Codes view
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // Recover view
  const [rUsername, setRUsername] = useState('');
  const [rCode,     setRCode]     = useState('');
  const [rPassword, setRPassword] = useState('');
  const [rLoading,  setRLoading]  = useState(false);

  // ── Auth form ──────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    setSuggestions([]);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        const codes = await register(username, password);
        setRecoveryCodes(codes);
        setView('codes');
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && Array.isArray(err.data.suggestions)) {
        setSuggestions(err.data.suggestions as string[]);
      }
      setLocalError(err instanceof Error ? err.message : 'An error occurred');
    }
  }

  // ── Account recovery ──────────────────────────────────────────
  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    setRLoading(true);
    try {
      // Reset password via recovery code, then sign in with the new password
      await api.recoverAccount(rUsername, rCode, rPassword);
      await login(rUsername, rPassword);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setRLoading(false);
    }
  }

  function copyAll() {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ── Recovery codes screen ─────────────────────────────────────
  if (view === 'codes') {
    return (
      <div className="login-screen grid-texture">
        <div className="login-content">
          <header className="login-header">
            <div className="login-icon">⊕</div>
            <h1 className="login-title display">TANK TURN TACTICS</h1>
          </header>
          <div className="codes-card card">
            <div className="codes-header">
              <span className="codes-title display">SAVE RECOVERY CODES</span>
              <p className="codes-desc tactical">
                These 8 codes are shown <strong>once only</strong>. If you lose your
                passphrase, any single code lets you regain access and set a new one.
                Each code works once then is destroyed.
              </p>
            </div>
            <div className="codes-grid">
              {recoveryCodes.map((code, i) => (
                <div key={i} className="code-chip tactical">{code}</div>
              ))}
            </div>
            <div className="codes-actions">
              <button
                className={`btn ${copied ? 'btn-ghost' : 'btn-amber'} btn-full`}
                onClick={copyAll}
              >
                {copied ? '✓ COPIED TO CLIPBOARD' : '⊕ COPY ALL CODES'}
              </button>
              <button
                className="btn btn-ghost btn-full"
                onClick={() => confirmRegistration()}
              >
                I HAVE SAVED THEM — CONTINUE →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Account recovery screen ───────────────────────────────────
  if (view === 'recover') {
    return (
      <div className="login-screen grid-texture">
        <div className="login-content">
          <header className="login-header">
            <div className="login-icon">⊕</div>
            <h1 className="login-title display">TANK TURN TACTICS</h1>
            <p className="login-sub tactical">ACCOUNT RECOVERY</p>
          </header>
          <div className="login-card card">
            <div className="recover-header tactical">
              USE A RECOVERY CODE TO RESET YOUR PASSPHRASE
            </div>
            <form className="login-form" onSubmit={handleRecover}>
              <div className="form-group">
                <label className="form-label tactical">CALLSIGN</label>
                <input
                  className="input" type="text" value={rUsername}
                  onChange={e => setRUsername(e.target.value)}
                  autoCapitalize="off" autoComplete="username" required
                />
              </div>
              <div className="form-group">
                <label className="form-label tactical">RECOVERY CODE</label>
                <input
                  className="input code-input" type="text" value={rCode}
                  onChange={e => setRCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX" autoCapitalize="characters"
                  autoComplete="off" spellCheck={false} required
                />
                <span className="form-hint tactical">One of your 8 saved codes</span>
              </div>
              <div className="form-group">
                <label className="form-label tactical">NEW PASSPHRASE</label>
                <input
                  className="input" type="password" value={rPassword}
                  onChange={e => setRPassword(e.target.value)}
                  autoComplete="new-password" required minLength={6}
                />
              </div>
              {localError && <div className="error-msg">{localError}</div>}
              <button
                type="submit"
                className="btn btn-amber btn-full"
                disabled={rLoading || !rUsername || !rCode || !rPassword}
              >
                {rLoading ? 'VERIFYING CODE...' : 'RESET ACCESS'}
              </button>
              <button
                type="button" className="btn btn-ghost btn-full"
                onClick={() => { setView('auth'); setLocalError(''); }}
              >
                ← BACK TO SIGN IN
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Default: login / register ─────────────────────────────────
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
              onClick={() => { setMode('login'); setLocalError(''); setSuggestions([]); }}
            >
              SIGN IN
            </button>
            <button
              className={`login-tab ${mode === 'register' ? 'active' : ''}`}
              onClick={() => { setMode('register'); setLocalError(''); setSuggestions([]); }}
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
                onChange={e => { setUsername(e.target.value); setSuggestions([]); setLocalError(''); }}
                maxLength={20}
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                required
              />
              {suggestions.length > 0 && (
                <div className="suggestion-row">
                  <span className="suggestion-label tactical">AVAILABLE:</span>
                  {suggestions.map(s => (
                    <button
                      key={s}
                      type="button"
                      className="suggestion-chip tactical"
                      onClick={() => { setUsername(s); setSuggestions([]); setLocalError(''); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label tactical">PASSPHRASE</label>
              <input
                className="input"
                type="password"
                placeholder={mode === 'register' ? 'Min. 6 characters' : 'Enter passphrase'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </div>

            {localError && <div className="error-msg">{localError}</div>}

            <button
              type="submit"
              className="btn btn-amber btn-full"
              disabled={loading || !username || !password}
            >
              {loading ? 'CONNECTING...' : mode === 'login' ? 'DEPLOY' : 'ENLIST NOW'}
            </button>

            {mode === 'login' && (
              <button
                type="button"
                className="recover-link tactical"
                onClick={() => { setView('recover'); setLocalError(''); }}
              >
                Locked out? Use a recovery code
              </button>
            )}

            {mode === 'register' && (
              <p className="register-hint tactical">
                You'll receive 8 one-time recovery codes after enlisting.
              </p>
            )}
          </form>
        </div>

        <p className="login-footer tactical">
          PERSISTENT TACTICAL GRID GAME · DAILY AP DROPS
        </p>
      </div>
    </div>
  );
}
