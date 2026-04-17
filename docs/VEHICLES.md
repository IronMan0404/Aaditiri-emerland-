# Vehicles

Each resident can register multiple vehicles. Used for visitor parking, gate logs, and stickers in future iterations.

## Data model

```sql
create table public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,
  number      text not null,
  type        text check (type in ('car','bike','other')) default 'car',
  created_at  timestamptz default now(),
  unique (user_id, number)
);
```

RLS:
- Any authenticated user can **read** all vehicles (admin search + future gate logs need this).
- A resident can **insert/update/delete** only their own rows.
- An admin can manage any resident's vehicles.

## Backwards-compat

The legacy `profiles.vehicle_number text` column is **kept** for now and one-time backfilled into `vehicles` (one row, type=`car`) by `supabase/schema.sql`. Once you've confirmed the new UI is solid, drop the column with:

```sql
alter table public.profiles drop column vehicle_number;
```

## UI

`<VehiclesEditor>` (`src/components/ui/VehiclesEditor.tsx`) operates in two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Persistent** | `userId` prop is set | Add/remove/type-change writes to Supabase immediately. |
| **Draft** | `userId` omitted | Only updates local state; parent persists on submit. Used during signup before a `user_id` exists. |

Used in:

- `/auth/register` — optional vehicles section in the signup form.
- `/dashboard/profile` — dedicated "Vehicles" card.
- `/admin/users` → Edit user modal — admin can manage any resident's vehicles, governed by RLS.

## Plate normalisation

Plates are uppercased + whitespace-stripped before being saved (`normalizePlate()` in the editor). The unique `(user_id, number)` constraint then prevents duplicates per resident.
