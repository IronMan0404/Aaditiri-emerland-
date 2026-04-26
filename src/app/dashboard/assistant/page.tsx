'use client';

import { useMemo, useState, type ComponentType } from 'react';
import { Bot, CalendarClock, FileText, Send, Sparkles, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';

type AssistantMode = 'general' | 'booking' | 'report';
type ChatRole = 'user' | 'assistant';

interface ChatRow {
  id: string;
  role: ChatRole;
  content: string;
}

interface AssistantResponse {
  ok?: boolean;
  reply?: string;
  error?: string;
  model?: string;
}

type PromptIcon = ComponentType<{ size?: number; className?: string }>;

const QUICK_PROMPTS: Array<{ label: string; prompt: string; mode: AssistantMode; icon: PromptIcon }> = [
  {
    label: 'Booking Help',
    prompt: 'Help me create a booking request for clubhouse tomorrow evening.',
    mode: 'booking',
    icon: CalendarClock,
  },
  {
    label: 'Weekly Activity Report',
    prompt: 'Create a short weekly summary of community activity from available updates.',
    mode: 'report',
    icon: FileText,
  },
  {
    label: 'Issue Draft',
    prompt: 'Draft a clear maintenance issue report I can submit to admin.',
    mode: 'general',
    icon: Wrench,
  },
];

function inferMode(message: string): AssistantMode {
  const text = message.toLowerCase();
  if (/(book|booking|reserve|reservation|clubhouse|slot)/.test(text)) return 'booking';
  if (/(report|summary|summarize|activity|weekly|monthly)/.test(text)) return 'report';
  return 'general';
}

export default function AssistantPage() {
  const { profile, mounted } = useAuth();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [rows, setRows] = useState<ChatRow[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi! I am your free Community AI Assistant (local Llama via Ollama). I can help with booking drafts, activity reports, and issue-writeups.',
    },
  ]);

  const canSend = draft.trim().length > 0 && !sending;
  const displayName = mounted ? profile?.full_name ?? 'Resident' : 'Resident';

  async function sendMessage(input: string, forcedMode?: AssistantMode) {
    const message = input.trim();
    if (!message || sending) return;

    const mode = forcedMode ?? inferMode(message);
    const userRow: ChatRow = { id: `u-${Date.now()}`, role: 'user', content: message };
    const history = rows.slice(-8).map((row) => ({ role: row.role, content: row.content }));
    setRows((prev) => [...prev, userRow]);
    setDraft('');
    setSending(true);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, mode, history }),
      });
      const json = (await res.json().catch(() => ({}))) as AssistantResponse;

      if (!res.ok || !json.reply) {
        const errorMsg = json.error ?? `Assistant error (${res.status})`;
        toast.error(errorMsg);
        setRows((prev) => [
          ...prev,
          {
            id: `a-err-${Date.now()}`,
            role: 'assistant',
            content:
              `${errorMsg}\n\nIf Ollama is not running yet, start it with:\n` +
              '1) ollama serve\n2) ollama pull llama3.2:3b',
          },
        ]);
        return;
      }

      setModel(json.model ?? null);
      setRows((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: json.reply ?? '' }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      toast.error(msg);
      setRows((prev) => [
        ...prev,
        {
          id: `a-net-${Date.now()}`,
          role: 'assistant',
          content: `I could not reach the assistant API.\n\n${msg}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const assistantMeta = useMemo(() => {
    if (!model) return 'Free local AI via Ollama';
    return `Free local AI via Ollama (${model})`;
  }, [model]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] rounded-2xl p-5 text-white">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight">AI Community Assistant</h1>
            <p className="text-sm text-white/90 mt-1">
              Hi {displayName}. Ask for booking help, report drafts, or activity summaries.
            </p>
            <p className="text-xs text-white/75 mt-1" suppressHydrationWarning>
              {assistantMeta}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-3 shadow-sm">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Quick prompts</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {QUICK_PROMPTS.map(({ label, prompt, mode, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => void sendMessage(prompt, mode)}
              disabled={sending}
              className="text-left px-3 py-2 rounded-xl border border-gray-200 hover:border-[#1B5E20] hover:bg-green-50 transition disabled:opacity-60"
            >
              <div className="flex items-center gap-2">
                <Icon size={14} className="text-[#1B5E20]" />
                <span className="text-sm font-semibold text-gray-800">{label}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{prompt}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-3">
        <div className="h-[52vh] min-h-[340px] max-h-[620px] overflow-y-auto pr-1 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className={`flex ${row.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words text-sm ${
                  row.role === 'user'
                    ? 'bg-[#1B5E20] text-white'
                    : 'bg-gray-100 text-gray-800 border border-gray-200'
                }`}
              >
                {row.role === 'assistant' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">
                    <Bot size={12} />
                    Assistant
                  </span>
                )}
                <div>{row.content}</div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl px-3 py-2 text-sm bg-gray-100 text-gray-500 border border-gray-200">
                Thinking...
              </div>
            </div>
          )}
        </div>

        <div className="pt-3 mt-3 border-t border-gray-100 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask: 'Summarize this week', 'Help me draft a clubhouse booking', 'Write a maintenance report'..."
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(draft);
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-400">
              Shift+Enter for a new line. Enter to send.
            </p>
            <Button onClick={() => void sendMessage(draft)} disabled={!canSend} loading={sending}>
              <Send size={14} />
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

