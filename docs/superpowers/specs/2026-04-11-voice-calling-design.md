# Voice Calling Feature — Design Spec

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
