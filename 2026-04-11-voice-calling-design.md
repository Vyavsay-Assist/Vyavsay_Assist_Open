# Voice Calling Feature — Design Spec

> **Document history**
> - 2026-04-11 — Initial outbound AI voice calling spec
> - 2026-04-19 — Added inbound calls, call sync to dashboard, Indian number routing, Android companion app architecture, and research findings. See "Update: Inbound Calls + Call Sync" section below.

## Goal
Add AI voice calling to the Vyavsay dashboard. Users can trigger outbound AI calls to customers (any number or existing leads) and view call history with transcripts. VAPI handles the AI conversation; the existing backend webhook handles tool calls.

## What Already Exists
- `voice-service.ts` — tool call handling, call lifecycle, dynamic assistant config
- `vapi-routes.ts` — webhook endpoint + call history GET endpoints
- `wb_calls` / `wb_call_actions` tables — call data storage
- VAPI account with US phone number, API key configured

## What We're Building

### Backend: Outbound Call Route (~80 lines)
**File**: Add to `vapi-routes.ts`

`POST /api/vapi/calls/outbound`
- Auth required (uses request.userId)
- Body: `{ phoneNumber: string, customerName?: string }`
- Fetches business profile from wb_users for assistant context
- Calls VAPI API `POST https://api.vapi.ai/call` with:
  - `phoneNumberId` from env (VAPI_PHONE_NUMBER_ID)
  - `customer.number` = the target phone number
  - `assistantOverrides.metadata.userId` for webhook user resolution
  - Dynamic system prompt with business context (reuse handleAssistantRequest logic)
- Returns `{ callId, status }` to frontend

### Frontend: Voice Calls Page (~300 lines)
**File**: `frontend/src/pages/VoiceCalls.tsx`

**Layout (matches existing cream/pastel design):**
1. **Header**: "Voice Calls" title + subtitle
2. **Make a Call card**: Phone input (with +91 prefix default) + optional customer name + "Start AI Call" button
3. **Call History table**: Status badge, phone number, duration, outcome, timestamp. Clickable rows.
4. **Call Detail modal**: Transcript, actions taken, recording player (if URL available)

**Sidebar**: Add Phone icon entry to DesktopSidebar.tsx pointing to `/voice-calls`

**Route**: Add to App.tsx

### No Changes Needed
- voice-service.ts (webhook handling is complete)
- Database schema (wb_calls already tracks everything)
- environment.ts (VAPI vars already defined)

## Data Flow
```
Dashboard "Call" button
  → POST /api/vapi/calls/outbound { phoneNumber, customerName }
  → Backend calls VAPI API to create outbound call
  → VAPI dials the customer using US number
  → Customer picks up, AI conversation starts
  → VAPI sends webhook events to POST /api/vapi/webhook
  → voice-service.ts handles tool calls, status updates
  → wb_calls table updated throughout
  → Frontend polls GET /api/vapi/calls for history
```

## Scope Boundaries
- No real-time call status websocket (polling is fine for hackathon)
- No click-to-call from leads page in this iteration (just the dedicated page)
- US number as caller ID (Indian number is a VAPI account config, not code change)

---

# Update: Inbound Calls + Call Sync (2026-04-19)

_This section extends the original outbound-only spec with the full architecture for (a) logging incoming calls to the dealer's SIM and (b) having an AI answer calls the dealer misses. See `CALL_CAPTURE_PLAN.md` for the higher-level decision log._

## The User Goal

The dealer's SIM is their WhatsApp Business number AND their publicly advertised phone number (on OLX, CarDekho, business cards, etc). Customers dial that number and it rings on the dealer's physical phone.

What we want:
1. **Every call** (answered, missed, outgoing) appears in the dashboard timeline next to WhatsApp messages.
2. **Missed calls are caught by Priya** (our Vapi AI agent) who talks to the customer, logs intent, and triggers a WhatsApp follow-up.
3. **No number change** for the dealer — their SIM and WhatsApp number stay exactly as they are.

