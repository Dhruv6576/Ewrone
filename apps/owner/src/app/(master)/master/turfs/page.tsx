'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@boxcodex/shared';
import { MapPin, Plus, CheckCircle, Clock, AlertTriangle, Settings } from 'lucide-react';

export default function MasterOwnerTurfs() {
  const [turfs, setTurfs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTurfs() {
      try {
        const supabase = createBrowserClient('owner');
        const { data: context } = await supabase.rpc('get_my_context');
        const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

        if (masterOwnerId) {
          const { data } = await supabase
            .from('turfs')
            .select('id, name, slug, address_text, city, approval_status, created_at, resources(id, name)')
            .eq('master_owner_id', masterOwnerId)
            .is('archived_at', null)
            .order('created_at', { ascending: false });

          setTurfs(data || []);
        }
      } catch (err) {
        console.error('Failed to load turfs:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTurfs();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Turf Portfolio</h1>
          <p className="text-xs text-neutral-400 mt-1">
            Manage your multi-venue sports arenas, courts, and approval statuses.
          </p>
        </div>
        <Link
          href="/master/turfs/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-600 hover:bg-neutral-900 dark:bg-white text-white rounded-lg text-xs font-semibold transition"
        >
          <Plus className="w-4 h-4" /> Onboard New Venue
        </Link>
      </div>

      {loading ? (
        <div className="text-xs text-neutral-400">Loading portfolio turfs...</div>
      ) : turfs.length === 0 ? (
        <div className="p-8 text-center bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-400 text-xs">
          No active turfs in this portfolio. Click Onboard New Venue to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {turfs.map((turf) => (
            <div key={turf.id} className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="font-bold text-base text-neutral-100">{turf.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                    turf.approval_status === 'approved'
                      ? 'bg-neutral-900 dark:bg-white/10 text-neutral-200 border border-neutral-900 dark:border-white/20'
                      : turf.approval_status === 'pending'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}>
                    {turf.approval_status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-400 mb-4">
                  <MapPin className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                  <span className="truncate">{turf.address_text}, {turf.city}</span>
                </div>

                <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-lg mb-4">
                  <p className="text-[11px] font-semibold text-neutral-300 mb-1">
                    Playing Resources ({turf.resources?.length || 0})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {turf.resources?.map((r: any) => (
                      <span key={r.id} className="px-2 py-0.5 bg-neutral-800 text-neutral-300 text-[10px] rounded">
                        {r.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-800 flex items-center justify-between text-xs">
                <span className="text-neutral-500 text-[11px]">Slug: {turf.slug}</span>
                <Link
                  href={`/master/turfs/${turf.id}`}
                  className="text-neutral-200 hover:underline font-semibold flex items-center gap-1"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Hours & Pricing &rarr;
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
