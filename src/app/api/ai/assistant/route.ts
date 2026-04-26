import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { consume, getClientIp } from '@/lib/rate-limit';
import {
  callAiWithTools,
  getAiProviderInfo,
  type AiToolCall,
  type AiToolMessage,
} from '@/lib/ai';
import {
  TOOL_DESCRIPTORS,
  isReadTool,
  isWriteTool,
  runReadTool,
  validateBookingArgs,
  validateIssueArgs,
} from '@/lib/ai/tools';
import { mintPendingActionToken, type PendingAction } from '@/lib/ai/pending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AssistantMode = 'general' | 'booking' | 'report';
type ChatRole = 'user' | 'assistant';

interface ChatTurn {
  role: ChatRole;
  content: string;
}

interface AssistantRequest {
  message?: string;
  mode?: AssistantMode;
  history?: ChatTurn[];
}

interface AssistantContext {
  resident: {
    name: string;
    flat: string | null;
    residentType: string | null;
  };
  announcements: Array<{ title: string; content: string; created_at: string }>;
  broadcasts: Array<{ title: string; message: string; created_at: string }>;
  events: Array<{ title: string; date: string; time: string; location: string }>;
  myBookings: Array<{ facility: string; date: string; time_slot: string; status: string }>;
  myIssues: Array<{ title: string; status: string; priority: string; created_at: string }>;
}

const REQUEST_LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_MESSAGE_CHARS = 2000;
// History sent to the model each turn. Lowered from 8 to 4 because each
// historical turn was costing ~150-300 tokens and pushing us over Groq's
// free-tier 6000 TPM threshold during a normal back-and-forth.
const MAX_HISTORY_TURNS = 4;
// Cap how many tool-call rounds the model can do per turn. Each round is a
// network roundtrip to Groq + a DB query; without a cap a misbehaving model
// could loop indefinitely. 3 is enough for: list_facilities ->
// create_booking -> final reply.
const MAX_TOOL_ROUNDS = 3;

