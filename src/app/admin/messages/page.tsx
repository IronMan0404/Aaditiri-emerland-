'use client';
import { useEffect, useState } from 'react';
import { Bot, Send, Trash2, Users, MessageSquare, Info, MessageCircle, CheckCircle2, XCircle, CircleSlash } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type { BotMessage } from '@/types';

interface WhatsAppStats {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

interface SentMessageRow extends BotMessage {
  recipient_count: number;
  read_count: number;
  whatsapp: WhatsAppStats;
}

export default function AdminMessagesPage() {
  const { profile } = useAuth();
  const supabase = createClient();

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [history, setHistory] = useState<SentMessageRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  async function loadRecipientCount() {
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_approved', true)
      .eq('is_bot', false);
    setRecipientCount(count ?? 0);
  }

  async function loadHistory() {
    setLoadingHistory(true);
    const { data: messages, error } = await supabase
      .from('bot_messages')
      .select('id, body, authored_by, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      toast.error(error.message);
      setLoadingHistory(false);
      return;
    }
    if (!messages || messages.length === 0) {
      setHistory([]);
      setLoadingHistory(false);
      return;
    }

    const ids = messages.map((m) => m.id);
    const { data: recipients } = await supabase
      .from('bot_message_recipients')
      .select('message_id, read_at, whatsapp_status')
      .in('message_id', ids);

    const stats = new Map<string, { total: number; read: number; wa: WhatsAppStats }>();
    (recipients ?? []).forEach((r) => {
      const s = stats.get(r.message_id) ?? { total: 0, read: 0, wa: { sent: 0, failed: 0, skipped: 0, pending: 0 } };
      s.total += 1;
      if (r.read_at) s.read += 1;
      const status = (r as { whatsapp_status?: string | null }).whatsapp_status;
      if (status === 'sent' || status === 'delivered' || status === 'read') s.wa.sent += 1;
      else if (status === 'failed') s.wa.failed += 1;
      else if (status && status.startsWith('skipped_')) s.wa.skipped += 1;
      else if (status === 'pending') s.wa.pending += 1;
      stats.set(r.message_id, s);
    });

    setHistory(
      messages.map((m) => {
        const s = stats.get(m.id);
        return {
          ...m,
          recipient_count: s?.total ?? 0,
          read_count: s?.read ?? 0,
          whatsapp: s?.wa ?? { sent: 0, failed: 0, skipped: 0, pending: 0 },
        };
      }),
    );
    setLoadingHistory(false);
  }

  useEffect(() => {
    loadRecipientCount();
    loadHistory();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) {
      toast.error('Type a message first');
      return;
    }
    if (!profile) {
      toast.error('Not signed in');
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/admin/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        recipientCount?: number;
        whatsapp?: { sent: number; failed: number; skipped: number; disabled: boolean };
      };
      if (!res.ok) {
        toast.error(payload.error ?? `Failed (HTTP ${res.status})`);
        return;
      }

      const n = payload.recipientCount ?? 0;
      const wa = payload.whatsapp;
      const waText = !wa
        ? ''
        : wa.disabled
          ? ' — WhatsApp not configured'
          : ` — WA: ${wa.sent} sent, ${wa.failed} failed, ${wa.skipped} skipped`;
      toast.success(`Sent to ${n} resident${n === 1 ? '' : 's'}${waText}`);
      setBody('');
      loadHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this message for everyone? This cannot be undone.')) return;
    const { error } = await supabase.from('bot_messages').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Message deleted');
    loadHistory();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-[#1B5E20] rounded-xl flex items-center justify-center">
          <Bot size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Send Bot Message</h1>
          <p className="text-sm text-gray-500">Delivered as <strong>Aaditri Bot</strong> to every approved member (admins included, bot excluded)</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5">
        <Info size={16} className="text-blue-500 shrink-0" />
        <p className="text-xs text-blue-700">
          Recipients see this message in their personal inbox at <strong>Messages</strong>. They cannot reply.
        </p>
      </div>

      <form onSubmit={handleSend} className="bg-white rounded-2xl shadow-sm p-4 mb-6">
        <Textarea
          label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="e.g. Water supply will be off Sunday 10am–1pm for tank cleaning."
          maxLength={2000}
        />
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} />
            {recipientCount === null ? 'Counting residents…' : `${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`}
          </span>
          <span suppressHydrationWarning>{body.trim().length}/2000</span>
        </div>
        <div className="flex justify-end mt-3">
          <Button type="submit" loading={sending} disabled={!body.trim()}>
            <Send size={16} />
            Send to all residents
          </Button>
        </div>
      </form>

      <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Recently sent</h2>

      {loadingHistory ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <MessageSquare size={32} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No messages sent yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((m) => {
            const total = m.recipient_count;
            const read = m.read_count;
            const pct = total > 0 ? Math.round((read / total) * 100) : 0;
            const wa = m.whatsapp;
            const waTotal = wa.sent + wa.failed + wa.skipped + wa.pending;
            const waConfigured = waTotal === 0 || wa.skipped < total;
            return (
              <div key={m.id} className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-[#1B5E20]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{m.body}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-400">
                      <span suppressHydrationWarning>{format(new Date(m.created_at), 'dd MMM yyyy, HH:mm')}</span>
                      <span>·</span>
                      <span>{read}/{total} read ({pct}%)</span>
                    </div>
                    {waTotal > 0 && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-gray-500">
                          <MessageCircle size={12} /> WhatsApp
                        </span>
                        {!waConfigured ? (
                          <span className="inline-flex items-center gap-1 text-gray-400" title="MSG91 credentials not configured; in-app delivery only">
                            <CircleSlash size={12} /> not configured
                          </span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1 text-green-600" title="Accepted by MSG91">
                              <CheckCircle2 size={12} /> {wa.sent}
                            </span>
                            {wa.failed > 0 && (
                              <span className="inline-flex items-center gap-1 text-red-600" title="Provider rejected or network error">
                                <XCircle size={12} /> {wa.failed}
                              </span>
                            )}
                            {wa.skipped > 0 && (
                              <span className="inline-flex items-center gap-1 text-amber-600" title="No phone, opted out, or disabled per recipient">
                                <CircleSlash size={12} /> {wa.skipped}
                              </span>
                            )}
                            {wa.pending > 0 && (
                              <span className="text-gray-400" title="Still processing">pending {wa.pending}</span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    aria-label="Delete message"
                    className="text-gray-300 hover:text-red-500 transition-colors mt-0.5"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
