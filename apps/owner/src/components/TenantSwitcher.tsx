'use client';

import { useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import type { MasterOwnerAccount } from '@boxcodex/shared';

interface TenantSwitcherProps {
  accounts: MasterOwnerAccount[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function TenantSwitcher({ accounts, activeId, onSelect }: TenantSwitcherProps) {
  const [open, setOpen] = useState(false);
  const activeAccount = accounts.find((a) => a.id === activeId) || accounts[0];

  if (!accounts || accounts.length === 0) return null;

  if (accounts.length === 1) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg">
        <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="truncate">
          <p className="text-xs font-semibold text-slate-200 truncate">{activeAccount.business_name}</p>
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded">
            Tenant Principal
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-left transition"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="truncate">
            <p className="text-xs font-semibold text-slate-200 truncate">{activeAccount.business_name}</p>
            <span className="text-[10px] text-slate-400">Switch Tenant ({accounts.length})</span>
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-slate-900 border border-slate-800 rounded-lg shadow-xl overflow-hidden">
            <div className="p-1">
              {accounts.map((acc) => {
                const isSelected = acc.id === activeId;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => {
                      onSelect(acc.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-md transition ${
                      isSelected
                        ? 'bg-emerald-500/10 text-emerald-400 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">{acc.business_name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
