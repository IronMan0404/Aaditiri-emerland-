'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  X,
  Users,
  ChevronDown,
  ChevronUp,
  Car,
  PawPrint,
  User as UserIcon,
  Phone,
  Mail,
  MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { safeImageUrl } from '@/lib/safe-url';
import type {
  Profile,
  Vehicle,
  FamilyMember,
  FamilyRelation,
  Pet,
  PetSpecies,
} from '@/types';

type ResidentFilter = 'owner' | 'tenant' | 'unspecified';

const FILTER_OPTIONS: { id: ResidentFilter; label: string; emoji: string }[] = [
  { id: 'owner', label: 'Owners', emoji: '🏠' },
  { id: 'tenant', label: 'Tenants', emoji: '🔑' },
  { id: 'unspecified', label: 'Unspecified', emoji: '❓' },
];

const RELATION_LABEL: Record<FamilyRelation, string> = {
  spouse: 'Spouse',
  son: 'Son',
  daughter: 'Daughter',
  parent: 'Parent',
  sibling: 'Sibling',
  other: 'Other',
};

const SPECIES_EMOJI: Record<PetSpecies, string> = {
  dog: '🐕',
  cat: '🐈',
  bird: '🐦',
  other: '🐾',
};

interface DirectoryRow {
  profile: Profile;
  vehicles: Vehicle[];
  family: FamilyMember[];
  pets: Pet[];
}

