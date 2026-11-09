"use client";

import { useSyncExternalStore } from "react";

// The current time, refreshed every 15 seconds. Returns null during server
// rendering so the server and browser never disagree about the time.
const TICK_MS = 15_000;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}
const getSnapshot = () => Math.floor(Date.now() / TICK_MS);
const getServerSnapshot = () => null;

export function useNow(): Date | null {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return tick === null ? null : new Date();
}

export function greetingFor(now: Date | null) {
  if (!now) return "Welcome back";
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
