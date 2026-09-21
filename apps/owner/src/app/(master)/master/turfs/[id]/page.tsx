'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Building2,
  Clock,
  BadgePercent,
  Plus,
  Save,
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  Calendar,
  Layers,
  IndianRupee
} from 'lucide-react';
import { formatINR } from '@/lib/utils';

interface ResourceItem {
  id: string;
  name: string;
  active: boolean;
  booking_increment_minutes: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
}

interface TurfDetail {
  id: string;
  name: string;
  slug: string;
  city: string;
  address_text: string;
  approval_status: string;
  resources: ResourceItem[];
}

interface PricingRule {
  id: string;
  resource_id: string;
  priority: number;
  valid_from: string;
  valid_until: string | null;
  iso_weekdays: number[];
  starts_local: string;
  ends_local: string;
  amount_per_increment_minor: number;
  currency: string;
  active: boolean;
}

const ISO_WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
];

export default function TurfDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const turfId = resolvedParams.id;

  const supabase = createBrowserClient('owner');

  const [turf, setTurf] = useState<TurfDetail | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Operating Hours Form State
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('23:00');
  const [savingHours, setSavingHours] = useState(false);

  // New Pricing Rule Form State
  const [showNewRuleModal, setShowNewRuleModal] = useState(false);
  const [ruleAmountMinor, setRuleAmountMinor] = useState(50000);
  const [ruleStarts, setRuleStarts] = useState('06:00');
  const [ruleEnds, setRuleEnds] = useState('23:00');
  const [rulePriority, setRulePriority] = useState(0);
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => {
    async function loadTurfData() {
      try {
        setLoading(true);
        setError(null);

        const { data: turfData, error: turfErr } = await supabase
          .from('turfs')
          .select('id, name, slug, city, address_text, approval_status, resources(id, name, active, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes)')
          .eq('id', turfId)
          .single();

        if (turfErr) throw turfErr;
        setTurf(turfData as TurfDetail);

        if (turfData.resources && turfData.resources.length > 0) {
          const firstResId = turfData.resources[0].id;
          setSelectedResourceId(firstResId);
          await loadPricingRules(firstResId);
        }
      } catch (err: unknown) {
        setError(extractDatabaseError(err, 'Failed to load venue details'));
      } finally {
        setLoading(false);
      }
    }

    loadTurfData();
  }, [turfId]);

  async function loadPricingRules(resourceId: string) {
    try {
      const { data, error: priceErr } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('resource_id', resourceId)
        .order('priority', { ascending: false });

      if (priceErr) throw priceErr;
      setPricingRules((data as PricingRule[]) || []);
    } catch (err: unknown) {
      console.error('Error loading pricing rules:', err);
    }
  }

  const handleSelectResource = async (resId: string) => {
    setSelectedResourceId(resId);
    await loadPricingRules(resId);
  };

  const handleSaveHours = async () => {
    if (!selectedResourceId) return;
    setSavingHours(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const hoursPayload = ISO_WEEKDAYS.map(({ day }) => ({
        iso_weekday: day,
        opens_at: `${openTime}:00`,
        closes_at: `${closeTime}:00`,
        closes_next_day: false,
      }));

      const { error: hoursErr } = await supabase.rpc('set_resource_operating_hours', {
        p_resource_id: selectedResourceId,
        p_hours: hoursPayload,
      });

      if (hoursErr) throw hoursErr;
      setSuccessMsg('Operating hours updated and slots auto-materialized successfully.');
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to update operating hours'));
    } finally {
      setSavingHours(false);
    }
  };

  const handleCreatePricingRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResourceId) return;
    setSavingRule(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const { error: rpcErr } = await supabase.rpc('upsert_pricing_rule', {
        p_rule_id: null,
        p_resource_id: selectedResourceId,
        p_valid_from: todayStr,
        p_valid_until: null,
        p_iso_weekdays: [1, 2, 3, 4, 5, 6, 7],
        p_starts_local: `${ruleStarts}:00`,
        p_ends_local: `${ruleEnds}:00`,
        p_amount_per_increment_minor: ruleAmountMinor,
        p_priority: rulePriority,
        p_active: true,
      });

      if (rpcErr) throw rpcErr;
      setSuccessMsg('Pricing rule added successfully.');
      setShowNewRuleModal(false);
      await loadPricingRules(selectedResourceId);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to save pricing rule'));
    } finally {
      setSavingRule(false);
    }
  };

  if (loading) {
    return <div className="text-xs text-slate-400">Loading venue configurations...</div>;
  }

  if (!turf) {
    return (
      <div className="p-6 text-center text-xs text-red-400">
        Venue not found or access denied.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl pb-16">
      {/* Back Button & Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/master/turfs"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-2 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Turf Portfolio
          </Link>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-emerald-400" />
            {turf.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {turf.address_text}, {turf.city} &bull; Status:{' '}
            <span className="text-emerald-400 uppercase font-semibold">{turf.approval_status}</span>
          </p>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="p-4 rounded-xl text-xs flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl text-xs flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Resource Selection Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <span className="text-xs text-slate-400 font-semibold mr-2 flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" /> Courts:
        </span>
        {turf.resources.map((res) => (
          <button
            key={res.id}
            type="button"
            onClick={() => handleSelectResource(res.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              selectedResourceId === res.id
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {res.name}
          </button>
        ))}
      </div>

      {/* Section 1: Operating Hours Configuration */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              Operating Hours & Auto-Slot Generation
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Updating operating hours regenerates playable booking slots for the next 14 days.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Opens At (IST)</label>
            <input
              type="time"
              value={openTime}
              onChange={(e) => setOpenTime(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Closes At (IST)</label>
            <input
              type="time"
              value={closeTime}
              onChange={(e) => setCloseTime(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={savingHours || !selectedResourceId}
            onClick={handleSaveHours}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {savingHours ? 'Saving & Generating Slots...' : 'Save Operating Hours'}
          </button>
        </div>
      </div>

      {/* Section 2: Pricing Rules Configuration */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <BadgePercent className="w-4 h-4 text-amber-400" />
              Active Pricing Rules
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configured pricing rules for this court. At least one active rule is required for quoting and bookings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewRuleModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" /> Add Pricing Rule
          </button>
        </div>

        {pricingRules.length === 0 ? (
          <div className="p-6 text-center text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            No active pricing rules found for this court. Quotes and bookings will fail with PRICING_NOT_CONFIGURED.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2 font-semibold">Priority</th>
                  <th className="pb-2 font-semibold">Time Window</th>
                  <th className="pb-2 font-semibold">Days</th>
                  <th className="pb-2 font-semibold">Rate (Per Increment)</th>
                  <th className="pb-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {pricingRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 font-mono text-slate-300">P{rule.priority}</td>
                    <td className="py-2.5 text-slate-200">
                      {rule.starts_local} - {rule.ends_local}
                    </td>
                    <td className="py-2.5 text-slate-400">
                      {rule.iso_weekdays.length === 7 ? 'All Week' : `${rule.iso_weekdays.length} days`}
                    </td>
                    <td className="py-2.5 font-medium text-emerald-400">
                      {formatINR(rule.amount_per_increment_minor)}
                    </td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        rule.active
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {rule.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add Pricing Rule */}
      {showNewRuleModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <BadgePercent className="w-4 h-4 text-emerald-400" />
              Add Pricing Rule
            </h3>

            <form onSubmit={handleCreatePricingRule} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Rate Per Increment (Minor Units / Paise)
                </label>
                <div className="relative">
                  <IndianRupee className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="number"
                    step="1000"
                    min="0"
                    required
                    value={ruleAmountMinor}
                    onChange={(e) => setRuleAmountMinor(parseInt(e.target.value) || 0)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  50000 minor units = {formatINR(50000)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Starts Local</label>
                  <input
                    type="time"
                    required
                    value={ruleStarts}
                    onChange={(e) => setRuleStarts(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Ends Local</label>
                  <input
                    type="time"
                    required
                    value={ruleEnds}
                    onChange={(e) => setRuleEnds(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Priority</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={rulePriority}
                  onChange={(e) => setRulePriority(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewRuleModal(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRule}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {savingRule ? 'Saving...' : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
