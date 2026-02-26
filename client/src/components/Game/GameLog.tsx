import type { GameLog as GameLogType } from '../../types/game';
import './GameLog.css';

interface Props {
  logs: GameLogType[];
}

const LOG_ICONS: Record<string, string> = {
  action: '→',
  attack: '⊕',
  revive: '♥',
  gift: '◈',
  loot: '⚡',
  spawn: '★',
  jury: '⊟',
  system: '·',
  join: '↳',
  end: '⊠',
  shrink: '◻',
};

const LOG_CLASSES: Record<string, string> = {
  attack: 'log-attack',
  revive: 'log-revive',
  loot: 'log-loot',
  gift: 'log-gift',
  jury: 'log-jury',
  spawn: 'log-spawn',
  end: 'log-end',
  shrink: 'log-shrink',
};

export default function GameLog({ logs }: Props) {
  return (
    <div className="game-log">
      <div className="log-header tactical">OPERATION LOG</div>
      <div className="log-entries">
        {logs.length === 0 ? (
          <p className="log-empty tactical">— NO EVENTS —</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`log-entry ${LOG_CLASSES[log.type] || ''}`}>
              <span className="log-icon">{LOG_ICONS[log.type] || '·'}</span>
              <span className="log-message">{log.message}</span>
              <span className="log-turn tactical">T{log.turn}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
