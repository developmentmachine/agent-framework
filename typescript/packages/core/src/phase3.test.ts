import { describe, expect, it } from 'vitest';
import {
  BestOfNOrchestrator,
  MultiAgentRouter,
  TruncateMiddleCompactor,
  createAgentRuntime,
  estimateTokens,
  type Message,
} from '../src/index.js';
import { FailoverProvider, MockProvider } from '@agent-framework/providers';

describe('TruncateMiddleCompactor', () => {
  it('reduces message count when over token budget', async () => {
    const compactor = new TruncateMiddleCompactor();
    const messages: Message[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first' },
      ...Array.from({ length: 20 }, (_, index) => ({ role: 'user' as const, content: `msg-${index}` })),
      { role: 'assistant', content: 'tail' },
    ];

    const compacted = await compactor.compact(messages, 10);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(estimateTokens(compacted[0]!)).toBeGreaterThan(0);
  });
});

describe('FailoverProvider', () => {
  it('falls back to the next provider', async () => {
    const failing: MockProvider = {
      id: 'fail',
      stream: async function* () {
        throw new Error('provider down');
      },
    } as unknown as MockProvider;

    const backup = new MockProvider({ responses: [{ text: 'backup ok' }] });
    const provider = new FailoverProvider({ providers: [failing, backup] });

    const chunks = [];
    for await (const chunk of provider.stream({ messages: [], tools: [] })) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.type === 'text_delta' && chunk.textDelta === 'backup ok')).toBe(true);
  });
});

describe('MultiAgentRouter', () => {
  it('routes by channel', () => {
    const main = createAgentRuntime(new MockProvider({ responses: [{ text: 'main' }] }));
    const coding = createAgentRuntime(new MockProvider({ responses: [{ text: 'coding' }] }));

    const router = new MultiAgentRouter(
      [{ agentId: 'coding', runtime: coding, channel: 'github' }],
      main,
    );

    expect(router.resolve({ sessionId: 's1', input: { role: 'user', content: 'hi' }, channel: 'github' })).toBe(coding);
    expect(router.resolve({ sessionId: 's1', input: { role: 'user', content: 'hi' }, channel: 'slack' })).toBe(main);
  });
});

describe('BestOfNOrchestrator', () => {
  it('selects the higher scoring candidate', async () => {
    const good = createAgentRuntime(new MockProvider({ responses: [{ text: 'good answer' }] }));
    const bad = createAgentRuntime(
      new MockProvider({
        responses: [
          { toolCalls: [{ name: 'missing', arguments: {} }] },
          { text: 'bad' },
        ],
      }),
    );

    const orchestrator = new BestOfNOrchestrator();
    const result = await orchestrator.run(
      { sessionId: 'race', input: { role: 'user', content: 'solve' } },
      [
        { id: 'good', runtime: good },
        { id: 'bad', runtime: bad },
      ],
    );

    expect(result.winnerId).toBe('good');
  });
});
