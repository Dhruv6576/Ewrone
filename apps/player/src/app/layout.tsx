import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Box Codex — Live Turf Arena & Box Cricket Booking',
  description: 'Real-time venue slot reservations with instant locks and Razorpay payment orchestration.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
