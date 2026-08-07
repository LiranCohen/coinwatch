import type { Config } from '../config';
import type { Rule } from '@chainwatch/shared';

export const AI_TAGS = ['whale-move', 'dormant-wake', 'coinjoin', 'exchange-flow', 'unknown'] as const;
export type AiTag = (typeof AI_TAGS)[number];

export type AiResult = { ok: true; summary: string; tag: AiTag } | { ok: false; error: string };

export interface AiEventContext {
  rules: Rule[];
  valueSats: number;
  addresses: string[];
  matchedLabels: { address: string; tag: string; note?: string | null }[];
}

export interface AiProvider {
  readonly name: 'openai-compatible' | 'mock';
  summarizeEvent(ctx: AiEventContext): Promise<AiResult>;
}

export interface AiProviderDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type AiConfig = Pick<Config, 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>;

const DEFAULT_TIMEOUT_MS = 10_000;

function isAiTag(value: unknown): value is AiTag {
  return typeof value === 'string' && (AI_TAGS as readonly string[]).includes(value);
}

function satsToBtc(valueSats: number): string {
  return (valueSats / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0';
}

function buildUserPrompt(ctx: AiEventContext): string {
  const lines = [
    `Rules matched: ${ctx.rules.join(', ') || 'none'}`,
    `Value: ${satsToBtc(ctx.valueSats)} BTC (${ctx.valueSats} sats)`,
    `Involved addresses: ${ctx.addresses.join(', ') || 'unknown'}`,
  ];
  if (ctx.matchedLabels.length > 0) {
    const labels = ctx.matchedLabels
      .map((l) => `${l.address} -> ${l.tag}${l.note ? ` (${l.note})` : ''}`)
      .join('; ');
    lines.push(`Known labels for these addresses: ${labels}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  'You summarize Bitcoin transactions that tripped detection rules for a live mempool monitor.',
  'Respond with a 1-2 sentence summary for a non-technical audience, then exactly one tag.',
  `The tag must be one of: ${AI_TAGS.join(', ')}.`,
  'Use this exact two-line format:',
  'SUMMARY: <1-2 sentences>',
  'TAG: <tag>',
].join(' ');

function parseModelOutput(content: string): AiResult {
  const trimmed = content.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
        return {
          ok: true,
          summary: parsed.summary.trim(),
          tag: isAiTag(parsed.tag) ? parsed.tag : 'unknown',
        };
      }
    } catch {
      // fall through to the line contract
    }
  }

  const summaryMatch = /SUMMARY:\s*(.+?)(?:\n\s*TAG:|$)/is.exec(trimmed);
  const tagMatch = /TAG:\s*([a-z-]+)/i.exec(trimmed);
  if (summaryMatch && summaryMatch[1].trim().length > 0) {
    const rawTag = tagMatch?.[1]?.toLowerCase();
    return {
      ok: true,
      summary: summaryMatch[1].trim(),
      tag: isAiTag(rawTag) ? rawTag : 'unknown',
    };
  }

  return { ok: false, error: 'unparseable model output' };
}

function createOpenAiProvider(config: AiConfig, deps: AiProviderDeps): AiProvider {
  const fetchFn = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (config.aiBaseUrl as string).replace(/\/+$/, '');
  const apiKey = config.aiApiKey as string;
  const model = config.aiModel as string;

  return {
    name: 'openai-compatible',
    async summarizeEvent(ctx: AiEventContext): Promise<AiResult> {
      try {
        const res = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 150,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildUserPrompt(ctx) },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          return { ok: false, error: `http ${res.status}` };
        }

        const data = (await res.json()) as {
          choices?: { message?: { content?: unknown } }[];
        };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.trim().length === 0) {
          return { ok: false, error: 'empty model response' };
        }

        return parseModelOutput(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

const MOCK_RULE_LINES: Record<Rule, { line: string; tag: AiTag }> = {
  whale: {
    line: 'a large whale-sized transfer moved between addresses',
    tag: 'whale-move',
  },
  'dormant-wake': {
    line: 'long-dormant coins woke up and moved after extended inactivity',
    tag: 'dormant-wake',
  },
  coinjoin: {
    line: 'a transaction with many equal outputs resembles a CoinJoin privacy mix',
    tag: 'coinjoin',
  },
  demo: {
    line: 'a demo transaction was injected for presentation purposes',
    tag: 'unknown',
  },
};

function createMockProvider(): AiProvider {
  return {
    name: 'mock',
    summarizeEvent(ctx: AiEventContext): Promise<AiResult> {
      const primary = MOCK_RULE_LINES[ctx.rules[0]] ?? MOCK_RULE_LINES.demo;
      const parts = [
        `[demo] Mock analysis: ${primary.line}, moving ${satsToBtc(ctx.valueSats)} BTC.`,
      ];
      if (ctx.rules.length > 1) {
        parts.push(`Also matched: ${ctx.rules.slice(1).join(', ')}.`);
      }
      if (ctx.matchedLabels.length > 0) {
        parts.push(`Known labels involved: ${ctx.matchedLabels.map((l) => l.tag).join(', ')}.`);
      }
      return Promise.resolve({ ok: true, summary: parts.join(' '), tag: primary.tag });
    },
  };
}

export function createAiProvider(config: AiConfig, deps: AiProviderDeps = {}): AiProvider {
  if (config.aiApiKey && config.aiBaseUrl && config.aiModel) {
    return createOpenAiProvider(config, deps);
  }
  return createMockProvider();
}
