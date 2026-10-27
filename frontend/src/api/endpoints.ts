import type { DashboardLayout } from "../layout/model";
import { request } from "./client";

export interface LayoutResponse {
  revision: number;
  layout: DashboardLayout | null;
  updated_at: string | null;
}

export const fetchLayout = (): Promise<LayoutResponse> => request("GET", "/api/layout");

export const putLayout = (
  baseRevision: number,
  layout: DashboardLayout,
  keepalive = false,
): Promise<LayoutResponse> =>
  request("PUT", "/api/layout", { body: { base_revision: baseRevision, layout }, keepalive });

export type SourceState = "ok" | "degraded" | "auth_required" | "down" | "jamais_synchronise";

export interface SourceHealth {
  source: string;
  label: string;
  state: SourceState;
  message: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  unavailable_since: string | null;
  badge: string | null;
}

export const fetchSources = (): Promise<SourceHealth[]> => request("GET", "/api/sources/health");

export interface SyncStatus {
  running: boolean;
  nightly_time: string;
  next_run_at: string | null;
}

export const fetchSyncStatus = (): Promise<SyncStatus> => request("GET", "/api/sync/status");

export const runSync = (): Promise<{ started: boolean }> => request("POST", "/api/sync/run");

export interface GarminLoginResponse {
  status: "ok" | "mfa_required";
  ticket: string | null;
}

export const garminLogin = (
  body: { email: string; password: string } | { ticket: string; mfa_code: string },
): Promise<GarminLoginResponse> => request("POST", "/api/garmin/login", { body });
