"use client";

import { getNextStatusConfig, getCustomerCustomRequest, getBookingSchedule } from './_shared';
import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    CalendarDays,
    Hourglass,
    AlertCircle,
    CheckCircle2,
    Download,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import { downloadBookingReceipt } from "./BookingFinancialPanel";
import RentalReturnSettlementDialog from "./RentalReturnSettlementDialog";
import {
    Booking,
    FilterType,
    TABS,
    BookingWorkspace,
    PriceModal,
    dateKey,
    formatDate,
    getAmountPaid,
    getBalance,
    getBranchGroupName,
    getManagerBookingTypeLabel,
    getManagerBookingCompositionLabel,
    getBookingTypeDisplay,
    getManagerBookingStatusLabel,
    getManagerPaymentLabel,
    getRequiredDownPayment,
    getSavedBookingAccess,
    getTotalPrice,
    normalizeBooking,
    peso,
} from "./_shared";

// Download PDF and Excel directly. Kept in this component to avoid adding another project file.
/**
 * Manager-only, browser-based file downloads. No print dialog, pop-up window,
 * added dependencies, booking API calls, or changes to financial calculations.
 */
export type ManagerBookingExportContext = {
    storeName: string;
    storeId: string;
    branchName: string;
    branchId: string;
    exportedAt: Date;
    selected: boolean;
};

function safeFilename(value: unknown) {
    return String(value ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 90) || "booking";
}

function filename(context: ManagerBookingExportContext, rows: Booking[]) {
    const prefix = context.selected && rows.length === 1
        ? `StockNBook_Booking_${safeFilename(rows[0].bookingReference || rows[0].id)}`
        : "StockNBook_Manager_Booking_List";
    return `${prefix}_${context.exportedAt.toISOString().slice(0, 10)}`;
}

