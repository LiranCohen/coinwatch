import { useState } from 'react';

import type { EventDetail } from '@chainwatch/shared';

import { postAiFeedback } from '../api/client';
import { useSession } from '../session';

interface AiCardProps {
  event: EventDetail;
  onFeedback: (feedback: EventDetail['aiFeedback']) => void;
}

export function AiCard({ event, onFeedback }: AiCardProps) {
  const { token, createAccount, busy } = useSession();
  const [pending, setPending] = useState(false);
  const [promptAuth, setPromptAuth] = useState(false);

  const send = async (value: 'confirm' | 'refute') => {
    if (!token) {
      setPromptAuth(true);
      return;
    }
    setPending(true);
    try {
      onFeedback(await postAiFeedback(event.id, value, token));
    } finally {
      setPending(false);
    }
  };

  if (event.aiStatus !== 'done') {
    return (
      <section className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-4">
        <header className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wider text-zinc-400">AI FIRST PASS</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
            machine-generated
          </span>
        </header>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          {event.aiStatus === 'pending' && (
            <>
              <span className="cw-pulse inline-block h-2 w-2 rounded-full bg-zinc-500" />
              Analysis pending — the AI provider is working on this event.
            </>
          )}
          {event.aiStatus === 'failed' && (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
              Analysis pending — the AI provider failed; the event is unaffected (AE5).
            </>
          )}
        </div>
      </section>
    );
  }

  const { aiFeedback } = event;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wider text-zinc-300">AI FIRST PASS</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
          machine-generated
        </span>
        {event.aiTag && (
          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
            {event.aiTag}
          </span>
        )}
      </header>
      <p className="text-sm leading-relaxed text-zinc-200">{event.aiSummary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={pending || busy}
            onClick={() => void send('confirm')}
            className={`rounded border px-2.5 py-1 text-xs font-medium ${
              aiFeedback.mine === 'confirm'
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            Confirm{aiFeedback.confirms > 0 ? ` · ${aiFeedback.confirms}` : ''}
          </button>
          <button
            type="button"
            disabled={pending || busy}
            onClick={() => void send('refute')}
            className={`rounded border px-2.5 py-1 text-xs font-medium ${
              aiFeedback.mine === 'refute'
                ? 'border-red-500/60 bg-red-500/15 text-red-300'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            Refute{aiFeedback.refutes > 0 ? ` · ${aiFeedback.refutes}` : ''}
          </button>
        </div>
        <span className="text-xs text-zinc-500">Crowd verdict on the AI take</span>
      </div>
      {promptAuth && !token && (
        <p className="mt-2 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
          Confirming or refuting needs an account.{' '}
          <button
            type="button"
            onClick={() => void createAccount()}
            className="font-medium text-sky-300 hover:underline"
          >
            Create one — one click
          </button>
        </p>
      )}
    </section>
  );
}
