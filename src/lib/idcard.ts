import jsPDF from "jspdf";
import QRCode from "qrcode";

/**
 * Printable credential rendering for the ABB Plant 3 gate system.
 *
 * The single scannable element is a **QR code** carrying the opaque credential
 * id — the same value `/api/gate/verify` expects. No personal data is ever
 * encoded in the QR; the printed name is only a label a human can read.
 *
 * The card carries nothing else: ABB logo, holder name, category, the issue
 * date, the date it stops being valid, and the QR. Every additional field is
 * one more thing that can be wrong on a printed card, and none of it changes
 * what the gate decides.
 *
 * QR generation is asynchronous (`qrcode` renders to a data URL via a promise),
 * so the builders below are async. Callers must await them.
 */

export type CredentialKind = "id_card" | "gate_pass";
export type PersonCategory = "worker" | "intern" | "visitor";

export interface IdCardData {
  /** Opaque credential id — the QR payload. */
  credentialId: string;
  kind: CredentialKind;
  fullName: string;
  category: PersonCategory;
  /** The day the credential was issued, `YYYY-MM-DD` or ISO. */
  issuedAt?: string | null;
  /** The last day the credential is valid, inclusive. */
  validTo?: string | null;
}

const BRAND = "ABB";
const PLANT = "PLANT 3";

const CATEGORY_LABEL: Record<PersonCategory, string> = {
  worker: "WORKER",
  intern: "INTERN",
  visitor: "VISITOR",
};

// ABB red (#ed1c24) — matches `--sidebar-primary` in src/styles.css.
const ABB_RED: [number, number, number] = [237, 28, 36];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [110, 110, 118];

// ISO/IEC 7810 ID-1, held portrait so the QR has the room it needs.
const CARD_W = 54;
const CARD_H = 85.6;

/** `YYYY-MM-DD` (or ISO) → a short, locale-aware date. Invalid input is echoed. */
function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = value.length <= 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Hard-truncate so a long name cannot run into the QR code. */
function fit(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * The ABB mark: a white tile with the three letters in ABB red, sized to sit on
 * a red header. Drawn rather than embedded so a card can never print with a
 * missing image.
 */
function drawLogo(doc: jsPDF, x: number, y: number, size: number) {
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, size, size, size * 0.16, size * 0.16, "F");
  doc.setTextColor(...ABB_RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size * 0.86);
  doc.text(BRAND, x + size / 2, y + size * 0.72, { align: "center" });
}

// ── ID card (ISO ID-1, portrait, printed on A4) ──────────────────────────────

