import { z } from "zod";

/**
 * Request schemas, re-validated on the server on every write.
 *
 * Kept as plain zod object definitions (no Express or database imports) so the
 * frontend can import the same shapes instead of duplicating them.
 */

export const ROLES = ["administrator", "security_staff"];

const usernameField = z
  .string()
  .trim()
  .min(3, "Use at least 3 characters.")
  .max(64, "Use at most 64 characters.")
  .regex(/^[A-Za-z0-9._-]+$/, "Use letters, digits, dot, underscore or hyphen.");

const newPasswordField = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(256, "Use at most 256 characters.");

export const loginSchema = z
  .object({
    username: z.string().trim().min(1, "Username is required.").max(64),
    password: z.string().min(1, "Password is required.").max(256),
  })
  .strict();

export const createUserSchema = z
  .object({
    username: usernameField,
    fullName: z.string().trim().min(1, "Full name is required.").max(120),
    role: z.enum(ROLES),
    password: newPasswordField,
    email: z.string().trim().email("Enter a valid email address.").max(160).optional(),
  })
  .strict();

/**
 * Self-service signup. Note what is deliberately absent: `role`. A caller can
 * never choose their own privilege level — the server always creates a
 * `security_staff` account, and it is created **disabled** so an administrator
 * has to approve it before it can sign in.
 */
export const signupSchema = z
  .object({
    username: usernameField,
    fullName: z.string().trim().min(1, "Full name is required.").max(120),
    password: newPasswordField,
    email: z.string().trim().email("Enter a valid email address.").max(160).optional(),
  })
  .strict();

/** Enabling or disabling a sign-in account. Administrator only, and audited. */
export const updateUserStatusSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export const resetUserPasswordSchema = z
  .object({
    password: newPasswordField,
  })
  .strict();

/**
 * The code a holder scans or types on the public card-status page. It is the
 * opaque credential id, so the only real constraint is a sane length — the
 * lookup either matches a credential or it does not.
 */
export const checkCodeParamSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
  })
  .strict();

export const updateSettingSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_.]+$/, "Setting keys use lowercase letters, digits, dot or underscore."),
    value: z.string().max(500, "Setting values are limited to 500 characters."),
  })
  .strict();

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const PERSON_CATEGORIES = ["worker", "intern", "visitor"];
export const PERSON_STATUSES = ["active", "suspended", "terminated"];

const PHONE_PATTERN = /^[0-9+() -]{6,20}$/;

const optionalText = (max) => z.string().trim().min(1).max(max).optional();

export const createPersonSchema = z
  .object({
    category: z.enum(PERSON_CATEGORIES),
    fullName: z.string().trim().min(1, "Full name is required.").max(120),
    phone: z.string().trim().regex(PHONE_PATTERN, "Enter a valid phone number.").optional(),
    // worker
    workerRef: optionalText(64),
    contractorCompany: optionalText(160),
    // intern
    institutionName: optionalText(160),
    // visitor
    purposeOfVisit: optionalText(240),
    personToMeet: optionalText(120),
    employeeEmail: z.string().trim().email("Enter a valid email address.").max(160).optional(),
  })
  .strict();

export const updatePersonSchema = createPersonSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to change.");

/**
 * The per-category required fields, exactly as the database CHECK constraints
 * express them. Called after merging a PATCH onto the stored record, because a
 * category change can invalidate a record that was previously complete.
 * Returns the API field names that are missing.
 */
export function missingCategoryFields(category, person) {
  const present = (value) => typeof value === "string" && value.trim().length > 0;
  const missing = [];
  if (category === "worker" && !present(person.workerRef)) missing.push("workerRef");
  if (category === "intern" && !present(person.institutionName)) missing.push("institutionName");
  if (category === "visitor") {
    if (!present(person.purposeOfVisit)) missing.push("purposeOfVisit");
    if (!present(person.personToMeet)) missing.push("personToMeet");
  }
  return missing;
}