function downloadBlob(blob: Blob, downloadName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel downloads in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function money(value: number) {
    return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Excel XLSX (not CSV): a single-sheet Open XML workbook, packaged with an
// uncompressed ZIP writer so no external XLSX library is required.
const encoder = new TextEncoder();
function xml(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
function colName(index: number) {
    let n = index + 1, name = "";
    while (n > 0) { n--; name = String.fromCharCode(65 + n % 26) + name; n = Math.floor(n / 26); }
    return name;
}
function xlsxCell(value: string | number, row: number, column: number) {
    const address = `${colName(column)}${row}`;
    if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${address}"><v>${value}</v></c>`;
    }
    // Inline text is never interpreted as an Excel formula, including user inputs.
    return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function xlsxRows(rows: Array<Array<string | number>>) {
    return rows.map((cells, index) => {
        const rowNumber = index + 1;
        return `<row r="${rowNumber}">${cells.map((cell, j) => xlsxCell(cell, rowNumber, j)).join("")}</row>`;
    }).join("");
}

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();
function crc32(bytes: Uint8Array) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipStored(files: Array<[string, string]>): Blob {
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const [path, content] of files) {
        const name = encoder.encode(path);
        const data = encoder.encode(content);
        const checksum = crc32(data);
        const head = new Uint8Array(30 + name.length);
        const h = new DataView(head.buffer);
        h.setUint32(0, 0x04034B50, true);
        h.setUint16(4, 20, true);
        h.setUint16(8, 0, true); // stored (no compression)
        h.setUint32(14, checksum, true);
        h.setUint32(18, data.length, true);
        h.setUint32(22, data.length, true);
        h.setUint16(26, name.length, true);
        head.set(name, 30);
        local.push(head, data);
        const record = new Uint8Array(46 + name.length);
        const r = new DataView(record.buffer);
        r.setUint32(0, 0x02014B50, true);
        r.setUint16(4, 20, true);
        r.setUint16(6, 20, true);
        r.setUint32(16, checksum, true);
        r.setUint32(20, data.length, true);
        r.setUint32(24, data.length, true);
        r.setUint16(28, name.length, true);
        r.setUint32(42, offset, true);
        record.set(name, 46);
        central.push(record);
        offset += head.length + data.length;
    }
    const centralLength = central.reduce((sum, bytes) => sum + bytes.length, 0);
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054B50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, centralLength, true);
    v.setUint32(16, offset, true);
    return new Blob([...local, ...central, end].map(bytes => new Uint8Array(bytes).buffer), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadManagerBookingsExcel(bookings: Booking[], context: ManagerBookingExportContext) {
    const header = [
        "Store", "Store ID", "Branch", "Branch ID", "Booking Reference", "Customer Name",
        "Phone", "Email", "Booking Type", "Event Date", "Pickup / Delivery", "Pickup / Delivery Date", "Pickup / Delivery Time",
        "Return Date", "Return Time", "Event Type",
        "Theme", "Venue / Delivery Address", "Booking Status", "Payment Status", "Agreed Price (PHP)",
        "Required Down Payment (PHP)", "Amount Paid (PHP)", "Remaining Balance (PHP)",
        "Custom Request", "Notes",
    ];
    const data: Array<Array<string | number>> = bookings.map(b => [
        context.storeName, context.storeId, getBranchGroupName(b) === "Unassigned Branch" ? context.branchName : getBranchGroupName(b),
        String(b.branchId ?? b.branch_id ?? context.branchId), b.bookingReference || `#${b.id}`,
        b.name || "", b.phone || "", b.email || "", getManagerBookingCompositionLabel(b), dateKey(b.date),
        getBookingSchedule(b).label, getBookingSchedule(b).handoverDate, getBookingSchedule(b).handoverTime,
        getBookingSchedule(b).returnDate, getBookingSchedule(b).returnTime,
        b.eventType || b.event_type || "", b.theme || "",
        b.venue || "", getManagerBookingStatusLabel(b.status), getManagerPaymentLabel(b),
        getTotalPrice(b), getRequiredDownPayment(b), getAmountPaid(b), getBalance(b),
        b.customOrder || b.custom_order || "", b.notes || "",
    ]);
    const rows: Array<Array<string | number>> = [
        ["StockNBook — Manager Booking Export"],
        [`Store: ${context.storeName} (ID: ${context.storeId})`],
        [`Branch: ${context.branchName} (ID: ${context.branchId})`],
        [`Generated: ${context.exportedAt.toLocaleString("en-PH")}`],
        [`Records exported: ${bookings.length}`], header, ...data,
    ];
    const last = Math.max(rows.length, 6);
    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<dimension ref="A1:V${last}"/><sheetViews><sheetView workbookViewId="0">` +
        `<pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/>` +
        `</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
        `<cols>${header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 5 || i === 20 || i === 21 ? 28 : 19}" customWidth="1"/>`).join("")}</cols>` +
        `<sheetData>${xlsxRows(rows)}</sheetData>` +
        `<autoFilter ref="A6:V${last}"/></worksheet>`;
    const files: Array<[string, string]> = [
        ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
        ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bookings" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
        ["xl/worksheets/sheet1.xml", worksheet],
    ];
    downloadBlob(zipStored(files), `${filename(context, bookings)}.xlsx`);
}

// Native A4 landscape PDF download, drawn directly into PDF page streams.
// This works in browsers without requiring print(), pop-ups, or an extra library.
const PDF_W = 842;
const PDF_H = 595;
function pdfSafe(value: unknown) {
    return String(value ?? "").normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").replace(/₱/g, "PHP ")
        .replace(/[—–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
        .replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, match => `\\${match}`);
}
function pdfText(value: unknown, x: number, y: number, size = 9, bold = false) {
    return `BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfSafe(value)}) Tj ET\n`;
}
function shortText(value: unknown, max: number) {
    const raw = String(value ?? "");
    return raw.length <= max ? raw : raw.slice(0, Math.max(0, max - 3)) + "...";
}
function pageLine(x1: number, y1: number, x2: number, y2: number) {
    return `0.86 0.83 0.9 RG 0.5 w ${x1} ${y1} m ${x2} ${y2} l S\n`;
}
function renderPdfPages(rows: Booking[], context: ManagerBookingExportContext) {
    const pages: string[][] = [];
    let commands: string[] = [];
    let y = 0;
    const heading = context.selected ? "Selected Booking Details" : "Manager Booking List";
    function startPage() {
        commands = [];
        pages.push(commands);
        commands.push("0.17 0.10 0.29 rg\n");
        commands.push(pdfText(`StockNBook  |  ${heading}`, 38, PDF_H - 43, 17, true));
        commands.push(pdfText(`Store: ${context.storeName}   (ID: ${context.storeId})`, 38, PDF_H - 65, 10));
        commands.push(pdfText(`Branch: ${context.branchName}   (ID: ${context.branchId})`, 38, PDF_H - 80, 10));
        commands.push(pdfText(`Generated: ${context.exportedAt.toLocaleString("en-PH")}   |   ${rows.length} record(s)`, 38, PDF_H - 95, 9));
        commands.push(pageLine(38, PDF_H - 106, PDF_W - 38, PDF_H - 106));
        y = PDF_H - 124;
    }
    function ensureSpace(height: number) {
        if (y - height < 47) startPage();
    }
    function field(label: string, value: unknown) {
        const text = String(value ?? "-") || "-";
        const chunks = text.match(/.{1,112}/g) || ["-"];
        ensureSpace(17 * chunks.length + 4);
        commands.push(pdfText(label, 43, y, 9, true));
        chunks.forEach((part, i) => {
            commands.push(pdfText(part, 205, y - i * 15, 9));
        });
        y -= chunks.length * 17 + 4;
    }
    startPage();
    if (context.selected && rows.length === 1) {
        const b = rows[0];
        const fields: Array<[string, unknown]> = [
            ["Booking reference", b.bookingReference || `#${b.id}`],
            ["Customer name", b.name], ["Phone number", b.phone || "-"],
            ["Email", b.email || "-"], ["Facebook / Messenger", b.facebookName || b.facebook_name || "-"],
            ["Booking type", getManagerBookingCompositionLabel(b)],
            ["Booking branch", getBranchGroupName(b) === "Unassigned Branch" ? context.branchName : getBranchGroupName(b)],
            ["Event date", formatDate(b.date)],
            [getBookingSchedule(b).label, getBookingSchedule(b).handoverText || "-"],
            ...(getBookingSchedule(b).returnText ? [["Return", getBookingSchedule(b).returnText] as [string, unknown]] : []),
            ["Event type", b.eventType || b.event_type || "-"],
            ["Theme", b.theme || "-"], [b.handoverMethod === "delivery" ? "Delivery address" : "Venue", b.venue || "-"],
            ["Booking status", getManagerBookingStatusLabel(b.status)],
            ["Payment status", getManagerPaymentLabel(b)],
            ["Agreed price", money(getTotalPrice(b))],
            ["Required down payment", money(getRequiredDownPayment(b))],
            ["Amount paid", money(getAmountPaid(b))],
            ["Remaining balance", money(getBalance(b))],
            ["Additional custom request", b.customOrder || b.custom_order || "-"],
            ["Notes", b.notes || "-"],
        ];
        for (const [label, value] of fields) field(label, value);
    } else {
        const cols = [
            { label: "Booking reference", x: 38, size: 29 },
            { label: "Customer", x: 200, size: 21 },
            { label: "Type", x: 332, size: 10 },
            { label: "Event date", x: 395, size: 12 },
            { label: "Status", x: 487, size: 19 },
            { label: "Agreed (PHP)", x: 604, size: 14 },
            { label: "Paid (PHP)", x: 694, size: 15 },
        ];
        function drawHeader() {
            ensureSpace(22);
            commands.push("0.34 0.23 0.5 rg\n");
            cols.forEach(c => commands.push(pdfText(c.label, c.x, y, 8, true)));
            y -= 7;
            commands.push(pageLine(38, y, PDF_W - 38, y));
            commands.push("0.17 0.10 0.29 rg\n");
            y -= 17;
        }
        drawHeader();
        rows.forEach((b, index) => {
            if (y < 54) { startPage(); drawHeader(); }
            const values = [
                b.bookingReference || `#${b.id}`, b.name, getManagerBookingCompositionLabel(b),
                formatDate(b.date), getManagerBookingStatusLabel(b.status),
                money(getTotalPrice(b)).replace("PHP ", ""), money(getAmountPaid(b)).replace("PHP ", ""),
            ];
            values.forEach((v, i) => commands.push(pdfText(shortText(v, cols[i].size), cols[i].x, y, 8)));
            y -= 19;
            if (index % 2 === 0) commands.push(pageLine(38, y + 7, PDF_W - 38, y + 7));
        });
    }
    pages.forEach((page, index) => {
        page.push("0.39 0.32 0.48 rg\n");
        page.push(pdfText(`Page ${index + 1} of ${pages.length}`, PDF_W - 110, 26, 8));
    });
    return pages.map(p => p.join(""));
}
function pdfBlob(streams: string[]) {
    const objects: string[] = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const pageIds = streams.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${pageIds}] /Count ${streams.length} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    streams.forEach((stream, i) => {
        const streamId = 6 + i * 2;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
        objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
    });
    let raw = "%PDF-1.4\n";
    const positions = [0];
    objects.forEach((value, index) => {
        positions.push(encoder.encode(raw).length);
        raw += `${index + 1} 0 obj\n${value}\nendobj\n`;
    });
    const crossReference = encoder.encode(raw).length;
    raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const position of positions.slice(1)) raw += `${String(position).padStart(10, "0")} 00000 n \n`;
    raw += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`;
    return new Blob([encoder.encode(raw)], { type: "application/pdf" });
}
export function downloadManagerBookingsPdf(bookings: Booking[], context: ManagerBookingExportContext) {
    downloadBlob(pdfBlob(renderPdfPages(bookings, context)), `${filename(context, bookings)}.pdf`);
}

type BookingInventoryItem = {
    id: number;
    booking_id?: number;
    source_type?: string;
    product_id?: number;
    variant_id?: number | null;
    product_name: string;
    variant_name?: string | null;
    booked_quantity: number | string;
    reserved_quantity: number | string;
    used_quantity?: number | string;
    restored_quantity?: number | string;
    unit_price?: number | string;
    // Price used for cancellation refunds: discounted if the package / quote has a discount (from the Bookings Lambda).
    refund_unit_price?: number | string;
    refund_price_ratio?: number | string;
    inventory_status?: string;
};

type CancelUsedItem = {
    booking_item_id: number;
    used_quantity: number;
};

type BookingClosureImpact = {
    bookingId:number; status:string; eligibleForReject:boolean; eligibleForCancel:boolean;
    paymentStage:string; agreedPrice:number; requiredDownPayment:number;
    paymentReceived:number; depositCollected:number; depositHeld:number;
    reservedConsumableUnits:number; usedConsumableUnits:number;
    rentalItemLines:number; rentalAllocations:Record<string,number>;
    rentalCancellationBlocked?:boolean;
    requiresFinancialReview:boolean; requiresInventoryReview:boolean;
    refundDecision:string;
    // Cancellation refund (from get_booking_closure_impact)
    bookingRefunded?:number; refundableBookingPayment?:number; suggestedRefund?:number; depositRefundOnCancel?:number;
    usedItemsValue?:number;
};

// What the Manager hands back when cancelling. Saved together with the cancellation.
type CancelRefund = { amount: number; method: string; verified: boolean };

// UI-only feedback for booking actions. This does not change API requests
// or any inventory, approval, or payment business rules.
type BookingToast = {
    id: number;
    kind: "success" | "error";
    title: string;
    description: string;
};

function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}


// Export the selected detail tab, not a generic booking-list report.
// Billing PDF deliberately reuses the exact portrait receipt used by the Billing tab.
type SelectedTab = "Overview" | "Billing" | "Items" | "Notes";
type SelectedExportLine = { label: string; value: string; section?: boolean };
type SelectedFinancialStatement = {
    booking?: { agreedPrice?: number | null; bookingPayments?: number; balance?: number; downPayment?: number };
    depositRequired?: number;
    depositCollected?: number;
    depositApplied?: number;
    depositRefunded?: number;
    depositHeld?: number;
    claimBalance?: number;
    packageBase?: number; deliveryFee?: number; setupFee?: number;
    salesItems?: Array<{name: string;variantName?: string;quantity: number;unitPrice: number;amount: number}>;
    rentalItems?: Array<{name: string;quantity: number;days: number;dailyRate: number;amount: number}>;
    claims?: Array<{
        equipmentName?: string; sourceType?: string; quantity?: number; reason?: string;
        status?: string; amount?: number; amountPaid?: number; depositApplied?: number;
    }>;
};
type SelectedBookingItems = {
    items: Array<{
        product_name: string; variant_name?: string | null; source_type?: string;
        booked_quantity: number | string; used_quantity?: number | string;
        available_for_booking?: number | null; inventory_status?: string;
    }>;
    rentalItems: Array<{
        equipment_name: string; quantity: number | string;
        start_date?: string; end_date?: string; allocation_status?: string;
        available_for_event?: number | null;
    }>;
};

async function getSelectedExportData(action: string, booking: Booking): Promise<Record<string, unknown>> {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Please log in before downloading booking details.");
    const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, booking_id: booking.id,
            ...(booking.branchId || booking.branch_id ? { branch_id: Number(booking.branchId || booking.branch_id) } : {}) }),
    });
    const data = await response.json();
    if (!response.ok || data.error || data.success === false) {
        throw new Error(data.error || data.message || `Unable to load ${action} for the export.`);
    }
    return data as Record<string, unknown>;
}

function selectedBookingExportLines(
    booking: Booking,
    tab: SelectedTab,
    context: ManagerBookingExportContext,
    statement: SelectedFinancialStatement | null,
    data: SelectedBookingItems | null,
): SelectedExportLine[] {
    const lines: SelectedExportLine[] = [];
    const section = (label: string) => lines.push({ label, value: "", section: true });
    const add = (label: string, value: unknown) => lines.push({
        label, value: value === null || value === undefined || String(value).trim() === "" ? "Not provided" : String(value),
    });
    const currency = (value: number | undefined | null) =>
        value === null || value === undefined || !Number.isFinite(Number(value)) ? "Not available" : money(Number(value));

    section("Booking identification");
    add("Booking reference", booking.bookingReference || booking.booking_reference || `#${booking.id}`);
    add("Customer", booking.name);
    add("Store", context.storeName);
    add("Branch", getBranchGroupName(booking) === "Unassigned Branch" ? context.branchName : getBranchGroupName(booking));
    add("Booking status", getManagerBookingStatusLabel(booking.status));

    if (tab === "Overview") {
        section("Customer information");
        add("Contact number", booking.phone);
        add("Email address", booking.email);
        add("Facebook / Messenger", booking.facebookName || booking.facebook_name);
        section("Event details");
        add("Booking type", getManagerBookingCompositionLabel(booking));
        add("Package", booking.packageName || booking.package_name || booking.package);
        add("Event start date", formatDate(booking.date));
        add("Event end date", booking.eventEndDate ? formatDate(booking.eventEndDate) : "Not specified");
        add(getBookingSchedule(booking).label, getBookingSchedule(booking).handoverText);
        if (getBookingSchedule(booking).returnText) add("Return", getBookingSchedule(booking).returnText);
        add("Event type", booking.eventType || booking.event_type);
        add("Theme / motif", booking.theme);
        add(booking.handoverMethod === "delivery" ? "Delivery address" : "Venue", booking.venue);
        add("Payment status", getManagerPaymentLabel(booking));
        section("Booking payment summary");
        add("Agreed booking price", currency(statement?.booking?.agreedPrice ?? getTotalPrice(booking)));
        add("Required down payment", currency(statement?.booking?.downPayment ?? getRequiredDownPayment(booking)));
        add("Booking payments received", currency(statement?.booking?.bookingPayments ?? getAmountPaid(booking)));
        add("Remaining booking balance", currency(statement?.booking?.balance ?? getBalance(booking)));
        if (data) {
            section("Consumable items in this booking");
            if (!data.items.length) add("Items", "None");
            data.items.forEach((item, index) => add(`${index + 1}. ${item.product_name}${item.variant_name ? ` - ${item.variant_name}` : ""}`,
                `${item.booked_quantity} required`));
            section("Rental items in this booking");
            if (!data.rentalItems.length) add("Items", "None");
            data.rentalItems.forEach((item, index) => add(`${index + 1}. ${item.equipment_name}`, `${item.quantity} required`));
        }
    } else if (tab === "Billing") {
        if (!statement) throw new Error("Booking financial statement is unavailable for export.");
        section("Itemized booking charges");
        if (Number(statement.packageBase || 0)>0) add("Package price", currency(statement.packageBase));
        for (const item of statement.salesItems || []) {
            add(`${item.name}${item.variantName ? ` - ${item.variantName}` : ""} (qty ${item.quantity}, unit ${currency(item.unitPrice)})`, currency(item.amount));
        }
        for (const item of statement.rentalItems || []) {
            add(`${item.name} (qty ${item.quantity}, ${item.days} day(s), daily rate ${currency(item.dailyRate)})`, currency(item.amount));
        }
        if (Number(statement.deliveryFee || 0)>0) add("Delivery fee", currency(statement.deliveryFee));
        if (Number(statement.setupFee || 0)>0) add("Setup fee", currency(statement.setupFee));
        section("Booking payments");
        add("Final agreed booking price", currency(statement.booking?.agreedPrice));
        add("Required down payment", currency(statement.booking?.downPayment));
        add("Booking payments received", currency(statement.booking?.bookingPayments));
        add("Remaining booking balance", currency(statement.booking?.balance));
        const depositActivity = [statement.depositRequired, statement.depositCollected,
            statement.depositApplied, statement.depositRefunded, statement.depositHeld]
            .some(value => Math.abs(Number(value) || 0) > 0.005);
        if ((statement.rentalItems || []).length > 0 || depositActivity) {
            section("Refundable security deposit");
            add("Deposit required", currency(statement.depositRequired));
            add("Deposit collected", currency(statement.depositCollected));
            add("Deposit applied to charges", currency(statement.depositApplied));
            add("Deposit refunded to customer", currency(statement.depositRefunded));
            add("Deposit still held", currency(statement.depositHeld));
        }
        const claims = statement.claims || [];
        if (claims.length || Math.abs(Number(statement.claimBalance) || 0) > 0.005) {
            section("Damage / missing claims");
            claims.forEach((claim, index) => {
                const grouped = /^covered by the same combined booking-wide charge\b/i.test(String(claim.reason || ""));
                add(`Incident ${index + 1}`, `${claim.equipmentName || "Equipment"} - ${claim.sourceType || "Incident"}, quantity ${claim.quantity ?? "?"}, status ${grouped ? "Included in combined charge" : claim.status || "Not set"}`);
                add("Approved amount", currency(claim.amount));
                add("Payment received", currency(claim.amountPaid));
                add("Deposit applied", currency(claim.depositApplied));
            });
            add("Outstanding damage / missing charges", currency(statement.claimBalance));
        }
    } else if (tab === "Items") {
        if (!data) throw new Error("Booking item records are unavailable for export.");
        section("Consumable items");
        if (!data.items.length) add("Consumable items", "No consumable items included");
        let consumableUnits = 0;
        data.items.forEach((item, index) => {
            const required = Math.max(0, Number(item.booked_quantity) || 0);
            const issued = Math.max(0, Number(item.used_quantity) || 0);
            const available = item.available_for_booking == null ? null : Number(item.available_for_booking);
            const remaining = Math.max(0, required - issued);
            const shortage = available == null || !Number.isFinite(available) ? "Not verified" : Math.max(0, remaining - available);
            consumableUnits += required;
            add(`${index + 1}. ${item.product_name}${item.variant_name ? ` - ${item.variant_name}` : ""}`,
                `Required: ${required} | Available: ${available == null ? "Not verified" : available} | Shortage: ${shortage} | Already issued: ${issued}`);
        });
        add("Total consumable units", consumableUnits);
        section("Rental items (availability for event dates)");
        if (!data.rentalItems.length) add("Rental items", "No rental items included");
        let rentalUnits = 0;
        data.rentalItems.forEach((item, index) => {
            const required = Math.max(0, Number(item.quantity) || 0);
            const available = item.available_for_event == null ? null : Number(item.available_for_event);
            const shortage = available == null || !Number.isFinite(available) ? "Not verified" : Math.max(0, required - available);
            rentalUnits += required;
            add(`${index + 1}. ${item.equipment_name}`,
                `Required: ${required} | Available: ${available == null ? "Not verified" : available} | Shortage: ${shortage} | ${item.start_date || "?"} to ${item.end_date || "?"}`);
        });
        add("Total rental units", rentalUnits);
        add("Total units included in booking", consumableUnits + rentalUnits);
    }
    if (tab === "Overview" || tab === "Notes") {
        section("Customer notes and requests");
        add("Additional custom request", getCustomerCustomRequest(booking) || "None provided");
        add("Theme / motif request", booking.theme_motif_request || booking.themeMotifRequest || booking.theme || "None provided");
        add("Additional notes", booking.additional_notes || booking.additionalNotes || booking.notes || "None provided");
    }
    return lines;
}

