'use client';

import { useState, useEffect } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

interface HoldTimerProps {
  expiresAt: string;
  onExpire?: () => void;
}

export default function HoldTimer({ expiresAt, onExpire }: HoldTimerProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setSecondsRemaining(0);
        clearInterval(timer);
        if (onExpire) onExpire();
      } else {
        setSecondsRemaining(diff);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const isUrgent = secondsRemaining < 120; // Under 2 minutes

  if (secondsRemaining <= 0) {
    return (
      <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <span>Hold Expired — Slot has been released back to inventory</span>
      </div>
    );
  }

  return (
    <div
      className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
        isUrgent
          ? 'bg-red-950/40 border-red-500/50 text-red-300 hold-pulse'
          : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
      }`}
    >
      <div className="flex items-center gap-2">
        <Clock className={`w-4 h-4 ${isUrgent ? 'text-red-400' : 'text-emerald-400'}`} />
        <span className="text-xs font-medium">Slot Exclusively Reserved For You</span>
      </div>
      <div className="font-mono text-base font-bold tracking-wider">
        {formattedTime}
      </div>
    </div>
  );
}
