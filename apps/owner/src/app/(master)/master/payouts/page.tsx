'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { formatINR } from '@/lib/utils';
import { 
  Wallet, 
  CreditCard, 
  Calendar, 
  FileText, 
  AlertCircle, 
  CheckCircle, 
  Percent,
  TrendingDown,
  TrendingUp,
  Landmark
} from 'lucide-react';

interface OwnerStatement {
  master_owner_id: string;
  start_date: string | null;
  end_date: string | null;
  period_applied: boolean;
  ledger_balances: {
    owner_payable_net: number;
    gateway_clearing_net: number;
    platform_commission_net: number;
  };
  payouts: {
    settled_minor: number;
    planned_in_flight_minor: number;
    outstanding_payable_minor: number;
    owner_receivable_minor: number;
  };
}

export default function MasterOwnerPayouts() {
  const [summary, setSummary] = useState<any>(null);
  const [statement, setStatement] = useState<OwnerStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Financial account registration form state
  const [provider, setProvider] = useState('razorpay');
  const [accId, setAccId] = useState('');
  const [bankLabel, setBankLabel] = useState('');

  async function loadFinancialData() {
    try {
      const supabase = createBrowserClient('owner');
      const { data: context } = await supabase.rpc('get_my_context');
      const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

      if (masterOwnerId) {
        // 1. Summary
        const { data: sum } = await supabase.rpc('get_owner_financial_summary', {
          p_master_owner_id: masterOwnerId,
        });
        setSummary(sum);

        // 2. Statement
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

        const { data: stmt, error: stmtErr } = await supabase.rpc('get_owner_statement', {
          p_master_owner_id: masterOwnerId,
          p_start_date: start,
          p_end_date: end,
        });
        if (stmtErr) throw stmtErr;
        setStatement(stmt || null);
      }
    } catch (err) {
      console.error('Failed to load financial summary:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFinancialData();
  }, []);

  const handlePlanPayout = async () => {
    setPlanning(true);
    setFeedback(null);
    try {
      const supabase = createBrowserClient('owner');
      const { data: context } = await supabase.rpc('get_my_context');
      const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const end = now.toISOString();
      const idempotencyKey = 'plan-' + masterOwnerId + '-' + Date.now();

      const { data, error } = await supabase.rpc('plan_owner_payout', {
        p_master_owner_id: masterOwnerId,
        p_period_start: start,
        p_period_end: end,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      setFeedback({ type: 'success', text: 'Payout planned successfully. It is queued for platform release.' });
      loadFinancialData();
    } catch (err: unknown) {
      setFeedback({ type: 'error', text: extractDatabaseError(err, 'Failed to plan payout') });
    } finally {
      setPlanning(false);
    }
  };

  const handleRegisterAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    setFeedback(null);
    try {
      const supabase = createBrowserClient('owner');
      const { data: context } = await supabase.rpc('get_my_context');
      const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

      const { error } = await supabase.rpc('register_owner_financial_account', {
        p_master_owner_id: masterOwnerId,
        p_provider: provider,
        p_provider_account_id: accId,
        p_masked_bank_label: bankLabel,
        p_active: true,
      });

      if (error) throw error;
      setFeedback({ type: 'success', text: 'Financial account successfully registered.' });
      setAccId('');
      setBankLabel('');
      loadFinancialData();
    } catch (err: unknown) {
      setFeedback({ type: 'error', text: extractDatabaseError(err, 'Registration failed') });
    } finally {
      setRegistering(false);
    }
  };

  const isStatementEmpty = !statement || (
    statement.payouts.outstanding_payable_minor === 0 &&
    statement.payouts.settled_minor === 0 &&
    statement.payouts.planned_in_flight_minor === 0 &&
    statement.ledger_balances.gateway_clearing_net === 0 &&
    statement.ledger_balances.owner_payable_net === 0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Consolidated Payouts & Statements</h1>
          <p className="text-xs text-slate-400 mt-1">
            Track gross bookings, platform commissions, financial statements, and plan settlements.
          </p>
        </div>
        <button
          type="button"
          disabled={planning}
          onClick={handlePlanPayout}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
        >
          <Wallet className="w-4 h-4" /> {planning ? 'Planning...' : 'Plan Owner Payout'}
        </button>
      </div>

      {feedback && (
        <div className={`p-4 rounded-lg text-xs flex items-center gap-2 ${
          feedback.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {feedback.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Financial Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-xs font-semibold text-slate-400">Gross Volume</span>
          <p className="text-2xl font-bold text-slate-100 mt-2">
            {formatINR(summary?.gross_volume_minor ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Total revenue collected</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Platform Commission</span>
            <Percent className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-400 mt-2">
            {formatINR(summary?.commission_deducted_minor ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Contractual commission deduction</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-xs font-semibold text-slate-400">Settled Payouts</span>
          <p className="text-2xl font-bold text-emerald-400 mt-2">
            {formatINR(summary?.settled_payouts_minor ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Released to bank account</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-xs font-semibold text-slate-400">Eligible Balance</span>
          <p className="text-2xl font-bold text-blue-400 mt-2">
            {formatINR(summary?.eligible_payout_minor ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Available for next payout cycle</p>
        </div>
      </div>

      {/* Accounting Statement */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <h2 className="text-sm font-bold text-slate-100 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-400" />
          Ledger Accounting Statement
        </h2>
        {loading ? (
          <div className="text-xs text-slate-400">Loading statement...</div>
        ) : isStatementEmpty ? (
          <div className="text-xs text-slate-500 py-8 text-center border border-dashed border-slate-800 rounded-lg">
            No ledger transactions or financial balances recorded for this master owner account yet.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Ledger Balances */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Double-Entry Ledger Net Balances
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Gateway Clearing Net</span>
                  <p className="text-lg font-bold text-slate-100 mt-1">
                    {formatINR(statement.ledger_balances.gateway_clearing_net)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Total collected through payment gateway</p>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Platform Commission Net</span>
                  <p className="text-lg font-bold text-amber-400 mt-1">
                    {formatINR(statement.ledger_balances.platform_commission_net)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Contractual platform fee allocation</p>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Owner Payable Net</span>
                  <p className="text-lg font-bold text-emerald-400 mt-1">
                    {formatINR(Math.abs(statement.ledger_balances.owner_payable_net))}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Net balance owed to owner</p>
                </div>
              </div>
            </div>

            {/* Payouts Status */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Payout Settlement Lifecycle
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Outstanding Payable</span>
                  <p className="text-base font-bold text-slate-100 mt-1">
                    {formatINR(statement.payouts.outstanding_payable_minor)}
                  </p>
                </div>
                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Planned In-Flight</span>
                  <p className="text-base font-bold text-blue-400 mt-1">
                    {formatINR(statement.payouts.planned_in_flight_minor)}
                  </p>
                </div>
                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Settled Payouts</span>
                  <p className="text-base font-bold text-emerald-400 mt-1">
                    {formatINR(statement.payouts.settled_minor)}
                  </p>
                </div>
                <div className="p-4 bg-slate-950 border border-slate-850 rounded-lg">
                  <span className="text-xs text-slate-400">Owner Receivable</span>
                  <p className="text-base font-bold text-slate-400 mt-1">
                    {formatINR(statement.payouts.owner_receivable_minor)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Register Payout Account */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <h2 className="text-sm font-bold text-slate-100 mb-2 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-emerald-400" />
          Payout Banking Account
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Register an authorized settlement account for receiving planned owner payouts.
        </p>
        <form onSubmit={handleRegisterAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Provider</label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs"
              placeholder="e.g. razorpay"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Provider Account ID</label>
            <input
              type="text"
              required
              value={accId}
              onChange={(e) => setAccId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs"
              placeholder="acc_123456789"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Masked Bank Label</label>
            <input
              type="text"
              required
              value={bankLabel}
              onChange={(e) => setBankLabel(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs"
              placeholder="HDFC Bank •••• 4092"
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={registering}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg text-xs font-semibold transition disabled:opacity-50"
            >
              {registering ? 'Registering...' : 'Register Settlement Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
