import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Notification routing table.
//
// One entry per logical event. Each entry declares:
//
//   - audience(payload, supabase) → user IDs to notify
//   - render(payload) → channel-specific copy
//   - actions?(payload) → optional Telegram inline buttons
//                          (admins only — render returns the
//                          buttons the dispatcher will attach)
//
// EVERY change to "who gets notified for X" lives in this file.
// The dispatcher (src/lib/notify.ts) and channel modules
// (src/lib/push.ts, src/lib/telegram.ts) are payload-agnostic.
//
// Convention: `payload` is whatever the caller passes when
// raising the event. We type it per kind so callers can't pass
// the wrong shape. Audience resolvers are async because some
// kinds need to query the DB ("everyone in this flat", "all
// admins").
// ============================================================

// ---------- Per-channel rendered output -------------------------------

export interface PushCopy {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface TelegramCopy {
  /** MarkdownV2-formatted text (caller is responsible for escaping). */
  text: string;
  /** Optional inline buttons. Used for admin approval shortcuts. */
  buttons?: { text: string; url?: string; callbackData?: string }[];
}

export interface RenderedNotification {
  push: PushCopy;
  telegram: TelegramCopy;
}

// ---------- Payload types per kind -----------------------------------
//
// Each kind's payload is intentionally minimal — usually just the
// resource id and the bits of context the audience resolver needs
// (flat number, etc.). Renderers re-fetch the full row if they
// need it; that keeps payloads small enough to log safely.

export type NotificationPayloads = {
  // ---- broadcast / society-wide ------------------------------------
  // `senderName` is the human-readable display string the renderer
  // attributes the message to. Always pre-resolved at the call site
  // (renderers are sync and don't have a Supabase client). Pass null
  // if the sender's profile was deleted; the renderer falls back to
  // SYSTEM_SENDER_NAME so residents always see "From <someone>".
  broadcast_sent: {
    broadcastId: string;
    title: string;
    body: string;
    /** @deprecated kept for back-compat with older queued payloads. */
    authoredById?: string | null;
    senderName: string | null;
  };
  announcement_published: {
    announcementId: string;
    title: string;
    preview: string;
    senderName: string | null;
  };
  event_published: {
    eventId: string;
    title: string;
    whenLabel: string;
    senderName: string | null;
  };
  event_reminder: { eventId: string; userId: string; title: string; whenLabel: string };

  // ---- approval flows -----------------------------------------------
  //
  // Each approval flow now fires TWO notification kinds at submit time:
  //
  //   *_submitted / *_requested  → admins only (excluding the
  //                                requester themselves, in case the
  //                                requester is also an admin)
  //   *_acknowledged             → just the requester, "your X is
  //                                queued" copy. Plain confirmation,
  //                                no admin-action buttons.
  //
  // Why two kinds instead of one with conditional copy: the renderer
  // is a pure function of the payload, and it has no Supabase client
  // to look up "is this user_id an admin?". Splitting them keeps the
  // render() functions simple and lets each side dedup independently
  // through the existing `notify()` ledger.
  //
  // For an admin who books their own clubhouse slot: the admin-card
  // (with Approve/Reject buttons) goes to OTHER admins, and the admin
  // themselves gets the resident-side "queued" card. Their own
  // approval can still be done from the app — they don't get a
  // self-approve button in their own DM.
  registration_submitted: { profileId: string; fullName: string; flatNumber: string | null };
  registration_acknowledged: { profileId: string };
  registration_decided: { profileId: string; approved: boolean };

  subscription_requested: {
    subscriptionId: string;
    requesterId: string;
    flatNumber: string;
    tierName: string;
    months: number;
  };
  subscription_acknowledged: {
    subscriptionId: string;
    requesterId: string;
    tierName: string;
    months: number;
  };
  subscription_decided: {
    subscriptionId: string;
    requesterId: string;
    approved: boolean;
    rejectedReason?: string;
  };
  subscription_expiring: { subscriptionId: string; flatNumber: string; daysLeft: number };
  subscription_expired: { subscriptionId: string; flatNumber: string };

  booking_submitted: {
    bookingId: string;
    requesterId: string;
    facilityName: string;
    whenLabel: string;
    // Optional resident details so the admin Telegram message can
    // show who's requesting (name, flat, phone) without the admin
    // having to open the app. Caller (`/api/bookings`) populates
    // these from the requester's profile. Older callers that don't
    // set them gracefully degrade to the previous "facility/when
    // only" message.
    requesterName?: string | null;
    requesterFlat?: string | null;
    requesterPhone?: string | null;
    notes?: string | null;
  };
  booking_acknowledged: {
    bookingId: string;
    requesterId: string;
    facilityName: string;
    whenLabel: string;
  };
  booking_decided: { bookingId: string; requesterId: string; approved: boolean };

  // ---- direct / 1:1 ------------------------------------------------
  direct_message_received: {
    messageId: string;
    recipientId: string;
    preview: string;
    senderName: string | null;
  };

  // ---- ticket workflow --------------------------------------------
  ticket_status_changed: {
    issueId: string;
    reporterId: string;
    title: string;
    newStatus: string;
    /** Admin who flipped the status. Used by the dispatcher to skip notifying the actor themselves. */
    actorId?: string;
  };
  ticket_comment_added: {
    issueId: string;
    title: string;
    commentAuthorId: string;
    commentAuthorIsAdmin: boolean;
    reporterId: string;
    preview: string;
  };

  // ---- admin-only alerts ------------------------------------------
  phonebook_entry_reported: { contactId: string; contactName: string; reportCount: number };

  // ---- funds (community money) ------------------------------------
  // Admin published a new fund visible to all residents.
  fund_created: {
    fundId: string;
    name: string;
    suggestedPerFlatPaise: number | null;
    senderName: string | null;
  };
  // Admin verified a resident-reported contribution. Resident only.
  fund_contribution_verified: {
    contributionId: string;
    fundId: string;
    residentId: string;
    isInKind: boolean;
    amountPaise: number | null;
  };
  // Admin rejected a resident-reported contribution. Resident only.
  fund_contribution_rejected: {
    contributionId: string;
    fundId: string;
    residentId: string;
    reason: string;
  };
  // Fund closed. All residents (if visibility = all_residents).
  fund_closed: {
    fundId: string;
    name: string;
    surplusPaise: number;
    closureNotes: string;
    senderName: string | null;
  };
  // Admin-triggered dues nudge. One row per (flat, dispatch). The
  // dedup key (refId) is a unique batch id so the same flat can be
  // nudged again next month without the dedup ledger blocking it.
  // `recipientId` lets the audience resolver target exactly that
  // resident — the dispatcher fires once per resident-in-flat.
  dues_reminder: {
    recipientId: string;
    flatNumber: string;
    totalPendingPaise: number;
    fundCount: number;
    fundName: string | null;
    fundId: string | null;
  };

  // Admin-curated society-wide reminder fired by the daily cron from
  // a row in `public.scheduled_reminders`. Treat this as the generic
  // "scheduled push" — copy is whatever the admin typed; routing
  // resolves to every approved resident. dedup key (refId) is the
  // reminder id so a single row can never double-send across cron
  // retries.
  scheduled_reminder: {
    reminderId: string;
    title: string;
    body: string;
    /** Resolved at fire time. May be null if the creating admin's profile was deleted. */
    senderName: string | null;
  };
};

export type NotificationKind = keyof NotificationPayloads;

// ---------- Audience resolvers ---------------------------------------

/**
 * Audience resolvers answer "which user IDs should receive this?".
 * They take the payload and a Supabase admin client (so they can
 * read across all profiles regardless of the caller's RLS scope).
 * Returns deduplicated user IDs.
 */
type AudienceResolver<K extends NotificationKind> = (
  payload: NotificationPayloads[K],
  supabase: SupabaseClient,
) => Promise<string[]>;

async function allApprovedFlatMembers(
  supabase: SupabaseClient,
  flatNumber: string | null,
): Promise<string[]> {
  if (!flatNumber) return [];
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_approved', true)
    .eq('is_bot', false)
    .eq('flat_number', flatNumber);
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function allApprovedResidents(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_approved', true)
    .eq('is_bot', false);
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function allAdmins(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from('profiles').select('id').eq('role', 'admin');
  return (data ?? []).map((r: { id: string }) => r.id);
}

/**
 * Admins minus a given user id. Used by approval-submission kinds
 * so an admin who books / requests a subscription / registers their
 * own account doesn't receive the admin-action card alongside the
 * resident "queued" card. They just get the resident card; OTHER
 * admins get the admin card and can approve from there.
 */
async function adminsExcept(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<string[]> {
  const admins = await allAdmins(supabase);
  if (!userId) return admins;
  return admins.filter((id) => id !== userId);
}

// ---------- Renderers ------------------------------------------------

type Renderer<K extends NotificationKind> = (
  payload: NotificationPayloads[K],
) => RenderedNotification;

// MarkdownV2 escape (duplicated from src/lib/telegram.ts so this
// file stays free of cycles — both files import it from each
// other otherwise).
function md(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}

// Generic fallback used when the original sender's profile has been
// deleted (created_by/authored_by is null). Always prefer this over
// omitting attribution so residents never wonder "who sent this?".
const SYSTEM_SENDER_NAME = 'Aaditri Emerland Admin';

function senderLabel(senderName: string | null | undefined): string {
  const trimmed = (senderName ?? '').trim();
  return trimmed.length > 0 ? trimmed : SYSTEM_SENDER_NAME;
}

/**
 * Render the "From <Name>" attribution that goes under the title in
 * Telegram messages. Output is MarkdownV2-escaped italic.
 */
function senderTelegramLine(senderName: string | null | undefined): string {
  return `_From ${md(senderLabel(senderName))}_`;
}

/**
 * Append the sender's name to a push body so the OS-level toast
 * always carries attribution even when residents glance at the
 * lock screen. Idempotent if the body already contains the name.
 */
function senderPushBody(body: string, senderName: string | null | undefined): string {
  const label = senderLabel(senderName);
  // Guard against double-attribution if a caller already prefixed it.
  if (body.toLowerCase().includes(label.toLowerCase())) return body;
  return `${body} — ${label}`;
}

// ---------- The routing table ---------------------------------------
//
// Every entry: { audience, render, actions? }. The TypeScript dance
// keeps payloads strongly typed per kind.

interface RoutingEntry<K extends NotificationKind> {
  audience: AudienceResolver<K>;
  render: Renderer<K>;
}

type RoutingTable = { [K in NotificationKind]: RoutingEntry<K> };

export const ROUTING: RoutingTable = {
  // ────────────────────────────────────────────────────────────────
  // SOCIETY-WIDE (broadcast, announcement, event)
  // Audience: every approved, non-bot resident. Avg 4/flat already
  // covered because we're including every member by default.
  // ────────────────────────────────────────────────────────────────
  broadcast_sent: {
    audience: (_payload, sb) => allApprovedResidents(sb),
    render: ({ broadcastId, title, body, senderName }) => ({
      push: {
        title,
        body: senderPushBody(clip(body, 140), senderName),
        url: '/dashboard/broadcasts',
        tag: `broadcast:${broadcastId}`,
      },
      telegram: {
        text: [
          `*${md(title)}*`,
          senderTelegramLine(senderName),
          '',
          md(clip(body, 800)),
        ].join('\n'),
        buttons: [{ text: 'Open in app', url: '/dashboard/broadcasts' }],
      },
    }),
  },

  announcement_published: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ announcementId, title, preview, senderName }) => ({
      push: {
        title: `Announcement: ${title}`,
        body: senderPushBody(clip(preview, 140), senderName),
        url: '/dashboard/announcements',
        tag: `announcement:${announcementId}`,
      },
      telegram: {
        text: [
          '*Announcement*',
          `*${md(title)}*`,
          senderTelegramLine(senderName),
          '',
          md(clip(preview, 800)),
        ].join('\n'),
        buttons: [{ text: 'Open in app', url: '/dashboard/announcements' }],
      },
    }),
  },

  event_published: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ eventId, title, whenLabel, senderName }) => ({
      push: {
        title: `New event: ${title}`,
        body: senderPushBody(whenLabel, senderName),
        url: '/dashboard/events',
        tag: `event:${eventId}`,
      },
      telegram: {
        text: [
          '*New event*',
          `*${md(title)}*`,
          `_${md(whenLabel)}_`,
          senderTelegramLine(senderName),
        ].join('\n'),
        buttons: [{ text: 'View event', url: `/dashboard/events#${eventId}` }],
      },
    }),
  },

  event_reminder: {
    audience: async ({ userId }) => [userId],
    render: ({ eventId, title, whenLabel }) => ({
      push: {
        title: `Reminder: ${title}`,
        body: whenLabel,
        url: '/dashboard/events',
        tag: `event-reminder:${eventId}`,
      },
      telegram: {
        text: `*Reminder*\n*${md(title)}*\n_${md(whenLabel)}_`,
        buttons: [{ text: 'View event', url: `/dashboard/events#${eventId}` }],
      },
    }),
  },

  // ────────────────────────────────────────────────────────────────
  // APPROVAL FLOWS — admins + requester echo
  // ────────────────────────────────────────────────────────────────
  registration_submitted: {
    // Admins only, excluding the new resident themselves (in case
    // they were already an admin somehow — defensive). The resident
    // gets `registration_acknowledged` separately.
    audience: async ({ profileId }, sb) => adminsExcept(sb, profileId),
    render: ({ profileId, fullName, flatNumber }) => ({
      push: {
        title: 'New registration',
        body: `${fullName}${flatNumber ? ` · ${flatNumber}` : ''} is awaiting approval`,
        url: `/admin/users#${profileId}`,
        tag: `registration:${profileId}`,
      },
      telegram: {
        text: [
          '*New registration*',
          `${md(fullName)}${flatNumber ? ' \\· ' + md(flatNumber) : ''}`,
          '_Awaiting admin review_',
        ].join('\n'),
        // Registration approve/reject from Telegram per user's
        // confirmation: tg_actions_all.
        buttons: [
          { text: 'Approve', callbackData: `reg:approve:${profileId}` },
          { text: 'Reject', callbackData: `reg:reject:${profileId}` },
          { text: 'Open profile', url: `/admin/users#${profileId}` },
        ],
      },
    }),
  },

  // Resident-side echo for a fresh registration. Plain confirmation,
  // no buttons — the resident is mid-onboarding and can't act.
  registration_acknowledged: {
    audience: async ({ profileId }) => [profileId],
    render: () => ({
      push: {
        title: 'Registration submitted',
        body: 'Thanks! Your account is awaiting admin approval.',
        url: '/auth/pending',
        tag: 'registration-acknowledged',
      },
      telegram: {
        text: [
          '*Registration submitted*',
          '_Your account is awaiting admin approval\\._',
          'You\\\'ll get another message once a decision is made\\.',
        ].join('\n'),
      },
    }),
  },

  registration_decided: {
    audience: async ({ profileId }) => [profileId],
    render: ({ approved }) => ({
      push: {
        title: approved ? 'Registration approved' : 'Registration update',
        body: approved
          ? 'Welcome to Aaditri Emerland! You can now access the app.'
          : 'Your registration was not approved. Please contact the admin team.',
        url: approved ? '/dashboard' : '/auth/pending',
        tag: 'registration-decision',
      },
      telegram: {
        text: approved
          ? '*Welcome to Aaditri Emerland\\!*\nYour registration has been approved\\.'
          : '*Registration update*\nYour registration was not approved\\. Please contact the admin team\\.',
        buttons: approved
          ? [{ text: 'Open app', url: '/dashboard' }]
          : undefined,
      },
    }),
  },

  subscription_requested: {
    // Admins only, excluding the requester themselves. The requester
    // gets `subscription_acknowledged` separately so admins-who-book
    // see the personal "queued" card instead of an Approve-yourself
    // button on their own request.
    audience: async ({ requesterId }, sb) => adminsExcept(sb, requesterId),
    render: ({ subscriptionId, flatNumber, tierName, months }) => ({
      push: {
        title: 'Clubhouse subscription request',
        body: `${flatNumber} · ${tierName} · ${months} month${months === 1 ? '' : 's'}`,
        url: '/admin/clubhouse',
        tag: `subscription-req:${subscriptionId}`,
      },
      telegram: {
        text: [
          '*Clubhouse subscription request*',
          `Flat: *${md(flatNumber)}*`,
          `Tier: *${md(tierName)}*`,
          `Duration: *${months} month${months === 1 ? '' : 's'}*`,
        ].join('\n'),
        buttons: [
          { text: 'Approve', callbackData: `sub:approve:${subscriptionId}` },
          { text: 'Reject', callbackData: `sub:reject:${subscriptionId}` },
          { text: 'Open in app', url: '/admin/clubhouse' },
        ],
      },
    }),
  },

  // Resident-side echo for a clubhouse subscription request.
  subscription_acknowledged: {
    audience: async ({ requesterId }) => [requesterId],
    render: ({ tierName, months }) => ({
      push: {
        title: 'Subscription request submitted',
        body: `${tierName} · ${months} month${months === 1 ? '' : 's'}. Awaiting admin approval.`,
        url: '/dashboard/clubhouse',
        tag: 'subscription-acknowledged',
      },
      telegram: {
        text: [
          '*Subscription request submitted*',
          `Tier: *${md(tierName)}*`,
          `Duration: *${months} month${months === 1 ? '' : 's'}*`,
          '',
          '_Awaiting admin approval\\. You\\\'ll get another message once a decision is made\\._',
        ].join('\n'),
        buttons: [{ text: 'View in app', url: '/dashboard/clubhouse' }],
      },
    }),
  },

  subscription_decided: {
    audience: async ({ requesterId }) => [requesterId],
    render: ({ approved, rejectedReason }) => ({
      push: {
        title: approved ? 'Subscription approved' : 'Subscription update',
        body: approved
          ? 'Your clubhouse subscription is now active.'
          : `Subscription rejected${rejectedReason ? `: ${rejectedReason}` : ''}.`,
        url: '/dashboard/clubhouse',
        tag: 'subscription-decision',
      },
      telegram: {
        text: approved
          ? '*Subscription approved\\!*\nYour clubhouse subscription is now active\\.'
          : `*Subscription update*\nYour request was not approved${rejectedReason ? `: ${md(rejectedReason)}` : ''}\\.`,
        buttons: [{ text: 'Open clubhouse', url: '/dashboard/clubhouse' }],
      },
    }),
  },

  subscription_expiring: {
    audience: async ({ flatNumber }, sb) => allApprovedFlatMembers(sb, flatNumber),
    render: ({ daysLeft }) => ({
      push: {
        title: 'Subscription expiring',
        body: `Your clubhouse subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        url: '/dashboard/clubhouse',
        tag: 'subscription-expiring',
      },
      telegram: {
        text: `*Subscription expiring*\nYour clubhouse subscription expires in *${daysLeft}* day${daysLeft === 1 ? '' : 's'}\\.`,
        buttons: [{ text: 'Renew', url: '/dashboard/clubhouse' }],
      },
    }),
  },

  subscription_expired: {
    audience: async ({ flatNumber }, sb) => allApprovedFlatMembers(sb, flatNumber),
    render: () => ({
      push: {
        title: 'Subscription expired',
        body: 'Your clubhouse subscription has expired. Renew to keep accessing facilities.',
        url: '/dashboard/clubhouse',
        tag: 'subscription-expired',
      },
      telegram: {
        text: '*Subscription expired*\nYour clubhouse subscription has expired\\. Renew to keep accessing facilities\\.',
        buttons: [{ text: 'Renew', url: '/dashboard/clubhouse' }],
      },
    }),
  },

  booking_submitted: {
    // Admins only, excluding the requester themselves. The requester
    // gets `booking_acknowledged` instead — that way an admin who
    // books their own slot doesn't see an Approve button for their
    // own request, just the resident "queued" confirmation.
    audience: async ({ requesterId }, sb) => adminsExcept(sb, requesterId),
    render: ({
      bookingId,
      facilityName,
      whenLabel,
      requesterName,
      requesterFlat,
      requesterPhone,
      notes,
    }) => {
      // Resident summary for the push body — keeps it under iOS's
      // ~178-char body cap even with all fields populated.
      const who = [
        requesterName?.trim() || null,
        requesterFlat ? `Flat ${requesterFlat}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const pushBody = [`${facilityName} · ${whenLabel}`, who]
        .filter(Boolean)
        .join('\n');

      // Telegram message — admins want to decide without leaving
      // the chat, so we include name + flat + phone + any notes.
      // Phone is shown as MarkdownV2 inline code so long-press →
      // copy works on every Telegram client.
      const tgLines: string[] = ['*Booking request*'];
      if (requesterName) tgLines.push(`From: *${md(requesterName)}*`);
      if (requesterFlat) tgLines.push(`Flat: *${md(requesterFlat)}*`);
      if (requesterPhone) tgLines.push(`Phone: \`${md(requesterPhone)}\``);
      tgLines.push(`Facility: *${md(facilityName)}*`);
      tgLines.push(`When: _${md(whenLabel)}_`);
      if (notes && notes.trim()) {
        tgLines.push('');
        tgLines.push(`_${md(clip(notes.trim(), 300))}_`);
      }

      return {
        push: {
          title: 'Booking request',
          body: pushBody,
          url: '/admin/bookings',
          tag: `booking:${bookingId}`,
        },
        telegram: {
          text: tgLines.join('\n'),
          buttons: [
            { text: 'Approve', callbackData: `bk:approve:${bookingId}` },
            { text: 'Reject', callbackData: `bk:reject:${bookingId}` },
            { text: 'Open in app', url: '/admin/bookings' },
          ],
        },
      };
    },
  },

  // Resident-side echo when a booking is created. Confirms the
  // booking is in the queue without offering admin action buttons.
  booking_acknowledged: {
    audience: async ({ requesterId }) => [requesterId],
    render: ({ bookingId, facilityName, whenLabel }) => ({
      push: {
        title: 'Booking submitted',
        body: `${facilityName} · ${whenLabel}. Awaiting admin approval.`,
        url: '/dashboard/bookings',
        tag: `booking-acknowledged:${bookingId}`,
      },
      telegram: {
        text: [
          '*Booking submitted*',
          `Facility: *${md(facilityName)}*`,
          `When: _${md(whenLabel)}_`,
          '',
          '_Awaiting admin approval\\. You\\\'ll get another message once a decision is made\\._',
        ].join('\n'),
        buttons: [{ text: 'View bookings', url: '/dashboard/bookings' }],
      },
    }),
  },

  booking_decided: {
    audience: async ({ requesterId }) => [requesterId],
    render: ({ approved }) => ({
      push: {
        title: approved ? 'Booking approved' : 'Booking update',
        body: approved
          ? 'Your facility booking has been approved.'
          : 'Your booking was not approved. Please reach out to the admins.',
        url: '/dashboard/bookings',
        tag: 'booking-decision',
      },
      telegram: {
        text: approved
          ? '*Booking approved\\!*\nYour facility booking has been approved\\.'
          : '*Booking update*\nYour booking was not approved\\. Please reach out to the admins\\.',
        buttons: [{ text: 'Open bookings', url: '/dashboard/bookings' }],
      },
    }),
  },

  // ────────────────────────────────────────────────────────────────
  // 1:1 / DM / TICKET / ADMIN
  // ────────────────────────────────────────────────────────────────
  direct_message_received: {
    audience: async ({ recipientId }) => [recipientId],
    render: ({ messageId, preview, senderName }) => ({
      push: {
        title: `New message from ${senderLabel(senderName)}`,
        body: clip(preview, 160),
        url: '/dashboard/messages',
        tag: `dm:${messageId}`,
      },
      telegram: {
        text: [
          '*New message*',
          senderTelegramLine(senderName),
          '',
          md(clip(preview, 800)),
        ].join('\n'),
        buttons: [{ text: 'Open inbox', url: '/dashboard/messages' }],
      },
    }),
  },

  ticket_status_changed: {
    audience: async ({ reporterId }) => [reporterId],
    render: ({ issueId, title, newStatus }) => {
      // Match the wording of the previous status-notify route so
      // residents see consistent copy across the migration.
      const pushTitle =
        newStatus === 'resolved'
          ? 'Your issue is resolved'
          : newStatus === 'closed'
            ? 'Your issue is closed'
            : `Ticket update: ${title}`;
      return {
        push: {
          title: pushTitle,
          body: title,
          url: '/dashboard/issues',
          tag: `ticket-status:${issueId}`,
        },
        telegram: {
          text: [
            `*${md(pushTitle)}*`,
            `_${md(title)}_`,
          ].join('\n'),
          buttons: [{ text: 'Open ticket', url: '/dashboard/issues' }],
        },
      };
    },
  },

  ticket_comment_added: {
    audience: async ({ commentAuthorIsAdmin, reporterId, commentAuthorId }, sb) => {
      // Resident-authored comment → notify admins.
      // Admin-authored comment → notify reporter.
      // In both cases, exclude the comment author.
      if (commentAuthorIsAdmin) {
        return [reporterId].filter((id) => id !== commentAuthorId);
      }
      const admins = await allAdmins(sb);
      return admins.filter((id) => id !== commentAuthorId);
    },
    render: ({ issueId, title, commentAuthorIsAdmin, preview }) => {
      // Mirror the ergonomics of the previous comment-notify route:
      // residents see "Admin replied: <title>"; admins see
      // "<author>: <title>".
      const pushTitle = commentAuthorIsAdmin
        ? `Admin replied: ${title}`
        : 'New comment on issue';
      const adminUrl = '/admin/issues';
      const residentUrl = `/dashboard/issues`;
      return {
        push: {
          title: pushTitle,
          body: clip(preview, 160),
          url: commentAuthorIsAdmin ? residentUrl : adminUrl,
          tag: `ticket-comment:${issueId}`,
        },
        telegram: {
          text: [
            `*${md(pushTitle)}*`,
            `*${md(title)}*`,
            '',
            md(clip(preview, 600)),
          ].join('\n'),
          buttons: [
            {
              text: 'Open ticket',
              url: commentAuthorIsAdmin ? residentUrl : adminUrl,
            },
          ],
        },
      };
    },
  },

  phonebook_entry_reported: {
    audience: (_p, sb) => allAdmins(sb),
    render: ({ contactId, contactName, reportCount }) => ({
      push: {
        title: 'Phonebook report',
        body: `"${contactName}" has been reported ${reportCount} time${reportCount === 1 ? '' : 's'}`,
        url: '/admin/phonebook',
        tag: `phonebook-report:${contactId}`,
      },
      telegram: {
        text: [
          '*Phonebook entry reported*',
          `*${md(contactName)}*`,
          `_${reportCount} report${reportCount === 1 ? '' : 's'} so far_`,
        ].join('\n'),
        buttons: [{ text: 'Review in app', url: '/admin/phonebook' }],
      },
    }),
  },

  // ────────────────────────────────────────────────────────────────
  // FUNDS (community money)
  // ────────────────────────────────────────────────────────────────
  fund_created: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ fundId, name, suggestedPerFlatPaise, senderName }) => {
      const suggestedRupees =
        suggestedPerFlatPaise != null ? Math.round(suggestedPerFlatPaise / 100) : null;
      const subtitle = suggestedRupees
        ? `Suggested \u20B9${suggestedRupees.toLocaleString('en-IN')}/flat. Tap to contribute.`
        : 'Tap to view details and contribute.';
      return {
        push: {
          title: `New community fund: ${name}`,
          body: senderPushBody(subtitle, senderName),
          url: `/dashboard/funds/${fundId}`,
          tag: `fund-created:${fundId}`,
        },
        telegram: {
          text: [
            `*New community fund: ${md(name)}*`,
            senderTelegramLine(senderName),
            '',
            md(subtitle),
          ].join('\n'),
          buttons: [{ text: 'View fund', url: `/dashboard/funds/${fundId}` }],
        },
      };
    },
  },

  fund_contribution_verified: {
    audience: async ({ residentId }) => [residentId],
    render: ({ contributionId, fundId, isInKind, amountPaise }) => ({
      push: {
        title: 'Contribution verified \u2713',
        body: isInKind
          ? 'Thank you for your in-kind contribution!'
          : amountPaise != null
            ? `Thank you for \u20B9${(amountPaise / 100).toLocaleString('en-IN')}.`
            : 'Thank you for your contribution.',
        url: `/dashboard/funds/${fundId}`,
        tag: `contribution-verified:${contributionId}`,
      },
      telegram: {
        text: isInKind
          ? '*Contribution verified \u2713*\nThank you for your in\\-kind contribution\\!'
          : amountPaise != null
            ? `*Contribution verified \u2713*\nThank you for *\u20B9${md((amountPaise / 100).toLocaleString('en-IN'))}*\\.`
            : '*Contribution verified \u2713*\nThank you for your contribution\\.',
        buttons: [{ text: 'Open fund', url: `/dashboard/funds/${fundId}` }],
      },
    }),
  },

  fund_contribution_rejected: {
    audience: async ({ residentId }) => [residentId],
    render: ({ contributionId, fundId, reason }) => ({
      push: {
        title: 'Contribution needs attention',
        body: `Your reported contribution was rejected: ${clip(reason, 100)}`,
        url: `/dashboard/funds/${fundId}`,
        tag: `contribution-rejected:${contributionId}`,
      },
      telegram: {
        text: [
          '*Contribution needs attention*',
          `Your reported contribution was rejected:`,
          `_${md(clip(reason, 300))}_`,
        ].join('\n'),
        buttons: [{ text: 'Open fund', url: `/dashboard/funds/${fundId}` }],
      },
    }),
  },

  fund_closed: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ fundId, name, surplusPaise, closureNotes, senderName }) => {
      const surplusLabel =
        surplusPaise > 0
          ? `Closed with \u20B9${(surplusPaise / 100).toLocaleString('en-IN')} surplus.`
          : '';
      const body = surplusLabel
        ? `${surplusLabel} ${clip(closureNotes, 80)}`
        : clip(closureNotes, 120);
      return {
        push: {
          title: `Fund closed: ${name}`,
          body: senderPushBody(body, senderName),
          url: `/dashboard/funds/${fundId}`,
          tag: `fund-closed:${fundId}`,
        },
        telegram: {
          text: [
            `*Fund closed: ${md(name)}*`,
            senderTelegramLine(senderName),
            surplusLabel ? md(surplusLabel) : '',
            md(clip(closureNotes, 400)),
          ]
            .filter(Boolean)
            .join('\n'),
          buttons: [{ text: 'View fund', url: `/dashboard/funds/${fundId}` }],
        },
      };
    },
  },

  // Per-resident dues nudge fired by an admin from the dues page or
  // a single fund's detail page. Audience is exactly the recipient
  // identified in the payload (the API route fans out one notify()
  // call per resident in each flat that owes money).
  dues_reminder: {
    audience: async ({ recipientId }) => [recipientId],
    render: ({ flatNumber, totalPendingPaise, fundCount, fundName, fundId }) => {
      const amount = `\u20B9${Math.round(totalPendingPaise / 100).toLocaleString('en-IN')}`;
      const fundClause = fundName
        ? `for *${fundName}*`
        : fundCount === 1
          ? 'across *1 fund*'
          : `across *${fundCount} funds*`;
      const link = fundId ? `/dashboard/funds/${fundId}` : '/dashboard/funds';
      return {
        push: {
          title: `Pending dues: ${amount}`,
          body: fundName
            ? `Flat ${flatNumber} has ${amount} outstanding for ${fundName}.`
            : `Flat ${flatNumber} has ${amount} outstanding ${fundCount === 1 ? 'on 1 fund' : `across ${fundCount} funds`}.`,
          url: link,
          tag: `dues:${flatNumber}`,
        },
        telegram: {
          text: [
            '*Pending dues reminder*',
            `Flat *${md(flatNumber)}* has *${md(amount)}* outstanding ${md(fundClause.replace(/\*/g, ''))}\\.`,
            '',
            '_Tap below to view and contribute\\._',
          ].join('\n'),
          buttons: [{ text: 'Pay / view in app', url: link }],
        },
      };
    },
  },

  // Admin-curated reminder fired by the daily cron. Society-wide
  // audience, plain text body, "From <Admin>" attribution to match
  // broadcasts/announcements/events.
  scheduled_reminder: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ reminderId, title, body, senderName }) => ({
      push: {
        title: `Reminder: ${title}`,
        body: senderPushBody(clip(body, 140), senderName),
        url: '/dashboard',
        tag: `scheduled-reminder:${reminderId}`,
      },
      telegram: {
        text: [
          '*Reminder*',
          `*${md(title)}*`,
          senderTelegramLine(senderName),
          '',
          md(clip(body, 1200)),
        ].join('\n'),
        buttons: [{ text: 'Open app', url: '/dashboard' }],
      },
    }),
  },
};
