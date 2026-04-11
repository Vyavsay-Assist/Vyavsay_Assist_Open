# Vyavsay Baileys - Complete Project Documentation

> **Generated**: 2026-04-11 | **Purpose**: Comprehensive understanding of the entire codebase

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [Project Structure](#3-project-structure)
4. [Backend Deep Dive](#4-backend-deep-dive)
5. [Frontend Deep Dive](#5-frontend-deep-dive)
6. [Database Schema & Models](#6-database-schema--models)
7. [WhatsApp/Baileys Integration](#7-whatsappbaileys-integration)
8. [AI & Chatbot Engine](#8-ai--chatbot-engine)
9. [Voice Calling (Vapi)](#9-voice-calling-vapi)
10. [Authentication & Security](#10-authentication--security)
11. [Deployment & DevOps](#11-deployment--devops)
12. [API Reference (39 Endpoints)](#12-api-reference-39-endpoints)
13. [Data Flow Diagrams](#13-data-flow-diagrams)
14. [Domain System](#14-domain-system)
15. [Key Files Index](#15-key-files-index)

---

## 1. Project Overview

**Vyavsay** is a **multi-tenant AI-powered WhatsApp Sales Copilot SaaS** platform. It connects to WhatsApp via the Baileys library (WhatsApp Web API), automatically analyzes customer messages using GPT-4o, scores leads, extracts tasks/appointments, generates intelligent auto-replies, and provides a full CRM dashboard.

### What It Does

- **WhatsApp Integration**: Connects business owners' WhatsApp accounts via QR code scanning using Baileys
- **AI Auto-Replies**: Analyzes incoming messages with GPT-4o, detects intent, and generates contextual replies
- **Lead Management**: Automatically scores and tracks leads through a sales funnel (Kanban board)
- **Task Extraction**: AI extracts actionable tasks and appointments from conversations
- **Inventory/Catalog**: Manages business inventory with semantic search (RAG/pgvector)
- **Voice Calling**: Vapi-powered AI voice agent for phone calls with tool-calling capabilities
- **Knowledge Base**: RAG-powered knowledge store for business FAQs and policies
- **Analytics Dashboard**: Real-time metrics on conversations, leads, AI performance
- **Multi-Domain Support**: Industry-specific AI behavior (generic business vs. used car dealerships)
- **Multi-Language**: English and Hinglish (Hindi-English mix) support

### Target Users

- Small-to-medium Indian businesses (initially focused on used car dealerships)
- Business owners who want to automate WhatsApp customer interactions

---

## 2. Architecture & Tech Stack

### High-Level Architecture

```
[Customer WhatsApp] <--Baileys--> [Backend (Fastify)] <--REST API--> [Frontend (React SPA)]
                                       |                                    |
                                  [Supabase PostgreSQL]              [Supabase Auth]
                                       |
                                  [OpenAI GPT-4o via Azure]
                                       |
                                  [Vapi Voice Agent]
```

### Tech Stack

| Layer              | Technology                                          |
|--------------------|-----------------------------------------------------|
| **Frontend**       | React 18, Vite 6, TypeScript, Tailwind CSS, Framer Motion |
| **Backend**        | Fastify 5, TypeScript, Node 20                      |
| **WhatsApp**       | @whiskeysockets/baileys v7 rc9                      |
| **AI/LLM**        | GPT-4o-mini via GitHub Models (Azure OpenAI endpoint)|
| **Embeddings**     | OpenAI text-embedding-3-small (1536 dimensions)     |
| **Database**       | Supabase PostgreSQL + pgvector                      |
| **Auth**           | Supabase Auth (JWT, email/password)                 |
| **Storage**        | Supabase Storage (catalog images)                   |
| **Voice**          | Vapi.ai (AI voice platform)                         |
| **Icons**          | Lucide React                                        |
| **Validation**     | Zod                                                 |
| **Scheduling**     | node-cron                                           |
| **File Processing**| ExcelJS, csv-parse                                  |
| **Logging**        | Pino                                                |

### Ports

| Service    | Port |
|------------|------|
| Frontend   | 3004 (dev), 8080 (Docker) |
| Backend    | 3005 |

---

## 3. Project Structure

```
Vyavsay_Baileys/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── environment.ts           # Env vars & validation
│   │   ├── domains/
│   │   │   ├── domain-router.ts         # Industry → domain resolver
│   │   │   ├── types.ts                 # Domain interface
│   │   │   ├── generic/index.ts         # Generic business (13 intents)
│   │   │   └── used-cars/index.ts       # Used car domain (23 intents)
│   │   ├── plugins/
│   │   │   ├── auth-plugin.ts           # JWT auth + owner check
│   │   │   ├── cors-plugin.ts           # CORS policy
│   │   │   └── supabase-plugin.ts       # DB client injection
│   │   ├── routes/                      # 11 route files (39 endpoints)
│   │   │   ├── catalog-routes.ts
│   │   │   ├── conversation-routes.ts
│   │   │   ├── file-routes.ts
│   │   │   ├── health-routes.ts
│   │   │   ├── knowledge-routes.ts
│   │   │   ├── lead-routes.ts
│   │   │   ├── owner-routes.ts
│   │   │   ├── session-routes.ts
│   │   │   ├── task-routes.ts
│   │   │   ├── user-routes.ts
│   │   │   └── vapi-routes.ts
│   │   ├── services/                    # 11 service files
│   │   │   ├── ai-router.ts             # GPT-4o intent detection & reply generation
│   │   │   ├── baileys-adapter.ts       # WhatsApp message bridge
│   │   │   ├── catalog-image-service.ts # Image upload to Supabase Storage
│   │   │   ├── catalog-service.ts       # Inventory CRUD & search
│   │   │   ├── cron-service.ts          # Scheduled tasks
│   │   │   ├── file-processor.ts        # Excel/CSV parsing
│   │   │   ├── pipeline-service.ts      # Core AI conversation pipeline
│   │   │   ├── rag-service.ts           # Vector embeddings & similarity search
│   │   │   ├── reminder-service.ts      # Follow-up reminders
│   │   │   ├── session-manager.ts       # Baileys session lifecycle
│   │   │   └── voice-service.ts         # Vapi voice agent integration
│   │   ├── utils/
│   │   │   ├── inbound-rate-limiter.ts  # Per-JID message throttling
│   │   │   ├── rate-limiter.ts          # Outbound message rate limiting
│   │   │   └── validation.ts            # Zod schemas
│   │   └── server.ts                    # Fastify entry point
│   ├── database/migrations/
│   │   ├── 001-schema.sql               # Core tables + pgvector
│   │   ├── 002-inventory-and-rag-fixes.sql
│   │   ├── 003-location-fields.sql
│   │   ├── 004-domain-fields.sql
│   │   └── 005-voice-calls.sql
│   ├── scripts/
│   │   └── voice-webhook-smoke-test.mjs
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts               # Axios + JWT interceptor
│   │   │   └── supabase.ts             # Supabase client init
│   │   ├── components/
│   │   │   ├── brand/VyavsayLogo.tsx
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx         # Responsive layout wrapper
│   │   │   │   ├── DesktopSidebar.tsx   # Desktop nav sidebar
│   │   │   │   ├── MobileBottomNav.tsx  # Mobile bottom nav
│   │   │   │   └── MoreDrawer.tsx       # Mobile menu drawer
│   │   │   ├── ui/                      # Reusable UI components
│   │   │   │   ├── Badge.tsx, Button.tsx, Card.tsx
│   │   │   │   ├── EmptyState.tsx, Input.tsx, Modal.tsx
│   │   │   │   ├── PageHeader.tsx, Toast.tsx
│   │   │   ├── ColumnMapper.tsx         # CSV column mapping
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── FileUpload.tsx           # Drag-drop file import
│   │   │   ├── InventoryTable.tsx       # Product grid/table
│   │   │   ├── ItemModal.tsx            # Add/edit inventory item
│   │   │   └── SchemaManager.tsx        # Custom field definitions
│   │   ├── context/AuthContext.tsx       # Auth state provider
│   │   ├── hooks/useMediaQuery.ts       # Responsive breakpoint hook
│   │   ├── lib/utils.ts                 # cn() utility
│   │   ├── pages/                       # 14 page components
│   │   │   ├── AIBrain.tsx, Analytics.tsx, Appointments.tsx
│   │   │   ├── Conversations.tsx, Dashboard.tsx, Leads.tsx
│   │   │   ├── Login.tsx, Onboarding.tsx, OwnerDashboard.tsx
│   │   │   ├── QRScanner.tsx, Settings.tsx, Tasks.tsx
│   │   │   └── VoiceCalls.tsx
│   │   ├── App.tsx                      # Routes & AppContent wrapper
│   │   ├── main.tsx                     # React DOM entry point
│   │   └── index.css                    # Tailwind directives
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── sample-data/                         # CSV seed files for testing
├── scripts/seed-catalog.js              # Catalog seeding script
├── docker-compose.yml                   # Multi-service orchestration
├── README.md
├── MASTER_PLAN.md
├── PRD.md
├── VOICE-AGENT-PRD.md
└── VOICE_LOCAL_SETUP_STEPS.md
```

**Total Files**: ~34 backend TypeScript + ~42 frontend TypeScript/React

---

## 4. Backend Deep Dive

### Framework: Fastify 5.3.3

Entry point: `backend/src/server.ts`

**Startup Flow**:
1. Load environment configuration
2. Create Fastify instance with Pino logger
3. Register Helmet (security headers, CSP disabled for API-only)
4. Register CORS plugin (origin validation)
5. Register Supabase client plugin (injects `fastify.supabase`)
6. Register Auth plugin (JWT validation, `request.userId`/`userEmail`/`isOwner`)
7. Register all 11 route handlers with `/api` prefix
8. Restore persisted Baileys sessions (async, non-blocking)
9. Initialize CronService (scheduled tasks)
10. Listen on port 3005

### Services Architecture

| Service | File | Purpose |
|---------|------|---------|
| **SessionManager** | `session-manager.ts` | Baileys socket lifecycle, QR codes, reconnection |
| **BaileysAdapter** | `baileys-adapter.ts` | Message parsing, sending, typing indicators |
| **PipelineService** | `pipeline-service.ts` | Core AI orchestration pipeline (largest service ~47KB) |
| **AIRouter** | `ai-router.ts` | GPT-4o analysis, reply generation, summarization |
| **RAGService** | `rag-service.ts` | Vector embeddings, knowledge base search |
| **CatalogService** | `catalog-service.ts` | Inventory CRUD, hybrid search |
| **CatalogImageService** | `catalog-image-service.ts` | Supabase Storage image uploads |
| **FileProcessor** | `file-processor.ts` | Excel/CSV parsing for data import |
| **VoiceService** | `voice-service.ts` | Vapi webhook handling, tool calls |
| **CronService** | `cron-service.ts` | Scheduled follow-ups and maintenance |
| **ReminderService** | `reminder-service.ts` | Lead re-engagement reminders |

### Validation

All routes use **Zod** schemas (`utils/validation.ts`) for request validation with detailed error messages.

### Rate Limiting

- **Outbound**: 1 message per 3 seconds per session (prevents WhatsApp bans)
- **Inbound**: Max 5 messages per 30 seconds per customer JID (prevents flood)

---

## 5. Frontend Deep Dive

### Framework: React 18 + Vite 6

- **State Management**: React Context API (AuthContext) - no Redux/Zustand
- **Routing**: React Router DOM v6 with ProtectedRoute wrapper
- **HTTP Client**: Axios with Supabase JWT interceptor
- **Styling**: Tailwind CSS with custom pastel color palette
- **Animations**: Framer Motion (transitions, staggered lists, modals)
- **Icons**: Lucide React

### Pages & Routes

| Route | Page Component | Purpose |
|-------|---------------|---------|
| `/login` | Login.tsx | Email/password auth (public) |
| `/` | Redirects to `/dashboard` | - |
| `/dashboard` | Dashboard.tsx | Stats, quick actions, connection status |
| `/onboarding` | Onboarding.tsx | 2-step business profile setup |
| `/qr-scanner` | QRScanner.tsx | WhatsApp QR code linking |
| `/conversations` | Conversations.tsx | Chat list + message view, AI pause/resume |
| `/leads` | Leads.tsx | Kanban board (5 stages), drag-drop |
| `/tasks` | Tasks.tsx | AI-extracted tasks with completion toggle |
| `/appointments` | Appointments.tsx | Calendar view + appointment management |
| `/voice-calls` | VoiceCalls.tsx | Vapi call logs, transcripts, actions |
| `/ai-brain` | AIBrain.tsx | Inventory + knowledge base management |
| `/analytics` | Analytics.tsx | Real-time business metrics |
| `/settings` | Settings.tsx | Profile, integrations, danger zone |
| `/owner/dashboard` | OwnerDashboard.tsx | Admin aggregate view (owner-only) |

### Design System

- **Color Palette**: Pastel colors (lavender, sage, peach, sky, honey, rose, mint, lilac, cream)
- **Typography**: Satoshi (display), Instrument Sans (body)
- **Component Library**: Custom UI components in `components/ui/` (Button, Card, Input, Modal, Badge, Toast, EmptyState, PageHeader)
- **Responsive**: Mobile-first with `useIsMobile()` hook (breakpoint: 1024px)
  - Desktop: Left sidebar navigation
  - Mobile: Bottom nav bar + More drawer

---

## 6. Database Schema & Models

### Database: Supabase PostgreSQL + pgvector

**13 Tables** across 5 migrations, all prefixed `wb_`:

### Core Tables

#### wb_users (Business Owners)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Supabase Auth user ID |
| email | VARCHAR UNIQUE | |
| business_name | VARCHAR | |
| industry | VARCHAR | Maps to domain config |
| services | JSONB | Array of service offerings |
| auto_reply_enabled | BOOLEAN | Toggle AI auto-replies |
| ai_confidence_threshold | FLOAT | Min confidence for auto-reply |
| followup_timer_hours | INT | Follow-up reminder delay |
| inventory_schema | JSONB | Custom field definitions |
| business_address | VARCHAR(500) | |
| google_maps_link | VARCHAR(500) | |
| created_at | TIMESTAMPTZ | |

#### wb_sessions (WhatsApp Connections)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| phone_number | VARCHAR | WhatsApp number |
| status | VARCHAR | connected/disconnected/qr_pending |
| connected_at | TIMESTAMPTZ | |

#### wb_conversations (Customer Chats)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| customer_jid | VARCHAR | WhatsApp JID (e.g. 919876543210@s.whatsapp.net) |
| customer_name | VARCHAR | |
| customer_phone | VARCHAR | |
| status | VARCHAR | active/closed |
| last_message_at | TIMESTAMPTZ | |
| summary | TEXT | AI-generated summary |
| language | VARCHAR | Detected language |
| negotiation_round | INT | Tracks negotiation iterations |
| buying_signal_score | FLOAT | Accumulated purchase intent |
| funnel_stage | VARCHAR | inquiry → qualification → ... → delivery |

#### wb_messages (Individual Messages)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| conversation_id | FK → wb_conversations | |
| sender | VARCHAR | 'customer', 'ai', 'user', 'business_owner' |
| content | TEXT | Message text |
| intent | VARCHAR | AI-detected intent |
| confidence | FLOAT | AI confidence score |
| created_at | TIMESTAMPTZ | |

#### wb_leads (Sales Leads)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| conversation_id | FK → wb_conversations | |
| customer_name | VARCHAR | |
| score | VARCHAR | high/medium/low |
| stage | VARCHAR | new/interested/quoted/negotiating/closed |
| intent | VARCHAR | |
| summary | TEXT | |
| notes | TEXT | |
| updated_at | TIMESTAMPTZ | Auto-updated via trigger |

#### wb_tasks (Follow-up Tasks)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| conversation_id | FK (nullable) | |
| title | VARCHAR | |
| due_date | TIMESTAMPTZ | |
| is_completed | BOOLEAN | |

### Inventory & RAG Tables

#### wb_catalog_items (Product Inventory)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| source_file_id | FK (nullable) | |
| item_name | VARCHAR | |
| category | VARCHAR | |
| description | TEXT | |
| price | NUMERIC | |
| quantity | INT | |
| images | JSONB | Array of {url, caption, order} |
| attributes | JSONB | Dynamic custom fields |
| embedding | VECTOR(1536) | OpenAI embeddings |
| is_active | BOOLEAN | Soft delete flag |

#### wb_knowledge_base (RAG Vector Store)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| content | TEXT | Knowledge text |
| embedding | VECTOR(1536) | |
| content_hash | VARCHAR | SHA256 deduplication |
| chunk_index | INT | For multi-chunk content |
| source_file_id | FK (nullable) | |

#### wb_source_files (Uploaded Files)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| filename | VARCHAR | |
| file_type | VARCHAR | excel/csv/pdf/image/text |
| file_hash | VARCHAR | SHA256 |
| row_count | INT | |
| processing_status | VARCHAR | pending/processing/completed/failed |

### Voice Tables

#### wb_calls (Voice Call Records)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | FK → wb_users | |
| vapi_call_id | VARCHAR UNIQUE | |
| direction | VARCHAR | inbound/outbound |
| from_number, to_number | VARCHAR | |
| customer_name, customer_phone | VARCHAR | |
| status | VARCHAR | ringing/in-progress/ended/completed |
| duration_sec | INT | |
| transcript | TEXT | Full call transcript |
| summary | VARCHAR | AI-generated summary |
| outcome | VARCHAR | resolved/appointment_booked/escalated/dropped |
| recording_url | VARCHAR | |

#### wb_call_actions (Voice Call Tool Executions)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| call_id | FK → wb_calls (CASCADE) | |
| action_name | VARCHAR | search_inventory/book_appointment/etc. |
| action_args | JSONB | |
| action_result | JSONB | |
| success | BOOLEAN | |
| latency_ms | INT | |

### Entity Relationships

```
wb_users (1)
  ├── (1:N) wb_sessions
  ├── (1:N) wb_conversations
  │     ├── (1:N) wb_messages
  │     └── (1:N) wb_leads
  ├── (1:N) wb_leads
  ├── (1:N) wb_tasks
  ├── (1:N) wb_knowledge_base
  ├── (1:N) wb_source_files
  │     └── (1:N) wb_catalog_items
  ├── (1:N) wb_catalog_items
  └── (1:N) wb_calls
        └── (1:N) wb_call_actions
```

### RPC Functions (Stored Procedures)

- **`wb_match_knowledge()`** - Semantic search on knowledge base (cosine similarity)
- **`wb_search_catalog()`** - Hybrid semantic + filtered search on catalog
- **`wb_search_catalog_structured()`** - Pure SQL structured search (no vectors)

### Indexes

- **Vector**: HNSW on embedding columns for fast similarity search
- **JSONB**: GIN index on `attributes` for flexible filtering
- **Composite**: `(user_id, status)`, `(user_id, stage)`, `(user_id, score)`, etc.

---

## 7. WhatsApp/Baileys Integration

### Library: @whiskeysockets/baileys v7.0.0-rc9

### Connection Flow

```
1. User clicks "Link WhatsApp" → POST /api/sessions
2. Backend creates Baileys socket → fetchLatestBaileysVersion()
3. Baileys emits QR code string
4. Frontend polls GET /sessions/:id/status every 2 seconds
5. QR converted to Base64 PNG data URL via 'qrcode' package
6. User scans with WhatsApp > Settings > Linked Devices
7. Baileys connection.update → status: 'open'
8. Frontend detects connected state → navigates to dashboard
```

### Session Manager (EventEmitter)

- **Multi-tenant**: Each user gets isolated Baileys socket
- **Auth persistence**: `useMultiFileAuthState()` stores credentials in `auth_sessions_v2/{userId}/`
- **Auto-restore**: On server startup, scans auth directory and reconnects all saved sessions
- **Reconnection**: Exponential backoff (max 15 attempts, 2s-30s delay)
- **Logout detection**: Clears auth on status code 401

### Message Flow (Receive → AI → Reply)

```
1. WhatsApp message arrives via Baileys 'messages.upsert' event
2. BaileysAdapter filters: skip outgoing, groups, broadcasts, rate-limited
3. Parse message: extract text from conversation/extendedText/imageCaption
4. Route to PipelineService.processIncomingMessage()
5. AI analysis: intent, lead score, entities, tasks, sentiment
6. Create/update lead in wb_leads
7. Auto-extract tasks into wb_tasks
8. Generate contextual reply via GPT-4o (with RAG context)
9. Send reply via BaileysAdapter.sendMessage() (with typing indicator)
10. Store all messages in wb_messages
```

### Sending Messages

- Rate limited: 1 message per 3 seconds per session
- Typing indicator: `sendPresenceUpdate('composing')` with realistic delay
- Supports: text messages and image messages with captions

---

## 8. AI & Chatbot Engine

### LLM: GPT-4o-mini via Azure OpenAI (GitHub Models endpoint)

```
Base URL: https://models.inference.ai.azure.com
API Key: GITHUB_PAT (GitHub Personal Access Token)
Model: gpt-4o-mini (configurable via AI_MODEL env var)
```

### Core AI Functions

| Function | Timeout | Temperature | Purpose |
|----------|---------|-------------|---------|
| `analyzeMessage()` | 20s | 0.3 | Intent detection, entity extraction, lead scoring |
| `generateReply()` | 25s | 0.7 | Contextual auto-reply generation |
| `generateSummary()` | 12s | - | Conversation summarization |
| `generateFollowUp()` | 12s | - | Inactive lead re-engagement |

### Intent Classification

**Generic Domain (13 intents)**: greeting, pricing_inquiry, service_inquiry, meeting_request, inventory_inquiry, inventory_browse, inventory_compare, price_negotiation, complaint, location_inquiry, etc.

**Used Cars Domain (23 intents)**: All generic + test_drive_request, financing_inquiry, trade_in_inquiry, warranty_inquiry, document_inquiry, insurance_inquiry, accident_history_inquiry, ownership_inquiry, competitor_comparison, urgency_signal, etc.

### Entity Extraction

- Product name, category, brand
- Price ranges with Indian rupee parsing (lakh/crore)
- Attributes: color, fuel type, transmission, year, ownership
- Appointment date/time with Hindi parsing ("kal" = tomorrow, "2 baje" = 2 PM)

### Sentiment Analysis

- Polarity: -1 (frustrated) to +1 (happy)
- Emotions: neutral, excited, frustrated, skeptical, impatient, happy, confused
- Auto-escalation trigger: polarity < -0.5

### Lead Scoring

- Three tiers: high, medium, low
- Buying signal accumulation per conversation
- Confidence scoring (0-1 float)

### Negotiation System

- Round-based strategy (max 4 rounds)
- Per-round tactics: hold firm → 3% concession → reveal floor → escalate to human
- Floor price protection
- "Last price" detection: skips to round 3
- Configurable: maxDiscount (4% generic, 8% used cars), maxRounds

### RAG (Retrieval-Augmented Generation)

- **Embedding Model**: text-embedding-3-small (OpenAI)
- **Chunking**: 200 words per chunk, 40-word overlap (20%)
- **Deduplication**: SHA256 content hash
- **Vector Storage**: Supabase pgvector
- **Search**: Cosine similarity, threshold 0.4, max 5 results
- **Batch Processing**: Embeddings in batches of 30, insertions in batches of 50

### Conversation Memory

- Tracks: products discussed, customer preferences, objections, questions asked
- History limits: 50 messages loaded, 20 sent to LLM
- Prevents context bloat and AI repetition

### Auto-Reply Decision Logic

Auto-reply triggers when ALL conditions met:
1. `auto_reply_enabled` is true
2. AI not paused for this conversation
3. Analysis recommends auto-reply
4. Confidence meets threshold OR intent is in autoReplyIntents
5. No escalation reason detected

AI pauses when:
- Complaint detected
- Negative sentiment (< -0.5)
- Negotiation exceeds max rounds
- Human explicitly requested

### Prompt Security

- Prompt injection detection ("ignore instructions", "DAN mode", etc.)
- System role lock: persona enforcement
- Permission boundaries: no price overrides, no info leaks
- Deflection responses for manipulation attempts

---

## 9. Voice Calling (Vapi)

### Provider: Vapi.ai

### Webhook Events Handled

| Event | Handler | Purpose |
|-------|---------|---------|
| `tool-calls` | handleToolCalls() | Execute AI agent actions |
| `status-update` | handleStatusUpdate() | Track call state changes |
| `end-of-call-report` | handleEndOfCallReport() | Save summary, transcript, recording |
| `assistant-request` | handleAssistantRequest() | Provide dynamic assistant config |
| `transcript` | - | Real-time transcript updates |
| `hang` | - | Agent non-response detection |

### Tool Calls (AI Agent Actions During Calls)

| Tool | Purpose |
|------|---------|
| `search_inventory` | Search products using CatalogService |
| `book_appointment` | Create task/appointment in wb_tasks |
| `share_location` | Send business address via WhatsApp |
| `escalate_to_human` | Log escalation, notify via WhatsApp |

### Voice Assistant Configuration

- Model: GPT-4o-mini (OpenAI)
- Voice: "alloy" (OpenAI voice)
- Dynamic system prompt: Injects business name, industry, services, address
- Rules: Keep under 3 sentences, speak naturally, never say "as an AI"

### Call Outcome Determination

- `appointment_booked`: If book_appointment tool was called
- `escalated`: If escalate_to_human tool was called
- `resolved`: Default for normal completion
- `dropped`: If call ended prematurely

---

## 10. Authentication & Security

### Authentication: Supabase JWT

- **Frontend**: Supabase Auth UI (email/password), session persisted in browser
- **Backend**: JWT token validation via `supabase.auth.getUser(token)` on every request
- **Token flow**: Frontend gets token from Supabase → Axios interceptor adds `Authorization: Bearer <token>` → Backend validates

### Role-Based Access Control (2 Tiers)

| Role | Access | How Determined |
|------|--------|----------------|
| **Regular User** | Own data only | JWT token |
| **Owner** | Aggregate dashboard across all businesses | Email in `OWNER_EMAILS` env var |

### Data Isolation

Every database query filters by `request.userId` - no user can access another user's data.

### Public Routes (No Auth)

- `GET /api/health` - Health check
- `POST /api/vapi/webhook` - Vapi webhook (uses separate secret validation)

### Security Measures

- Helmet security headers (XSS, HSTS, etc.)
- CORS: Development allows localhost, production restricts to `FRONTEND_URL`
- Webhook secret validation for Vapi (`x-vapi-secret` header)
- Zod validation on all request payloads
- Inbound + outbound rate limiting
- Baileys auth stored on filesystem (not database)

---

## 11. Deployment & DevOps

### Docker Setup

**Backend Dockerfile** (multi-stage):
- Builder: Node 20 slim, `npm ci`, TypeScript compile
- Runtime: Node 20 slim, production deps only, port 3005

**Frontend Dockerfile** (multi-stage):
- Builder: Node 20 slim, Vite build
- Runtime: nginx:alpine, SPA routing, API proxy, 20MB upload limit

**docker-compose.yml**:
- Backend service (port 3005) with volume for Baileys sessions
- Frontend service (port 8080 → container 80) depends on backend
- Named volume: `baileys_sessions` for persistence
- Restart policy: `unless-stopped`

### Environment Variables

**Backend (Required)**:
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_PAT
```

**Backend (Optional)**:
```
PORT (3005), FRONTEND_URL, NODE_ENV, SUPABASE_ANON_KEY,
SUPABASE_STORAGE_BUCKET, AUTH_SESSIONS_DIR,
VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID, VAPI_WEBHOOK_SECRET,
OWNER_EMAILS
```

**Frontend**:
```
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
VITE_API_BASE_URL, VITE_OWNER_EMAILS
```

### What's NOT Configured

- No CI/CD pipelines (no .github/workflows)
- No cloud provider-specific setup (AWS/GCP/Railway)
- No Kubernetes manifests
- No monitoring/logging aggregation
- Manual docker-compose deployment

---

## 12. API Reference (39 Endpoints)

### Health & Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Server status, uptime |
| GET | `/api/analytics` | Yes | Dashboard metrics |

### Sessions (WhatsApp)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/sessions` | Yes | Create new Baileys session |
| GET | `/api/sessions` | Yes | List user's sessions |
| GET | `/api/sessions/:userId/status` | Yes | Poll status + QR code |
| DELETE | `/api/sessions/:userId` | Yes | Destroy session |
| POST | `/api/sessions/:userId/restart` | Yes | Restart session |

### Conversations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/conversations` | Yes | List conversations |
| GET | `/api/conversations/:id` | Yes | Get conversation + messages |
| GET | `/api/conversations/:id/messages` | Yes | Get messages (limit 1-500) |
| PATCH | `/api/conversations/:id` | Yes | Update status/notes |
| POST | `/api/conversations/:id/messages` | Yes | Send message via WhatsApp |

### Leads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/leads` | Yes | List leads (filter by stage/score) |
| PATCH | `/api/leads/:id` | Yes | Update lead |

### Tasks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tasks` | Yes | List tasks |
| POST | `/api/tasks` | Yes | Create task |
| PATCH | `/api/tasks/:id` | Yes | Update task |
| DELETE | `/api/tasks/:id` | Yes | Delete task |

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:id` | Yes | Get profile (auto-creates if missing) |
| PATCH | `/api/users/:id` | Yes | Update profile |

### Knowledge Base

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/knowledge` | Yes | List knowledge items |
| POST | `/api/knowledge` | Yes | Add + embed content |
| DELETE | `/api/knowledge/:id` | Yes | Delete knowledge item |

### Catalog (Inventory)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/catalog` | Yes | List items (paginated, searchable) |
| GET | `/api/catalog/stats` | Yes | Inventory stats |
| GET | `/api/catalog/:id` | Yes | Get single item |
| POST | `/api/catalog` | Yes | Add item |
| PATCH | `/api/catalog/:id` | Yes | Update item |
| PATCH | `/api/catalog/:id/sold` | Yes | Mark as sold |
| DELETE | `/api/catalog/:id` | Yes | Soft delete |
| POST | `/api/catalog/batch` | Yes | Batch add from import |
| POST | `/api/catalog/images/upload` | Yes | Upload images (max 5, 15MB) |
| GET | `/api/catalog/export` | Yes | Export as Excel |

### Schema

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/schema` | Yes | Get inventory schema |
| PATCH | `/api/schema` | Yes | Update schema |

### Files

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/files/upload` | Yes | Upload Excel/CSV |
| POST | `/api/files/:fileId/process` | Yes | Process with column mapping |
| GET | `/api/files` | Yes | List uploaded files |
| DELETE | `/api/files/:fileId` | Yes | Delete file + items |

### Owner (Admin)

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/api/owner/overview` | Yes | Yes | Aggregate business stats |

### Voice (Vapi)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/vapi/webhook` | No* | Vapi webhook (secret validated) |
| GET | `/api/vapi/calls` | Yes | List voice calls |
| GET | `/api/vapi/calls/:id` | Yes | Get single call |
| GET | `/api/vapi/calls/:id/actions` | Yes | Get call actions |

---

## 13. Data Flow Diagrams

### Customer Message → AI Reply

```
Customer sends WhatsApp message
        │
        ▼
Baileys socket receives (messages.upsert)
        │
        ▼
BaileysAdapter.handleMessage()
  ├── Filter: skip outgoing, groups, broadcasts
  ├── Rate limit check (5 msgs / 30s per JID)
  └── Parse message text
        │
        ▼
PipelineService.processIncomingMessage()
  ├── 1. Lookup/create user profile
  ├── 2. Lookup/create conversation
  ├── 3. Store message in wb_messages
  ├── 4. Load conversation history (last 50)
  ├── 5. Build conversation memory (products, preferences, objections)
  ├── 6. AI Analysis via ai-router.analyzeMessage()
  │     ├── Intent classification
  │     ├── Entity extraction
  │     ├── Lead scoring
  │     ├── Sentiment analysis
  │     └── Task/appointment detection
  ├── 7. Update/create lead in wb_leads
  ├── 8. Create tasks in wb_tasks
  ├── 9. Check auto-reply conditions
  ├── 10. RAG: retrieve relevant knowledge
  ├── 11. Catalog: search matching inventory
  ├── 12. Generate reply via ai-router.generateReply()
  ├── 13. Handle special cases (photo, location, negotiation)
  └── 14. Send via BaileysAdapter.sendMessage()
              ├── Rate limit wait (3s)
              ├── Typing indicator
              └── socket.sendMessage()
```

### QR Code Connection Flow

```
Frontend: Click "Link WhatsApp"
        │
        ▼
POST /api/sessions → SessionManager.createSession()
        │
        ▼
Baileys: makeWASocket() → connection.update → QR emitted
        │
        ▼
Frontend: Poll GET /sessions/:id/status (every 2s)
  ├── QR string → QRCode.toDataURL() → Base64 PNG
  └── Display QR image
        │
        ▼
User scans with WhatsApp Linked Devices
        │
        ▼
Baileys: connection === 'open' → status: 'connected'
        │
        ▼
Frontend: Detect connected → navigate to dashboard
```

---

## 14. Domain System

### Architecture

Industry-specific AI behavior via configurable domain modules.

### Available Domains

| Domain | Industry Aliases | Intents |
|--------|-----------------|---------|
| **Generic** | Any unmatched industry | 13 intents |
| **Used Cars** | "used cars", "car dealer", "automotive" | 23 intents |

### What Each Domain Configures

1. **Vocabulary**: Product/venue nouns (car/showroom vs product/store)
2. **Intents**: Industry-specific intent list
3. **Patterns**: Regex for intent detection & fact extraction
4. **LLM Prompts**: System prompts for analysis, reply, follow-up
5. **Templates**: Location & photo replies (English + Hinglish)
6. **Negotiation Config**: Discount caps, max rounds, floor prices
7. **Price Formatting**: Display format (e.g., INR lakh conversion)
8. **Fallback Messages**: Default responses

### Used Cars Domain Special Features

- **Persona**: "Rahul" (8+ years experience)
- **Sales Psychology**: Cialdini principles (anchoring, scarcity, social proof, commitment, reciprocity, loss aversion)
- **Objection Handling**: Templates for "too expensive", "OLX cheaper", "family check", accident concerns
- **Financing**: EMI calculations, bank partners, tenure/interest rates
- **Documents**: RC transfer, insurance transfer, NOC handling

---

## 15. Key Files Index

### Backend - Core

| File | Lines | Purpose |
|------|-------|---------|
| `src/server.ts` | ~80 | Fastify entry point & plugin registration |
| `src/config/environment.ts` | ~60 | Environment variable loading & validation |
| `src/services/pipeline-service.ts` | ~350+ | Core AI conversation orchestration |
| `src/services/ai-router.ts` | ~200+ | GPT-4o analysis & reply generation |
| `src/services/session-manager.ts` | ~262 | Baileys session lifecycle |
| `src/services/baileys-adapter.ts` | ~158 | WhatsApp message bridge |
| `src/services/voice-service.ts` | ~533 | Vapi voice agent integration |
| `src/services/rag-service.ts` | ~150+ | Vector embeddings & search |
| `src/services/catalog-service.ts` | ~200+ | Inventory CRUD & hybrid search |

### Backend - Routes

| File | Endpoints | Purpose |
|------|-----------|---------|
| `routes/session-routes.ts` | 5 | WhatsApp session management |
| `routes/conversation-routes.ts` | 5 | Chat history & messaging |
| `routes/catalog-routes.ts` | 10 | Inventory management |
| `routes/vapi-routes.ts` | 4 | Voice calling |
| `routes/lead-routes.ts` | 2 | Lead pipeline |
| `routes/task-routes.ts` | 4 | Task CRUD |
| `routes/user-routes.ts` | 2 | User profile |
| `routes/knowledge-routes.ts` | 3 | RAG knowledge base |
| `routes/file-routes.ts` | 4 | File import/processing |
| `routes/owner-routes.ts` | 1 | Admin dashboard |
| `routes/health-routes.ts` | 2 | Health & analytics |

### Backend - Domains

| File | Purpose |
|------|---------|
| `domains/types.ts` | BaseDomain interface |
| `domains/domain-router.ts` | Industry → domain resolver |
| `domains/generic/index.ts` | Generic business config (13 intents) |
| `domains/used-cars/index.ts` | Used car dealer config (23 intents) |

### Frontend - Pages

| File | Purpose |
|------|---------|
| `pages/Dashboard.tsx` | Main hub with stats & quick actions |
| `pages/Conversations.tsx` | Chat list + message view |
| `pages/Leads.tsx` | Kanban board lead management |
| `pages/AIBrain.tsx` | Inventory + knowledge base |
| `pages/VoiceCalls.tsx` | Voice call logs & transcripts |
| `pages/QRScanner.tsx` | WhatsApp QR code linking |
| `pages/Analytics.tsx` | Business metrics dashboard |
| `pages/Settings.tsx` | Profile & integrations |
| `pages/OwnerDashboard.tsx` | Admin aggregate view |

### Database

| File | Purpose |
|------|---------|
| `migrations/001-schema.sql` | Core 7 tables + pgvector |
| `migrations/002-inventory-and-rag-fixes.sql` | Catalog + RAG enhancements |
| `migrations/003-location-fields.sql` | Business address fields |
| `migrations/004-domain-fields.sql` | Negotiation & funnel tracking |
| `migrations/005-voice-calls.sql` | Voice call tables |

---

*This document provides a complete understanding of the Vyavsay Baileys project - its architecture, every component, every API endpoint, database schema, AI pipeline, WhatsApp integration, voice calling, security model, and deployment setup.*
