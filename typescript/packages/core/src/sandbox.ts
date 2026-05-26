import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SandboxBackend } from './types/contracts.js';

const execFileAsync = promisify(execFile);

export class LocalSandboxBackend implements SandboxBackend {
  async execute(
    command: string,
    options: { cwd: string; timeoutMs: number; abortSignal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        signal: options.abortSignal,
        maxBuffer: 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? String(error),
        exitCode: typeof err.code === 'number' ? err.code : 1,
      };
    }
  }
}

export class WorktreeSandboxBackend implements SandboxBackend {
  private worktrees = new Map<string, string>();

  constructor(private readonly repoRoot: string) {}

  async createWorktree(name: string): Promise<string> {
    const dir = await mkdtemp(join(this.repoRoot, `.agent-worktree-${name}-`));
    await execFileAsync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], {
      cwd: this.repoRoot,
    });
    this.worktrees.set(name, dir);
    return dir;
  }

  async removeWorktree(name: string): Promise<void> {
    const dir = this.worktrees.get(name);
    if (!dir) {
      return;
    }
    await execFileAsync('git', ['worktree', 'remove', '--force', dir], { cwd: this.repoRoot }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    this.worktrees.delete(name);
  }

  getWorktree(name: string): string | undefined {
    return this.worktrees.get(name);
  }

  async execute(
    command: string,
    options: { cwd: string; timeoutMs: number; abortSignal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new LocalSandboxBackend().execute(command, options);
  }
}
