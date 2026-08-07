import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { classifySearchInput, type AddressValidation, type BitcoinAddressKind } from '@chainwatch/shared';

import { resolveSearch } from '../api/client';

const KIND_LABELS: Record<BitcoinAddressKind, string> = {
  p2pkh: 'P2PKH',
  p2sh: 'P2SH',
  p2wpkh: 'P2WPKH',
  p2wsh: 'P2WSH',
  p2tr: 'P2TR',
};

const HEX_PATTERN = /^[0-9a-f]+$/i;
const SEGWIT_PREFIXES = ['bc1', 'tb1', 'bcrt1'];

const TXID_LENGTH = 64;
/** longest segwit address this app can resolve: p2wsh and p2tr are both 62 characters */
const LONGEST_SEGWIT_LENGTH = 62;
/**
 * Longest base58 address in practice. Testnet p2sh can reach 35, but treating 34
 * as the end means a mistyped mainnet address — the overwhelmingly common case —
 * gets told so instead of staying silent.
 */
const LONGEST_BASE58_LENGTH = 34;

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

interface Feedback {
  tone: 'ok' | 'error';
  text: string;
}

/**
 * Length past which an unparseable input can no longer turn valid by typing more.
 * Complaining before that point flashes a checksum error at someone who is only
 * halfway through entering a perfectly good address.
 */
function settledLength(value: string): number {
  if (HEX_PATTERN.test(value)) return TXID_LENGTH;
  const lowered = value.toLowerCase();
  if (SEGWIT_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return LONGEST_SEGWIT_LENGTH;
  return LONGEST_BASE58_LENGTH;
}

function describeAddress(validation: AddressValidation): string {
  const kind = validation.kind === null ? 'address' : `${KIND_LABELS[validation.kind]} address`;
  if (validation.network === null || validation.network === 'mainnet') return kind;
  return `${kind} · ${validation.network}`;
}

/** '/' is an ordinary character inside any editable field, so the shortcut yields to one */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable;
}

export function AddressSearch({ className }: { className?: string }): React.JSX.Element {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [resolving, setResolving] = useState(false);
  const inputId = useId();
  const messageId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const input = inputRef.current;
      if (input === null) return;
      // a field that is hidden, disabled or detached refuses focus; claiming the keystroke in
      // that state would swallow '/' and leave the page doing nothing at all, so only take the
      // event once focus has demonstrably landed
      input.focus();
      if (document.activeElement !== input) return;
      event.preventDefault();
      input.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const hint = useMemo<Feedback | null>(() => {
    if (value.trim().length === 0) return null;
    const target = classifySearchInput(value);
    if (target.kind === 'address') return { tone: 'ok', text: describeAddress(target.validation) };
    if (target.kind === 'txid') return { tone: 'ok', text: 'transaction id' };
    if (target.value.length < settledLength(target.value)) return null;
    return { tone: 'error', text: target.reason };
  }, [value]);

  const feedback: Feedback | null = resolving
    ? { tone: 'ok', text: 'looking…' }
    : error === null
      ? hint
      : { tone: 'error', text: error };
  const errored = feedback?.tone === 'error';

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = value.trim();
    if (query === '') return;

    // An address is unambiguous locally, so route it without a round trip. A
    // 64-hex string is not: it is the shape of both a txid and a block hash,
    // and only the chain can say which. Bare digits are a block height.
    const target = classifySearchInput(query);
    if (target.kind === 'address') {
      setError(null);
      inputRef.current?.blur();
      navigate(`/app/address/${target.value}`);
      return;
    }

    setError(null);
    setResolving(true);
    resolveSearch(query)
      .then((found) => {
        if (found.kind === 'unknown' || found.value === null) {
          setError(found.reason ?? 'nothing found for that');
          inputRef.current?.focus();
          return;
        }
        // the on-screen keyboard would otherwise cover the page being navigated to
        inputRef.current?.blur();
        if (found.kind === 'address') navigate(`/app/address/${found.value}`);
        else if (found.kind === 'tx') navigate(`/app/tx/${found.value}`);
        else navigate(`/app/block/${found.height ?? found.value}`);
      })
      .catch(() => setError('search is unavailable right now'))
      .finally(() => setResolving(false));
  };

  return (
    <form role="search" onSubmit={submit} className={`relative w-full min-w-0 ${className ?? ''}`}>
      <label htmlFor={inputId} className="sr-only">
        Search address, transaction or block
      </label>
      {/* 16px text and a ~44px box below md: anything smaller makes iOS Safari zoom the whole
          page on focus, and there the field is a touch target rather than a toolbar slot */}
      <input
        id={inputId}
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          setError(null);
          e.currentTarget.blur();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search address, transaction or block"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-invalid={errored}
        aria-describedby={feedback ? messageId : undefined}
        className={`w-full rounded border bg-zinc-950 px-3 py-2.5 pr-7 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none md:py-1.5 md:text-sm ${
          errored ? 'border-red-800 focus:border-red-600' : 'border-zinc-700 focus:border-sky-500'
        }`}
      />
      {!focused && value.length === 0 && (
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-zinc-700 px-1 text-[10px] text-zinc-500 sm:block">
          /
        </kbd>
      )}
      {/* the message wraps rather than truncating: the longest one runs to 67 characters where a
          375px header fits about 54, and a phone has no hover to recover the rest. title covers
          what is left — a pointer over a box an ancestor's overflow clips */}
      {feedback && (
        <p
          id={messageId}
          aria-live="polite"
          title={feedback.text}
          className={`absolute top-full left-0 z-20 mt-1 max-w-full rounded border bg-zinc-900 px-2 py-1 text-xs break-words ${
            errored ? 'border-red-900/70 text-red-300' : 'border-zinc-800 text-zinc-400'
          }`}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
