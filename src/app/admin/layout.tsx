import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import TopBar from '@/components/layout/TopBar';
import { AuthProvider } from '@/hooks/useAuth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {/* See dashboard/layout.tsx for why `overflow-x-hidden` and `min-w-0`
          are both required here — wide admin tables (clubhouse, users,
          issues) used to push the entire page sideways and clip the topbar
          title and tab bar on phone viewports. */}
      <div className="flex h-full min-h-screen overflow-x-hidden">
        <Sidebar />
        <div className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen">
          <TopBar title="Admin Panel" />
          <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
        </div>
        <MobileNav />
      </div>
    </AuthProvider>
  );
}
