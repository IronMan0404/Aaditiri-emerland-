import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import TopBar from '@/components/layout/TopBar';
import { AuthProvider } from '@/hooks/useAuth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex h-full min-h-screen">
        <Sidebar />
        <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
          <TopBar title="Admin Panel" />
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
        </div>
        <MobileNav />
      </div>
    </AuthProvider>
  );
}
