import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Phone, Tag, Calendar, FileText,
  Mic, Square, Loader2, Sparkles, Check, RotateCcw,
} from 'lucide-react';
import client from '../api/client';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface Props {
  onClose: () => void;
  onSaved: (customerId: string) => void;
}

const OUTCOMES = [
  { value: 'interested',     label: '👀 Interested' },
  { value: 'will_decide',    label: '🤔 Will Decide' },
  { value: 'purchased',      label: '✅ Purchased' },
  { value: 'not_interested', label: '❌ Not Interested' },
  { value: 'follow_up',      label: '⏰ Follow-Up Later' },
];

interface VoicePreview {
  transcript: string;
  customer_name?: string;
  customer_phone?: string;
  staff_name?: string;
  outcome?: string;
  notes?: string;
  items_mentioned?: string[];
  follow_up_hint?: string;
  quality: 'good' | 'unclear' | 'too_short' | 'low_confidence' | 'hallucination';
}

/** 8 vertical bars driven by recorder.level (0-100). Quick trust signal. */
const VolumeBars: React.FC<{ level: number }> = ({ level }) => (
  <div className="flex items-end gap-1 h-6">
    {Array.from({ length: 8 }).map((_, i) => {
      const threshold = (i + 1) * 11;
      const on = level >= threshold;
      const height = 8 + i * 2;
      const color = i < 5 ? 'bg-soft-sage' : i < 7 ? 'bg-soft-honey' : 'bg-soft-rose';
      return (
        <span
          key={i}
          className={`w-1.5 rounded-sm transition-colors ${on ? color : 'bg-cream-200'}`}
          style={{ height: `${height}px` }}
        />
      );
    })}
  </div>
);

const MIN_RECORDING_MS = 1500;

