import { SupabaseClient } from '@supabase/supabase-js';
import { analyzeMessage, generateReply, generateSummary, AnalysisResult } from './ai-router.js';
import { RagService } from './rag-service.js';
import { CatalogService } from './catalog-service.js';
import { baileysAdapter } from './baileys-adapter.js';
import { reminderService } from './reminder-service.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/environment.js';

/** Intents that should trigger inventory search */
const INVENTORY_INTENTS = [
  'inventory_inquiry',
  'inventory_browse',
  'inventory_compare',
  'pricing_inquiry',
  'ready_to_buy',
];

const PHOTO_REQUEST_REGEX = /\b(photo|photos|pic|pics|picture|pictures|image|images)\b/i;
const NEGOTIATION_REGEX = /\b(discount|last\s*price|best\s*price|kam|sasta|nego|negotiat|final\s*price|thodi\s*kam|kam\s*ho\s*sakti|kam\s*ho\s*sakta)\b/i;
const URL_REGEX = /^https?:\/\//i;
const HINGLISH_HINT_REGEX = /\b(kya|hai|thoda|thodi|kam|hosakti|ho\s*sakta|bhejo|bhai|yaar|ji)\b/i;

/**
 * PipelineService — the AI orchestrator.
 * Flow: Store → Analyze → Route (Inventory or Knowledge) → Score Lead → Extract Tasks → Auto-Reply
 */
export class PipelineService {
  private rag: RagService;
  private catalog: CatalogService;

  constructor(private supabase: SupabaseClient) {
    this.rag = new RagService(supabase);
    this.catalog = new CatalogService(supabase, this.rag);
  }

  getRagService(): RagService {
    return this.rag;
  }

  getCatalogService(): CatalogService {
    return this.catalog;
  }

