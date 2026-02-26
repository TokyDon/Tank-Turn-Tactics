import { useState } from 'react';
import type { GameState, GamePlayer } from '../../types/game';
import * as api from '../../services/api';
import { useGame } from '../../context/GameContext';
import './JuryPanel.css';

interface Props {
  game: GameState;
  me: GamePlayer;
}

export default function JuryPanel({ game, me }: Props) {
  const { refreshGame } = useGame();
  const [hauntTarget, setHauntTarget] = useState('');
  const [intercedeTarget, setIntercedeTarget] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const alivePlayers = game.players.filter(p => !p.isDowned);
  const allPlayers = game.players.filter(p => p.userId !== me.userId);

  async function submitVotes() {
    setError('');
    try {
      if (hauntTarget) await api.submitVote(game.id, hauntTarget, 'haunting');
      if (intercedeTarget) await api.submitVote(game.id, intercedeTarget, 'intercession');
      setSubmitted(true);
      refreshGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Vote failed');
    }
  }

  const existingHaunt = game.myVotes?.find(v => v.vote_type === 'haunting');
  const existingIntercede = game.myVotes?.find(v => v.vote_type === 'intercession');

  return (
    <div className="jury-panel card">
      <div className="jury-header">
        <span className="tag tag-purple">JURY OF THE FALLEN</span>
        <p className="jury-desc tactical">CAST YOUR DAILY JUDGEMENT</p>
      </div>

      {(submitted || existingHaunt || existingIntercede) ? (
        <div className="jury-voted">
          <p className="tactical">VOTES CAST THIS CYCLE</p>
          {(existingHaunt || hauntTarget) && (
            <div className="jury-vote-row">
              <span className="tag tag-red">HAUNTING</span>
              <span>{game.players.find(p => p.userId === (existingHaunt?.target_id || hauntTarget))?.username}</span>
            </div>
          )}
          {(existingIntercede || intercedeTarget) && (
            <div className="jury-vote-row">
              <span className="tag tag-green">INTERCESSION</span>
              <span>{game.players.find(p => p.userId === (existingIntercede?.target_id || intercedeTarget))?.username}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="jury-votes">
          <div className="jury-vote-block">
            <label className="jury-vote-label tactical">
              HAUNTING <span className="jury-hint">(most votes = no AP today)</span>
            </label>
            <div className="jury-targets">
              {alivePlayers.map(p => (
                <button
                  key={p.userId}
                  className={`jury-target-btn ${hauntTarget === p.userId ? 'selected haunt' : ''}`}
                  onClick={() => setHauntTarget(v => v === p.userId ? '' : p.userId)}
                >
                  <span className="jury-dot" style={{ background: p.color }} />
                  {p.username}
                </button>
              ))}
            </div>
          </div>

          <div className="jury-vote-block">
            <label className="jury-vote-label tactical">
              INTERCESSION <span className="jury-hint">(3+ votes = +3 AP reward)</span>
            </label>
            <div className="jury-targets">
              {allPlayers.map(p => (
                <button
                  key={p.userId}
                  className={`jury-target-btn ${intercedeTarget === p.userId ? 'selected intercede' : ''}`}
                  onClick={() => setIntercedeTarget(v => v === p.userId ? '' : p.userId)}
                >
                  <span className="jury-dot" style={{ background: p.color }} />
                  {p.username}
                  {p.isDowned && <span className="tag tag-red" style={{ fontSize: '9px' }}>KIA</span>}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button
            className="btn btn-amber btn-full"
            onClick={submitVotes}
            disabled={!hauntTarget && !intercedeTarget}
          >
            CAST JUDGEMENT
          </button>
        </div>
      )}
    </div>
  );
}
