import OpenAI from 'openai';
import { config } from '../config/environment.js';
import type { BaseDomain } from '../domains/types.js';
import { getDomain } from '../domains/domain-router.js';

const openai = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: config.GITHUB_PAT,
});

const MODEL = 'gpt-4o';
const ANALYSIS_TIMEOUT_MS = 20000;
const REPLY_TIMEOUT_MS = 25000;
const SUMMARY_TIMEOUT_MS = 12000;
const FOLLOW_UP_TIMEOUT_MS = 12000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/** Structured analysis result from AI */
export interface AnalysisResult {
  intent: string;
  lead_score: string;
  confidence: number;
  tasks: { description: string; priority: string; due_date: string | null }[];
  appointment: { service: string | null; proposed_time_iso: string | null } | null;
  should_auto_reply: boolean;
  escalation_reason: string | null;
  language_detected: string;
  summary_update: string;
  entities: {
    product_name: string | null;
    category: string | null;
    brand: string | null;
    price_min: number | null;
    price_max: number | null;
    attributes: Record<string, string>;
  } | null;
  query_type: 'structured' | 'semantic' | 'general';
  /** Sentiment analysis — polarity (-1 to 1) and dominant emotion */
  sentiment?: {
    polarity: number;
    emotion: string;
  };
}

/** Analyze a customer message — extract intent, lead score, tasks, entities */
export async function analyzeMessage(
  customerMessage: string,
  conversationHistory: string[],
  businessProfile: { business_name: string; industry: string; services: string[] },
  domain?: BaseDomain
): Promise<AnalysisResult> {
  const d = domain || getDomain(null);

  // Provide current date/time so AI can resolve "kal", "tomorrow", "next week", etc.
  const now = new Date();
  const currentDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0].slice(0, 5);
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const tomorrowDate = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  const prompt = d.analysisPrompt.buildSystemPrompt({
    currentDate,
    currentTime,
    dayOfWeek,
    tomorrowDate,
    businessName: businessProfile.business_name || 'My Business',
    industry: businessProfile.industry || 'General Services',
    services: businessProfile.services?.join(', ') || 'Various services',
    conversationHistory: conversationHistory.length > 0
      ? conversationHistory.slice(-d.limits.historyLlmLimit).join('\n')
      : 'No previous messages.',
    customerMessage,
  });

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: prompt }],
        response_format: { type: 'json_object' },
        ...d.llmParams.analysis,
      }),
      ANALYSIS_TIMEOUT_MS,
      'AI analysis'
    );

    const text = response.choices[0].message.content || '{}';
    const result = JSON.parse(text);

    // Ensure entities structure exists
    if (!result.entities) {
      result.entities = null;
    }
    if (!result.query_type) {
      result.query_type = 'general';
    }

    return result;
  } catch (err: any) {
    console.error('❌ AI analysis failed:', err.message);
    return {
      intent: 'general_question',
      lead_score: 'low',
      confidence: 0.3,
      tasks: [],
      appointment: null,
      should_auto_reply: true,
      escalation_reason: null,
      language_detected: 'en',
      summary_update: 'Unable to analyze message',
      entities: null,
      query_type: 'general',
    };
  }
}

