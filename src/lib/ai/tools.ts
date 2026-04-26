import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * AI assistant tool catalog.
 *
 * Design rules:
 *   - **Create-only on writes.** No update/delete tools. The model can read
 *     and create, never modify or remove. This is enforced at the dispatcher
 *     level (only tools listed in TOOL_REGISTRY exist) and at the route
 *     level (writes go through the pending-action confirm path, never run
 *     immediately on tool-call).
 *   - **Read tools run server-side immediately**, with the resident's session
 *     client, so RLS still protects everything. The model gets fresh data
 *     and can chain reads to gather what it needs before drafting a write.
 *   - **Write tools never execute on tool-call.** They mint a signed
 *     pending-action token and return it to the model. The chat UI then
 *     renders an inline Confirm card; only the user tapping Confirm causes
 *     the actual insert via /api/ai/confirm. This is the core safety
 *     guarantee against the AI silently submitting wrong dates/facilities.
 *   - **Validation is duplicated at every layer.** The OpenAI-style JSON
 *     Schema lives here for the model. The handler re-validates with plain
 *     TS guards. The /api/ai/confirm endpoint re-validates again before the
 *     write. Belt-and-suspenders is fine for a community app.
 */

// ---- Tool descriptors (sent to the model) -------------------------------

export interface ToolDescriptor {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    type: 'function',
    function: {
      name: 'list_facilities',
      description:
        'List all bookable clubhouse facilities (name, slug, whether they require a subscription). Call this BEFORE create_booking so you pass a valid facility name.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_subscription',
      description:
        'Get the current resident\'s active clubhouse subscription (tier name, included facility slugs, end date). Returns null if no active subscription.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_bookings',
      description:
        'List the current resident\'s recent bookings (latest 10). Use this to check for conflicts before creating a new booking.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_issues',
      description:
        "List the current resident's recent issues (latest 10), so you can avoid creating duplicates.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description:
        "Draft a clubhouse booking for the current resident. THIS DOES NOT SUBMIT IMMEDIATELY — it returns a pending_action that the user must confirm via the UI. Always call list_facilities first to get a valid facility name. Date must be YYYY-MM-DD and not in the past.",
      parameters: {
        type: 'object',
        properties: {
          facility: {
            type: 'string',
            description: "The exact facility name from list_facilities (e.g. 'Clubhouse', 'Tennis Court').",
          },
          date: {
            type: 'string',
            description: 'Booking date in strict YYYY-MM-DD format.',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
          time_slot: {
            type: 'string',
            description: "Time slot text the admin will see, e.g. '06:00 - 08:00' or '18:00 - 20:00'. Use 24-hour format.",
          },
          notes: {
            type: 'string',
            description: 'Optional context for the admin (e.g. "birthday party for 12 kids").',
          },
        },
        required: ['facility', 'date', 'time_slot'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_issue',
      description:
        "Draft a maintenance issue for the current resident's flat. THIS DOES NOT SUBMIT IMMEDIATELY — it returns a pending_action that the user must confirm via the UI. Pick the most specific category that fits.",
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short summary, < 80 chars. e.g. "Bathroom tap leaking".',
          },
          description: {
            type: 'string',
            description: 'Full description — what is wrong, where, since when, severity.',
          },
          category: {
            type: 'string',
            enum: [
              'plumbing',
              'electrical',
              'housekeeping',
              'security',
              'lift',
              'garden',
              'pest_control',
              'internet',
              'other',
            ],
          },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'urgent'],
            description: 'Default to "normal". Use "urgent" only for safety/emergency.',
          },
        },
        required: ['title', 'description', 'category'],
        additionalProperties: false,
      },
    },
  },
];

// ---- Read-only tool handlers --------------------------------------------

export interface ReadToolContext {
  /** Server Supabase client bound to the caller's auth cookie (RLS applies). */
  supabase: SupabaseClient;
  userId: string;
}

export type ReadToolName =
  | 'list_facilities'
  | 'list_my_subscription'
  | 'list_my_bookings'
  | 'list_my_issues';

export type WriteToolName = 'create_booking' | 'create_issue';

export function isReadTool(name: string): name is ReadToolName {
  return (
    name === 'list_facilities' ||
    name === 'list_my_subscription' ||
    name === 'list_my_bookings' ||
    name === 'list_my_issues'
  );
}

export function isWriteTool(name: string): name is WriteToolName {
  return name === 'create_booking' || name === 'create_issue';
}