const AddWalkInModal: React.FC<Props> = ({ onClose, onSaved }) => {
  // form fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [staffName, setStaffName] = useState('');
  const [outcome, setOutcome] = useState('interested');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');

  // submit state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // voice state
  const [extracting, setExtracting] = useState(false);
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recorder = useAudioRecorder(30_000);

  const formatDuration = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    return `0:${s.toString().padStart(2, '0')}`;
  };

  const handleMicClick = async () => {
    setVoiceError(null);
    setPreview(null);
    if (recorder.status === 'idle') {
      await recorder.start();
    } else if (recorder.status === 'recording') {
      const recordedMs = recorder.durationMs;
      const blob = await recorder.stop();
      // Hook returns null when the muxer produced a header-only blob (the
      // MediaRecorder bug we patched). It also sets recorder.error in that case.
      if (!blob) {
        setVoiceError(recorder.error || 'Recording failed. Please try again.');
        return;
      }
      if (recordedMs < MIN_RECORDING_MS) {
        setVoiceError('Too short — please hold and speak for at least 2 seconds.');
        return;
      }
      await sendForExtraction(blob);
    }
  };

  const sendForExtraction = async (blob: Blob) => {
    setExtracting(true);
    setVoiceError(null);
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `walkin.${ext}`, { type: blob.type });
      const form = new FormData();
      form.append('file', file);

      // Do NOT set Content-Type — let axios + the browser set
      // "multipart/form-data; boundary=…" with the auto-generated boundary.
      const res = await client.post('/voice/extract-walkin', form);

      const { transcript, extracted, quality } = res.data;

      // Layered failure modes from backend (low_confidence / hallucination /
      // too_short / unclear) — show honest "couldn't catch" UX, never push
      // garbage into form fields.
      if (quality !== 'good') {
        const messages: Record<string, string> = {
          too_short:       "That was very short — please hold and speak for a few seconds.",
          unclear:         "Sorry, couldn't catch any clear info. Try again, closer to the phone.",
          low_confidence:  "Audio was unclear (background noise?). Try somewhere quieter.",
          hallucination:   "Couldn't hear you properly. Please try again.",
        };
        setVoiceError(messages[quality] || "Couldn't catch that. Try again or fill below.");
        setPreview({ transcript: transcript || '', quality });
        return;
      }

      setPreview({
        transcript,
        customer_name: extracted.customer_name,
        customer_phone: extracted.customer_phone,
        staff_name: extracted.staff_name,
        outcome: extracted.outcome,
        notes: extracted.notes,
        items_mentioned: extracted.items_mentioned,
        follow_up_hint: extracted.follow_up_hint,
        quality: 'good',
      });
    } catch (err: any) {
      console.error('Voice extraction failed', err);
      const msg = err.response?.data?.error || 'Could not process voice. Try again or fill manually.';
      setVoiceError(msg);
    } finally {
      setExtracting(false);
    }
  };

  const applyPreview = () => {
    if (!preview) return;
    if (preview.customer_name && !name) setName(preview.customer_name);
    if (preview.customer_phone && !phone) setPhone(preview.customer_phone);
    if (preview.staff_name && !staffName) setStaffName(preview.staff_name);
    if (preview.outcome) setOutcome(preview.outcome);
    if (preview.notes && !notes) setNotes(preview.notes);
    setPreview(null);
    setVoiceError(null);
  };

  const discardPreview = () => {
    setPreview(null);
    setVoiceError(null);
  };

  const handleSubmit = async () => {
    if (!name && !phone) {
      setError('Please add a name or phone number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await client.post('/visits', {
        customer_name: name || undefined,
        customer_phone: phone || undefined,
        staff_name: staffName || undefined,
        outcome,
        manual_notes: notes || undefined,
        follow_up_at: followUp ? new Date(followUp).toISOString() : undefined,
      });
      onSaved(res.data.visit.customer_id);
    } catch (err: any) {
      console.error('Failed to save visit', err);
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const isRecording = recorder.status === 'recording';
  const isStopping  = recorder.status === 'stopping';
  const showPreview = preview !== null && preview.quality === 'good';
  const showFailedHint = preview !== null && preview.quality !== 'good';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-cream-50 w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-[18px] font-bold text-ink-400">New Walk-In</h2>
            <button onClick={onClose} className="text-ink-50 hover:text-ink-200 p-1 transition" aria-label="Close">
              <X size={20} />
            </button>
          </div>

          {/* ────────── VOICE CAPTURE — primary ────────── */}
          {!showPreview && (
            <div className="mb-4 bg-pastel-lavender/30 rounded-2xl p-4 border border-soft-lavender/20">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] uppercase tracking-wide font-medium text-soft-lavender flex items-center gap-1">
                  <Sparkles size={12} /> Easy Voice Entry
                </div>
                {isRecording && (
                  <div className="text-[12px] text-soft-rose font-mono font-semibold">
                    🔴 {formatDuration(recorder.durationMs)}
                  </div>
                )}
              </div>

              {/* Big mic button */}
              <div className="flex flex-col items-center gap-3 py-2">
                <button
                  onClick={handleMicClick}
                  disabled={extracting || isStopping}
                  className={`w-20 h-20 rounded-full flex items-center justify-center transition shadow-md ${
                    isRecording
                      ? 'bg-soft-rose text-cream-50 animate-pulse'
                      : extracting
                      ? 'bg-cream-200 text-ink-50'
                      : 'bg-soft-lavender text-cream-50 hover:scale-105 active:scale-95'
                  }`}
                  aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                >
                  {extracting ? (
                    <Loader2 size={32} className="animate-spin" />
                  ) : isRecording ? (
                    <Square size={28} fill="currentColor" />
                  ) : (
                    <Mic size={32} />
                  )}
                </button>

                {/* Live volume bars — proves the mic is picking up sound */}
                {isRecording && (
                  <VolumeBars level={recorder.level} />
                )}

                <div className="text-center">
                  {extracting ? (
                    <div className="text-[13px] text-ink-200 font-medium">
                      Sun rahe hain… (Processing what you said)
                    </div>
                  ) : isRecording ? (
                    <div className="text-[13px] text-ink-200 font-medium">
                      {recorder.level > 5
                        ? 'Speak now — tap red square when done'
                        : "Can't hear you — speak louder or check your mic"}
                    </div>
                  ) : (
                    <>
                      <div className="text-[14px] text-ink-300 font-semibold">
                        Tap to Speak
                      </div>
                      <div className="text-[11px] text-ink-50 mt-0.5">
                        Hindi · Marathi · English — all work
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Tip */}
              {!isRecording && !extracting && !showFailedHint && (
                <div className="mt-3 bg-cream-50 rounded-lg px-3 py-2 border border-cream-200">
                  <div className="text-[10px] uppercase tracking-wide text-ink-50 font-medium mb-1">
                    Example
                  </div>
                  <div className="text-[12px] text-ink-200 italic leading-relaxed">
                    "Rajesh Sharma, 9876543210, Fortuner chahiye, Sunday tak decide karenge"
                  </div>
                </div>
              )}

              {/* Failed hint */}
              {showFailedHint && (
                <div className="mt-3 bg-pastel-honey/40 rounded-lg px-3 py-2.5 border border-soft-honey/20">
                  <div className="text-[12px] text-ink-300 font-medium mb-1">
                    🤔 Couldn't catch that clearly
                  </div>
                  {preview?.transcript && (
                    <div className="text-[11px] text-ink-100 italic mb-2">
                      Heard: "{preview.transcript}"
                    </div>
                  )}
                  <button
                    onClick={discardPreview}
                    className="text-[11px] text-soft-honey font-semibold underline"
                  >
                    Try again or fill below
                  </button>
                </div>
              )}

              {voiceError && !showFailedHint && (
                <div className="mt-2 text-[12px] text-soft-rose bg-pastel-rose/30 px-3 py-2 rounded-lg">
                  {voiceError}
                </div>
              )}

              {recorder.error && (
                <div className="mt-2 text-[11px] text-soft-rose">
                  Mic error: {recorder.error}
                </div>
              )}
            </div>
          )}

          {/* ────────── PREVIEW CARD (after successful extraction) ────────── */}
          {showPreview && preview && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 bg-pastel-sage/30 rounded-2xl p-4 border border-soft-sage/20"
            >
              <div className="text-[11px] uppercase tracking-wide font-medium text-soft-sage flex items-center gap-1 mb-2">
                <Sparkles size={12} /> Here's what I heard
              </div>

              <div className="bg-cream-50 rounded-lg px-3 py-2 mb-3 border border-cream-200">
                <div className="text-[10px] uppercase tracking-wide text-ink-50 mb-1">You said</div>
                <div className="text-[13px] text-ink-300 italic leading-relaxed">
                  "{preview.transcript}"
                </div>
              </div>

              <div className="text-[10px] uppercase tracking-wide text-ink-50 mb-1.5">I'll fill in</div>
              <ul className="space-y-1 text-[12px] text-ink-300 mb-3">
                {preview.customer_name && (
                  <li>• <span className="text-ink-100">Name:</span> <span className="font-medium">{preview.customer_name}</span></li>
                )}
                {preview.customer_phone && (
                  <li>• <span className="text-ink-100">Phone:</span> <span className="font-medium">{preview.customer_phone}</span></li>
                )}
                {preview.staff_name && (
                  <li>• <span className="text-ink-100">Handled by:</span> <span className="font-medium">{preview.staff_name}</span></li>
                )}
                {preview.outcome && (
                  <li>• <span className="text-ink-100">Outcome:</span> <span className="font-medium">{OUTCOMES.find(o => o.value === preview.outcome)?.label || preview.outcome}</span></li>
                )}
                {preview.items_mentioned && preview.items_mentioned.length > 0 && (
                  <li>• <span className="text-ink-100">Items mentioned:</span> <span className="font-medium">{preview.items_mentioned.join(', ')}</span></li>
                )}
                {preview.follow_up_hint && (
                  <li>• <span className="text-ink-100">Follow-up hint:</span> <span className="font-medium">{preview.follow_up_hint}</span></li>
                )}
                {preview.notes && (
                  <li>• <span className="text-ink-100">Notes:</span> <span className="font-medium">{preview.notes}</span></li>
                )}
              </ul>

              <div className="flex gap-2">
                <button
                  onClick={discardPreview}
                  className="flex-1 py-2.5 rounded-full text-[13px] font-medium text-ink-200 bg-cream-50 border border-cream-200 hover:bg-cream-100 transition flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={14} /> Try Again
                </button>
                <button
                  onClick={applyPreview}
                  className="flex-1 py-2.5 rounded-full text-[13px] font-medium bg-soft-sage text-cream-50 hover:opacity-90 transition flex items-center justify-center gap-1.5"
                >
                  <Check size={14} /> Looks Good
                </button>
              </div>
            </motion.div>
          )}

          {/* ────────── MANUAL FIELDS ────────── */}
          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Customer Name
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <User size={16} className="text-ink-50" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajesh Sharma"
              className="flex-1 bg-transparent outline-none text-sm text-ink-300 placeholder:text-ink-50"
            />
          </div>

          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Phone Number
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <Phone size={16} className="text-ink-50" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="9876543210"
              inputMode="numeric"
              className="flex-1 bg-transparent outline-none text-sm text-ink-300 placeholder:text-ink-50"
            />
          </div>

          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Handled By
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <Tag size={16} className="text-ink-50" />
            <input
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Sales rep name"
              className="flex-1 bg-transparent outline-none text-sm text-ink-300 placeholder:text-ink-50"
            />
          </div>

          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-2 mt-4 font-medium">
            Outcome
          </label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => setOutcome(o.value)}
                className={`text-xs py-2 rounded-xl font-medium border transition ${
                  outcome === o.value
                    ? 'bg-ink-300 text-cream-50 border-ink-300'
                    : 'bg-cream-50 text-ink-100 border-cream-200 hover:bg-cream-100'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-4 font-medium">
            Notes
          </label>
          <div className="flex items-start gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <FileText size={16} className="text-ink-50 mt-0.5" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did they want? What did you show?"
              rows={3}
              className="flex-1 bg-transparent outline-none text-sm resize-none text-ink-300 placeholder:text-ink-50"
            />
          </div>

          <label className="block text-[11px] uppercase tracking-wide text-ink-50 mb-1 mt-3 font-medium">
            Follow-Up Date (optional)
          </label>
          <div className="flex items-center gap-2 bg-cream-100 rounded-xl px-3 py-2.5 border border-cream-200">
            <Calendar size={16} className="text-ink-50" />
            <input
              type="datetime-local"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm text-ink-300"
            />
          </div>

          {error && (
            <div className="mt-3 text-xs text-soft-rose bg-pastel-rose/30 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-full text-sm font-medium text-ink-100 border border-cream-200 hover:bg-cream-100 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || isRecording || extracting}
              className="flex-1 py-3 rounded-full text-sm font-medium bg-soft-sage text-cream-50 disabled:opacity-50 hover:opacity-90 transition"
            >
              {saving ? 'Saving…' : 'Save Walk-In'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AddWalkInModal;
