import React, { useState, useEffect } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { 
  Zap, 
  Shield, 
  Database, 
  Phone, 
  Globe,
  Monitor,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';

const Settings: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) fetchProfile();
  }, [user]);

  const fetchProfile = async () => {
    try {
      const res = await client.get(`/users/${user?.id}`);
      setProfile(res.data.user);
    } catch (err) {
      console.error('Failed to fetch profile');
    } finally {
      setLoading(false);
    }
  };

  const toggleAutoReply = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const newVal = !profile.auto_reply_enabled;
      await client.patch(`/users/${user?.id}`, { auto_reply_enabled: newVal });
      setProfile({ ...profile, auto_reply_enabled: newVal });
    } catch (err) {
      alert('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const resetSessions = async () => {
    if (!confirm('This will disconnect all linked devices. Are you sure?')) return;
    try {
      await client.delete(`/sessions/${user?.id}`);
      alert('All sessions reset. Scan QR again to reconnect.');
      window.location.href = '/dashboard';
    } catch (err) {
      alert('Failed to reset sessions');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full animate-pulse">Loading settings...</div>;

  const settingsGroups = [
    {
      title: 'AI configuration',
      items: [
        { 
          icon: Zap, 
          label: 'Auto-Reply Mode', 
          description: 'AI automatically handles greetings and FAQs', 
          value: profile?.auto_reply_enabled ? 'Enabled' : 'Disabled', 
          active: profile?.auto_reply_enabled,
          onClick: toggleAutoReply
        },
        { icon: Monitor, label: 'Confidence Threshold', description: 'Minimum score for AI to reply autonomously', value: profile?.ai_confidence_threshold || '0.75', active: false },
        { icon: Globe, label: 'Primary Language', description: 'Default language for auto-responses', value: 'English (Auto-Detect)', active: false },
      ]
    },
    {
      title: 'system & Integrations',
      items: [
        { icon: Phone, label: 'Baileys Session', description: 'Manage linked WhatsApp Business account', value: 'Active', active: true },
        { icon: Database, label: 'Supabase Data', description: 'Lead storage and conversation persistence', value: 'Connected', active: true },
        { icon: Shield, label: 'Security & Auth', description: 'Manage employee access and session keys', value: 'Enabled', active: false },
      ]
    }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-12 py-6 font-outfit">
      <div className="space-y-2">
        <h1 className="text-4xl font-black">Preferences</h1>
        <p className="text-muted-foreground text-lg">Configure your AI agent behavior and business identity.</p>
      </div>

      <div className="space-y-10">
        {/* Business Profile Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-2">Business Profile</h3>
          <div className="bg-card border border-border rounded-[2rem] p-8 shadow-2xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Business Name</label>
                <input 
                  type="text" 
                  value={profile?.business_name || ''} 
                  onChange={(e) => setProfile({ ...profile, business_name: e.target.value })}
                  placeholder="e.g. VyavsayAssist"
                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Industry</label>
                <input 
                  type="text" 
                  value={profile?.industry || ''} 
                  onChange={(e) => setProfile({ ...profile, industry: e.target.value })}
                  placeholder="e.g. Solar Energy"
                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Services Offered (comma separated)</label>
              <textarea
                value={Array.isArray(profile?.services) ? profile.services.join(', ') : profile?.services || ''}
                onChange={(e) => setProfile({ ...profile, services: e.target.value.split(',').map((s: string) => s.trim()) })}
                placeholder="e.g. Solar Installation, Maintenance, Consultation"
                className="w-full bg-muted/30 border border-border rounded-2xl p-4 h-32 focus:ring-2 focus:ring-primary/50 outline-none transition-all resize-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Business Address</label>
                <input
                  type="text"
                  value={profile?.business_address || ''}
                  onChange={(e) => setProfile({ ...profile, business_address: e.target.value })}
                  placeholder="e.g. 123 MG Road, Pune, Maharashtra 411001"
                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Google Maps Link</label>
                <input
                  type="text"
                  value={profile?.google_maps_link || ''}
                  onChange={(e) => setProfile({ ...profile, google_maps_link: e.target.value })}
                  placeholder="e.g. https://maps.google.com/..."
                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    // Clean up services array — filter out empty strings
                    const cleanServices = Array.isArray(profile.services)
                      ? profile.services.filter((s: string) => s && s.trim())
                      : [];

                    await client.patch(`/users/${user?.id}`, {
                      business_name: profile.business_name || null,
                      industry: profile.industry || null,
                      services: cleanServices.length > 0 ? cleanServices : null,
                      business_address: profile.business_address || null,
                      google_maps_link: profile.google_maps_link || null,
                    });
                    alert('Profile updated! AI will now use these details.');
                  } catch (err) {
                    alert('Failed to save profile');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="bg-primary hover:bg-primary/90 text-white font-bold px-8 py-3 rounded-2xl transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Update Profile'}
              </button>
            </div>
          </div>
        </motion.div>

        {settingsGroups.map((group, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (i + 1) * 0.1 }}
            key={group.title} 
            className="space-y-4"
          >
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-2">{group.title}</h3>
            <div className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-2xl">
              {group.items.map((item, idx) => (
                <button 
                  key={item.label}
                  disabled={saving}
                  onClick={item.onClick}
                  className={`w-full flex items-center gap-6 p-8 text-left hover:bg-muted/30 transition-all group relative ${idx !== group.items.length - 1 ? 'border-b border-border' : ''} ${saving ? 'opacity-50' : ''}`}
                >
                  <div className={`p-4 rounded-2xl bg-muted/50 border border-border group-hover:border-primary/40 group-hover:bg-primary/5 transition-all`}>
                    <item.icon className={`w-6 h-6 ${item.active ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="text-lg font-semibold">{item.label}</h4>
                      {item.active && <span className="w-1.5 h-1.5 rounded-full bg-whatsapp shadow-[0_0_8px_rgba(37,211,102,0.8)]" />}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                  </div>
                  <div className="text-right flex items-center gap-4">
                    <span className="text-xs font-bold text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full uppercase tracking-widest">{item.value}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-all translate-x-0 group-hover:translate-x-1" />
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="bg-red-500/5 border border-red-500/20 rounded-[2rem] p-8 flex items-center justify-between shadow-sm">
        <div className="space-y-1">
          <h4 className="text-red-500 font-bold uppercase tracking-widest text-xs flex items-center gap-2"> Danger Zone <AlertCircle className="w-3.5 h-3.5" /></h4>
          <p className="text-sm text-red-500/70 font-medium">Terminate all active Baileys sessions and wipe local connection cache.</p>
        </div>
        <button 
          onClick={resetSessions}
          className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-6 py-3 rounded-2xl font-bold text-sm transition-all border border-red-500/20"
        >
          Reset All Sessions
        </button>
      </div>
    </div>
  );
};

export default Settings;
