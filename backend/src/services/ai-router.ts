import OpenAI from 'openai';
import { config } from '../config/environment.js';

const openai = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: config.GITHUB_PAT,
});

const MODEL = 'gpt-4o';

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
  // NEW: Entity extraction for inventory queries
  entities: {
    product_name: string | null;
    category: string | null;
    brand: string | null;
    price_min: number | null;
    price_max: number | null;
    attributes: Record<string, string>;
  } | null;
  query_type: 'structured' | 'semantic' | 'general';
}

/** Analyze a customer message — extract intent, lead score, tasks, entities */
export async function analyzeMessage(
  customerMessage: string,
  conversationHistory: string[],
  businessProfile: { business_name: string; industry: string; services: string[] }
): Promise<AnalysisResult> {
  // Provide current date/time so AI can resolve "kal", "tomorrow", "next week", etc.
  const now = new Date();
  const currentDate = now.toISOString().split('T')[0]; // 2026-04-01
  const currentTime = now.toTimeString().split(' ')[0].slice(0, 5); // 14:30
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const tomorrowDate = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  const prompt = `You are an AI sales assistant analyzing a customer message for a business.

CURRENT DATE & TIME:
- Today: ${currentDate} (${dayOfWeek})
- Current time: ${currentTime}
- Tomorrow: ${tomorrowDate}
Use these to resolve relative dates like "kal" (tomorrow), "next Monday", "aaj" (today), "parso" (day after tomorrow).

BUSINESS PROFILE:
- Name: ${businessProfile.business_name || 'My Business'}
- Industry: ${businessProfile.industry || 'General Services'}
- Services: ${businessProfile.services?.join(', ') || 'Various services'}

CONVERSATION HISTORY (recent messages — read ALL of these to understand context):
${conversationHistory.length > 0 ? conversationHistory.slice(-20).join('\n') : 'No previous messages.'}

IMPORTANT: The customer may be referring to something discussed earlier. Check the full history before deciding intent.

NEW CUSTOMER MESSAGE:
"${customerMessage}"

Analyze this message and return ONLY valid JSON:
{
  "intent": "<one of: greeting, pricing_inquiry, service_inquiry, meeting_request, portfolio_request, complaint, general_question, ready_to_buy, inventory_inquiry, inventory_browse, inventory_compare, price_negotiation, location_inquiry>",
  "lead_score": "<one of: high, medium, low>",
  "confidence": <float 0-1>,
  "tasks": [{"description": "<task>", "priority": "<urgent|high|medium|low>", "due_date": null}],
  "appointment": {"service": "<string or null>", "proposed_time_iso": "<ISO string or null>"},
  "should_auto_reply": <true or false>,
  "escalation_reason": "<null or reason>",
  "language_detected": "<ISO code like en, hi, mr, es>",
  "summary_update": "<one line summary>",
  "entities": {
    "product_name": "<specific product/model name if mentioned, else null>",
    "category": "<product category if mentioned (sedan, SUV, hatchback, cake, haircut, etc.), else null>",
    "brand": "<brand name if mentioned, else null>",
    "price_min": <minimum price if mentioned, as number, else null>,
    "price_max": <maximum price if mentioned, as number, else null>,
    "attributes": {<key-value pairs for any specific attributes mentioned, e.g. "color": "white", "fuel_type": "diesel", "year": "2022">}
  },
  "query_type": "<structured if customer asks about specific product/filters, semantic if vague/subjective query, general if not product-related>"
}

INTENT RULES:
- "inventory_inquiry" = asking about a specific product ("Do you have Honda City?", "Is the red one available?")
- "inventory_browse" = browsing with filters ("Show me cars under 10 lakhs", "What SUVs do you have?")
- "inventory_compare" = comparing products ("Which is better, Creta or Seltos?")
- "price_negotiation" = haggling/bargaining ("Can you give discount?", "Last price?") — ESCALATE to human
- "pricing_inquiry" = asking price of a known item without negotiating
- "greeting" = simple hello/hi
- "location_inquiry" = asking about business location, address, directions, Google Maps ("kahan hai?", "address?", "location bhejo")
- "complaint" = always escalate

ENTITY EXTRACTION RULES:
- Extract product names, brands, categories, colors, and any attributes mentioned
- Convert price mentions to numbers: "8 lakh" = 800000, "under 10L" = price_max: 1000000, "5-8 lakh range" = price_min: 500000, price_max: 800000
- For Indian prices: 1 lakh = 100000, 1 crore = 10000000
- If customer says "white automatic diesel SUV under 12 lakhs", extract ALL of those as entities
- Set entities to null if the message is not product-related (greetings, complaints, general questions)

SCORING RULES:
- "ready_to_buy", "pricing_inquiry", "inventory_inquiry" with specific product = HIGH
- "service_inquiry", "meeting_request", "inventory_browse" = MEDIUM
- "greeting", "general_question" = LOW
- "complaint" or "price_negotiation" = escalate, do NOT auto-reply

APPOINTMENT EXTRACTION RULES (CRITICAL):
- When customer says "kal 2 pm", "tomorrow 3 baje", "aaj 5 pm", "next Monday 10am" → ALWAYS resolve to a full ISO 8601 datetime
- Use CURRENT DATE (${currentDate}) and TOMORROW (${tomorrowDate}) provided above to compute exact dates
- "kal" / "tomorrow" = ${tomorrowDate}
- "aaj" / "today" = ${currentDate}
- "parso" / "day after tomorrow" = use date arithmetic from today
- "2 baje" / "2 pm" = 14:00, "3 baje" = 15:00 (Indian convention: "baje" = o'clock)
- For "kal 2 pm": proposed_time_iso = "${tomorrowDate}T14:00:00"
- For "test drive book kardo", "appointment schedule karo", "visit fix karo" → intent = "meeting_request"
- If customer says to CANCEL and rebook ("kal 2 ki cancel karke 3 pm baje ki appointment kardijiye") → use the NEW time, not the old
- ALWAYS set "appointment.service" to the relevant service (e.g., "Test Drive", "Visit", "Consultation")
- If time is mentioned but date is not clear, default to tomorrow

AUTO-REPLY RULES:
- Set true for: greeting, general_question, pricing_inquiry, service_inquiry, inventory_inquiry, inventory_browse, location_inquiry, meeting_request
- Set false for: complaint, price_negotiation, or if human explicitly demanded

Return ONLY the JSON object.`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: prompt }],
      response_format: { type: 'json_object' },
    });

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
      should_auto_reply: false,
      escalation_reason: 'AI analysis failed — needs human review',
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
  conversationMemory?: string
): Promise<string> {

  // Build inventory context string if we have product data
  let inventoryInfo = '';
  if (inventoryContext) {
    const { items, soldItems, alternatives } = inventoryContext;

    if (items && items.length > 0) {
      inventoryInfo += '\nAVAILABLE PRODUCTS FROM INVENTORY (REAL DATA — use this!):\n';
      items.forEach((item, i) => {
        const price = item.price ? (item.price >= 100000 ? `${(item.price / 100000).toFixed(1)}L` : `${item.price}`) : 'Price on request';
        const attrs = item.attributes
          ? Object.entries(item.attributes)
              .filter(([k, v]) => {
                if (v === null || v === undefined) return false;
                if (typeof v === 'string' && /^https?:\/\//i.test(v)) return false;
                if (/(image|img|photo|pic)/i.test(k)) return false;
                return true;
              })
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : '';
        inventoryInfo += `${i + 1}. ${item.item_name}${item.category ? ` (${item.category})` : ''} — ₹${price}, ${item.quantity} in stock${attrs ? `, ${attrs}` : ''}\n`;
      });
    }

    if (soldItems && soldItems.length > 0) {
      inventoryInfo += '\nSOLD OUT / UNAVAILABLE:\n';
      soldItems.forEach((item) => {
        inventoryInfo += `- ${item.item_name} — SOLD OUT\n`;
      });
    }

    if (alternatives && alternatives.length > 0) {
      inventoryInfo += '\nSIMILAR ALTERNATIVES AVAILABLE:\n';
      alternatives.forEach((item, i) => {
        const price = item.price ? (item.price >= 100000 ? `${(item.price / 100000).toFixed(1)}L` : `${item.price}`) : 'Price on request';
        inventoryInfo += `${i + 1}. ${item.item_name} — ₹${price}, ${item.quantity} in stock\n`;
      });
    }
  }

  const prompt = `You are a real salesperson at "${businessProfile.business_name || 'our business'}" texting a customer on WhatsApp. You are NOT a bot. You are a human employee who knows the inventory well.

BUSINESS: ${businessProfile.industry || 'Services'} | Offers: ${businessProfile.services?.join(', ') || 'Various'}

${conversationMemory ? '--- CONVERSATION MEMORY (what has already been discussed) ---\n' + conversationMemory + '\n--- END MEMORY ---\n' : ''}
${inventoryInfo}
${knowledgeContext.length > 0 ? 'KNOWLEDGE BASE:\n' + knowledgeContext.join('\n---\n') : ''}

YOUR PERSONALITY:
- You're a friendly, knowledgeable salesperson who genuinely wants to help
- You remember EVERYTHING the customer said earlier in this conversation
- You text like a real person — short messages, casual, natural
- You're enthusiastic about good deals but never pushy

ABSOLUTE RULES:
1. NEVER say "I'm an AI", "As an AI", "I'd be happy to assist", "How can I help you today"
2. NEVER re-ask something the customer already answered (check the conversation memory above!)
3. NEVER use bullet points, numbered lists, or markdown formatting
4. NEVER include image URLs in your text
5. NEVER sign off with "Best regards", "Thanks", or business name
6. Keep to 1-3 SHORT sentences. Max 2 lines. This is WhatsApp, not email.
7. Reply in ${language === 'en' ? 'English' : `the customer's language (${language})`}. If Hinglish, reply in Hinglish.
8. Use prices like "5.5 lakh" not "550000" or "5,50,000"
9. ONLY mention products listed in AVAILABLE PRODUCTS above. Never invent products.
10. If you don't have info, say "let me check with the team" — never guess.

ANTI-REPETITION:
- Read the CONVERSATION MEMORY section carefully before replying
- If customer already told you their budget → don't ask again, reference it
- If customer already said which car → don't ask "which car?", just answer about that car
- If AI already asked a question → don't ask the same question again
- If customer asked something you already answered → give new info or move the conversation forward
- PROGRESS the conversation — don't loop in circles

APPOINTMENT AWARENESS (CRITICAL — read this!):
- Check APPOINTMENT STATUS in the conversation memory above
- If an appointment is marked "PAST (already happened)" → do NOT say "before your appointment" or "see you then" — it already happened!
- If appointment already happened → ask "How was your visit?" or "Did you like the car?" — move forward
- If appointment is TODAY → say "See you today!" or "Looking forward to your visit today"
- If appointment is UPCOMING (future) → only then say "See you on [date]" or offer help before the visit
- If customer reschedules → acknowledge the change, confirm new time, don't reference old time

CONVERSATION FLOW:
- First message → warm greeting, brief intro
- Product inquiry → 1-2 key facts, ask if they want details
- After details shared → suggest next step (visit, test drive, booking)
- After booking confirmed → ask "Anything else?" and move on naturally
- After appointment happened → ask about their experience, don't re-offer the same thing
- Customer goes quiet → casual check-in, leave door open
- ALWAYS progress the conversation forward — NEVER loop back to things already done
- MATCH their energy and language style exactly`;

  // Build message array for GPT — send MORE history for better context
  const historicalMessages = conversationHistory.slice(0, -1);
  const mappedMessages: any[] = [{ role: 'system', content: prompt }];

  // Send last 20 messages (was 10) for better conversation memory
  historicalMessages.slice(-20).forEach((msgString) => {
    if (msgString.startsWith('ai: ')) {
      mappedMessages.push({ role: 'assistant', content: msgString.replace('ai: ', '') });
    } else {
      mappedMessages.push({ role: 'user', content: msgString.replace(/^.*?: /, '') });
    }
  });

  mappedMessages.push({ role: 'user', content: customerMessage });

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: mappedMessages as any,
    });
    return response.choices[0].message.content || 'Thank you for your message. We will get back to you shortly.';
  } catch (err: any) {
    console.error('❌ AI reply generation failed:', err.message);
    return 'Thank you for your message. We will get back to you shortly.';
  }
}

/** Generate a conversation summary */
export async function generateSummary(messages: string[]): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'system',
        content: `Summarize this business conversation in 1-2 sentences. Focus on: what the customer wants, key decisions, pending actions.\n\nMessages:\n${messages.join('\n')}\n\nSummary:`,
      }],
    });
    return response.choices[0].message.content || 'Conversation in progress.';
  } catch {
    return 'Conversation in progress.';
  }
}

/** Generate a follow-up message for an inactive lead */
export async function generateFollowUp(
  customerName: string,
  stage: string,
  conversationHistory: string[],
  businessProfile: { business_name: string; industry: string; services: string[] }
): Promise<string> {
  const prompt = `You are a friendly salesperson texting a customer on WhatsApp for "${businessProfile.business_name || 'our business'}".
Your goal is to re-engage a customer named ${customerName} who has gone silent in the "${stage}" stage.

BUSINESS INFO:
- Industry: ${businessProfile.industry || 'Services'}
- Services: ${businessProfile.services?.join(', ') || 'Various'}

RECENT CONVERSATION:
${conversationHistory.length > 0 ? conversationHistory.slice(-5).join('\n') : 'No previous messages.'}

INSTRUCTIONS:
1. Write a highly personalized, friendly follow-up message (1-2 sentences max).
2. Reference what you were last talking about.
3. End with a soft, low-pressure question.
4. DO NOT use markdown. Keep it human-like texting style.
5. DO NOT sound robotic or like a bot.
6. Use natural expressions, keep it casual.`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: prompt }],
    });
    return response.choices[0].message.content || `Hi ${customerName}, just checking in on our previous conversation. Let me know if you still need any help!`;
  } catch (err: any) {
    console.error('❌ AI follow-up generation failed:', err.message);
    return `Hi ${customerName}, just checking in on our previous conversation. Let me know if you still need any help!`;
  }
}
