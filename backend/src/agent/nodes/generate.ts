import { generateReply } from '../../services/ai-router.js';
import type { AgentState, AgentStateUpdate } from '../state.js';

/**
 * generate — calls the LLM to draft the reply, given whatever context the
 * previous node retrieved. Reuses ai-router.ts's generateReply prompt
 * construction (same function pipeline-service.ts calls).
 */
export async function generateNode(state: AgentState): Promise<AgentStateUpdate> {
  const historyStrings = state.history.map((m) => `${m.sender}: ${m.content}`);

  // Mirrors pipeline-service.ts's historyStrings.push('System: ...') pattern
  // for steering generateReply() on appointment availability/booking outcomes
  // without changing that function's signature.
  if (state.retrievedContext?.systemNote) {
    historyStrings.push(state.retrievedContext.systemNote);
  }

  const inventoryContext = state.retrievedContext?.source === 'inventory'
    ? { items: state.retrievedContext.items as any[] }
    : null;
  const knowledgeChunks = state.retrievedContext?.source === 'knowledge'
    ? (state.retrievedContext.items as string[])
    : [];

  const replyDraft = await generateReply(
    state.messageText.slice(0, 1500),
    historyStrings,
    knowledgeChunks,
    {
      business_name: state.user.business_name || '',
      industry: state.user.industry || '',
      services: state.user.services || [],
    },
    state.languageDetected || 'en',
    inventoryContext,
    undefined, // conversation memory — Phase 1 skeleton does not port buildConversationMemory()
    state.domain
  );

  return { replyDraft };
}
