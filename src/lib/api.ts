/**
 * Client for the local ABB Plant 3 backend.
 *
 * The whole app talks to the API through this module so that the request
 * conventions live in exactly one place:
 *   - the session travels in an `HttpOnly` cookie, so every call is made with
 *     `credentials: "include"` and the frontend never sees a token;
 *   - a failure is always turned into an `ApiError` carrying the backend's
 *     stable `code`, so screens can branch on `code` instead of parsing prose;
 *   - the backend is authoritative. Nothing here re-implements a business rule
 *     (validity, duplicate scans, authorization) — it only asks.
 */

export type Role = "administrator" | "security_staff";
export type PersonCategory = "worker" | "intern" | "visitor";
export type PersonStatus = "active" | "suspended" | "terminated";
export type CredentialKind = "id_card" | "gate_pass";
export type CredentialStatus = "active" | "suspended" | "terminated";
export type GateDirection = "entry" | "exit";
export type GateResult = "approved" | "rejected" | "unable_to_verify";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  email: string | null;
}

/** The full profile. Administrator only — it carries personal data. */
export interface PersonView {
  id: string;
  category: PersonCategory;
  fullName: string;
  phone: string | null;
  hasPhoto: boolean;
  plantId: string;
  status: PersonStatus;
  workerRef: string | null;
  contractorCompany: string | null;
  institutionName: string | null;
  purposeOfVisit: string | null;
  personToMeet: string | null;
  employeeEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The gate-staff view: identification only, no contact details. */
export interface VerificationView {
  id: string;
  category: PersonCategory;
  fullName: string;
  status: PersonStatus;
  hasPhoto: boolean;
  workerRef: string | null;
  contractorCompany: string | null;
  institutionName: string | null;
  /**
   * The holder's live credential code, so Manual Lookup can verify a person
   * whose card is unreadable. Only `GET /api/people/search` sets it; the other
   * responses that reuse this view leave it undefined. `null` means the person
   * holds no live credential at all.
   */
  activeCredentialId?: string | null;
}

export interface CredentialView {
  id: string;
  personId: string;
  kind: CredentialKind;
  validFrom: string;
  validTo: string;
  status: CredentialStatus;
  issuedAt: string;
  updatedAt: string;
  /** Present only when the backend was asked to compute it. */
  isValid?: boolean;
  reasonCode?: string;
  reasonText?: string;
}

export interface GateEventView {
  id: string;
  credentialId: string | null;
  personId: string | null;
  /** Null when the code was not recognised, so no holder could be named. */
  personName: string | null;
  personCategory: PersonCategory | null;
  gateId: string;
  direction: GateDirection;
  result: GateResult;
  reasonCode: string | null;
  reasonText: string | null;
  occurredAt: string;
  operatorUserId: string | null;
  recordedOffline: boolean;
  syncedAt: string | null;
  createdAt: string;
}

export interface GateVerification {
  result: GateResult;
  reasonCode: string;
  reasonText: string;
  direction: GateDirection;
  occurredAt: string;
  /** True when the scan matched one already recorded inside the duplicate window. */
  duplicate: boolean;
  /** True when this scan is on record — including rejections. */
  recorded: boolean;
  eventId: string | null;
  person: VerificationView | null;
  credential: CredentialView | null;
  /**
   * An advisory alert raised when the holder (or the scanned card) is on the
   * watchlist. It never changes the verdict — it is shown next to it.
   */
  watchlist: WatchlistEntryView | null;
}

export interface InsideEntry {
  person: VerificationView;
  credentialId: string;
  gateId: string;
  since: string;
  missingExit: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorBody["error"]["details"],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The session is missing or has expired — the caller must sign in again. */
  get isUnauthenticated() {
    return this.status === 401;
  }

  /** The caller is signed in but not allowed to do this. */
  get isForbidden() {
    return this.status === 403;
  }
}

/**
 * Where the API lives. It is the same origin in both modes: in development the
 * Vite dev server proxies `/api` to the API process, and in production the API
 * process serves the built app itself. Keeping one origin means the session
 * cookie behaves identically in both, and there is no CORS to configure.
 *
 * `VITE_API_BASE_URL` exists only as an escape hatch for an unusual deployment.
 */
function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return "";
}

export const API_BASE_URL = resolveBaseUrl();

