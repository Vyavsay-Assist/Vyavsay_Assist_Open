import { analyzeMessage } from '../../services/ai-router.js';
import type { AgentState, AgentStateUpdate } from '../state.js';

/**
 * classify — calls the LLM (reuses ai-router.ts's analyzeMessage prompt
 * construction) to produce intent/entities/confidence. This is the existing
 * "AI CALL 1" ported into a graph node. Phase 1: still goes through
 * analyzeMessage()'s internal withTimeout()/Promise.race — AbortController
 * migration is Phase 3 scope (GENAI_POC_PRD.md §6).
 */
export async function classifyNode(state: AgentState): Promise<AgentStateUpdate> {
  const historyStrings = state.history.map((m) => `${m.sender}: ${m.content}`);

  const analysis = await analyzeMessage(
    state.messageText.slice(0, 1500),
    historyStrings,
    {
      business_name: state.user.business_name || '',
      industry: state.user.industry || '',
      services: state.user.services || [],
    },
    state.domain
  );

  return {
    intent: analysis.intent,
    entities: analysis.entities || {},
    confidence: analysis.confidence,
    languageDetected: analysis.language_detected,
    shouldAutoReply: analysis.should_auto_reply,
    escalationReason: analysis.escalation_reason,
    summaryUpdate: analysis.summary_update,
  };
}