function selectedBookingTabPdf(lines: SelectedExportLine[], booking: Booking, tab: SelectedTab, context: ManagerBookingExportContext) {
    const W = PDF_W, H = PDF_H, margin = 40;
    const pages: string[][] = [];
    let commands: string[] = [], y = 0;
    const wrap = (value: string, width: number) => {
        const words = value.replace(/\r/g, "").split(/(\s+)/);
        const chunks: string[] = [];
        let current = "";
        for (const word of words) {
            const candidate = current + word;
            if (candidate.length > width && current.trim()) { chunks.push(current.trim()); current = word.trimStart(); }
            else current = candidate;
            while (current.length > width) { chunks.push(current.slice(0, width)); current = current.slice(width); }
        }
        if (current.trim() || !chunks.length) chunks.push(current.trim() || "-");
        return chunks;
    };
    const startPage = () => {
        commands = []; pages.push(commands);
        commands.push("0.17 0.10 0.29 rg\n");
        commands.push(pdfText(`${tab.toUpperCase()} - BOOKING DETAILS`, margin, H - 45, 16, true));
        commands.push(pdfText(`${context.storeName}  |  ${context.branchName}`, margin, H - 67, 10));
        commands.push(pdfText(`Booking: ${booking.bookingReference || `#${booking.id}`}  |  Exported ${context.exportedAt.toLocaleDateString("en-PH")}`, margin, H - 85, 9));
        commands.push(pageLine(margin, H - 97, W - margin, H - 97));
        y = H - 118;
    };
    startPage();
    for (const line of lines) {
        if (line.section) {
            if (y < 78) startPage();
            y -= 6;
            commands.push("0.34 0.21 0.52 rg\n");
            commands.push(pdfText(line.label.toUpperCase(), margin, y, 10, true));
            y -= 9; commands.push(pageLine(margin, y, W - margin, y));
            commands.push("0.17 0.10 0.29 rg\n");
            y -= 19;
        } else {
            const labelLines = wrap(line.label, 34), valueLines = wrap(line.value, 92);
            const length = Math.max(labelLines.length, valueLines.length);
            if (y - length * 14 < 48) startPage();
            for (let i = 0; i < length; i++) {
                if (labelLines[i]) commands.push(pdfText(labelLines[i], margin + 3, y - 14 * i, 8.5, true));
                if (valueLines[i]) commands.push(pdfText(valueLines[i], 259, y - 14 * i, 8.5));
            }
            y -= length * 14 + 9;
        }
    }
    pages.forEach((page, i) => page.push(pdfText(`Page ${i + 1} of ${pages.length}`, W - 108, 25, 8)));
    return pdfBlob(pages.map(p => p.join("")));
}

function selectedBookingTabExcel(lines: SelectedExportLine[], tab: SelectedTab, booking: Booking, context: ManagerBookingExportContext) {
    const rows: Array<Array<string | number>> = [
        [`${tab.toUpperCase()} - BOOKING DETAILS`],
        [`Store: ${context.storeName}`], [`Branch: ${context.branchName}`],
        [`Booking reference: ${booking.bookingReference || `#${booking.id}`}`],
        [`Exported: ${context.exportedAt.toLocaleString("en-PH")}`],
        ["Field", "Details"],
        ...lines.map(line => line.section ? [line.label.toUpperCase(), ""] : [line.label, line.value]),
    ];
    const lastRow = rows.length;
    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
        `<dimension ref="A1:B${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>`+
        `<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="40" customWidth="1"/>`+
        `<col min="2" max="2" width="95" customWidth="1"/></cols>`+
        `<sheetData>${xlsxRows(rows)}</sheetData><autoFilter ref="A6:B${lastRow}"/></worksheet>`;
    const files: Array<[string, string]> = [
        ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
        ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${tab}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
        ["xl/worksheets/sheet1.xml", worksheet],
    ];
    return zipStored(files);
}

// Items exports use actual item rows and quantities, rather than the generic
// booking-report columns. No prices or unrelated financial details are included.
function selectedBookingItemsExcel(items: SelectedBookingItems, booking: Booking, context: ManagerBookingExportContext): Blob {
    const rows: Array<Array<string | number>> = [
        ["BOOKING ITEMS - PRODUCT LIST"],
        [`Store: ${context.storeName}`],
        [`Branch: ${context.branchName}`],
        [`Booking reference: ${booking.bookingReference || `#${booking.id}`}`],
        [`Exported: ${context.exportedAt.toLocaleString("en-PH")}`],
        ["Type", "Item / Product", "Required", "Available", "Shortage", "Already Issued", "Event Start", "Event End"],
    ];
    let totalUnits = 0;
    for (const item of items.items) {
        const required = Math.max(0, Number(item.booked_quantity) || 0);
        const issued = Math.max(0, Number(item.used_quantity) || 0);
        const available = item.available_for_booking == null ? null : Number(item.available_for_booking);
        const validAvailable = available !== null && Number.isFinite(available);
        totalUnits += required;
        rows.push([
            "Consumable",
            `${item.product_name}${item.variant_name ? ` - ${item.variant_name}` : ""}`,
            required,
            validAvailable ? available : "Not verified",
            validAvailable ? Math.max(0, required - issued - available) : "Not verified",
            issued,
            "", "",
        ]);
    }
    for (const item of items.rentalItems) {
        const required = Math.max(0, Number(item.quantity) || 0);
        const available = item.available_for_event == null ? null : Number(item.available_for_event);
        const validAvailable = available !== null && Number.isFinite(available);
        totalUnits += required;
        rows.push([
            "Rental", item.equipment_name, required,
            validAvailable ? available : "Not verified",
            validAvailable ? Math.max(0, required - available) : "Not verified",
            "", item.start_date || "", item.end_date || "",
        ]);
    }
    rows.push(["TOTAL UNITS REQUIRED", "", totalUnits, "", "", "", "", ""]);
    const lastRow = rows.length;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
        `<dimension ref="A1:H${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>`+
        `<sheetFormatPr defaultRowHeight="15"/>`+
        `<cols><col min="1" max="1" width="19" customWidth="1"/><col min="2" max="2" width="65" customWidth="1"/>`+
        `<col min="3" max="6" width="18" customWidth="1"/><col min="7" max="8" width="20" customWidth="1"/></cols>`+
        `<sheetData>${xlsxRows(rows)}</sheetData></worksheet>`;
    return zipStored([
        ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
        ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Items" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
        ["xl/worksheets/sheet1.xml", sheet],
    ]);
}

async function downloadSelectedBookingTab(
    booking: Booking, tab: SelectedTab, type: "pdf" | "excel", context: ManagerBookingExportContext,
): Promise<void> {
    const branchId = Number(booking.branchId || booking.branch_id || context.branchId || 0);
    if (tab === "Billing" && type === "pdf") {
        await downloadBookingReceipt(booking.id, branchId);
        return;
    }
    const [financial, items] = await Promise.all([
        tab === "Overview" || tab === "Billing" ? getSelectedExportData("get_booking_financial_statement", booking) : Promise.resolve(null),
        tab === "Overview" || tab === "Items" ? getSelectedExportData("get_booking_items", booking) : Promise.resolve(null),
    ]);
    const statement = financial?.statement as SelectedFinancialStatement | undefined;
    if (financial && !statement) throw new Error("Booking financial statement is unavailable for this export.");
    const itemData: SelectedBookingItems | null = items ? {
        items: Array.isArray(items.items) ? items.items as SelectedBookingItems["items"] : [],
        rentalItems: Array.isArray(items.rentalItems) ? items.rentalItems as SelectedBookingItems["rentalItems"] : [],
    } : null;
    const lines = selectedBookingExportLines(booking, tab, context, statement || null, itemData);
    const suffix = tab === "Billing" ? "Billing_Receipt" : tab === "Items" ? "Booking_Items"
        : tab === "Notes" ? "Booking_Notes" : "Booking_Overview";
    const fileBase = `${safeFilename(booking.bookingReference || booking.id)}_${suffix}`;
    if (type === "pdf") {
        downloadBlob(selectedBookingTabPdf(lines, booking, tab, context), `${fileBase}.pdf`);
    } else if (tab === "Items" && itemData) {
        downloadBlob(selectedBookingItemsExcel(itemData, booking, context), `${fileBase}.xlsx`);
    } else {
        downloadBlob(selectedBookingTabExcel(lines, tab, booking, context), `${fileBase}.xlsx`);
    }
}

export default function ManagerBookings() {
    const canManage = getSavedBookingAccess("manager") === "full";
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [branchName, setBranchName] = useState("Assigned Branch");
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterType>("All");
    const [search, setSearch] = useState("");
    const [approvalOnly, setApprovalOnly] = useState(false);
    const [toast, setToast] = useState<BookingToast | null>(null);

    function showBookingToast(kind: BookingToast["kind"], title: string, description: string) {
        setToast(previous => ({
            id: (previous?.id ?? 0) + 1,
            kind,
            title,
            description,
        }));
    }

    // Retain the existing call sites, but present handled API errors in a
    // dismissible bottom-right toast instead of a full-width page banner.
    function setBookingActionError(message: string) {
        if (!message) {
            setToast(null);
            return;
        }
        const shortage = /insufficient.*(sales\s+)?inventory|not enough (sales\s+)?stock/i.test(message);
        showBookingToast("error", shortage ? "Insufficient consumable items" : "Booking action unsuccessful",
            shortage
                ? "Not enough stock for this booking's consumables. Check stock, then try again."
                : message);
    }

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => {
            setToast(current => current?.id === toast.id ? null : current);
        }, toast.kind === "error" ? 9000 : 5500);
        return () => window.clearTimeout(timer);
    }, [toast]);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [bookingType, setBookingType] = useState("All");
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [listExportOpen, setListExportOpen] = useState(false);
    const [priceModal, setPriceModal] = useState<Booking | null>(null);
    // Rental Return & Final Settlement dialog (opened from "Settle Deposit / Charges").
    const [settlementBooking, setSettlementBooking] = useState<Booking | null>(null);
    // Intentionally in-memory: a fresh page session requires renewed terms review.
    // This is UI sequencing, not a persisted backend approval entitlement.
    const [reviewedBookingIds, setReviewedBookingIds] = useState<number[]>([]);
    const requiresTermsReview = (booking: Booking) => {
        const type = getManagerBookingTypeLabel(booking);
        return type === "Custom" || type === "Rental" ||
            (type === "Package" && Number(booking.rentalItemCount || 0) > 0);
    };
    const [approvalModal, setApprovalModal] = useState<Booking | null>(null);
    const [approvalSaving, setApprovalSaving] = useState(false);
    const [approvalError, setApprovalError] = useState("");
    const [paymentModal, setPaymentModal] = useState<Booking | null>(null);
    const [paymentSaving, setPaymentSaving] = useState(false);
    const [paymentError, setPaymentError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [cancelModal, setCancelModal] = useState<Booking | null>(null);
    const [cancelItems, setCancelItems] = useState<BookingInventoryItem[]>([]);
    const [cancelUsedQty, setCancelUsedQty] = useState<Record<number, number>>({});
    const [cancelLoading, setCancelLoading] = useState(false);
    const [cancelSubmitting, setCancelSubmitting] = useState(false);
    const [cancelError, setCancelError] = useState("");
    const [closureImpact, setClosureImpact] = useState<BookingClosureImpact | null>(null);

    function getToken() {
        return sessionStorage.getItem("token");
    }

    function getBranchId() {
        return (
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("stocknbook_branch_id") ||
            sessionStorage.getItem("manager_branch_id")
        );
    }

    function getStoreId() {
        return (
            sessionStorage.getItem("store_id") ||
            sessionStorage.getItem("stocknbook_store_id")
        );
    }

    function getSavedBranchName() {
        return (
            sessionStorage.getItem("branch_name") ||
            sessionStorage.getItem("stocknbook_branch_name") ||
            "Assigned Branch"
        );
    }

    function normalizeStatus(status?: string) {
        const value = String(status || "").trim().toLowerCase();

        if (!value || value === "pending" || value === "pending review") {
            return "Pending Review";
        }

        if (
            value === "approved" ||
            value === "awaiting down payment" ||
            value === "waiting down payment" ||
            value === "awaiting payment" ||
            value === "down payment required"
        ) {
            return "Awaiting Down Payment";
        }

        if (value === "confirmed") return "Confirmed";
        if (value === "preparing") return "Preparing";
        if (value === "released") return "Released";
        if (value === "completed") return "Completed";
        if (value === "cancelled" || value === "canceled") return "Cancelled";

        return status || "Pending Review";
    }

    function updateLocalBooking(id: number, updates: Partial<Booking>) {
        setBookings((prev) =>
            prev.map((booking) =>
                booking.id === id
                    ? normalizeBooking(
                        {
                            ...booking,
                            ...updates,
                        },
                        branchName
                    )
                    : booking
            )
        );
    }

    async function loadBookings(): Promise<Booking[]> {
        setLoading(true);

        const token = getToken();
        const storeId = getStoreId();
        const branchId = getBranchId();
        const savedBranchName = getSavedBranchName();

        setBranchName(savedBranchName);

        if (!token || !storeId || !branchId) {
            setBookings([]);
            setLoading(false);
            return [];
        }

        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_booking_page_bookings",
                    store_id: Number(storeId),
                    branch_id: Number(branchId),
                    role: "manager",
                }),
                cache: "no-store",
            });

            // A failed API can return an empty body or non-JSON response.
            // Keep the actual status/error visible rather than logging only {}.
            const rawResponse = await res.text();
            let data: Record<string, unknown> = {};
            try {
                data = rawResponse ? JSON.parse(rawResponse) as Record<string, unknown> : {};
            } catch {
                data = {error: rawResponse.slice(0, 250) || 'Invalid response from Bookings API.'};
            }

            if (!res.ok || data.success === false || !Array.isArray(data.bookings)) {
                const message = typeof data.error === 'string' && data.error.trim()
                    ? data.error
                    : `Couldn't load bookings (error ${res.status}). Try again.`;
                console.error('Bookings load failed:', {status: res.status, message, details: data});
                setBookingActionError(message);
                setBookings([]);
                return [];
            }

            const normalizedBookings = data.bookings.map(
                (booking: Record<string, unknown>) =>
                    normalizeBooking(booking, savedBranchName)
            );

            setBookings(normalizedBookings);
            return normalizedBookings;

        } catch (err) {
            console.error("Bookings load failed:", err);
            setBookings([]);
            return [];
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadBookings();
    }, []);


    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    async function updateStatus(
        id: number,
        newStatus: string,
        price?: number,
        usedItems?: CancelUsedItem[],
        noDpReason?: string,
        cancelReason?: string,
        refund?: CancelRefund
    ): Promise<boolean> {

        const token = getToken();
        const branchId = getBranchId();

        const booking = bookings.find((b) => b.id === id);
        if (!booking) return false;

        const cleanStatus = normalizeStatus(newStatus);
        const oldStatus = normalizeStatus(booking.status);
        if (oldStatus === "Pending Review" &&
            ["Awaiting Down Payment", "Confirmed"].includes(cleanStatus) &&
            requiresTermsReview(booking) && !reviewedBookingIds.includes(id)) {
            setBookingActionError("Set the price and payment terms first.");
            return false;
        }
        if (!["Cancelled","Rejected"].includes(cleanStatus) &&
            !(oldStatus === "Pending Review" && cleanStatus === "Awaiting Down Payment") &&
            !(oldStatus === "Pending Review" && cleanStatus === "Confirmed" &&
                getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10) &&
            !(oldStatus === "Awaiting Down Payment" && cleanStatus === "Confirmed")) {
            setBookingActionError("Staff handles preparation and hand over.");
            return false;
        }
        if (cleanStatus === "Confirmed" && !(oldStatus === "Pending Review" && getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10)) {
            const needed = getRequiredDownPayment(booking) > 0 ? getRequiredDownPayment(booking) : getTotalPrice(booking);
            if (getTotalPrice(booking) <= 0 || getAmountPaid(booking) + 0.005 < needed) {
                setBookingActionError("Record the down payment before confirming.");
                return false;
            }
        }

        // Reject is pre-approval only; cancellation is post-approval and pre-release only.
        if (["Cancelled","Rejected"].includes(cleanStatus)) {
            const currentStatus = normalizeStatus(booking.status);
            if (cleanStatus==="Rejected" && currentStatus!=="Pending Review") {
                setBookingActionError("Only pending, unapproved requests can be rejected.");return false;
            }
            if (cleanStatus==="Cancelled" && !["Awaiting Down Payment","Confirmed","Preparing"].includes(currentStatus)) {
                setBookingActionError("A booking can be cancelled only after approval and before hand over.");return false;
            }
        } else {
            const { nextStatus } = getNextStatusConfig(
                normalizeStatus(booking.status),
                getTotalPrice(booking) > 0 && getAmountPaid(booking) + 0.005 >=
                (getRequiredDownPayment(booking) > 0 ? getRequiredDownPayment(booking) : getTotalPrice(booking))
            );

            if (cleanStatus !== nextStatus && !(oldStatus==="Pending Review" && cleanStatus==="Confirmed" &&
                getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10)) {
                console.warn(`Cannot jump to ${cleanStatus}. Next valid status is ${nextStatus}`);
                return false;
            }
        }

        const isManagerApproval = normalizeStatus(booking.status) === "Pending Review"
            && cleanStatus === "Awaiting Down Payment" && getRequiredDownPayment(booking) > 0;

        try {
            const body: Record<string, unknown> = {
                action: "update_status",
                booking_id: id,
                status: cleanStatus,
            };

            if (branchId) body.branch_id = Number(branchId);
            if (price !== undefined) body.agreed_price = price;
            if (usedItems) body.used_items = usedItems;
            if (noDpReason) body.noDpReason = noDpReason;
            if (cleanStatus === "Cancelled") {
                body.cancel_reason = (cancelReason || "").trim();
                body.impact_acknowledged = true;
                body.booking_refund_amount = refund?.amount ?? 0;
                body.refund_method = refund?.method || "cash";
                body.refund_verified = refund?.verified === true;
            }
            if (cleanStatus === "Rejected") body.rejection_reason = (cancelReason || "").trim();

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || data.error || "Failed to update booking status.");
            }

            setBookingActionError("");
            updateLocalBooking(id, {
                status: cleanStatus,
                approvalStatus: ["Awaiting Down Payment","Confirmed"].includes(cleanStatus) && booking.approvalStatus === "pending" ? "approved" : booking.approvalStatus,
            });
            const refundNote = cleanStatus === "Cancelled" && (Number(data.booking_refunded) > 0 || Number(data.deposit_refunded) > 0)
                ? ` Refunded ${peso(Number(data.booking_refunded) || 0)} of the booking payment` +
                `${Number(data.deposit_refunded) > 0 ? ` and the ${peso(Number(data.deposit_refunded))} security deposit` : ""}.`
                : "";
            showBookingToast("success", isManagerApproval ? "Booking approved successfully" : "Booking status updated successfully",
                `${booking.bookingReference || `Booking #${id}`} is now ${getManagerBookingStatusLabel(cleanStatus)}.${refundNote}`);
            return true;
        } catch (err) {
            // Expected API/business-rule failures are already shown in the page alert.
            // Do not log them through console.error: Next.js dev overlay can obscure the UI.
            // Inventory validation and the booking's current status stay unchanged.
            setBookingActionError(err instanceof Error ? err.message : "Booking action failed.");
            return false;
        }
    }

    async function openCancelModal(booking: Booking) {
        const token=getToken();const branchId=getBranchId();
        setCancelModal(booking);setCancelItems([]);setCancelUsedQty({});
        setClosureImpact(null);setCancelError("");setCancelLoading(true);
        try {
            if(!token||!branchId)throw new Error("Booking session or branch is missing.");
            const headers={"Content-Type":"application/json",Authorization:`Bearer ${token}`};
            const payload=(action:string)=>JSON.stringify({action,booking_id:booking.id,branch_id:Number(branchId)});
            const [impactResponse,itemsResponse]=await Promise.all([
                fetch('/api/bookings',{method:'POST',headers,body:payload('get_booking_closure_impact')}),
                fetch('/api/bookings',{method:'POST',headers,body:payload('get_booking_items')})
            ]);
            const [impactData,itemsData]=await Promise.all([impactResponse.json(),itemsResponse.json()]);
            if(!impactResponse.ok||impactData.success===false||!impactData.impact)
                throw new Error(impactData.error||impactData.message||'Could not review cancellation impact.');
            if(!itemsResponse.ok||itemsData.success===false)
                throw new Error(itemsData.error||itemsData.message||'Could not review inventory items.');
            setClosureImpact(impactData.impact as BookingClosureImpact);
            const items:BookingInventoryItem[]=Array.isArray(itemsData.items)?itemsData.items:[];
            setCancelItems(items);
            setCancelUsedQty(Object.fromEntries(items.map(item=>[Number(item.id),Number(item.used_quantity||0)])));
        } catch(err) {
            setCancelError(err instanceof Error?err.message:'Could not review closure.');
        } finally {setCancelLoading(false);}
    }

    async function confirmCancelBooking(reason: string, refund?: CancelRefund) {
        if (!cancelModal) return;

        setCancelSubmitting(true);
        setCancelError("");

        try {
            const usedItems: CancelUsedItem[] = cancelItems.map((item) => {
                const itemId = Number(item.id);
                const reservedQty = Number(item.reserved_quantity || 0);
                const usedQty = Math.max(
                    0,
                    Math.min(Number(cancelUsedQty[itemId] || 0), reservedQty)
                );

                return {
                    booking_item_id: itemId,
                    used_quantity: usedQty,
                };
            });

            if(!closureImpact)throw new Error('Closure impact has not been reviewed.');
            const rejecting=normalizeStatus(cancelModal.status)==='Pending Review';
            const updated = await updateStatus(cancelModal.id, rejecting?'Rejected':'Cancelled',
                undefined, rejecting?undefined:usedItems, undefined, reason, rejecting?undefined:refund);
            if (!updated) throw new Error("Booking cancellation was not completed.");

            setCancelModal(null);
            setCancelItems([]);
            setCancelUsedQty({});
            setClosureImpact(null);
            await loadBookings();
        } catch (err) {
            console.error("Failed to cancel booking:", err);
            setCancelError(err instanceof Error ? err.message : "Couldn't cancel the booking. Check the quantities and try again.");
        } finally {
            setCancelSubmitting(false);
        }
    }

    async function updateCustomPaymentTerms(
        booking: Booking,
        agreedPrice: number,
        requiredDownPayment: number,
        refundableDeposit: number,
        depositWaiverReason: string,
        customConsumablesAgreed?: number,
        pricingAdjustmentReason?: string
    ) {
        const latest = bookings.find(b => b.id === booking.id) ?? booking;
        if (normalizeStatus(latest.status) !== "Pending Review" || latest.approvalStatus === "approved") {
            throw new Error("Price and payment terms can't be changed after approval.");
        }
        const token = getToken();
        const branchId = getBranchId();

        try {
            const body: Record<string, unknown> = {
                action: "update_price",
                booking_id: booking.id,
                agreed_price: agreedPrice,
                required_down_payment: requiredDownPayment,
                // Requires the backend update_price action to persist this value atomically
                // for the selected booking; it must not overwrite the branch-wide policy.
                refundable_deposit: refundableDeposit,
                depositWaiverReason,
                ...(customConsumablesAgreed !== undefined
                    ? {custom_consumables_agreed: customConsumablesAgreed} : {}),
                ...(pricingAdjustmentReason ? {pricing_adjustment_reason: pricingAdjustmentReason} : {}),
            };

            if (branchId) body.branch_id = Number(branchId);

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false || data.error) {
                throw new Error(
                    data.message ||
                    data.error ||
                    "Failed to update custom payment terms."
                );
            }

            // Do not claim success when an older API silently ignores refundable_deposit.
            // The statement reads the persisted booking deposit independently of the quote.
            const verificationResponse = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: booking.id,
                    ...(branchId ? { branch_id: Number(branchId) } : {}) }),
            });
            const verification = await verificationResponse.json();
            const savedDeposit = verification.statement?.depositRequired;
            if (!verificationResponse.ok || verification.error || savedDeposit == null ||
                !Number.isFinite(Number(savedDeposit)) || Math.abs(Number(savedDeposit) - refundableDeposit) > 0.005) {
                throw new Error("The security deposit didn't save. Refresh the page and check the terms before approving.");
            }

            const currentPaid = getAmountPaid(booking);
            const newBalance = Math.max(agreedPrice - currentPaid, 0);

            const newPaymentStatus =
                currentPaid >= agreedPrice
                    ? "Fully Paid"
                    : requiredDownPayment > 0 && currentPaid >= requiredDownPayment
                        ? "Down Payment Paid"
                        : currentPaid > 0
                            ? "Partial"
                            : requiredDownPayment === 0 ? "Unpaid" : "Down Payment Required";

            updateLocalBooking(booking.id, {
                agreed_price: agreedPrice,
                agreedPrice: agreedPrice,
                required_down_payment: requiredDownPayment,
                requiredDownPayment: requiredDownPayment,
                refundable_deposit: refundableDeposit,
                refundableDeposit: refundableDeposit,
                balance: newBalance,
                payment_status: newPaymentStatus,
                paymentStatus: newPaymentStatus,
            });
            showBookingToast("success", "Payment terms saved successfully",
                `${booking.bookingReference || `Booking #${booking.id}`} was updated.`);
        } catch (err) {
            console.error("Failed to update custom payment terms:", err);
            setBookingActionError(err instanceof Error ? err.message : "Could not save payment terms.");
            throw err;
        }
    }

    async function handlePriceConfirm(
        agreedPrice: number,
        requiredDownPayment: number,
        refundableDeposit: number,
        depositWaiverReason: string,
        customConsumablesAgreed?: number,
        pricingAdjustmentReason?: string
    ) {
        if (!priceModal) return;
        // Let PriceModal show any API/persistence error without closing the editor.
        await updateCustomPaymentTerms(priceModal, agreedPrice, requiredDownPayment, refundableDeposit, depositWaiverReason, customConsumablesAgreed, pricingAdjustmentReason);
        // Mark reviewed only after both the save API and deposit read-back succeed.
        setReviewedBookingIds(ids => ids.includes(priceModal.id) ? ids : [...ids, priceModal.id]);
        setPriceModal(null);
    }

    // Save the verified booking payment and refundable deposit in one server-side
    // transaction. They remain separate ledgers: a deposit is NOT booking revenue.
    async function saveRecordedPayment(bookingReceivedNow: number, depositReceivedNow: number,
                                       expectedDepositCollected: number) {
        if (!paymentModal || paymentSaving) return;
        const booking = bookings.find(item => item.id === paymentModal.id) ?? paymentModal;
        const total = getTotalPrice(booking);
        const currentPaid = getAmountPaid(booking);
        const remainingCents = Math.max(0, Math.round((total - currentPaid) * 100));
        const bookingCents = Math.round(bookingReceivedNow * 100);
        const depositCents = Math.round(depositReceivedNow * 100);
        if (![bookingReceivedNow, depositReceivedNow, expectedDepositCollected].every(Number.isFinite) ||
            bookingCents < 0 || depositCents < 0 || bookingCents + depositCents <= 0 ||
            bookingCents > remainingCents ||
            Math.abs(bookingReceivedNow * 100 - bookingCents) > 0.001 ||
            Math.abs(depositReceivedNow * 100 - depositCents) > 0.001) {
            setPaymentError("Enter valid amounts (up to 2 decimal places).");
            return;
        }
        const token = getToken();
        if (!token) { setPaymentError("Please sign in again before recording payment."); return; }
        setPaymentSaving(true);
        setPaymentError("");
        try {
            const body: Record<string, unknown> = {
                action: "record_booking_customer_payment_with_deposit",
                booking_id: booking.id,
                bookingPayment: bookingReceivedNow,
                depositPayment: depositReceivedNow,
                expectedBookingPaid: currentPaid,
                expectedDepositCollected,
                requestKey: `BOOKPAY-${booking.id}-${crypto.randomUUID()}`,
            };
            const branchId = getBranchId();
            if (branchId) body.branch_id = Number(branchId);
            const response = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok || result.success === false || result.error) {
                throw new Error(result.error || result.message || "Failed to record customer payment.");
            }
            updateLocalBooking(booking.id, {
                amount_paid: result.amountPaid, amountPaid: result.amountPaid,
                ...(result.bookingStatus ? {status:result.bookingStatus} : {}),
                balance: result.balance, payment_status: result.paymentStatus,
                paymentStatus: result.paymentStatus,
                // Refresh the deposit balance immediately, even for deposit-only receipts.
                securityDepositCollected: result.depositCollected,
            });
            setPaymentModal(null);
            setBookingActionError("");
            // The server transaction is already committed. A refresh failure
            // must not incorrectly tell the Manager that the payment failed.
            try { await loadBookings(); }
            catch (refreshError) { console.error("Payment saved, but booking list refresh failed:", refreshError); }
            if (result.confirmed) {
                showBookingToast("success", "Payment verified — booking confirmed and reserved",
                    `${peso(bookingReceivedNow)} booking payment and ${peso(depositReceivedNow)} security deposit recorded. The items are now reserved.`);
            } else if (result.reservationIssue) {
                showBookingToast("error", "Payment saved — reservation needs attention",
                    `Payment recorded, but the items couldn't be reserved: ${result.reservationIssue}`);
            } else {
                showBookingToast("success", "Customer payment recorded successfully",
                    `${peso(bookingReceivedNow)} booking payment and ${peso(depositReceivedNow)} security deposit recorded. The booking is still waiting for the full down payment.`);
            }
        } catch (error) {
            setPaymentError(error instanceof Error ? error.message : "Unable to record payment.");
        } finally {
            setPaymentSaving(false);
        }
    }

    const filtered = useMemo(() => {
        return bookings
            .filter((booking) => !approvalOnly || (booking.approvalStatus === "pending" && booking.status === "Pending Review"))
            .filter((booking) => filter === "All" || booking.status === filter)
            .filter((booking) => bookingType === "All" || getBookingTypeDisplay(booking) === bookingType)
            .filter((booking) => !dateFrom || dateKey(booking.date) >= dateFrom)
            .filter((booking) => !dateTo || dateKey(booking.date) <= dateTo)
            .filter((booking) => {
                if (!search) return true;

                const query = search.toLowerCase();

                return (
                    booking.name.toLowerCase().includes(query) ||
                    booking.bookingReference?.toLowerCase().includes(query) ||
                    booking.phone?.includes(query) ||
                    booking.facebookName?.toLowerCase().includes(query) ||
                    getBranchGroupName(booking).toLowerCase().includes(query) ||
                    booking.customOrder?.toLowerCase().includes(query) ||
                    booking.custom_order?.toLowerCase().includes(query) ||
                    booking.package?.toLowerCase().includes(query) ||
                    booking.packageName?.toLowerCase().includes(query) ||
                    booking.package_name?.toLowerCase().includes(query) ||
                    booking.eventType?.toLowerCase().includes(query) ||
                    booking.event_type?.toLowerCase().includes(query) ||
                    booking.theme?.toLowerCase().includes(query) ||
                    booking.venue?.toLowerCase().includes(query)
                );
            });
    }, [bookings, filter, dateFrom, dateTo, bookingType, search, approvalOnly]);

    const counts = TABS.reduce((acc, tab) => {
        acc[tab] =
            tab === "All"
                ? bookings.length
                : bookings.filter((booking) => booking.status === tab).length;

        return acc;
    }, {} as Record<string, number>);

    const bookingTypes = ["Package", "Custom"] as const;

    // Direct PDF / Excel (.xlsx) download. Never opens a print window.
    function exportBookings(rows: Booking[], fileType: "pdf" | "excel", selected = false) {
        const savedStoreId = getStoreId() || "Not available";
        const savedBranchId = getBranchId() || "Not available";
        const savedStoreName = [
            sessionStorage.getItem("store_name"),
            sessionStorage.getItem("stocknbook_store_name"),
            sessionStorage.getItem("business_name"),
            sessionStorage.getItem("storeName"),
        ].find(value => Boolean(value?.trim())) || `Store ${savedStoreId}`;
        const context: ManagerBookingExportContext = {
            storeName: savedStoreName,
            storeId: savedStoreId,
            branchName,
            branchId: savedBranchId,
            exportedAt: new Date(),
            selected,
        };
        try {
            if (fileType === "pdf") downloadManagerBookingsPdf(rows, context);
            else downloadManagerBookingsExcel(rows, context);
            showBookingToast("success", "Booking export downloaded", `${rows.length} booking(s) exported as ${fileType === "pdf" ? "PDF" : "Excel"}.`);
        } catch (err) {
            setBookingActionError(err instanceof Error ? err.message : "Unable to download booking export.");
        }
    }
    function clearFilters() {
        setSearch(""); setFilter("All"); setApprovalOnly(false);
        setBookingType("All"); setDateFrom(""); setDateTo("");
    }

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Bookings
                        </h1>

                        <span
                            title={branchName}
                            className="max-w-[220px] truncate rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]"
                        >
                            {branchName}
                        </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            onClick={() => void loadBookings()}
                            disabled={loading}
                            aria-label="Refresh bookings"
                            title="Refresh bookings"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            type="button"
                        >
                            <RefreshCw
                                size={16}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-4 py-4 sm:px-6">
                {/* Booking overview: operational counts from the current branch, not demo numbers. */}
                <div
                    className="mb-4"
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                        gap: 12,
                    }}
                >
                    {([
                        { key: "all", title: "Total Bookings", count: bookings.length, sub: "All recorded bookings", icon: <CalendarDays size={23}/>, tone: "bg-[#F3EBFF] text-[#6C3AD6]" },
                        { key: "confirmed", title: "Confirmed Bookings", count: counts["Confirmed"], sub: "Reserved and ready", icon: <BadgeCheck size={23}/>, tone: "bg-[#EAF7F0] text-[#25865B]" },
                        { key: "actions", title: "Pending Actions", count: counts["Pending Review"] + counts["Awaiting Down Payment"] + counts["Pending Settlement"], sub: "For review or payment", icon: <Hourglass size={23}/>, tone: "bg-[#FFF7E9] text-[#B7832E]" },
                        { key: "month", title: "This Month’s Bookings", count: bookings.filter(b => {
                                const today = currentDateTime ?? new Date();
                                return dateKey(b.date).slice(0,7) === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
                            }).length, sub: (currentDateTime ?? new Date()).toLocaleDateString("en-US", {month:"long",year:"numeric"}), icon: <CalendarDays size={23}/>, tone: "bg-[#F3EBFF] text-[#6C3AD6]" },
                    ] as const).map(metric => (
                        <button key={metric.key} type="button"
                                onClick={() => {setFilter(metric.key === "confirmed" ? "Confirmed" : "All");setApprovalOnly(false);}}
                                title={metric.key === "actions" || metric.key === "month" ? "Show all bookings; use Filters to narrow results" : `Filter: ${metric.title}`}
                                className="flex w-full items-center gap-3 rounded-[14px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-[#B6A1D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${metric.tone}`}>{metric.icon}</span>
                            <span className="min-w-0">
                                <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{metric.title}</span>
                                <span className="mt-1 block text-[24px] font-bold leading-none text-[#25153D]">{metric.count}</span>
                                <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{metric.sub}</span>
                            </span>
                        </button>
                    ))}
                </div>

                {loading && bookings.length === 0 ? <ModuleSkeleton variant="bookings" /> :
                    <BookingWorkspace
                        bookings={filtered} canManage={canManage} managerView
                        listToolbar={<div className="space-y-3 pb-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-[17px] font-bold text-[#25143F]">All Bookings</h2>
                                </div>
                                <div className="relative shrink-0">
                                    <button type="button" aria-label="Export booking list" title="Export booking list" onClick={() => setListExportOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9C9EB] text-[#43217A] hover:bg-[#F3EEFF]"><Download size={17}/></button>
                                    {listExportOpen && <div className="absolute right-0 top-10 z-30 w-40 rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-xl">
                                        <button type="button" onClick={() => {exportBookings(filtered,"pdf");setListExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download PDF</button>
                                        <button type="button" onClick={() => {exportBookings(filtered,"excel");setListExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download Excel (.xlsx)</button>
                                    </div>}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <label className="relative min-w-[200px] flex-1">
                                    <span className="sr-only">Search bookings</span>
                                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#957CAB]"/>
                                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by customer, reference, or event" className="h-10 w-full rounded-xl border border-[#E4D9EF] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#7648DC] focus:ring-2 focus:ring-[#7648DC]/10" />
                                </label>
                                <button type="button" aria-expanded={showAdvancedFilters} aria-controls="manager-booking-filters" onClick={() => setShowAdvancedFilters(v => !v)}
                                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#DCCFEB] bg-white px-3 text-xs font-semibold text-[#43217A] hover:bg-[#F7F2FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7648DC]">
                                    {showAdvancedFilters ? "Hide filters" : "Filters"}
                                    {(filter !== "All" || bookingType !== "All" || dateFrom || dateTo || approvalOnly) && <span className="rounded-full bg-[#EFE8FB] px-2 py-0.5 text-[10px]">Active</span>}
                                </button>
                            </div>
                            {filter !== "All" && <p className="text-xs text-[#655478]">Status: {getManagerBookingStatusLabel(filter)}</p>}
                            {showAdvancedFilters && <div id="manager-booking-filters" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Booking Type
                                    <select value={bookingType} onChange={e=>setBookingType(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]">
                                        <option value="All">All Types</option>{bookingTypes.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Status
                                    <select value={filter} onChange={e=>{setFilter(e.target.value as FilterType);setApprovalOnly(false);}} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]">
                                        {TABS.map(t=><option key={t} value={t}>{t === "All" ? "All Statuses" : getManagerBookingStatusLabel(t)}</option>)}
                                    </select>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Date From
                                    <input aria-label="Booking date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={e=>setDateFrom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]"/>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Date To
                                    <input aria-label="Booking date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={e=>setDateTo(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]"/>
                                </label>
                            </div>}
                            {(search || filter !== "All" || approvalOnly || bookingType !== "All" || dateFrom || dateTo) && <div className="flex justify-end"><button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#6335BC] hover:underline">Clear filters</button></div>}
                        </div>}
                        onExportSelected={(b,type,tab)=>{
                            const context: ManagerBookingExportContext = {
                                storeName: [sessionStorage.getItem("store_name"), sessionStorage.getItem("stocknbook_store_name"), sessionStorage.getItem("business_name"), sessionStorage.getItem("storeName")]
                                    .find(value => Boolean(value?.trim())) || `Store ${getStoreId() || "Not available"}`,
                                storeId: getStoreId() || "Not available",
                                branchName,
                                branchId: getBranchId() || "Not available",
                                exportedAt: new Date(),
                                selected: true,
                            };
                            void downloadSelectedBookingTab(b,tab,type,context)
                                .then(()=>showBookingToast("success", `${tab} downloaded`, `${tab} exported as ${type === "pdf" ? "PDF" : "Excel"}.`))
                                .catch(err=>setBookingActionError(err instanceof Error ? err.message : "Unable to export selected booking details."));
                        }}
                        reviewedBookingIds={reviewedBookingIds}
                        onUpdateStatus={canManage ? (id, status, price) => {
                            const booking = bookings.find(item => item.id === id);
                            if (status === "Awaiting Down Payment" && booking && normalizeStatus(booking.status) === "Pending Review") {
                                setApprovalError("");
                                setApprovalModal(booking);
                                return;
                            }
                            void updateStatus(id, status, price);
                        } : undefined}
                        onSetPrice={canManage ? b => {
                            if (getManagerBookingTypeLabel(b) === "Package" && Number(b.rentalItemCount || 0) === 0) {
                                setBookingActionError("The package sets the price.");
                                return;
                            }
                            if (normalizeStatus(b.status) !== "Pending Review" || b.approvalStatus === "approved") {
                                setBookingActionError("Price and down payment can't be changed after approval.");
                                return;
                            }
                            // Reopening terms requires saving them again before approval.
                            setReviewedBookingIds(ids => ids.filter(id => id !== b.id));
                            setPriceModal(b);
                        } : undefined}
                        onRecordDownPayment={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onMarkFullyPaid={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onCancelBooking={canManage ? openCancelModal : undefined}
                        onSettleDeposit={canManage ? b => setSettlementBooking(b) : undefined}
                    />}
            </section>

            {approvalModal && canManage && <ApproveBookingModal
                booking={bookings.find(b => b.id === approvalModal.id) ?? approvalModal}
                busy={approvalSaving}
                error={approvalError}
                onClose={() => { if (!approvalSaving) { setApprovalModal(null); setApprovalError(""); } }}
                onApprove={async (noDpReason) => {
                    setApprovalSaving(true);
                    setApprovalError("");
                    try {
                        const chosen=bookings.find(b=>b.id===approvalModal.id)??approvalModal;
                        const noDp=getRequiredDownPayment(chosen)===0;
                        const ok = await updateStatus(approvalModal.id, noDp?"Confirmed":"Awaiting Down Payment",
                            undefined,undefined,noDp?noDpReason:undefined);
                        if (ok) setApprovalModal(null);
                        else setApprovalError("Couldn't approve the booking. Try again.");
                    } finally { setApprovalSaving(false); }
                }}
            />}

            {settlementBooking && canManage && <RentalReturnSettlementDialog
                booking={settlementBooking}
                onClose={() => setSettlementBooking(null)}
                onSaved={async (completed, message) => {
                    setSettlementBooking(null);
                    // The settlement is already saved; a refresh failure must not trigger a retry.
                    try { await loadBookings(); } catch { /* already committed */ }
                    showBookingToast("success", completed ? "Booking settled and completed" : "Settlement recorded", message);
                }}
            />}

            {paymentModal && canManage && <RecordPaymentModal
                booking={bookings.find(b=>b.id === paymentModal.id) ?? paymentModal}
                busy={paymentSaving} error={paymentError}
                onClose={() => {if(!paymentSaving){setPaymentModal(null);setPaymentError("");}}}
                onSave={saveRecordedPayment}
            />}

            {priceModal && canManage && normalizeStatus((bookings.find(b => b.id === priceModal.id) ?? priceModal).status) === "Pending Review" && (
                <PriceModal
                    booking={priceModal}
                    onConfirm={handlePriceConfirm}
                    onClose={() => setPriceModal(null)}
                />
            )}
            {cancelModal && canManage && (
                <CancelInventoryModal
                    booking={cancelModal}
                    impact={closureImpact}
                    items={cancelItems}
                    usedQty={cancelUsedQty}
                    loading={cancelLoading}
                    submitting={cancelSubmitting}
                    error={cancelError}
                    onChangeUsedQty={(itemId, value) =>
                        setCancelUsedQty((prev) => ({
                            ...prev,
                            [itemId]: value,
                        }))
                    }
                    onClose={() => {
                        if (cancelSubmitting) return;
                        setCancelModal(null);
                        setCancelItems([]);
                        setCancelUsedQty({});
                        setClosureImpact(null);
                        setCancelError("");
                    }}
                    onConfirm={confirmCancelBooking}
                />
            )}

            {/* Matches the staff attendance success toast: bottom-right, dismissible,
                and automatically hidden. No changes to booking rules or API payloads. */}
            {toast && (
                <div
                    key={toast.id}
                    role={toast.kind === "error" ? "alert" : "status"}
                    aria-live={toast.kind === "error" ? "assertive" : "polite"}
                    className={`fixed bottom-5 right-5 z-[250] flex w-[400px] max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_12px_32px_rgba(38,21,63,0.14)] ${
                        toast.kind === "success" ? "border-[#BAE8CC]" : "border-[#F6C9CE]"
                    }`}
                >
                    <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        toast.kind === "success" ? "bg-[#EAF9EF] text-[#119047]" : "bg-[#FFF0F1] text-[#D43C53]"
                    }`}>
                        {toast.kind === "success" ? <CheckCircle2 size={22}/> : <AlertCircle size={22}/>}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold leading-5 text-[#231834]">{toast.title}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-[#7B6A8A]">{toast.description}</p>
                    </div>
                    <button
                        type="button"
                        aria-label="Dismiss notification"
                        onClick={() => setToast(null)}
                        className="-mr-1 -mt-1 rounded-lg p-1.5 text-[#897899] hover:bg-[#F6F1FA] hover:text-[#352044] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6C3AD6]"
                    >
                        <X size={17}/>
                    </button>
                </div>
            )}
        </>
    );
}
// Keep the existing manager approval confirmation, without any deadline requirement.
function ApproveBookingModal({booking, busy, error, onClose, onApprove}: {
    booking: Booking;
    busy: boolean;
    error: string;
    onClose: () => void;
    onApprove: (noDpReason?:string) => Promise<void>;
}) {
    const [agreed, setAgreed] = useState(false);
    const [validation, setValidation] = useState("");
    const [depositRequired, setDepositRequired] = useState<number | null>(null);
    const [depositError, setDepositError] = useState("");
    const [hasRental, setHasRental] = useState<boolean | null>(null);
    const [noDpReason, setNoDpReason] = useState("");
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Login required.");
                const response = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: booking.id,
                        branch_id: Number(booking.branchId || booking.branch_id) || undefined }),
                });
                const itemsResponse = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_booking_items", booking_id: booking.id,
                        branch_id: Number(booking.branchId || booking.branch_id) || undefined }),
                });
                const [data, itemsData] = await Promise.all([response.json(), itemsResponse.json()]);
                const deposit = Number(data.statement?.depositRequired);
                if (!response.ok || data.error || data.statement?.depositRequired == null || !Number.isFinite(deposit) ||
                    !itemsResponse.ok || itemsData.error ||
                    !Array.isArray(itemsData.rentalItems) || !Array.isArray(data.statement?.rentalItems))
                    throw new Error(data.error || itemsData.error || "Security deposit or rental items are unavailable.");
                if (!cancelled) {
                    setDepositRequired(Math.max(0, deposit));
                    setHasRental(itemsData.rentalItems.length > 0 || data.statement.rentalItems.length > 0);

                }
            } catch (error) {
                if (!cancelled) setDepositError(error instanceof Error ? error.message : "Unable to read deposit terms.");
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);
    function submit() {
        if (depositRequired === null) {
            setValidation("Wait for the security deposit to load.");
            return;
        }
        if (hasRental === null) {
            setValidation("Booking rental items must be verified first.");
            return;
        }
        if (getRequiredDownPayment(booking)===0 && noDpReason.trim().length<10){
            setValidation("Explain why no down payment is needed (at least 10 characters)."); return;
        }
        if (!agreed) {
            setValidation("Confirm the customer agreed to these terms.");
            return;
        }
        if (getTotalPrice(booking) <= 0 || getRequiredDownPayment(booking) > getTotalPrice(booking)) {
            setValidation("Set a valid price and a down payment no higher than the price.");
            return;
        }
        setValidation("");
        void onApprove(getRequiredDownPayment(booking)===0?noDpReason.trim():undefined);
    }
    return <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 px-4 py-5">
        <div role="dialog" aria-modal="true" aria-labelledby="approval-title" className="w-full max-w-md rounded-2xl border border-[#E5D8F1] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 id="approval-title" className="text-lg font-bold text-[#24163E]">Approve Booking</h2>
                    <p className="mt-1 text-xs text-[#827394]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
                </div>
                <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-[#806D91] hover:bg-[#F4EFFB]"><X size={19}/></button>
            </div>
            <div className="mt-4 space-y-2 rounded-xl border border-[#EAE0F4] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Final Agreed Price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                <div className="flex justify-between gap-3"><span>Required Down Payment</span><strong>{peso(getRequiredDownPayment(booking))}</strong></div>
                {hasRental && <div className="flex justify-between gap-3"><span>Refundable Security Deposit</span><strong>{depositRequired === null ? "Loading…" : peso(depositRequired)}</strong></div>}
                {hasRental && <p className="text-xs text-[#806A8C]">Collected before the equipment is handed over.</p>}
                {depositError && <p role="alert" className="text-xs text-red-600">{depositError}</p>}
            </div>
            {getRequiredDownPayment(booking)===0 && <label className="mt-4 block text-xs font-medium text-[#4F4162]">
                Reason for no down payment (10+ characters)
                <textarea value={noDpReason} onChange={e=>setNoDpReason(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-lg border border-[#E2D6EF] p-2" maxLength={500}/>
                <span className="mt-1 block font-normal text-[#806A8C]">With no down payment, approving confirms the booking right away. Full payment is still due before hand over.</span>
            </label>}
            <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#4F4162]">
                <input type="checkbox" checked={agreed} onChange={e=>{setAgreed(e.target.checked);setValidation("");}} disabled={busy} className="mt-1 accent-[#673DC8]"/>
                <span>The customer agreed to the price, down payment and security deposit.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-[#816E93]">{getRequiredDownPayment(booking)===0
                ? "Approving confirms the booking and reserves the items. Full payment is still due before hand over."
                : "Approving requests the down payment. Items are reserved once it's paid."} Payment terms are locked after approval.</p>
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{validation || error}</p>}
            <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-[#E2D6EF] px-4 py-2.5 text-sm font-semibold text-[#47246E]">Back</button>
                <button type="button" disabled={busy || !agreed || depositRequired === null || hasRental === null ||
                    (getRequiredDownPayment(booking)===0 && noDpReason.trim().length<10)} onClick={submit} className="rounded-xl bg-[#432078] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Approving..." : getRequiredDownPayment(booking)===0 ? "Approve & Confirm" : "Approve Booking"}</button>
            </div>
        </div>
    </div>;
}

function RecordPaymentModal({booking, busy, error, onClose, onSave}: {
    booking: Booking;
    busy: boolean;
    error: string;
    onClose: () => void;
    onSave: (bookingReceived: number, depositReceived: number, expectedDepositCollected: number) => void | Promise<void>;
}) {
    const balance = getBalance(booking);
    const paid = getAmountPaid(booking);
    const required = getRequiredDownPayment(booking);
    // This is a receipt workflow, not a second terms editor. Use calculated
    // outstanding amounts for one-click recording, with an optional override.
    const remainingDp = Math.max(0, Math.round((required - paid) * 100)) / 100;
    const [paymentChoice, setPaymentChoice] = useState<"dp" | "balance" | "none">(
        remainingDp > 0.005 ? "dp" : balance > 0.005 ? "balance" : "none"
    );
    const [includeDeposit, setIncludeDeposit] = useState(false);
    const [deposit, setDeposit] = useState<{required: number; collected: number; hasRental: boolean} | null>(null);
    const [depositLoading, setDepositLoading] = useState(true);
    const [depositError, setDepositError] = useState("");
    const [verified, setVerified] = useState(false);
    const [validation, setValidation] = useState("");

    // Fetch the actual deposit ledger: deposit balances are not reliably
    // reflected in the booking-list row after an earlier receipt.
    useEffect(() => {
        let cancelled = false;
        setDeposit(null);
        setDepositLoading(true);
        setDepositError("");
        void (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Sign in again to view payment details.");
                const response = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({action: "get_booking_financial_statement", booking_id: booking.id,
                        branch_id: Number(booking.branchId || booking.branch_id) || undefined}),
                });
                const data = await response.json();
                const statement = data.statement;
                const requiredAmount = Number(statement?.depositRequired);
                const collectedAmount = Number(statement?.depositCollected);
                if (!response.ok || data.error || statement?.depositRequired == null ||
                    statement?.depositCollected == null || !Number.isFinite(requiredAmount) ||
                    !Number.isFinite(collectedAmount) || requiredAmount < 0 || collectedAmount < 0)
                    throw new Error(data.error || "Security deposit amounts are unavailable.");
                if (!Array.isArray(statement?.rentalItems))
                    throw new Error("Couldn't load the rental items. Refresh the page.");
                if (!cancelled) setDeposit({required: requiredAmount, collected: collectedAmount,
                    hasRental: statement.rentalItems.length > 0});
            } catch (cause) {
                if (!cancelled) setDepositError(cause instanceof Error ? cause.message : "Unable to load security deposit.");
            } finally {
                if (!cancelled) setDepositLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);

    const cents = (amount: number) => Math.round(amount * 100);
    const bookingDueCents = Math.max(0, cents(balance));
    const depositDueCents = deposit ? Math.max(0, cents(deposit.required) - cents(deposit.collected)) : 0;
    const showRentalDeposit = !!deposit && (deposit.hasRental || deposit.required > 0.005 || deposit.collected > 0.005);
    const remainingDpCents = Math.min(bookingDueCents, Math.max(0, cents(required) - cents(paid)));
    const rawBookingReceived = paymentChoice === "dp" ? remainingDpCents / 100 :
        paymentChoice === "balance" ? bookingDueCents / 100 :
            0;
    const rawDepositReceived = includeDeposit && showRentalDeposit && depositDueCents > 0 ?
        depositDueCents / 100 : 0;
    const bookingReceived = rawBookingReceived;
    const depositReceived = rawDepositReceived;
    const bookingReceivedCents = Number.isFinite(bookingReceived) ? cents(bookingReceived) : NaN;
    const depositReceivedCents = Number.isFinite(depositReceived) ? cents(depositReceived) : NaN;
    const totalReceived = (bookingReceivedCents + depositReceivedCents) / 100;
    const remainingAfter = Math.max(0, bookingDueCents - (Number.isFinite(bookingReceivedCents) ? bookingReceivedCents : 0)) / 100;
    const depositAfter = Math.max(0, depositDueCents - (Number.isFinite(depositReceivedCents) ? depositReceivedCents : 0)) / 100;
    const entryValid = (value: number, limitCents: number) => Number.isFinite(value) && value >= 0 &&
        cents(value) <= limitCents && Math.abs(value * 100 - cents(value)) <= 0.001;
    const amountValid = entryValid(bookingReceived, bookingDueCents) && entryValid(depositReceived, depositDueCents) &&
        bookingReceivedCents + depositReceivedCents > 0 &&
        (paymentChoice !== "dp" || remainingDpCents > 0);
    function choose(choice: "dp" | "balance" | "none") {
        setPaymentChoice(choice);
        setValidation("");
        setVerified(false);
    }
    function save() {
        if (depositLoading || !deposit) {setValidation("Wait for the payment details to load.");return;}
        if (!amountValid) {setValidation("Choose what the customer paid.");return;}
        if (!verified) {setValidation("Tick the box to confirm you received the money.");return;}
        setValidation("");
        void onSave(bookingReceived, depositReceived, deposit.collected);
    }
    const optionClass = (selected: boolean) => `w-full rounded-xl border px-3 py-3 text-left text-sm transition-colors ${selected ?
        "border-[#7140DC] bg-[#F7F1FF] text-[#35165F] ring-1 ring-[#7140DC]" :
        "border-[#E5D8EF] bg-white text-[#49366B] hover:bg-[#FBF9FF]"}`;
    return <div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6">
        <div role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#E7D9F2] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
                <h2 id="payment-modal-title" className="text-lg font-bold text-[#26153F]">Record Payment</h2>
                <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="rounded-lg p-1.5 hover:bg-[#F5F0FC]"><X size={19}/></button>
            </div>
            <p className="mt-1 text-sm text-[#78698D]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
            <div className="mt-4 space-y-2 rounded-xl border border-[#E9E0EF] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Total price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                {cents(required) > 0 && <div className="flex items-center justify-between gap-3"><span>Down payment</span>
                    <span className="flex items-center gap-2"><strong>{peso(required)}</strong><PaidBadge paid={paid} due={required}/></span></div>}
                {(cents(required) === 0 ? cents(paid) > 0 : cents(paid) > cents(required)) &&
                    <div className="flex justify-between gap-3"><span>Paid so far</span><strong>{peso(paid)}</strong></div>}
                <div className="flex justify-between gap-3 border-t border-[#E9E0EF] pt-2 font-semibold"><span>Balance</span><strong>{bookingDueCents > 0 ? peso(balance) : "Fully paid"}</strong></div>
                {showRentalDeposit && cents(deposit?.required ?? 0) > 0 && <div className="flex items-center justify-between gap-3"><span>Security deposit</span>
                    <span className="flex items-center gap-2"><strong>{peso(deposit?.required ?? 0)}</strong><PaidBadge paid={deposit?.collected ?? 0} due={deposit?.required ?? 0}/></span></div>}
            </div>
            {depositError && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{depositError} Close and reopen to retry.</p>}
            {bookingDueCents > 0 && <section className="mt-4" aria-label="Choose booking payment received">
                <p className="mb-2 text-sm font-bold text-[#26153F]">What did the customer pay?</p>
                <div className="space-y-2">
                    {remainingDpCents > 0 && <button type="button" className={optionClass(paymentChoice === "dp")} aria-pressed={paymentChoice === "dp"} disabled={busy || depositLoading || !deposit}
                                                     onClick={() => choose("dp")}><span className="flex items-center justify-between gap-2"><span>Down payment</span><strong>{peso(remainingDpCents / 100)}</strong></span></button>}
                    <button type="button" className={optionClass(paymentChoice === "balance")} aria-pressed={paymentChoice === "balance"} disabled={busy || depositLoading || !deposit}
                            onClick={() => choose("balance")}><span className="flex items-center justify-between gap-2"><span>{remainingDpCents > 0 ? "Full balance" : "Remaining balance"}</span><strong>{peso(bookingDueCents / 100)}</strong></span></button>
                    {showRentalDeposit && depositDueCents > 0 && <button type="button" className={optionClass(paymentChoice === "none")} aria-pressed={paymentChoice === "none"} disabled={busy || depositLoading || !deposit}
                                                                         onClick={() => {choose("none");setIncludeDeposit(true);}}>Security deposit only</button>}
                </div>
            </section>}
            {/* Only what still needs paying is shown: a paid deposit needs no section. */}
            {showRentalDeposit && depositDueCents > 0 && <section className="mt-4 border-t border-[#E9E0EF] pt-4" aria-label="Rental security deposit">
                <p className="mb-2 text-sm font-bold text-[#26153F]">Security deposit (refundable)</p>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5D8EF] p-3 text-sm text-[#49366B]">
                    <input type="checkbox" className="mt-0.5 accent-[#673DC8]" checked={includeDeposit} disabled={busy || depositLoading || !deposit}
                           onChange={e => {setIncludeDeposit(e.target.checked);setVerified(false);setValidation("");}}/>
                    <span>Also received the security deposit — <strong>{peso(depositDueCents / 100)}</strong></span>
                </label>
            </section>}
            <div className="mt-4 space-y-1 rounded-xl bg-[#F7F1FF] px-3 py-3 text-sm text-[#57436F]">
                {/* The parts are listed only when the money is split between booking payment and deposit. */}
                {bookingReceivedCents > 0 && depositReceivedCents > 0 && <>
                    <div className="flex justify-between gap-2"><span>Booking payment</span><strong>{peso(bookingReceived)}</strong></div>
                    <div className="flex justify-between gap-2"><span>Security deposit</span><strong>{peso(depositReceived)}</strong></div>
                </>}
                <div className={`flex justify-between gap-2 font-bold ${bookingReceivedCents > 0 && depositReceivedCents > 0 ? "border-t border-[#E0D4EA] pt-2" : ""}`}><span>Total received now</span><strong>{Number.isFinite(totalReceived) ? peso(totalReceived) : "Invalid"}</strong></div>
                {totalReceived > 0 && (remainingAfter > 0 || depositAfter > 0 ? <>
                    {remainingAfter > 0 && <div className="flex justify-between gap-2 text-xs"><span>Balance after this</span><span>{peso(remainingAfter)}</span></div>}
                    {showRentalDeposit && depositAfter > 0 && <div className="flex justify-between gap-2 text-xs"><span>Deposit still due after this</span><span>{peso(depositAfter)}</span></div>}
                </> : <p className="flex items-center gap-1.5 text-xs font-semibold text-[#23834A]"><CheckCircle2 size={14}/> Fully paid after this.</p>)}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E8DDF2] bg-[#FCFAFF] p-3 text-xs leading-5 text-[#49376A]">
                <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)} disabled={busy || depositLoading || !deposit || !amountValid} className="mt-0.5 accent-[#6435BC]" />
                <span>I received this money from the customer.</span>
            </label>
            {showRentalDeposit && depositDueCents > 0 && <p className="mt-2 text-xs leading-5 text-[#827393]">The security deposit is kept separately and returned after the equipment comes back.</p>}
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{validation || error}</p>}
            <div className="mt-5 flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-[#D9C6E9] bg-white px-3 text-sm font-semibold text-[#352353] hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                <button type="button" disabled={busy || depositLoading || !deposit || !amountValid || !verified} onClick={save} className="min-h-11 flex-1 rounded-xl bg-[#432183] px-3 text-sm font-bold text-white hover:bg-[#30145F] disabled:opacity-50">{busy ? "Saving…" : "Save Payment"}</button></div>
        </div>
    </div>;
}

// "Paid" when fully paid, "₱X paid" when partly paid, "Not paid" otherwise.
function PaidBadge({paid, due}: {paid: number; due: number}) {
    const paidCents = Math.round(paid * 100), dueCents = Math.round(due * 100);
    const [label, tone] = paidCents >= dueCents ? ["Paid", "bg-[#E7F6EC] text-[#23834A]"] :
        paidCents > 0 ? [`${peso(paid)} paid`, "bg-[#FFF4DC] text-[#926400]"] : ["Not paid", "bg-[#F4EFF8] text-[#6B5A80]"];
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

function normalizeClosureStatus(status:string){return /^(pending review|pending)$/i.test(status)?"Pending Review":status;}

function CancelInventoryModal({
                                  booking,
                                  impact,
                                  items,
                                  usedQty,
                                  loading,
                                  submitting,
                                  error,
                                  onChangeUsedQty,
                                  onClose,
                                  onConfirm,
                              }: {
    booking: Booking;
    impact: BookingClosureImpact | null;
    items: BookingInventoryItem[];
    usedQty: Record<number, number>;
    loading: boolean;
    submitting: boolean;
    error: string;
    onChangeUsedQty: (itemId: number, value: number) => void;
    onClose: () => void;
    onConfirm: (reason: string, refund?: CancelRefund) => void;
}) {
    const [reason, setReason] = useState("");
    const [acknowledged,setAcknowledged] = useState(false);
    // Refund on cancellation: pre-filled with the suggestion, which follows the used quantities
    // until the Manager types their own amount.
    const [refundText, setRefundText] = useState("");
    const [refundTouched, setRefundTouched] = useState(false);
    const [refundMethod, setRefundMethod] = useState("cash");
    const [refundVerified, setRefundVerified] = useState(false);
    const rejecting=normalizeClosureStatus(booking.status)==='Pending Review';
    const reservedItems = items.filter(
        (item) => Number(item.reserved_quantity || 0) > 0
    );

    const hasReservedItems = reservedItems.length > 0;
    const rentalAllocations = impact?.rentalAllocations ?? {};
    const reservedRentals = Number(rentalAllocations.reserved || 0);
    const checkedOutRentals = Number(rentalAllocations.checked_out || 0);
    const returnedRentals = Number(rentalAllocations.returned || 0);
    const rentalCancellationBlocked = Boolean(impact?.rentalCancellationBlocked) ||
        checkedOutRentals > 0 || returnedRentals > 0;
    const hasRentalLines = Number(impact?.rentalItemLines || 0) > 0;
    const refundable = Math.max(0, Number(impact?.refundableBookingPayment ?? 0));
    // Policy: the store keeps the LARGER of the non-refundable down payment or the products already used.
    const downPayment = Math.max(0, Number(impact?.requiredDownPayment ?? 0));
    // Discounted price when the package / quote has a discount, otherwise the normal price.
    const refundPrice = (item: BookingInventoryItem) => Number(item.refund_unit_price ?? item.unit_price ?? 0);
    const normalTotal = reservedItems.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.reserved_quantity || 0), 0);
    const discountedTotal = reservedItems.reduce((sum, item) => sum + refundPrice(item) * Number(item.reserved_quantity || 0), 0);
    const discountPercent = normalTotal > 0 ? Math.round((1 - discountedTotal / normalTotal) * 1000) / 10 : 0;
    const hasDiscount = discountPercent >= 0.1;
    // Same rule as the Lambda: used quantity × the price shown, so the math adds up. When everything is used it is
    // exactly the deal price (no ₱0.01 left over), and never more than the deal price.
    const usedOf = (item: BookingInventoryItem) => Math.max(0, Math.min(Number(usedQty[Number(item.id)] || 0), Number(item.reserved_quantity || 0)));
    const shownUsed = Math.round(reservedItems.reduce((sum, item) => sum + Math.round(usedOf(item) * refundPrice(item) * 100), 0)) / 100;
    const dealTotal = Math.round(reservedItems.reduce((sum, item) =>
        sum + Number(item.reserved_quantity || 0) * Number(item.unit_price || 0) * Number(item.refund_price_ratio ?? 1), 0) * 100) / 100;
    const allUsed = reservedItems.length > 0 && reservedItems.every((item) => usedOf(item) >= Number(item.reserved_quantity || 0));
    const usedValue = allUsed ? dealTotal : Math.min(shownUsed, dealTotal);
    const storeKeepsSuggested = Math.min(refundable, Math.max(downPayment, usedValue));
    const suggestedRefund = Math.max(0, Math.round((refundable - storeKeepsSuggested) * 100) / 100);
    useEffect(() => {
        if (impact && !refundTouched) setRefundText(String(suggestedRefund));
    }, [impact, refundTouched, suggestedRefund]);
    const depositBack = Math.max(0, Number(impact?.depositRefundOnCancel ?? impact?.depositHeld ?? 0));
    const showRefund = !rejecting && !!impact && (refundable > 0.005 || depositBack > 0.005);
    const refundValue = refundable > 0.005 ? Number(refundText) : 0;
    const refundValid = refundable <= 0.005 || (refundText.trim() !== "" && Number.isFinite(refundValue) && refundValue >= 0 &&
        refundValue <= refundable + 0.005 && Math.abs(refundValue * 100 - Math.round(refundValue * 100)) < 0.001);
    const totalBack = (refundValid ? refundValue : 0) + depositBack;
    const refundReady = !showRefund || (refundValid && (totalBack <= 0.005 || refundVerified));

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 font-sans">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="border-b border-[#EFE7F4] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#806A8C]">
                        {rejecting?'Reject Booking':'Cancel Booking'}
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-[#1A1220]">
                        {rejecting?'Explain why the request is being rejected':'Review cancellation impact'}
                    </h2>

                    <p className="mt-1 text-sm text-[#7A6A84]">
                        Booking #{booking.id} · {booking.name}
                    </p>
                </div>

                <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
                    {impact && <div className="mb-4 rounded-xl border border-[#E6DDF0] bg-[#FAF8FD] p-4 text-xs text-[#2B174C]">
                        <h3 className="mb-3 text-sm font-bold">{rejecting?'Before rejecting':'Summary'}</h3>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <span>Current status</span><strong className="text-right">{impact.status}</strong>
                            <span>Payment stage</span><strong className="text-right">{impact.paymentStage.replaceAll('_',' ')}</strong>
                            <span>Booking payments received</span><strong className="text-right">{peso(impact.paymentReceived)}</strong>
                            {/* Only the rows that apply to this booking's contents. */}
                            {(hasRentalLines || impact.depositCollected > 0.005) && <>
                                <span>Rental deposit collected</span><strong className="text-right">{peso(impact.depositCollected)}</strong>
                                <span>Security deposit still held</span><strong className="text-right">{peso(impact.depositHeld)}</strong>
                            </>}
                            {items.length > 0 && <>
                                <span>Reserved consumable units</span><strong className="text-right">{impact.reservedConsumableUnits}</strong>
                                <span>Previously used consumables</span><strong className="text-right">{impact.usedConsumableUnits}</strong>
                            </>}
                            {hasRentalLines && <><span>Rental items</span><strong className="text-right">{impact.rentalItemLines}</strong></>}
                        </div>
                        {!rejecting && <p className="mt-3 border-t border-[#E6DDF0] pt-3 leading-5 text-[#655478]">
                            {hasReservedItems ? "Step 1: enter the products already used. Step 2: confirm the refund. Both are saved together with the cancellation." : "The refund below is saved together with the cancellation."} Payment records are kept for history.
                        </p>}
                    </div>}
                    {/* Step 1: products already used. It comes BEFORE the refund because the refund depends on it. */}
                    {loading ? (
                        <div className="mb-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-8 text-center text-sm text-[#806A8C]">
                            Loading booking items...
                        </div>
                    ) : rejecting ? (
                        <p className="mb-4 text-xs text-[#655478]">Not approved yet, so no items need returning.</p>
                    ) : !hasReservedItems ? (
                        <div className="mb-4 rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-4 text-sm text-[#8A5A00]">
                            No reserved consumable inventory was found. {hasRentalLines
                            ? "No consumables to return."
                            : "No consumables to return."}
                        </div>
                    ) : (
                        <section aria-label="Products already used" className="mb-4 overflow-hidden rounded-xl border border-[#D6C4F8] bg-white text-xs text-[#2B174C]">
                            <div className="flex items-start gap-3 border-b border-[#EFE7F4] px-4 py-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2B174C] text-[11px] font-bold text-white">1</span>
                                <div>
                                    <h3 className="text-sm font-bold">Products already used</h3>
                                    <p className="mt-0.5 leading-5 text-[#806A8C]">Enter how many of each product were already used and can't go back to inventory. Leave 0 if nothing was used. The rest returns to inventory.</p>
                                </div>
                            </div>
                            {hasDiscount && <p className="border-b border-[#EFE7F4] bg-[#F5F0FF] px-4 py-2 leading-5 text-[#4D2B85]">
                                {getManagerBookingTypeLabel(booking) === "Package" ? "Package discount" : "Discount"} applied ({discountPercent}% off):
                                used products are valued at the <strong>discounted price</strong> the customer agreed to.</p>}
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-left">
                                    <thead className="bg-[#F7F2FC] text-[10px] font-bold uppercase tracking-wide text-[#6A5582]">
                                    <tr><th className="px-4 py-2">Product</th><th className="px-2 py-2 text-right">Price</th><th className="px-2 py-2 text-center">Booked</th>
                                        <th className="px-2 py-2 text-center">Used</th><th className="px-2 py-2 text-center">Back to inventory</th><th className="px-4 py-2 text-right">Used value</th></tr>
                                    </thead>
                                    <tbody>{reservedItems.map((item) => {
                                        const itemId = Number(item.id);
                                        const reserved = Number(item.reserved_quantity || 0);
                                        const used = Math.max(0, Math.min(Number(usedQty[itemId] || 0), reserved));
                                        const label = item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name;
                                        return <tr key={item.id} className="border-t border-[#EFE7F4]">
                                            <td className="px-4 py-2 font-semibold text-[#1A1220]">{label}</td>
                                            <td className="px-2 py-2 text-right tabular-nums">
                                                {refundPrice(item) < Number(item.unit_price || 0) - 0.005
                                                    ? <><span className="block text-[10px] text-[#75657E] line-through">{peso(Number(item.unit_price || 0))}</span>{peso(refundPrice(item))}</>
                                                    : peso(Number(item.unit_price || 0))}</td>
                                            <td className="px-2 py-2 text-center tabular-nums">{reserved}</td>
                                            <td className="px-2 py-2 text-center">
                                                <input type="number" min={0} max={reserved} value={used} disabled={submitting}
                                                       aria-label={`Used quantity of ${label}`}
                                                       onChange={(event) => onChangeUsedQty(itemId, Math.max(0, Math.min(Number(event.target.value || 0), reserved)))}
                                                       className="h-9 w-20 rounded-lg border border-[#D8CBE7] bg-white px-2 text-center text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-2 focus:ring-[#2B174C]/10 disabled:opacity-60"/>
                                            </td>
                                            <td className="px-2 py-2 text-center font-semibold tabular-nums text-[#138342]">{Math.max(reserved - used, 0)}</td>
                                            <td className="px-4 py-2 text-right font-semibold tabular-nums">{peso(used * refundPrice(item))}</td>
                                        </tr>;
                                    })}</tbody>
                                    <tfoot><tr className="border-t-2 border-[#E6DDF0] bg-[#FBF8FF]">
                                        <td colSpan={5} className="px-4 py-2 text-right font-bold">Products already used</td>
                                        <td className="px-4 py-2 text-right font-bold tabular-nums">{peso(usedValue)}</td>
                                    </tr></tfoot>
                                </table>
                            </div>
                        </section>
                    )}
                    {showRefund && impact && (
                        <section aria-label="Refund on cancellation" className="mb-4 rounded-xl border border-[#D6C4F8] bg-white p-4 text-xs text-[#2B174C]">
                            <div className="flex items-start gap-3">
                                {hasReservedItems && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2B174C] text-[11px] font-bold text-white">2</span>}
                                <div>
                                    <h3 className="text-sm font-bold">Refund to customer</h3>
                                    <p className="mt-0.5 leading-5 text-[#806A8C]">{hasReservedItems
                                        ? <>The store keeps whichever is <strong>bigger</strong>: the down payment ({peso(downPayment)}) or the products already used ({peso(usedValue)}). The rest is refunded.</>
                                        : <>The store keeps the down payment ({peso(downPayment)}). The rest is refunded.</>}</p>
                                </div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                <span>Booking payments received</span><strong className="text-right">{peso(refundable)}</strong>
                                <span>Down payment (non-refundable)</span><strong className="text-right">{peso(downPayment)}</strong>
                                {hasReservedItems && <><span>Products already used (step 1)</span><strong className="text-right">{peso(usedValue)}</strong></>}
                                <span>{hasReservedItems ? (usedValue > downPayment ? "Store keeps (products used is bigger)" : "Store keeps (down payment is bigger)") : "Store keeps (the down payment)"}</span><strong className="text-right">{peso(storeKeepsSuggested)}</strong>
                                <span className="font-semibold">Suggested refund</span><strong className="text-right">{peso(suggestedRefund)}</strong>
                            </div>
                            {refundable > 0.005 && <label className="mt-3 block font-semibold text-[#4E2C66]">
                                Booking payment to refund
                                <input type="number" min={0} max={refundable} step="0.01" inputMode="decimal" value={refundText}
                                       disabled={submitting} onChange={e => { setRefundText(e.target.value); setRefundTouched(true); }}
                                       className="mt-1 h-10 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#6C3AD6]"/>
                                <span className="mt-1 block font-normal leading-5 text-[#806A8C]">
                                    {hasReservedItems
                                        ? <>Amount paid minus the larger of the down payment or the products already used
                                            {hasRentalLines ? " (rental equipment is not counted: it goes back to stock)" : ""}.</>
                                        : hasRentalLines
                                            ? "Rental equipment is not used up: it goes back to stock and the dates are freed, so the store keeps only the down payment."
                                            : "Nothing has been reserved or used yet, so the store keeps only the down payment."}
                                    {" "}You can change it, for example a full refund if the store cancelled. Maximum {peso(refundable)}.
                                </span>
                                {refundTouched && Number(refundText) !== suggestedRefund && <button type="button" disabled={submitting}
                                                                                                    onClick={() => setRefundTouched(false)}
                                                                                                    className="mt-1 text-xs font-semibold text-[#6335BC] hover:underline">Use suggested refund ({peso(suggestedRefund)})</button>}
                                {!refundValid && <span role="alert" className="mt-1 block font-semibold text-red-700">Enter an amount from ₱0 to {peso(refundable)} (up to two decimals).</span>}
                            </label>}
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#EFE7F4] pt-3">
                                {refundable > 0.005 && <><span>Kept by the store</span><strong className="text-right">{peso(Math.max(0, refundable - (refundValid ? refundValue : 0)))}</strong></>}
                                {depositBack > 0.005 && <><span>Security deposit refunded (automatic)</span><strong className="text-right">{peso(depositBack)}</strong></>}
                                <span className="font-bold">Total to give back</span><strong className="text-right text-[#138342]">{peso(totalBack)}</strong>
                            </div>
                            {totalBack > 0.005 && <>
                                <label className="mt-3 block font-semibold text-[#4E2C66]">Refund method
                                    <select value={refundMethod} onChange={e => setRefundMethod(e.target.value)} disabled={submitting}
                                            className="mt-1 h-10 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm text-[#1A1220]">
                                        <option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank transfer</option>
                                    </select>
                                </label>
                                <label className="mt-3 flex items-start gap-2 leading-5 text-[#4D3A60]">
                                    <input type="checkbox" checked={refundVerified} onChange={e => setRefundVerified(e.target.checked)} disabled={submitting} className="mt-1"/>
                                    I have given {peso(totalBack)} back to the customer.
                                </label>
                            </>}
                        </section>
                    )}
                    {!rejecting && impact && hasRentalLines && (
                        <section aria-label="Rental cancellation impact" className="mb-4 rounded-xl border border-[#D6C4F8] bg-[#FAF8FF] p-4 text-xs text-[#2B174C]">
                            <h3 className="text-sm font-bold">Rental equipment</h3>
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                <span>Reserved equipment</span><strong className="text-right">{reservedRentals}</strong>
                                <span>Handed over</span><strong className="text-right">{checkedOutRentals}</strong>
                                <span>Returned</span><strong className="text-right">{returnedRentals}</strong>
                                <span>After cancelling</span>
                                <strong className="text-right">{rentalCancellationBlocked ? "Can't cancel" : reservedRentals > 0 ? "Equipment is freed" : "Nothing reserved"}</strong>
                            </div>
                            <p className={`mt-3 border-t pt-3 leading-5 ${rentalCancellationBlocked ? "border-red-200 text-red-700" : "border-[#E6DDF0] text-[#655478]"}`}>
                                {rentalCancellationBlocked
                                    ? "The equipment was already handed over, so this booking can't be cancelled. Use the return and settlement steps instead."
                                    : "Cancelling frees the reserved equipment for these dates."}
                            </p>
                        </section>
                    )}
                    <div className="mt-4 space-y-2 rounded-xl border border-[#E6DDF0] bg-white p-4">
                        <label htmlFor="cancel-booking-reason" className="block text-sm font-semibold text-[#2B174C]">{rejecting?'Rejection reason':'Cancellation reason'} <span className="text-red-600">*</span></label>
                        <textarea id="cancel-booking-reason" rows={2} maxLength={500} value={reason}
                                  onChange={event => setReason(event.target.value)} disabled={submitting}
                                  placeholder={rejecting?'Explain why this booking request was declined.':'Explain why the booking is being cancelled.'}
                                  className="w-full rounded-xl border border-[#D8CBE7] p-3 text-sm outline-none focus:border-[#6C3AD6]" />
                        <p className="text-xs text-[#806A8C]">Saved in the booking history.</p>
                        {!rejecting && <label className="flex items-start gap-2 border-t border-[#EFE7F4] pt-3 text-xs leading-5 text-[#4D3A60]">
                            <input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={submitting||loading||!impact} className="mt-1"/>
                            I reviewed the items and the refund above.
                        </label>}
                    </div>
                    {error && (
                        <div className="mt-4 rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-sm font-semibold text-[#C32F2F]">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-[#EFE7F4] bg-[#FFFDF8] px-5 py-4 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:opacity-60"
                    >
                        Back
                    </button>

                    <button
                        type="button"
                        onClick={() => onConfirm(reason.trim(), rejecting ? undefined : {
                            amount: refundable > 0.005 ? Math.round(refundValue * 100) / 100 : 0, method: refundMethod, verified: refundVerified })}
                        disabled={loading || submitting || !impact || reason.trim().length < 5 || (!rejecting&&!acknowledged) || (!rejecting&&!refundReady) || rentalCancellationBlocked || (rejecting?!impact.eligibleForReject:!impact.eligibleForCancel)}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Processing..." : rejecting?"Confirm Rejection":"Confirm Cancellation"}
                    </button>
                </div>
            </div>
        </div>
    );
}
