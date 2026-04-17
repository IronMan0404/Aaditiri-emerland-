'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bot, MessageSquare, CheckCheck } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Button from '@/components/ui/Button';
import type { BotMessage } from '@/types';

interface InboxRow {
  id: string;
  message_id: string;
  read_at: string | null;
  created_at: string;
  bot_messages: BotMessage | null;
}

export default function MessagesPage() {
  const { profile, mounted } = useAuth();
  const supabase = createClient();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  async function load() {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('bot_message_recipients')
      .select('id, message_id, read_at, created_at, bot_messages(id, body, authored_by, created_at)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as InboxRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profile) load();
  }, [profile?.id]);

  const unreadCount = useMemo(() => rows.filter((r) => !r.read_at).length, [rows]);

  async function markOne(rowId: string) {
    const optimisticAt = new Date().toISOString();
    setRows((prev) => prev.map((r) => (r.id === rowId && !r.read_at ? { ...r, read_at: optimisticAt } : r)));
    const { error } = await supabase
      .from('bot_message_recipients')
      .update({ read_at: optimisticAt })
      .eq('id', rowId)
      .is('read_at', null);
    if (error) {
      toast.error(error.message);
      load();
    }
  }

  async function markAll() {
    if (unreadCount === 0) return;
    setMarking(true);
    const now = new Date().toISOString();
    const ids = rows.filter((r) => !r.read_at).map((r) => r.id);
    setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: now })));
    const { error } = await supabase
      .from('bot_message_recipients')
      .update({ read_at: now })
      .in('id', ids);
    setMarking(false);
    if (error) {
      toast.error(error.message);
      load();
      return;
    }
    toast.success('All caught up');
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-[#1B5E20] rounded-xl flex items-center justify-center shrink-0">
            <MessageSquare size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">Messages</h1>
            <p className="text-sm text-gray-500" suppressHydrationWarning>
              {mounted ? (unreadCount > 0 ? `${unreadCount} unread` : 'All caught up') : ' '}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAll} loading={marking}>
            <CheckCheck size={14} />
            Mark all read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <MessageSquare size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No messages yet</p>
          <p className="text-xs mt-1">When admin sends a community message, it will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const msg = r.bot_messages;
            const unread = !r.read_at;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => unread && markOne(r.id)}
                className={`w-full text-left bg-white rounded-xl p-4 shadow-sm transition-all ${
                  unread ? 'border-l-4 border-[#1B5E20] ring-1 ring-[#1B5E20]/10' : 'border-l-4 border-transparent opacity-90'
                } hover:shadow-md`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${unread ? 'bg-[#1B5E20] text-white' : 'bg-green-50 text-[#1B5E20]'}`}>
                    <Bot size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-gray-900">Aaditri Bot</span>
                      {unread && <span className="text-[10px] font-bold uppercase tracking-wide bg-[#1B5E20] text-white px-1.5 py-0.5 rounded">New</span>}
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                      {msg?.body ?? '(message unavailable)'}
                    </p>
                    <p className="text-xs text-gray-400 mt-2" suppressHydrationWarning>
                      {format(new Date(r.created_at), 'dd MMM yyyy, HH:mm')}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