  async processIncomingMessage(
    userId: string,
    customerJid: string,
    customerName: string,
    customerPhone: string,
    messageText: string
  ): Promise<{ success: boolean; autoReplied: boolean; analysis: any }> {

    // 1. Fetch or create user
    let { data: user } = await this.supabase
      .from('wb_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) {
      const { data: newUser } = await this.supabase
        .from('wb_users')
        .insert({
          id: userId,
          email: `${userId.slice(0, 8)}@demo.com`,
          business_name: 'Demo Business',
          auto_reply_enabled: true,
        })
        .select()
        .single();
      user = newUser;
    }

    if (!user) {
      console.warn(`❌ [Pipeline] Could not find/create user ${userId.slice(0, 8)}`);
      return { success: false, autoReplied: false, analysis: null };
    }

    // 2. Find or create conversation
    let { data: conversation } = await this.supabase
      .from('wb_conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('customer_jid', customerJid)
      .single();

    if (!conversation) {
      const { data: newConvo } = await this.supabase
        .from('wb_conversations')
        .insert({
          user_id: userId,
          customer_jid: customerJid,
          customer_name: customerName,
          customer_phone: customerPhone,
          status: 'active',
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();
      conversation = newConvo;
    } else {
      await this.supabase
        .from('wb_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          customer_name: customerName,
        })
        .eq('id', conversation.id);
    }

    if (!conversation) {
      console.warn(`❌ [Pipeline] Failed to find/create conversation`);
      return { success: false, autoReplied: false, analysis: null };
    }

    // 3. Store incoming message
    await this.supabase.from('wb_messages').insert({
      conversation_id: conversation.id,
      sender: 'customer',
      content: messageText,
    });

    // 4. Get conversation history for context — load MORE messages for better memory
    const { data: history } = await this.supabase
      .from('wb_messages')
      .select('sender, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(50);

    const historyStrings = (history || []).map(
      (m: any) => `${m.sender}: ${m.content}`
    );

    // 4.5 Build conversation memory — a compressed summary of what's been discussed
    // This prevents the AI from asking repetitive questions
    const conversationMemory = await this.buildConversationMemory(conversation, historyStrings);

    // 5. Run AI analysis (now includes entity extraction + conversation memory)
    const analysis = await analyzeMessage(messageText, historyStrings, {
      business_name: user.business_name || '',
      industry: user.industry || '',
      services: user.services || [],
    });

    console.log(`\n[Pipeline] AI Analysis for "${messageText.slice(0, 50)}...":`);
    console.log(`  Intent: ${analysis.intent} | Score: ${analysis.lead_score} | QueryType: ${analysis.query_type}`);
    if (analysis.entities) {
      console.log(`  Entities:`, JSON.stringify(analysis.entities));
    }

    // 6. Update message with detected intent
    await this.supabase
      .from('wb_messages')
      .update({ intent: analysis.intent, confidence: analysis.confidence })
      .eq('conversation_id', conversation.id)
      .eq('content', messageText)
      .order('created_at', { ascending: false })
      .limit(1);

    // 7. Create or update lead
    await this.upsertLead(userId, conversation.id, customerName, analysis);

    // 8. Create extracted tasks
    for (const task of analysis.tasks) {
      await this.supabase.from('wb_tasks').insert({
        user_id: userId,
        conversation_id: conversation.id,
        title: task.description,
        due_date: task.due_date,
        is_completed: false,
      });
    }

    // 8.5. Schedule appointment reminders
    console.log(`  [Pipeline] Appointment data:`, JSON.stringify(analysis.appointment));

    if (analysis.appointment?.proposed_time_iso) {
      const serviceName = analysis.appointment.service || 'Test Drive';
      const dueDate = analysis.appointment.proposed_time_iso.split('T')[0];
      const taskTitle = `📅 Appointment: ${customerName} — ${serviceName}`;

      console.log(`  [Pipeline] ✅ Creating appointment task: "${taskTitle}" on ${dueDate}`);

      const { error: apptError } = await this.supabase.from('wb_tasks').insert({
        user_id: userId,
        conversation_id: conversation.id,
        title: taskTitle,
        due_date: dueDate,
        is_completed: false,
      });

      if (apptError) {
        console.error(`  [Pipeline] ❌ Failed to create appointment task:`, apptError);
      } else {
        console.log(`  [Pipeline] ✅ Appointment task created successfully`);
      }

      reminderService.scheduleReminders(userId, customerJid, customerName, serviceName, analysis.appointment.proposed_time_iso);

      historyStrings.push(`System: Appointment for ${analysis.appointment.proposed_time_iso} for ${serviceName} has been booked! Confirm warmly.`);
    } else if (analysis.appointment && !analysis.appointment.proposed_time_iso) {
      console.log(`  [Pipeline] ⚠️ Appointment detected but no time extracted`);
      historyStrings.push(`System: Customer wants to book but hasn't specified time. Ask for preferred date and time.`);
    } else {
      console.log(`  [Pipeline] No appointment in this message`);
    }

    // 9. Update conversation summary
    if (historyStrings.length >= 3) {
      const summary = await generateSummary(historyStrings);
      await this.supabase
        .from('wb_conversations')
        .update({ summary, language: analysis.language_detected })
        .eq('id', conversation.id);
    }

    // ──────────────────────────────────────────────
    // 10. SMART CONTEXT FETCHING
    // Route to inventory OR knowledge base based on intent
    // ──────────────────────────────────────────────

    let knowledgeChunks: string[] = [];
    let inventoryContext: { items: any[]; soldItems?: any[]; alternatives?: any[] } | null = null;
    const isPhotoRequest = PHOTO_REQUEST_REGEX.test(messageText);
    const isNegotiationRequest = NEGOTIATION_REGEX.test(messageText);

    // Infer product from context ONLY for photo requests, negotiations, and specific follow-ups
    // Do NOT infer for browse queries ("kaunsi gaadiya hai?") — that would filter to just one car
    let inferredProductName: string | undefined;
    const shouldInferProduct = isPhotoRequest || isNegotiationRequest ||
      (analysis.intent === 'inventory_inquiry' && !analysis.entities?.product_name) ||
      (analysis.intent === 'pricing_inquiry' && !analysis.entities?.product_name);

    if (shouldInferProduct) {
      inferredProductName = await this.inferProductFromRecentContext(userId, historyStrings);
      if (inferredProductName) {
        historyStrings.push(`System: Customer has already selected product: ${inferredProductName}. Do not ask which product again unless they change it.`);
        analysis.entities = {
          ...(analysis.entities || {
            product_name: null,
            category: null,
            brand: null,
            price_min: null,
            price_max: null,
            attributes: {},
          }),
          product_name: analysis.entities?.product_name || inferredProductName,
        };
      }
    }

    const isInventoryQuery =
      INVENTORY_INTENTS.includes(analysis.intent) ||
      analysis.query_type !== 'general' ||
      isPhotoRequest ||
      isNegotiationRequest ||
      Boolean(analysis.entities?.product_name);

    if (isInventoryQuery) {
      // Check if this is a general "show me everything" browse vs specific product query
      const hasSpecificFilters = analysis.entities?.product_name ||
        analysis.entities?.category || analysis.entities?.brand ||
        analysis.entities?.price_min || analysis.entities?.price_max ||
        (analysis.entities?.attributes && Object.keys(analysis.entities.attributes).length > 0);

      if (!hasSpecificFilters && analysis.intent === 'inventory_browse') {
        // GENERAL BROWSE — "kaunsi gaadiya hai?", "what do you have?" → list ALL items
        console.log(`  [Pipeline] → General browse — listing ALL available items`);

        const allItems = await this.catalog.listItems(userId, {
          status: 'available',
          limit: 20,
          sort: 'price_asc',
        });

        inventoryContext = {
          items: allItems.items,
        };
      } else if (analysis.entities) {
        // SPECIFIC SEARCH — "Honda City in white under 8 lakhs"
        console.log(`  [Pipeline] → Specific inventory search with filters`);

        const result = await this.catalog.searchWithAlternatives(userId, messageText, {
          product_name: analysis.entities.product_name || undefined,
          category: analysis.entities.category || analysis.entities.brand || undefined,
          price_min: analysis.entities.price_min || undefined,
          price_max: analysis.entities.price_max || undefined,
          attributes: analysis.entities.attributes || undefined,
        });

        const available = result.exact.filter(i => i.quantity > 0);
        const sold = result.exact.filter(i => i.quantity <= 0);

        inventoryContext = {
          items: available,
          soldItems: sold.length > 0 ? sold : undefined,
          alternatives: result.alternatives.length > 0 ? result.alternatives : undefined,
        };
      }

      const itemCount = inventoryContext?.items?.length || 0;
      console.log(`  [Pipeline] Inventory results: ${itemCount} items found`);

      // If no inventory results, also search knowledge base as fallback
      if (itemCount === 0) {
        console.log(`  [Pipeline] → No inventory match, falling back to knowledge base`);
        knowledgeChunks = await this.rag.searchKnowledge(userId, messageText);
      }
    } else {
      // KNOWLEDGE PATH — general question, search text knowledge base
      console.log(`  [Pipeline] → Routing to KNOWLEDGE BASE search`);
      knowledgeChunks = await this.rag.searchKnowledge(userId, messageText);
    }

    // ──────────────────────────────────────────────
    // 11. AUTO-REPLY DECISION
    // ──────────────────────────────────────────────

    let autoReplied = false;

    const autoReplyIntents = [
      'greeting', 'general_question', 'pricing_inquiry', 'service_inquiry',
      'inventory_inquiry', 'inventory_browse', 'meeting_request', 'location_inquiry',
    ];

    const shouldReply =
      user.auto_reply_enabled &&
      !conversation.ai_paused &&
      analysis.should_auto_reply &&
      (analysis.confidence >= (user.ai_confidence_threshold || 0.75) ||
        autoReplyIntents.includes(analysis.intent)) &&
      !analysis.escalation_reason;

    // Handle location inquiries — share address + Google Maps link
    if (analysis.intent === 'location_inquiry') {
      const address = user.business_address || '';
      const mapsLink = user.google_maps_link || '';
      const useHinglish = analysis.language_detected.startsWith('hi') || HINGLISH_HINT_REGEX.test(messageText);

      let locationReply: string;
      if (address && mapsLink) {
        locationReply = useHinglish
          ? `Ji, humara showroom yahan hai:\n${address}\n\nGoogle Maps: ${mapsLink}\n\nAap kab aana chahenge?`
          : `Our showroom is at:\n${address}\n\nGoogle Maps: ${mapsLink}\n\nWhen would you like to visit?`;
      } else if (address) {
        locationReply = useHinglish
          ? `Ji, humara address hai: ${address}\n\nAap kab aana chahenge?`
          : `We're located at: ${address}\n\nWhen would you like to visit?`;
      } else if (mapsLink) {
        locationReply = useHinglish
          ? `Ji, ye raha humara location: ${mapsLink}\n\nAap kab aa rahe hain?`
          : `Here's our location: ${mapsLink}\n\nWhen are you planning to visit?`;
      } else {
        locationReply = useHinglish
          ? 'Ji, main abhi location details check karke bhejta hoon.'
          : 'Let me get the exact location details and share with you.';
      }

      const sent = await baileysAdapter.sendMessage(userId, customerJid, locationReply);
      if (sent) {
        await this.supabase.from('wb_messages').insert({
          conversation_id: conversation.id,
          sender: 'ai',
          content: locationReply,
        });
        autoReplied = true;
      }
      return { success: true, autoReplied, analysis };
    }

    if (analysis.intent === 'price_negotiation' || isNegotiationRequest) {
      const product = analysis.entities?.product_name || inferredProductName || inventoryContext?.items?.[0]?.item_name;
      const offeredBudget = this.extractBudgetInr(messageText) || this.findLatestCustomerBudget(historyStrings);
      const referenceItem = inventoryContext?.items?.[0] || inventoryContext?.soldItems?.[0] || null;
      const negotiationReply = this.buildNegotiationReply(
        messageText,
        analysis.language_detected,
        product,
        offeredBudget,
        referenceItem
      );

      const sent = await baileysAdapter.sendMessage(userId, customerJid, negotiationReply);
      if (sent) {
        await this.supabase.from('wb_messages').insert({
          conversation_id: conversation.id,
          sender: 'ai',
          content: negotiationReply,
        });
        autoReplied = true;
      }

      return { success: true, autoReplied, analysis };
    }

    if (shouldReply) {
      let mediaSent = false;

      // Only send images for SPECIFIC product inquiries (1-2 items) and explicit photo requests
      // Do NOT send images for: browse/listing, bookings, meetings, greetings, general questions
      const isSpecificProductQuery = analysis.intent === 'inventory_inquiry' || analysis.intent === 'pricing_inquiry';
      const hasSpecificProduct = !!(analysis.entities?.product_name || inferredProductName);
      const shouldSendImages = isPhotoRequest || (isSpecificProductQuery && hasSpecificProduct && !analysis.appointment?.proposed_time_iso);

      // Never send photos for browse/listing queries ("kaunsi gaadiya hai?")
      // Browse = many items, photos would be spammy

      if (shouldSendImages && inventoryContext?.items && inventoryContext.items.length > 0) {
        const itemsForMedia = isPhotoRequest
          ? inventoryContext.items.slice(0, 1)
          : (inventoryContext.items.length <= 3 ? inventoryContext.items : []);

        for (const item of itemsForMedia) {
          const images = this.extractImageUrls(item);

          if (images.length === 0) {
            continue;
          }

          const mediaList = isPhotoRequest ? images.slice(0, 3) : images.slice(0, 1);
          for (let i = 0; i < mediaList.length; i++) {
            const imageUrl = mediaList[i];
            const price = item.price
              ? (item.price >= 100000 ? `₹${(item.price / 100000).toFixed(1)}L` : `₹${item.price}`)
              : '';
            const caption = i === 0
              ? `${item.item_name}${price ? ` — ${price}` : ''}`
              : `${item.item_name} — photo ${i + 1}`;
            const sentImage = await baileysAdapter.sendImage(userId, customerJid, imageUrl, caption);
            mediaSent = mediaSent || sentImage;
          }
        }
      }

      let replyText = '';

      // Deterministic photo acknowledgement avoids repetitive LLM asks like "which car?"
      if (isPhotoRequest) {
        const selectedProduct = analysis.entities?.product_name || inferredProductName || inventoryContext?.items?.[0]?.item_name;
        replyText = this.buildPhotoReply(analysis.language_detected, selectedProduct, mediaSent);
      } else {
        // Generate reply with inventory, knowledge, AND conversation memory
        replyText = await generateReply(
          messageText,
          historyStrings,
          knowledgeChunks,
          {
            business_name: user.business_name || '',
            industry: user.industry || '',
            services: user.services || [],
          },
          analysis.language_detected,
          inventoryContext,
          conversationMemory
        );
      }

      const finalReplyText = mediaSent ? this.stripUrls(replyText) : replyText;

      // Send text reply
      const sent = await baileysAdapter.sendMessage(userId, customerJid, finalReplyText);
      if (sent) {
        await this.supabase.from('wb_messages').insert({
          conversation_id: conversation.id,
          sender: 'ai',
          content: finalReplyText,
        });
        autoReplied = true;
      }
    } else if (user.auto_reply_enabled && !analysis.escalation_reason) {
      // Fallback acknowledgement
      const fallback = "Thanks for reaching out! I've noted your message and someone from our team will get back to you shortly.";
      const sent = await baileysAdapter.sendMessage(userId, customerJid, fallback);
      if (sent) {
        await this.supabase.from('wb_messages').insert({
          conversation_id: conversation.id,
          sender: 'ai',
          content: fallback,
        });
        autoReplied = true;
      }
    }

    return { success: true, autoReplied, analysis };
  }

  /** Upsert lead — create new or upgrade score if higher */
  private async upsertLead(
    userId: string,
    conversationId: string,
    customerName: string,
    analysis: AnalysisResult
  ): Promise<void> {
    const { data: existingLead } = await this.supabase
      .from('wb_leads')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();

    if (existingLead) {
      const scorePriority: Record<string, number> = { high: 3, medium: 2, low: 1 };
      if ((scorePriority[analysis.lead_score] || 0) > (scorePriority[existingLead.score] || 0)) {
        await this.supabase
          .from('wb_leads')
          .update({
            score: analysis.lead_score,
            intent: analysis.intent,
            summary: analysis.summary_update,
            customer_name: customerName,
          })
          .eq('id', existingLead.id);
      }
    } else {
      await this.supabase.from('wb_leads').insert({
        user_id: userId,
        conversation_id: conversationId,
        customer_name: customerName,
        score: analysis.lead_score,
        stage: 'new',
        intent: analysis.intent,
        summary: analysis.summary_update,
      });
    }
  }

  /**
   * Build a compressed conversation memory from the full chat history.
   * This gives the AI a "summary of what happened so far" so it doesn't repeat questions
   * or forget what the customer already told us.
   */
  private async buildConversationMemory(conversation: any, historyStrings: string[]): Promise<string> {
    const parts: string[] = [];
    const now = new Date();

    // 1. Existing conversation summary
    if (conversation.summary) {
      parts.push(`CONVERSATION SUMMARY: ${conversation.summary}`);
    }

    // 2. Fetch appointment status for this conversation
    const { data: tasks } = await this.supabase
      .from('wb_tasks')
      .select('title, due_date, is_completed')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (tasks && tasks.length > 0) {
      const appointmentStatus: string[] = [];
      for (const task of tasks) {
        if (!task.due_date) continue;
        const dueDate = new Date(task.due_date);
        const isPast = dueDate < now;
        const isToday = dueDate.toDateString() === now.toDateString();

        if (task.is_completed) {
          appointmentStatus.push(`COMPLETED: "${task.title}" on ${task.due_date}`);
        } else if (isPast) {
          appointmentStatus.push(`PAST (already happened): "${task.title}" was on ${task.due_date} — DO NOT offer help "before the appointment", it's already done`);
        } else if (isToday) {
          appointmentStatus.push(`TODAY: "${task.title}" is scheduled for today ${task.due_date}`);
        } else {
          appointmentStatus.push(`UPCOMING: "${task.title}" on ${task.due_date}`);
        }
      }
      if (appointmentStatus.length > 0) {
        parts.push(`APPOINTMENT STATUS:\n${appointmentStatus.join('\n')}`);
      }
    }

    // 3. Extract key facts from conversation history
    const customerMessages = historyStrings
      .filter(h => h.startsWith('customer:'))
      .map(h => h.replace('customer: ', ''));

    const aiMessages = historyStrings
      .filter(h => h.startsWith('ai:'))
      .map(h => h.replace('ai: ', ''));

    // Track what customer has already told us
    const customerFacts: string[] = [];
    for (const msg of customerMessages) {
      const lower = msg.toLowerCase();
      if (/my name is|i am|main .+ hoon/i.test(msg)) customerFacts.push(`Customer introduced themselves: "${msg}"`);
      if (/(\d+)\s*(lakh|lac|l|k)\b/i.test(msg) || /budget/i.test(msg)) customerFacts.push(`Customer mentioned budget: "${msg}"`);
      if (/interested|pasand|like|want|chahiye|dekhna/i.test(lower)) customerFacts.push(`Customer expressed interest: "${msg}"`);
      if (/location|address|kahan|where|visit/i.test(lower)) customerFacts.push(`Location was already shared`);
      if (/emi|loan|finance|installment/i.test(lower)) customerFacts.push(`Customer asked about financing/EMI`);
      if (/test.drive|appointment|book|visit|schedule/i.test(lower)) customerFacts.push(`Customer discussed booking: "${msg}"`);
      if (/photo|pic|image|dekh/i.test(lower)) customerFacts.push(`Photos were already shared`);
    }

    // Track what AI has already done (not just asked)
    const aiActions: string[] = [];
    for (const msg of aiMessages.slice(-8)) {
      if (/location|address|maps/i.test(msg)) aiActions.push(`AI already shared: location/address`);
      if (/photo|pic|image/i.test(msg)) aiActions.push(`AI already shared: product photos`);
      if (/schedule|book|confirm|appointment/i.test(msg)) aiActions.push(`AI already confirmed: appointment/booking`);
      if (/\?/.test(msg)) aiActions.push(`AI asked: "${msg.slice(0, 60)}..."`);
    }

    if (customerFacts.length > 0) {
      parts.push(`WHAT CUSTOMER ALREADY TOLD US (don't re-ask):\n${[...new Set(customerFacts)].slice(-8).join('\n')}`);
    }

    if (aiActions.length > 0) {
      parts.push(`WHAT AI ALREADY DID (don't repeat):\n${[...new Set(aiActions)].slice(-6).join('\n')}`);
    }

    parts.push(`CURRENT TIME: ${now.toISOString()}`);
    parts.push(`MESSAGES SO FAR: ${historyStrings.length}`);

    return parts.join('\n\n');
  }

  /** Infer last discussed product from recent customer/AI messages in the same conversation. */
  private async inferProductFromRecentContext(userId: string, historyStrings: string[]): Promise<string | undefined> {
    const { data: items } = await this.supabase
      .from('wb_catalog_items')
      .select('item_name')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(200);

    if (!items || items.length === 0) return undefined;

    const haystack = historyStrings.slice(-12).reverse().join('\n').toLowerCase();
    const names = items
      .map((i: any) => (i.item_name || '').toString().trim())
      .filter((n: string) => n.length > 0)
      .sort((a: string, b: string) => b.length - a.length);

    for (const name of names) {
      if (haystack.includes(name.toLowerCase())) {
        return name;
      }
    }

    // Fuzzy fallback: match significant tokens like "swift", "thar", "city"
    const ranked = names
      .map((name: string) => {
        const tokens = name
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t: string) => t.length >= 4 && !['model', 'edition'].includes(t));
        const tokenHits = tokens.filter((t: string) => haystack.includes(t)).length;
        return { name, tokenHits, tokenCount: tokens.length };
      })
      .filter((x: { tokenHits: number }) => x.tokenHits > 0)
      .sort((a: { tokenHits: number; tokenCount: number }, b: { tokenHits: number; tokenCount: number }) => {
        if (b.tokenHits !== a.tokenHits) return b.tokenHits - a.tokenHits;
        return b.tokenCount - a.tokenCount;
      });

    if (ranked.length > 0) {
      return ranked[0].name;
    }

    return undefined;
  }

  /** Collect image URLs from both canonical images[] and attribute columns (e.g., image_url_1). */
  private extractImageUrls(item: any): string[] {
    const urls: string[] = [];

    const imageList = Array.isArray(item?.images) ? item.images : [];
    const canonicalUrls = imageList
      .filter((img: any) => typeof img?.url === 'string' && URL_REGEX.test(img.url))
      .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      .map((img: any) => img.url);

    urls.push(...canonicalUrls);

    const attrs = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value !== 'string') continue;
      if (!URL_REGEX.test(value)) continue;
      if (!/(image|img|photo|pic)/i.test(key)) continue;
      urls.push(value);
    }

