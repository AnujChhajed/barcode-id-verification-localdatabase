import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type jsPDF from "jspdf";
import {
  ApiError,
  credentialsApi,
  peopleApi,
  type CredentialKind,
  type CredentialStatus,
  type CredentialView,
  type PersonCategory,
  type PersonInput,
  type PersonStatus,
  type PersonView,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadCSV, parseCSV } from "@/lib/csv";
import {
  downloadBulkIdCards,
  downloadGatePass,
  downloadIdCard,
  generateIdCardPDF,
  printGatePass,
  qrDataUrl,
  type GatePassData,
  type IdCardData,
} from "@/lib/idcard";
import {
  Download,
  GraduationCap,
  HardHat,
  IdCard,
  KeyRound,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/register")({
  component: RegisterPage,
});

/** The API caps `listPeopleQuerySchema.limit` at 200; 25 keeps pages readable. */
const PAGE_SIZE = 25;

const CATEGORIES: PersonCategory[] = ["worker", "intern", "visitor"];
const PERSON_STATUSES: PersonStatus[] = ["active", "suspended", "terminated"];
const CREDENTIAL_KINDS: CredentialKind[] = ["id_card", "gate_pass"];

/** The three big category choices at the top of the register dialog. */
const CATEGORY_CHOICES: Array<{
  value: PersonCategory;
  icon: typeof HardHat;
  labelKey: string;
  descKey: string;
}> = [
  { value: "worker", icon: HardHat, labelKey: "reg.cat_worker", descKey: "reg.cat_worker_desc" },
  {
    value: "intern",
    icon: GraduationCap,
    labelKey: "reg.cat_intern",
    descKey: "reg.cat_intern_desc",
  },
  {
    value: "visitor",
    icon: UserRound,
    labelKey: "reg.cat_visitor",
    descKey: "reg.cat_visitor_desc",
  },
];

// ── Date helpers ──────────────────────────────────────────────────────────

/** "YYYY-MM-DD" in the browser's local timezone, `offsetDays` from today. */
function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** "YYYY-MM-DD" → a short, readable date. Anything else is echoed unchanged. */
function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = value.length <= 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** A tiny debounce so typing in the search box does not fire a request per key. */
function useDebounced<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ── Shared labels ─────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: PersonCategory }) {
  const { t } = useTranslation();
  const label = {
    worker: t("reg.cat_worker"),
    intern: t("reg.cat_intern"),
    visitor: t("reg.cat_visitor"),
  }[category];
  const className = {
    worker: "border-transparent bg-primary/10 text-primary",
    intern: "border-transparent bg-sky-500/10 text-sky-600 dark:text-sky-400",
    visitor: "border-transparent bg-violet-500/10 text-violet-600 dark:text-violet-400",
  }[category];
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function PersonStatusBadge({ status }: { status: PersonStatus }) {
  const { t } = useTranslation();
  const label = {
    active: t("reg.status_active"),
    suspended: t("reg.status_suspended"),
    terminated: t("reg.status_terminated"),
  }[status];
  const variant =
    status === "active" ? "secondary" : status === "suspended" ? "outline" : "destructive";
  const className =
    status === "suspended" ? "border-warning/40 bg-warning/10 text-warning" : undefined;
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

function credentialKindLabel(kind: CredentialKind, t: (key: string) => string) {
  return kind === "id_card" ? t("reg.cred_id_card") : t("reg.cred_gate_pass");
}

/** Visitors carry a gate pass; everyone else gets an ID card. */
function credentialKindFor(category: PersonCategory): CredentialKind {
  return category === "visitor" ? "gate_pass" : "id_card";
}

/** Sensible validity defaults so the administrator usually changes nothing. */
function defaultValidity(category: PersonCategory) {
  return { validFrom: todayKey(0), validTo: todayKey(category === "visitor" ? 0 : 365) };
}

/** Everything the card renderer needs, pulled from the person + their credential. */
function cardDataFor(person: PersonView, credential: CredentialView): IdCardData {
  return {
    credentialId: credential.id,
    kind: credential.kind,
    fullName: person.fullName,
    category: person.category,
    issuedAt: credential.issuedAt,
    validTo: credential.validTo,
  };
}

/** The gate-pass renderer wants the same fields, minus the card `kind`. */
function gatePassFrom(card: IdCardData): GatePassData {
  return {
    credentialId: card.credentialId,
    fullName: card.fullName,
    category: card.category,
    issuedAt: card.issuedAt,
    validTo: card.validTo,
  };
}

/** There is no `printIdCard` in the renderer, so open the generated card for printing. */
function openForPrint(doc: jsPDF) {
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output("blob"));
  const win = window.open(url, "_blank");
  if (win) win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

async function downloadCredential(card: IdCardData) {
  if (card.kind === "gate_pass") await downloadGatePass(gatePassFrom(card));
  else await downloadIdCard(card);
}

async function printCredential(card: IdCardData) {
  if (card.kind === "gate_pass") await printGatePass(gatePassFrom(card));
  else openForPrint(await generateIdCardPDF(card));
}

// ── On-screen QR preview ──────────────────────────────────────────────────
//
// `qrDataUrl` is asynchronous and expensive, so it is generated once per value
// inside an effect (never on every render) and the result is dropped if the
// component unmounts before the promise settles.

function QrPreview({ value, className, alt }: { value: string; className?: string; alt?: string }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSrc(null);
    qrDataUrl(value).then(
      (url) => {
        if (active) setSrc(url);
      },
      () => {
        if (active) setSrc(null);
      },
    );
    return () => {
      active = false;
    };
  }, [value]);

  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded border border-border bg-white text-center text-[10px] text-muted-foreground",
          className,
        )}
      >
        {t("reg.qr_loading")}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt ?? ""}
      className={cn("rounded border border-border bg-white", className)}
    />
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

function RegisterPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [category, setCategory] = useState<"all" | PersonCategory>("all");
  const [status, setStatus] = useState<"all" | PersonStatus>("all");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  // A new filter invalidates the current page offset.
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, category, status]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["people", { q: debouncedSearch, category, status, offset }],
    enabled: isAdmin,
    queryFn: () =>
      peopleApi.list({
        q: debouncedSearch.trim() || undefined,
        category: category === "all" ? undefined : category,
        status: status === "all" ? undefined : status,
        limit: PAGE_SIZE,
        offset,
      }),
  });

  const people = data?.people ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const allOnPageSelected = people.length > 0 && people.every((p) => selected.has(p.id));
  const selectedOnPage = people.filter((p) => selected.has(p.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) people.forEach((p) => next.delete(p.id));
      else people.forEach((p) => next.add(p.id));
      return next;
    });

  // The export scope is never a surprise: it is whichever the button says.
  const exportScope = selectedOnPage.length ? selectedOnPage : people;

  const exportCsv = () => {
    const rows = exportScope.map((p) => ({
      full_name: p.fullName,
      category: p.category,
      status: p.status,
      worker_ref: p.workerRef ?? "",
      contractor_company: p.contractorCompany ?? "",
      institution_name: p.institutionName ?? "",
      phone: p.phone ?? "",
      purpose_of_visit: p.purposeOfVisit ?? "",
      person_to_meet: p.personToMeet ?? "",
      employee_email: p.employeeEmail ?? "",
    }));
    if (!rows.length) {
      toast.error(t("reg.export_empty"));
      return;
    }
    downloadCSV(`abb-people-${todayKey()}.csv`, rows);
    toast.success(t("reg.export_done", { count: rows.length }));
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("reg.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("reg.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={"mr-2 h-4 w-4" + (isFetching ? " animate-spin" : "")} />
            {t("common2.refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            {selectedOnPage.length
              ? t("reg.export_selected", { count: selectedOnPage.length })
              : t("reg.export_page", { count: people.length })}
          </Button>
          <ImportCsvDialog />
          <PrintCardsButton selected={selected} people={people} />
          <RegisterGroupDialog />
          <RegisterPersonDialog />
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("reg.search_ph")}
            className="pl-9"
          />
        </div>

        <Select value={category} onValueChange={(v) => setCategory(v as "all" | PersonCategory)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reg.filter_category_all")}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`reg.cat_${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => setStatus(v as "all" | PersonStatus)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reg.filter_status_all")}</SelectItem>
            {PERSON_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`reg.status_${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAllOnPage}
                    aria-label={t("reg.select_all")}
                  />
                </th>
                <th className="px-4 py-3 text-left">{t("reg.col_name")}</th>
                <th className="px-4 py-3 text-left">{t("reg.col_category")}</th>
                <th className="px-4 py-3 text-left">{t("reg.col_ref")}</th>
                <th className="px-4 py-3 text-left">{t("reg.col_status")}</th>
                <th className="px-4 py-3 text-right">{t("reg.col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => (
                <tr key={p.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      aria-label={p.fullName}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{p.fullName}</span>
                    {p.phone && (
                      <span className="block text-xs text-muted-foreground">{p.phone}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <CategoryBadge category={p.category} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{affiliationText(p)}</td>
                  <td className="px-4 py-3">
                    <PersonStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpenPersonId(p.id)}>
                      {t("reg.open")}
                    </Button>
                  </td>
                </tr>
              ))}

              {!isLoading && people.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    <p className="font-medium">{t("reg.empty")}</p>
                    <p className="mt-1 text-xs">{t("reg.empty_hint")}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>{t("reg.total_count", { total })}</span>
          <div className="flex items-center gap-3">
            <span>{t("reg.page_of", { page, pages: pageCount })}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                {t("reg.prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                {t("reg.next")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {selected.size > 0
          ? t("reg.selected_count", { count: selected.size })
          : t("reg.admin_only_note")}
      </p>

      {openPersonId && (
        <PersonDetailDialog id={openPersonId} onClose={() => setOpenPersonId(null)} />
      )}
    </div>
  );
}

/** Worker ref, contractor or institution — whichever the category uses. */
function affiliationText(person: PersonView) {
  const parts = [person.workerRef, person.contractorCompany, person.institutionName].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  return parts.length ? parts.join(" · ") : "—";
}

// ── Bulk ID cards for the selected rows ───────────────────────────────────

function PrintCardsButton({ selected, people }: { selected: Set<string>; people: PersonView[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const print = async () => {
    // The list view carries no credential ids, so pull each person's detail.
    const targets = people.filter((p) => selected.has(p.id));
    if (!targets.length) {
      toast.error(t("reg.cards_none_selected"));
      return;
    }

    setBusy(true);
    try {
      const results = await Promise.all(
        targets.map(async (person) => {
          const detail = await peopleApi.get(person.id);
          const credential = detail.credentials.find(
            (c) => c.kind === "id_card" && c.status === "active",
          );
          return credential ? cardDataFor(detail.person, credential) : null;
        }),
      );

      const cards = results.filter((c): c is IdCardData => c !== null);
      if (!cards.length) {
        toast.error(t("reg.cards_no_credential"));
        return;
      }
      await downloadBulkIdCards(cards);
      if (cards.length < targets.length) {
        toast.warning(t("reg.cards_partial", { printed: cards.length, total: targets.length }));
      } else {
        toast.success(t("reg.cards_printed", { count: cards.length }));
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={print} disabled={busy || selected.size === 0}>
      <IdCard className="mr-2 h-4 w-4" />
      {busy ? t("reg.printing") : t("reg.print_cards")}
    </Button>
  );
}

// ── Register a person and issue their card in one step ────────────────────

const EMPTY_FORM = {
  fullName: "",
  phone: "",
  workerRef: "",
  contractorCompany: "",
  institutionName: "",
  purposeOfVisit: "",
  personToMeet: "",
  employeeEmail: "",
};

type PersonForm = typeof EMPTY_FORM;

interface RegisterOutcome {
  person: PersonView;
  credential: CredentialView | null;
}

function RegisterPersonDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PersonCategory>("worker");
  const [form, setForm] = useState<PersonForm>(EMPTY_FORM);
  const [validity, setValidity] = useState(() => defaultValidity("worker"));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<RegisterOutcome | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // The browser's native `required` validation applies to both buttons, so the
  // chosen action is tracked rather than duplicated as two submit handlers.
  const withCardRef = useRef(true);

  const setField = (key: keyof PersonForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const chooseCategory = (next: PersonCategory) => {
    setCategory(next);
    setValidity(defaultValidity(next));
  };

  const buildInput = (): PersonInput => ({
    category,
    fullName: form.fullName.trim(),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    ...(form.workerRef.trim() ? { workerRef: form.workerRef.trim() } : {}),
    ...(form.contractorCompany.trim() ? { contractorCompany: form.contractorCompany.trim() } : {}),
    ...(form.institutionName.trim() ? { institutionName: form.institutionName.trim() } : {}),
    ...(form.purposeOfVisit.trim() ? { purposeOfVisit: form.purposeOfVisit.trim() } : {}),
    ...(form.personToMeet.trim() ? { personToMeet: form.personToMeet.trim() } : {}),
    ...(form.employeeEmail.trim() ? { employeeEmail: form.employeeEmail.trim() } : {}),
  });

  const reset = () => {
    setCategory("worker");
    setForm(EMPTY_FORM);
    setValidity(defaultValidity("worker"));
    setFieldErrors({});
    setOutcome(null);
    setCredentialError(null);
    setPreparing(false);
    withCardRef.current = true;
  };

  const register = useMutation({
    mutationFn: async (
      withCard: boolean,
    ): Promise<{ outcome: RegisterOutcome; error: string | null }> => {
      // Step 1 — create the person. A failure here throws and lands in onError.
      const person = await peopleApi.create(buildInput());
      if (!withCard) return { outcome: { person, credential: null }, error: null };
      // Step 2 — issue the card. A failure here must NOT discard the person, so
      // it is reported alongside them rather than thrown.
      try {
        const credential = await credentialsApi.issue({
          personId: person.id,
          kind: credentialKindFor(category),
          validFrom: validity.validFrom,
          validTo: validity.validTo,
        });
        return { outcome: { person, credential }, error: null };
      } catch (error) {
        return {
          outcome: { person, credential: null },
          error: error instanceof ApiError ? error.message : t("common.error"),
        };
      }
    },
    onSuccess: ({ outcome: result, error }) => {
      qc.invalidateQueries({ queryKey: ["people"] });
      setOutcome(result);
      setCredentialError(error);
      if (error) toast.error(t("reg.register_cred_failed", { name: result.person.fullName }));
      else if (result.credential)
        toast.success(t("reg.register_card_ready", { name: result.person.fullName }));
      else toast.success(t("reg.register_person_only_done", { name: result.person.fullName }));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        // The backend names the missing per-category fields — show them inline.
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      } else {
        setFieldErrors({});
      }
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    },
  });

  const retryIssue = useMutation({
    mutationFn: (personId: string) =>
      credentialsApi.issue({
        personId,
        kind: credentialKindFor(category),
        validFrom: validity.validFrom,
        validTo: validity.validTo,
      }),
    onSuccess: (credential) => {
      setOutcome((prev) => (prev ? { person: prev.person, credential } : prev));
      setCredentialError(null);
      qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(t("reg.cred_issued"));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    register.mutate(withCardRef.current);
  };

  const err = (field: string) =>
    fieldErrors[field] ? <p className="text-xs text-destructive">{fieldErrors[field]}</p> : null;

  const resultCard =
    outcome && outcome.credential ? cardDataFor(outcome.person, outcome.credential) : null;

  const runCardAction = async (action: (card: IdCardData) => Promise<void>) => {
    if (!resultCard) return;
    setPreparing(true);
    try {
      await action(resultCard);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          {t("reg.register_issue")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reg.register_title")}</DialogTitle>
          <DialogDescription>{t("reg.register_desc")}</DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-lg border border-border bg-secondary/30 p-4">
              {outcome.credential && (
                <QrPreview
                  value={outcome.credential.id}
                  className="h-28 w-28"
                  alt={outcome.person.fullName}
                />
              )}
              <div className="space-y-1.5">
                <p className="text-base font-semibold">{outcome.person.fullName}</p>
                <CategoryBadge category={outcome.person.category} />
                {outcome.credential ? (
                  <p className="text-xs text-muted-foreground">
                    {credentialKindLabel(outcome.credential.kind, t)} ·{" "}
                    {t("reg.valid_until_short", { date: formatDate(outcome.credential.validTo) })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("reg.person_only_title")}</p>
                )}
              </div>
            </div>

            {credentialError ? (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  {t("reg.register_cred_failed", { name: outcome.person.fullName })}
                </p>
                <p className="text-xs text-muted-foreground">{credentialError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retryIssue.mutate(outcome.person.id)}
                  disabled={retryIssue.isPending}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  {retryIssue.isPending ? t("reg.issuing") : t("reg.register_retry")}
                </Button>
              </div>
            ) : resultCard ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void runCardAction(downloadCredential)} disabled={preparing}>
                  <Download className="mr-2 h-4 w-4" />
                  {t("reg.download_card")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void runCardAction(printCredential)}
                  disabled={preparing}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  {t("reg.print_now")}
                </Button>
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("reg.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("reg.field_category")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_CHOICES.map(({ value, icon: Icon, labelKey, descKey }) => {
                  const active = category === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseCategory(value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      <Icon className="h-6 w-6" />
                      <span className="text-sm font-medium">{t(labelKey)}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground">
                        {t(descKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{t("reg.required_note")}</p>

            <div className="space-y-1.5">
              <Label htmlFor="rp-name">
                {t("reg.field_full_name")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rp-name"
                required
                autoComplete="off"
                value={form.fullName}
                onChange={(e) => setField("fullName")(e.target.value)}
              />
              {err("fullName")}
            </div>

            {category === "worker" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-ref">
                    {t("reg.field_worker_ref")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="rp-ref"
                    required
                    autoComplete="off"
                    value={form.workerRef}
                    onChange={(e) => setField("workerRef")(e.target.value)}
                  />
                  {err("workerRef")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-contractor">{t("reg.field_contractor")}</Label>
                  <Input
                    id="rp-contractor"
                    autoComplete="off"
                    value={form.contractorCompany}
                    onChange={(e) => setField("contractorCompany")(e.target.value)}
                  />
                  {err("contractorCompany")}
                </div>
              </>
            )}

            {category === "intern" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-institution">
                    {t("reg.field_institution")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="rp-institution"
                    required
                    autoComplete="off"
                    value={form.institutionName}
                    onChange={(e) => setField("institutionName")(e.target.value)}
                  />
                  {err("institutionName")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-intern-ref">{t("reg.field_worker_ref")}</Label>
                  <Input
                    id="rp-intern-ref"
                    autoComplete="off"
                    value={form.workerRef}
                    onChange={(e) => setField("workerRef")(e.target.value)}
                  />
                  {err("workerRef")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-intern-contractor">{t("reg.field_contractor")}</Label>
                  <Input
                    id="rp-intern-contractor"
                    autoComplete="off"
                    value={form.contractorCompany}
                    onChange={(e) => setField("contractorCompany")(e.target.value)}
                  />
                  {err("contractorCompany")}
                </div>
              </>
            )}

            {category === "visitor" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-purpose">
                    {t("reg.field_purpose")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="rp-purpose"
                    required
                    autoComplete="off"
                    value={form.purposeOfVisit}
                    onChange={(e) => setField("purposeOfVisit")(e.target.value)}
                  />
                  {err("purposeOfVisit")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-meet">
                    {t("reg.field_to_meet")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="rp-meet"
                    required
                    autoComplete="off"
                    value={form.personToMeet}
                    onChange={(e) => setField("personToMeet")(e.target.value)}
                  />
                  {err("personToMeet")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-email">{t("reg.field_visitor_email")}</Label>
                  <Input
                    id="rp-email"
                    type="email"
                    autoComplete="off"
                    value={form.employeeEmail}
                    onChange={(e) => setField("employeeEmail")(e.target.value)}
                  />
                  {err("employeeEmail")}
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rp-phone">{t("reg.field_phone")}</Label>
              <Input
                id="rp-phone"
                autoComplete="off"
                placeholder="+91 98xxx xxxxx"
                value={form.phone}
                onChange={(e) => setField("phone")(e.target.value)}
              />
              {err("phone")}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rp-from">{t("reg.field_valid_from")}</Label>
                <Input
                  id="rp-from"
                  type="date"
                  value={validity.validFrom}
                  onChange={(e) => setValidity((v) => ({ ...v, validFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-to">{t("reg.field_valid_to")}</Label>
                <Input
                  id="rp-to"
                  type="date"
                  value={validity.validTo}
                  onChange={(e) => setValidity((v) => ({ ...v, validTo: e.target.value }))}
                />
                {err("validTo")}
              </div>
            </div>
            {category === "visitor" && (
              <p className="text-xs text-muted-foreground">{t("reg.validity_visitor_hint")}</p>
            )}

            <DialogFooter className="flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="outline"
                onClick={() => {
                  withCardRef.current = false;
                }}
                disabled={register.isPending}
              >
                {register.isPending && !withCardRef.current
                  ? t("reg.creating")
                  : t("reg.register_without_card")}
              </Button>
              <Button
                type="submit"
                onClick={() => {
                  withCardRef.current = true;
                }}
                disabled={register.isPending || validity.validTo < validity.validFrom}
              >
                {register.isPending && withCardRef.current
                  ? t("reg.issuing_card")
                  : t("reg.register_issue")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Register a group of visitors, one pass each ───────────────────────────

interface GroupRow {
  id: number;
  fullName: string;
  phone: string;
}

interface GroupResult {
  name: string;
  person: PersonView | null;
  credential: CredentialView | null;
  error: string | null;
}

function RegisterGroupDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nextId = useRef(1);
  const makeRows = (): GroupRow[] => [
    { id: nextId.current++, fullName: "", phone: "" },
    { id: nextId.current++, fullName: "", phone: "" },
    { id: nextId.current++, fullName: "", phone: "" },
  ];

  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [host, setHost] = useState("");
  const [email, setEmail] = useState("");
  const [sharedErrors, setSharedErrors] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<GroupRow[]>(makeRows);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<GroupResult[] | null>(null);

  const setRow = (id: number, patch: Partial<GroupRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((prev) => [...prev, { id: nextId.current++, fullName: "", phone: "" }]);
  const removeRow = (id: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));

  const reset = () => {
    setPurpose("");
    setHost("");
    setEmail("");
    setSharedErrors({});
    setRows(makeRows());
    setBusy(false);
    setProgress(0);
    setTotal(0);
    setResults(null);
  };

  const run = async () => {
    const errors: Record<string, string> = {};
    if (!purpose.trim()) errors.purposeOfVisit = t("reg.group_need_purpose");
    if (!host.trim()) errors.personToMeet = t("reg.group_need_host");
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()))
      errors.employeeEmail = t("reg.group_email_invalid");
    setSharedErrors(errors);
    if (Object.keys(errors).length) return;

    const filled = rows.filter((r) => r.fullName.trim());
    if (!filled.length) {
      toast.error(t("reg.group_need_name"));
      return;
    }

    setBusy(true);
    setProgress(0);
    setTotal(filled.length);
    const today = todayKey(0);
    const collected: GroupResult[] = [];

    // Sequential so the per-person order matches the sheet and one bad row does
    // not discard the ones already created.
    for (const row of filled) {
      try {
        const person = await peopleApi.create({
          category: "visitor",
          fullName: row.fullName.trim(),
          ...(row.phone.trim() ? { phone: row.phone.trim() } : {}),
          purposeOfVisit: purpose.trim(),
          personToMeet: host.trim(),
          ...(email.trim() ? { employeeEmail: email.trim() } : {}),
        });
        try {
          const credential = await credentialsApi.issue({
            personId: person.id,
            kind: "gate_pass",
            validFrom: today,
            validTo: today,
          });
          collected.push({ name: person.fullName, person, credential, error: null });
        } catch (error) {
          collected.push({
            name: person.fullName,
            person,
            credential: null,
            error: error instanceof ApiError ? error.message : t("common.error"),
          });
        }
      } catch (error) {
        collected.push({
          name: row.fullName.trim(),
          person: null,
          credential: null,
          error: error instanceof ApiError ? error.message : t("common.error"),
        });
      }
      setProgress(collected.length);
    }

    setResults(collected);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["people"] });
    const created = collected.filter((r) => r.credential).length;
    if (created > 0) toast.success(t("reg.group_summary", { created, total: filled.length }));
    else toast.error(t("reg.group_failed_all"));
  };

  const downloadAll = async () => {
    const cards: IdCardData[] = [];
    for (const r of results ?? []) {
      if (r.person && r.credential) cards.push(cardDataFor(r.person, r.credential));
    }
    if (!cards.length) {
      toast.error(t("reg.cards_no_credential"));
      return;
    }
    try {
      await downloadBulkIdCards(cards);
      toast.success(t("reg.cards_printed", { count: cards.length }));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const created = (results ?? []).filter((r) => r.credential).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="mr-2 h-4 w-4" />
          {t("reg.group_btn")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("reg.group_title")}</DialogTitle>
          <DialogDescription>{t("reg.group_desc")}</DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              {t("reg.group_summary", { created, total: results.length })}
            </p>

            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {results.map((r, i) => (
                <li
                  key={`${r.name}-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-border p-2"
                >
                  {r.credential ? (
                    <QrPreview value={r.credential.id} className="h-14 w-14" alt={r.name} />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded border border-destructive/40 bg-destructive/5 text-destructive">
                      <ShieldOff className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    {r.credential ? (
                      <p className="text-xs text-muted-foreground">{t("reg.group_pass_issued")}</p>
                    ) : (
                      <p className="text-xs text-destructive">{r.error}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={reset}>
                {t("reg.group_another")}
              </Button>
              {created > 0 && (
                <Button onClick={() => void downloadAll()}>
                  <Download className="mr-2 h-4 w-4" />
                  {t("reg.group_download_all", { count: created })}
                </Button>
              )}
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("reg.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-sm font-semibold">{t("reg.group_shared")}</p>
              <div className="space-y-1.5">
                <Label htmlFor="rg-purpose">
                  {t("reg.field_purpose")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rg-purpose"
                  autoComplete="off"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
                {sharedErrors.purposeOfVisit && (
                  <p className="text-xs text-destructive">{sharedErrors.purposeOfVisit}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rg-host">
                  {t("reg.field_to_meet")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="rg-host"
                  autoComplete="off"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
                {sharedErrors.personToMeet && (
                  <p className="text-xs text-destructive">{sharedErrors.personToMeet}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rg-email">{t("reg.field_visitor_email")}</Label>
                <Input
                  id="rg-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {sharedErrors.employeeEmail && (
                  <p className="text-xs text-destructive">{sharedErrors.employeeEmail}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("reg.group_today_note")}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{t("reg.group_people")}</p>
                <p className="text-xs text-muted-foreground">{t("reg.group_blank_note")}</p>
              </div>
              {rows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <Input
                    value={row.fullName}
                    onChange={(e) => setRow(row.id, { fullName: e.target.value })}
                    placeholder={t("reg.group_row_ph")}
                    className="flex-1"
                    autoComplete="off"
                  />
                  <Input
                    value={row.phone}
                    onChange={(e) => setRow(row.id, { phone: e.target.value })}
                    placeholder={t("reg.group_phone_ph")}
                    className="w-[150px]"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length <= 1}
                    title={t("reg.group_remove_row")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={busy}>
                <Plus className="mr-2 h-4 w-4" />
                {t("reg.group_add_row")}
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void run()} disabled={busy}>
                {busy
                  ? t("reg.group_working", { done: progress, total })
                  : t("reg.group_submit", { count: rows.filter((r) => r.fullName.trim()).length })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Edit an existing person (B3) ──────────────────────────────────────────

function EditPersonDialog({ person, onClose }: { person: PersonView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    category: person.category,
    fullName: person.fullName,
    phone: person.phone ?? "",
    workerRef: person.workerRef ?? "",
    contractorCompany: person.contractorCompany ?? "",
    institutionName: person.institutionName ?? "",
    purposeOfVisit: person.purposeOfVisit ?? "",
    personToMeet: person.personToMeet ?? "",
    employeeEmail: person.employeeEmail ?? "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const err = (field: string) =>
    fieldErrors[field] ? <p className="text-xs text-destructive">{fieldErrors[field]}</p> : null;

  /**
   * Only the fields that actually changed, and never an empty string — the API
   * rejects "" where a value is expected, so a blank box means "leave it as is".
   */
  const buildPatch = (): Partial<PersonInput> => {
    const patch: Partial<PersonInput> = {};
    const diff = (next: string, prev: string | null | undefined) => {
      const v = next.trim();
      return v && v !== (prev ?? "").trim() ? v : null;
    };
    const name = diff(form.fullName, person.fullName);
    if (name) patch.fullName = name;
    const phone = diff(form.phone, person.phone);
    if (phone) patch.phone = phone;
    const ref = diff(form.workerRef, person.workerRef);
    if (ref) patch.workerRef = ref;
    const company = diff(form.contractorCompany, person.contractorCompany);
    if (company) patch.contractorCompany = company;
    const inst = diff(form.institutionName, person.institutionName);
    if (inst) patch.institutionName = inst;
    const purpose = diff(form.purposeOfVisit, person.purposeOfVisit);
    if (purpose) patch.purposeOfVisit = purpose;
    const meet = diff(form.personToMeet, person.personToMeet);
    if (meet) patch.personToMeet = meet;
    const email = diff(form.employeeEmail, person.employeeEmail);
    if (email) patch.employeeEmail = email;
    if (form.category !== person.category) patch.category = form.category;
    return patch;
  };

  const update = useMutation({
    mutationFn: (patch: Partial<PersonInput>) => peopleApi.update(person.id, patch),
    onSuccess: (updated) => {
      toast.success(t("reg.edit_updated", { name: updated.fullName }));
      qc.invalidateQueries({ queryKey: ["person", person.id] });
      qc.invalidateQueries({ queryKey: ["people"] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        setFieldErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      } else {
        setFieldErrors({});
      }
      toast.error(error instanceof ApiError ? error.message : t("common.error"));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      toast.info(t("reg.edit_nothing"));
      return;
    }
    update.mutate(patch);
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reg.edit_title")}</DialogTitle>
          <DialogDescription>{t("reg.edit_desc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ep-category">{t("reg.field_category")}</Label>
            <Select value={form.category} onValueChange={(v) => set("category")(v)}>
              <SelectTrigger id="ep-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`reg.cat_${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-name">{t("reg.field_full_name")}</Label>
            <Input
              id="ep-name"
              required
              autoComplete="off"
              value={form.fullName}
              onChange={(e) => set("fullName")(e.target.value)}
            />
            {err("fullName")}
          </div>

          {form.category === "worker" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ep-ref">{t("reg.field_worker_ref")}</Label>
                <Input
                  id="ep-ref"
                  required
                  autoComplete="off"
                  value={form.workerRef}
                  onChange={(e) => set("workerRef")(e.target.value)}
                />
                {err("workerRef")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-contractor">{t("reg.field_contractor")}</Label>
                <Input
                  id="ep-contractor"
                  autoComplete="off"
                  value={form.contractorCompany}
                  onChange={(e) => set("contractorCompany")(e.target.value)}
                />
                {err("contractorCompany")}
              </div>
            </>
          )}

          {form.category === "intern" && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-institution">{t("reg.field_institution")}</Label>
              <Input
                id="ep-institution"
                required
                autoComplete="off"
                value={form.institutionName}
                onChange={(e) => set("institutionName")(e.target.value)}
              />
              {err("institutionName")}
            </div>
          )}

          {form.category === "visitor" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ep-purpose">{t("reg.field_purpose")}</Label>
                <Input
                  id="ep-purpose"
                  required
                  autoComplete="off"
                  value={form.purposeOfVisit}
                  onChange={(e) => set("purposeOfVisit")(e.target.value)}
                />
                {err("purposeOfVisit")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-meet">{t("reg.field_to_meet")}</Label>
                <Input
                  id="ep-meet"
                  required
                  autoComplete="off"
                  value={form.personToMeet}
                  onChange={(e) => set("personToMeet")(e.target.value)}
                />
                {err("personToMeet")}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ep-phone">{t("reg.field_phone")}</Label>
            <Input
              id="ep-phone"
              autoComplete="off"
              value={form.phone}
              onChange={(e) => set("phone")(e.target.value)}
            />
            {err("phone")}
          </div>

          {form.category !== "visitor" && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-email">{t("reg.field_email")}</Label>
              <Input
                id="ep-email"
                type="email"
                autoComplete="off"
                value={form.employeeEmail}
                onChange={(e) => set("employeeEmail")(e.target.value)}
              />
              {err("employeeEmail")}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t("reg.edit_saving") : t("reg.edit_btn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk CSV import (B7) ──────────────────────────────────────────────────

const IMPORT_TEMPLATE_ROW = {
  category: "worker",
  full_name: "Jane Doe",
  phone: "+91 98000 00000",
  worker_ref: "CTR-0001",
  contractor_company: "Example Contractors Pvt Ltd",
  institution_name: "",
  purpose_of_visit: "",
  person_to_meet: "",
  employee_email: "jane.doe@example.com",
};

/** Header aliases so a hand-made sheet still maps onto the right column. */
const IMPORT_ALIASES: Record<string, string[]> = {
  category: ["category", "type", "kind"],
  full_name: ["fullname", "name", "names", "personname"],
  phone: ["phone", "mobile", "contact", "phonenumber"],
  worker_ref: ["workerref", "workerreference", "ref", "reference", "employeenumber"],
  contractor_company: ["contractorcompany", "contractor", "company"],
  institution_name: ["institutionname", "institution", "college", "university", "school"],
  purpose_of_visit: ["purposeofvisit", "purpose", "reason"],
  person_to_meet: ["persontomeet", "meet", "host", "contactperson"],
  employee_email: ["employeeemail", "email", "workemail"],
};

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function pickColumn(row: Record<string, string>, field: string): string {
  const columns = Object.keys(row).map((key) => ({ key, n: normKey(key) }));
  for (const alias of IMPORT_ALIASES[field] ?? [field]) {
    const hit = columns.find((c) => c.n === alias);
    if (hit) {
      const value = String(row[hit.key] ?? "").trim();
      if (value) return value;
    }
  }
  return "";
}

interface PreparedRow {
  rowNo: number;
  input: PersonInput;
  error?: string;
}

interface ImportRowOutcome {
  row: number;
  name: string;
  message: string;
}

function ImportCsvDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PreparedRow[] | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [created, setCreated] = useState(0);
  const [failures, setFailures] = useState<ImportRowOutcome[]>([]);
  const [done, setDone] = useState(false);

  const reset = () => {
    setRows(null);
    setReading(false);
    setBusy(false);
    setProgress(0);
    setCreated(0);
    setFailures([]);
    setDone(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const prepare = (raw: Record<string, string>, rowNo: number): PreparedRow => {
    const rawCategory = pickColumn(raw, "category").toLowerCase();
    const category = (rawCategory || "worker") as PersonCategory;
    const fullName = pickColumn(raw, "full_name");
    const phone = pickColumn(raw, "phone");
    const workerRef = pickColumn(raw, "worker_ref");
    const contractorCompany = pickColumn(raw, "contractor_company");
    const institutionName = pickColumn(raw, "institution_name");
    const purposeOfVisit = pickColumn(raw, "purpose_of_visit");
    const personToMeet = pickColumn(raw, "person_to_meet");
    const employeeEmail = pickColumn(raw, "employee_email");

    const input: PersonInput = {
      category,
      fullName,
      ...(phone ? { phone } : {}),
      ...(workerRef ? { workerRef } : {}),
      ...(contractorCompany ? { contractorCompany } : {}),
      ...(institutionName ? { institutionName } : {}),
      ...(purposeOfVisit ? { purposeOfVisit } : {}),
      ...(personToMeet ? { personToMeet } : {}),
      ...(employeeEmail ? { employeeEmail } : {}),
    };

    let error: string | undefined;
    if (category !== "worker" && category !== "intern" && category !== "visitor") {
      error = t("reg.import_err_category");
    } else if (!fullName) {
      error = t("reg.import_err_name");
    } else if (category === "worker" && !workerRef) {
      error = t("reg.import_err_worker");
    } else if (category === "intern" && !institutionName) {
      error = t("reg.import_err_intern");
    } else if (category === "visitor" && (!purposeOfVisit || !personToMeet)) {
      error = t("reg.import_err_visitor");
    }

    return { rowNo, input, error };
  };

  const onFile = async (file: File) => {
    setReading(true);
    setDone(false);
    setFailures([]);
    setCreated(0);
    setProgress(0);
    try {
      const raw = await parseCSV<Record<string, string>>(file);
      const nonEmpty = raw.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
      if (!nonEmpty.length) {
        toast.error(t("reg.import_empty"));
        setRows(null);
        return;
      }
      // Row 1 is the header line, so the first data row is row 2.
      setRows(nonEmpty.map((r, i) => prepare(r, i + 2)));
    } catch {
      toast.error(t("common.error"));
      setRows(null);
    } finally {
      setReading(false);
    }
  };

  const run = async () => {
    if (!rows) return;
    setBusy(true);
    setProgress(0);
    setFailures([]);
    setDone(false);
    const failed: ImportRowOutcome[] = [];
    let ok = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (r.error) {
        failed.push({ row: r.rowNo, name: r.input.fullName, message: r.error });
      } else {
        try {
          await peopleApi.create(r.input);
          ok += 1;
        } catch (error) {
          failed.push({
            row: r.rowNo,
            name: r.input.fullName,
            message: error instanceof ApiError ? error.message : t("common.error"),
          });
        }
      }
      setProgress(i + 1);
    }
    setCreated(ok);
    setFailures(failed);
    setBusy(false);
    setDone(true);
    qc.invalidateQueries({ queryKey: ["people"] });
    if (ok > 0) toast.success(t("reg.import_done", { created: ok, total: rows.length }));
    else toast.error(t("reg.import_failed_all"));
  };

  const validCount = rows?.filter((r) => !r.error).length ?? 0;
  const invalidCount = rows ? rows.length - validCount : 0;

  const downloadFailures = () => {
    downloadCSV(
      `abb-people-import-failures-${todayKey()}.csv`,
      failures.map((f) => ({ row: f.row, full_name: f.name, error: f.message })),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" />
          {t("reg.import_csv")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reg.import_title")}</DialogTitle>
          <DialogDescription>{t("reg.import_desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1 — the template */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("reg.import_step1")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadCSV("abb-people-template.csv", [IMPORT_TEMPLATE_ROW])}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("reg.import_template")}
            </Button>
          </div>

          {/* Step 2 — what to fill in */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("reg.import_step2")}</p>
            <p className="text-xs text-muted-foreground">{t("reg.import_hint")}</p>
            <p className="text-xs text-muted-foreground">{t("reg.import_step2_hint")}</p>
          </div>

          {/* Step 3 — upload */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("reg.import_step3")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("reg.import_choose")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </div>

          {reading && <p className="text-sm text-muted-foreground">{t("reg.import_parsing")}</p>}

          {rows && !done && (
            <>
              <p className="text-sm">
                {t("reg.import_summary", {
                  total: rows.length,
                  valid: validCount,
                  invalid: invalidCount,
                })}
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => void run()}
                  disabled={busy || validCount === 0}
                >
                  {busy
                    ? `${t("reg.import_running")} ${progress}/${rows.length}`
                    : t("reg.import_run", { count: validCount })}
                </Button>
              </DialogFooter>
            </>
          )}

          {done && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {t("reg.import_result", { created, failed: failures.length })}
              </p>

              {failures.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="mb-2 text-xs font-semibold text-destructive">
                    {t("reg.import_errors")}
                  </p>
                  <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                    {failures.map((f) => (
                      <li key={f.row}>
                        <span className="font-medium">{t("reg.import_row", { row: f.row })}</span>
                        {f.name ? ` · ${f.name}` : ""} — {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <DialogFooter className="flex-wrap gap-2">
                {failures.length > 0 && (
                  <Button type="button" variant="outline" onClick={downloadFailures}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("reg.import_download_failures", { count: failures.length })}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={reset}>
                  {t("reg.import_another")}
                </Button>
                <Button type="button" onClick={() => setOpen(false)}>
                  {t("reg.close")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Person detail: profile, credentials, status ───────────────────────────

function PersonDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [nextStatus, setNextStatus] = useState<PersonStatus>("suspended");
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["person", id],
    queryFn: () => peopleApi.get(id),
  });

  const person = data?.person;
  const credentials = data?.credentials ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["person", id] });
    qc.invalidateQueries({ queryKey: ["people"] });
  };

  const changeStatus = useMutation({
    mutationFn: () => peopleApi.setStatus(id, nextStatus, reason.trim()),
    onSuccess: () => {
      toast.success(t("reg.person_status_updated"));
      setReason("");
      invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{person ? person.fullName : t("common.loading")}</DialogTitle>
          <DialogDescription>{t("reg.detail_desc")}</DialogDescription>
        </DialogHeader>

        {isLoading || !person ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("reg.edit_person")}
              </Button>
            </div>

            {/* ── Profile ───────────────────────────────────────── */}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={t("reg.field_category")}>
                <CategoryBadge category={person.category} />
              </Field>
              <Field label={t("reg.col_status")}>
                <PersonStatusBadge status={person.status} />
              </Field>
              {person.phone && <Field label={t("reg.field_phone")}>{person.phone}</Field>}
              {person.workerRef && (
                <Field label={t("reg.field_worker_ref")}>{person.workerRef}</Field>
              )}
              {person.contractorCompany && (
                <Field label={t("reg.field_contractor")}>{person.contractorCompany}</Field>
              )}
              {person.institutionName && (
                <Field label={t("reg.field_institution")}>{person.institutionName}</Field>
              )}
              {person.purposeOfVisit && (
                <Field label={t("reg.field_purpose")}>{person.purposeOfVisit}</Field>
              )}
              {person.personToMeet && (
                <Field label={t("reg.field_to_meet")}>{person.personToMeet}</Field>
              )}
              {person.employeeEmail && (
                <Field label={t("reg.field_email")}>{person.employeeEmail}</Field>
              )}
            </dl>

            {/* ── Credentials ───────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{t("reg.detail_credentials")}</p>
                <IssueCredentialButton person={person} onIssued={invalidate} />
              </div>
              {credentials.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reg.cred_none")}</p>
              ) : (
                <div className="space-y-2">
                  {credentials.map((c) => (
                    <CredentialRow
                      key={c.id}
                      person={person}
                      credential={c}
                      onChanged={invalidate}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Person status ─────────────────────────────────── */}
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-semibold">{t("reg.person_status_title")}</p>
                <p className="text-xs text-muted-foreground">{t("reg.person_status_desc")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-status">{t("reg.col_status")}</Label>
                <Select value={nextStatus} onValueChange={(v) => setNextStatus(v as PersonStatus)}>
                  <SelectTrigger id="pd-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSON_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`reg.status_${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-reason">{t("reg.reason_label")}</Label>
                <Textarea
                  id="pd-reason"
                  rows={2}
                  value={reason}
                  placeholder={t("reg.reason_ph")}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("reg.reason_hint")}</p>
              </div>
              <Button
                size="sm"
                disabled={changeStatus.isPending || nextStatus === person.status}
                onClick={() => {
                  if (reason.trim().length < 3) {
                    toast.error(t("reg.reason_required"));
                    return;
                  }
                  changeStatus.mutate();
                }}
              >
                {changeStatus.isPending ? t("reg.edit_saving") : t("reg.person_status_btn")}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("reg.close")}
          </Button>
        </DialogFooter>
      </DialogContent>

      {editOpen && person && (
        <EditPersonDialog
          person={person}
          onClose={() => {
            setEditOpen(false);
            invalidate();
          }}
        />
      )}
    </Dialog>
  );
}

/** One labelled value in the detail dialog's profile grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

// ── A single credential: preview, download, and management ────────────────

function CredentialRow({
  person,
  credential,
  onChanged,
}: {
  person: PersonView;
  credential: CredentialView;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState(credential.validFrom.slice(0, 10));
  const [validTo, setValidTo] = useState(credential.validTo.slice(0, 10));
  const [busy, setBusy] = useState(false);

  const card = cardDataFor(person, credential);

  const requireReason = () => {
    if (reason.trim().length < 3) {
      toast.error(t("reg.reason_required"));
      return false;
    }
    return true;
  };

  const runDownload = async () => {
    setBusy(true);
    try {
      await downloadCredential(card);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const runPrint = async () => {
    setBusy(true);
    try {
      await printCredential(card);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const renew = useMutation({
    mutationFn: () =>
      credentialsApi.setValidity(credential.id, {
        validFrom,
        validTo,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(t("reg.cred_updated"));
      setReason("");
      setOpen(false);
      onChanged();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const changeState = useMutation({
    mutationFn: (status: CredentialStatus) =>
      credentialsApi.setStatus(credential.id, status, reason.trim()),
    onSuccess: () => {
      toast.success(t("reg.cred_updated"));
      setReason("");
      setOpen(false);
      onChanged();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  const pending = renew.isPending || changeState.isPending;
  const validText =
    credential.isValid === undefined
      ? t(`reg.status_${credential.status}`)
      : credential.isValid
        ? t("reg.cred_valid")
        : t("reg.cred_invalid");

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <QrPreview value={credential.id} className="h-14 w-14" alt={person.fullName} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{credentialKindLabel(credential.kind, t)}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(credential.validFrom)} → {formatDate(credential.validTo)}
          </p>
          <p
            className={cn(
              "text-xs",
              credential.isValid === false ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {validText}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void runDownload()}>
            <Download className="mr-2 h-4 w-4" />
            {credential.kind === "gate_pass" ? t("reg.print_pass") : t("reg.print_card")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void runPrint()}>
            <Printer className="mr-2 h-4 w-4" />
            {t("reg.print_now")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {t("reg.cred_manage")}
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <p className="text-xs text-muted-foreground">{t("reg.cred_manage_desc")}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`cr-from-${credential.id}`}>{t("reg.field_valid_from")}</Label>
              <Input
                id={`cr-from-${credential.id}`}
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cr-to-${credential.id}`}>{t("reg.field_valid_to")}</Label>
              <Input
                id={`cr-to-${credential.id}`}
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`cr-reason-${credential.id}`}>{t("reg.reason_label")}</Label>
            <Textarea
              id={`cr-reason-${credential.id}`}
              rows={2}
              value={reason}
              placeholder={t("reg.cred_reason_ph")}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("reg.reason_hint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || validTo < validFrom}
              onClick={() => {
                if (!requireReason()) return;
                renew.mutate();
              }}
            >
              {t("reg.cred_renew")}
            </Button>
            {credential.status === "active" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!requireReason()) return;
                  changeState.mutate("suspended");
                }}
              >
                {t("reg.cred_suspend")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!requireReason()) return;
                  changeState.mutate("active");
                }}
              >
                {t("reg.cred_reactivate")}
              </Button>
            )}
            {credential.status !== "terminated" && (
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  if (!requireReason()) return;
                  changeState.mutate("terminated");
                }}
              >
                {t("reg.cred_terminate")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Issue an additional credential for a person ───────────────────────────

function IssueCredentialButton({ person, onIssued }: { person: PersonView; onIssued: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CredentialKind>(credentialKindFor(person.category));
  const [validity, setValidity] = useState(() => defaultValidity(person.category));

  const blocked = person.status !== "active";

  const issue = useMutation({
    mutationFn: () =>
      credentialsApi.issue({
        personId: person.id,
        kind,
        validFrom: validity.validFrom,
        validTo: validity.validTo,
      }),
    onSuccess: () => {
      toast.success(t("reg.cred_issued"));
      setOpen(false);
      onIssued();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("common.error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={blocked}
          title={blocked ? t("reg.issue_blocked_status") : undefined}
        >
          <KeyRound className="mr-2 h-4 w-4" />
          {t("reg.issue_credential")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reg.issue_title")}</DialogTitle>
          <DialogDescription>{t("reg.issue_desc")}</DialogDescription>
        </DialogHeader>

        {blocked ? (
          <p className="text-sm text-muted-foreground">{t("reg.issue_blocked_status")}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ic-kind">{t("reg.field_kind")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as CredentialKind)}>
                <SelectTrigger id="ic-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREDENTIAL_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {credentialKindLabel(k, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ic-from">{t("reg.field_valid_from")}</Label>
                <Input
                  id="ic-from"
                  type="date"
                  value={validity.validFrom}
                  onChange={(e) => setValidity((v) => ({ ...v, validFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ic-to">{t("reg.field_valid_to")}</Label>
                <Input
                  id="ic-to"
                  type="date"
                  value={validity.validTo}
                  onChange={(e) => setValidity((v) => ({ ...v, validTo: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => issue.mutate()}
                disabled={issue.isPending || validity.validTo < validity.validFrom}
              >
                {issue.isPending ? t("reg.issuing") : t("reg.issue_btn")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