type QueryValue = string | number | boolean | undefined | null;

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${url}?${suffix}` : url;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const code = body?.error?.code ?? "UNKNOWN";
  const message = body?.error?.message ?? `Request failed with status ${response.status}.`;
  return new ApiError(response.status, code, message, body?.error?.details);
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // A network failure is never a verdict — surface it as such.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", "Cannot reach the verification server.");
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authApi = {
  async me() {
    const { user } = await apiFetch<{ user: SessionUser }>("/api/auth/me");
    return user;
  },
  async login(username: string, password: string) {
    const { user } = await apiFetch<{ user: SessionUser; expiresAt: string }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    return user;
  },
  /**
   * Self-service signup. The server always creates a `security_staff` account
   * and always creates it **disabled**, so this is a request for access rather
   * than a grant of it. No session is returned — there is nothing to sign into
   * until an administrator enables the account on `/users`.
   */
  signup(input: { username: string; fullName: string; password: string; email?: string }) {
    return apiFetch<{ pendingApproval: boolean }>("/api/auth/signup", {
      method: "POST",
      body: input,
    });
  },
  logout() {
    return apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" });
  },
};

// ---------------------------------------------------------------------------
// Public card-status check
// ---------------------------------------------------------------------------

/**
 * What the public `/check` page learns about a code: whether the card may be
 * used today and why not, plus the pass type and its last valid day. There is
 * deliberately no name, phone number or email in this payload.
 */
export interface CardStatus {
  valid: boolean;
  /** `valid`, or the reason code that explains a refusal. */
  status: string;
  reasonCode: string | null;
  reasonText: string | null;
  kind: CredentialKind | null;
  category: PersonCategory | null;
  validTo: string | null;
}

export const checkApi = {
  async card(code: string) {
    const { card } = await apiFetch<{ card: CardStatus }>(`/api/check/${encodeURIComponent(code)}`);
    return card;
  },
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonInput {
  category: PersonCategory;
  fullName: string;
  phone?: string;
  workerRef?: string;
  contractorCompany?: string;
  institutionName?: string;
  purposeOfVisit?: string;
  personToMeet?: string;
  employeeEmail?: string;
}

export interface ListPeopleFilters {
  category?: PersonCategory;
  status?: PersonStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export const peopleApi = {
  /** Gate-staff lookup: identification only. */
  async search(q: string, limit = 20) {
    const { people } = await apiFetch<{ people: VerificationView[] }>("/api/people/search", {
      query: { q, limit },
    });
    return people;
  },
  list(filters: ListPeopleFilters = {}) {
    return apiFetch<{ people: PersonView[]; total: number; limit: number; offset: number }>(
      "/api/people",
      { query: { ...filters } },
    );
  },
  async get(id: string) {
    return apiFetch<{ person: PersonView; credentials: CredentialView[] }>(
      `/api/people/${encodeURIComponent(id)}`,
    );
  },
  async create(input: PersonInput) {
    const { person } = await apiFetch<{ person: PersonView }>("/api/people", {
      method: "POST",
      body: input,
    });
    return person;
  },
  async update(id: string, patch: Partial<PersonInput>) {
    const { person } = await apiFetch<{ person: PersonView }>(
      `/api/people/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    return person;
  },
  async setStatus(id: string, status: PersonStatus, reason: string) {
    const { person } = await apiFetch<{ person: PersonView }>(
      `/api/people/${encodeURIComponent(id)}/status`,
      { method: "POST", body: { status, reason } },
    );
    return person;
  },
};

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const credentialsApi = {
  async issue(input: {
    personId: string;
    kind: CredentialKind;
    validFrom: string;
    validTo: string;
  }) {
    const { credential } = await apiFetch<{ credential: CredentialView }>("/api/credentials", {
      method: "POST",
      body: input,
    });
    return credential;
  },
  async setValidity(id: string, input: { validFrom: string; validTo: string; reason: string }) {
    const { credential } = await apiFetch<{ credential: CredentialView }>(
      `/api/credentials/${encodeURIComponent(id)}/validity`,
      { method: "POST", body: input },
    );
    return credential;
  },
  async setStatus(id: string, status: CredentialStatus, reason: string) {
    const { credential } = await apiFetch<{ credential: CredentialView }>(
      `/api/credentials/${encodeURIComponent(id)}/status`,
      { method: "POST", body: { status, reason } },
    );
    return credential;
  },
};

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export interface GateEventFilters {
  personId?: string;
  result?: GateResult;
  direction?: GateDirection;
  /** Inclusive ISO instants, used by the audit log's date range. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const gateApi = {
  verify(code: string, direction: GateDirection) {
    return apiFetch<GateVerification>("/api/gate/verify", {
      method: "POST",
      body: { code, direction },
    });
  },
  events(filters: GateEventFilters = {}) {
    return apiFetch<{ events: GateEventView[]; total: number; limit: number; offset: number }>(
      "/api/gate/events",
      { query: { ...filters } },
    );
  },
  inside() {
    return apiFetch<{ asOf: string; today: string; inside: InsideEntry[] }>("/api/inside");
  },
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Counts shared by every series; `scans === approved + rejected + unable`. */
export interface ScanCounts {
  scans: number;
  approved: number;
  rejected: number;
  unable: number;
}

export interface DashboardSummary {
  /** Server instant the summary was computed at. */
  asOf: string;
  /** The plant's calendar date, `YYYY-MM-DD`. */
  today: string;
  /** The plant's IANA time zone, so a client never has to guess. */
  timezone: string;
  /** How many plant days `daily` covers, today included. */
  days: number;
  counts: ScanCounts;
  inside: {
    total: number;
    /** Entries with no matching exit recorded on the plant day. */
    missingExit: number;
    byCategory: Record<PersonCategory | "unknown", number>;
  };
  /** Today's scans broken down by the holder's category. */
  categorySplit: Array<ScanCounts & { category: PersonCategory | "unknown" }>;
  /** 24 buckets, plant hour 0–23. */
  hourly: Array<{ hour: number; approved: number; rejected: number; unable: number }>;
  /** One entry per plant day in the window, oldest first. */
  daily: Array<ScanCounts & { date: string }>;
  /** Alerts that would fire at the gate right now. */
  watchlist: { active: number };
}

export const dashboardApi = {
  summary(days = 7) {
    return apiFetch<DashboardSummary>("/api/dashboard/summary", { query: { days } });
  },
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ScanReport {
  /** First day of the window, `YYYY-MM-DD`, inclusive. */
  from: string;
  /** Last day of the window, `YYYY-MM-DD`, inclusive. */
  to: string;
  days: number;
  timezone: string;
  generatedAt: string;
  counts: ScanCounts;
  daily: Array<ScanCounts & { date: string }>;
  byCategory: Array<ScanCounts & { category: PersonCategory | "unknown" }>;
  byDirection: Array<ScanCounts & { direction: GateDirection }>;
  byGate: Array<ScanCounts & { gateId: string; gateName: string }>;
  /** Why scans were refused, most frequent first. */
  topReasons: Array<{ reasonCode: string; reasonText: string | null; count: number }>;
  uniquePeople: number;
}

export const reportsApi = {
  scans(from: string, to: string) {
    return apiFetch<ScanReport>("/api/reports/scans", { query: { from, to } });
  },
};

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "closed";

export interface IncidentView {
  id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  personId: string | null;
  personName: string | null;
  gateId: string | null;
  reportedBy: string | null;
  reportedByName: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface IncidentInput {
  title: string;
  description?: string;
  severity: IncidentSeverity;
  personId?: string;
}

export interface IncidentFilters {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  limit?: number;
  offset?: number;
}

export const incidentsApi = {
  async create(input: IncidentInput) {
    const { incident } = await apiFetch<{ incident: IncidentView }>("/api/incidents", {
      method: "POST",
      body: input,
    });
    return incident;
  },
  list(filters: IncidentFilters = {}) {
    return apiFetch<{ incidents: IncidentView[]; total: number; limit: number; offset: number }>(
      "/api/incidents",
      { query: { ...filters } },
    );
  },
  async setStatus(id: string, status: IncidentStatus, reason?: string) {
    const { incident } = await apiFetch<{ incident: IncidentView }>(
      `/api/incidents/${encodeURIComponent(id)}`,
      { method: "PATCH", body: { status, ...(reason ? { reason } : {}) } },
    );
    return incident;
  },
};

// ---------------------------------------------------------------------------
// Canteen
// ---------------------------------------------------------------------------

export interface CanteenEventView {
  id: string;
  credentialId: string | null;
  personId: string | null;
  personName: string | null;
  personCategory: PersonCategory | null;
  entryDate: string;
  result: GateResult;
  reasonCode: string | null;
  reasonText: string | null;
  occurredAt: string;
  operatorUserId: string | null;
  createdAt: string;
}

export interface CanteenVerification {
  result: GateResult;
  reasonCode: string;
  reasonText: string;
  entryDate: string;
  occurredAt: string;
  alreadyEntered: boolean;
  recorded: boolean;
  eventId: string | null;
  person: VerificationView | null;
  credential: CredentialView | null;
}

export const canteenApi = {
  verify(code: string) {
    return apiFetch<CanteenVerification>("/api/canteen/verify", {
      method: "POST",
      body: { code },
    });
  },
  events(filters: { date?: string; result?: GateResult; limit?: number; offset?: number } = {}) {
    return apiFetch<{
      events: CanteenEventView[];
      total: number;
      servedToday: number;
      date: string;
      limit: number;
      offset: number;
    }>("/api/canteen/events", { query: { ...filters } });
  },
};

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export type AnnouncementSeverity = "info" | "warning" | "critical";

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  isActive: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export const announcementsApi = {
  list(includeInactive = false) {
    return apiFetch<{ announcements: AnnouncementView[] }>("/api/announcements", {
      query: { includeInactive },
    });
  },
  async create(input: {
    title: string;
    body: string;
    severity?: AnnouncementSeverity;
    expiresAt?: string;
  }) {
    const { announcement } = await apiFetch<{ announcement: AnnouncementView }>(
      "/api/announcements",
      { method: "POST", body: input },
    );
    return announcement;
  },
  async deactivate(id: string) {
    const { announcement } = await apiFetch<{ announcement: AnnouncementView }>(
      `/api/announcements/${encodeURIComponent(id)}/deactivate`,
      { method: "POST", body: {} },
    );
    return announcement;
  },
};

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export type WatchlistLevel = "info" | "warn" | "deny" | "detain";

export interface WatchlistEntryView {
  id: string;
  fullName: string;
  reason: string;
  notes: string | null;
  level: WatchlistLevel;
  personId: string | null;
  personName: string | null;
  barcode: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export const watchlistApi = {
  list(filters: { includeInactive?: boolean; level?: WatchlistLevel; limit?: number } = {}) {
    return apiFetch<{ entries: WatchlistEntryView[] }>("/api/watchlist", { query: { ...filters } });
  },
  async create(input: {
    fullName: string;
    reason: string;
    level: WatchlistLevel;
    notes?: string;
    personId?: string;
    barcode?: string;
    expiresAt?: string;
  }) {
    const { entry } = await apiFetch<{ entry: WatchlistEntryView }>("/api/watchlist", {
      method: "POST",
      body: input,
    });
    return entry;
  },
  async deactivate(id: string) {
    const { entry } = await apiFetch<{ entry: WatchlistEntryView }>(
      `/api/watchlist/${encodeURIComponent(id)}/deactivate`,
      { method: "POST", body: {} },
    );
    return entry;
  },
};

// ---------------------------------------------------------------------------
// Audit trail (administrator only)
// ---------------------------------------------------------------------------

export interface AuditEntryView {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  occurredAt: string;
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const auditApi = {
  list(filters: AuditFilters = {}) {
    return apiFetch<{
      entries: AuditEntryView[];
      total: number;
      actions: string[];
      limit: number;
      offset: number;
    }>("/api/audit", { query: { ...filters } });
  },
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserView {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export const usersApi = {
  list() {
    return apiFetch<{ users: UserView[] }>("/api/users");
  },
  async create(input: {
    username: string;
    fullName: string;
    role: Role;
    password: string;
    email?: string;
  }) {
    const { user } = await apiFetch<{ user: UserView }>("/api/users", {
      method: "POST",
      body: input,
    });
    return user;
  },
  /** Enable or disable a sign-in account. This is what approves a signup. */
  async setActive(id: string, isActive: boolean) {
    const { user } = await apiFetch<{ user: UserView }>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { isActive },
    });
    return user;
  },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingView {
  key: string;
  value: string;
  updatedAt: string;
}

export const settingsApi = {
  list() {
    return apiFetch<{ settings: SettingView[] }>("/api/settings");
  },
  async update(key: string, value: string) {
    const { setting } = await apiFetch<{ setting: SettingView }>("/api/settings", {
      method: "PUT",
      body: { key, value },
    });
    return setting;
  },
};
