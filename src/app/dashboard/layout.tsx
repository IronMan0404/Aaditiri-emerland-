import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import TopBar from '@/components/layout/TopBar';
import GlobalSearch from '@/components/layout/GlobalSearch';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import PushSubscriber from '@/components/pwa/PushSubscriber';
import { AuthProvider } from '@/hooks/useAuth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {/* `overflow-x-hidden` on the root prevents the entire viewport from
          scrolling sideways when a child (e.g. a wide admin table) bursts
          its container. Tables that legitimately need to scroll horizontally
          should opt in locally via `overflow-x-auto`. */}
      <div className="flex h-full min-h-screen overflow-x-hidden">
        <Sidebar />
        {/* `min-w-0` is critical on this flex child: without it the column
            can grow as wide as its widest descendant, causing the entire
            page (header, tabs, tables) to spill off the right edge of the
            phone viewport and clip on the left. */}
        <div className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen">
          <TopBar />
          {/* Global search lives just under the header on every dashboard page,
              per customer request (Apr 2026): users wanted a single place to
              type "gym" or "plumbing" and find related content fast. */}
          <div className="px-4 pt-3 pb-1 bg-gray-50 sticky top-[52px] md:top-0 z-20 md:relative">
            <GlobalSearch />
          </div>
          <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
        </div>
        <MobileNav />
        <InstallPrompt />
        <PushSubscriber />
      </div>
    </AuthProvider>
  );
}
