import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Phone, Tag, Calendar, FileText, Mic, MicOff, Loader2, Sparkles } from 'lucide-react';
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

const AddWalkInModal: React.FC<Props> = ({ onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [staffName, setStaffName] = useState('');
  const [outcome, setOutcome] = useState('interested');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [extractedHint, setExtractedHint] = useState<string | null>(null);

  const recorder = useAudioRecorder(30_000);

  const formatDuration = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    return `0:${s.toString().padStart(2, '0')}`;
  };

  const handleMicClick = async () => {
    setError(null);
    if (recorder.status === 'idle') {
      await recorder.start();
    } else if (recorder.status === 'recording') {
      const blob = await recorder.stop();
      if (blob && blob.size > 100) {
        await sendForExtraction(blob);
      }
    }
  };

  const sendForExtraction = async (blob: Blob) => {
    setExtracting(true);
    setError(null);
    setExtractedHint(null);
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `walkin.${ext}`, { type: blob.type });
      const form = new FormData();
      form.append('file', file);

      const res = await client.post('/voice/extract-walkin', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const { transcript: tx, extracted } = res.data;
      setTranscript(tx);

      // Auto-fill (don't overwrite if user already typed something)
      if (extracted.customer_name && !name) setName(extracted.customer_name);
      if (extracted.customer_phone && !phone) setPhone(extracted.customer_phone);
      if (extracted.staff_name && !staffName) setStaffName(extracted.staff_name);
      if (extracted.outcome) setOutcome(extracted.outcome);
      if (extracted.notes && !notes) setNotes(extracted.notes);

      const hints: string[] = [];
      if (extracted.items_mentioned?.length) {
        hints.push(`Items: ${extracted.items_mentioned.join(', ')}`);
      }
      if (extracted.follow_up_hint) {
        hints.push(`Follow-up mentioned: "${extracted.follow_up_hint}"`);
      }
      setExtractedHint(hints.length ? hints.join(' · ') : null);
    } catch (err: any) {
      console.error('Voice extraction failed', err);
      setError(err.response?.data?.error || 'Could not process voice. Try again or fill manually.');
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async () => {
    if (!name && !phone) {
      setError('Please enter a name or phone number');
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
  const isStopping = recorder.status === 'stopping';

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
            <h2 className="font-display text-[18px] font-bold text-ink-400">Log Walk-In</h2>
            <button onClick={onClose} className="text-ink-50 hover:text-ink-200 p-1 transition">
              <X size={20} />
            </button>
          </div>

          {/* Voice capture — primary path */}
          <div className="mb-4 bg-pastel-lavender/30 rounded-2xl p-4 border border-soft-lavender/20">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wide font-medium text-soft-lavender flex items-center gap-1">
                <Sparkles size={12} /> Voice Capture
              </div>
              {isRecording && (
                <div className="text-[11px] text-soft-rose font-mono">
                  ● {formatDuration(recorder.durationMs)}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleMicClick}
                disabled={extracting || isStopping}
                className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center transition shadow-sm ${
                  isRecording
                    ? 'bg-soft-rose text-cream-50 animate-pulse'
                    : extracting
                    ? 'bg-cream-200 text-ink-50'
                    : 'bg-soft-lavender text-cream-50 hover:opacity-90'
                }`}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {extracting ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : isRecording ? (
                  <MicOff size={22} />
                ) : (
                  <Mic size={22} />
                )}
              </button>

              <div className="flex-1 text-[12px] text-ink-100 leading-tight">
                {extracting ? (
                  <span>Transcribing & extracting…</span>
                ) : isRecording ? (
                  <span>Speak now — name, phone, what they wanted, follow-up. Tap again to stop.</span>
                ) : transcript ? (
                  <span className="italic">"{transcript}"</span>
                ) : (
                  <span>Tap to record up to 30 seconds. Hindi/Marathi/English all work.</span>
                )}
              </div>
            </div>

            {extractedHint && (
              <div className="mt-3 text-[11px] text-soft-lavender bg-cream-50 rounded-lg px-3 py-2 border border-soft-lavender/10">
                ✨ {extractedHint}
              </div>
            )}

            {recorder.error && (
              <div className="mt-2 text-[11px] text-soft-rose">{recorder.error}</div>
            )}
          </div>

          {/* Manual fields below */}
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