export default function CommunityPage() {
  const { profile: me, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [residentFilter, setResidentFilter] = useState<Set<ResidentFilter>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [profilesRes, vehiclesRes, familyRes, petsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('is_approved', true)
          .order('flat_number', { ascending: true, nullsFirst: false })
          .order('full_name', { ascending: true }),
        supabase.from('vehicles').select('id, user_id, number, type, created_at'),
        supabase
          .from('family_members')
          .select('id, user_id, full_name, relation, gender, age, phone, created_at'),
        supabase
          .from('pets')
          .select('id, user_id, name, species, vaccinated, created_at'),
      ]);
      if (cancelled) return;

      if (profilesRes.error) {
        toast.error(profilesRes.error.message);
        setLoading(false);
        return;
      }

      const profiles = (profilesRes.data ?? []) as Profile[];
      const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
      const family = (familyRes.data ?? []) as FamilyMember[];
      const pets = (petsRes.data ?? []) as Pet[];

      const byUserVehicles = groupBy(vehicles, (v) => v.user_id);
      const byUserFamily = groupBy(family, (f) => f.user_id);
      const byUserPets = groupBy(pets, (p) => p.user_id);

      // Hide bot accounts and unapproved users from the directory.
      const directory: DirectoryRow[] = profiles
        .filter((p) => !p.is_bot)
        .map((p) => ({
          profile: p,
          vehicles: byUserVehicles[p.id] ?? [],
          family: byUserFamily[p.id] ?? [],
          pets: byUserPets[p.id] ?? [],
        }));

      setRows(directory);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const typeCounts = useMemo(() => ({
    owner: rows.filter((r) => r.profile.resident_type === 'owner').length,
    tenant: rows.filter((r) => r.profile.resident_type === 'tenant').length,
    unspecified: rows.filter((r) => !r.profile.resident_type).length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ profile, vehicles, family, pets }) => {
      if (residentFilter.size > 0) {
        const bucket: ResidentFilter =
          profile.resident_type === 'owner' ? 'owner'
          : profile.resident_type === 'tenant' ? 'tenant'
          : 'unspecified';
        if (!residentFilter.has(bucket)) return false;
      }
      if (!q) return true;
      const haystack = [
        profile.full_name,
        profile.flat_number ?? '',
        profile.email ?? '',
        profile.phone ?? '',
        ...vehicles.map((v) => v.number),
        ...family.map((f) => `${f.full_name} ${f.phone ?? ''}`),
        ...pets.map((p) => p.name),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, residentFilter]);

  function toggleResidentFilter(id: ResidentFilter) {
    setResidentFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setResidentFilter(new Set());
    setSearch('');
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const hasActiveFilters = residentFilter.size > 0 || search.trim().length > 0;

  if (!mounted) {
    return <div className="max-w-3xl mx-auto px-4 py-6"><div className="h-20 bg-gray-100 rounded-xl animate-pulse" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users size={22} className="text-[#1B5E20]" />
          <h1 className="text-2xl font-bold text-gray-900">Community</h1>
        </div>
        <span className="bg-green-100 text-[#1B5E20] text-xs font-bold px-3 py-1 rounded-full">
          {rows.length} residents
        </span>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, flat, phone, email, family, pet, or vehicle…"
          aria-label="Search community"
          className="w-full pl-9 pr-9 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTER_OPTIONS.map((opt) => {
          const active = residentFilter.has(opt.id);
          const count = typeCounts[opt.id];
          return (
            <button
              key={opt.id}
              onClick={() => toggleResidentFilter(opt.id)}
              aria-label={`${active ? 'Remove' : 'Apply'} filter: ${opt.label}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                active
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
              }`}
            >
              <span aria-hidden>{opt.emoji}</span>
              <span>{opt.label}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {count}
              </span>
            </button>
          );
        })}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            <X size={12} />Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">
          {hasActiveFilters ? 'No residents match your filters' : 'No residents yet'}
        </p>
      ) : (
        <>
          {hasActiveFilters && (
            <p className="text-xs text-gray-400 mb-2">
              Showing {filtered.length} of {rows.length}
            </p>
          )}
          <div className="space-y-2">
            {filtered.map((row) => (
              <ResidentCard
                key={row.profile.id}
                row={row}
                isMe={me?.id === row.profile.id}
                expanded={expanded.has(row.profile.id)}
                onToggle={() => toggleExpanded(row.profile.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ResidentCard({
  row,
  isMe,
  expanded,
  onToggle,
}: {
  row: DirectoryRow;
  isMe: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { profile, vehicles, family, pets } = row;
  const initials = profile.full_name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const totalExtras = vehicles.length + family.length + pets.length;
  const hasContact = Boolean(profile.phone || profile.email);
  const canExpand = totalExtras > 0 || hasContact;
  const safeAvatar = safeImageUrl(profile.avatar_url);

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canExpand}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors disabled:cursor-default disabled:hover:bg-white"
      >
        {safeAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={encodeURI(safeAvatar)} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-green-100 text-[#1B5E20] flex items-center justify-center font-bold text-sm flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 truncate">{profile.full_name}</span>
            {isMe && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">YOU</span>}
            {profile.role === 'admin' && (
              <span className="text-[10px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">ADMIN</span>
            )}
            {profile.resident_type && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                profile.resident_type === 'owner'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}>
                {profile.resident_type === 'owner' ? '🏠 Owner' : '🔑 Tenant'}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {profile.flat_number ? `Flat ${profile.flat_number}` : 'Flat —'}
            {profile.phone && (
              <span className="ml-2 font-mono text-gray-500">· {profile.phone}</span>
            )}
            {totalExtras > 0 && (
              <span className="ml-2 text-gray-300">
                · {family.length > 0 && `${family.length} family`}
                {family.length > 0 && pets.length > 0 && ' · '}
                {pets.length > 0 && `${pets.length} pet${pets.length === 1 ? '' : 's'}`}
                {(family.length > 0 || pets.length > 0) && vehicles.length > 0 && ' · '}
                {vehicles.length > 0 && `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
              </span>
            )}
          </p>
        </div>
        {canExpand && (
          <span className="text-gray-300 flex-shrink-0">
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        )}
      </button>

      {expanded && canExpand && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
          {hasContact && (
            <Section title="Contact" icon={<Phone size={12} />} count={(profile.phone ? 1 : 0) + (profile.email ? 1 : 0)}>
              <div className="flex flex-wrap gap-1.5">
                {profile.phone && (
                  <>
                    <a
                      href={`tel:${profile.phone}`}
                      className="inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20] rounded-lg px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors"
                      aria-label={`Call ${profile.full_name}`}
                    >
                      <Phone size={12} />
                      <span className="font-mono">{profile.phone}</span>
                    </a>
                    <a
                      href={waLink(profile.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 hover:bg-green-100 rounded-lg px-2.5 py-1 text-xs font-medium text-green-700 transition-colors"
                      aria-label={`WhatsApp ${profile.full_name}`}
                    >
                      <MessageCircle size={12} />
                      <span>WhatsApp</span>
                    </a>
                  </>
                )}
                {profile.email && (
                  <a
                    href={`mailto:${profile.email}`}
                    className="inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20] rounded-lg px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors"
                    aria-label={`Email ${profile.full_name}`}
                  >
                    <Mail size={12} />
                    <span className="truncate max-w-[180px]">{profile.email}</span>
                  </a>
                )}
              </div>
            </Section>
          )}

          {family.length > 0 && (
            <Section title="Family Members" icon={<UserIcon size={12} />} count={family.length}>
              <ul className="space-y-1.5">
                {family.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-gray-800">{m.full_name}</span>
                    <span className="text-xs text-gray-500">
                      {RELATION_LABEL[m.relation]}
                      {m.age != null && ` · ${m.age} yrs`}
                      {m.gender && ` · ${m.gender === 'male' ? 'M' : m.gender === 'female' ? 'F' : 'Other'}`}
                    </span>
                    {m.phone && (
                      <a
                        href={`tel:${m.phone}`}
                        className="ml-auto inline-flex items-center gap-1 text-xs font-mono text-[#1B5E20] hover:underline"
                        aria-label={`Call ${m.full_name}`}
                      >
                        <Phone size={11} />
                        {m.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {pets.length > 0 && (
            <Section title="Pets" icon={<PawPrint size={12} />} count={pets.length}>
              <ul className="space-y-1.5">
                {pets.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <span aria-hidden>{SPECIES_EMOJI[p.species]}</span>
                    <span className="font-medium text-gray-800">{p.name}</span>
                    <span className="text-xs text-gray-500 capitalize">{p.species}</span>
                    {p.vaccinated && (
                      <span className="ml-auto text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                        VACCINATED
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {vehicles.length > 0 && (
            <Section title="Vehicles" icon={<Car size={12} />} count={vehicles.length}>
              <ul className="flex flex-wrap gap-1.5">
                {vehicles.map((v) => (
                  <li key={v.id} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs">
                    <span className="font-mono font-semibold tracking-wide text-gray-800">{v.number}</span>
                    <span className="text-gray-400 capitalize">{v.type}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[#1B5E20]">{icon}</span>
        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{title}</h4>
        <span className="text-[10px] font-bold bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">{count}</span>
      </div>
      {children}
    </div>
  );
}

// Build a wa.me link from any phone format. Strips spaces/dashes/parens and
// leading "+" — wa.me wants the country-code-prefixed digits only. If the
// number has no country code we fall back to India (91), which matches the
// resident base. Adjust here if the community ever spans multiple countries.
function waLink(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return '#';
  // Heuristic: 10-digit numbers without a leading country code → assume +91.
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${normalized}`;
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}
