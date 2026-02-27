import type { GamePlayer } from '../../types/game';
import './PlayerStatus.css';

interface Props {
  player: GamePlayer;
  canAct: boolean;
  allActed: boolean;
  pendingCount: number;
}

export default function PlayerStatus({ player, canAct, allActed, pendingCount }: Props) {
  const totalHearts = player.hearts + (player.extraHearts ?? 0);
  const displayHearts = Math.min(totalHearts, 3);
  const hasExtra = (player.extraHearts ?? 0) > 0;

  return (
    <div className={`player-status-bar ${player.isDowned ? 'downed' : canAct ? 'can-act' : ''}`}>
      <div className="status-left">
        <div className="status-callsign display">
          <span className="status-dot" style={{ background: player.color }} />
          {player.username.toUpperCase()}
        </div>
        <div className="status-hearts">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className={`status-heart ${i < displayHearts ? 'filled' : 'empty'}`}>
              {i < displayHearts ? '♥' : '♡'}
            </span>
          ))}
          {hasExtra && <span className="status-heart-bonus tactical">+{player.extraHearts}</span>}
        </div>
      </div>

      <div className="status-right">
        {player.isDowned ? (
          <span className="tag tag-red">KIA — JURY ACTIVE</span>
        ) : player.hasTakenTurn ? (
          <div className="status-waiting-info">
            <span className="tag tag-muted">ACTED</span>
            {!allActed && (
              <span className="status-waiting-count tactical">{pendingCount} PENDING</span>
            )}
          </div>
        ) : canAct ? (
          player.hasTakenPrimary
            ? <span className="status-primary-done tactical">✓ PRIMARY COMPLETE</span>
            : <span className="status-your-turn">YOUR TURN</span>
        ) : null}

        {!player.isDowned && (
          <div className="status-stats tactical">
            {player.ap !== null && <span className="stat-ap">⚡ {player.ap}</span>}
            <span className="stat-range">◎ {player.range}</span>
            <span className="stat-pos">[{player.x},{player.y}]</span>
          </div>
        )}
      </div>
    </div>
  );
}
