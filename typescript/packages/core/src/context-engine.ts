import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextBuildRequest, ContextBuildResult, ContextEngine } from './types/contracts.js';
import type { AgentMode, Message } from './types/domain.js';

export interface WorkspaceContextOptions {
  workspaceRoot: string;
  contextFiles?: string[];
  skillsDir?: string;
}

const DEFAULT_CONTEXT_FILES = ['AGENTS.md', 'SOUL.md', 'TOOLS.md'];

export class WorkspaceContextEngine implements ContextEngine {
  constructor(private readonly options: WorkspaceContextOptions) {}

  async build(request: ContextBuildRequest): Promise<ContextBuildResult> {
    const sections: string[] = [];
    const modeInstruction = modePrompt(request.mode ?? 'agent');
    sections.push(modeInstruction);

    for (const fileName of this.options.contextFiles ?? DEFAULT_CONTEXT_FILES) {
      const content = await readOptional(join(this.options.workspaceRoot, fileName));
      if (content) {
        sections.push(`## ${fileName}\n${content}`);
      }
    }

    const skills = await this.loadSkills();
    if (skills.length > 0) {
      sections.push(`## Skills\n${skills.join('\n\n')}`);
    }

  const systemPrompt = sections.join('\n\n');
    return {
      systemPrompt,
      messages: prependSystem(request.history, systemPrompt),
    };
  }

  private async loadSkills(): Promise<string[]> {
    const skillsDir = this.options.skillsDir ?? join(this.options.workspaceRoot, 'skills');
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      const skills: string[] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) {
          const skillMd = await readOptional(join(skillsDir, entry.name, 'SKILL.md'));
          if (skillMd) {
            skills.push(`### Skill: ${entry.name}\n${skillMd}`);
          }
        }
      }
      return skills;
    } catch {
      return [];
    }
  }
}

function modePrompt(mode: AgentMode): string {
  switch (mode) {
    case 'plan':
      return 'You are in plan mode. Produce detailed implementation plans before making changes.';
    case 'ask':
      return 'You are in ask mode. Answer questions without modifying files or running destructive commands.';
    default:
      return 'You are an autonomous coding agent. Use tools to inspect and modify the workspace safely.';
  }
}

function prependSystem(history: Message[], systemPrompt: string): Message[] {
  const withoutSystem = history.filter((message) => message.role !== 'system');
  return [{ role: 'system', content: systemPrompt }, ...withoutSystem];
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
