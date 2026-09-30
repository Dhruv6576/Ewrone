'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@boxcodex/shared';
import { User, Building2, Save, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [displayName, setDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [masterOwnerId, setMasterOwnerId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  
  const supabase = createBrowserClient('owner');

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        setUserId(session.user.id);
        
        // Fetch profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', session.user.id)
          .single();
          
        if (profile) {
          setDisplayName(profile.display_name || '');
        }

        // Fetch master owner ID if any
        const { data: caps } = await supabase.rpc('get_my_capabilities');
        if (caps?.master_owner_id) {
          setMasterOwnerId(caps.master_owner_id);
          const { data: owner } = await supabase
            .from('master_owners')
            .select('business_name')
            .eq('id', caps.master_owner_id)
            .single();
            
          if (owner) {
            setBusinessName(owner.business_name || '');
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    
    init();
  }, [supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    
    setSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Update profile
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
        
      if (profileErr) throw profileErr;
      
      // Update master owner if exists
      if (masterOwnerId && businessName) {
        const { error: ownerErr } = await supabase
          .from('master_owners')
          .update({ business_name: businessName, updated_at: new Date().toISOString() })
          .eq('id', masterOwnerId);
          
        if (ownerErr) throw ownerErr;
      }
      
      setSuccess('Profile updated successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-neutral-200/50 dark:bg-neutral-800 rounded-lg" />
        <div className="h-64 bg-neutral-200/50 dark:bg-neutral-800/40 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-neutral-900 dark:text-white tracking-tight flex items-center gap-3">
          <User className="w-7 h-7 text-neutral-900 dark:text-white" />
          Profile Settings
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          Manage your personal details and business information.
        </p>
      </div>
      
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-2xl flex items-start gap-3 text-red-200 text-sm">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}
      
      {success && (
        <div className="p-4 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-2xl flex items-start gap-3 text-primary text-sm font-bold">
          <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>{success}</div>
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white dark:bg-neutral-950/60 border border-neutral-200 dark:border-neutral-800/80 rounded-3xl p-6 sm:p-8 space-y-8 shadow-xl shadow-neutral-200/20 dark:shadow-black/40 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-neutral-900 dark:bg-white/10 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-6 relative">
          <div>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2 mb-4">
              <User className="w-5 h-5 text-neutral-400" />
              Personal Information
            </h3>
            <div className="space-y-2">
              <label htmlFor="displayName" className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Full Name
              </label>
              <input
                id="displayName"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full sm:max-w-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:ring-white/40 focus:border-neutral-900 dark:border-white transition-all"
                placeholder="Enter your full name"
              />
            </div>
          </div>

          {masterOwnerId && (
            <div className="pt-6 border-t border-neutral-200 dark:border-neutral-800">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2 mb-4">
                <Building2 className="w-5 h-5 text-neutral-400" />
                Business Information
              </h3>
              <div className="space-y-2">
                <label htmlFor="businessName" className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                  Business Name
                </label>
                <input
                  id="businessName"
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full sm:max-w-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:ring-white/40 focus:border-neutral-900 dark:border-white transition-all"
                  placeholder="Enter your business name"
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-neutral-900 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-neutral-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-neutral-900/10 disabled:opacity-50 cursor-pointer"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}