## Two Parallel Tracks (Vision A + Vision B)

The work is split into two independent tracks that combine at the dashboard layer:

| | **Vision A: Call Sync** | **Vision B: AI Answers Missed Calls** |
|---|---|---|
| **Covers** | Every call on dealer's SIM (answered, missed, outgoing) | Only calls forwarded to Priya when dealer misses |
| **Mechanism** | Android companion app reads `CallLog.Calls` | Cellular call-forwarding → Plivo DID → SIP → Vapi |
| **Data captured** | Number, direction, duration, timestamp | Full transcript, recording, intent, lead data |
| **Running cost** | ₹0/month | ~₹900-1,200/month per dealer |
| **External dependencies** | None | Plivo India DID + Vapi |
| **Ship order** | Can ship independently, works today | Needs Plivo KYC (3-5 days) |

**Both tracks feed the same `wb_phone_calls` + `wb_calls` tables and surface in the same Conversations timeline.** The Android app logs the event; if Vapi handled it, the corresponding `wb_calls` row has the transcript.

## Why Baileys Cannot See Cellular Calls (settled)

Researched via parallel agents on 2026-04-18. Confirmed across multiple sources:

- WhatsApp Web protocol (what Baileys speaks) is fully sandboxed from the device's cellular radio.
- No presence flag, no event, no field exposes PSTN calls to Baileys.
- `sock.ev.on('call')` only fires for WhatsApp-native voice/video calls — not cellular.
- Meta's official WhatsApp Business Calling API (GA July 2025) also only exposes WA-native calls, and requires Cloud API onboarding that's incompatible with Baileys.
- The "Calls" tab in the WhatsApp mobile app is a local-only read of Android's CallLog — never syncs to WA Web.

**Implication:** to see cellular calls we must either (a) read Android's call log via a companion app on the dealer's phone, or (b) route calls through a telephony provider we control. Both paths are implemented below.

---

# Vision B: AI Answers Missed Calls

## The Indian Number Problem

Vapi provisions phone numbers via Twilio/Vonage/Telnyx. All three technically offer Indian DIDs, but Indian regulations require heavy KYC (GST, registered entity, Indian address). **Vapi does not self-serve Indian numbers.** We tested with a US Vapi number — Priya answered, but using it in production is blocked because:
- Indian carriers either block or charge ISD rates for international call-forwarding.
- Caller ID would show a US number during the forward leg.

## Chosen Solution: Plivo India DID → SIP trunk → Vapi (Bring Your Own Number)

### Architecture

```
Customer dials dealer's SIM (public WhatsApp number)
    │
    ▼
Dealer's phone rings for 20 seconds
    │
    ├─ Dealer picks up → normal human call (invisible to Vapi, logged by Android app)
    │
    └─ Dealer misses / busy / unreachable
         │
         ▼
    Cellular carrier CFNRy/CFB/CFNRc forwards to Plivo Indian DID
         │
         ▼
    Plivo Application: <Dial><Sip>sip:<assistant>@sip.vapi.ai</Sip></Dial>
         │
         ▼
    Vapi receives call on BYO phone number, runs Priya assistant
         │
         ▼
    Webhook events → /api/vapi/webhook
         │
         ▼
    wb_calls row created + end-of-call triggers WhatsApp follow-up via baileysAdapter
```

### Cost Model (per dealer)

| Line item | Cost |
|---|---|
| Plivo Indian DID rental | ₹250/month |
| Plivo inbound minutes (~60 min/mo est.) | ₹40-50 |
| Vapi platform + GPT-4o + OpenAI TTS | ~₹600-900 for 60 min |
| **Total** | **~₹900-1,200/month** |

Comparable human receptionist: ₹12,000+/month. Even at the high end, this is a ~10x saving.

### Setup Steps

