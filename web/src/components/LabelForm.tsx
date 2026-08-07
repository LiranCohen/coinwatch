import { useState } from 'react';

import type { Label } from '@chainwatch/shared';

import { isHttpUrl } from '../lib/format';
import { useSession } from '../session';

interface LabelFormProps {
  address: string;
  onSubmit: (body: { tag: string; note?: string; evidenceUrl?: string }) => Promise<Label>;
  onCreated: (label: Label) => void;
}

export function LabelForm({ address, onSubmit, onCreated }: LabelFormProps) {
  const { token, createAccount, busy } = useSession();
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 px-4 py-5 text-sm text-zinc-400">
        Labeling needs an identity.{' '}
        <button
          type="button"
          disabled={busy}
          onClick={() => void createAccount()}
          className="font-medium text-sky-300 hover:underline"
        >
          Create an account. One click, no password
        </button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmedTag = tag.trim();
    if (trimmedTag.length < 2 || trimmedTag.length > 32) {
      setError('Tag must be 2–32 characters.');
      return;
    }
    if (note.length > 280) {
      setError('Note must be 280 characters or fewer.');
      return;
    }
    const trimmedUrl = evidenceUrl.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      setError('Evidence must be an absolute http(s) URL.');
      return;
    }
    setSubmitting(true);
    try {
      const label = await onSubmit({
        tag: trimmedTag,
        note: note.trim() || undefined,
        evidenceUrl: trimmedUrl || undefined,
      });
      onCreated(label);
      setTag('');
      setNote('');
      setEvidenceUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to submit label');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs text-zinc-500">
        Labeling <span className="font-mono text-zinc-400">{address}</span>
      </p>
      <input
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder='Tag, e.g. "exchange hot wallet"'
        maxLength={32}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional, 280 chars)"
        maxLength={280}
        rows={2}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none"
      />
      <input
        value={evidenceUrl}
        onChange={(e) => setEvidenceUrl(e.target.value)}
        placeholder="Evidence URL (optional, https://…)"
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || tag.trim().length < 2}
        className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? 'Submitting…' : 'Submit label'}
      </button>
    </form>
  );
}
