import React, { useState, useEffect } from 'react';
import client from '../api/client';
import {
  Calendar,
  Clock,
  User,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Loader2,
  CalendarDays,
  Car,
  Plus,
  X,
  Save,
  Trash2,
  Bell,
} from 'lucide-react';
import { motion } from 'framer-motion';

interface Appointment {
  id: string;
  title: string;
  due_date: string | null;
  is_completed: boolean;
  created_at: string;
  customerName: string;
  service: string;
  isAutoDetected: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const extractInfo = (title: string): { customerName: string; service: string } => {
  // "📅 Appointment: John — Test Drive"
  const apptMatch = title.match(/(?:Appointment|Booking|Meeting)[:\s]*(.+?)\s*[—–\-]\s*(.+)/i);
  if (apptMatch) return { customerName: apptMatch[1].trim(), service: apptMatch[2].trim() };

  // "Test Drive for John"
  const forMatch = title.match(/(.+?)\s+(?:for|with)\s+(.+)/i);
  if (forMatch) return { customerName: forMatch[2].trim(), service: forMatch[1].trim() };

  // Fallback — use full title as service
  return { customerName: 'Customer', service: title.length > 40 ? title.slice(0, 40) + '...' : title };
};

const Appointments: React.FC = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form
  const [formName, setFormName] = useState('');
  const [formService, setFormService] = useState('Test Drive');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAppointments(); }, []);

  const fetchAppointments = async () => {
    try {
      const res = await client.get('/tasks');
      const tasks = res.data.tasks || [];

      // Show ALL tasks that have a due_date — they're all scheduled items
      const appts: Appointment[] = tasks
        .filter((t: any) => t.due_date)
        .map((t: any) => {
          const info = extractInfo(t.title || '');
          return {
            ...t,
            customerName: info.customerName,
            service: info.service,
            isAutoDetected: t.title?.includes('📅') || false,
          };
        });

      setAppointments(appts);
    } catch (err) {
      console.error('Failed to fetch', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleComplete = async (id: string, current: boolean) => {
    await client.patch(`/tasks/${id}`, { is_completed: !current }).catch(() => {});
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, is_completed: !current } : a));
  };

  const deleteAppt = async (id: string) => {
    await client.delete(`/tasks/${id}`).catch(() => {});
    setAppointments(prev => prev.filter(a => a.id !== id));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formDate) return;
    setSaving(true);
    try {
      const title = `📅 Appointment: ${formName.trim()} — ${formService}`;
      await client.post('/tasks', { title, due_date: formDate, is_completed: false });
      setFormName(''); setFormService('Test Drive'); setFormDate(''); setFormTime('');
      setShowAddModal(false);
      await fetchAppointments();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  // Date helpers
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

  const active = appointments.filter(a => !a.is_completed);
  const todayAppts = active.filter(a => new Date(a.due_date!).toDateString() === today.toDateString());
  const tomorrowAppts = active.filter(a => new Date(a.due_date!).toDateString() === tomorrow.toDateString());
  const weekAppts = active.filter(a => { const d = new Date(a.due_date!); return d >= today && d <= weekEnd; });
  const pastAppts = appointments.filter(a => a.is_completed || new Date(a.due_date!) < today);

  // Calendar
  const calMonth = calendarDate.getMonth();
  const calYear = calendarDate.getFullYear();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const getApptsForDate = (day: number) => {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return appointments.filter(a => a.due_date?.startsWith(dateStr));
  };

  const selectedDayAppts = selectedDay ? getApptsForDate(selectedDay) : [];
  const selectedDateStr = selectedDay ? `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}` : '';

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
              <CalendarDays className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Appointments</h1>
          </div>
          <p className="text-muted-foreground">Auto-detected from WhatsApp + manually added. All scheduled items appear here.</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="bg-primary hover:bg-primary/90 text-white font-bold px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 flex items-center gap-2">
          <Plus className="w-5 h-5" /> Add Appointment
        </button>
      </div>

      {/* Today's Reminder Banner */}
      {todayAppts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shrink-0 animate-pulse">
            <Bell className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-green-400 text-lg">
              {todayAppts.length} appointment{todayAppts.length > 1 ? 's' : ''} today!
            </h3>
            <p className="text-sm text-green-300/70">
              {todayAppts.map(a => `${a.customerName} — ${a.service}`).join(' | ')}
            </p>
          </div>
        </motion.div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Today', value: todayAppts.length, bg: 'bg-green-500/10', color: 'text-green-400', icon: Clock },
          { label: 'Tomorrow', value: tomorrowAppts.length, bg: 'bg-blue-500/10', color: 'text-blue-400', icon: Calendar },
          { label: 'This Week', value: weekAppts.length, bg: 'bg-primary/10', color: 'text-primary', icon: CalendarDays },
          { label: 'Completed', value: pastAppts.filter(a => a.is_completed).length, bg: 'bg-muted', color: 'text-muted-foreground', icon: CheckCircle2 },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/50 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${s.bg}`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
              <span className="text-sm font-semibold text-muted-foreground">{s.label}</span>
            </div>
            <p className="text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Main Layout: Calendar + Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar — 2 cols */}
        <div className="lg:col-span-2 bg-card border border-border/50 rounded-3xl overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-border/30">
            <button onClick={() => setCalendarDate(new Date(calYear, calMonth - 1, 1))} className="p-2 rounded-xl hover:bg-muted transition-all"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold">{MONTHS[calMonth]} {calYear}</h2>
            <button onClick={() => setCalendarDate(new Date(calYear, calMonth + 1, 1))} className="p-2 rounded-xl hover:bg-muted transition-all"><ChevronRight className="w-5 h-5" /></button>
          </div>

          <div className="grid grid-cols-7 border-b border-border/20">
            {DAYS.map(d => <div key={d} className="text-center py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{d}</div>)}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} className="min-h-[80px] border-r border-b border-border/10 bg-muted/5" />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dayAppts = getApptsForDate(day);
              const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
              const isPast = new Date(calYear, calMonth, day) < today;
              const isSelected = selectedDay === day;

              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  className={`min-h-[80px] border-r border-b border-border/10 p-1.5 cursor-pointer transition-all ${
                    isSelected ? 'bg-primary/10 ring-2 ring-primary/30 ring-inset' :
                    isToday ? 'bg-primary/5' :
                    isPast ? 'bg-muted/5 opacity-40' : 'hover:bg-muted/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday ? 'bg-primary text-white' : isSelected ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                    }`}>{day}</span>
                    {dayAppts.length > 0 && (
                      <span className={`text-[9px] w-5 h-5 flex items-center justify-center rounded-full font-bold ${
                        dayAppts.some(a => !a.is_completed) ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                      }`}>{dayAppts.length}</span>
                    )}
                  </div>
                  {dayAppts.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {dayAppts.slice(0, 2).map(a => (
                        <div key={a.id} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded truncate ${
                          a.is_completed ? 'bg-muted/30 text-muted-foreground line-through' : 'bg-green-500/20 text-green-300'
                        }`}>{a.customerName}</div>
                      ))}
                      {dayAppts.length > 2 && <div className="text-[9px] text-muted-foreground pl-1">+{dayAppts.length - 2}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Side Panel — 1 col */}
        <div className="space-y-5">
          {/* Selected day detail OR upcoming list */}
          {selectedDay ? (
            <div className="bg-card border border-border/50 rounded-2xl p-5">
              <h3 className="font-bold text-lg mb-4">
                {MONTHS[calMonth]} {selectedDay}, {calYear}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({selectedDayAppts.length} appointment{selectedDayAppts.length !== 1 ? 's' : ''})
                </span>
              </h3>
              {selectedDayAppts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  No appointments this day
                  <button onClick={() => { setFormDate(selectedDateStr); setShowAddModal(true); }} className="block mx-auto mt-3 text-primary text-xs font-bold hover:underline">
                    + Add one
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDayAppts.map(a => (
                    <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      a.is_completed ? 'border-border/30 opacity-50' : 'border-green-500/20 bg-green-500/5'
                    }`}>
                      <Car className="w-5 h-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{a.service}</p>
                        <p className="text-xs text-muted-foreground">{a.customerName}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => toggleComplete(a.id, a.is_completed)} className="p-1.5 rounded-lg hover:bg-green-500/20 text-green-400"><CheckCircle2 className="w-4 h-4" /></button>
                        <button onClick={() => deleteAppt(a.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Upcoming list when no day selected */
            <div className="bg-card border border-border/50 rounded-2xl p-5">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" /> Upcoming
              </h3>
              {active.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Calendar className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  No upcoming appointments
                </div>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {active.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()).slice(0, 10).map(a => {
                    const d = new Date(a.due_date!);
                    const isToday2 = d.toDateString() === today.toDateString();
                    return (
                      <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isToday2 ? 'border-green-500/30 bg-green-500/5' : 'border-border/30'
                      }`}>
                        <div className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0 text-[10px] font-bold ${
                          isToday2 ? 'bg-green-500 text-white' : 'bg-muted/50 text-muted-foreground'
                        }`}>
                          <span>{DAYS[d.getDay()].slice(0, 2)}</span>
                          <span className="text-sm leading-none">{d.getDate()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{a.service}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <User className="w-3 h-3" /> {a.customerName}
                            {isToday2 && <span className="text-green-400 font-bold ml-1">TODAY</span>}
                          </p>
                        </div>
                        <button onClick={() => toggleComplete(a.id, a.is_completed)} className="p-1.5 rounded-lg hover:bg-green-500/20 text-muted-foreground hover:text-green-400">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Past/Completed section */}
          {pastAppts.length > 0 && (
            <div className="bg-card/50 border border-border/30 rounded-2xl p-5">
              <h3 className="font-bold text-sm text-muted-foreground mb-3 uppercase tracking-widest">Completed ({pastAppts.filter(a => a.is_completed).length})</h3>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {pastAppts.filter(a => a.is_completed).slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400/50 shrink-0" />
                    <span className="truncate flex-1 line-through">{a.service} — {a.customerName}</span>
                    <span>{a.due_date ? new Date(a.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── ADD MODAL ─── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/50 rounded-3xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center"><CalendarDays className="w-5 h-5 text-primary" /></div>
                <h2 className="text-xl font-bold">New Appointment</h2>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Customer Name *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Rahul Sharma" required
                  className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Purpose</label>
                <select value={formService} onChange={e => setFormService(e.target.value)}
                  className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <option value="Test Drive">Test Drive</option>
                  <option value="Showroom Visit">Showroom Visit</option>
                  <option value="Meeting">Meeting</option>
                  <option value="Consultation">Consultation</option>
                  <option value="Document Verification">Document Verification</option>
                  <option value="Delivery">Delivery</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Date *</label>
                  <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} required
                    className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Time</label>
                  <input type="time" value={formTime} onChange={e => setFormTime(e.target.value)}
                    className="w-full bg-muted/30 border border-border/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-border/30">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-6 py-3 rounded-xl font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                <button type="submit" disabled={saving || !formName.trim() || !formDate}
                  className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Appointments;
