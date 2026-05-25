import { createAgentRuntime, createZodTool, DefaultToolRegistry } from '@agent-framework/core';
import { MockProvider } from '@agent-framework/providers';
import { z } from 'zod';

const tools = new DefaultToolRegistry();
tools.register(
  createZodTool(
    {
      name: 'echo',
      description: 'Echo input',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    z.object({ text: z.string() }),
    async (_ctx, args) => args.text,
  ),
);

const runtime = createAgentRuntime(
  new MockProvider({
    responses: [{ toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }] }, { text: 'done' }],
  }),
  { tools },
);

for await (const event of runtime.router.route({
  sessionId: 'echo',
  input: { role: 'user', content: 'echo hi' },
})) {
  console.log(event);
}
