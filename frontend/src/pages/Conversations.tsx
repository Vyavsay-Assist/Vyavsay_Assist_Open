import React, { useState, useEffect, useRef } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  Search,
  Send,
  Bot,
  Hash,
  MessageSquare,
  Pause,
  Play,
  ArrowLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const PASTEL_COLORS = [
  { bg: 'bg-pastel-sage', text: 'text-soft-sage' },
  { bg: 'bg-pastel-rose', text: 'text-soft-rose' },
  { bg: 'bg-pastel-honey', text: 'text-soft-honey' },
  { bg: 'bg-pastel-sky', text: 'text-soft-sky' },
  { bg: 'bg-pastel-lavender', text: 'text-soft-lavender' },
  { bg: 'bg-pastel-mint', text: 'text-soft-mint' },
];

function getAvatarColor(index: number) {
  return PASTEL_COLORS[index % PASTEL_COLORS.length];
}

const Conversations: React.FC = () => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [showChat, setShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user]);

  useEffect(() => {
    if (!selectedConvo) return;
    fetchMessages(selectedConvo.id);

    const interval = setInterval(() => {
      fetchMessages(selectedConvo.id);
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedConvo]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const res = await client.get('/conversations');
      setConversations(res.data.conversations || []);
    } catch (err) {
      console.error('Failed to fetch conversations', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (id: string) => {
    try {
      const res = await client.get(`/conversations/${id}/messages`);
      setMessages(res.data.messages || []);
    } catch (err) {
      console.error('Failed to fetch messages', err);
    }
  };

  const togglePause = async (id: string, currentStatus: boolean) => {
    try {
      await client.patch(`/conversations/${id}`, { ai_paused: !currentStatus });
      setSelectedConvo({ ...selectedConvo, ai_paused: !currentStatus });
      setConversations(conversations.map(c => c.id === id ? { ...c, ai_paused: !currentStatus } : c));
    } catch (err) {
      console.error('Failed to toggle pause');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedConvo) return;

    try {
      await client.post(`/conversations/${selectedConvo.id}/messages`, {
        content: replyText,
      });

      const newMessage = {
        id: Math.random().toString(),
        sender: 'business_owner',
        content: replyText,
        created_at: new Date().toISOString()
      };

      setMessages([...messages, newMessage]);
      setReplyText('');
    } catch (err) {
      console.error('Failed to send message');
    }
  };

  const handleSelectConvo = (convo: any) => {
    setSelectedConvo(convo);
    if (isMobile) setShowChat(true);
  };

  const handleBack = () => {
    setShowChat(false);
  };

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-12 h-12 border-4 border-cream-200 border-t-soft-honey rounded-full animate-spin" />
        <p className="text-ink-50 font-medium animate-pulse">Loading chats...</p>
      </div>
    );
  }

  /* ---------- Conversation List ---------- */
  const conversationList = (
    <div className={cn(
      "flex flex-col gap-4",
      isMobile ? "w-full h-full" : "w-96"
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-2">
        <h1 className="font-display text-[22px] font-bold text-ink-400">Chats</h1>
        <span className="bg-pastel-lavender text-soft-lavender text-xs font-bold px-2.5 py-0.5 rounded-full">
          {conversations.length}
        </span>
      </div>

      {/* Search */}
      <div className="relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-50 group-focus-within:text-ink-200 transition-colors" />
        <input
          type="text"
          placeholder="Search conversations..."
          className="w-full bg-cream-200/60 rounded-2xl h-11 pl-11 pr-4 text-sm text-ink-300 placeholder:text-ink-50 focus:outline-none focus:ring-2 focus:ring-pastel-lavender transition-all"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
        {conversations.map((convo, idx) => {
          const avatar = getAvatarColor(idx);
          return (
            <button
              key={convo.id}
              onClick={() => handleSelectConvo(convo)}
              className={cn(
                "w-full text-left p-3.5 rounded-2xl transition-all duration-200 relative",
                selectedConvo?.id === convo.id
                  ? "bg-pastel-peach/30"
                  : "hover:bg-cream-100"
              )}
            >
              {selectedConvo?.id === convo.id && (
                <motion.div
                  layoutId="active-chat-indicator"
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-soft-peach"
                />
              )}
              <div className="flex gap-3">
                {/* Avatar */}
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center font-display font-bold text-lg shrink-0",
                  avatar.bg, avatar.text
                )}>
                  {convo.customer_name?.[0] || '?'}
                </div>

                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-ink-300 truncate">
                      {convo.customer_name || 'Unknown'}
                    </h3>
                    <span className="text-[11px] text-ink-50">
                      {new Date(convo.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-50 truncate">
                    {convo.summary || 'Detecting intent...'}
                  </p>
                  <div className="flex items-center justify-between pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide",
                        convo.wb_leads?.[0]?.score === 'high'
                          ? "bg-pastel-rose text-soft-rose"
                          : convo.wb_leads?.[0]?.score === 'medium'
                            ? "bg-pastel-honey text-soft-honey"
                            : "bg-pastel-sky text-soft-sky"
                      )}>
                        {convo.wb_leads?.[0]?.score || 'new'}
                      </span>
                      {convo.ai_paused && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-pastel-honey text-soft-honey flex items-center gap-0.5">
                          <Pause className="w-2.5 h-2.5" /> Paused
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-ink-50 flex items-center gap-0.5">
                      <Hash className="w-2.5 h-2.5" /> {convo.customer_jid.split('@')[0]}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ---------- Chat View ---------- */
  const selectedIndex = conversations.findIndex(c => c.id === selectedConvo?.id);
  const chatAvatar = selectedIndex >= 0 ? getAvatarColor(selectedIndex) : PASTEL_COLORS[0];

  const chatView = (
    <div className={cn(
      "flex flex-col overflow-hidden bg-cream-50 rounded-2xl border border-cream-200",
      isMobile ? "w-full h-full" : "flex-1"
    )}>
      <AnimatePresence mode="wait">
        {selectedConvo ? (
          <motion.div
            key="chat-active"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col h-full"
          >
            {/* Chat Header */}
            <div className="px-5 py-4 border-b border-cream-200 flex items-center justify-between bg-cream-50">
              <div className="flex items-center gap-3">
                {isMobile && (
                  <button
                    onClick={handleBack}
                    className="p-2 -ml-2 rounded-xl hover:bg-cream-100 transition-colors text-ink-200"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm",
                  chatAvatar.bg, chatAvatar.text
                )}>
                  {selectedConvo.customer_name?.[0] || '?'}
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-ink-300 leading-tight">
                    {selectedConvo.customer_name}
                  </h2>
                  <p className="text-[12px] text-ink-50 flex items-center gap-1.5">
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      selectedConvo.ai_paused ? "bg-soft-honey" : "bg-success"
                    )} />
                    {selectedConvo.ai_paused ? 'AI Paused' : 'AI Active'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => togglePause(selectedConvo.id, selectedConvo.ai_paused)}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all",
                  selectedConvo.ai_paused
                    ? "bg-pastel-honey/60 text-soft-honey hover:bg-pastel-honey"
                    : "bg-pastel-sage/60 text-soft-sage hover:bg-pastel-sage"
                )}
              >
                {selectedConvo.ai_paused
                  ? <><Play className="w-3.5 h-3.5" /> Resume AI</>
                  : <><Pause className="w-3.5 h-3.5" /> Pause AI</>
                }
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col",
                    msg.sender === 'customer' ? "items-start" : "items-end"
                  )}
                >
                  <div className={cn(
                    "max-w-[75%] p-3.5 text-sm leading-relaxed text-ink-300",
                    msg.sender === 'customer'
                      ? "bg-cream-100 rounded-2xl rounded-tl-sm"
                      : "bg-pastel-sage/50 rounded-2xl rounded-tr-sm"
                  )}>
                    {msg.content}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 px-1">
                    {(msg.sender === 'ai' || msg.sender === 'business_owner') && (
                      <span className={cn(
                        "text-[10px] flex items-center gap-1",
                        msg.sender === 'ai' ? "text-soft-sage" : "text-ink-50"
                      )}>
                        {msg.sender === 'ai' ? <><Bot className="w-3 h-3" /> AI Reply</> : "You"}
                      </span>
                    )}
                    <span className="text-[10px] text-ink-50">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose Bar */}
            <form
              onSubmit={handleSendMessage}
              className="bg-cream-50 border-t border-cream-200 p-3 flex gap-2"
            >
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-cream-100 rounded-2xl px-4 py-3 text-sm text-ink-300 placeholder:text-ink-50 focus:outline-none focus:ring-2 focus:ring-pastel-lavender/60 transition-all"
              />
              <button
                type="submit"
                disabled={!replyText.trim()}
                className="w-11 h-11 bg-ink-300 rounded-full flex items-center justify-center text-cream-50 hover:bg-ink-400 transition-colors disabled:opacity-40 shrink-0"
              >
                <Send className="w-4.5 h-4.5" />
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="chat-empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-5"
          >
            <div className="w-24 h-24 bg-pastel-lilac rounded-full flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-soft-lavender" />
            </div>
            <div className="space-y-2">
              <h3 className="font-display text-lg font-bold text-ink-300">Select a conversation</h3>
              <p className="text-sm text-ink-50">Pick a chat from the left to start.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  /* ---------- Render ---------- */
  if (isMobile) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        {showChat && selectedConvo ? chatView : conversationList}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex gap-4 overflow-hidden">
      {conversationList}
      {chatView}
    </div>
  );
};

export default Conversations;