1. **Sign up Plivo India** (3-5 days): submit KYC (GST, PAN, address proof). Girija Motors has these.
2. **Purchase Indian DID** (~₹250/mo).
3. **Vapi dashboard**: create "Bring Your Own Number" / SIP trunk entry. Vapi exposes SIP URI like `sip:<assistant-id>@sip.vapi.ai`.
4. **Plivo dashboard**: create an Application with XML:
   ```xml
   <Response>
     <Dial>
       <Sip>sip:YOUR-VAPI-URI</Sip>
     </Dial>
   </Response>
   ```
   Assign the Application to the Plivo number.
5. **Vapi assistant (Priya)**: set Server URL to `https://vyavsayassist.app/api/vapi/webhook`, enable events `assistant-request`, `status-update`, `end-of-call-report`, `tool-calls`, set secret matching `VAPI_WEBHOOK_SECRET`.
6. **Dealer sets forwarding on their SIM** (one time, via phone dialer):
   ```
   **61*919999888777*11*20#   → forward if no reply after 20s
   **67*919999888777#          → forward if line busy
   **62*919999888777#          → forward if unreachable / phone off
   ```
   Replace `919999888777` with the actual Plivo number (country code, no plus).

### Rejected Alternatives (Do Not Revisit)

| Option | Why rejected |
|---|---|
| Port dealer's SIM to VoIP | Breaks WhatsApp — WA requires real SIM registered with carrier. |
| International forward from SIM to US Vapi number | Indian carriers charge ISD rates or outright block. Unusable. |
| MyOperator, Knowlarity, Tata Kaleyra | ₹1,999-2,500/month floors or enterprise-only. Too expensive. |
| Twilio India direct | Heavy KYC, enterprise onboarding, not self-serve. |
| Exotel end-to-end with their own AI | Would require rebuilding Priya persona in Exotel Flow; loses Vapi's model/tool flexibility. (Still viable as a fallback if Plivo KYC stalls.) |
| ElevenLabs Conversational AI | Amazing TTS but no India-specific edge; still needs separate telephony. |

### Worth Investigating: Sarvam AI as a Vapi replacement

Indian AI startup with best-in-class Hindi/Hinglish voice models (Saarika ASR, Bulbul TTS). If they offer Indian DIDs bundled with their voice agent product, they could **replace both Plivo and Vapi in one step** — and Priya would speak Hindi much more naturally. Research pending.

## Current Code State (audited 2026-04-19)

### Works ✅
- Vapi webhook is live at `/api/vapi/webhook` (`server.ts:64-65`)
- `handleAssistantRequest`, `handleStatusUpdate`, `handleEndOfCallReport`, `handleToolCalls` all implemented (`voice-service.ts`)
- `wb_calls` and `wb_call_actions` tables exist with inbound-aware schema (`direction`, `from_number`, `customer_phone`, etc.)
- Outbound flow works end-to-end, manually verified

### Broken or Missing ❌

1. **`serverUrlSecret` is a placeholder** — `voice-service.ts:459`:
   ```ts
   serverUrlSecret: 'choose_a_long_random_secret',
   ```
   Literally hardcoded. Must replace with `config.VAPI_WEBHOOK_SECRET`.

2. **`getUserIdFromCall` multi-tenant bug** — `voice-service.ts:466-490`. Falls back to "first user in wb_users" when metadata is missing (inbound always lacks metadata). Every dealer's inbound call would be attributed to user #1. Need a `dealer_phone_numbers` table mapping `vapi_phone_number_id → user_id` and resolve via `message.phoneNumber.id`.

3. **No WhatsApp follow-up at end-of-call** — `handleEndOfCallReport` saves the call record but never calls `baileysAdapter.sendMessage()`. This is the core feature the dealer asked for. ~15 lines to add.

4. **Vapi dashboard webhook URL likely not set** — verified via Supabase query 2026-04-19: `wb_calls` and `wb_call_actions` have **0 rows** despite a manually-tested call being answered by Priya. Meaning the Vapi assistant is likely configured directly in the Vapi dashboard without the webhook URL pointing at our backend. Fix in Vapi UI (no code change).

### Action Items (in order)

