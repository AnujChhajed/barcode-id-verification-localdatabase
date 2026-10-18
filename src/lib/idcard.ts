import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

/**
 * Printable credential rendering for the ABB Plant 3 gate system.
 *
 * PROFESSIONAL PORTRAIT ID CARD DESIGN — REQUIRED LAYOUT:
 * Standard CR80 card rotated to portrait orientation (approximately 54 × 85.6 mm).
 *
 * Exact vertical order:
 * 1. [ABB LOGO]
 * 2. [WORKER / INTERN / VISITOR — prominent centered title ONLY, no "CATEGORY:" label]
 * 3. [PERSON PHOTO] (centered below category title)
 * 4. [FULL NAME] (clearly readable)
 * 5. [ID NO. W101 / I101 / V101]
 * 6. [1D BARCODE] (compact, reliably scannable Code 128)
 * 7. [VALID UNTIL: DD MMM YYYY]
 * 8. [ABB PLANT 3 — footer]
 */

export type CredentialKind = "id_card" | "gate_pass";
export type PersonCategory = "worker" | "intern" | "visitor";

export interface IdCardData {
  /** Opaque credential id / UUID. */
  credentialId: string;
  /** Human-facing short ID, e.g. W101, I101, V101. */
  shortId?: string | null;
  /** Worker reference if separate. */
  workerRef?: string | null;
  kind: CredentialKind;
  fullName: string;
  category: PersonCategory;
  /** Optional base64 or URL for person's photo. */
  photoUrl?: string | null;
  /** The day the credential was issued, `YYYY-MM-DD` or ISO. */
  issuedAt?: string | null;
  /** The last day the credential is valid, inclusive. */
  validTo?: string | null;
}

const BRAND = "ABB";
const PLANT_FOOTER = "ABB PLANT 3";

const CATEGORY_LABEL: Record<PersonCategory, string> = {
  worker: "WORKER",
  intern: "INTERN",
  visitor: "VISITOR",
};

// ABB red (#ed1c24)
const ABB_RED: [number, number, number] = [237, 28, 36];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [110, 110, 118];

// ISO/IEC 7810 ID-1 / CR80 card in portrait (54 × 85.6 mm)
export const CARD_W = 54;
export const CARD_H = 85.6;

/** "YYYY-MM-DD" (or ISO) → "18 OCT 2027" uppercase format. */
function formatDateUpper(value?: string | null): string {
  if (!value) return "—";
  const d = value.length <= 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).toUpperCase();
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/** Truncates string to fit cleanly on card. */
function fit(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Generates a 1D Code 128 barcode as a PNG data URL. */
export function barcodeDataUrl(value: string): string {
  if (typeof document === "undefined") return "";
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: "CODE128",
      width: 2,
      height: 44,
      displayValue: false,
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Barcode generation failed for", value, err);
    return "";
  }
}

/**
 * Draws the official ABB mark neatly centered or aligned at top.
 */
