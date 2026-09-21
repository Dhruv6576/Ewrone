'use client';

import { useEffect, useState, useRef } from 'react';
import { createBrowserClient } from '@boxcodex/shared';
import { Bell, CheckCheck, Clock, Check, Inbox, X } from 'lucide-react';

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  deep_link?: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const supabase = createBrowserClient('owner');

  const fetchNotifications = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setUser(null);
        setNotifications([]);
        return;
      }
      setUser(session.user);

      const { data, error } = await supabase.rpc('get_my_notifications', {
        p_limit: 30,
        p_offset: 0,
      });

      if (!error && Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  useEffect(() => {
    fetchNotifications();

    async function registerToken() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        try {
          await supabase.rpc('register_device_token', {
            p_app_id: 'box-codex-owner',
            p_token: `web_${session.user.id.slice(0, 8)}_${window.location.hostname}`,
            p_platform: 'web',
          });
        } catch {
          // non-critical if registration fails
        }
      }
    }
    registerToken();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchNotifications();
      } else {
        setUser(null);
        setNotifications([]);
      }
    });

    const interval = setInterval(fetchNotifications, 30000);

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      authListener.subscription.unsubscribe();
      clearInterval(interval);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const handleMarkRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const { error } = await supabase.rpc('mark_notification_read', {
        p_notification_id: id,
      });
      if (!error) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        );
      }
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    const unread = notifications.filter((n) => !n.read_at);
    for (const item of unread) {
      await handleMarkRead(item.id);
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        id="notification-bell-btn"
        data-testid="notification-bell-btn"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        aria-label="Notifications"
        className="relative p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 hover:bg-slate-800/80 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            id="notification-badge"
            data-testid="notification-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-emerald-500 text-slate-950 text-[10px] font-black rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/40 animate-pulse"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-dropdown"
          data-testid="notification-dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl shadow-black/80 z-50 overflow-hidden backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/60">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white tracking-tight">Notifications</h3>
              <span
                id="notification-unread-pill"
                data-testid="notification-unread-pill"
                className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono"
              >
                {unreadCount} unread
              </span>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  id="mark-all-read-btn"
                  data-testid="mark-all-read-btn"
                  onClick={handleMarkAllRead}
                  className="text-[11px] text-slate-400 hover:text-emerald-400 font-medium transition-colors flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-900">
            {notifications.length === 0 ? (
              <div className="p-8 text-center" data-testid="empty-notifications">
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-600">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-slate-400">No notifications yet</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Updates on turf reservations, payments, and team activity will appear here.
                </p>
              </div>
            ) : (
              notifications.map((notif) => {
                const isRead = Boolean(notif.read_at);
                return (
                  <div
                    key={notif.id}
                    id={`notification-row-${notif.id}`}
                    data-testid="notification-row"
                    className={`p-3.5 transition-colors relative flex items-start gap-3 hover:bg-slate-900/60 ${
                      !isRead ? 'bg-emerald-950/10' : ''
                    }`}
                  >
                    <div className="pt-1 shrink-0">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          !isRead ? 'bg-emerald-400 shadow-sm shadow-emerald-400/80 ring-2 ring-emerald-500/20' : 'bg-slate-700'
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h4 className="text-xs font-bold text-white truncate tracking-tight">
                          {notif.title}
                        </h4>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 shrink-0">
                          {notif.kind || 'general'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed break-words mb-2">
                        {notif.body}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3 text-slate-600" />
                          {new Date(notif.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {!isRead && (
                          <button
                            type="button"
                            id={`mark-read-${notif.id}`}
                            data-testid={`mark-read-${notif.id}`}
                            onClick={(e) => handleMarkRead(notif.id, e)}
                            className="px-2 py-0.5 rounded-lg text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/30 transition-colors flex items-center gap-1"
                          >
                            <Check className="w-2.5 h-2.5" />
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { NotificationBell };
