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
  broadcast_sent: { broadcastId: string; title: string; body: string; authoredById: string | null };
  announcement_published: { announcementId: string; title: string; preview: string };
  event_published: { eventId: string; title: string; whenLabel: string };
  event_reminder: { eventId: string; userId: string; title: string; whenLabel: string };

  // ---- approval flows: admins + requester echo --------------------
  registration_submitted: { profileId: string; fullName: string; flatNumber: string | null };
  registration_decided: { profileId: string; approved: boolean };

  subscription_requested: {
    subscriptionId: string;
    requesterId: string;
    flatNumber: string;
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
  };
  booking_decided: { bookingId: string; requesterId: string; approved: boolean };

  // ---- direct / 1:1 ------------------------------------------------
  direct_message_received: { messageId: string; recipientId: string; preview: string };

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

function dedup(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
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
    render: ({ broadcastId, title, body }) => ({
      push: {
        title,
        body: clip(body, 160),
        url: '/dashboard/broadcasts',
        tag: `broadcast:${broadcastId}`,
      },
      telegram: {
        text: `*${md(title)}*\n\n${md(clip(body, 800))}`,
        buttons: [{ text: 'Open in app', url: '/dashboard/broadcasts' }],
      },
    }),
  },

  announcement_published: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ announcementId, title, preview }) => ({
      push: {
        title: `Announcement: ${title}`,
        body: clip(preview, 160),
        url: '/dashboard/announcements',
        tag: `announcement:${announcementId}`,
      },
      telegram: {
        text: `*Announcement*\n*${md(title)}*\n\n${md(clip(preview, 800))}`,
        buttons: [{ text: 'Open in app', url: '/dashboard/announcements' }],
      },
    }),
  },

  event_published: {
    audience: (_p, sb) => allApprovedResidents(sb),
    render: ({ eventId, title, whenLabel }) => ({
      push: {
        title: `New event: ${title}`,
        body: whenLabel,
        url: '/dashboard/events',
        tag: `event:${eventId}`,
      },
      telegram: {
        text: `*New event*\n*${md(title)}*\n_${md(whenLabel)}_`,
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
    audience: async ({ profileId }, sb) => dedup([...(await allAdmins(sb)), profileId]),
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
    audience: async ({ requesterId }, sb) => dedup([...(await allAdmins(sb)), requesterId]),
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
    audience: async ({ requesterId }, sb) => dedup([...(await allAdmins(sb)), requesterId]),
    render: ({ bookingId, facilityName, whenLabel }) => ({
      push: {
        title: 'Booking request',
        body: `${facilityName} · ${whenLabel}`,
        url: '/admin/bookings',
        tag: `booking:${bookingId}`,
      },
      telegram: {
        text: [
          '*Booking request*',
          `Facility: *${md(facilityName)}*`,
          `When: _${md(whenLabel)}_`,
        ].join('\n'),
        buttons: [
          { text: 'Approve', callbackData: `bk:approve:${bookingId}` },
          { text: 'Reject', callbackData: `bk:reject:${bookingId}` },
          { text: 'Open in app', url: '/admin/bookings' },
        ],
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
    render: ({ messageId, preview }) => ({
      push: {
        title: 'New message',
        body: clip(preview, 160),
        url: '/dashboard/messages',
        tag: `dm:${messageId}`,
      },
      telegram: {
        text: `*New message*\n${md(clip(preview, 800))}`,
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
    render: ({ fundId, name, suggestedPerFlatPaise }) => {
      const suggestedRupees =
        suggestedPerFlatPaise != null ? Math.round(suggestedPerFlatPaise / 100) : null;
      const subtitle = suggestedRupees
        ? `Suggested \u20B9${suggestedRupees.toLocaleString('en-IN')}/flat. Tap to contribute.`
        : 'Tap to view details and contribute.';
      return {
        push: {
          title: `New community fund: ${name}`,
          body: subtitle,
          url: `/dashboard/funds/${fundId}`,
          tag: `fund-created:${fundId}`,
        },
        telegram: {
          text: [
            `*New community fund: ${md(name)}*`,
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
    render: ({ fundId, name, surplusPaise, closureNotes }) => {
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
          body,
          url: `/dashboard/funds/${fundId}`,
          tag: `fund-closed:${fundId}`,
        },
        telegram: {
          text: [
            `*Fund closed: ${md(name)}*`,
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
};