export const personStatusSchema = z
  .object({
    status: z.enum(PERSON_STATUSES),
    reason: z.string().trim().min(3, "Provide a reason.").max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const CREDENTIAL_KINDS = ["id_card", "gate_pass"];
export const CREDENTIAL_STATUSES = ["active", "suspended", "terminated"];

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const dateKeyField = z
  .string()
  .regex(DATE_KEY_PATTERN, "Use the format YYYY-MM-DD.")
  .refine(isRealDateKey, "That is not a real calendar date.");

const credentialWindow = (value) => value.validTo >= value.validFrom;

export const createCredentialSchema = z
  .object({
    personId: z.string().trim().min(1, "Choose a person.").max(64),
    kind: z.enum(CREDENTIAL_KINDS),
    validFrom: dateKeyField,
    validTo: dateKeyField,
  })
  .strict()
  .refine(credentialWindow, {
    message: "The end date cannot be before the start date.",
    path: ["validTo"],
  });

export const credentialValiditySchema = z
  .object({
    validFrom: dateKeyField,
    validTo: dateKeyField,
    reason: z.string().trim().min(3, "Provide a reason.").max(500),
  })
  .strict()
  .refine(credentialWindow, {
    message: "The end date cannot be before the start date.",
    path: ["validTo"],
  });

export const credentialStatusSchema = z
  .object({
    status: z.enum(CREDENTIAL_STATUSES),
    reason: z.string().trim().min(3, "Provide a reason.").max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Shared query and path parameters
// ---------------------------------------------------------------------------

/**
 * `req.query` values arrive as strings and can repeat. Collapse to a single
 * value and treat an empty string the same as "not supplied", so `?category=`
 * does not become a validation error.
 */
function singleValue(schema) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === "") return undefined;
    return raw;
  }, schema);
}

const queryText = (max) => singleValue(z.string().trim().min(1).max(max).optional());
const queryEnum = (values) => singleValue(z.enum(values).optional());
const queryInt = (min, max, fallback) =>
  singleValue(z.coerce.number().int().min(min).max(max).default(fallback));
/**
 * A boolean query flag. `?flag=false` and `?flag=0` mean false, so a caller can
 * explicitly turn a default-on filter off instead of accidentally enabling it.
 */
const queryBool = () =>
  singleValue(
    z
      .preprocess((value) => {
        if (value === undefined) return undefined;
        return value === "true" || value === "1" || value === "yes";
      }, z.boolean())
      .optional(),
  );
/**
 * An inclusive instant, always with an offset. Timestamps are stored as
 * fixed-width ISO strings so they can be compared directly in SQL, which is why
 * an unparseable value is refused here rather than silently matching nothing.
 */
const queryDateTime = () => singleValue(z.string().trim().datetime({ offset: true }).optional());

export const searchPeopleQuerySchema = z
  .object({
    q: singleValue(z.string().trim().min(1, "Enter a search term.").max(80)),
    limit: queryInt(1, 50, 20),
  })
  .strict();

export const listPeopleQuerySchema = z
  .object({
    category: queryEnum(PERSON_CATEGORIES),
    status: queryEnum(PERSON_STATUSES),
    q: queryText(80),
    limit: queryInt(1, 200, 50),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(64) }).strict();

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export const GATE_DIRECTIONS = ["entry", "exit"];
export const GATE_RESULTS = ["approved", "rejected", "unable_to_verify"];

/**
 * A scan. `code` can be the credential ID or person short ID (W101, I101, etc.).
 * `direction` can be specified ('entry' | 'exit') or set to 'auto' (determined
 * automatically from the person's current gate state).
 * If a manual override is performed, `overrideReason` records the justification.
 */
export const verifyGateSchema = z
  .object({
    code: z.string().trim().min(1, "Scan or enter a credential code.").max(128),
    direction: z.enum(["entry", "exit", "auto"]).optional(),
    overrideReason: z.string().trim().max(500).optional(),
  })
  .strict();

