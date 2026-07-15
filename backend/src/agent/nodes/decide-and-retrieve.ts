import type OpenAI from 'openai';
import { agentOpenai, AGENT_MODEL } from '../openai-client.js';
import { TOOL_DEFINITIONS, executeTool } from '../tools.js';
import type { AgentState, AgentStateUpdate, ToolCallLogEntry } from '../state.js';

/**
 * Blunt safety valve against a runaway tool loop while this node still calls
 * the LLM directly (no AbortController/per-call timeout yet — that's Phase 3
 * per GENAI_POC_PRD.md §6). This is a static iteration bound, not the
 * state.toolCallCount-driven cap + escalate_to_human fallback described in
 * §5.4 — that policy-level enforcement is Phase 3 scope and is intentionally
 * not built here yet.
 */
const MAX_LOOP_ITERATIONS = 5;

function buildDecisionPrompt(state: AgentState): string {
  const historyTail = state.history.slice(-8).map((m) => `${m.sender}: ${m.content}`).join('\n');
  return `You are a sales assistant for ${state.user.business_name || 'this business'} (${state.domain.displayName}).
You decide which tool(s), if any, to call to help answer the customer's message. Call at most one tool per turn unless you genuinely need more than one. If no tool is needed (e.g. a greeting), respond without calling any tool.

Classified intent: ${state.intent || 'unknown'}
Extracted entities: ${JSON.stringify(state.entities || {})}
Customer language: ${state.languageDetected || 'unknown'}

Recent conversation:
${historyTail || 'No previous messages.'}

Current customer message: "${state.messageText}"`;
}

export async function decideAndRetrieveNode(state: AgentState): Promise<AgentStateUpdate> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildDecisionPrompt(state) },
  ];

  let toolCallLog: ToolCallLogEntry[] = [...state.toolCallLog];
  let toolCallCount = state.toolCallCount;
  let retrievedContext: AgentState['retrievedContext'] = state.retrievedContext;
  let escalated = false;
  let escalationReasonFinal: string | undefined;

  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
    const response = await agentOpenai.chat.completions.create({
      model: AGENT_MODEL,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.2,
    });

    const choice = response.choices[0]?.message;
    if (!choice) break;

    const toolCalls = choice.tool_calls || [];
    if (toolCalls.length === 0) {
      // Model decided no tool call is needed for this turn — done.
      break;
    }

    messages.push(choice);

    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const start = Date.now();
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }

      const result = await executeTool(call.function.name, args, state);
      const latencyMs = Date.now() - start;

      toolCallLog = [
        ...toolCallLog,
        {
          tool: call.function.name,
          input: args,
          output: result.envelope,
          ok: result.envelope.ok,
          latencyMs,
          timestamp: new Date().toISOString(),
        },
      ];
      toolCallCount += 1;

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.envelope),
      });

      if (result.retrievedContext) {
        retrievedContext = result.retrievedContext;
      }
      if (result.escalated) {
        escalated = true;
        escalationReasonFinal = result.escalationReason;
      }
    }

    if (escalated) break; // stop the loop immediately — route straight to persist
  }

  const update: AgentStateUpdate = {
    toolCallLog,
    toolCallCount,
    retrievedContext: retrievedContext ?? { source: 'none', items: [] },
    escalated,
  };

  if (escalated) {
    update.escalationReasonFinal = escalationReasonFinal;
    // Fixed handoff copy — mirrors pipeline-service.ts's existing deterministic
    // handoff message (GENAI_POC_PRD.md §5.2: "reusing the existing
    // deterministic handoff copy already in pipeline-service.ts").
    update.replyDraft = state.languageDetected?.startsWith('hi')
      ? 'Ji, main samajh sakta hoon. Main aapko hamare senior team member se connect karwa deta hoon jo aapki better help kar sakenge.'
      : 'I understand your concern. Let me connect you with a senior team member who can help you better.';
  }

  return update;
}