/** Generate an auto-reply using business context + inventory/knowledge data + conversation memory */
export async function generateReply(
  customerMessage: string,
  conversationHistory: string[],
  knowledgeContext: string[],
  businessProfile: { business_name: string; industry: string; services: string[] },
  language: string,
  inventoryContext?: { items: any[]; soldItems?: any[]; alternatives?: any[] } | null,
  conversationMemory?: string,
  domain?: BaseDomain
): Promise<string> {
  const d = domain || getDomain(null);

  // HACKATHON: Capped to 5 items + abbreviated attrs to prevent context bloat
  let inventoryInfo = '';
  if (inventoryContext) {
    const { items, soldItems, alternatives } = inventoryContext;

    if (items && items.length > 0) {
      const limitedItems = items.slice(0, 5);
      const SKIP_KEYS = /(image|img|photo|pic|url|link|description)/i;
      const CORE_KEYS = ['item_name', 'category', 'price', 'quantity'];

      inventoryInfo += '\nAVAILABLE PRODUCTS FROM INVENTORY (REAL DATA — use this!):\n';
      limitedItems.forEach((item, i) => {
        const price = item.price ? d.formatInventoryPrice(item.price) : 'Price on request';
        const attrs = item.attributes
          ? Object.entries(item.attributes)
              .filter(([k, v]) => {
                if (v === null || v === undefined) return false;
                if (SKIP_KEYS.test(k)) return false;
                if (CORE_KEYS.includes(k)) return true;
                // Only include non-core attrs if short
                const strVal = String(v);
                if (strVal.length >= 50) return false;
                if (/^https?:\/\//i.test(strVal)) return false;
                return true;
              })
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : '';
        inventoryInfo += `${i + 1}. ${item.item_name}${item.category ? ` (${item.category})` : ''} — ₹${price}, ${item.quantity} in stock${attrs ? `, ${attrs}` : ''}\n`;
      });
    }

    if (soldItems && soldItems.length > 0) {
      const limitedSold = soldItems.slice(0, 3);
      inventoryInfo += '\nSOLD OUT / UNAVAILABLE:\n';
      limitedSold.forEach((item) => {
        inventoryInfo += `- ${item.item_name} — SOLD OUT\n`;
      });
    }

    if (alternatives && alternatives.length > 0) {
      const limitedAlts = alternatives.slice(0, 3);
      inventoryInfo += '\nSIMILAR ALTERNATIVES AVAILABLE:\n';
      limitedAlts.forEach((item, i) => {
        const price = item.price ? d.formatInventoryPrice(item.price) : 'Price on request';
        inventoryInfo += `${i + 1}. ${item.item_name} — ₹${price}\n`;
      });
    }
  }

  // HACKATHON: Limit knowledge chunks to 3, each max 400 chars
  const limitedChunks = (knowledgeContext || []).slice(0, 3).map(c => c.length > 400 ? c.slice(0, 400) + '...' : c);

  const prompt = d.replyPrompt.buildSystemPrompt({
    businessName: businessProfile.business_name || 'our business',
    industry: businessProfile.industry || 'Services',
    services: businessProfile.services?.join(', ') || 'Various',
    conversationMemory: conversationMemory || '',
    inventoryInfo,
    knowledgeContext: limitedChunks.length > 0 ? 'KNOWLEDGE BASE:\n' + limitedChunks.join('\n---\n') : '',
    language,
  });

  // Build message array for GPT — send history for better context
  const historicalMessages = conversationHistory.slice(0, -1);
  const mappedMessages: any[] = [{ role: 'system', content: prompt }];

  historicalMessages.slice(-d.limits.historyLlmLimit).forEach((msgString) => {
    if (msgString.startsWith('ai: ')) {
      mappedMessages.push({ role: 'assistant', content: msgString.replace('ai: ', '') });
    } else {
      mappedMessages.push({ role: 'user', content: msgString.replace(/^.*?: /, '') });
    }
  });

  mappedMessages.push({ role: 'user', content: customerMessage });

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        messages: mappedMessages as any,
        ...d.llmParams.reply,
      }),
      REPLY_TIMEOUT_MS,
      'AI reply generation'
    );
    return response.choices[0].message.content || d.fallbacks.aiFailure;
  } catch (err: any) {
    console.error('❌ AI reply generation failed:', err.message);
    return d.fallbacks.aiFailure;
  }
}

/** Generate a conversation summary */
export async function generateSummary(messages: string[], domain?: BaseDomain): Promise<string> {
  const d = domain || getDomain(null);
  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        messages: [{
          role: 'system',
          content: `Summarize this business conversation in 1-2 sentences. Focus on: what the customer wants, key decisions, pending actions.\n\nMessages:\n${messages.join('\n')}\n\nSummary:`,
        }],
        ...d.llmParams.summary,
      }),
      SUMMARY_TIMEOUT_MS,
      'AI summary generation'
    );
    return response.choices[0].message.content || 'Conversation in progress.';
  } catch (err: any) {
    console.error('❌ AI summary generation failed:', err.message);
    return 'Conversation in progress.';
  }
}

/** Generate a follow-up message for an inactive lead */
export async function generateFollowUp(
  customerName: string,
  stage: string,
  conversationHistory: string[],
  businessProfile: { business_name: string; industry: string; services: string[] },
  domain?: BaseDomain
): Promise<string> {
  const d = domain || getDomain(null);

  const prompt = d.followUpPrompt.buildSystemPrompt({
    businessName: businessProfile.business_name || 'our business',
    industry: businessProfile.industry || 'Services',
    services: businessProfile.services?.join(', ') || 'Various',
    customerName,
    stage,
    recentHistory: conversationHistory.length > 0 ? conversationHistory.slice(-5).join('\n') : 'No previous messages.',
  });

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'system', content: prompt }],
        ...d.llmParams.followUp,
      }),
      FOLLOW_UP_TIMEOUT_MS,
      'AI follow-up generation'
    );
    return response.choices[0].message.content || d.fallbacks.followUpFallback(customerName);
  } catch (err: any) {
    console.error('❌ AI follow-up generation failed:', err.message);
    return d.fallbacks.followUpFallback(customerName);
  }
}