function drawAbbLogo(doc: jsPDF, centerX: number, topY: number) {
  doc.setTextColor(...ABB_RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(BRAND, centerX, topY + 6.5, { align: "center" });

  // Subtle clean top accent bar in ABB red
  doc.setFillColor(...ABB_RED);
  doc.rect(centerX - 12, topY + 8, 24, 0.8, "F");
}

/** Draws placeholder photo silhouette when photoUrl is absent. */
function drawPhotoPlaceholder(doc: jsPDF, px: number, py: number, pw: number, ph: number) {
  doc.setFillColor(242, 243, 245);
  doc.setDrawColor(218, 220, 224);
  doc.roundedRect(px, py, pw, ph, 1.5, 1.5, "FD");

  // Head and shoulders silhouette
  const cx = px + pw / 2;
  doc.setFillColor(185, 190, 198);
  doc.circle(cx, py + ph * 0.38, pw * 0.18, "F");
  doc.roundedRect(cx - pw * 0.32, py + ph * 0.62, pw * 0.64, ph * 0.32, 2, 2, "F");
}

// ── Draw Single Portrait ID Card (CR80) ─────────────────────────────────────

export function drawIdCard(
  doc: jsPDF,
  card: IdCardData,
  barcodeImg: string,
  ox: number,
  oy: number,
) {
  // Card canvas background (white with crisp rounded corners)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(220, 222, 226);
  doc.roundedRect(ox, oy, CARD_W, CARD_H, 2, 2, "FD");

  // 1. [ABB LOGO] at the top, centered
  const cx = ox + CARD_W / 2;
  drawAbbLogo(doc, cx, oy + 2.5);

  // 2. [WORKER / INTERN / VISITOR — centered title ONLY, no "CATEGORY:" label]
  doc.setTextColor(...ABB_RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(CATEGORY_LABEL[card.category] ?? "PERSON", cx, oy + 15, { align: "center" });

  // 3. [PERSON PHOTO] centered below category title
  const photoW = 22;
  const photoH = 26;
  const photoX = ox + (CARD_W - photoW) / 2;
  const photoY = oy + 18;

  if (card.photoUrl && card.photoUrl.startsWith("data:image/")) {
    try {
      doc.addImage(card.photoUrl, "JPEG", photoX, photoY, photoW, photoH);
      doc.setDrawColor(218, 220, 224);
      doc.roundedRect(photoX, photoY, photoW, photoH, 1, 1, "D");
    } catch {
      drawPhotoPlaceholder(doc, photoX, photoY, photoW, photoH);
    }
  } else {
    drawPhotoPlaceholder(doc, photoX, photoY, photoW, photoH);
  }

  // 4. [FULL NAME] clearly readable
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(fit(card.fullName, 19), cx, oy + 48.5, { align: "center" });

  // 5. [ID NO. W101 / I101 / V101]
  const displayId = card.shortId || card.workerRef || card.credentialId.slice(0, 8).toUpperCase();
  doc.setTextColor(80, 82, 88);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(`ID NO. ${displayId}`, cx, oy + 53, { align: "center" });

  // 6. [1D BARCODE] compact, reliably scannable Code 128
  if (barcodeImg) {
    const barW = 38;
    const barH = 11;
    const barX = ox + (CARD_W - barW) / 2;
    const barY = oy + 55;
    try {
      doc.addImage(barcodeImg, "PNG", barX, barY, barW, barH);
    } catch {
      // Fallback if image failed to insert
    }
  }

  // Divider line above validity
  doc.setDrawColor(225, 227, 231);
  doc.line(ox + 5, oy + 69.5, ox + CARD_W - 5, oy + 69.5);

  // 7. [VALID UNTIL: DD MMM YYYY] clearly displayed near the bottom
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(`VALID UNTIL: ${formatDateUpper(card.validTo)}`, cx, oy + 74.5, { align: "center" });

  // 8. [ABB PLANT 3 — optional footer]
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.text(PLANT_FOOTER, cx, oy + 80.5, { align: "center" });
}

/** Single ID card centred on A4 with a dashed cut guide. */
export async function generateIdCardPDF(card: IdCardData): Promise<jsPDF> {
  const codeVal = card.shortId || card.workerRef || card.credentialId;
  const barcode = barcodeDataUrl(codeVal);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ox = (210 - CARD_W) / 2;
  const oy = (297 - CARD_H) / 2;

  // Dashed cut guide
  doc.setDrawColor(180, 182, 186);
  doc.setLineDashPattern([2, 2], 0);
  doc.rect(ox - 3, oy - 3, CARD_W + 6, CARD_H + 6);
  doc.setLineDashPattern([], 0);

  drawIdCard(doc, card, barcode, ox, oy);
  return doc;
}

export async function downloadIdCard(card: IdCardData) {
  const doc = await generateIdCardPDF(card);
  const safeName = card.fullName.replace(/\s+/g, "-").toLowerCase() || card.shortId || card.credentialId;
  doc.save(`id-card-${safeName}.pdf`);
}

/** Open the ID card PDF in a new tab with the print dialog ready. */
export async function printIdCard(card: IdCardData) {
  const doc = await generateIdCardPDF(card);
  doc.autoPrint();
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

/**
 * Bulk: 9 cards per A4 page (3 columns × 3 rows) with dashed cut guides.
 */
export async function downloadBulkIdCards(cards: IdCardData[]) {
  if (cards.length === 0) return;
  const barcodes = cards.map((card) =>
    barcodeDataUrl(card.shortId || card.workerRef || card.credentialId),
  );

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

    doc.setDrawColor(180, 182, 186);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2);
    doc.setLineDashPattern([], 0);

    drawIdCard(doc, card, barcodes[i], x, y);
  });

  doc.save(`id-cards-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Gate pass (A6 portrait) ──────────────────────────────────────────────────

export interface GatePassData {
  credentialId: string;
  shortId?: string | null;
  fullName: string;
  category: PersonCategory;
  issuedAt?: string | null;
  validTo?: string | null;
}

function isExpired(validTo?: string | null): boolean {
  if (!validTo) return false;
  const end = validTo.length <= 10 ? new Date(`${validTo}T23:59:59`) : new Date(validTo);
  return !Number.isNaN(end.getTime()) && end < new Date();
}

export async function generateGatePassPDF(pass: GatePassData): Promise<jsPDF> {
  const codeVal = pass.shortId || pass.credentialId;
  const barcode = barcodeDataUrl(codeVal);
  const doc = new jsPDF({ unit: "mm", format: [105, 148] }); // A6 portrait
  const W = 105;
  const expired = isExpired(pass.validTo);

  // Header — logo and title only
  doc.setFillColor(...ABB_RED);
  doc.rect(0, 0, W, 26, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(BRAND, 10, 15);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(PLANT_FOOTER, 10, 21);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("GATE PASS", W - 10, 17, { align: "right" });

  // Prominent category
  doc.setTextColor(...ABB_RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(CATEGORY_LABEL[pass.category] ?? "VISITOR", W / 2, 38, { align: "center" });

  // Holder Name
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(fit(pass.fullName, 22), W / 2, 48, { align: "center" });

  // ID Number
  const passId = pass.shortId || pass.credentialId.slice(0, 8).toUpperCase();
  doc.setFontSize(11);
  doc.setTextColor(80, 82, 88);
  doc.text(`PASS ID: ${passId}`, W / 2, 56, { align: "center" });

  // 1D Barcode
  if (barcode) {
    const bw = 70;
    const bh = 22;
    doc.addImage(barcode, "PNG", (W - bw) / 2, 62, bw, bh);
  }

  // Validity
  doc.setDrawColor(214, 214, 218);
  doc.line(10, 110, W - 10, 110);

  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.text("Issued", 14, 118);
  doc.text("Valid till", 58, 118);

  doc.setTextColor(...(expired ? ([200, 50, 50] as [number, number, number]) : INK));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(formatDateUpper(pass.issuedAt), 14, 125);
  doc.text(formatDateUpper(pass.validTo), 58, 125);
  if (expired) {
    doc.setFontSize(9);
    doc.text("(EXPIRED)", W - 14, 125, { align: "right" });
  }

  // Footer
  doc.setFillColor(245, 245, 246);
  doc.rect(0, 140, W, 8, "F");
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Present this pass at the Plant 3 Main Gate", W / 2, 145, { align: "center" });

  return doc;
}

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
  const safeName = pass.fullName.replace(/\s+/g, "-").toLowerCase() || pass.shortId || pass.credentialId;
  doc.save(`gate-pass-${safeName}.pdf`);
}

/** QR helper kept for on-screen status pages / mobile display. */
export async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    width: 420,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#18181b", light: "#ffffff" },
  });
}
