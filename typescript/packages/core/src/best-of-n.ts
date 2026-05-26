import type { AgentRuntime } from './runtime.js';
import type { AgentRunRequest, TerminalReason } from './types/domain.js';
import type { StreamEvent } from './types/contracts.js';

export interface BestOfNCandidate {
  id: string;
  runtime: AgentRuntime;
}

export interface BestOfNResult {
  winnerId: string;
  candidates: Array<{
    id: string;
    reason: TerminalReason;
    events: StreamEvent[];
    score: number;
  }>;
}

export interface BestOfNOptions {
  selectWinner?: (results: BestOfNResult['candidates']) => string;
}

export class BestOfNOrchestrator {
  constructor(private readonly options: BestOfNOptions = {}) {}

  async run(request: AgentRunRequest, candidates: BestOfNCandidate[]): Promise<BestOfNResult> {
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const events: StreamEvent[] = [];
        const generator = candidate.runtime.router.route({
          ...request,
          sessionId: `${request.sessionId}:${candidate.id}`,
        });
        let result = await generator.next();
        while (!result.done) {
          events.push(result.value);
          result = await generator.next();
        }
        const reason = result.value ?? { kind: 'completed' };
        return {
          id: candidate.id,
          reason,
          events,
          score: scoreCandidate(events, reason),
        };
      }),
    );

    const winnerId =
      this.options.selectWinner?.(results) ??
      [...results].sort((a, b) => b.score - a.score)[0]?.id ??
      candidates[0]?.id ??
      'unknown';

    return { winnerId, candidates: results };
  }
}

function scoreCandidate(events: StreamEvent[], reason: TerminalReason): number {
  let score = 0;
  if (reason.kind === 'completed') {
    score += 100;
  }
  if (reason.kind === 'error') {
    score -= 50;
  }
  score += events.filter((event) => event.type === 'assistant').length * 5;
  score -= events.filter((event) => event.type === 'tool' && event.status === 'error').length * 10;
  return score;
}
