'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Ban, 
  Check, 
  AlertCircle, 
  Clock,
  Copy,
  CheckCircle2,
  Edit2
} from 'lucide-react';

const RECONCILED_CAPABILITIES = [
  { code: 'audit.read', label: 'View Activity Log' },
  { code: 'bookings.read', label: 'View Reservations' },
  { code: 'bookings.create_walkin', label: 'Record Walk-in' },
  { code: 'bookings.manage', label: 'Manage Operations' },
  { code: 'bookings.cancel', label: 'Cancel Reservations' },
  { code: 'calendar.read', label: 'View Calendar' },
  { code: 'slots.block', label: 'Manage Slot Blocks' },
  { code: 'payments.record_offline', label: 'Record Cash Payments' },
  { code: 'pricing.read', label: 'View Pricing Rules' },
  { code: 'pricing.edit', label: 'Modify Pricing Rules' },
  { code: 'finance.read', label: 'Financial Statements' },
  { code: 'refunds.issue', label: 'Authorize Refund' },
  { code: 'turf.read', label: 'View Venue Details' },
  { code: 'listing.edit', label: 'Edit Venue Listing' },
] as const;

export default function MasterOwnerTeam() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [turfs, setTurfs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedTurfIds, setSelectedTurfIds] = useState<string[]>([]);
  const [selectedCaps, setSelectedCaps] = useState<string[]>(['bookings.read', 'bookings.create_walkin', 'calendar.read']);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [newInviteLink, setNewInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Edit Assignments Modal
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [editTurfId, setEditTurfId] = useState<string>('');
  const [editCaps, setEditCaps] = useState<string[]>([]);
  const [savingAssignments, setSavingAssignments] = useState(false);

  async function loadData() {
    try {
      const supabase = createBrowserClient('owner');
      const { data: context } = await supabase.rpc('get_my_context');
      const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

      if (masterOwnerId) {
        // 1. Employees with assignments
        const { data: emps } = await supabase
          .from('employees')
          .select('id, user_id, status, created_at, employee_turf_assignments(id, turf_id, active, private_assignment_grants:private_assignment_grants(capability))')
          .eq('master_owner_id', masterOwnerId);

        setEmployees(emps || []);

        // 2. Pending Invites
        const { data: invs } = await supabase.rpc('get_pending_employee_invites', {
          p_master_owner_id: masterOwnerId,
        });
        setInvites(invs || []);

        // 3. Turfs for assignment
        const { data: tfs } = await supabase
          .from('turfs')
          .select('id, name')
          .eq('master_owner_id', masterOwnerId)
          .is('archived_at', null);
        setTurfs(tfs || []);
      }
    } catch (err) {
      console.error('Failed to load staff data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    setNewInviteLink(null);

    try {
      const supabase = createBrowserClient('owner');
      const { data: context } = await supabase.rpc('get_my_context');
      const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

      const { data: inviteRes, error } = await supabase.rpc('invite_employee', {
        p_master_owner_id: masterOwnerId,
        p_email: inviteEmail.trim(),
        p_turf_ids: selectedTurfIds.length > 0 ? selectedTurfIds : turfs.map((t) => t.id),
        p_capabilities: selectedCaps,
      });

      if (error) throw error;

      const token = inviteRes?.token;
      if (token) {
        const inviteUrl = `${window.location.origin}/invite?token=${encodeURIComponent(token)}`;
        setNewInviteLink(inviteUrl);
      }

      setFeedback('Invitation generated successfully.');
      setShowInviteModal(false);
      setInviteEmail('');
      loadData();
    } catch (err: unknown) {
      setFeedback(extractDatabaseError(err, 'Invite failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async (employeeId: string) => {
    if (!confirm('Are you sure you want to disable this employee?')) return;
    try {
      const supabase = createBrowserClient('owner');
      const { error } = await supabase.rpc('disable_employee', {
        p_employee_id: employeeId,
      });
      if (error) throw error;
      loadData();
    } catch (err: unknown) {
      alert(extractDatabaseError(err, 'Disable failed'));
    }
  };

  const handleOpenEditAssignments = (emp: any) => {
    setEditingEmployee(emp);
    const firstAssignment = emp.employee_turf_assignments?.[0];
    const initialTurf = firstAssignment?.turf_id || turfs[0]?.id || '';
    setEditTurfId(initialTurf);

    const caps = firstAssignment?.private_assignment_grants?.map((g: any) => g.capability) || [];
    setEditCaps(caps);
  };

  const handleSaveAssignments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee || !editTurfId) return;

    setSavingAssignments(true);
    try {
      const supabase = createBrowserClient('owner');
      const { error } = await supabase.rpc('update_employee_assignments', {
        p_employee_id: editingEmployee.id,
        p_turf_id: editTurfId,
        p_capabilities: editCaps,
        p_active: true,
      });

      if (error) throw error;
      setEditingEmployee(null);
      setFeedback('Employee assignments updated.');
      loadData();
    } catch (err: unknown) {
      alert(extractDatabaseError(err, 'Failed to update assignments'));
    } finally {
      setSavingAssignments(false);
    }
  };

  const copyInviteLink = () => {
    if (!newInviteLink) return;
    navigator.clipboard.writeText(newInviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Staff & Invite Management</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage employee access, invite team members, and configure turf operational capabilities.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
        >
          <UserPlus className="w-4 h-4" /> Invite Staff Member
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg flex items-center justify-between">
          <span>{feedback}</span>
        </div>
      )}

      {/* Generated Invite Link Banner */}
      {newInviteLink && (
        <div className="p-4 bg-slate-900 border border-emerald-500/30 rounded-xl space-y-2">
          <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Invitation Link Generated
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={newInviteLink}
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 focus:outline-none"
            />
            <button
              type="button"
              onClick={copyInviteLink}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
            >
              {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedLink ? 'Copied' : 'Copy Link'}
            </button>
          </div>
        </div>
      )}

      {/* Staff Roster */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <h2 className="text-sm font-bold text-slate-100 mb-4">Active Staff Members</h2>
        {loading ? (
          <div className="text-xs text-slate-400">Loading staff roster...</div>
        ) : employees.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center">
            No employees currently affiliated. Click Invite Staff Member to add staff.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {employees.map((emp) => (
              <div key={emp.id} className="py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-slate-200">User ID: {emp.user_id}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                      emp.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {emp.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Assignments: {emp.employee_turf_assignments?.length || 0} Turfs
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenEditAssignments(emp)}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 transition"
                    title="Edit Assignments"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisable(emp.id)}
                    disabled={emp.status !== 'active'}
                    className="p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-30 transition"
                    title="Disable Employee"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <h2 className="text-sm font-bold text-slate-100 mb-4">Pending Employee Invitations</h2>
        {invites.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center">
            No pending employee invites.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {invites.map((inv: any) => (
              <div key={inv.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-slate-200">{inv.email}</p>
                  <p className="text-[11px] text-slate-500">Expires: {new Date(inv.expires_at).toLocaleDateString()}</p>
                </div>
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] rounded uppercase font-bold">
                  Pending
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100">Invite Staff Member</h3>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Staff Email</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="staff@example.com"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Enforced Capabilities ({selectedCaps.length} selected)
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-950 border border-slate-850 rounded-lg">
                  {RECONCILED_CAPABILITIES.map((cap) => {
                    const isChecked = selectedCaps.includes(cap.code);
                    return (
                      <label key={cap.code} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCaps([...selectedCaps, cap.code]);
                            } else {
                              setSelectedCaps(selectedCaps.filter((c) => c !== cap.code));
                            }
                          }}
                          className="rounded border-slate-800 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className="truncate">{cap.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {submitting ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Assignments Modal */}
      {editingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100">Edit Staff Assignments</h3>
            <form onSubmit={handleSaveAssignments} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target Venue</label>
                <select
                  value={editTurfId}
                  onChange={(e) => setEditTurfId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                >
                  {turfs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Assigned Capabilities ({editCaps.length} selected)
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-950 border border-slate-850 rounded-lg">
                  {RECONCILED_CAPABILITIES.map((cap) => {
                    const isChecked = editCaps.includes(cap.code);
                    return (
                      <label key={cap.code} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditCaps([...editCaps, cap.code]);
                            } else {
                              setEditCaps(editCaps.filter((c) => c !== cap.code));
                            }
                          }}
                          className="rounded border-slate-800 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className="truncate">{cap.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAssignments}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {savingAssignments ? 'Saving...' : 'Save Assignments'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
