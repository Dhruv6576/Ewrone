'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@boxcodex/shared';
import { Bell, Check, CheckCheck, Clock, Inbox, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  deep_link?: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const supabase = createBrowserClient('player');

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_my_notifications', {
        p_limit: 50,
        p_offset: 0,
      });
      if (!error && Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const filteredNotifications = filter === 'unread' 
    ? notifications.filter((n) => !n.read_at) 
    : notifications;

  const handleMarkRead = async (id: string) => {
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
      console.error('Failed to mark read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    const unread = notifications.filter((n) => !n.read_at);
    for (const item of unread) {
      await handleMarkRead(item.id);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Page Header with literal headings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h1 id="notifications-heading" className="text-2xl font-black text-white tracking-tight">
                Notifications
              </h1>
              <p id="notifications-subheading" className="text-xs text-slate-400 mt-0.5">
                Real-time booking confirmations, payment receipts, and turf updates
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="refresh-notifications-btn"
            onClick={fetchNotifications}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              id="mark-all-read-page-btn"
              onClick={handleMarkAllRead}
              className="px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-900/60 transition-colors flex items-center gap-1.5 shadow-sm shadow-emerald-500/10"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Count Metrics */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-medium">
          <button
            type="button"
            id="filter-all-btn"
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filter === 'all'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            id="filter-unread-btn"
            onClick={() => setFilter('unread')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filter === 'unread'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>

        {/* Verified UI Counter for browser testing */}
        <div
          id="notifications-stat-badge"
          data-testid="notifications-stat-badge"
          className="text-xs font-mono text-slate-400"
        >
          Unread Count: <span id="ui-unread-count" className="font-bold text-emerald-400">{unreadCount}</span> / Total: <span id="ui-total-count" className="font-bold text-white">{notifications.length}</span>
        </div>
      </div>

      {/* Notifications List */}
      <div id="notifications-container" className="space-y-3">
        {loading && notifications.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-mono text-xs">
            Loading notifications...
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div
            id="no-notifications-empty"
            className="p-12 rounded-2xl bg-slate-950/40 border border-slate-800/80 text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-600">
              <Inbox className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-300">No notifications found</h3>
            <p className="text-xs text-slate-500 mt-1">
              {filter === 'unread' ? 'You have read all notifications.' : 'No alerts have been dispatched to your account.'}
            </p>
          </div>
        ) : (
          filteredNotifications.map((notif) => {
            const isRead = Boolean(notif.read_at);
            return (
              <div
                key={notif.id}
                id={`notification-card-${notif.id}`}
                data-testid="notification-card"
                className={`p-4 rounded-2xl border transition-all ${
                  !isRead
                    ? 'bg-slate-900/60 border-emerald-500/30 shadow-md shadow-emerald-500/5'
                    : 'bg-slate-950/40 border-slate-800/80 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {notif.kind}
                      </span>
                      {!isRead && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-500/30" />
                      )}
                      <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1 ml-auto">
                        <Clock className="w-3 h-3 text-slate-600" />
                        {new Date(notif.created_at).toLocaleString()}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-white tracking-tight mb-1">
                      {notif.title}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {notif.body}
                    </p>

                    {notif.deep_link && (
                      <div className="mt-3">
                        <Link
                          href={notif.deep_link}
                          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
                        >
                          View Related Details →
                        </Link>
                      </div>
                    )}
                  </div>

                  {!isRead && (
                    <button
                      type="button"
                      id={`mark-card-read-${notif.id}`}
                      onClick={() => handleMarkRead(notif.id)}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-emerald-950/60 border border-slate-800 hover:border-emerald-500/30 text-xs font-semibold text-slate-300 hover:text-emerald-400 transition-all flex items-center gap-1.5 shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Mark Read
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
