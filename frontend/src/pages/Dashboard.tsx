import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Users,
  CheckSquare,
  ArrowUpRight,
  Clock,
  Zap,
  Phone,
  QrCode,
  BookOpen,
  Wifi,
  WifiOff,
  CalendarDays,
  User,
} from 'lucide-react';
import { motion } from 'framer-motion';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchAll();
  }, [user]);

  const fetchAll = async () => {
    try {
      const { data: userProfile } = await client.get(`/users/${user?.id}`);
      
      // Redirect to onboarding if profile is incomplete
      if (!userProfile.user?.business_name) {
        navigate('/onboarding');
        return;
      }

      const [statsRes, sessionsRes, tasksRes] = await Promise.all([
        client.get('/analytics').catch(() => ({ data: {} })),
        client.get('/sessions').catch(() => ({ data: { sessions: [] } })),
        client.get('/tasks').catch(() => ({ data: { tasks: [] } })),
      ]);
      setStats(statsRes.data);
      setSessions(sessionsRes.data.sessions || []);

      // Extract upcoming appointments from tasks — match multiple patterns
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const isAppt = (title: string) => {
        if (!title) return false;
        const lower = title.toLowerCase();
        return lower.includes('appointment') || lower.includes('test drive') ||
               lower.includes('meeting') || lower.includes('visit') ||
               lower.includes('booking') || lower.includes('schedule') || title.includes('📅');
      };
      const upcomingAppts = (tasksRes.data.tasks || [])
        .filter((t: any) => isAppt(t.title) && !t.is_completed && t.due_date && new Date(t.due_date) >= now)
        .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
        .slice(0, 5);
      setAppointments(upcomingAppts);
    } catch (err) {
      console.error('Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const item = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1 }
  };

  const connectedSessions = sessions.filter(s => s.status === 'connected');
  const isConnected = connectedSessions.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-muted-foreground animate-pulse font-medium">Syncing dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-outfit">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Dashboard Overview</h1>
          <p className="text-muted-foreground text-lg font-medium">
            {isConnected 
              ? 'Your AI Sales Agent is actively managing leads and chats.' 
              : 'Connect your WhatsApp to start the AI Sales Engine.'}
          </p>
        </div>
        <div className="flex gap-3">
          <div className={`border px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-sm ${isConnected ? 'bg-green-500/5 border-green-500/30' : 'bg-card border-border'}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className={`text-sm font-bold ${isConnected ? 'text-green-500' : 'text-red-400'}`}>
              {isConnected ? 'WhatsApp Connected' : 'Not Connected'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <motion.div variants={item} className="bg-card border border-border/50 rounded-3xl p-6 group hover:border-primary/30 transition-all shadow-lg">
          <div className="flex items-start justify-between mb-6">
            <div className="p-3 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
              <MessageSquare className="w-6 h-6 text-primary" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Active Conversations</h3>
            <p className="text-4xl font-extrabold leading-none">{stats?.totalConversations || 0}</p>
          </div>
        </motion.div>

        <motion.div variants={item} className="bg-card border border-border/50 rounded-3xl p-6 group hover:border-blue-500/30 transition-all shadow-lg">
          <div className="flex items-start justify-between mb-6">
            <div className="p-3 bg-blue-500/10 rounded-xl group-hover:bg-blue-500/20 transition-colors">
              <Users className="w-6 h-6 text-blue-500" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Potential Leads</h3>
            <p className="text-4xl font-extrabold leading-none">{stats?.totalLeads || 0}</p>
          </div>
        </motion.div>

        <motion.div variants={item} className="bg-card border border-border/50 rounded-3xl p-6 group hover:border-purple-500/30 transition-all shadow-lg">
          <div className="flex items-start justify-between mb-6">
            <div className="p-3 bg-purple-500/10 rounded-xl group-hover:bg-purple-500/20 transition-colors">
              <Zap className="w-6 h-6 text-purple-500" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">AI Auto-Replies</h3>
            <p className="text-4xl font-extrabold leading-none">{stats?.aiMessagesCount || 0}</p>
          </div>
        </motion.div>

        <motion.div variants={item} className="bg-card border border-border/50 rounded-3xl p-6 group hover:border-amber-500/30 transition-all shadow-lg">
          <div className="flex items-start justify-between mb-6">
            <div className="p-3 bg-amber-500/10 rounded-xl group-hover:bg-amber-500/20 transition-colors">
              <CheckSquare className="w-6 h-6 text-amber-500" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Extracted Tasks</h3>
            <p className="text-4xl font-extrabold leading-none">{stats?.totalTasks || 0}</p>
          </div>
        </motion.div>
      </motion.div>

      {/* Upcoming Appointments */}
      {appointments.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border/50 rounded-3xl p-8 shadow-lg"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-6 h-6 text-primary" />
              <h2 className="text-xl font-bold">Upcoming Appointments</h2>
            </div>
            <button onClick={() => navigate('/appointments')} className="text-sm text-primary font-semibold hover:underline">
              View All
            </button>
          </div>
          <div className="space-y-3">
            {appointments.map((appt: any) => {
              const apptDate = new Date(appt.due_date);
              const isToday = apptDate.toDateString() === new Date().toDateString();
              const nameMatch = appt.title?.match(/Appointment:\s*(.+?)\s*[—–-]\s*/);
              const serviceMatch = appt.title?.match(/[—–-]\s*(.+)$/);
              const customerName = nameMatch?.[1] || 'Customer';
              const service = serviceMatch?.[1] || 'Appointment';

              return (
                <div key={appt.id} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  isToday ? 'bg-green-500/5 border-green-500/30' : 'bg-muted/20 border-border/30'
                }`}>
                  <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 ${
                    isToday ? 'bg-green-500/20 text-green-400' : 'bg-muted/50 text-muted-foreground'
                  }`}>
                    <span className="text-[9px] font-bold uppercase">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][apptDate.getDay()]}</span>
                    <span className="text-lg font-bold leading-none">{apptDate.getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{service}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" /> {customerName}
                      {isToday && <span className="ml-2 text-green-400 font-bold">TODAY</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Quick Actions */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-card border border-border/50 rounded-3xl p-8 flex flex-col gap-6 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Quick Actions</h2>
            <ArrowUpRight className="text-muted-foreground w-5 h-5" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => navigate('/qr-scanner')}
              className="flex flex-col items-center gap-4 p-6 bg-muted/30 border border-border/50 rounded-2xl hover:bg-muted/50 transition-all group"
            >
              <div className="p-3 bg-primary/10 rounded-full group-hover:scale-110 transition-transform">
                <QrCode className="w-6 h-6 text-primary" />
              </div>
              <span className="text-sm font-bold">Link WhatsApp</span>
            </button>
            <button 
              onClick={() => navigate('/ai-brain')}
              className="flex flex-col items-center gap-4 p-6 bg-muted/30 border border-border/50 rounded-2xl hover:bg-muted/50 transition-all group"
            >
              <div className="p-3 bg-green-500/10 rounded-full group-hover:scale-110 transition-transform">
                <BookOpen className="w-6 h-6 text-green-500" />
              </div>
              <span className="text-sm font-bold">Train AI Brain</span>
            </button>
          </div>
        </motion.div>

        {/* Live Session Status */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-card border border-border/50 rounded-3xl p-8 shadow-lg"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Connected Devices</h2>
            <Clock className="text-muted-foreground w-5 h-5" />
          </div>
          <div className="space-y-4">
            {sessions.length === 0 ? (
              <div className="text-center py-10 space-y-4">
                <WifiOff className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                <div>
                  <p className="font-bold text-lg">No devices linked</p>
                  <p className="text-muted-foreground text-sm">Go to "Link WhatsApp" to connect your business number.</p>
                </div>
              </div>
            ) : (
              sessions.map((session, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-muted/30 border border-border/50 rounded-2xl text-sm">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${session.status === 'connected' ? 'bg-green-500/10' : 'bg-slate-500/10'}`}>
                      <Phone className={`w-5 h-5 ${session.status === 'connected' ? 'text-green-500' : 'text-slate-500'}`} />
                    </div>
                    <div>
                      <p className="font-bold">{session.phone ? `+${session.phone}` : 'Pending...'}</p>
                      <p className="text-muted-foreground text-xs">
                        {session.connectedAt ? `Connected ${new Date(session.connectedAt).toLocaleDateString()}` : 'Awaiting QR scan'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.status === 'connected' ? (
                      <span className="flex items-center gap-1.5 text-green-500 font-bold text-xs"><Wifi className="w-3.5 h-3.5" /> Active</span>
                    ) : (
                      <span className="text-muted-foreground font-medium text-xs">Offline</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;
