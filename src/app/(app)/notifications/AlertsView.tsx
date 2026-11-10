"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotifications } from "@/components/app/NotificationsContext";
import type { PaymentSearchRow } from "@/lib/alerts";
import { createClient } from "@/lib/supabase/client";
import AlertsScreen from "./AlertsScreen";

// Alerts & Reminders with real data. Everything comes from the app's one live alerts source
// (NotificationsContext): reminders, updates, read marks, contact requests and chats, so this
// page, the bell and the badges always agree. Payment search loads on first use.

export default function AlertsView() {
  const n = useNotifications();
  const supabase = useMemo(() => createClient(), []);
  const [searchRows, setSearchRows] = useState<PaymentSearchRow[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);

  const searchUsed = useRef(false);
  const loadSearch = useCallback(async () => {
    searchUsed.current = true;
    const { data, error } = await supabase.rpc("my_payment_search");
    setSearchFailed(Boolean(error));
    if (!error) setSearchRows((data ?? []) as PaymentSearchRow[]);
  }, [supabase]);

  // A payment changed somewhere (the shared source reloaded): keep search results current too.
  useEffect(() => {
    if (searchUsed.current) loadSearch();
  }, [n.paymentRows, n.events, loadSearch]);

  return (
    <AlertsScreen
      data={{
        rows: n.paymentRows,
        events: n.events,
        contacts: n.requests,
        messages: n.messages,
        seenAt: n.seenAt,
        reads: n.reads,
        failed: n.alertsFailed,
        refreshFailed: n.alertsRefreshFailed,
        now: n.paymentRows ? new Date() : null,
        search: { rows: searchRows, failed: searchFailed, load: loadSearch },
      }}
      viewKey="commontab.alerts.view"
      onRetry={n.refresh}
      onMarkAll={n.markRead}
      onAccept={n.accept}
      onDecline={n.decline}
    />
  );
}
