'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Megaphone, Calendar, Bookmark, Images, Radio, Newspaper, ChevronRight, Pin } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import type { Announcement, Event, Broadcast } from '@/types';

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
    { href: '/dashboard/gallery', icon: Images, label: 'Gallery', color: 'bg-pink-100 text-pink-700' },
    { href: '/dashboard/broadcasts', icon: Radio, label: 'Broadcasts', color: 'bg-green-100 text-green-700' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-[#1B5E20] text-white px-6 py-6 md:rounded-b-3xl">
        <p className="text-white/70 text-sm" suppressHydrationWarning>{greeting},</p>
        <h1 className="text-2xl font-bold" suppressHydrationWarning>{mounted ? (profile?.full_name || 'Resident') : 'Resident'}</h1>
        {mounted && profile?.flat_number && <p className="text-white/70 text-sm">Flat {profile.flat_number}</p>}
        {isAdmin && (
          <Link href="/admin" className="inline-flex items-center gap-1 mt-2 bg-yellow-400 text-[#1B5E20] text-xs font-bold px-3 py-1 rounded-full">
            Admin Dashboard →
          </Link>
        )}
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Quick Links */}
        <div className="grid grid-cols-5 gap-2">
          {quickLinks.map(({ href, icon: Icon, label, color }) => (
            <Link key={href} href={href} className="flex flex-col items-center gap-2 p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}><Icon size={20} /></div>
              <span className="text-[10px] font-semibold text-gray-700 text-center leading-tight">{label}</span>
            </Link>
          ))}
        </div>

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
            <p className="text-gray-400 text-sm text-center py-4">No announcements yet</p>
          ) : (
            <div className="space-y-2">
              {announcements.map((a) => (
                <div key={a.id} className={`bg-white rounded-xl p-4 shadow-sm ${a.is_pinned ? 'border-l-4 border-yellow-400' : ''}`}>
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
            <p className="text-gray-400 text-sm text-center py-4">No upcoming events</p>
          ) : (
            <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="font-semibold text-sm text-gray-900">{e.title}</p>
                  <div className="flex gap-4 mt-2">
                    <span className="text-xs text-gray-500">{format(new Date(e.date), 'dd MMM')} · {e.time}</span>
                    <span className="text-xs text-gray-500">{e.location}</span>
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
