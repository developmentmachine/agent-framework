#!/usr/bin/env node
import { Command } from 'commander';
import {
  createCodingRuntime,
  CronAgentSurface,
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
  .option('--session <id>', 'Session id', 'default')
  .option('--data-dir <path>', 'SQLite data directory', '.agent-data');

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
  dataDir?: string;
  autoApprove?: boolean;
  telemetry?: boolean;
}) {
  const tools = new DefaultToolRegistry();
  registerBuiltinTools(tools);
  const dataDir = options.dataDir ?? '.agent-data';
  return createCodingRuntime(createProvider(options.provider, options.model), {
    config: { workspaceRoot: options.workspace, model: options.model, provider: options.provider },
    tools,
    sqliteSessionPath: `${dataDir}/sessions.db`,
    sqliteMemoryPath: `${dataDir}/memory.db`,
    onAskPermission: options.autoApprove ? async () => true : undefined,
    telemetry: options.telemetry,
  });
}

program
  .command('run')
  .argument('<message>', 'User message')
  .option('--mode <mode>', 'agent | plan | ask', 'agent')
  .option('--auto-approve', 'Auto approve permission prompts')
  .action(async (message: string, cmd) => {
    const globals = program.opts<{ workspace: string; provider: string; model: string; session: string; dataDir: string }>();
    const runtime = buildRuntime({
      workspace: globals.workspace,
      provider: globals.provider,
      model: globals.model,
      dataDir: globals.dataDir,
      autoApprove: cmd.autoApprove,
    });

    for await (const event of runtime.router.route({
      sessionId: globals.session,
      input: { role: 'user', content: message },
      mode: cmd.mode,
    })) {
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
    const globals = program.opts<{ workspace: string; provider: string; model: string; dataDir: string }>();
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
    const globals = program.opts<{ workspace: string; provider: string; model: string; session: string; dataDir: string }>();
    const runtime = buildRuntime({
      workspace: globals.workspace,
      provider: globals.provider,
      model: globals.model,
      dataDir: globals.dataDir,
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

program
  .command('gateway')
  .description('Start the WebSocket gateway server')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', '18789')
  .option('--plugin-path <path>', 'Plugin search path', '')
  .action(async (cmd) => {
    const globals = program.opts<{ workspace: string; provider: string; model: string; dataDir: string }>();
    const { createGatewayServer } = await import('@agent-framework/gateway');
    const runtime = buildRuntime({ ...globals, telemetry: true });
    if (cmd.pluginPath) {
      const { bootstrapPlugins, PluginWatcher } = await import('@agent-framework/plugin-sdk');
      await bootstrapPlugins(runtime, { searchPaths: [cmd.pluginPath] });
      new PluginWatcher(runtime, { searchPaths: [cmd.pluginPath] }).start();
    }
    const port = await createGatewayServer({
      runtime,
      host: cmd.host,
      port: Number(cmd.port),
    }).start();
    process.stdout.write(`Gateway listening on ws://${cmd.host}:${port}\n`);
    await new Promise<void>(() => undefined);
  });

program
  .command('cron')
  .description('Run a scheduled agent prompt on an interval')
  .requiredOption('--interval <ms>', 'Interval in milliseconds')
  .requiredOption('--prompt <text>', 'Prompt to run on each tick')
  .action(async (cmd) => {
    const globals = program.opts<{ workspace: string; provider: string; model: string; session: string; dataDir: string }>();
    const runtime = buildRuntime(globals);
    const surface = new CronAgentSurface({ runtime });
    surface.register({
      id: 'cli-cron',
      intervalMs: Number(cmd.interval),
      prompt: cmd.prompt,
      sessionId: globals.session,
      enabled: true,
    });
    process.stdout.write(`Cron job running every ${cmd.interval}ms (Ctrl+C to stop)\n`);
    await new Promise<void>(() => undefined);
  });

program
  .command('webhook')
  .description('Start the HTTP webhook surface')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', '8787')
  .option('--path <path>', 'Webhook path', '/webhook')
  .action(async (cmd) => {
    const globals = program.opts<{ workspace: string; provider: string; model: string; dataDir: string }>();
    const { WebhookSurface } = await import('@agent-framework/core');
    const runtime = buildRuntime(globals);
    const surface = new WebhookSurface({
      runtime,
      host: cmd.host,
      port: Number(cmd.port),
      path: cmd.path,
    });
    await surface.start();
    process.stdout.write(`Webhook listening on http://${cmd.host}:${cmd.port}${cmd.path}\n`);
    await new Promise<void>(() => undefined);
  });


program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
