import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Box Codex | Platform Admin',
  description: 'Root platform administrative portal for Box Codex',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
