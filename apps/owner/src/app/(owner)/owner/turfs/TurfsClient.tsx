'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Building2,
  MapPin,
  ExternalLink,
  Edit3,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Trash2
} from 'lucide-react';

interface TurfItem {
  id: string;
  name: string;
  slug: string;
  city: string;
  address_text: string;
  description: string;
  approval_status: string;
  version: number;
}

export default function TurfsClient() {
  const [turfs, setTurfs] = useState<TurfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTurf, setEditingTurf] = useState<TurfItem | null>(null);
  const [removingTurf, setRemovingTurf] = useState<TurfItem | null>(null);
  const [requestedRemovals, setRequestedRemovals] = useState<Record<string, boolean>>({});
  const [descInput, setDescInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const supabase = createBrowserClient('owner');

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const { data: caps, error: capsErr } = await supabase.rpc('get_my_capabilities');
        if (cancelled) return;
        if (capsErr || !caps?.master_owner_id) {
          throw new Error(capsErr?.message || 'Unauthorized or no master owner found');
        }

        const { data: turfData, error: turfErr } = await supabase
          .from('turfs')
          .select('id, name, slug, city, address_text, description, approval_status, version')
          .eq('master_owner_id', caps.master_owner_id)
          .order('name');

        if (cancelled) return;
        if (turfErr) throw turfErr;
        setTurfs((turfData as TurfItem[]) || []);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(extractDatabaseError(err, 'Failed to load venues'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    // Load requested removals from local storage
    try {
      const stored = localStorage.getItem('ewrone_requested_removals');
      if (stored) {
        setRequestedRemovals(JSON.parse(stored));
      }
    } catch (e) { }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadTurfs() {
    try {
      const { data: caps, error: capsErr } = await supabase.rpc('get_my_capabilities');
      if (capsErr || !caps?.master_owner_id) return;
      const { data: turfData } = await supabase
        .from('turfs')
        .select('id, name, slug, city, address_text, description, approval_status, version')
        .eq('master_owner_id', caps.master_owner_id)
        .order('name');
      if (turfData) {
        setTurfs(turfData as TurfItem[]);
      }
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to reload venues'));
    }
  }

  async function handleSaveOnboarding(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTurf) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(null);

    try {
      // Pass p_expected_version for optimistic concurrency control
      const { data: updated, error: rpcErr } = await supabase.rpc('update_turf_onboarding', {
        p_turf_id: editingTurf.id,
        p_expected_version: editingTurf.version,
        p_description: descInput,
        p_address_text: addressInput
      });

      if (rpcErr) throw rpcErr;

      setSaveSuccess(`Successfully updated ${editingTurf.name} (version ${updated.version})`);
      setEditingTurf(null);
      await reloadTurfs();
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to save turf onboarding'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestRemoval() {
    if (!removingTurf) return;
    setSaving(true);
    // Simulate API request to platform admin
    await new Promise(resolve => setTimeout(resolve, 800));

    // Persist request in local state
    const updatedRequests = { ...requestedRemovals, [removingTurf.id]: true };
    setRequestedRemovals(updatedRequests);
    try {
      localStorage.setItem('ewrone_requested_removals', JSON.stringify(updatedRequests));
    } catch (e) { }

    setSaveSuccess(`Removal request for "${removingTurf.name}" has been submitted to the platform admins.`);
    setRemovingTurf(null);
    setSaving(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-neutral-200/50 dark:bg-neutral-800 rounded-lg" />
        <div className="h-64 bg-neutral-200/50 dark:bg-neutral-800/40 rounded-2xl" />
      </div>
    );
  }

  const activeTurfs = turfs.filter((t) => !requestedRemovals[t.id]);
  const removalRequestedTurfs = turfs.filter((t) => requestedRemovals[t.id]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Building2 className="w-6 h-6 text-neutral-900 dark:text-white" />
            Venues & Arenas
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Manage your registered turf properties, listings, and onboarding configurations.
          </p>
        </div>
        <Link
          href="/owner/turfs/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-900 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-neutral-900 transition-colors shadow-lg shadow-neutral-900/10"
        >
          <PlusCircle className="w-4 h-4" />
          Add Venue
        </Link>
      </div>

      {saveSuccess && (
        <div className="p-4 bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/20 rounded-xl text-neutral-200 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}



      {/* Turf Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {turfs.map((t, index) => {
          // Use only verified working Unsplash sports venue images
          const COVER_IMAGES = [
            'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&q=80&w=600&h=300',
            'https://images.unsplash.com/photo-1459865264687-595d652de67e?auto=format&fit=crop&q=80&w=600&h=300'
          ];
          const imageUrl = COVER_IMAGES[index % COVER_IMAGES.length];

          return (
            <div
              key={t.id}
              className="p-4 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-2xl hover:border-neutral-400 dark:hover:border-neutral-700 transition-all flex flex-col justify-between shadow-sm group"
            >
              <div>
                {/* Mandatory Cover Image */}
                <div className="relative w-full h-44 mb-5 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                  <div className="absolute inset-0 bg-neutral-900/10 group-hover:bg-transparent transition-colors z-10" />
                  <img src={imageUrl} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  
                  {/* Status Badge overlayed on image for premium feel */}
                  <div className="absolute top-3 right-3 z-20">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-md border ${
                        t.approval_status === 'approved'
                          ? 'bg-green-500/90 text-white border-green-400/50'
                          : 'bg-amber-500/90 text-white border-amber-400/50'
                      }`}
                    >
                      {t.approval_status}
                    </span>
                  </div>
                </div>

                <div className="px-2">
                  <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">{t.name}</h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5 mb-3">
                    <MapPin className="w-3.5 h-3.5 text-neutral-500" />
                    {t.address_text || t.city}
                  </p>
                  {t.description && (
                    <p className="text-[13px] text-neutral-600 dark:text-neutral-300 line-clamp-2 mb-4 leading-relaxed">{t.description}</p>
                  )}
                </div>
              </div>

              <div className="pt-4 mt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-end text-xs px-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/owner/turfs/${t.id}/edit`}
                    className="p-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors inline-block"
                    title="Edit Venue Details"
                  >
                    <Edit3 className="w-4 h-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setRemovingTurf(t)}
                    className="p-2 text-neutral-500 dark:text-neutral-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                    title="Request Removal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Removal Requests Section */}
      {removalRequestedTurfs.length > 0 && (
        <div className="pt-8 mt-12 border-t border-neutral-300 dark:border-neutral-800/80 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-500" />
              Removal Requests
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              Venues that are pending deletion review by platform administrators.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {removalRequestedTurfs.map((t) => (
              <div
                key={t.id}
                className="p-6 bg-neutral-200/50 dark:bg-neutral-900/40 border border-rose-500/20 rounded-2xl flex flex-col justify-between opacity-80"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="text-lg font-bold text-neutral-900 dark:text-white line-through decoration-rose-500/50">{t.name}</h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase tracking-wider">
                      Pending Deletion
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5 mb-2">
                    <MapPin className="w-3.5 h-3.5 text-neutral-500" />
                    {t.address_text || t.city}
                  </p>
                </div>

              </div>
            ))}
          </div>
        </div>
      )}
    {/* Removal Confirmation Popup Modal */}
      {removingTurf && (
        <div className="fixed top-0 left-0 w-screen h-screen z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all flex flex-col">
            <div className="p-6">
              <h2 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2 mb-3">
                <Trash2 className="w-5 h-5 text-rose-500" />
                Request Venue Removal
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Are you sure you want to request the removal of <strong className="text-neutral-900 dark:text-white">{removingTurf.name}</strong> from the platform? This action will notify the platform administrators.
              </p>
            </div>
            
            <div className="px-6 py-4 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRemovingTurf(null)}
                className="px-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-sm font-semibold rounded-xl transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestRemoval}
                disabled={saving}
                className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm shadow-rose-500/20"
              >
                {saving ? 'Requesting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
