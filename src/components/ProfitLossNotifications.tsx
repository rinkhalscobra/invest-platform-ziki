import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, TrendingDown, TrendingUp, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface ProfitLossNotification {
  id: string;
  user_id: string;
  type: 'profit' | 'loss';
  message: string;
  is_read: boolean;
  data?: {
    amount?: number | string;
    currency?: string;
    module?: string;
    symbol?: string | null;
  } | null;
  created_at: string;
}

interface ProfitLossNotificationsProps {
  userId: string | null;
}

const toastLifetime = 8000;

const ProfitLossNotifications: React.FC<ProfitLossNotificationsProps> = ({ userId }) => {
  const [toasts, setToasts] = useState<ProfitLossNotification[]>([]);
  const seenIds = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
  const cursor = useRef(new Date().toISOString());

  const dismiss = useCallback((notificationId: string, markRead = true) => {
    const timer = timers.current.get(notificationId);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(notificationId);
    setToasts(current => current.filter(toast => toast.id !== notificationId));
    if (markRead) {
      void supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
    }
  }, []);

  const show = useCallback((notification: ProfitLossNotification) => {
    if (!notification?.id || !['profit', 'loss'].includes(notification.type) || seenIds.current.has(notification.id)) return;
    seenIds.current.add(notification.id);
    setToasts(current => [...current, notification].slice(-4));
    const timer = window.setTimeout(() => dismiss(notification.id), toastLifetime);
    timers.current.set(notification.id, timer);
  }, [dismiss]);

  useEffect(() => {
    const activeTimers = timers.current;
    activeTimers.forEach(timer => window.clearTimeout(timer));
    activeTimers.clear();
    seenIds.current.clear();
    setToasts([]);
    cursor.current = new Date(Date.now() - 3000).toISOString();
    if (!userId) return;

    let active = true;

    const fetchMissedNotifications = async () => {
      const requestedAfter = cursor.current;
      const { data, error } = await supabase
        .from('notifications')
        .select('id, user_id, type, message, is_read, data, created_at')
        .eq('user_id', userId)
        .in('type', ['profit', 'loss'])
        .gt('created_at', requestedAfter)
        .order('created_at', { ascending: true })
        .limit(20);

      if (!active || error || !data) return;
      data.forEach(item => show(item as ProfitLossNotification));
      const latest = data.at(-1)?.created_at;
      cursor.current = latest || new Date().toISOString();
    };

    void fetchMissedNotifications();
    const poller = window.setInterval(() => void fetchMissedNotifications(), 8000);
    const channel = supabase
      .channel(`profit-loss-notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => {
          const notification = payload.new as ProfitLossNotification;
          if (notification.created_at > cursor.current) cursor.current = notification.created_at;
          show(notification);
        }
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(poller);
      void supabase.removeChannel(channel);
      activeTimers.forEach(timer => window.clearTimeout(timer));
      activeTimers.clear();
    };
  }, [show, userId]);

  if (!userId || toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[250] flex flex-col items-center gap-2 px-3" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => {
        const isProfit = toast.type === 'profit';
        const amount = Number(toast.data?.amount || 0);
        const moduleName = toast.data?.module || 'Account';
        const currency = toast.data?.currency || 'USDT';
        return (
          <article
            key={toast.id}
            className={`pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl ${isProfit ? 'border-emerald-400/40 bg-emerald-950/95 shadow-emerald-950/40' : 'border-red-400/40 bg-red-950/95 shadow-red-950/40'}`}
          >
            <div className="flex items-start gap-3 p-4">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isProfit ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>
                {isProfit ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase tracking-[0.14em] ${isProfit ? 'text-emerald-300' : 'text-red-300'}`}>{moduleName}</span>
                  <span className="h-1 w-1 rounded-full bg-white/30" />
                  <span className="text-xs text-white/55">Realized {isProfit ? 'profit' : 'loss'}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  {isProfit ? <ArrowUpRight size={18} className="text-emerald-300" /> : <ArrowDownRight size={18} className="text-red-300" />}
                  <span className="text-xl font-bold text-white">{amount > 0 ? '+' : '-'}{Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
                </div>
                <p className="mt-1 truncate text-xs text-white/55">{toast.message}</p>
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} className="rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white" aria-label="Dismiss notification"><X size={17} /></button>
            </div>
            <div className={`flex items-center gap-1.5 border-t px-4 py-2 text-[11px] ${isProfit ? 'border-emerald-400/15 text-emerald-200/65' : 'border-red-400/15 text-red-200/65'}`}><Check size={13} />Result recorded in your account</div>
          </article>
        );
      })}
    </div>
  );
};

export default ProfitLossNotifications;
