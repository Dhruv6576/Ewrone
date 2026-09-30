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
        className="relative p-2 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:border-neutral-300 dark:hover:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-800/80 transition-all focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:ring-white/40"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            id="notification-badge"
            data-testid="notification-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-neutral-900 dark:bg-white text-neutral-950 text-[10px] font-black rounded-full flex items-center justify-center shadow-lg shadow-neutral-900/10 animate-pulse"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-dropdown"
          data-testid="notification-dropdown"
          className="absolute right-0 mt-2 w-[260px] sm:w-80 rounded-2xl bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 shadow-2xl shadow-neutral-900/10 dark:shadow-black/80 z-50 overflow-hidden backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-4 border-b border-neutral-300 dark:border-neutral-800/80 flex items-center justify-between bg-neutral-100/80 dark:bg-neutral-900/60">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-neutral-900 dark:text-white tracking-tight">Notifications</h3>
              <span
                id="notification-unread-pill"
                data-testid="notification-unread-pill"
                className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-950/80 text-neutral-200 border border-neutral-900 dark:border-white/30 font-mono"
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
                  className="text-[11px] text-neutral-400 hover:text-neutral-200 font-medium transition-colors flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[380px] overflow-y-auto divide-y divide-neutral-900">
            {notifications.length === 0 ? (
              <div className="p-8 text-center" data-testid="empty-notifications">
                <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 flex items-center justify-center mx-auto mb-3 text-neutral-400 dark:text-neutral-600">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const isRead = Boolean(notif.read_at);
                return (
                  <div
                    key={notif.id}
                    id={`notification-row-${notif.id}`}
                    data-testid="notification-row"
                    className={`p-3 transition-colors relative flex items-start gap-3 hover:bg-neutral-100/50 dark:hover:bg-neutral-900/60 ${
                      !isRead ? 'bg-neutral-900 dark:bg-white/5 dark:bg-neutral-950/10' : ''
                    }`}
                  >
                    <div className="pt-1.5 shrink-0">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          !isRead ? 'bg-primary shadow-sm shadow-primary/80 ring-2 ring-neutral-900 dark:ring-white/20' : 'bg-neutral-700'
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="text-[13px] font-semibold text-neutral-900 dark:text-white truncate">
                        {notif.title}
                      </h4>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5 mb-1.5">
                        {notif.body}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-neutral-500">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
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
                            className="text-primary hover:text-primary/80 font-bold transition-colors"
                          >
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