export const listGateEventsQuerySchema = z
  .object({
    personId: queryText(64),
    result: queryEnum(GATE_RESULTS),
    direction: queryEnum(GATE_DIRECTIONS),
    /** Inclusive bounds on `occurred_at`, for the audit-log date range. */
    from: queryDateTime(),
    to: queryDateTime(),
    limit: queryInt(1, 200, 50),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];
export const INCIDENT_STATUSES = ["open", "investigating", "closed"];

/**
 * A report filed from the gate. `occurredAt` is deliberately absent: the server
 * dates the report when it is filed, because a client clock is not evidence.
 */
export const createIncidentSchema = z
  .object({
    title: z.string().trim().min(3, "Give the incident a short title.").max(160),
    description: optionalText(2000),
    severity: z.enum(INCIDENT_SEVERITIES),
    /** Optional link to the person involved, when the gate knows who it was. */
    personId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const listIncidentsQuerySchema = z
  .object({
    status: queryEnum(INCIDENT_STATUSES),
    severity: queryEnum(INCIDENT_SEVERITIES),
    limit: queryInt(1, 200, 50),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();

/** Triaging a report. The status change is recorded in the audit log. */
export const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES),
    reason: optionalText(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Canteen
// ---------------------------------------------------------------------------

/**
 * A canteen scan. Like the gate it carries only the opaque credential code —
 * the operator never types a name, and the server decides the verdict.
 */
export const verifyCanteenSchema = z
  .object({
    code: z.string().trim().min(1, "Scan or enter a credential code.").max(128),
  })
  .strict();

export const listCanteenEventsQuerySchema = z
  .object({
    /** Local calendar date, `YYYY-MM-DD`; defaults to the plant's today. */
    date: singleValue(z.string().trim().regex(DATE_KEY_PATTERN).optional()),
    result: queryEnum(GATE_RESULTS),
    limit: queryInt(1, 200, 50),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_SEVERITIES = ["info", "warning", "critical"];

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3, "Give the announcement a short title.").max(160),
    body: z.string().trim().min(3, "Write the announcement.").max(4000),
    severity: z.enum(ANNOUNCEMENT_SEVERITIES).default("info"),
    /** Optional ISO instant after which the notice is no longer shown. */
    expiresAt: optionalText(40),
  })
  .strict();

export const listAnnouncementsQuerySchema = z
  .object({
    includeInactive: queryBool(),
    limit: queryInt(1, 100, 50),
  })
  .strict();

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export const WATCHLIST_LEVELS = ["info", "warn", "deny", "detain"];

export const createWatchlistSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the person's name.").max(120),
    reason: z.string().trim().min(3, "Give a reason for flagging this person.").max(500),
    notes: optionalText(2000),
    level: z.enum(WATCHLIST_LEVELS),
    /** Optional link to a person on file. */
    personId: z.string().trim().min(1).max(64).optional(),
    /** Optional known card/barcode value, matched at the gate. */
    barcode: optionalText(128),
    /** Optional ISO instant after which the alert stops firing. */
    expiresAt: optionalText(40),
  })
  .strict();

export const listWatchlistQuerySchema = z
  .object({
    includeInactive: queryBool(),
    level: queryEnum(WATCHLIST_LEVELS),
    limit: queryInt(1, 200, 50),
  })
  .strict();

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * How many plant days the trend series covers, today included. `days=1` is
 * "today only".
 */
export const dashboardSummaryQuerySchema = z
  .object({
    days: queryInt(1, 31, 7),
  })
  .strict();

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** A `YYYY-MM-DD` query value that collapses an empty string to "not supplied". */
const queryDateKey = singleValue(dateKeyField.optional());

/** Whole days between two real date keys, both inclusive. */
function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * The report window is explicit — there is no server-side "last 30 days"
 * default, because "now" is a plant-clock question the caller has already
 * answered by rendering the form. The window is capped so one request can never
 * ask the server to bucket years of events.
 */
export const scanReportQuerySchema = z
  .object({
    from: queryDateKey,
    to: queryDateKey,
  })
  .strict()
  .refine((value) => Boolean(value.from) && Boolean(value.to), {
    message: "Provide both a 'from' and a 'to' date.",
    path: ["from"],
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: "'to' must be on or after 'from'.",
    path: ["to"],
  })
  .refine((value) => !value.from || !value.to || daysBetween(value.from, value.to) <= 366, {
    message: "Choose a window of at most 366 days.",
    path: ["to"],
  });

// ---------------------------------------------------------------------------
// Audit viewer
// ---------------------------------------------------------------------------

export const listAuditQuerySchema = z
  .object({
    action: queryText(80),
    entityType: queryText(60),
    entityId: queryText(64),
    from: queryDateTime(),
    to: queryDateTime(),
    limit: queryInt(1, 200, 100),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();
