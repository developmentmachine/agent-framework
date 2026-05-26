import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  LocalSandboxBackend,
  createZodTool,
  type SandboxBackend,
  type Tool,
  type ToolRegistry,
} from '@agent-framework/core';

export interface BuiltinToolsOptions {
  sandbox?: SandboxBackend;
  shellTimeoutMs?: number;
}

function resolveWithinWorkspace(workspaceRoot: string, targetPath: string): string {
  const resolved = resolve(workspaceRoot, targetPath);
  const normalizedRoot = resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error('Path escapes workspace root');
  }
  return resolved;
}

export function registerBuiltinTools(registry: ToolRegistry, options: BuiltinToolsOptions = {}): void {
  for (const tool of createBuiltinTools(options)) {
    registry.register(tool);
  }
}

export function createBuiltinTools(options: BuiltinToolsOptions = {}): Tool[] {
  const sandbox = options.sandbox ?? new LocalSandboxBackend();
  const shellTimeoutMs = options.shellTimeoutMs ?? 60_000;

  return [
    createZodTool(
      {
        name: 'read_file',
        description: 'Read a UTF-8 text file from the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path within workspace' },
          },
          required: ['path'],
        },
      },
      z.object({ path: z.string() }),
      async (ctx, args) => {
        const fullPath = resolveWithinWorkspace(ctx.workspaceRoot, args.path);
        return readFile(fullPath, 'utf8');
      },
    ),
    createZodTool(
      {
        name: 'write_file',
        description: 'Write UTF-8 text to a file in the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
      z.object({ path: z.string(), content: z.string() }),
      async (ctx, args) => {
        const fullPath = resolveWithinWorkspace(ctx.workspaceRoot, args.path);
        await writeFile(fullPath, args.content, 'utf8');
        return `Wrote ${args.path}`;
      },
    ),
    createZodTool(
      {
        name: 'glob',
        description: 'Find files by glob-like suffix match within workspace',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Filename suffix or substring' },
          },
          required: ['pattern'],
        },
      },
      z.object({ pattern: z.string() }),
      async (ctx, args) => {
        const matches = await walkFiles(ctx.workspaceRoot, args.pattern);
        return matches.sort().slice(0, 100);
      },
    ),
    createZodTool(
      {
        name: 'grep',
        description: 'Search file contents for a regex pattern',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', description: 'Optional relative path to limit search' },
          },
          required: ['pattern'],
        },
      },
      z.object({ pattern: z.string(), path: z.string().optional() }),
      async (ctx, args) => {
        const root = args.path ? resolveWithinWorkspace(ctx.workspaceRoot, args.path) : ctx.workspaceRoot;
        const regex = new RegExp(args.pattern, 'i');
        const hits: string[] = [];
        for (const file of await walkFiles(root, '')) {
          const content = await readFile(file, 'utf8').catch(() => null);
          if (!content) {
            continue;
          }
          const lines = content.split('\n');
          for (let index = 0; index < lines.length; index += 1) {
            if (regex.test(lines[index] ?? '')) {
              hits.push(`${relative(ctx.workspaceRoot, file)}:${index + 1}:${lines[index]}`);
            }
          }
          if (hits.length >= 100) {
            break;
          }
        }
        return hits;
      },
    ),
    createZodTool(
      {
        name: 'shell',
        description: 'Execute a shell command in the workspace',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
          },
          required: ['command'],
        },
        concurrency: 'serial',
      },
      z.object({ command: z.string() }),
      async (ctx, args) => {
        const result = await sandbox.execute(args.command, {
          cwd: ctx.workspaceRoot,
          timeoutMs: shellTimeoutMs,
          abortSignal: ctx.abortSignal,
        });
        const output = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
        if (result.exitCode !== 0) {
          return output || `Command exited with code ${result.exitCode}`;
        }
        return output;
      },
    ),
  ];
}

async function walkFiles(root: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(current, entry.name);
      if (entry.name.startsWith('.git') || entry.name === 'node_modules') {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (!pattern || entry.name.includes(pattern)) {
        results.push(fullPath);
      }
    }
  }
  await walk(root);
  return results;
}
