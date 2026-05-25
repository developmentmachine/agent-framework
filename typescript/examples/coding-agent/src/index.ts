import { buildRuntime } from '@agent-framework/cli';

const runtime = buildRuntime({
  workspace: process.cwd(),
  provider: process.env.AGENT_PROVIDER ?? 'mock',
  model: process.env.AGENT_MODEL ?? 'gpt-4o-mini',
});

const message = process.argv.slice(2).join(' ') || 'List files in the workspace using tools.';

for await (const event of runtime.router.route({
  sessionId: 'coding-agent',
  input: { role: 'user', content: message },
  mode: 'agent',
})) {
  if (event.type === 'assistant') {
    process.stdout.write(event.delta);
  }
}
process.stdout.write('\n');
