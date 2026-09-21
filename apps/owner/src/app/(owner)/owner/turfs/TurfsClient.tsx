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
  AlertCircle
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

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-slate-800 rounded-lg" />
        <div className="h-64 bg-slate-800/40 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Building2 className="w-6 h-6 text-emerald-400" />
            Venues & Arenas
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage your registered turf properties, listings, and onboarding configurations.
          </p>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-3">
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

      {/* Editing Modal / Drawer */}
      {editingTurf && (
        <div className="p-6 bg-slate-900/90 border border-slate-700/60 rounded-2xl shadow-xl space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-emerald-400" />
            Edit Onboarding: {editingTurf.name}
          </h2>
          <form onSubmit={handleSaveOnboarding} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Address
              </label>
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950/70 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                placeholder="100 Stadium Road, Sector 5..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                value={descInput}
                onChange={(e) => setDescInput(e.target.value)}
                rows={3}
                className="w-full px-3.5 py-2.5 bg-slate-950/70 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                placeholder="Premier box cricket turf with LED floodlights..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingTurf(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Turf Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {turfs.map((t) => (
          <div
            key={t.id}
            className="p-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl hover:border-slate-700/80 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-lg font-bold text-white">{t.name}</h3>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    t.approval_status === 'approved'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}
                >
                  {t.approval_status}
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-2">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                {t.address_text || t.city}
              </p>
              {t.description && (
                <p className="text-xs text-slate-300 line-clamp-2 mb-4">{t.description}</p>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-mono">v{t.version}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingTurf(t);
                    setDescInput(t.description || '');
                    setAddressInput(t.address_text || '');
                  }}
                  className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                  title="Edit Onboarding Details"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <Link
                  href={`/turfs/${t.slug}`}
                  target="_blank"
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  title="View Public Listing"
                >
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
