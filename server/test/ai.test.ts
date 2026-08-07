import { describe, test, expect } from 'bun:test';
import { createAiProvider, type AiEventContext } from '../src/ai/provider';

const openAiConfig = {
  aiBaseUrl: 'https://ai.example/v1',
  aiApiKey: 'sk-test',
  aiModel: 'model-x',
};

const ctx: AiEventContext = {
  rules: ['whale'],
  valueSats: 2_500_000_000,
  addresses: ['bc1qexampleaddress0000000000000000000000'],
  matchedLabels: [{ address: 'bc1qexampleaddress0000000000000000000000', tag: 'exchange-hot-wallet' }],
};

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch;
}

function chatResponse(content: string, status = 200): Response {
  if (status !== 200) {
    return new Response('server error', { status });
  }
  return Response.json({ choices: [{ message: { content } }] });
}

describe('createAiProvider', () => {
  test('missing API key selects the mock provider', () => {
    expect(createAiProvider({ aiBaseUrl: null, aiApiKey: null, aiModel: null }).name).toBe('mock');
    expect(
      createAiProvider({ aiBaseUrl: 'https://ai.example/v1', aiApiKey: null, aiModel: 'm' }).name,
    ).toBe('mock');
  });

  test('fully configured env selects the OpenAI-compatible provider', () => {
    expect(createAiProvider(openAiConfig).name).toBe('openai-compatible');
  });
});

describe('openai-compatible provider', () => {
  test('HTTP 200 with SUMMARY/TAG contract yields parsed summary and tag', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody: { model?: string } = {};
    const provider = createAiProvider(openAiConfig, {
      fetch: stubFetch(async (url, init) => {
        seenUrl = url;
        seenAuth = new Headers(init?.headers).get('authorization') ?? '';
        seenBody = JSON.parse(String(init?.body));
        return chatResponse('SUMMARY: A whale moved 25 BTC to an exchange wallet.\nTAG: whale-move');
      }),
    });

    const result = await provider.summarizeEvent(ctx);
    expect(result).toEqual({
      ok: true,
      summary: 'A whale moved 25 BTC to an exchange wallet.',
      tag: 'whale-move',
    });
    expect(seenUrl).toBe('https://ai.example/v1/chat/completions');
    expect(seenAuth).toBe('Bearer sk-test');
    expect(seenBody.model).toBe('model-x');
  });

  test('HTTP 200 with JSON body is also accepted', async () => {
    const provider = createAiProvider(openAiConfig, {
      fetch: stubFetch(async () =>
        chatResponse(JSON.stringify({ summary: 'Coins moved.', tag: 'exchange-flow' })),
      ),
    });
    const result = await provider.summarizeEvent(ctx);
    expect(result).toEqual({ ok: true, summary: 'Coins moved.', tag: 'exchange-flow' });
  });

  test('tag outside the fixed list coerces to unknown', async () => {
    const provider = createAiProvider(openAiConfig, {
      fetch: stubFetch(async () => chatResponse('SUMMARY: Something odd.\nTAG: moon-landing')),
    });
    const result = await provider.summarizeEvent(ctx);
    expect(result).toEqual({ ok: true, summary: 'Something odd.', tag: 'unknown' });
  });

  test('malformed model output returns ok:false', async () => {
    const provider = createAiProvider(openAiConfig, {
      fetch: stubFetch(async () => chatResponse('I cannot help with that request.')),
    });
    const result = await provider.summarizeEvent(ctx);
    expect(result.ok).toBe(false);
  });

  test('HTTP 500 returns ok:false and does not throw', async () => {
    const provider = createAiProvider(openAiConfig, {
      fetch: stubFetch(async () => chatResponse('', 500)),
    });
    const result = await provider.summarizeEvent(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('500');
  });

  test('timeout returns ok:false', async () => {
    const provider = createAiProvider(openAiConfig, {
      timeoutMs: 20,
      fetch: stubFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation timed out.', 'TimeoutError')),
            );
          }),
      ),
    });
    const result = await provider.summarizeEvent(ctx);
    expect(result.ok).toBe(false);
  });

  test('transport throw returns ok:false', async () => {
    const provider = createAiProvider(openAiConfig, {
      fetch: stubFetch(async () => {
        throw new Error('connection refused');
      }),
    });
    const result = await provider.summarizeEvent(ctx);
    expect(result).toEqual({ ok: false, error: 'connection refused' });
  });
});

describe('mock provider', () => {
  test('returns deterministic demo-grade output per rule', async () => {
    const provider = createAiProvider({ aiBaseUrl: null, aiApiKey: null, aiModel: null });

    const whale = await provider.summarizeEvent(ctx);
    expect(whale.ok).toBe(true);
    if (whale.ok) {
      expect(whale.tag).toBe('whale-move');
      expect(whale.summary).toContain('[demo]');
      expect(whale.summary).toContain('25 BTC');
      expect(whale.summary).toContain('exchange-hot-wallet');
    }
    const again = await provider.summarizeEvent(ctx);
    expect(again).toEqual(whale);

    const dormant = await provider.summarizeEvent({ ...ctx, rules: ['dormant-wake'] });
    if (dormant.ok) expect(dormant.tag).toBe('dormant-wake');

    const coinjoin = await provider.summarizeEvent({ ...ctx, rules: ['coinjoin'] });
    if (coinjoin.ok) expect(coinjoin.tag).toBe('coinjoin');

    const demo = await provider.summarizeEvent({ ...ctx, rules: [] });
    if (demo.ok) expect(demo.tag).toBe('unknown');
  });
});