function drawIdCard(doc: jsPDF, card: IdCardData, qr: string, ox: number, oy: number) {
  // Red header with the logo and the card type
  doc.setFillColor(...ABB_RED);
  doc.rect(ox, oy, CARD_W, 16, "F");
  drawLogo(doc, ox + 4, oy + 3.5, 9.5);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.text(PLANT, ox + 16.5, oy + 7.6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(card.kind === "id_card" ? "IDENTITY CARD" : "GATE PASS", ox + 16.5, oy + 12.4);

  // Holder — centred, the one line a guard reads
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(fit(card.fullName, 17), ox + CARD_W / 2, oy + 25, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...ABB_RED);
  doc.text(CATEGORY_LABEL[card.category], ox + CARD_W / 2, oy + 30.5, { align: "center" });

  // QR — the only scannable element, given the space it needs
  const qrSize = 34;
  const qrX = ox + (CARD_W - qrSize) / 2;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(228, 228, 231);
  doc.roundedRect(qrX - 2, oy + 35, qrSize + 4, qrSize + 4, 1.5, 1.5, "FD");
  doc.addImage(qr, "PNG", qrX, oy + 37, qrSize, qrSize);

  // Validity — what the guard actually has to check
  doc.setDrawColor(214, 214, 218);
  doc.line(ox + 5, oy + 76, ox + CARD_W - 5, oy + 76);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(...MUTED);
  doc.text("Issued", ox + 5, oy + 80);
  doc.text("Valid till", ox + CARD_W / 2 + 1, oy + 80);

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(formatDate(card.issuedAt), ox + 5, oy + 84);
  doc.text(formatDate(card.validTo), ox + CARD_W / 2 + 1, oy + 84);
}

/** Single ID card centred on A4 with a dashed cut guide. */
export async function generateIdCardPDF(card: IdCardData): Promise<jsPDF> {
  const qr = await qrDataUrl(card.credentialId);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ox = (210 - CARD_W) / 2;
  const oy = (297 - CARD_H) / 2;

  doc.setDrawColor(160);
  doc.setLineDashPattern([2, 2], 0);
  doc.rect(ox - 3, oy - 3, CARD_W + 6, CARD_H + 6);
  doc.setLineDashPattern([], 0);

  drawIdCard(doc, card, qr, ox, oy);
  return doc;
}

export async function downloadIdCard(card: IdCardData) {
  const doc = await generateIdCardPDF(card);
  doc.save(`id-card-${card.fullName.replace(/\s+/g, "-").toLowerCase() || card.credentialId}.pdf`);
}

/**
 * Bulk: 9 cards per A4 page (3 columns × 3 rows) with dashed cut guides.
 *
 * Every QR is rendered up front, because the drawing pass that follows is
 * synchronous and cannot await a single one of them.
 */
export async function downloadBulkIdCards(cards: IdCardData[]) {
  if (cards.length === 0) return;
  const qrs = await Promise.all(cards.map((card) => qrDataUrl(card.credentialId)));

  const COLS = 3;
  const ROWS = 3;
  const PER_PAGE = COLS * ROWS;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const gapX = 5;
  const gapY = 6;
  const marginX = (210 - CARD_W * COLS - gapX * (COLS - 1)) / 2;
  const marginY = (297 - CARD_H * ROWS - gapY * (ROWS - 1)) / 2;

  cards.forEach((card, i) => {
    const idx = i % PER_PAGE;
    if (i > 0 && idx === 0) doc.addPage();
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = marginX + col * (CARD_W + gapX);
    const y = marginY + row * (CARD_H + gapY);

    doc.setDrawColor(160);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2);
    doc.setLineDashPattern([], 0);

    drawIdCard(doc, card, qrs[i], x, y);
  });

  doc.save(`id-cards-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Gate pass (A6 portrait) ──────────────────────────────────────────────────

export interface GatePassData {
  credentialId: string;
  fullName: string;
  category: PersonCategory;
  issuedAt?: string | null;
  validTo?: string | null;
}

function isExpired(validTo?: string | null): boolean {
  if (!validTo) return false;
  // `valid_to` is inclusive — a pass is usable through the end of that day.
  const end = validTo.length <= 10 ? new Date(`${validTo}T23:59:59`) : new Date(validTo);
  return !Number.isNaN(end.getTime()) && end < new Date();
}

export async function generateGatePassPDF(pass: GatePassData): Promise<jsPDF> {
  const qr = await qrDataUrl(pass.credentialId);
  const doc = new jsPDF({ unit: "mm", format: [105, 148] }); // A6 portrait
  const W = 105;
  const expired = isExpired(pass.validTo);

  // Header — logo and title only
  doc.setFillColor(...ABB_RED);
  doc.rect(0, 0, W, 30, "F");
  drawLogo(doc, 8, 7, 16);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(PLANT, 30, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("GATE PASS", 30, 24);

  // Holder
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(fit(pass.fullName, 22), W / 2, 44, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...ABB_RED);
  doc.text(CATEGORY_LABEL[pass.category], W / 2, 51, { align: "center" });

  // QR — the only scannable element
  const qrSize = 54;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(228, 228, 231);
  doc.roundedRect((W - qrSize) / 2 - 3, 56, qrSize + 6, qrSize + 6, 2, 2, "FD");
  doc.addImage(qr, "PNG", (W - qrSize) / 2, 59, qrSize, qrSize);

  // Validity
  doc.setDrawColor(214, 214, 218);
  doc.line(10, 122, W - 10, 122);

  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.text("Issued", 14, 130);
  doc.text("Valid till", 60, 130);

  doc.setTextColor(...(expired ? ([200, 50, 50] as [number, number, number]) : INK));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(formatDate(pass.issuedAt), 14, 136);
  doc.text(formatDate(pass.validTo), 60, 136);
  if (expired) {
    doc.setFontSize(9);
    doc.text("(EXPIRED)", W - 14, 136, { align: "right" });
  }

  // Footer
  doc.setFillColor(245, 245, 246);
  doc.rect(0, 141, W, 7, "F");
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("Present this pass at the Plant 3 Main Gate", W / 2, 145.6, { align: "center" });

  return doc;
}

/** Open the gate pass PDF in a new tab with the print dialog ready. */
export async function printGatePass(pass: GatePassData) {
  const doc = await generateGatePassPDF(pass);
  doc.autoPrint();
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

export async function downloadGatePass(pass: GatePassData) {
  const doc = await generateGatePassPDF(pass);
  doc.save(
    `gate-pass-${pass.fullName.replace(/\s+/g, "-").toLowerCase() || pass.credentialId}.pdf`,
  );
}

// ── QR helper (on-screen previews and the status page) ───────────────────────

export async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    width: 420,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#18181b", light: "#ffffff" },
  });
}