    return Array.from(new Set(urls));
  }

  /** Remove URLs from text when media has already been sent as attachments. */
  private stripUrls(text: string): string {
    const withoutUrls = text
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return withoutUrls || 'Photos sent. Agar aur close-up chahiye ho to bataiye ji.';
  }

  /** Build negotiation response using known budget + known model to avoid repeating same question. */
  private buildNegotiationReply(
    messageText: string,
    language: string,
    product?: string,
    offeredBudget?: number,
    referenceItem?: any
  ): string {
    const useHinglish = language.startsWith('hi') || HINGLISH_HINT_REGEX.test(messageText);
    const listedPrice = typeof referenceItem?.price === 'number' ? referenceItem.price : undefined;
    const cfg = this.getNegotiationConfig(referenceItem);

    const budgetText = offeredBudget ? this.formatInrCompact(offeredBudget) : '';
    const priceText = listedPrice ? this.formatInrCompact(listedPrice) : '';
    const floorText = cfg.floorPrice ? this.formatInrCompact(cfg.floorPrice) : '';

    if (useHinglish) {
      if (!product) {
        return offeredBudget
          ? `Ji, budget ${budgetText} note kar liya hai. Aap kaunsa model finalize karna chahenge?`
          : 'Ji bilkul, main best deal nikalwa deta hoon. Aapka target budget kitna rahega?';
      }

      if (!offeredBudget) {
        return `Ji, ${product} ke liye best possible deal nikalwa deta hoon. Aapka target budget kitna rahega?`;
      }

      if (!listedPrice) {
        return `Ji, ${product} ke liye ${budgetText} budget note kar liya. Main owner se check karke aapko best final bata deta hoon.`;
      }

      const gap = listedPrice - offeredBudget;
      if (gap <= 0) {
        return `Ji, ${budgetText} workable lag raha hai for ${product}. Main turant final approval leke aapko confirm karta hoon.`;
      }

      if (cfg.floorPrice && offeredBudget >= cfg.floorPrice) {
        return `Ji, ${product} ke liye ${budgetText} workable hai. Main is price pe approval process karke aapko final confirm karta hoon.`;
      }

      if (cfg.floorPrice && offeredBudget < cfg.floorPrice) {
        return `Ji, ${product} ka listed ${priceText} hai. Main best koshish ke baad minimum ${floorText} tak laa sakta hoon. Agar aapko theek lage to isi pe close kar dete hain?`;
      }

      const tentative = Math.max(offeredBudget, Math.round((listedPrice * 0.96) / 10000) * 10000);
      const tentativeText = this.formatInrCompact(tentative);
      return `Ji, ${product} ka listed ${priceText} hai, aur aapka ${budgetText} close hai. Main around ${tentativeText} tak laane ki try karta hoon. Agar theek lage to aage badhayein?`;
    }

    if (!product) {
      return offeredBudget
        ? `Noted your budget at ${budgetText}. Which model would you like me to check this for?`
        : 'Sure, I can work out the best possible deal. What budget are you targeting?';
    }

    if (!offeredBudget) {
      return `Sure, I can check the best possible deal for ${product}. What budget are you targeting?`;
    }

    if (!listedPrice) {
      return `Noted ${budgetText} for ${product}. I will check internally and share the best final price with you.`;
    }

    const gap = listedPrice - offeredBudget;
    if (gap <= 0) {
      return `${budgetText} looks workable for ${product}. I will get a quick internal approval and confirm right away.`;
    }

    if (cfg.floorPrice && offeredBudget >= cfg.floorPrice) {
      return `${budgetText} works for ${product}. I can proceed at this figure and get a quick final confirmation for you.`;
    }

    if (cfg.floorPrice && offeredBudget < cfg.floorPrice) {
      return `${product} is listed at ${priceText}. The best I can do is ${floorText}. If that works, I can close this for you right now.`;
    }

    const tentative = Math.max(offeredBudget, Math.round((listedPrice * 0.96) / 10000) * 10000);
    const tentativeText = this.formatInrCompact(tentative);
    return `${product} is listed at ${priceText}, and your ${budgetText} is close. I can try to bring it near ${tentativeText}. Should I proceed to confirm this for you?`;
  }

  /** Derive per-product negotiation constraints from attributes. */
  private getNegotiationConfig(item?: any): { maxDiscountPercent: number; floorPrice?: number } {
    const listedPrice = typeof item?.price === 'number' ? item.price : undefined;
    const attrs = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};

    const percent = this.pickNumber(attrs, [
      'max_discount_percent',
      'negotiation_percent',
      'discount_percent',
      'max_discount',
    ]);

    const maxDiscountPercent = Math.min(30, Math.max(0, percent ?? 4));

    const minPriceAttr = this.pickNumber(attrs, [
      'min_price',
      'minimum_price',
      'floor_price',
      'lowest_price',
      'min_sell_price',
    ]);

    const floorByPercent = listedPrice ? Math.round(listedPrice * (1 - maxDiscountPercent / 100)) : undefined;
    const floorPrice =
      minPriceAttr !== undefined && floorByPercent !== undefined
        ? Math.max(minPriceAttr, floorByPercent)
        : (minPriceAttr ?? floorByPercent);

    return { maxDiscountPercent, floorPrice };
  }

  private pickNumber(source: Record<string, any>, keys: string[]): number | undefined {
    for (const key of keys) {
      if (!(key in source)) continue;
      const raw = source[key];
      const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  }

  /** Build short respectful photo-reply that avoids re-asking selected car. */
  private buildPhotoReply(language: string, product?: string, mediaSent = false): string {
    const useHinglish = language.startsWith('hi');
    if (useHinglish) {
      if (mediaSent && product) return `Ji, ${product} ki photos bhej di hain. Agar close-up ya interior ki aur photos chahiye ho to bata dijiye.`;
      if (mediaSent) return 'Ji, photos bhej di hain. Agar aur specific angle chahiye ho to bata dijiye.';
      if (product) return `Ji, ${product} ke photos arrange karke turant bhejta hoon.`;
      return 'Ji bilkul, photos bhej deta hoon. Aap kaunsi car dekh rahe the?';
    }

    if (mediaSent && product) return `Shared the photos for ${product}. If you want close-up shots or interior photos, I can send those too.`;
    if (mediaSent) return 'Shared the photos. If you need a specific angle, I can send more.';
    if (product) return `Sure, I will share photos for ${product} right away.`;
    return 'Sure, I can share photos. Which car would you like to see?';
  }

  /** Extract INR budget from free text (supports lakh/crore and plain numbers). */
  private extractBudgetInr(text: string): number | undefined {
    const normalized = text.toLowerCase().replace(/,/g, '').trim();

    const lakhMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|l)/i);
    if (lakhMatch) {
      return Math.round(parseFloat(lakhMatch[1]) * 100000);
    }

    const croreMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(crore|cr)/i);
    if (croreMatch) {
      return Math.round(parseFloat(croreMatch[1]) * 10000000);
    }

    const plain = normalized.match(/\b(\d{5,8})\b/);
    if (plain) {
      return parseInt(plain[1], 10);
    }

    return undefined;
  }

  /** Find latest customer-provided budget in recent chat history. */
  private findLatestCustomerBudget(historyStrings: string[]): number | undefined {
    for (const line of [...historyStrings].reverse()) {
      if (!line.toLowerCase().startsWith('customer:')) continue;
      const budget = this.extractBudgetInr(line.replace(/^customer:\s*/i, ''));
      if (budget) return budget;
    }
    return undefined;
  }

  private formatInrCompact(value: number): string {
    if (value >= 10000000) {
      return `₹${(value / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
    }
    if (value >= 100000) {
      return `₹${(value / 100000).toFixed(1).replace(/\.0$/, '')} lakh`;
    }
    return `₹${value}`;
  }
}

// Singleton with service role client
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
export const pipelineService = new PipelineService(supabase);
