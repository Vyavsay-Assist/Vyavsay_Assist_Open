import { CatalogService } from '../../services/catalog-service.js';
import { RagService } from '../../services/rag-service.js';
import { agentSupabase } from '../supabase-client.js';
import type { AgentState, AgentStateUpdate } from '../state.js';

const rag = new RagService(agentSupabase);
const catalog = new CatalogService(agentSupabase, rag);

/**
 * decide_and_retrieve — PHASE 1 SKELETON ONLY.
 *
 * GENAI_POC_PRD.md §6 Phase 1 explicitly scopes this node to call
 * search_inventory unconditionally, with no real tool choice yet, to get
 * the plumbing working end-to-end first. Real tool-calling (the LLM
 * choosing between search_inventory / lookup_knowledge_base /
 * check_appointment_availability / book_appointment / escalate_to_human
 * via the OpenAI tools API) is Phase 2 scope — do not build it here.
 */
export async function decideAndRetrieveNode(state: AgentState): Promise<AgentStateUpdate> {
  const start = Date.now();
  const items = await catalog.hybridSearch(state.userId, state.messageText, {
    product_name: state.entities?.product_name ?? undefined,
    category: state.entities?.category ?? undefined,
    price_min: state.entities?.price_min ?? undefined,
    price_max: state.entities?.price_max ?? undefined,
    attributes: state.entities?.attributes,
  });

  return {
    retrievedContext: { source: 'inventory', items },
    toolCallLog: [
      ...state.toolCallLog,
      {
        tool: 'search_inventory',
        input: { queryText: state.messageText },
        output: { count: items.length },
        ok: true,
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    ],
    toolCallCount: state.toolCallCount + 1,
  };
}
