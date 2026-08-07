import { useState } from 'react';

import { useSession } from '../session';

interface VoteButtonProps {
  score: number;
  myVote: -1 | 0 | 1;
  onVote: (value: 1 | -1) => Promise<void>;
  compact?: boolean;
}

/**
 * R12/AE4 toggle semantics are applied server-side; the button just sends the
 * clicked value. Unauthenticated clicks route to account creation (AE3 UI half).
 */
export function VoteButton({ score, myVote, onVote, compact }: VoteButtonProps) {
  const { token, createAccount, busy } = useSession();
  const [pending, setPending] = useState(false);
  const [promptAuth, setPromptAuth] = useState(false);

  const click = async (value: 1 | -1) => {
    if (!token) {
      setPromptAuth(true);
      return;
    }
    setPending(true);
    try {
      await onVote(value);
    } finally {
      setPending(false);
    }
  };

  const arrow = (direction: 1 | -1) => (
    <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current">
      {direction === 1 ? <path d="M6 1.5 11 9H1z" /> : <path d="M6 10.5 1 3h10z" />}
    </svg>
  );

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={`inline-flex items-center overflow-hidden rounded border border-zinc-700 ${
          pending ? 'opacity-60' : ''
        }`}
      >
        <button
          type="button"
          aria-label="upvote"
          disabled={pending || busy}
          onClick={() => void click(1)}
          className={`px-2 py-1 hover:bg-zinc-800 ${
            myVote === 1 ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400'
          }`}
        >
          {arrow(1)}
        </button>
        <span
          className={`tnum border-x border-zinc-700 px-2 text-sm ${
            compact ? 'py-0.5 text-xs' : 'py-1'
          } ${score > 0 ? 'text-emerald-300' : score < 0 ? 'text-red-300' : 'text-zinc-300'}`}
        >
          {score}
        </span>
        <button
          type="button"
          aria-label="downvote"
          disabled={pending || busy}
          onClick={() => void click(-1)}
          className={`px-2 py-1 hover:bg-zinc-800 ${
            myVote === -1 ? 'bg-red-500/15 text-red-300' : 'text-zinc-400'
          }`}
        >
          {arrow(-1)}
        </button>
      </div>
      {promptAuth && !token && (
        <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
          Voting needs an account.{' '}
          <button
            type="button"
            onClick={() => void createAccount()}
            className="font-medium text-sky-300 hover:underline"
          >
            Create one, takes one click
          </button>
        </div>
      )}
    </div>
  );
}
