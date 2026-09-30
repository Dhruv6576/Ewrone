'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient, getMyContext } from '@boxcodex/shared';
import {
  User,
  Mail,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  LogOut,
  Edit3,
  Save,
  Trophy,
  MapPin,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Building2,
} from 'lucide-react';
import { formatINR, formatDate, formatTimeRange } from '@/lib/utils';
import { getConfirmedBookingsList } from '@/lib/bookings-store';

export default function AccountPage() {
  const router = useRouter();
  const supabase = createBrowserClient('player');

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [context, setContext] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  
  // Profile editing state
  const [displayName, setDisplayName] = useState('');
  const [homeCity, setHomeCity] = useState('Bengaluru');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadAccountData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setLoading(false);
      return;
    }

    setUser(session.user);
    const { data: ctx } = await getMyContext(supabase);
    setContext(ctx);

    const name = ctx?.profile?.display_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Player';
    setDisplayName(name);

    // Fetch player bookings
    const { data: bList } = await supabase
      .from('bookings')
      .select(`
        id, reference_code, status, starts_at, ends_at, confirmed_at, total_minor,
        resource:resources (
          name,
          turf:turfs (name, city, slug)
        )
      `)
      .eq('player_user_id', session.user.id)
      .order('created_at', { ascending: false });

    // Strictly count and show ONLY confirmed bookings (merging DB records with verified payments)
    const confirmedList = getConfirmedBookingsList(bList, session.user.id);
    setBookings(confirmedList);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadAccountData();

    // 1. Reactive event listeners for instantaneous same-window and cross-tab sync
    const handleLocalConfirmed = () => {
      loadAccountData();
    };

    window.addEventListener('ewrone-booking-confirmed', handleLocalConfirmed);
    window.addEventListener('storage', handleLocalConfirmed);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('ewrone_bookings_channel');
      bc.onmessage = () => {
        loadAccountData();
      };
    }

    // 2. Subscribe to realtime updates on bookings table
    const channel = supabase
      .channel('account-bookings-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
        },
        () => {
          loadAccountData();
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('ewrone-booking-confirmed', handleLocalConfirmed);
      window.removeEventListener('storage', handleLocalConfirmed);
      if (bc) bc.close();
      supabase.removeChannel(channel);
    };
  }, [loadAccountData, supabase]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaveSuccess(false);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (!error) {
        setSaveSuccess(true);
        setIsEditing(false);
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } catch (err) {
      console.error('Error saving profile:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    router.push('/');
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <div className="animate-pulse space-y-6">
          <div className="h-44 bg-slate-900/60 rounded-3xl border border-slate-800" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-32 bg-slate-900/60 rounded-2xl border border-slate-800" />
            <div className="h-32 bg-slate-900/60 rounded-2xl border border-slate-800" />
            <div className="h-32 bg-slate-900/60 rounded-2xl border border-slate-800" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div className="p-8 rounded-3xl bg-[#0a0e14] border border-slate-800/80 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-[#00df81]/10 border border-[#00df81]/30 text-[#00df81] flex items-center justify-center mx-auto mb-5 shadow-sm">
            <User className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold text-white font-display">Sign In to Your Account</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed font-sans-ui">
            Sign in to view your player profile, booking history, match passes, and personal settings.
          </p>
          <Link
            href="/login?redirect=/account"
            className="inline-flex items-center gap-2 mt-6 px-6 py-2.5 rounded-md text-xs font-black tracking-wider uppercase text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-md shadow-[#00df81]/25"
          >
            <span>SIGN IN NOW</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'LP';

  const confirmedBookings = bookings.filter((b) => b.status === 'confirmed');
  const recentBookings = bookings.slice(0, 3);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 transition-colors duration-200">
      {/* 1. Header Profile Banner Card */}
      <div className="rounded-3xl bg-gradient-to-b from-[#0e141c] to-[#090d13] border border-slate-800/80 p-6 sm:p-8 relative overflow-hidden shadow-2xl mb-8">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#00df81]/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            {/* Avatar Badge */}
            <div className="relative group">
              <div className="w-20 h-20 rounded-full bg-white text-slate-950 font-black text-2xl flex items-center justify-center shadow-lg shadow-[#00df81]/20 border-2 border-[#00df81]">
                {initials}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#00df81] border-2 border-[#090d13] flex items-center justify-center text-slate-950" title="Verified Player">
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" />
              </div>
            </div>

            {/* Profile Info */}
            <div className="text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight font-display">
                  {displayName}
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#00df81]/15 text-[#00df81] border border-[#00df81]/30">
                  <ShieldCheck className="w-3 h-3" />
                  Verified Player
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 font-sans-ui">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>{user.email}</span>
                {user.created_at && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">Member since {new Date(user.created_at).getFullYear()}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 self-start md:self-center">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800/80 hover:bg-slate-700 text-white border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#00df81]" />
              <span>{isEditing ? 'Cancel' : 'Edit Profile'}</span>
            </button>

            <button
              onClick={handleSignOut}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Inline Edit Form */}
        {isEditing && (
          <form onSubmit={handleSaveProfile} className="mt-6 pt-6 border-t border-slate-800/80">
            <h3 className="text-sm font-bold text-white mb-3 font-display">Update Personal Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-white text-xs focus:outline-none focus:border-[#00df81] transition-colors"
                  placeholder="Your display name"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Preferred City</label>
                <select
                  value={homeCity}
                  onChange={(e) => setHomeCity(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-white text-xs focus:outline-none focus:border-[#00df81] transition-colors"
                >
                  <option value="Bengaluru">Bengaluru</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Delhi NCR">Delhi NCR</option>
                  <option value="Hyderabad">Hyderabad</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-md shadow-[#00df81]/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        )}

        {saveSuccess && (
          <div className="mt-4 p-3 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 text-[#00df81] text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Profile information successfully updated!</span>
          </div>
        )}
      </div>

      {/* 2. Key Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-2xl bg-[#0a0e14] border border-slate-800/80">
          <div className="text-slate-400 text-xs font-medium">Total Bookings</div>
          <div className="text-2xl font-black text-white mt-1 font-display">{bookings.length}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Lifetime reservations</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0a0e14] border border-slate-800/80">
          <div className="text-slate-400 text-xs font-medium">Confirmed Passes</div>
          <div className="text-2xl font-black text-[#00df81] mt-1 font-display">{confirmedBookings.length}</div>
          <div className="text-[10px] text-[#00df81]/80 mt-0.5">Ready for check-in</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0a0e14] border border-slate-800/80">
          <div className="text-slate-400 text-xs font-medium">Preferred Sport</div>
          <div className="text-lg font-black text-white mt-1 font-display flex items-center gap-1">
            <Trophy className="w-4 h-4 text-[#00df81]" />
            Box Cricket
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">AstroTurf Courts</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0a0e14] border border-slate-800/80">
          <div className="text-slate-400 text-xs font-medium">Account Status</div>
          <div className="text-lg font-black text-[#00df81] mt-1 font-display flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#00df81] animate-pulse" />
            Active
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Instant slot locking</div>
        </div>
      </div>

      {/* 3. Main Split: Recent Bookings & Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Recent Bookings */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-white font-display flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#00df81]" />
              Recent Bookings
            </h2>
            <Link
              href="/my-bookings"
              className="text-xs font-bold text-[#00df81] hover:underline flex items-center gap-1"
            >
              <span>View all ({bookings.length})</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {bookings.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#0a0e14] border border-slate-800/80 text-center">
              <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm font-bold text-white">No Bookings Yet</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Explore verified arenas, lock real-time slots, and step onto the court.
              </p>
              <Link
                href="/explore"
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all"
              >
                <span>EXPLORE TURFS</span>
                <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentBookings.map((b) => {
                const isConfirmed = b.status === 'confirmed';
                return (
                  <div
                    key={b.id}
                    className="p-4 sm:p-5 rounded-2xl bg-[#0a0e14] border border-slate-800/80 hover:border-[#00df81]/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-extrabold text-sm text-white font-display">
                          {b.turf?.name || 'Box Cricket Arena'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            isConfirmed
                              ? 'bg-[#00df81]/15 text-[#00df81] border border-[#00df81]/30'
                              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {b.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-500" />
                          {b.turf?.city || 'Bengaluru'}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span>{formatDate(b.starts_at)}</span>
                        <span className="text-slate-600">·</span>
                        <span>{formatTimeRange(b.starts_at, b.ends_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Amount</div>
                        <div className="text-sm font-extrabold text-[#00df81]">
                          {formatINR(b.total_minor)}
                        </div>
                      </div>
                      <Link
                        href={`/bookings/${b.id}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1"
                      >
                        <span>Pass</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 1 Col: Quick Links & Hub */}
        <div className="space-y-6">
          <h2 className="text-lg font-extrabold text-white font-display flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#00df81]" />
            Player Hub
          </h2>

          <div className="space-y-3">
            {/* My Bookings link */}
            <Link
              href="/my-bookings"
              className="p-4 rounded-2xl bg-[#0a0e14] border border-slate-800/80 hover:border-[#00df81]/40 transition-all flex items-center justify-between group block"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] group-hover:scale-105 transition-transform">
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-white group-hover:text-[#00df81] transition-colors">
                    My Bookings
                  </div>
                  <div className="text-[11px] text-slate-400">View gate passes & QR codes</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-[#00df81] group-hover:translate-x-0.5 transition-all" />
            </Link>

            {/* Explore Turfs link */}
            <Link
              href="/explore"
              className="p-4 rounded-2xl bg-[#0a0e14] border border-slate-800/80 hover:border-[#00df81]/40 transition-all flex items-center justify-between group block"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81] group-hover:scale-105 transition-transform">
                  <Trophy className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-white group-hover:text-[#00df81] transition-colors">
                    Explore Turfs
                  </div>
                  <div className="text-[11px] text-slate-400">Browse verified cricket pitches</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-[#00df81] group-hover:translate-x-0.5 transition-all" />
            </Link>

            {/* Business Console link if user is owner / employee */}
            {Boolean(context?.master_owner_accounts?.length || context?.employee_memberships?.length) && (
              <a
                href={(process.env.NEXT_PUBLIC_OWNER_URL || 'http://localhost:3001') + '/dashboard'}
                className="p-4 rounded-2xl bg-[#0a0e14] border border-emerald-500/30 hover:border-[#00df81] transition-all flex items-center justify-between group block"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-[#00df81] group-hover:scale-105 transition-transform">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold text-white group-hover:text-[#00df81] transition-colors">
                      Turf Owner Console
                    </div>
                    <div className="text-[11px] text-slate-400">Manage courts & walk-ins</div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-[#00df81]" />
              </a>
            )}

            {/* Admin Console link if platform admin */}
            {context?.is_platform_admin && (
              <a
                href={(process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3003') + '/admin/turfs'}
                className="p-4 rounded-2xl bg-[#0a0e14] border border-blue-500/30 hover:border-blue-400 transition-all flex items-center justify-between group block"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                      Platform Admin
                    </div>
                    <div className="text-[11px] text-slate-400">Turf approvals & payouts</div>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-blue-400" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
