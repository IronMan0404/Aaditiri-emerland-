'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Bot,
  CalendarClock,
  FileText,
  Send,
  Sparkles,
  Wrench,
  Wallet,
  Megaphone,
  KeyRound,
  PhoneCall,
  CalendarDays,
  Lightbulb,
} from 'lucide-react';
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
  provider?: string;
}

type PromptIcon = ComponentType<{ size?: number; className?: string }>;

// Expanded set of quick prompts (was 3, now 9). Ordered by everyday utility:
// the first three are the highest-traffic flows in the app (booking, funds,
// issues), the rest cover navigation/discovery prompts that the assistant can
// handle from general knowledge of the app.
const QUICK_PROMPTS: Array<{ label: string; prompt: string; mode: AssistantMode; icon: PromptIcon }> = [
  {
    label: 'Booking Help',
    prompt: 'Help me create a booking request for clubhouse tomorrow evening.',
    mode: 'booking',
    icon: CalendarClock,
  },
  {
    label: 'My Funds',
    prompt: 'Explain how community funds work and what I should check before contributing.',
    mode: 'general',
    icon: Wallet,
  },
  {
    label: 'Raise Issue',
    prompt: 'Draft a clear maintenance issue report I can submit to admin.',
    mode: 'general',
    icon: Wrench,
  },
  {
    label: 'Upcoming Events',
    prompt: 'What kind of community events should I look out for and how do I RSVP?',
    mode: 'general',
    icon: CalendarDays,
  },
  {
    label: 'Announcement Draft',
    prompt: 'Help me draft a polite announcement to share with the residents.',
    mode: 'general',
    icon: Megaphone,
  },
  {
    label: 'Clubhouse Pass',
    prompt: 'Explain how to mint a clubhouse guest pass and how the QR check-in works.',
    mode: 'general',
    icon: KeyRound,
  },
  {
    label: 'Phonebook',
    prompt: 'Help me phrase a friendly post for the community phonebook to share a useful contact.',
    mode: 'general',
    icon: PhoneCall,
  },
  {
    label: 'Weekly Report',
    prompt: 'Create a short weekly summary of community activity from available updates.',
    mode: 'report',
    icon: FileText,
  },
  {
    label: 'Tips & Tricks',
    prompt: 'Give me 5 quick tips for getting the most out of this Aaditri Emerland community app.',
    mode: 'general',
    icon: Lightbulb,
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
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  // Monotonic counter for chat row ids. Using Date.now() in render
  // (or even in an event handler closed over the component body) trips
  // React Compiler's purity rule. A ref-backed counter is pure and
  // produces stable, ordered ids.
  const idCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${++idCounter.current}`;
  const [rows, setRows] = useState<ChatRow[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi! I am your Aaditri Community Assistant. Tap a quick prompt below or type your own question.',
    },
  ]);

  // Auto-scroll the chat area to the latest message whenever rows change.
  // We anchor on a sentinel div at the bottom of the messages list. This is
  // standard chat-UI behavior; without it the new "thinking..." or assistant
  // reply lands below the visible area on long conversations.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows, sending]);

  const canSend = draft.trim().length > 0 && !sending;
  const displayName = mounted ? profile?.full_name?.split(' ')[0] ?? 'Resident' : 'Resident';

  async function sendMessage(input: string, forcedMode?: AssistantMode) {
    const message = input.trim();
    if (!message || sending) return;

    const mode = forcedMode ?? inferMode(message);
    const userRow: ChatRow = { id: nextId('u'), role: 'user', content: message };
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
        const isUnconfigured = res.status === 503;
        const helper = isUnconfigured
          ? '\n\nAdmin: set AI_PROVIDER=groq and AI_API_KEY in your env to enable the assistant. Free Groq API keys: https://console.groq.com/keys'
          : '';
        toast.error(errorMsg);
        setRows((prev) => [
          ...prev,
          {
            id: nextId('a-err'),
            role: 'assistant',
            content: `${errorMsg}${helper}`,
          },
        ]);
        return;
      }

      setProvider(json.provider ?? null);
      setModel(json.model ?? null);
      setRows((prev) => [
        ...prev,
        { id: nextId('a'), role: 'assistant', content: json.reply ?? '' },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      toast.error(msg);
      setRows((prev) => [
        ...prev,
        {
          id: nextId('a-net'),
          role: 'assistant',
          content: `I could not reach the assistant API.\n\n${msg}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const assistantMeta = useMemo(() => {
    if (!provider || !model) return 'Powered by hosted AI · graceful fallback when not configured';
    return `${provider} · ${model}`;
  }, [provider, model]);

  // The page is laid out as a single-screen chat experience: a tight header,
  // a horizontally-scrolling quick-prompt strip, and a chat area that fills
  // the remaining viewport. The `dvh` unit is critical on mobile because it
  // accounts for the browser's collapsing address bar (`vh` does not).
  //
  // The numbers in `calc(...)` reserve room for the dashboard's TopBar (~52px
  // on mobile), the GlobalSearch row (~52px), the assistant header card
  // (~88px including margins), the quick-prompt strip (~62px), and the bottom
  // mobile nav (~72px). On desktop we override with a generous max-height so
  // the chat doesn't dominate big monitors.
  return (
    <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col gap-3 h-[calc(100dvh-72px)] md:h-auto md:py-6">
      {/* Compact welcome card. Designed to take ~80px so it doesn't crowd
          the chat. The provider/model meta is hidden on phones because the
          screen is precious. */}
      <div className="bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] rounded-2xl px-4 py-3 text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold leading-tight truncate">
              Hi {displayName}, ask me anything
            </h1>
            <p className="hidden sm:block text-xs text-white/80 mt-0.5" suppressHydrationWarning>
              {assistantMeta}
            </p>
          </div>
        </div>
      </div>

      {/* Horizontal-scroll quick prompts. On mobile this is one row that
          scrolls sideways (much more screen-efficient than a 3-column grid
          stacking 3 rows tall). The right-edge gradient hints there's more
          to swipe. On desktop we expand to a wrapping grid. */}
      <div className="shrink-0">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Quick prompts</p>
          <p className="text-[10px] text-gray-400 sm:hidden">Swipe →</p>
        </div>
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
            {QUICK_PROMPTS.map(({ label, prompt, mode, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => void sendMessage(prompt, mode)}
                disabled={sending}
                className="shrink-0 sm:shrink flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:border-[#1B5E20] hover:bg-green-50 hover:text-[#1B5E20] transition disabled:opacity-60 whitespace-nowrap"
              >
                <Icon size={13} className="text-[#1B5E20]" />
                {label}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-gray-50 sm:hidden" />
        </div>
      </div>

      {/* Chat area: flex-1 fills remaining viewport. The internal scroll
          area shows messages; the input row stays anchored to the bottom of
          the card without needing the page to scroll. */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
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
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        <div className="p-3 border-t border-gray-100 space-y-2 shrink-0">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask anything about the community app..."
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(draft);
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-gray-400 hidden sm:block">
              Shift+Enter for a new line · Enter to send
            </p>
            <Button onClick={() => void sendMessage(draft)} disabled={!canSend} loading={sending} className="ml-auto">
              <Send size={14} />
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
