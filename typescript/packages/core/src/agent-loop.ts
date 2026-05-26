import { randomUUID } from 'node:crypto';
import type {
  AgentLoop,
  AgentLoopDeps,
  StreamEvent,
  ToolCallRequest,
} from './types/contracts.js';
import type {
  AgentRunRequest,
  Message,
  MessageContent,
  TerminalReason,
  ToolCallContent,
  ToolConcurrency,
} from './types/domain.js';

interface ToolExecutionResult {
  events: StreamEvent[];
  message: Message;
}

export class DefaultAgentLoop implements AgentLoop {
  constructor(private readonly deps: AgentLoopDeps) {}

  async *run(request: AgentRunRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown> {
    const runId = randomUUID();
    const hookContext = { sessionId: request.sessionId, runId };

    yield { type: 'lifecycle', phase: 'start', runId };
    await this.deps.hooks.emit({ type: 'onRunStart', context: hookContext });

    try {
      await this.deps.sessionStore.appendMessages(request.sessionId, [request.input]);
      const session = await this.deps.sessionStore.get(request.sessionId);
      const history = session?.messages ?? [request.input];

      for (let turn = 0; turn < this.deps.config.maxTurns; turn += 1) {
        if (request.abortSignal?.aborted) {
          await this.deps.hooks.emit({
            type: 'onRunEnd',
            context: hookContext,
            reason: { kind: 'cancelled' },
          });
          yield { type: 'lifecycle', phase: 'end', runId };
          return { kind: 'cancelled' };
        }

        if (this.deps.compactor) {
          const compacted = await this.deps.compactor.compact(history, this.deps.config.tokenBudget);
          history.splice(0, history.length, ...compacted);
        }

        const context = await this.deps.contextEngine.build({
          sessionId: request.sessionId,
          mode: request.mode,
          history,
        });

        const toolDefs = this.deps.tools.list();
        const pendingCalls: ToolCallRequest[] = [];
        let assistantText = '';

        for await (const chunk of this.deps.provider.stream({
          messages: context.messages,
          tools: toolDefs,
          abortSignal: request.abortSignal,
        })) {
          if (chunk.type === 'text_delta' && chunk.textDelta) {
            assistantText += chunk.textDelta;
            yield { type: 'assistant', delta: chunk.textDelta };
          }
          if (chunk.type === 'tool_call' && chunk.toolCall) {
            pendingCalls.push(chunk.toolCall);
          }
          if (chunk.type === 'usage' && chunk.usage) {
            yield { type: 'usage', tokens: chunk.usage };
          }
        }

        const assistantMessage = buildAssistantMessage(assistantText, pendingCalls);
        history.push(assistantMessage);
        await this.deps.sessionStore.appendMessages(request.sessionId, [assistantMessage]);

        if (pendingCalls.length === 0) {
          await this.deps.hooks.emit({
            type: 'onRunEnd',
            context: hookContext,
            reason: { kind: 'completed' },
          });
          yield { type: 'lifecycle', phase: 'end', runId };
          return { kind: 'completed' };
        }

        const toolMessages: Message[] = [];
        for await (const event of this.executeToolCalls(request, runId, pendingCalls, hookContext)) {
          if (isToolExecutionResult(event)) {
            toolMessages.push(event.message);
            history.push(event.message);
          } else {
            yield event;
          }
        }
        await this.deps.sessionStore.appendMessages(request.sessionId, toolMessages);
      }

      await this.deps.hooks.emit({
        type: 'onRunEnd',
        context: hookContext,
        reason: { kind: 'max_turns' },
      });
      yield { type: 'lifecycle', phase: 'end', runId };
      return { kind: 'max_turns' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.hooks.emit({
        type: 'onRunEnd',
        context: hookContext,
        reason: { kind: 'error', message },
      });
      yield { type: 'lifecycle', phase: 'error', runId, error: message };
      return { kind: 'error', message };
    }
  }

  private async *executeToolCalls(
    request: AgentRunRequest,
    runId: string,
    calls: ToolCallRequest[],
    hookContext: { sessionId: string; runId: string },
  ): AsyncGenerator<StreamEvent | ToolExecutionResult, void, unknown> {
    let index = 0;
    while (index < calls.length) {
      const call = calls[index]!;
      const concurrency = this.toolConcurrency(call.name);

      if (concurrency === 'serial') {
        const result = await this.executeToolCall(request, runId, call, hookContext);
        for (const event of result.events) {
          yield event;
        }
        yield result;
        index += 1;
        continue;
      }

      const batch: ToolCallRequest[] = [call];
      index += 1;
      while (index < calls.length && this.toolConcurrency(calls[index]!.name) === 'parallel') {
        batch.push(calls[index]!);
        index += 1;
      }

      const results = await Promise.all(
        batch.map((item) => this.executeToolCall(request, runId, item, hookContext)),
      );
      for (const result of results) {
        for (const event of result.events) {
          yield event;
        }
        yield result;
      }
    }
  }

  private toolConcurrency(toolName: string): ToolConcurrency {
    return this.deps.tools.get(toolName)?.definition.concurrency ?? 'parallel';
  }

  private async executeToolCall(
    request: AgentRunRequest,
    runId: string,
    call: ToolCallRequest,
    hookContext: { sessionId: string; runId: string },
  ): Promise<ToolExecutionResult> {
    const events: StreamEvent[] = [];
    events.push({ type: 'tool', callId: call.id, name: call.name, status: 'start' });

    await this.deps.hooks.emit({
      type: 'preToolUse',
      context: hookContext,
      toolName: call.name,
      arguments: call.arguments,
    });

    const decision = await this.deps.policy.check({
      toolName: call.name,
      arguments: call.arguments,
      sessionId: request.sessionId,
    });

    if (decision === 'deny') {
      const error = `Permission denied for tool ${call.name}`;
      await this.deps.hooks.emit({
        type: 'postToolUse',
        context: hookContext,
        toolName: call.name,
        result: null,
        error,
      });
      events.push({ type: 'tool', callId: call.id, name: call.name, status: 'error', output: error });
      return { events, message: toolResultMessage(call.id, error, true) };
    }

    if (decision === 'ask') {
      const approved = this.deps.onAskPermission
        ? await this.deps.onAskPermission({
            toolName: call.name,
            arguments: call.arguments,
            sessionId: request.sessionId,
          })
        : false;
      if (!approved) {
        const error = `User denied tool ${call.name}`;
        await this.deps.hooks.emit({
          type: 'postToolUse',
          context: hookContext,
          toolName: call.name,
          result: null,
          error,
        });
        events.push({ type: 'tool', callId: call.id, name: call.name, status: 'error', output: error });
        return { events, message: toolResultMessage(call.id, error, true) };
      }
    }

    const execution = await this.deps.tools.execute(
      {
        sessionId: request.sessionId,
        runId,
        workspaceRoot: this.deps.config.workspaceRoot,
        abortSignal: request.abortSignal,
      },
      call,
    );

    await this.deps.hooks.emit({
      type: 'postToolUse',
      context: hookContext,
      toolName: call.name,
      result: execution.output,
      error: execution.error,
    });

    const content = execution.error
      ? execution.error
      : typeof execution.output === 'string'
        ? execution.output
        : JSON.stringify(execution.output, null, 2);

    const status = execution.error ? 'error' : 'end';
    events.push({
      type: 'tool',
      callId: call.id,
      name: call.name,
      status,
      output: content,
    });

    return { events, message: toolResultMessage(call.id, content, Boolean(execution.error)) };
  }
}

function isToolExecutionResult(value: StreamEvent | ToolExecutionResult): value is ToolExecutionResult {
  return typeof value === 'object' && value !== null && 'message' in value && 'events' in value;
}

export function buildAssistantMessage(text: string, calls: ToolCallRequest[]): Message {
  if (calls.length === 0) {
    return { role: 'assistant', content: text };
  }
  const content: MessageContent[] = [];
  if (text) {
    content.push({ type: 'text', text });
  }
  for (const call of calls) {
    content.push({
      type: 'tool_call',
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    } satisfies ToolCallContent);
  }
  return { role: 'assistant', content };
}

export function toolResultMessage(toolCallId: string, content: string, isError: boolean): Message {
  return {
    role: 'tool',
    content: [{ type: 'tool_result', toolCallId, content, isError }],
  };
}