- [ ] **Vapi dashboard**: set Server URL + enable webhook events on Priya assistant
- [ ] **Code**: fix `serverUrlSecret` placeholder (`voice-service.ts:459`) — 1 line
- [ ] **Code**: add WhatsApp follow-up in `handleEndOfCallReport` — ~15 lines
- [ ] **Retest**: manually call the US Vapi number; verify row appears in `wb_calls` with transcript
- [ ] **Plivo**: submit KYC for Girija Motors (blocks on dealer providing documents)
- [ ] **Multi-tenant**: design + implement `dealer_phone_numbers` table, rewrite `getUserIdFromCall`
- [ ] **Plivo**: once KYC clears, purchase DID, configure SIP app, wire to Vapi BYO
- [ ] **Dealer**: set MMI forwarding codes on SIM
- [ ] **End-to-end test**: real customer call → miss → Priya → WA follow-up

---

# Vision A: Call Sync from Dealer's Phone (Android App)

## Why This Is the Only Path

Every solution to "log calls that ring the dealer's physical SIM" requires code running on the dealer's phone that reads the system call log. There is no cloud-only alternative. Research (4 parallel agents, 2026-04-18) confirmed this is how LeadSquared and Salestrail solve the same problem.

## Key Constraints

1. **Indian OEMs (Xiaomi/Oppo/Vivo) aggressively kill background apps.** Naive services die within hours. Must use WorkManager (Google's battery-optimization-friendly primitive) + prompt dealer for battery exemption during onboarding.
2. **Android 14/15 tightened foreground services.** `dataSync` FGS is limited to 6h/day on Android 15.
3. **Dual-SIM is the norm in India.** Must let dealer pick which SIM during pairing.
4. **Play Store policy restricts `READ_CALL_LOG`.** Approval is case-by-case; Callyzer Biz is a live precedent as a "Call Management Tool." Sideloaded APK distribution is safer for launch.
5. **Android Developer Verification deadline (Sep 2026)** — India not in first wave but expected by 2027. Register as verified developer to future-proof.

## Chosen Architecture: WorkManager-only (simplest viable)

No foreground service. No persistent notification. The app is essentially asleep between 15-minute sync cycles.

```
┌─────────────────────────────────────────────────────────────┐
│  ANDROID APP (installed on dealer's phone)                  │
│                                                             │
│  1. MainActivity — status screen, manual "Sync Now" button  │
│  2. PairingScreen — QR scanner + SIM picker                 │
│  3. SyncWorker (WorkManager, every 15 min)                  │
│      • Reads CallLog.Calls WHERE _ID > lastSyncedId         │
│      • Filters by SUBSCRIPTION_ID = business_sim            │
│      • Writes pending rows to local Room DB                 │
│      • Batch POSTs to backend                               │
│      • On success, deletes synced rows, updates lastId      │
│  4. Room SQLite — offline queue for pending uploads         │
│  5. EncryptedSharedPreferences — JWT + subscription_id      │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTPS (JWT in Authorization header)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND                                                    │
│                                                             │
│  POST /api/phone-calls/pair   — exchange OTP token → JWT    │
│  POST /api/phone-calls/sync   — idempotent batch upsert     │
│                                                             │
│  Tables:                                                    │
│  • wb_paired_devices (device_id, user_id, subscription_id,  │
│                       paired_at, last_heartbeat_at)         │
│  • wb_phone_calls    (idempotent on device_id+device_call_id)│
│                                                             │
│  On sync:                                                   │
│  • Upsert wb_phone_calls                                    │
│  • Match phone_number against wb_leads → set lead_id        │
│  • Supabase realtime event → dashboard re-renders           │
└─────────────────────────────────────────────────────────────┘
```

## Data Schema

### `wb_phone_calls` (new)

```sql
CREATE TABLE wb_phone_calls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES wb_users(id),
  device_id      text NOT NULL,
  device_call_id text NOT NULL,            -- Android CallLog._ID as string
  phone_number   text NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('incoming','outgoing','missed','rejected','blocked')),
  duration_sec   integer,
  started_at     timestamptz NOT NULL,
  answered       boolean,
  subscription_id integer,
  lead_id        uuid REFERENCES wb_leads(id),
  created_at     timestamptz DEFAULT now(),
  UNIQUE (user_id, device_id, device_call_id)
);

CREATE INDEX ON wb_phone_calls (user_id, started_at DESC);
CREATE INDEX ON wb_phone_calls (user_id, phone_number);
```

### `wb_paired_devices` (new)

```sql
CREATE TABLE wb_paired_devices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES wb_users(id),
  device_id           text NOT NULL UNIQUE,  -- UUID generated by app at pair time
  device_label        text,                  -- user-set, e.g. "My Samsung"
  subscription_id     integer,               -- which SIM to watch
  paired_at           timestamptz DEFAULT now(),
  last_heartbeat_at   timestamptz,
  revoked_at          timestamptz
);
```

## Three Flows

### 1. Pairing (one-time, ~30 seconds)

```
Dashboard side                       Phone side
──────────────                       ──────────
Open Settings → "Pair Phone"
Generate one-time pairing code
Display as QR (valid 5 min)
                                     Install APK (signed, from our CDN)
                                     Open app → "Scan QR"
                                     App extracts pairing token
                                     ↓
                                     POST /api/phone-calls/pair
                                     body: { pairing_token, device_id (new UUID),
                                             device_model, android_version }
Verify token, mark consumed
Create wb_paired_devices row
Return: { jwt, user_id, business_name }
                                     App stores jwt in EncryptedSharedPrefs
                                     App reads SubscriptionManager
                                     Dealer picks "business SIM"
                                     ↓
                                     PATCH /api/phone-calls/pair
                                     body: { subscription_id }
Persist subscription_id
                                     Paired ✓ — schedule SyncWorker
```

### 2. Normal sync (every 15 minutes, forever)

```
WorkManager triggers SyncWorker (constraints: CONNECTED, BATTERY_NOT_LOW)
    │
    ▼
Query CallLog.Calls WHERE _ID > lastSyncedId
                      AND SUBSCRIPTION_ID = pairedSubscriptionId
    │
    ▼
For each new row → insert into local Room.pending_calls
    │
    ▼
Batch POST /api/phone-calls/sync
    body: [
      { device_call_id, phone_number, direction, duration_sec,
        started_at (ISO), answered, subscription_id }, ...
    ]
    │
    ▼
Server: upsert wb_phone_calls (idempotent via UNIQUE constraint)
Server: for each row, match phone_number → wb_leads.phone, set lead_id
Server: update wb_paired_devices.last_heartbeat_at
Server: emit Supabase realtime event
Server: return 200 OK { synced_ids: [...] }
    │
    ▼
App deletes synced rows from Room.pending_calls
App updates lastSyncedId in SharedPreferences
```

### 3. Hard cases

| Situation | Handling |
|---|---|
| Phone offline during sync | WorkManager has `NetworkType.CONNECTED` constraint — skips, retries when network returns. Pending rows stay in Room. |
| Backend 5xx error | Rows stay in `pending_calls` with `upload_tries++`. Next run retries; exponential backoff via WorkManager. |
| Backend 401 (revoked) | App clears JWT, shows "Disconnected — please re-pair" screen. Stops syncing. |
| Phone rebooted | `BootCompletedReceiver` re-registers the periodic work. `lastSyncedId` survives in SharedPreferences. No data loss. |
| OEM kills background work | WorkManager reschedules when system wakes. Onboarding prompts for battery exemption via `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent. |
| Dealer opens app manually | "Sync Now" button enqueues a one-off WorkManager job. Catches any lag. |
| Dealer disconnects from dashboard | Backend sets `wb_paired_devices.revoked_at`, next sync returns 401, app shows "Disconnected." |
| Dual-SIM mis-reports subscription_id | Android OEMs are ~85-90% reliable here. Fallback: at pair time store the BUSINESS SIM's phone number (via `TelephonyManager` if available) and filter by that as a secondary. |

## Permissions

| Permission | Why |
|---|---|
| `READ_CALL_LOG` | Read CallLog.Calls entries (the core capability) |
| `READ_PHONE_STATE` | Enumerate SIMs, read subscription info |
| `POST_NOTIFICATIONS` (API 33+) | Only to notify if sync has failed for 24h+ |
| `RECEIVE_BOOT_COMPLETED` | Re-register periodic work after reboot |
| `INTERNET` | (Normal) upload sync data |
| Battery optimization exemption | Prompted during onboarding, one-tap grant |

**Not requested:** contacts, SMS, location, audio recording, camera (except briefly for QR pairing).

## Distribution Strategy

1. **Phase 1 (launch):** signed APK hosted on our CDN, dealers download during onboarding. Play Protect shows a warning for `READ_CALL_LOG` alone but does not block.
2. **Phase 2 (parallel):** submit to Play Store as **"Call Management Tool"**. Model listing on Callyzer Biz. Approval is 1-3 weeks, case-by-case.
3. **Phase 3 (Q3 2026):** register for Android Developer Verification before the Sep 2026 deadline.

## Scope Boundaries (Vision A)

- Android only. iOS can't read call log via public APIs; Indian dealer base is ~95% Android.
- Metadata only — no audio recording (Android 10+ OS-level block on third-party recording).
- No intent scoring from calls logged by Android app (needs audio, only possible via Vision B).
- 15-minute sync lag is acceptable. If real-time is needed later, add ContentObserver in foreground service.
- No auto-create lead from unknown numbers in v1 — would spam the Leads board. Show in "Unassigned Calls" bucket; dealer promotes to lead manually.

## Action Items (Vision A MVP, ~3-4 days)

- [ ] Scaffold Kotlin project: `VyavsayPhoneSync/`
- [ ] Implement `PairingActivity` (QR scanner + SIM picker)
- [ ] Implement `SyncWorker` (WorkManager + CallLog query + batch POST)
- [ ] Implement local Room DB for `pending_calls`
- [ ] Create Supabase migration: `wb_phone_calls` + `wb_paired_devices` tables
- [ ] Backend endpoints: `POST /api/phone-calls/pair`, `PATCH /api/phone-calls/pair`, `POST /api/phone-calls/sync`
- [ ] Dashboard Settings → "Pair Phone" QR flow (can reuse existing `QRScanner.tsx` pattern)
- [ ] Merge `wb_phone_calls` events into `Conversations.tsx` timeline
- [ ] Onboarding screen explaining permissions + privacy
- [ ] Host signed APK on CDN with download instructions

---

# Combined Architecture (Vision A + Vision B Together)

When both tracks are live, here's the full picture:

```
Customer dials dealer's SIM
   │
   ▼
Dealer's phone rings (20s)
   │
   ├─ Dealer answers
   │    → Android app logs it on next sync (incoming, duration, answered=true)
   │    → Dashboard: shows in timeline with duration
   │
   └─ Dealer misses / busy
        │
        ▼
   Android app logs it (missed, duration=0, answered=false) ──┐
        │                                                     │
        ▼                                                     ▼
   Cellular carrier forwards to Plivo                   Dashboard
        │                                               shows missed
        ▼                                               call in timeline
   Plivo → SIP → Vapi
        │
        ▼
   Priya answers, has full conversation
        │
        ▼
   end-of-call-report webhook
        │
        ▼
   wb_calls row created with transcript, recording, intent
   baileysAdapter.sendMessage() → customer receives WhatsApp
        │
        ▼
   Dashboard timeline now shows:
     1. "Missed call" event (from Android app)
     2. "Priya handled call, 2m34s, booked test drive" (from Vapi)
     3. "WhatsApp: 'Hi, Priya here from Girija Motors...'" (from Baileys)
```

**Deduplication:** Android app logs the SIM-side event, Vapi logs the forwarded-leg event. They correlate by phone number + timestamp proximity (within 2 minutes). Dashboard can group them into a single "call session" card.

**Single source of WhatsApp follow-up:** Only Vapi sends the WA message, because only Vapi has the call transcript + intent. Android app NEVER sends a missed-call auto-reply to avoid duplicates.

---

# Research Summary (4 parallel agents, 2026-04-18)

1. **Baileys + WhatsApp PSTN visibility: NO.** No signal, no event, no API. WhatsApp Web protocol is fully sandboxed from the cellular radio. Meta's WA Business Calling API (GA Jul 2025) exposes only WA-native calls.

2. **Android call log companion app: VIABLE WITH CAVEATS.** Callyzer Biz is a Play Store precedent for this exact pattern, approved under "Call Management Tool" category. Key gotchas: foreground service with `dataSync` type (Android 15 limits to 6h/day), battery exemption mandatory on MIUI/ColorOS/FunTouch, Sep 2026 Android Developer Verification deadline coming.

3. **Indian VoIP providers: Plivo ₹250/mo is cheapest.** Exotel (~₹499/mo + bundle) is the best native-India fallback. MyOperator/Knowlarity/Tata Kaleyra all too expensive or enterprise-only. TRAI/DLT regulations do not block inbound call forwarding; DLT applies only to outbound promotional.

4. **Competitor CRM analysis.** Every WhatsApp-first CRM in India (Interakt, WATI, AiSensy, Gallabox, DoubleTick) has **zero native cellular call logging**. Every telephony-first CRM (Exotel, MyOperator, CallHippo) requires the dealer to adopt a new virtual number. Only LeadSquared (enterprise) bridges both via an Android tracker app. **Vyavsay's "keep existing SIM + log all calls + AI catches misses" positioning is genuinely differentiated.**

---

# Open Questions

1. **Caller ID on forwarded leg:** when SIM forwards to Plivo, does the customer's original caller ID pass through, or does Plivo show its own number? Test required. Plivo claims pass-through via SIP headers but carriers sometimes strip.
2. **Cost modeling at scale:** need to model per-dealer Plivo+Vapi cost at 20/60/150 inbound minutes/month to confirm it fits the ₹500-2,000/month pricing bucket.
3. **Sarvam AI evaluation:** can Sarvam's voice agent + Indian DID bundle replace Plivo+Vapi for Indian-language-heavy dealers? Research agent hasn't been run yet.
4. **Lead auto-creation from unknown callers:** v2 decision — auto-create after N calls from the same unknown number? Or dealer-initiated only?
5. **Deduplication heuristic:** what time window counts two events (Android + Vapi) as the same "call session"? 2 min proposed, needs validation.
6. **iOS dealer strategy:** acceptable gap for now, but Indian iOS market is growing. Stopgap: iOS Share Sheet extension to manually log a call, but no automatic sync.
7. **Multi-device pairing:** can one dealer have two paired phones (e.g. showroom manager + owner)? Schema allows it, UX doesn't.

---

# File References (for implementers)

| Area | File | Notes |
|---|---|---|
| Vapi webhook entrypoint | `backend/src/routes/vapi-routes.ts` | `/webhook` handles all Vapi events |
| Voice service core | `backend/src/services/voice-service.ts` | Tool handlers, assistant config, lifecycle |
| Webhook registration | `backend/src/server.ts:64-65` | Register under `/api/vapi`, no JWT |
| Vapi env vars | `backend/src/config/environment.ts:24-27` | `VAPI_*` keys |
| WhatsApp send | `backend/src/services/baileys-adapter.ts` | Used for end-of-call follow-up |
| Existing QR scan pattern | `frontend/src/components/QRScanner.tsx` | Reuse for phone pairing |
| Conversations timeline | `frontend/src/pages/Conversations.tsx` | Where phone calls will interleave |
| Companion plan doc | `CALL_CAPTURE_PLAN.md` | High-level decision log
