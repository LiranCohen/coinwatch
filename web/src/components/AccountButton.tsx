import { useEffect, useRef, useState } from 'react';

import { downloadIdentityBackup, storedDidUri } from '../identity/enbox';
import { truncateDid } from '../lib/format';
import { useSession } from '../session';
import { ReputationBadge } from './badges';

export function AccountButton() {
  const { identity, token, busy, error, hasIdentity, createAccount, signIn, signOut, saveHandle } =
    useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (!token) {
    return (
      <div className="flex items-center gap-2">
        {hasIdentity && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void signIn()}
            className="rounded border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-400 disabled:opacity-50"
          >
            Sign in
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void createAccount()}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? 'Working…' : hasIdentity ? 'New account' : 'Create account'}
        </button>
        {error && <span className="max-w-48 truncate text-xs text-red-400" title={error}>{error}</span>}
      </div>
    );
  }

  const storedUri = identity?.did ?? storedDidUri();
  const displayName = identity?.handle ?? (storedUri ? truncateDid(storedUri) : 'account');

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:border-zinc-500"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
        <span className="max-w-40 truncate">{displayName}</span>
        {identity && <ReputationBadge reputation={identity.reputation} />}
      </button>
      {menuOpen && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
          {editingHandle ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveHandle(handleDraft.trim()).then(() => setEditingHandle(false));
              }}
            >
              <input
                autoFocus
                value={handleDraft}
                onChange={(e) => setHandleDraft(e.target.value)}
                placeholder="Display handle"
                maxLength={32}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none"
              />
              <button type="submit" className="rounded bg-sky-600 px-2 py-1 text-sm text-white">
                Save
              </button>
            </form>
          ) : (
            <div className="space-y-1">
              {identity?.did && (
                <p className="mb-2 break-all font-mono text-[10px] leading-relaxed text-zinc-500">{identity.did}</p>
              )}
              <button
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                onClick={() => {
                  setHandleDraft(identity?.handle ?? '');
                  setEditingHandle(true);
                }}
              >
                Edit handle
              </button>
              <button
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                onClick={() => downloadIdentityBackup()}
              >
                Export identity backup
              </button>
              <button
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-red-300 hover:bg-zinc-800"
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
