import Navbar from '@/components/Navbar';

export default function PlayerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
