'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Phone,
  MessageCircle,
  Mail,
  Search,
  ArrowRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase';
import type { Service, ServiceRate, ServiceWithRates } from '@/types';

// Resident: services directory.
//
// Read-only "yellow pages" view. Cards are grouped by category with
// a sticky search bar and category chips. Tap-to-call and tap-to-
// WhatsApp buttons open the device's native handlers. The data is
// fetched directly via Supabase (RLS gates visibility — only active
// services are returned to non-admins).
//
// No request/booking flow yet — residents arrange directly with the
// vendor. The admin curates the list.

function formatRate(p: number | null, unit: string | null, note: string | null): string {
  const amount = p === null ? '—' : `₹${(p / 100).toLocaleString('en-IN')}`;
  const u = unit ? ` ${unit}` : '';
  const n = note ? ` ${note}` : '';
  return `${amount}${u}${n}`;
}

function whatsappUrl(num: string): string {
  // Strip everything except digits + leading + so wa.me accepts it.
  const cleaned = num.replace(/[^\d+]/g, '').replace(/^\+/, '');
  return `https://wa.me/${cleaned}`;
}

function telUrl(num: string): string {
  return `tel:${num.replace(/\s+/g, '')}`;
}

function mailtoUrl(email: string): string {
  return `mailto:${email}`;
}

export default function DashboardServicesPage() {
  const [services, setServices] = useState<ServiceWithRates[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        // RLS filters this to is_active=true for residents.
        const [{ data: svcRows }, { data: rateRows }] = await Promise.all([
          supabase
            .from('services')
            .select('*')
            .order('display_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('service_rates')
            .select('*')
            .order('display_order', { ascending: true }),
        ]);
        if (cancelled) return;

        const byService = new Map<string, ServiceRate[]>();
        for (const r of (rateRows ?? []) as ServiceRate[]) {
          const list = byService.get(r.service_id) ?? [];
          list.push(r);
          byService.set(r.service_id, list);
        }
        const merged: ServiceWithRates[] = ((svcRows ?? []) as Service[]).map((s) => ({
          ...s,
          rates: byService.get(s.id) ?? [],
        }));
        setServices(merged);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => set.add(s.category));
    return Array.from(set).sort();
  }, [services]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (activeCategory !== 'all' && s.category !== activeCategory) return false;
      if (!q) return true;
      const haystack = [
        s.name,
        s.category,
        s.description ?? '',
        s.vendor_name ?? '',
        ...s.rates.map((r) => `${r.label} ${r.unit_label ?? ''} ${r.note ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [services, activeCategory, search]);

  // Group by category for the rendered list.
  const grouped = useMemo(() => {
    const map = new Map<string, ServiceWithRates[]>();
    for (const s of filtered) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-2">
        <Briefcase size={22} className="text-[#1B5E20]" />
        <h1 className="text-2xl font-bold text-gray-900">Services</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        Trusted vendors and indicative rates for the things residents ask about. Tap to call or WhatsApp directly.
      </p>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services, vendors, rates…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
        />
      </div>

      {categories.length > 0 && (
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
          <div className="flex gap-2 pb-1 min-w-max sm:flex-wrap">
            {['all', ...categories].map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeCategory === c
                    ? 'bg-[#1B5E20] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Briefcase className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-sm text-gray-500">
            {search.trim() ? `No services match "${search}".` : 'No services have been added yet. Check back later.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 px-1">
                {category}
                <span className="font-normal text-gray-400 ml-1">· {items.length}</span>
              </h2>
              <div className="grid grid-cols-1 gap-3">
                {items.map((s) => (
                  <ServiceCard key={s.id} service={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ service: s }: { service: ServiceWithRates }) {
  const hasContact = s.vendor_phone || s.vendor_whatsapp || s.vendor_email;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow">
      <div className="flex gap-3 p-4">
        {s.image_url ? (
          <img
            src={s.image_url}
            alt=""
            className="h-16 w-16 rounded-lg object-cover bg-gray-100 flex-shrink-0"
          />
        ) : (
          <div className="h-16 w-16 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center flex-shrink-0">
            <Briefcase size={24} className="text-[#1B5E20]" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 leading-tight">{s.name}</h3>
          {s.vendor_name && (
            <p className="text-xs text-gray-500 mt-0.5">By {s.vendor_name}</p>
          )}
          {s.description && (
            <p className="text-sm text-gray-600 mt-1.5 leading-snug">{s.description}</p>
          )}
        </div>
      </div>

      {s.rates.length > 0 && (
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-emerald-50/60 border border-emerald-100 divide-y divide-emerald-100">
            {s.rates.map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-gray-700 font-medium truncate">{r.label}</span>
                <span className="text-emerald-800 font-semibold whitespace-nowrap">
                  {formatRate(r.rate_paise, r.unit_label, r.note)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasContact && (
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {s.vendor_phone && (
            <a
              href={telUrl(s.vendor_phone)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1B5E20] text-white text-xs font-semibold rounded-lg hover:bg-[#154A1A] transition-colors"
            >
              <Phone size={12} />
              Call
            </a>
          )}
          {s.vendor_whatsapp && (
            <a
              href={whatsappUrl(s.vendor_whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] text-white text-xs font-semibold rounded-lg hover:bg-[#1EBE57] transition-colors"
            >
              <MessageCircle size={12} />
              WhatsApp
              <ArrowRight size={11} />
            </a>
          )}
          {s.vendor_email && (
            <a
              href={mailtoUrl(s.vendor_email)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Mail size={12} />
              Email
            </a>
          )}
        </div>
      )}
    </div>
  );
}
