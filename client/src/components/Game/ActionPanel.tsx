import { useState, useEffect } from 'react';
import type { GamePlayer, GameState, PrimaryAction, SecondaryAction } from '../../types/game';
import type { Phase } from './Game';
import './ActionPanel.css';

interface Props {
  me: GamePlayer | null;
  game: GameState;
  phase: string;
  pendingPrimary: PrimaryAction | null;
  submitting: boolean;
  canAct: boolean;
  setPhase: (p: Phase) => void;
  setPendingPrimary: (a: PrimaryAction | null) => void;
  onSubmitPrimary: () => void;
  onSubmitSecondary: (sa: SecondaryAction | null) => void;
  onCancel: () => void;
}

const ACTION_COSTS: Record<string, number> = {
  move: 1, attack: 1, addHeart: 3, upgradeRange: 3, idle: 0
};

export default function ActionPanel({
  me, game, phase,
  pendingPrimary,
  submitting, canAct,
  setPhase, setPendingPrimary,
  onSubmitPrimary, onSubmitSecondary, onCancel
}: Props) {
  const [secMode, setSecMode] = useState<null | 'heart' | 'ap'>(null);
  const [giftAmount, setGiftAmount] = useState(1);

  useEffect(() => {
    if (phase === 'idle') { setSecMode(null); setGiftAmount(1); }
  }, [phase]);

  if (!me || me.isDowned) return null;

  const ap = me.ap ?? 0;

  // Heart target list: include downed players who can be revived
  const heartTargets = game.players.filter(p => !p.isMe && (!p.isDowned || p.canRevive));
  // AP target list: alive players only
  const apTargets = game.players.filter(p => !p.isDowned && !p.isMe);

  if (me.hasTakenTurn) {
    const active = game.players.filter(p => !p.isDowned).length;
    const done = game.players.filter(p => !p.isDowned && p.hasTakenTurn).length;
    return (
      <div className="action-panel acted">
        <div className="acted-status">
          <span className="tag tag-muted tactical">ORDER SUBMITTED</span>
          <span className="acted-waiting tactical">{done}/{active} UNITS ACTED</span>
        </div>
      </div>
    );
  }

  if (!canAct) {
    return (
      <div className="action-panel">
        <p className="panel-hint tactical">GAME NOT ACTIVE OR WAITING...</p>
      </div>
    );
  }

  function targetName(id?: string) {
    return id ? (game.players.find(p => p.userId === id)?.username ?? id) : null;
  }

  function renderInlinePicker() {
    if (secMode === 'heart') {
      return (
        <div className="secondary-inline-picker">
          <div className="secondary-picker-label tactical">SEND ♥ TO:</div>
          <div className="secondary-target-list">
            {heartTargets.map(p => (
              <button key={p.userId} className={`secondary-target-btn tactical${p.isDowned ? ' target-downed' : ''}`}
                onClick={() => {
                  onSubmitSecondary({ type: 'giveHeart', targetUserId: p.userId });
                  setSecMode(null);
                }}>
                <span className="sec-target-dot" style={{ background: p.color }} />
                {p.username}
                {p.isDowned && <span className="sec-target-status tactical">↑ REVIVE</span>}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm btn-full" onClick={() => setSecMode(null)}>CANCEL</button>
        </div>
      );
    }
    if (secMode === 'ap') {
      return (
        <div className="secondary-inline-picker">
          <div className="secondary-picker-label tactical">TRANSFER AP — PICK AMOUNT THEN TARGET:</div>
          <div className="ap-amount-row">
            {[1, 2, 3].map(n => (
              <button key={n}
                className={`btn btn-sm ${giftAmount === n ? 'btn-amber' : 'btn-ghost'}`}
                onClick={() => setGiftAmount(n)} disabled={n > ap}
              >{n} AP</button>
            ))}
          </div>
          <div className="secondary-target-list">
            {apTargets.map(p => (
              <button key={p.userId} className="secondary-target-btn tactical"
                onClick={() => {
                  onSubmitSecondary({ type: 'giveAP', targetUserId: p.userId, amount: giftAmount });
                  setSecMode(null);
                }}>
                <span className="sec-target-dot" style={{ background: p.color }} />
                {p.username}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm btn-full" onClick={() => setSecMode(null)}>CANCEL</button>
        </div>
      );
    }
    return null;
  }

  // Confirm phase — primary action only
  if (phase === 'confirm' && pendingPrimary) {
    return (
      <div className="action-panel confirm-phase">
        <div className="confirm-header tactical">CONFIRM PRIMARY ORDER</div>
        <div className="confirm-rows">
          {pendingPrimary.type !== 'idle' ? (
            <div className="confirm-row">
              <span className="confirm-label">PRIMARY</span>
              <span className="confirm-value">
                {pendingPrimary.type === 'move' && `MOVE → [${pendingPrimary.x},${pendingPrimary.y}]`}
                {pendingPrimary.type === 'attack' && `ATTACK ${targetName(pendingPrimary.targetUserId)}`}
                {pendingPrimary.type === 'addHeart' && 'REINFORCE ARMOR (+1 ♥)'}
                {pendingPrimary.type === 'upgradeRange' && 'UPGRADE TARGETING'}
              </span>
              <span className="confirm-cost tactical">-{ACTION_COSTS[pendingPrimary.type]} AP</span>
            </div>
          ) : (
            <div className="confirm-row confirm-row-idle">
              <span className="confirm-label">PRIMARY</span>
              <span className="confirm-value-idle tactical">IDLE — HOLD POSITION</span>
            </div>
          )}
        </div>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>ABORT</button>
          <button className="btn btn-amber" onClick={onSubmitPrimary} disabled={submitting}>
            {submitting ? 'TRANSMITTING...' : 'EXECUTE'}
          </button>
        </div>
      </div>
    );
  }

  // Secondary phase — primary already committed, pick optional secondary
  if (phase === 'secondary') {
    return (
      <div className="action-panel secondary-phase">
        {secMode ? renderInlinePicker() : (
          <>
            <div className="secondary-phase-header tactical">✓ PRIMARY COMPLETE — SELECT SECONDARY ORDER</div>
            <div className="action-group">
              <div className="action-grid">
                <ActionButton
                  label="SEND ♥"
                  icon="♥"
                  cost={0}
                  ap={ap}
                  green
                  onClick={() => setSecMode('heart')}
                />
                <ActionButton
                  label="SEND AP"
                  icon="⚡"
                  cost={1}
                  ap={ap}
                  onClick={() => setSecMode('ap')}
                />
              </div>
            </div>
            <button
              className="btn btn-ghost btn-full"
              onClick={() => onSubmitSecondary(null)}
              disabled={submitting}
            >
              {submitting ? 'TRANSMITTING...' : 'END TURN (NO SECONDARY)'}
            </button>
          </>
        )}
      </div>
    );
  }

  // Selection phases
  if (phase === 'select-move') {
    return (
      <div className="action-panel selecting">
        <div className="selecting-hint tactical">TAP AN ADJACENT CELL ON THE MAP</div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>CANCEL</button>
      </div>
    );
  }
  if (phase === 'select-attack') {
    return (
      <div className="action-panel selecting">
        <div className="selecting-hint tactical">TAP AN ENEMY WITHIN RANGE ◎{me.range}</div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>CANCEL</button>
      </div>
    );
  }

  // Default action selection
  return (
    <div className="action-panel">
      <div className="idle-warning tactical">⚠ MISSING YOUR TURN ENTIRELY COSTS 1 HP — USE IDLE TO HOLD POSITION</div>
      {secMode ? renderInlinePicker() : (
        <>
          <div className="panel-header">
            <span className="panel-title tactical">SELECT ORDER</span>
            <span className="panel-ap tactical">⚡ {ap} AP</span>
          </div>

          <div className="action-sections">
            {/* Primary actions */}
            <div className="action-group">
              <span className="action-group-label tactical">PRIMARY</span>
              <div className="action-grid">
                <ActionButton
                  label="MOVE"
                  icon="↑"
                  cost={1}
                  ap={ap}
                  onClick={() => {
                    setPendingPrimary({ type: 'move' });
                    setPhase('select-move');
                  }}
                />
                <ActionButton
                  label="ATTACK"
                  icon="⊕"
                  cost={1}
                  ap={ap}
                  danger
                  onClick={() => {
                    setPendingPrimary({ type: 'attack' });
                    setPhase('select-attack');
                  }}
                />
                <ActionButton
                  label="+ HEART"
                  icon="♥"
                  cost={3}
                  ap={ap}
                  onClick={() => {
                    setPendingPrimary({ type: 'addHeart' });
                    setPhase('confirm');
                  }}
                />
                <ActionButton
                  label="RANGE++"
                  icon="◎"
                  cost={3}
                  ap={ap}
                  onClick={() => {
                    setPendingPrimary({ type: 'upgradeRange' });
                    setPhase('confirm');
                  }}
                />
                <ActionButton
                  label="IDLE"
                  icon="◌"
                  cost={0}
                  ap={ap}
                  onClick={() => {
                    setPendingPrimary({ type: 'idle' });
                    setPhase('confirm');
                  }}
                />
              </div>
            </div>

            {/* Secondary actions — only show in primary selection phase (before primary submitted) */}
            <div className="action-group">
              <span className="action-group-label tactical">SECONDARY (AFTER PRIMARY)</span>
              <div className="action-grid">
                <ActionButton
                  label="SEND ♥"
                  icon="♥"
                  cost={0}
                  ap={ap}
                  green
                  disabled
                  onClick={() => {}}
                />
                <ActionButton
                  label="SEND AP"
                  icon="⚡"
                  cost={1}
                  ap={ap}
                  disabled
                  onClick={() => {}}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ActionButton({
  label, icon, cost, ap, danger, green, disabled: forceDisabled, onClick
}: {
  label: string; icon: string; cost: number; ap: number;
  danger?: boolean; green?: boolean; disabled?: boolean; onClick: () => void;
}) {
  const disabled = forceDisabled || (cost > 0 && ap < cost);
  return (
    <button
      className={`action-btn ${danger ? 'danger' : green ? 'green' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="action-icon">{icon}</span>
      <span className="action-label">{label}</span>
      {cost > 0 && <span className="action-cost tactical">-{cost} AP</span>}
    </button>
  );
}