export async function runReadTool(
  name: ReadToolName,
  ctx: ReadToolContext,
): Promise<unknown> {
  switch (name) {
    case 'list_facilities': {
      const { data, error } = await ctx.supabase
        .from('clubhouse_facilities')
        .select('name, slug, requires_subscription, is_active, is_bookable')
        .eq('is_active', true)
        .order('name');
      if (error) return { error: error.message };
      return { facilities: data ?? [] };
    }
    case 'list_my_subscription': {
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('flat_number')
        .eq('id', ctx.userId)
        .maybeSingle();
      if (!profile?.flat_number) {
        return { subscription: null, reason: 'No flat_number on profile' };
      }
      const { data, error } = await ctx.supabase
        .from('clubhouse_subscriptions')
        .select('id, tier_id, end_date, status, clubhouse_tiers(name, included_facilities)')
        .eq('flat_number', profile.flat_number)
        .eq('status', 'active')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { subscription: null };
      const tier = data.clubhouse_tiers as
        | { name?: string; included_facilities?: string[] }
        | null;
      return {
        subscription: {
          tier_name: tier?.name ?? null,
          included_facilities: tier?.included_facilities ?? [],
          end_date: data.end_date,
        },
      };
    }
    case 'list_my_bookings': {
      const { data, error } = await ctx.supabase
        .from('bookings')
        .select('id, facility, date, time_slot, status, notes')
        .eq('user_id', ctx.userId)
        .order('date', { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { bookings: data ?? [] };
    }
    case 'list_my_issues': {
      const { data, error } = await ctx.supabase
        .from('issues')
        .select('id, title, status, priority, category, created_at')
        .eq('created_by', ctx.userId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { issues: data ?? [] };
    }
  }
}

// ---- Write tool argument validators -------------------------------------

export interface BookingDraft {
  facility: string;
  date: string;
  time_slot: string;
  notes: string | null;
}

export interface IssueDraft {
  title: string;
  description: string;
  category: string;
  priority: string;
}

const ISSUE_CATEGORIES = new Set([
  'plumbing',
  'electrical',
  'housekeeping',
  'security',
  'lift',
  'garden',
  'pest_control',
  'internet',
  'other',
]);
const ISSUE_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateBookingArgs(raw: unknown): { ok: true; value: BookingDraft } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'arguments must be an object' };
  const o = raw as Record<string, unknown>;
  const facility = typeof o.facility === 'string' ? o.facility.trim() : '';
  const date = typeof o.date === 'string' ? o.date.trim() : '';
  const time_slot = typeof o.time_slot === 'string' ? o.time_slot.trim() : '';
  const notes = typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null;

  if (!facility) return { ok: false, error: 'facility is required' };
  if (!DATE_RE.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD' };
  if (!time_slot) return { ok: false, error: 'time_slot is required' };

  // Reject obviously-wrong dates (more than 1 day in the past, more than
  // 6 months in the future). The AI sometimes hallucinates years like
  // "2027-04-27"; we want a clear validation error so it self-corrects.
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return { ok: false, error: 'date is not a valid calendar date' };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sixMonths = new Date(today);
  sixMonths.setUTCMonth(sixMonths.getUTCMonth() + 6);
  if (target.getTime() < today.getTime() - 86_400_000) {
    return { ok: false, error: 'date is in the past' };
  }
  if (target.getTime() > sixMonths.getTime()) {
    return { ok: false, error: 'date is more than 6 months ahead' };
  }

  return { ok: true, value: { facility, date, time_slot, notes } };
}

export function validateIssueArgs(raw: unknown): { ok: true; value: IssueDraft } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'arguments must be an object' };
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  const category = typeof o.category === 'string' ? o.category.trim() : '';
  const priority = typeof o.priority === 'string' ? o.priority.trim() : 'normal';

  if (title.length < 3) return { ok: false, error: 'title must be at least 3 characters' };
  if (title.length > 120) return { ok: false, error: 'title must be at most 120 characters' };
  if (description.length < 5) return { ok: false, error: 'description must be at least 5 characters' };
  if (description.length > 4000) return { ok: false, error: 'description must be at most 4000 characters' };
  if (!ISSUE_CATEGORIES.has(category)) {
    return { ok: false, error: `category must be one of: ${[...ISSUE_CATEGORIES].join(', ')}` };
  }
  if (!ISSUE_PRIORITIES.has(priority)) {
    return { ok: false, error: `priority must be one of: ${[...ISSUE_PRIORITIES].join(', ')}` };
  }
  return { ok: true, value: { title, description, category, priority } };
}