function truncate(value: string | null | undefined, limit: number): string {
  const clean = (value ?? '').trim();
  if (!clean) return '';
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}...`;
}

function sanitizeHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((row): row is ChatTurn => {
      if (!row || typeof row !== 'object') return false;
      const role = (row as { role?: unknown }).role;
      const content = (row as { content?: unknown }).content;
      return (role === 'user' || role === 'assistant') && typeof content === 'string';
    })
    .map((row) => ({
      role: row.role,
      content: truncate(row.content, MAX_MESSAGE_CHARS),
    }))
    .filter((row) => row.content.length > 0)
    .slice(-MAX_HISTORY_TURNS);
}

// Mode-scoped tool surfaces. Sending the full 6-tool list every turn pushes
// the prompt-side token count high enough that Groq's 6000 TPM free tier
// throttles us on normal use. Tools the model can't usefully call in a
// given mode are dropped before we hit the wire.
function toolNamesForMode(mode: AssistantMode): string[] {
  if (mode === 'booking') return ['list_facilities', 'list_my_subscription', 'list_my_bookings', 'create_booking'];
  if (mode === 'report') return ['list_my_bookings', 'list_my_issues'];
  return ['list_my_bookings', 'list_my_issues', 'create_booking', 'create_issue'];
}

function modeInstructions(mode: AssistantMode): string {
  if (mode === 'booking') {
    return [
      'Booking mode. Call list_facilities first, then create_booking with a valid name.',
      'Resolve "tomorrow" / "next Sunday" to YYYY-MM-DD against today.',
      'If facility/time/date is unclear, ask ONE concise question.',
    ].join(' ');
  }
  if (mode === 'report') {
    return 'Report mode. Use the context block. Return Summary, Action Items, Suggested Message. No write tools.';
  }
  return 'General mode. Call create_booking / create_issue ONLY if the user clearly asks to book or raise an issue. Otherwise reply concisely without tool calls.';
}

// Compact context list — title only, no created_at, hard cap on count and
// per-item character length. Keeps the system prompt under ~600 tokens.
function compact(items: Array<{ label: string; max?: number }>, n = 4): string {
  return items
    .slice(0, n)
    .map((i) => `"${(i.label ?? '').slice(0, i.max ?? 60)}"`)
    .join(', ') || 'none';
}

function buildSystemPrompt(ctx: AssistantContext, mode: AssistantMode): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  const flatBit = ctx.resident.flat ? ` (Flat ${ctx.resident.flat})` : '';
  return [
    `Aaditri Community Assistant. Today is ${todayIso}. User: ${ctx.resident.name}${flatBit}.`,
    'Rules: read tools run server-side. create_booking and create_issue ONLY draft — the user must tap Confirm. Never claim a write was submitted yourself. No update/delete tools exist. Use only provided context for facts; otherwise ask ONE follow-up.',
    modeInstructions(mode),
    `Announcements: ${compact(ctx.announcements.map((a) => ({ label: a.title })))}`,
    `Broadcasts: ${compact(ctx.broadcasts.map((b) => ({ label: b.title })))}`,
    `Upcoming events: ${compact(ctx.events.map((e) => ({ label: `${e.title} on ${e.date}` })))}`,
    `My bookings: ${compact(ctx.myBookings.map((b) => ({ label: `${b.facility} ${b.date} ${b.time_slot} [${b.status}]` })), 5)}`,
    `My issues: ${compact(ctx.myIssues.map((i) => ({ label: `${i.title} [${i.status}]` })), 5)}`,
  ].join('\n');
}

async function buildContext(userId: string): Promise<AssistantContext | null> {
  const supabase = await createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  // Limits here mirror the compact() caps in buildSystemPrompt(): we only
  // display 4-5 entries each, so fetching more is just wasted bandwidth and
  // wasted prompt tokens if anyone forgets to cap downstream.
  const [{ data: profile }, { data: announcements }, { data: broadcasts }, { data: events }, { data: myBookings }, { data: myIssues }] =
    await Promise.all([
      supabase.from('profiles').select('full_name, flat_number, resident_type').eq('id', userId).maybeSingle(),
      supabase.from('announcements').select('title, content, created_at').order('created_at', { ascending: false }).limit(4),
      supabase.from('broadcasts').select('title, message, created_at').order('created_at', { ascending: false }).limit(4),
      supabase.from('events').select('title, date, time, location').gte('date', today).order('date', { ascending: true }).limit(4),
      supabase
        .from('bookings')
        .select('facility, date, time_slot, status')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .limit(5),
      supabase
        .from('issues')
        .select('title, status, priority, created_at')
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

  if (!profile) return null;

  return {
    resident: {
      name: profile.full_name ?? 'Resident',
      flat: profile.flat_number ?? null,
      residentType: profile.resident_type ?? null,
    },
    announcements: (announcements ?? []) as AssistantContext['announcements'],
    broadcasts: (broadcasts ?? []) as AssistantContext['broadcasts'],
    events: (events ?? []) as AssistantContext['events'],
    myBookings: (myBookings ?? []) as AssistantContext['myBookings'],
    myIssues: (myIssues ?? []) as AssistantContext['myIssues'],
  };
}

export async function GET() {
  const info = getAiProviderInfo();
  return NextResponse.json({
    ok: true,
    provider: info.provider,
    model: info.model,
    configured: info.configured,
    note: info.configured
      ? `AI assistant is live (${info.provider} / ${info.model}). Tool-calling enabled.`
      : 'AI assistant is not configured. Set AI_PROVIDER and AI_API_KEY in env to enable.',
  });
}

interface PendingActionEnvelope {
  token: string;
  kind: PendingAction['kind'];
  summary: string;
  args: PendingAction['args'];
}

function parseToolArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'invalid JSON arguments' };
  }
}

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const ip = getClientIp(req);
  const limiter = consume(`ai-assistant:${user.id}:${ip}`, REQUEST_LIMIT, WINDOW_MS);
  if (!limiter.allowed) {
    return NextResponse.json(
      {
        error: 'Too many assistant requests. Please wait and retry.',
        retry_after_ms: limiter.retryAfterMs,
      },
      { status: 429 },
    );
  }

  let body: AssistantRequest;
  try {
    body = (await req.json()) as AssistantRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = truncate(body.message, MAX_MESSAGE_CHARS);
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const mode: AssistantMode =
    body.mode === 'booking' || body.mode === 'report' || body.mode === 'general'
      ? body.mode
      : 'general';

  const history = sanitizeHistory(body.history);
  const context = await buildContext(user.id);
  if (!context) {
    return NextResponse.json({ error: 'Could not load community context.' }, { status: 500 });
  }

  // Seed the conversation with the system prompt + sanitized history + the
  // current user turn. We then run an iterative tool-call loop:
  //   1. Send to model.
  //   2. If it returned tool_calls, run the read tools server-side and
  //      mint pending tokens for write tools, then append the tool results
  //      and loop back.
  //   3. If it returned plain content, stop.
  //   4. If we hit MAX_TOOL_ROUNDS, force one final pass with tool_choice=none.
  const messages: AiToolMessage[] = [
    { role: 'system', content: buildSystemPrompt(context, mode) },
    ...history.map((row) => ({ role: row.role, content: row.content })),
    { role: 'user', content: message },
  ];

  const pendingActions: PendingActionEnvelope[] = [];
  let finalContent = '';
  let provider = '';
  let model = '';

  // Filter the global tool catalog down to the ones useful in this mode.
  // This trims hundreds of prompt tokens per turn, which keeps us inside
  // Groq's free-tier 6000 TPM ceiling for casual use.
  const allowed = new Set(toolNamesForMode(mode));
  const scopedTools = TOOL_DESCRIPTORS.filter((t) => allowed.has(t.function.name));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;
    const result = await callAiWithTools(messages, {
      tools: scopedTools,
      tool_choice: isLastRound ? 'none' : 'auto',
    });
    if (!result.ok) {
      // Provider rate-limit (Groq free tier: 6000 tokens/min). Surface a
      // friendlier message than Groq's raw error string so the user isn't
      // staring at "org_01kq...service tier on_demand on tokens per minute".
      const isRateLimit = result.status === 429 || /rate limit/i.test(result.error);
      const error = isRateLimit
        ? 'The AI provider is busy right now (free-tier rate limit). Please wait ~30 seconds and try again, or ask the admin to upgrade the AI plan.'
        : result.error;
      return NextResponse.json(
        { error, provider: result.provider, model: result.model },
        { status: result.status },
      );
    }
    provider = result.provider;
    model = result.model;

    if (!result.tool_calls || result.tool_calls.length === 0) {
      finalContent = result.content;
      break;
    }

    // Append the assistant turn (with tool_calls) so the model can see its
    // own previous request alongside our tool results.
    messages.push({
      role: 'assistant',
      content: result.content || '',
      tool_calls: result.tool_calls,
    });

    for (const call of result.tool_calls) {
      const out = await dispatchToolCall(call, user.id, supabase, pendingActions);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(out),
      });
    }
  }

  if (!finalContent) {
    finalContent =
      pendingActions.length > 0
        ? 'Drafted the action below. Tap **Confirm** to submit.'
        : 'I am here to help — could you rephrase that?';
  }

  return NextResponse.json({
    ok: true,
    provider,
    model,
    reply: finalContent,
    pending_actions: pendingActions,
    context_counts: {
      announcements: context.announcements.length,
      broadcasts: context.broadcasts.length,
      events: context.events.length,
      my_bookings: context.myBookings.length,
      my_issues: context.myIssues.length,
    },
  });
}

async function dispatchToolCall(
  call: AiToolCall,
  userId: string,
  // The supabase client here is the resident's session-bound client. RLS
  // will protect every read, so even a misbehaving model can't access
  // somebody else's data.
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  pendingActions: PendingActionEnvelope[],
): Promise<unknown> {
  if (isReadTool(call.name)) {
    return runReadTool(call.name, { supabase, userId });
  }

  if (isWriteTool(call.name)) {
    const parsed = parseToolArgs(call.arguments);
    if (!parsed.ok) {
      return { error: `invalid arguments: ${parsed.error}` };
    }

    if (call.name === 'create_booking') {
      const v = validateBookingArgs(parsed.value);
      if (!v.ok) return { error: v.error };
      const action: PendingAction = { kind: 'create_booking', args: v.value };
      const token = mintPendingActionToken(userId, action);
      const summary = `Book **${v.value.facility}** on **${v.value.date}** at **${v.value.time_slot}**${v.value.notes ? ` — ${v.value.notes}` : ''}`;
      pendingActions.push({ token, kind: 'create_booking', summary, args: v.value });
      return {
        ok: true,
        message:
          'Booking drafted. The user will see a confirmation card and must tap Confirm to submit. Tell the user clearly that nothing has been submitted yet.',
      };
    }

    if (call.name === 'create_issue') {
      const v = validateIssueArgs(parsed.value);
      if (!v.ok) return { error: v.error };
      const action: PendingAction = { kind: 'create_issue', args: v.value };
      const token = mintPendingActionToken(userId, action);
      const summary = `Raise **${v.value.priority.toUpperCase()}** ${v.value.category} issue: **${v.value.title}**`;
      pendingActions.push({ token, kind: 'create_issue', summary, args: v.value });
      return {
        ok: true,
        message:
          'Issue drafted. The user will see a confirmation card and must tap Confirm to submit. Tell the user clearly that nothing has been submitted yet.',
      };
    }
  }

  return { error: `unknown tool: ${call.name}` };
}
