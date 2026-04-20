import { createServerSupabaseClient } from '@/lib/supabase-server';
import Link from 'next/link';
import { Users, Megaphone, Calendar, Bookmark, Images, Radio, Newspaper, Shield, Bot, FileClock, Wallet, Award } from 'lucide-react';

async function getStats() {
  const supabase = await createServerSupabaseClient();
  const [users, announcements, events, bookings, pendingBookings, photos, broadcasts] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('announcements').select('*', { count: 'exact', head: true }),
    supabase.from('events').select('*', { count: 'exact', head: true }),
    supabase.from('bookings').select('*', { count: 'exact', head: true }),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('photos').select('*', { count: 'exact', head: true }),
    supabase.from('broadcasts').select('*', { count: 'exact', head: true }),
  ]);
  return {
    users: users.count || 0, announcements: announcements.count || 0, events: events.count || 0,
    bookings: bookings.count || 0, pendingBookings: pendingBookings.count || 0,
    photos: photos.count || 0, broadcasts: broadcasts.count || 0,
  };
}

export default async function AdminDashboard() {
  const stats = await getStats();

  const statCards = [
    { label: 'Total Residents', value: stats.users, icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Announcements', value: stats.announcements, icon: Megaphone, color: 'bg-purple-50 text-purple-600' },
    { label: 'Events', value: stats.events, icon: Calendar, color: 'bg-orange-50 text-orange-600' },
    { label: 'Pending Bookings', value: stats.pendingBookings, icon: Bookmark, color: stats.pendingBookings > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600' },
    { label: 'Total Bookings', value: stats.bookings, icon: Bookmark, color: 'bg-teal-50 text-teal-600' },
    { label: 'Photos Shared', value: stats.photos, icon: Images, color: 'bg-pink-50 text-pink-600' },
    { label: 'Broadcasts', value: stats.broadcasts, icon: Radio, color: 'bg-green-50 text-green-600' },
  ];

  const quickActions = [
    { label: 'Manage Users', icon: Users, href: '/admin/users', desc: 'View & manage residents' },
    { label: 'Bot Messages', icon: Bot, href: '/admin/messages', desc: 'Send as Aaditri Bot' },
    { label: 'Community Updates', icon: Newspaper, href: '/admin/updates', desc: 'Post community updates' },
    { label: 'Review Bookings', icon: Bookmark, href: '/dashboard/bookings', desc: 'Approve/reject bookings' },
    { label: 'Post Announcement', icon: Megaphone, href: '/dashboard/announcements', desc: 'Notify all residents' },
    { label: 'Send Broadcast', icon: Radio, href: '/dashboard/broadcasts', desc: 'Community-wide messages' },
    { label: 'Create Event', icon: Calendar, href: '/dashboard/events', desc: 'Schedule community events' },
    { label: 'Audit Log', icon: FileClock, href: '/admin/audit', desc: 'Who changed what & when' },
    { label: 'Manage Funds', icon: Wallet, href: '/admin/funds', desc: 'Verify contributions, record spends' },
    { label: 'Association Tags', icon: Award, href: '/admin/tags', desc: 'President, VP, Secretary, Treasurer' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-[#1B5E20] rounded-xl flex items-center justify-center"><Shield size={20} className="text-white" /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm text-gray-500">Aaditri Emerland Management</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 shadow-sm">
            <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-3`}><Icon size={20} /></div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {quickActions.map(({ label, icon: Icon, href, desc }) => (
          <Link key={href} href={href} className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center mb-3"><Icon size={20} className="text-[#1B5E20]" /></div>
            <div className="font-semibold text-sm text-gray-900">{label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
