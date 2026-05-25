import type { PermissionCheckRequest, PermissionDecision, PermissionPolicy } from './types/contracts.js';

export interface PermissionRule {
  toolName: string | '*';
  pattern?: RegExp;
  decision: PermissionDecision;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  constructor(private readonly rules: PermissionRule[] = []) {}

  async check(request: PermissionCheckRequest): Promise<PermissionDecision> {
    for (const rule of this.rules) {
      if (rule.toolName !== '*' && rule.toolName !== request.toolName) {
        continue;
      }
      if (rule.pattern && request.toolName === 'shell') {
        const command = String(request.arguments.command ?? '');
        if (rule.pattern.test(command)) {
          return rule.decision;
        }
        continue;
      }
      if (rule.toolName === request.toolName || rule.toolName === '*') {
        return rule.decision;
      }
    }
    return 'allow';
  }
}

export const DEFAULT_CODING_POLICY_RULES: PermissionRule[] = [
  { toolName: 'shell', pattern: /rm\s+-rf\s+\//, decision: 'deny' },
  { toolName: 'shell', pattern: /sudo\s+/, decision: 'ask' },
  { toolName: 'write_file', decision: 'allow' },
  { toolName: 'read_file', decision: 'allow' },
  { toolName: 'grep', decision: 'allow' },
  { toolName: 'glob', decision: 'allow' },
];
