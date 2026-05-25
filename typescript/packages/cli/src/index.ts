#!/usr/bin/env node
import { Command } from 'commander';
import {
  createAgentRuntime,
  DefaultToolRegistry,
} from '@agent-framework/core';
import { AnthropicProvider, MockProvider, OpenAIProvider } from '@agent-framework/providers';
import { registerBuiltinTools } from '@agent-framework/tools-builtin';

const program = new Command();

program
  .name('agent-framework')
  .description('Universal agent framework CLI')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .option('--provider <name>', 'Model provider', process.env.AGENT_PROVIDER ?? 'mock')
  .option('--model <name>', 'Model id', process.env.AGENT_MODEL ?? 'gpt-4o-mini')
  .option('--session <id>', 'Session id', 'default');

export function createProvider(name: string, model: string) {
  if (name === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for openai provider');
    }
    return new OpenAIProvider({ apiKey, model });
  }
  if (name === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for anthropic provider');
    }
    return new AnthropicProvider({ apiKey, model });
  }
  return new MockProvider({
    responses: [{ text: 'Mock agent response. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY for live models.' }],
  });
}

export function buildRuntime(options: {
  workspace: string;
  provider: string;
  model: string;
  autoApprove?: boolean;
}) {
  const tools = new DefaultToolRegistry();
  registerBuiltinTools(tools);
  return createAgentRuntime(createProvider(options.provider, options.model), {
    config: { workspaceRoot: options.workspace, model: options.model, provider: options.provider },
    tools,
    onAskPermission: options.autoApprove ? async () => true : undefined,
  });
}

program
  .command('run')
  .argument('<message>', 'User message')
  .option('--mode <mode>', 'agent | plan | ask', 'agent')
  .option('--auto-approve', 'Auto approve permission prompts')
  .action(async (message: string, cmd) => {
    const globals = program.opts<{ workspace: string; provider: string; model: string; session: string }>();
    const runtime = buildRuntime({
      workspace: globals.workspace,
      provider: globals.provider,
      model: globals.model,
      autoApprove: cmd.autoApprove,
    });

    const generator = runtime.router.route({
      sessionId: globals.session,
      input: { role: 'user', content: message },
      mode: cmd.mode,
    });

    for await (const event of generator) {
      if (event.type === 'assistant') {
        process.stdout.write(event.delta);
      } else if (event.type === 'tool') {
        process.stdout.write(`\n[tool:${event.name}] ${event.status}\n`);
      } else if (event.type === 'lifecycle' && event.phase === 'error') {
        process.stderr.write(`\nError: ${event.error}\n`);
      }
    }
    process.stdout.write('\n');
  });

program
  .command('tools')
  .description('List registered tools')
  .action(() => {
    const globals = program.opts<{ workspace: string; provider: string; model: string }>();
    const runtime = buildRuntime(globals);
    for (const tool of runtime.tools.list()) {
      console.log(`${tool.name}\t${tool.description}`);
    }
  });

program
  .command('chat')
  .description('Interactive REPL chat')
  .option('--auto-approve', 'Auto approve permission prompts')
  .action(async (cmd) => {
    const globals = program.opts<{ workspace: string; provider: string; model: string; session: string }>();
    const runtime = buildRuntime({
      workspace: globals.workspace,
      provider: globals.provider,
      model: globals.model,
      autoApprove: cmd.autoApprove,
    });

    process.stdout.write('agent-framework chat (Ctrl+D to exit)\n');
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      while (true) {
        const line = await rl.question('> ');
        if (!line.trim()) {
          continue;
        }
        for await (const event of runtime.router.route({
          sessionId: globals.session,
          input: { role: 'user', content: line },
        })) {
          if (event.type === 'assistant') {
            process.stdout.write(event.delta);
          }
        }
        process.stdout.write('\n');
      }
    } catch {
      rl.close();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
