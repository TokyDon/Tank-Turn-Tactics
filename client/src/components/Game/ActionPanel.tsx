import { useState, useEffect } from 'react';
import type { GamePlayer, GameState, PrimaryAction, SecondaryAction } from '../../types/game';
import type { Phase } from './Game';
import './ActionPanel.css';

interface Props {
  me: GamePlayer | null;
  game: GameState;
  phase: string;
  pendingPrimary: PrimaryAction | null;
  pendingSecondaryAction: SecondaryAction | null;
  setPendingSecondaryAction: (a: SecondaryAction | null) => void;
  submitting: boolean;
  canAct: boolean;
  setPhase: (p: Phase) => void;
  setPendingPrimary: (a: PrimaryAction | null) => void;
  onSubmitPrimary: () => void;
  onSubmitSecondary: (sa: SecondaryAction | null) => void;
  onCancel: () => void;
}

const ACTION_COSTS: Record<string, number> = {
  move: 1, attack: 1, addHeart: 3, upgradeRange: 3
};

export default function ActionPanel({
  me, game, phase,
  pendingPrimary,
  pendingSecondaryAction, setPendingSecondaryAction,
  submitting, canAct,
  setPhase, setPendingPrimary,
  onSubmitPrimary, onSubmitSecondary, onCancel
}: Props) {
  const [giftAmount, setGiftAmount] = useState(1);
  const [apPickMode, setApPickMode] = useState(false);

  useEffect(() => {
    if (phase === 'idle') { setApPickMode(false); setGiftAmount(1); }
    if (phase === 'secondary') { setApPickMode(false); }
  }, [phase]);

  if (!me || me.isDowned) return null;

  const ap = me.ap ?? 0;
  const heartTargets = game.players.filter(p => !p.isMe && (!p.isDowned || p.canRevive));
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

  // Confirm phase — primary action only
  if (phase === 'confirm' && pendingPrimary) {
    return (
      <div className="action-panel confirm-phase">
        <div className="confirm-header tactical">CONFIRM PRIMARY ORDER</div>
        <div className="confirm-rows">

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

  // AP amount picker for GIVE AP secondary action
  if (apPickMode) {
    return (
      <div className="action-panel secondary-phase">
        <div className="secondary-phase-header tactical">✓ SELECT AMOUNT TO SEND</div>
        <div className="ap-amount-row">
          {[1, 2, 3].map(n => (
            <button key={n}
              className={`btn btn-sm ${giftAmount === n ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setGiftAmount(n)} disabled={n > ap}
            >{n} AP</button>
          ))}
        </div>
        <div className="secondary-phase-hint tactical">THEN TAP A PLAYER ON THE MAP</div>
        <div className="secondary-confirm-row">
          <button className="btn btn-ghost btn-sm" onClick={() => setApPickMode(false)}>BACK</button>
          <button
            className="btn btn-amber btn-sm"
            disabled={apTargets.length === 0}
            onClick={() => {
              setPendingSecondaryAction({ type: 'giveAP', amount: giftAmount });
              setPhase('select-secondary');
            }}
          >
            SELECT TARGET →
          </button>
        </div>
      </div>
    );
  }

  // Select secondary target on the grid
  if (phase === 'select-secondary') {
    const hint = pendingSecondaryAction?.type === 'giveHeart'
      ? `GIVE ♥ — TAP A PLAYER WITHIN RANGE ◎${me.range}`
      : `SEND ${pendingSecondaryAction?.amount ?? 1} AP — TAP A PLAYER WITHIN RANGE ◎${me.range}`;
    return (
      <div className="action-panel selecting">
        <div className="selecting-hint tactical">{hint}</div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>CANCEL</button>
      </div>
    );
  }

  // Selection phases (primary)
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

  // Combined action panel — primary + secondary always visible
  const hasTakenPrimary = !!me.hasTakenPrimary;
  return (
    <div className="action-panel">
      {/* DISABLED: idle warning — primary action no longer mandatory
      {!hasTakenPrimary && (
        <div className="idle-warning tactical">⚠ TAKE A PRIMARY ACTION OR LOSE 1 HP AT END OF TURN</div>
      )}
      */}
      <div className="action-sections">
        <div className="action-group">
          <span className="action-group-label tactical">
            {hasTakenPrimary ? '✓ PRIMARY COMPLETE' : 'PRIMARY'}
            <span className="group-ap tactical">◎ {me.range} &nbsp;⚡ {ap} AP</span>
          </span>
          <div className="action-grid">
            <ActionButton
              label="MOVE"
              icon="→"
              cost={1}
              ap={ap}
              disabled={hasTakenPrimary}
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
              disabled={hasTakenPrimary}
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
              disabled={hasTakenPrimary}
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
              disabled={hasTakenPrimary}
              onClick={() => {
                setPendingPrimary({ type: 'upgradeRange' });
                setPhase('confirm');
              }}
            />
          </div>
        </div>
        <div className="action-group">
          <span className="action-group-label tactical">SECONDARY</span>
          <div className="action-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <ActionButton
              label="GIVE HEART"
              icon="♥"
              cost={0}
              ap={ap}
              green
              disabled={heartTargets.length === 0}
              onClick={() => {
                setPendingSecondaryAction({ type: 'giveHeart' });
                setPhase('select-secondary');
              }}
            />
            <ActionButton
              label="GIVE AP"
              icon="⚡"
              cost={1}
              ap={ap}
              disabled={apTargets.length === 0}
              onClick={() => setApPickMode(true)}
            />
          </div>
        </div>
      </div>
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
    </button>  );
}