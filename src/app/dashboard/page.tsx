'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Megaphone, Calendar, Bookmark, Images, Radio, ChevronRight, Pin, Briefcase } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import type { Announcement, Event, Broadcast } from '@/types';
import NearbyPill from '@/components/dashboard/NearbyPill';
import OnDutyCard from '@/components/dashboard/OnDutyCard';

export default function DashboardPage() {
  const { profile, isAdmin, mounted } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [greeting, setGreeting] = useState('Welcome');
  const supabase = createClient();

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening');
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      const [a, e, b] = await Promise.all([
        supabase.from('announcements').select('*, profiles(full_name)').order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(3),
        supabase.from('events').select('*').gte('date', new Date().toISOString().split('T')[0]).order('date').limit(3),
        supabase.from('broadcasts').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(3),
      ]);
      if (a.data) setAnnouncements(a.data);
      if (e.data) setEvents(e.data);
      if (b.data) setBroadcasts(b.data);
    };
    fetchAll();
  }, []);

  const quickLinks = [
    { href: '/dashboard/announcements', icon: Megaphone, label: 'Announcements', color: 'bg-purple-100 text-purple-700' },
    { href: '/dashboard/events', icon: Calendar, label: 'Events', color: 'bg-orange-100 text-orange-700' },
    { href: '/dashboard/bookings', icon: Bookmark, label: 'Bookings', color: 'bg-blue-100 text-blue-700' },
    { href: '/dashboard/services', icon: Briefcase, label: 'Services', color: 'bg-emerald-100 text-emerald-700' },
    { href: '/dashboard/gallery', icon: Images, label: 'Gallery', color: 'bg-pink-100 text-pink-700' },
    { href: '/dashboard/broadcasts', icon: Radio, label: 'Broadcasts', color: 'bg-green-100 text-green-700' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header — community photo with a green gradient overlay so the existing
          white text still reads cleanly. The image uses next/image fill so it
          scales correctly on every viewport. */}
      <div className="relative h-44 md:h-60 overflow-hidden md:rounded-b-3xl bg-[#1B5E20]">
        <Image
          src="/community.webp"
          alt="Aaditri Emerland community"
          fill
          priority
          sizes="(min-width: 768px) 896px, 100vw"
          className="object-cover"
        />
        {/* Brand-color overlay: darker at the bottom for legibility, semi at the
            top so the photo still feels present. */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A3D02]/90 via-[#1B5E20]/65 to-[#1B5E20]/40" />

        <div className="relative h-full flex flex-col justify-end text-white px-6 pb-5">
          <p className="text-white/85 text-sm drop-shadow-sm" suppressHydrationWarning>{greeting},</p>
          <h1 className="text-2xl font-bold drop-shadow-sm" suppressHydrationWarning>
            {mounted ? (profile?.full_name || 'Resident') : 'Resident'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {mounted && profile?.flat_number && (
              <span className="inline-flex items-center bg-white/20 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-0.5 rounded-full border border-white/20">
                Flat {profile.flat_number}
              </span>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1 bg-yellow-400 text-[#1B5E20] text-xs font-bold px-3 py-1 rounded-full hover:bg-yellow-300 transition-colors"
              >
                Admin Dashboard →
              </Link>
            )}
            {/* Slim location-aware pill: city + temp + AQI, links to the
                full News page. Lives in the hero so it's at-a-glance but
                takes a single row, not a whole section. */}
            {mounted && <NearbyPill />}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Quick Links — 3 columns on mobile (2 rows of 3) so each tile has
            real estate; 6 across on tablet+ where there's room for one row. */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {quickLinks.map(({ href, icon: Icon, label, color }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-2 p-3 bg-white rounded-2xl border border-gray-100 hover:border-[#1B5E20]/30 hover:shadow-sm transition-all"
            >
              <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center`}>
                <Icon size={20} />
              </div>
              <span className="text-xs font-semibold text-gray-700 text-center leading-tight">{label}</span>
            </Link>
          ))}
        </div>

        {/* On-duty card — only renders when at least one guard or
            housekeeper is checked in. Auto-hides otherwise so the
            common "weekend morning" case doesn't show an empty
            section. */}
        <OnDutyCard />

        {/* Broadcasts */}
        {broadcasts.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900 flex items-center gap-2"><Radio size={16} className="text-[#1B5E20]" />Broadcasts</h2>
              <Link href="/dashboard/broadcasts" className="text-xs text-[#1B5E20] font-semibold flex items-center">See all <ChevronRight size={14} /></Link>
            </div>
            <div className="space-y-2">
              {broadcasts.map((b) => (
                <div key={b.id} className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="font-semibold text-sm text-gray-900">{b.title}</p>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{b.message}</p>
                  <p className="text-xs text-gray-400 mt-2">{format(new Date(b.created_at), 'dd MMM yyyy')}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Announcements */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Megaphone size={16} className="text-[#1B5E20]" />Announcements</h2>
            <Link href="/dashboard/announcements" className="text-xs text-[#1B5E20] font-semibold flex items-center">See all <ChevronRight size={14} /></Link>
          </div>
          {announcements.length === 0 ? (
            <div className="text-center py-6 bg-white rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
              No announcements yet
            </div>
          ) : (
            <div className="space-y-2">
              {announcements.map((a) => (
                <div key={a.id} className={`bg-white rounded-xl p-4 border border-gray-200 hover:shadow-sm transition-shadow ${a.is_pinned ? 'border-l-4 border-l-yellow-400' : ''}`}>
                  {a.is_pinned && <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold mb-1"><Pin size={10} />Pinned</span>}
                  <p className="font-semibold text-sm text-gray-900 line-clamp-1">{a.title}</p>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{a.content}</p>
                  <p className="text-xs text-gray-400 mt-2">{format(new Date(a.created_at), 'dd MMM yyyy')}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Events */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Calendar size={16} className="text-[#1B5E20]" />Upcoming Events</h2>
            <Link href="/dashboard/events" className="text-xs text-[#1B5E20] font-semibold flex items-center">See all <ChevronRight size={14} /></Link>
          </div>
          {events.length === 0 ? (
            <div className="text-center py-6 bg-white rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
              No upcoming events
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className="bg-white rounded-xl p-4 border border-gray-200 hover:shadow-sm transition-shadow">
                  <p className="font-semibold text-sm text-gray-900">{e.title}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={12} className="text-gray-400" />
                      {format(new Date(e.date), 'dd MMM')} &middot; {e.time}
                    </span>
                    {e.location && <span>{e.location}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
