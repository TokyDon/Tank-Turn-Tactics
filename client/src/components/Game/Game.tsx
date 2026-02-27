import { useState, useEffect, useRef } from 'react';
import { useGame } from '../../context/GameContext';
import * as api from '../../services/api';
import type { PrimaryAction, SecondaryAction, GamePlayer } from '../../types/game';
import Grid from './Grid';
import ActionPanel from './ActionPanel';
import PlayerStatus from './PlayerStatus';
import GameLog from './GameLog';
import JuryPanel from './JuryPanel';
import './Game.css';

interface Props { onLeave: () => void; }

export type Phase =
  | 'idle'             // no action selected yet
  | 'select-move'      // picking a cell to move to
  | 'select-attack'    // picking a player to attack
  | 'confirm'          // reviewing primary before submitting
  | 'secondary'        // primary done — optionally pick secondary action
  | 'select-secondary'; // picking a grid target for secondary action

export default function Game({ onLeave }: Props) {
  const { game, user, refreshGame, clearGame } = useGame();
  const [phase, setPhase] = useState<Phase>('idle');
  const [pendingPrimary, setPendingPrimary] = useState<PrimaryAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [botDifficulty, setBotDifficulty] = useState<'private' | 'major' | 'general'>('private');
  const [addingBot, setAddingBot] = useState(false);
  const [forcingTurn, setForcingTurn] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletingGame, setDeletingGame] = useState(false);
  const [pendingSecondaryAction, setPendingSecondaryAction] = useState<SecondaryAction | null>(null);
  const [tab, setTab] = useState<'grid' | 'log' | 'players'>('grid');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Declared early (with optional chaining) so the useEffect below can reference it
  // without a temporal dead zone — hooks must come before any conditional return.
  const me = game?.players.find(p => p.userId === user?.id);

  useEffect(() => {
    const interval = setInterval(() => refreshGame(), 30000);
    return () => clearInterval(interval);
  }, [refreshGame]);

  // If the player has submitted primary but not secondary (e.g. after a page reload), jump to secondary phase
  useEffect(() => {
    if (me?.hasTakenPrimary && !me?.hasTakenTurn && phase === 'idle') {
      setPhase('secondary');
    }
  }, [me?.hasTakenPrimary, me?.hasTakenTurn, phase]);

  function showToast(msg: string, duration = 2800) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setError(msg);
    toastTimer.current = setTimeout(() => setError(''), duration);
  }

  if (!game || !user) return null;

  const activePlayers = game.players.filter(p => !p.isDowned);
  const downedPlayers = game.players.filter(p => p.isDowned);
  const allActed = activePlayers.every(p => p.hasTakenTurn);
  const pendingCount = activePlayers.filter(p => !p.hasTakenTurn).length;

  async function submitPrimary() {
    if (!game || !pendingPrimary) return;
    setSubmitting(true);
    setError('');
    try {
      await api.takePrimaryAction(game.id, pendingPrimary);
      await refreshGame();
      setPendingPrimary(null);
      setPhase('secondary');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSecondary(sa: SecondaryAction | null) {
    if (!game) return;
    setSubmitting(true);
    setError('');
    try {
      await api.takeSecondaryAction(game.id, sa);
      await refreshGame();
      setPhase('idle');
      setPendingSecondaryAction(null);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  const BOT_DESCRIPTIONS: Record<string, string> = {
    private: 'ACTS 10–22H · RANDOM MOVES · NEVER STRATEGISES',
    major:   'ACTS 3–9H · TARGETS WEAK UNITS · REPOSITIONS',
    general: 'ACTS 0.5–2H · KILL SHOTS · UPGRADES RANGE · FULL TACTICS',
  };

  async function handleStart() {
    if (!game) return;
    setError('');
    try {
      await api.startGame(game.id);
      await refreshGame();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to start');
    }
  }

  async function handleAddBot() {
    if (!game) return;
    setAddingBot(true);
    setError('');
    try {
      await api.addBot(game.id, botDifficulty);
      await refreshGame();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add bot');
    } finally {
      setAddingBot(false);
    }
  }

  async function handleForceTurn() {
    if (!game) return;
    setForcingTurn(true);
    try {
      await api.forceAdvanceTurn(game.id);
      await refreshGame();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setForcingTurn(false);
    }
  }

  async function handleDeleteGame() {
    if (!game) return;
    setDeletingGame(true);
    try {
      await api.deleteGame(game.id);
      clearGame();
      onLeave();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete operation');
      setDeletingGame(false);
      setDeleteConfirm(false);
    }
  }

  function handleCellClick(x: number, y: number) {
    if (!me || me.isDowned || me.hasTakenTurn) return;
    if (phase === 'select-move') {
      setPendingPrimary({ type: 'move', x, y });
      setPhase('confirm');
    }
  }

  function handlePlayerClick(target: GamePlayer) {
    if (!me || me.isDowned || me.hasTakenTurn) return;
    if (phase === 'select-attack') {
      const dist = Math.max(Math.abs(target.x - me.x), Math.abs(target.y - me.y));
      if (dist > me.range) {
        showToast(`OUT OF RANGE — ${dist} TILES AWAY (◎${me.range})`);
        return;
      }
      setPendingPrimary({ type: 'attack', targetUserId: target.userId });
      setPhase('confirm');
    }
    if (phase === 'select-secondary' && pendingSecondaryAction) {
      submitSecondary({ ...pendingSecondaryAction, targetUserId: target.userId });
    }
  }

  function cancelAction() {
    if (phase === 'select-secondary') {
      // Cancel target selection — return to secondary picker
      setPendingSecondaryAction(null);
      setPhase('secondary');
      return;
    }
    // Only cancel primary if it hasn't been submitted yet
    if (!me?.hasTakenPrimary) {
      setPendingPrimary(null);
      setPhase('idle');
      setError('');
      if (toastTimer.current) clearTimeout(toastTimer.current);
    }
  }

  const canAct = me && !me.isDowned && !me.hasTakenTurn && game.status === 'active';
  const isHost = game.players[0]?.userId === user.id;

  // Players valid for secondary targeting — used to highlight grid cells
  const secondaryTargetIds: Set<string> = (() => {
    if (phase !== 'select-secondary' || !pendingSecondaryAction) return new Set<string>();
    const targets = pendingSecondaryAction.type === 'giveHeart'
      ? game.players.filter(p => !p.isMe && (!p.isDowned || p.canRevive))
      : game.players.filter(p => !p.isMe && !p.isDowned);
    return new Set(targets.map(p => p.userId));
  })();
  const turnTimeLeft = game.turnStartedAt
    ? Math.max(0, 24 * 60 * 60 - (Date.now() / 1000 - game.turnStartedAt))
    : null;

  function formatTime(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  }

  return (
    <div className="game-screen">
      {/* Header */}
      <header className="game-header">
        <div className="game-header-side">
          <button className="btn btn-ghost btn-sm" onClick={() => { clearGame(); onLeave(); }}>
            ← OPS
          </button>
        </div>
        <div className="game-header-center">
          <span className="game-header-name display">{game.name.toUpperCase()}</span>
          {game.status === 'active' && (
            <span className="game-header-turn tactical">T-{game.currentTurn}</span>
          )}
        </div>
        <div className="game-header-side game-header-right">
          {game.status === 'active' && turnTimeLeft !== null && (
            <span className="turn-timer tactical">{formatTime(turnTimeLeft)}</span>
          )}
          {user.username === 'james' && game.status === 'active' && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleForceTurn}
              disabled={forcingTurn}
              style={{ fontSize: '10px', padding: '4px 8px', marginLeft: '4px' }}
            >
              {forcingTurn ? '...' : '⚡ NEXT'}
            </button>
          )}
          {game.status === 'lobby' && <span className="tag tag-green">LOBBY</span>}
          {game.status === 'ended' && <span className="tag tag-muted">ENDED</span>}
        </div>
      </header>

      {/* My status bar — only shown during active game, not in lobby */}
      {me && game.status === 'active' && <PlayerStatus player={me} canAct={!!canAct} allActed={allActed} pendingCount={pendingCount} />}

      {/* Error toast — fixed overlay, auto-dismisses */}
      {error && (
        <div className="game-toast" onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setError(''); }}>
          {error}
        </div>
      )}

      {/* Lobby state */}
      {game.status === 'lobby' && (
        <div className="lobby-waiting">
          <div className="waiting-players card">
            <h3 className="waiting-title display">ENLISTED COMMANDERS</h3>
            <div className="waiting-list">
              {game.players.map(p => (
                <div key={p.userId} className="waiting-player">
                  <span className="waiting-dot" style={{ background: p.color }} />
                  <span className="waiting-name">{p.username}</span>
                  {p.userId === game.players[0]?.userId && (
                    <span className="tag tag-amber">HOST</span>
                  )}
                  {p.isBot && (
                    <span className={`tag bot-tag diff-${p.botDifficulty}`}>
                      {p.botDifficulty === 'private' ? 'PVT' : p.botDifficulty === 'major' ? 'MAJ' : 'GEN'}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {isHost ? (
              <>
                <div className="bot-panel">
                  <div className="bot-panel-label tactical">ADD BOT OPPONENT</div>
                  <div className="bot-difficulty-row">
                    {(['private', 'major', 'general'] as const).map(diff => (
                      <button
                        key={diff}
                        className={`bot-diff-btn ${botDifficulty === diff ? 'selected' : ''} diff-${diff}`}
                        onClick={() => setBotDifficulty(diff)}
                      >
                        <span className="diff-rank">
                          {diff === 'private' ? 'PVT' : diff === 'major' ? 'MAJ' : 'GEN'}
                        </span>
                        <span className="diff-label">{diff.toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                  <div className="bot-diff-desc tactical">{BOT_DESCRIPTIONS[botDifficulty]}</div>
                  <button
                    className="btn btn-ghost btn-full"
                    onClick={handleAddBot}
                    disabled={addingBot}
                  >
                    {addingBot ? 'ENLISTING...' : '+ ADD BOT'}
                  </button>
                </div>
                <button
                  className="btn btn-amber btn-full"
                  disabled={game.players.length < 2}
                  onClick={handleStart}
                >
                  START OPERATION ({game.players.length} UNITS)
                </button>

                {/* Delete operation — host only, with confirmation */}
                {!deleteConfirm ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--red, #cf2020)', marginTop: '4px' }}
                    onClick={() => setDeleteConfirm(true)}
                  >
                    ✕ DELETE OPERATION
                  </button>
                ) : (
                  <div className="delete-confirm-inline">
                    <div className="delete-confirm-msg tactical">
                      Permanently delete “{game.name}”? This cannot be undone.
                    </div>
                    <div className="delete-confirm-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(false)}>CANCEL</button>
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={deletingGame}
                        onClick={handleDeleteGame}
                      >
                        {deletingGame ? 'DELETING...' : 'CONFIRM DELETE'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="waiting-hint tactical">WAITING FOR HOST TO DEPLOY...</p>
            )}
          </div>
        </div>
      )}

      {/* Mobile tabs */}
      {game.status !== 'lobby' && (
        <>
          <div className="game-tabs">
            {(['grid', 'players', 'log'] as const).map(t => (
              <button key={t} className={`game-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t === 'grid' ? '⊕ MAP' : t === 'players' ? '⊟ UNITS' : '≡ LOG'}
              </button>
            ))}
          </div>

          {tab === 'grid' && (
            <div className="game-main">
              <Grid
                game={game}
                me={me || null}
                phase={phase}
                secondaryTargetIds={secondaryTargetIds}
                onCellClick={handleCellClick}
                onPlayerClick={handlePlayerClick}
              />
            </div>
          )}

          {tab === 'players' && (
            <div className="game-players-tab">
              <div className="players-list">
                {game.players.map(p => (
                  <div
                    key={p.userId}
                    className={`unit-row card ${p.isDowned ? 'downed' : ''} ${p.isMe ? 'is-me' : ''}`}
                    onClick={() => {
                      if (canAct && !p.isMe && phase === 'select-secondary' && secondaryTargetIds.has(p.userId)) {
                        handlePlayerClick(p);
                      } else if (canAct && !p.isMe && !p.isDowned && phase === 'select-attack') {
                        handlePlayerClick(p);
                      }
                    }}
                  >
                    <div className="unit-color" style={{ background: p.color }} />
                    <div className="unit-info">
                      <div className="unit-top">
                        <span className="unit-name">{p.username}</span>
                        {p.isMe && <span className="tag tag-amber">YOU</span>}
                        {p.isDowned && <span className="tag tag-red">KIA</span>}
                        {p.hasTakenTurn && !p.isDowned && <span className="tag tag-muted">ACTED</span>}
                        {p.hasTakenPrimary && !p.hasTakenTurn && !p.isDowned && <span className="tag tag-amber">PRI ✓</span>}
                        {p.isHaunted && <span className="tag tag-purple">HAUNTED</span>}
                        {p.isBot && (
                          <span className={`tag bot-tag diff-${p.botDifficulty}`}>
                            {p.botDifficulty === 'private' ? 'PVT' : p.botDifficulty === 'major' ? 'MAJ' : 'GEN'}
                          </span>
                        )}
                      </div>
                      <div className="unit-stats tactical">
                        <span>
                          {Array.from({ length: Math.min(p.hearts, 3) }).map((_, i) => (
                            <span key={i} className="heart-pip">♥</span>
                          ))}
                          {Array.from({ length: Math.max(0, 3 - p.hearts) }).map((_, i) => (
                            <span key={i} className="heart-pip empty">♡</span>
                          ))}
                        </span>
                        <span className="unit-pos">[{p.x},{p.y}]</span>
                        <span className="unit-range">◎ {p.range}</span>
                        {p.isMe && p.ap !== null && <span className="unit-ap amber">⚡{p.ap} AP</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'log' && (
            <div className="game-log-tab">
              <GameLog logs={game.logs} />
            </div>
          )}

          {/* Action Panel */}
          {game.status === 'active' && (
            <ActionPanel
              me={me || null}
              game={game}
              phase={phase}
              pendingPrimary={pendingPrimary}
              pendingSecondaryAction={pendingSecondaryAction}
              setPendingSecondaryAction={setPendingSecondaryAction}
              submitting={submitting}
              canAct={!!canAct}
              setPhase={setPhase}
              setPendingPrimary={setPendingPrimary}
              onSubmitPrimary={submitPrimary}
              onSubmitSecondary={submitSecondary}
              onCancel={cancelAction}
            />
          )}

          {/* Jury panel for downed players */}
          {me?.isDowned && game.status === 'active' && (
            <JuryPanel game={game} me={me} />
          )}

          {/* Game ended */}
          {game.status === 'ended' && (
            <div className="game-ended card">
              <h2 className="display">OPERATION COMPLETE</h2>
              <div className="standings">
                {game.players
                  .filter(p => !p.isDowned)
                  .map((p, i) => (
                    <div key={p.userId} className="standing-row">
                      <span className="standing-rank tactical">#{i + 1}</span>
                      <span className="standing-name">{p.username}</span>
                    </div>
                  ))
                }
              </div>
              <button className="btn btn-ghost btn-full" onClick={() => { clearGame(); onLeave(); }}>
                RETURN TO OPS
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
