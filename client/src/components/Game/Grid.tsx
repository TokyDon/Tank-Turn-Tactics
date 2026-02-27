import { useMemo, useState } from 'react';
import type { GameState, GamePlayer } from '../../types/game';
import type { Phase } from './Game';
import './Grid.css';

const COLS = 'ABCDEFGHIJKLMNOP';

interface Props {
  game: GameState;
  me: GamePlayer | null;
  phase: string;
  secondaryTargetIds?: Set<string>;
  onCellClick: (x: number, y: number) => void;
  onPlayerClick: (player: GamePlayer) => void;
}

export default function Grid({ game, me, phase, secondaryTargetIds = new Set(), onCellClick, onPlayerClick }: Props) {
  const size = game.activeGridSize;
  const [zoom, setZoom] = useState(1.0);
  const [popup, setPopup] = useState<GamePlayer | null>(null);

  // Build lookup maps
  const playerAt = useMemo(() => {
    const map = new Map<string, GamePlayer>();
    for (const p of game.players) map.set(`${p.x},${p.y}`, p);
    return map;
  }, [game.players]);

  const itemAt = useMemo(() => {
    const map = new Map<string, typeof game.items[0]>();
    for (const item of game.items) map.set(`${item.x},${item.y}`, item);
    return map;
  }, [game.items]);

  // Cells in my range
  const rangeSet = useMemo(() => {
    if (!me) return new Set<string>();
    const s = new Set<string>();
    for (let cy = 0; cy < size; cy++) {
      for (let cx = 0; cx < size; cx++) {
        const dist = Math.max(Math.abs(cx - me.x), Math.abs(cy - me.y));
        if (dist <= me.range && dist > 0) s.add(`${cx},${cy}`);
      }
    }
    return s;
  }, [me, size]);

  // Adjacent cells for movement
  const adjacentSet = useMemo(() => {
    if (!me) return new Set<string>();
    const s = new Set<string>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = me.x + dx, ny = me.y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
          const occ = game.players.find(p => !p.isDowned && p.x === nx && p.y === ny);
          if (!occ) s.add(`${nx},${ny}`);
        }
      }
    }
    return s;
  }, [me, size, game.players]);

  function cellClass(x: number, y: number, player: GamePlayer | undefined) {
    const key = `${x},${y}`;
    const classes = ['grid-cell'];
    if (player?.isMe) classes.push('cell-me');
    else if (player && !player.isDowned) classes.push('cell-enemy');
    else if (player?.isDowned) classes.push('cell-downed');
    if (phase === 'select-move' && adjacentSet.has(key)) classes.push('cell-move-target');
    if (phase === 'select-attack' && rangeSet.has(key)) {
      if (player && !player.isDowned && !player.isMe) classes.push('cell-attack-target');
    }
    if (phase === 'select-secondary' && player && secondaryTargetIds.has(player.userId)) {
      classes.push('cell-secondary-target');
    }
    if (me && x === me.x && y === me.y) classes.push('cell-self');
    return classes.join(' ');
  }

  return (
    <div className="grid-wrapper" style={{ '--cell-scale': zoom } as React.CSSProperties}>
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
        <span className="zoom-label tactical">{Math.round(zoom * 100)}%</span>
        <button className="zoom-btn" onClick={() => setZoom(z => Math.min(3.0, +(z + 0.25).toFixed(2)))}>+</button>
      </div>
      <div className="grid-coords-x tactical">
        {Array.from({ length: size }, (_, i) => (
          <span key={i} className="coord-label">{COLS[i]}</span>
        ))}
      </div>
      <div className="grid-row-wrapper">
        <div className="grid-coords-y tactical">
          {Array.from({ length: size }, (_, i) => (
            <span key={i} className="coord-label">{i + 1}</span>
          ))}
        </div>
        <div
          className="grid-board"
          style={{ '--grid-size': size } as React.CSSProperties}
        >
          {Array.from({ length: size }, (_, y) =>
            Array.from({ length: size }, (_, x) => {
              const key = `${x},${y}`;
              const player = playerAt.get(key);
              const item = itemAt.get(key);
              const isInRange = rangeSet.has(key);
              const showRangeOverlay = !!me && !me.isDowned && !me.hasTakenTurn && isInRange && phase === 'idle';

              return (
                <div
                  key={key}
                  className={cellClass(x, y, player)}
                  onClick={() => {
                    const isSecondaryTarget = player && secondaryTargetIds.has(player.userId);
                    if (player && !player.isMe && (isSecondaryTarget || !player.isDowned)) {
                      if (isSecondaryTarget) {
                        onPlayerClick(player);
                      } else if (phase === 'idle') {
                        setPopup(player);
                      } else {
                        onPlayerClick(player);
                      }
                    } else {
                      onCellClick(x, y);
                    }
                  }}
                >
                  {showRangeOverlay && <div className="range-overlay" />}

                  {item && !player && (
                    <div className={`cell-item ${item.type}`}>
                      {item.type === 'heart' ? '♥' : '⚡'}
                    </div>
                  )}

                  {player && !player.isDowned && (
                    <div className="cell-player" style={{ '--pcolor': player.color } as React.CSSProperties}>
                      <div className="player-indicator" />
                      <span className="player-initial">{player.username.slice(0, 3).toUpperCase()}</span>
                      <div className="cell-health-bar">
                        <div className="cell-health-fill" style={{ width: `${Math.max(0, (player.hearts / 3) * 100)}%` }} />
                      </div>
                      <span className="cell-range-corner">{player.range}</span>
                    </div>
                  )}

                  {player?.isDowned && (
                    <div className="cell-downed-marker" style={{ '--pcolor': player.color } as React.CSSProperties}>
                      <span className="downed-cross">✕</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* Legend */}
      <div className="grid-legend tactical">
        {me && !me.isDowned && (
          <>
            <span><span className="legend-dot me" />YOU</span>
            <span><span className="legend-dot range" />RANGE</span>
            <span><span className="legend-item heart">♥</span>HEART DROP</span>
            <span><span className="legend-item loot">⚡</span>AP DROP</span>
          </>
        )}
      </div>

      {/* Enemy tap popup */}
      {popup && (
        <div className="player-popup-overlay" onClick={() => setPopup(null)}>
          <div className="player-popup" onClick={e => e.stopPropagation()}>
            <div className="popup-header">
              <span className="popup-dot" style={{ background: popup.color }} />
              <span className="popup-name">{popup.username}</span>
              {popup.isHaunted && <span className="tag tag-purple">HAUNTED</span>}
              <button className="popup-close" onClick={() => setPopup(null)}>✕</button>
            </div>
            <div className="popup-stats tactical">
              <div className="popup-stat">
                <span className="popup-stat-label">HP</span>
                <span className="popup-stat-value">
                  {Array.from({ length: Math.min(popup.hearts, 5) }).map((_, i) => (
                    <span key={i} className="popup-heart">♥</span>
                  ))}
                  {Array.from({ length: Math.max(0, 3 - popup.hearts) }).map((_, i) => (
                    <span key={i} className="popup-heart empty">♡</span>
                  ))}
                </span>
              </div>
              <div className="popup-stat">
                <span className="popup-stat-label">RANGE</span>
                <span className="popup-stat-value">◎ {popup.range}</span>
              </div>
              <div className="popup-stat">
                <span className="popup-stat-label">POS</span>
                <span className="popup-stat-value">{COLS[popup.x]}{popup.y + 1}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
