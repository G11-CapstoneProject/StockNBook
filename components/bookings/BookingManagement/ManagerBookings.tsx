"use client";

import { getNextStatusConfig } from './_shared';
import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    AlertCircle,
    CheckCircle2,
    ClipboardCheck,
    Download,
    PackageCheck,
    RefreshCw,
    Search,
    Wallet,
    X,
} from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
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
        "Phone", "Email", "Booking Type", "Event Date", "Event Time", "Event Type",
        "Theme", "Venue", "Booking Status", "Payment Status", "Agreed Price (PHP)",
        "Required Down Payment (PHP)", "Amount Paid (PHP)", "Remaining Balance (PHP)",
        "Custom Request", "Notes",
    ];
    const data: Array<Array<string | number>> = bookings.map(b => [
        context.storeName, context.storeId, getBranchGroupName(b) === "Unassigned Branch" ? context.branchName : getBranchGroupName(b),
        String(b.branchId ?? b.branch_id ?? context.branchId), b.bookingReference || `#${b.id}`,
        b.name || "", b.phone || "", b.email || "", getManagerBookingTypeLabel(b), dateKey(b.date),
        b.eventTime || b.event_time || "", b.eventType || b.event_type || "", b.theme || "",
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
        const maxChars = 112;
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
            ["Booking type", getManagerBookingTypeLabel(b)],
            ["Booking branch", getBranchGroupName(b) === "Unassigned Branch" ? context.branchName : getBranchGroupName(b)],
            ["Event date", formatDate(b.date)], ["Event time", b.eventTime || b.event_time || "-"],
            ["Event type", b.eventType || b.event_type || "-"],
            ["Theme", b.theme || "-"], ["Venue", b.venue || "-"],
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
                b.bookingReference || `#${b.id}`, b.name, getManagerBookingTypeLabel(b),
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
    inventory_status?: string;
};

type CancelUsedItem = {
    booking_item_id: number;
    used_quantity: number;
};

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
                ? "Not enough consumable items are available for this booking. Check the available stock and the booking inclusions before trying again."
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
    const [listExportOpen, setListExportOpen] = useState(false);
    const [priceModal, setPriceModal] = useState<Booking | null>(null);
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

            const data = await res.json();

            if (!res.ok || data.success === false) {
                console.error("Bookings load failed:", data);
                setBookings([]);
                return [];
            }

            const normalizedBookings = (data.bookings || []).map(
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
        noDpReason?: string
    ): Promise<boolean> {

        const token = getToken();
        const branchId = getBranchId();

        const booking = bookings.find((b) => b.id === id);
        if (!booking) return false;

        const cleanStatus = normalizeStatus(newStatus);
        const oldStatus = normalizeStatus(booking.status);
        if (cleanStatus !== "Cancelled" &&
            !(oldStatus === "Pending Review" && cleanStatus === "Awaiting Down Payment") &&
            !(oldStatus === "Pending Review" && cleanStatus === "Confirmed" &&
                getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10) &&
            !(oldStatus === "Awaiting Down Payment" && cleanStatus === "Confirmed")) {
            setBookingActionError("Only Staff may advance preparation, release and completion. Managers approve and confirm bookings.");
            return false;
        }
        if (cleanStatus === "Confirmed" && !(oldStatus === "Pending Review" && getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10)) {
            const needed = getRequiredDownPayment(booking) > 0 ? getRequiredDownPayment(booking) : getTotalPrice(booking);
            if (getTotalPrice(booking) <= 0 || getAmountPaid(booking) + 0.005 < needed) {
                setBookingActionError("Verify the required down payment (or full price when no down payment is required) before confirming.");
                return false;
            }
        }

        // Allow cancel anytime except completed/cancelled
        if (cleanStatus === "Cancelled") {
            const currentStatus = normalizeStatus(booking.status);

            if (["Released", "Completed", "Cancelled"].includes(currentStatus)) {
                console.warn("Cannot cancel completed or already cancelled booking.");
                return false;
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
            showBookingToast("success", isManagerApproval ? "Booking approved successfully" : "Booking status updated successfully",
                `${booking.bookingReference || `Booking #${id}`} is now ${getManagerBookingStatusLabel(cleanStatus)}.`);
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
        const token = getToken();
        const branchId = getBranchId();

        setCancelModal(booking);
        setCancelItems([]);
        setCancelUsedQty({});
        setCancelError("");
        setCancelLoading(true);

        try {
            const body: Record<string, unknown> = {
                action: "get_booking_items",
                booking_id: booking.id,
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

            if (!res.ok || data.success === false) {
                throw new Error(data.message || data.error || "Failed to load booking items.");
            }

            const items = Array.isArray(data.items) ? data.items : [];

            setCancelItems(items);

            const initialUsed: Record<number, number> = {};
            items.forEach((item: BookingInventoryItem) => {
                initialUsed[Number(item.id)] = 0;
            });

            setCancelUsedQty(initialUsed);
        } catch (err) {
            console.error("Failed to load booking items:", err);
            setCancelError("Failed to load booking items. Please try again.");
        } finally {
            setCancelLoading(false);
        }
    }

    async function confirmCancelBooking() {
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

            await updateStatus(cancelModal.id, "Cancelled", undefined, usedItems);

            setCancelModal(null);
            setCancelItems([]);
            setCancelUsedQty({});
        } catch (err) {
            console.error("Failed to cancel booking:", err);
            setCancelError("Failed to cancel booking. Please check the used quantities and try again.");
        } finally {
            setCancelSubmitting(false);
        }
    }

    async function updateCustomPaymentTerms(
        booking: Booking,
        agreedPrice: number,
        requiredDownPayment: number,
        refundableDeposit: number,
        depositWaiverReason: string
    ) {
        const latest = bookings.find(b => b.id === booking.id) ?? booking;
        if (normalizeStatus(latest.status) !== "Pending Review" || latest.approvalStatus === "approved") {
            throw new Error("Booking price and payment terms are locked after approval.");
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
                throw new Error("Security deposit was not verified as saved. The booking API must persist refundable_deposit per booking in update_price, then return it as depositRequired in the financial statement. The price or DP may have saved; refresh and verify before approving.");
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
        depositWaiverReason: string
    ) {
        if (!priceModal) return;
        // Let PriceModal show any API/persistence error without closing the editor.
        await updateCustomPaymentTerms(priceModal, agreedPrice, requiredDownPayment, refundableDeposit, depositWaiverReason);
        setPriceModal(null);
    }

    // Persist the ACTUAL amount received rather than silently assigning the
    // required deposit or full balance. update_payment expects the cumulative
    // amount_paid (the same existing API contract as before).
    async function saveRecordedPayment(receivedNow: number) {
        if (!paymentModal || paymentSaving) return;
        const booking = bookings.find(item => item.id === paymentModal.id) ?? paymentModal;
        const total = getTotalPrice(booking);
        const currentPaid = getAmountPaid(booking);
        const remainingCents = Math.round((total - currentPaid) * 100);
        const receivedCents = Math.round(receivedNow * 100);
        if (!Number.isFinite(receivedNow) || receivedCents <= 0 ||
            receivedCents > remainingCents || Math.abs(receivedNow * 100 - receivedCents) > 0.001) {
            setPaymentError("Enter a valid amount greater than ₱0.00 and no more than the remaining balance.");
            return;
        }
        const token = getToken();
        if (!token) { setPaymentError("Please sign in again before recording payment."); return; }
        const newAmountPaid = Math.round(currentPaid * 100 + receivedCents) / 100;
        const newBalance = Math.max(0, Math.round(total * 100 - Math.round(newAmountPaid * 100)) / 100);
        const requiredDp = getRequiredDownPayment(booking);
        const status = newBalance <= 0
            ? "Fully Paid"
            : requiredDp > 0 && newAmountPaid + 0.005 >= requiredDp
                ? "Down Payment Paid"
                : "Partial";
        setPaymentSaving(true);
        setPaymentError("");
        try {
            const body: Record<string, unknown> = {
                action: "update_payment",
                booking_id: booking.id,
                amount_paid: newAmountPaid,
                balance: newBalance,
                payment_status: status,
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
                throw new Error(result.error || result.message || "Failed to record payment.");
            }
            // Money received is not the same thing as Manager confirming inventory.
            updateLocalBooking(booking.id, {
                amount_paid: newAmountPaid, amountPaid: newAmountPaid,
                balance: newBalance, payment_status: status, paymentStatus: status,
            });
            setPaymentModal(null);
            setBookingActionError("");
            await loadBookings();
            showBookingToast("success", "Customer payment recorded successfully",
                `${peso(receivedNow)} received for ${booking.bookingReference || booking.name}. Booking confirmation remains separate.`);
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
            .filter((booking) => bookingType === "All" || getManagerBookingTypeLabel(booking) === bookingType)
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

    const bookingTypes = ["Custom", "Package"] as const;

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
                {/* Four booking totals — match Manager Dashboard's white metric cards. */}
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {([
                        { status: "Pending Review" as FilterType, title: "Pending Review", sub: "Requests to review", icon: <ClipboardCheck size={24} />, iconStyle: "bg-[#FFF0E5] text-[#E66B20]" },
                        { status: "Awaiting Down Payment" as FilterType, title: "Approved", sub: "Approved, awaiting down payment", icon: <Wallet size={24} />, iconStyle: "bg-[#F1EBFF] text-[#6D35D4]" },
                        { status: "Confirmed" as FilterType, title: "Confirmed", sub: "Secured bookings", icon: <BadgeCheck size={24} />, iconStyle: "bg-[#E6F7EE] text-[#159455]" },
                        { status: "Preparing" as FilterType, title: "Preparing", sub: "Items being prepared", icon: <PackageCheck size={24} />, iconStyle: "bg-[#EAF1FF] text-[#2563EB]" },
                    ]).map((metric) => (
                        <button
                            type="button"
                            key={metric.status}
                            onClick={() => { setFilter(metric.status); setApprovalOnly(false); }}
                            aria-pressed={filter === metric.status && !approvalOnly}
                            className={`flex min-h-[116px] w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm transition hover:border-[#D7C9E3] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#D9C6F5] ${filter === metric.status && !approvalOnly ? "border-[#A68BCB] ring-1 ring-[#D9C6F5]" : ""}`}
                        >
                            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${metric.iconStyle}`}>
                                {metric.icon}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{metric.title}</span>
                                <span className="mt-1 block text-[28px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                                    {counts[metric.status].toLocaleString("en-PH")}
                                </span>
                                <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{metric.sub}</span>
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
                                    <h2 className="text-lg font-bold text-[#25143F]">Booking List</h2>
                                </div>
                                <div className="relative shrink-0">
                                    <button type="button" aria-label="Export booking list" title="Export booking list" onClick={() => setListExportOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9C9EB] text-[#43217A] hover:bg-[#F3EEFF]"><Download size={17}/></button>
                                    {listExportOpen && <div className="absolute right-0 top-10 z-30 w-40 rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-xl">
                                        <button type="button" onClick={() => {exportBookings(filtered,"pdf");setListExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download PDF</button>
                                        <button type="button" onClick={() => {exportBookings(filtered,"excel");setListExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download Excel (.xlsx)</button>
                                    </div>}
                                </div>
                            </div>
                            <label className="relative block">
                                <span className="sr-only">Search bookings</span>
                                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#957CAB]"/>
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search booking ID, customer name, or contact..." className="h-10 w-full rounded-xl border border-[#E4D9EF] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#7648DC] focus:ring-2 focus:ring-[#7648DC]/10" />
                            </label>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
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
                            </div>
                            {(search || filter !== "All" || approvalOnly || bookingType !== "All" || dateFrom || dateTo) && <div className="flex justify-end"><button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#6335BC] hover:underline">Clear filters</button></div>}
                        </div>}
                        onExportSelected={(b,type)=>exportBookings([b],type,true)}
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
                            if (normalizeStatus(b.status) !== "Pending Review" || b.approvalStatus === "approved") {
                                setBookingActionError("Custom price and down payment are locked after approval.");
                                return;
                            }
                            setPriceModal(b);
                        } : undefined}
                        onRecordDownPayment={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onMarkFullyPaid={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onCancelBooking={canManage ? openCancelModal : undefined}
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
                        else setApprovalError("Approval was not completed. Check the notification and try again.");
                    } finally { setApprovalSaving(false); }
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
    const [policyDeposit, setPolicyDeposit] = useState<number | null>(null);
    const [depositPolicy, setDepositPolicy] = useState<'required'|'optional'|'none'|null>(null);
    const [waiverSaved, setWaiverSaved] = useState(false);
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
                const policyResponse = await fetch("/api/bookings",{method:"POST",
                    headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
                    body:JSON.stringify({action:"get_booking_fee_policy",branchId:Number(booking.branchId||booking.branch_id)})});
                const [data, itemsData, policyData] = await Promise.all([response.json(), itemsResponse.json(),policyResponse.json()]);
                const deposit = Number(data.statement?.depositRequired);
                if (!response.ok || data.error || data.statement?.depositRequired == null || !Number.isFinite(deposit) ||
                    !itemsResponse.ok || itemsData.error || !policyResponse.ok || policyData.error ||
                    !Number.isFinite(Number(policyData.policy?.refundableDeposit)) ||
                    !['required','optional','none'].includes(policyData.policy?.depositPolicy) ||
                    !Array.isArray(itemsData.rentalItems) || !Array.isArray(data.statement?.rentalItems))
                    throw new Error(data.error || itemsData.error || "Security deposit or rental items are unavailable.");
                if (!cancelled) {
                    setDepositRequired(Math.max(0, deposit));
                    setHasRental(itemsData.rentalItems.length > 0 || data.statement.rentalItems.length > 0);
                    setPolicyDeposit(Number(policyData.policy.refundableDeposit));
                    setDepositPolicy(policyData.policy.depositPolicy as 'required'|'optional'|'none');
                    setWaiverSaved(String(data.statement.depositWaiverReason||"").trim().length>=10);
                }
            } catch (error) {
                if (!cancelled) setDepositError(error instanceof Error ? error.message : "Unable to read deposit terms.");
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);
    function submit() {
        if (depositRequired === null) {
            setValidation("Load the refundable security deposit before approving the quotation.");
            return;
        }
        if (hasRental === null || policyDeposit === null || depositPolicy === null) {
            setValidation("Booking rental items and deposit policy must be verified first.");
            return;
        }
        if(hasRental && depositPolicy==='required'){
            if(policyDeposit<=0){setValidation('Owner must set a positive rental-deposit minimum for this branch.');return;}
            if(depositRequired >= 0 && depositRequired < policyDeposit &&
                !(depositRequired===0 && waiverSaved)){
                setValidation('Save a compliant rental security deposit or a documented Manager waiver in Payment Terms first.');return;
            }
        }
        if(hasRental && depositPolicy==='none' && depositRequired > 0){
            setValidation('The Owner policy does not collect rental deposits. Review Payment Terms.');return;
        }
        if (getRequiredDownPayment(booking)===0 && noDpReason.trim().length<10){
            setValidation("Explain the Manager-authorized no-down-payment confirmation (at least 10 characters)."); return;
        }
        if (!agreed) {
            setValidation("Confirm that the manager and customer agreed on the payment terms.");
            return;
        }
        if (getTotalPrice(booking) <= 0 || getRequiredDownPayment(booking) > getTotalPrice(booking)) {
            setValidation("Set a valid agreed price and a down payment no greater than the booking price before approving.");
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
                <div className="flex justify-between gap-3"><span>Refundable Security Deposit</span><strong>{depositRequired === null ? "Loading…" : peso(depositRequired)}</strong></div>
                {hasRental && depositPolicy==='required' &&
                    <p className="text-xs text-[#806A8C]">{(policyDeposit??0)<=0
                        ? 'Owner must configure the required rental deposit before approval.'
                        : depositRequired===0 && waiverSaved
                            ? 'Documented Manager deposit waiver saved; customer liability terms still apply.'
                            : `Owner-required rental deposit minimum: ${peso(policyDeposit!)}. Collected separately before equipment release.`}</p>}
                {hasRental && depositPolicy==='optional' && <p className="text-xs text-[#806A8C]">Optional under branch policy; the Manager has agreed the amount shown above.</p>}
                {hasRental && depositPolicy==='none' && <p className="text-xs text-[#806A8C]">No deposit required under this branch's policy.</p>}
                {depositError && <p role="alert" className="text-xs text-red-600">{depositError}</p>}
            </div>
            {getRequiredDownPayment(booking)===0 && <label className="mt-4 block text-xs font-medium text-[#4F4162]">
                Manager no-down-payment authorization reason (10+ characters)
                <textarea value={noDpReason} onChange={e=>setNoDpReason(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-lg border border-[#E2D6EF] p-2" maxLength={500}/>
                <span className="mt-1 block font-normal text-[#806A8C]">Approval directly confirms/reserves a zero-DP booking; all remaining booking charges must still be paid before release.</span>
            </label>}
            <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#4F4162]">
                <input type="checkbox" checked={agreed} onChange={e=>{setAgreed(e.target.checked);setValidation("");}} disabled={busy} className="mt-1 accent-[#673DC8]"/>
                <span>I confirm that the customer agrees to the final booking price, required down payment, and separate refundable security deposit.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-[#816E93]">{getRequiredDownPayment(booking)===0
                ? "With the documented no-DP exception, Manager approval also confirms and reserves this booking. Full booking payment is still required before release."
                : "Approval records the agreed terms but does not reserve inventory until the required payment is verified and confirmation is completed."} Payment terms are locked after approval.</p>
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{validation || error}</p>}
            <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-[#E2D6EF] px-4 py-2.5 text-sm font-semibold text-[#47246E]">Back</button>
                <button type="button" disabled={busy || !agreed || depositRequired === null || hasRental === null || policyDeposit === null || depositPolicy === null ||
                    (hasRental && depositPolicy==='required' &&
                        (policyDeposit<=0 || (depositRequired<policyDeposit && !(depositRequired===0 && waiverSaved)))) ||
                    (hasRental && depositPolicy==='none' && depositRequired>0) ||
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
    onSave: (actualReceived: number) => void | Promise<void>;
}) {
    const balance = getBalance(booking);
    const paid = getAmountPaid(booking);
    const required = getRequiredDownPayment(booking);
    const [amount, setAmount] = useState("");
    const [verified, setVerified] = useState(false);
    const [validation, setValidation] = useState("");
    function save() {
        const value = Number(amount);
        if (amount.trim() === "" || !Number.isFinite(value) || value <= 0 || value > balance + 0.001 || Math.round(value*100)/100 !== value) {
            setValidation("Enter the actual received amount in pesos, up to the remaining balance, using at most two decimal places.");
            return;
        }
        if (!verified) {setValidation("Confirm that you checked the payment before saving.");return;}
        setValidation("");
        void onSave(value);
    }
    return <div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6">
        <div role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#E7D9F2] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2"><h2 id="payment-modal-title" className="text-lg font-bold text-[#26153F]">Record Customer Payment</h2><button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="rounded-lg p-1.5 hover:bg-[#F5F0FC]"><X size={19}/></button></div>
            <p className="mt-1 text-sm text-[#78698D]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
            <div className="mt-4 space-y-2 rounded-xl border border-[#E9E0EF] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Agreed Price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                <div className="flex justify-between gap-3"><span>Amount Already Paid</span><strong>{peso(paid)}</strong></div>
                <div className="flex justify-between gap-3"><span>Required Down Payment</span><strong>{peso(required)}</strong></div>
                <div className="flex justify-between gap-3 border-t pt-2"><span>Remaining Balance</span><strong className="text-[#492193]">{peso(balance)}</strong></div>
            </div>
            <label htmlFor="actual-customer-payment" className="mt-4 block text-sm font-semibold text-[#24143C]">Amount Actually Received (₱) <span className="text-red-500">*</span></label>
            <input id="actual-customer-payment" type="number" required min="0.01" max={balance} step="0.01" inputMode="decimal" placeholder="0.00" value={amount}
                   onChange={e=>{setAmount(e.target.value);setValidation("");}} disabled={busy} autoFocus
                   className="mt-1.5 h-11 w-full rounded-xl border border-[#D9C6E9] bg-white px-4 text-sm font-semibold outline-none focus:border-[#7140DC] focus:ring-2 focus:ring-[#7140DC]/15" />
            {amount && Number(amount)>0 && Number(amount)<=balance && <p className="mt-2 text-xs text-[#6A5888]">Balance after recording: {peso(Math.max(0, balance - Number(amount)))}</p>}
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E8DDF2] bg-[#FCFAFF] p-3 text-xs leading-5 text-[#49376A]">
                <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)} disabled={busy} className="mt-0.5 accent-[#6435BC]" />
                <span>I checked the actual payment in the bank, GCash, Maya, or cash records and confirm this amount was received.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-[#827393]">A partial amount stays partial until the required down payment is met. Saving payment does not confirm the booking; Manager confirmation remains a separate action.</p>
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{validation || error}</p>}
            <div className="mt-5 flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-[#D9C6E9] bg-white px-3 text-sm font-semibold text-[#352353] hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                <button type="button" disabled={busy || balance <= 0} onClick={save} className="min-h-11 flex-1 rounded-xl bg-[#432183] px-3 text-sm font-bold text-white hover:bg-[#30145F] disabled:opacity-50">{busy ? "Saving…" : "Save Payment"}</button></div>
        </div>
    </div>;
}

function CancelInventoryModal({
                                  booking,
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
    items: BookingInventoryItem[];
    usedQty: Record<number, number>;
    loading: boolean;
    submitting: boolean;
    error: string;
    onChangeUsedQty: (itemId: number, value: number) => void;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const reservedItems = items.filter(
        (item) => Number(item.reserved_quantity || 0) > 0
    );

    const hasReservedItems = reservedItems.length > 0;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 font-sans">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="border-b border-[#EFE7F4] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#806A8C]">
                        Cancel Booking
                    </p>

                    <h2 className="mt-1 text-xl font-bold text-[#1A1220]">
                        Record used items before cancelling
                    </h2>

                    <p className="mt-1 text-sm text-[#7A6A84]">
                        Booking #{booking.id} · {booking.name}
                    </p>
                </div>

                <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
                    {loading ? (
                        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-8 text-center text-sm text-[#806A8C]">
                            Loading booking items...
                        </div>
                    ) : !hasReservedItems ? (
                        <div className="rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-4 text-sm text-[#8A5A00]">
                            No reserved inventory was found for this booking. Cancelling will only update the booking status.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-sm text-[#4E2C66]">
                                Enter the quantity that was already used. Anything not used will be returned to inventory.
                            </div>

                            {reservedItems.map((item) => {
                                const itemId = Number(item.id);
                                const reserved = Number(item.reserved_quantity || 0);
                                const used = Math.max(
                                    0,
                                    Math.min(Number(usedQty[itemId] || 0), reserved)
                                );
                                const restored = Math.max(reserved - used, 0);
                                const label = item.variant_name
                                    ? `${item.product_name} — ${item.variant_name}`
                                    : item.product_name;

                                return (
                                    <div
                                        key={item.id}
                                        className="rounded-2xl border border-[#E6DDF0] bg-white p-4 shadow-sm"
                                    >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-[#1A1220]">
                                                    {label}
                                                </p>

                                                <p className="mt-1 text-xs text-[#7A6A84]">
                                                    Reserved: {reserved}
                                                </p>

                                                <p className="mt-1 text-xs font-semibold text-[#138342]">
                                                    Will return to inventory: {restored}
                                                </p>
                                            </div>

                                            <div className="w-full md:w-[180px]">
                                                <label className="text-xs font-semibold text-[#5F4E75]">
                                                    Used quantity
                                                </label>

                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={reserved}
                                                    value={used}
                                                    disabled={submitting}
                                                    onChange={(event) => {
                                                        const nextValue = Math.max(
                                                            0,
                                                            Math.min(Number(event.target.value || 0), reserved)
                                                        );

                                                        onChangeUsedQty(itemId, nextValue);
                                                    }}
                                                    className="mt-1 h-11 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm font-semibold text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:opacity-60"
                                                />

                                                <p className="mt-1 text-[11px] text-[#806A8C]">
                                                    Max: {reserved}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

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
                        onClick={onConfirm}
                        disabled={loading || submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Cancelling..." : "Confirm Cancellation"}
                    </button>
                </div>
            </div>
        </div>
    );
}