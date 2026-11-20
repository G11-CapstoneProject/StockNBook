"use client";

import {
    Building2, Calculator, CalendarDays, Check, ChevronDown, ChevronRight, CircleDollarSign,
    Download, Info, ReceiptText, Search, ShieldCheck, ShoppingBag, SlidersHorizontal,
    WalletCards, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UsePOSReturn } from "@/hooks/usePOS";
import { POSLayout, formatPOSOrderTime, peso, type Order } from "./_shared";

const fieldClass = "h-[42px] w-full min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm text-[#1A1220] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10";
const sourceLabel = (order: Order) =>
    order.salesSource === "BOOKING" || String(order.customerType || "").toUpperCase() === "BOOKING"
        ? "Booking" : "Walk-in";

// Shared period filter for Owner and Manager sales history. Dates are Philippine calendar dates.
type POSDatePeriod = "today" | "month" | "year" | "range";
const posDatePeriods: Array<{value: POSDatePeriod; label: string}> = [
    {value: "today", label: "Today"},
    {value: "month", label: "This Month"},
    {value: "year", label: "This Year"},
    {value: "range", label: "Date Range"},
];
const posManilaDate = () => new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date());
function posPresetDates(period: Exclude<POSDatePeriod, "range">, today: string): [string, string] {
    return [period === "month" ? `${today.slice(0, 7)}-01` : period === "year" ? `${today.slice(0, 4)}-01-01` : today, today];
}
export function usePOSDatePeriod(dateFrom: string, dateTo: string, setDateRange: (from: string, to: string) => void) {
    const [today, setToday] = useState(posManilaDate);
    const [period, setPeriod] = useState<POSDatePeriod>(() => {
        if (!dateFrom && !dateTo) return "today";
        for (const preset of ["today", "month", "year"] as const) {
            const [from, to] = posPresetDates(preset, today);
            if (dateFrom === from && dateTo === to) return preset;
        }
        return "range";
    });
    const [draftFrom, setDraftFrom] = useState(dateFrom || today);
    const [draftTo, setDraftTo] = useState(dateTo || today);
    useEffect(() => {
        const update = () => setToday(posManilaDate());
        const timer = window.setInterval(update, 15_000);
        window.addEventListener("focus", update);
        document.addEventListener("visibilitychange", update);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", update);
            document.removeEventListener("visibilitychange", update);
        };
    }, []);
    useEffect(() => {
        if (period === "range") return;
        const [from, to] = posPresetDates(period, today);
        if (dateFrom !== from || dateTo !== to) setDateRange(from, to);
    }, [period, today, dateFrom, dateTo, setDateRange]);
    const selectPeriod = (next: POSDatePeriod) => {
        const currentDay = posManilaDate();
        setToday(currentDay);
        setPeriod(next);
        if (next === "range") {
            setDraftFrom(dateFrom || currentDay);
            setDraftTo(dateTo || currentDay);
        } else {
            const [from, to] = posPresetDates(next, currentDay);
            if (dateFrom !== from || dateTo !== to) setDateRange(from, to);
        }
    };
    const validRange = /^\d{4}-\d{2}-\d{2}$/.test(draftFrom) && /^\d{4}-\d{2}-\d{2}$/.test(draftTo)
        && draftFrom <= draftTo;
    const applyRange = () => {
        if (validRange) setDateRange(draftFrom, draftTo);
    };
    return {period, selectPeriod, draftFrom, draftTo, setDraftFrom, setDraftTo, validRange, applyRange, dateFrom, dateTo};
}
export function POSPeriodFilter({filter}: {filter: ReturnType<typeof usePOSDatePeriod>}) {
    const pending = filter.draftFrom !== filter.dateFrom || filter.draftTo !== filter.dateTo;
    return <>
        <FilterSelect icon={<CalendarDays size={15}/>} label="Sales period" value={filter.period}
                      onChange={value => filter.selectPeriod(value as POSDatePeriod)} options={posDatePeriods}/>
        {filter.period === "range" && (
            <div className="order-last col-span-full flex flex-wrap items-end gap-3 rounded-xl border border-[#E6DDF0] bg-[#FAF7FF] p-3" aria-label="Custom date range">
                <label className="min-w-[145px] flex-1 text-xs font-semibold text-[#5F4E75]">From
                    <input type="date" aria-label="From date" value={filter.draftFrom} max={filter.draftTo || undefined}
                           onChange={e => filter.setDraftFrom(e.target.value)} className={`${fieldClass} mt-1 block`}/>
                </label>
                <label className="min-w-[145px] flex-1 text-xs font-semibold text-[#5F4E75]">To
                    <input type="date" aria-label="To date" value={filter.draftTo} min={filter.draftFrom || undefined}
                           onChange={e => filter.setDraftTo(e.target.value)} className={`${fieldClass} mt-1 block`}/>
                </label>
                <button type="button" disabled={!filter.validRange} onClick={filter.applyRange}
                        className="h-[42px] rounded-xl bg-[#2B174C] px-4 text-xs font-semibold text-white transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
                {pending && <p className="w-full text-xs text-[#806A8C]" role="status">{filter.validRange ? "Apply to update the sales period." : "Select a valid start and end date."} {filter.dateFrom || filter.dateTo ? `Current: ${filter.dateFrom || "Any date"} to ${filter.dateTo || "Any date"}.` : "Current: All dates."}</p>}
            </div>
        )}
    </>;
}

function FilterSelect({ icon, label, value, onChange, options }: {
    icon: ReactNode; label: string; value: string; onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    return (
        <div className="relative min-w-0">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]">{icon}</span>
            <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
                    className={`${fieldClass} appearance-none pl-9 pr-8 font-medium`}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2B174C]" />
        </div>
    );
}

/** Internal, multi-page VAT transaction PDF. No new PDF dependency or source module. */
type OwnerVatExportRow = {
    orderId: string; date: string; createdAt?: string; branchName: string; salesSource: string;
    paymentMode: string; taxType: string; totalInclusive: number;
    vatableSales: number | null; outputVat: number | null; vatStatus: string;
};
type OwnerVatExport = {
    vatSummary?: {
        vatableSales: number; outputVat: number; customerTotal: number;
        coverage: string; coverageReason: string | null;
        unverifiedRecords: number;
    } | null;
    transactionSummary?: { count: number; totalSales: number };
    bookingIntegration?: { available: boolean };
    rows: OwnerVatExportRow[];
};

export function createVatReportPdf(data: OwnerVatExport, store: string, branch: string, dateFrom: string, dateTo: string, salesSource: string, taxRegistration: string): Blob {
    const isVatReport = taxRegistration === "VAT_REGISTERED";
    // PDF core fonts are WinAnsi. Compose ASCII-only content, so xref offsets
    // equal JavaScript string lengths. Do not print untrusted strings as PDF operators.
    const ascii = (value: unknown) => String(value ?? "").normalize("NFKD")
        .replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
    const esc = (value: unknown) => ascii(value)
        .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const money = (value: number | null | undefined) =>
        value == null || !Number.isFinite(Number(value)) ? "--" :
            `PHP ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const W = 842, H = 595; // Landscape A4 in PDF points.
    const pages: string[][] = [[]];
    let page = pages[0];
    let cursorY = 0;
    const push = (command: string) => { page.push(command); };
    const txt = (value: unknown, x: number, y: number, size = 9, bold = false, color = "0.20 0.14 0.29") => {
        push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(H - y).toFixed(2)} Tm (${esc(value)}) Tj ET`);
    };
    const line = (x1: number, y: number, x2: number, color = "0.88 0.84 0.92") =>
        push(`${color} RG 0.6 w ${x1} ${H - y} m ${x2} ${H - y} l S`);
    const rect = (x: number, y: number, w: number, h: number, color: string) =>
        push(`${color} rg ${x} ${H - y - h} ${w} ${h} re f`);
    const chunks = (value: unknown, max: number) => {
        const v = ascii(value);
        if (!v) return ["--"];
        const result: string[] = [];
        for (let i = 0; i < v.length; i += max) result.push(v.slice(i, i + max));
        return result;
    };
    const startPage = (first: boolean) => {
        rect(0, 0, W, 11, "0.18 0.09 0.31");
        txt(isVatReport ? "STOCKNBOOK  /  VAT TRANSACTION REPORT" : "STOCKNBOOK  /  SALES TRANSACTION REPORT", 30, 36, first ? 17 : 13, true);
        txt("INTERNAL REPORT - NOT A BIR TAX RETURN", 584, 36, 8, false, "0.42 0.32 0.53");
        line(30, 47, 812);
        if (first) {
            txt(`Store: ${store}`, 30, 63, 10, true);
            txt(`Branch: ${branch}`, 30, 78, 9);
            txt(`Period: ${dateFrom || "All dates"} to ${dateTo || "All dates"}`, 300, 78, 9);
            txt(`Source: ${salesSource}`, 644, 78, 9);
            rect(30, 91, 782, 59, "0.965 0.950 0.992");
            if (isVatReport) {
                const sums = data.vatSummary;
                txt("VATABLE SALES (recorded)", 43, 108, 8);
                txt(money(sums?.vatableSales), 43, 132, 13, true);
                txt("OUTPUT VAT (recorded)", 299, 108, 8);
                txt(money(sums?.outputVat), 299, 132, 13, true);
                txt("CUSTOMER TOTAL (incl. VAT)", 554, 108, 8);
                txt(money(sums?.customerTotal), 554, 132, 13, true);
                const reason = sums?.coverageReason || "Only recorded, verifiable VAT transactions are included.";
                txt(`Coverage: ${sums?.coverage || "UNKNOWN"}  |  Unverified records: ${sums?.unverifiedRecords ?? "--"}`, 30, 163, 8, true);
                chunks(reason, 140).slice(0, 2).forEach((part, i) => txt(part, 30, 178 + i * 11, 8));
                cursorY = 203;
            } else {
                txt("TOTAL RECORDED SALES", 43, 108, 8);
                txt(money(data.transactionSummary?.totalSales), 43, 132, 13, true);
                txt("TRANSACTIONS", 299, 108, 8);
                txt(String(data.transactionSummary?.count ?? data.rows.length), 299, 132, 13, true);
                txt("CURRENT REGISTRATION", 554, 108, 8);
                txt(taxRegistration === "NON_VAT" ? "Non-VAT Registered" : "Registration not verified", 554, 132, 12, true);
                txt(data.bookingIntegration?.available === false
                    ? "Booking records could not be verified; only known transactions are included."
                    : "Historical VAT and Non-VAT classifications are retained per transaction.", 30, 167, 8);
                cursorY = 181;
            }
        } else {
            txt(`Branch: ${branch}  |  ${dateFrom || "All dates"} to ${dateTo || "All dates"}  |  ${salesSource}`, 30, 64, 8);
            cursorY = 83;
        }
    };
    const positions = [30, 205, 335, 425, 485, 562, 620, 695, 755];
    const widths = [175, 130, 90, 60, 77, 58, 75, 60, 57];
    const headings = ["ORDER ID", "DATE / TIME", "BRANCH", "SOURCE", "PAYMENT", "TAX", "TOTAL incl.", "VATABLE", "OUTPUT VAT"];
    const tableHead = () => {
        rect(30, cursorY, 782, 23, "0.94 0.91 0.98");
        headings.forEach((heading, i) => txt(heading, positions[i] + 3, cursorY + 15, 7.1, true));
        cursorY += 23;
    };
    startPage(true);
    tableHead();
    if (!data.rows.length) txt("No matching transactions for the selected scope.", 35, cursorY + 24, 10);
    for (let n = 0; n < data.rows.length; n++) {
        const row = data.rows[n];
        const tax = String(row.taxType || "").toUpperCase();
        const cells = [
            ascii(row.orderId), ascii(row.salesSource.toLowerCase() === "booking" && !/[T ]\d{2}:\d{2}/.test(row.createdAt || "") ? `${row.date} (event date; time unknown)` : row.createdAt || row.date), ascii(row.branchName),
            ascii(row.salesSource), ascii(row.paymentMode).replace(/_/g, " "),
            tax === "VAT" ? "VAT" : tax === "NON_VAT" ? "Non-VAT" : tax,
            money(row.totalInclusive).replace("PHP ", ""),
            money(row.vatableSales).replace("PHP ", ""),
            money(row.outputVat).replace("PHP ", ""),
        ];
        const lines = cells.map((cell, i) => chunks(cell, Math.max(5, Math.floor((widths[i] - 8) / 3.5))));
        const rows = Math.max(...lines.map((parts) => parts.length));
        const rowHeight = Math.max(23, rows * 10 + 8);
        if (cursorY + rowHeight > H - 49) {
            page = [];
            pages.push(page);
            startPage(false);
            tableHead();
        }
        if (n % 2 === 0) rect(30, cursorY, 782, rowHeight, "0.986 0.981 0.994");
        lines.forEach((parts, i) => parts.forEach((part, k) => txt(part, positions[i] + 3, cursorY + 13 + 10 * k, 7, false)));
        cursorY += rowHeight;
        line(30, cursorY, 812, "0.93 0.91 0.96");
    }
    // Footer is always visible, including in reports spanning multiple pages.
    pages.forEach((commands, i) => {
        commands.push(`0.87 0.83 0.92 RG 0.6 w 30 34 m 812 34 l S`);
        const footer = `Generated ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })} | Page ${i + 1} of ${pages.length} | ${isVatReport ? "Output VAT only; input VAT and adjustments are excluded" : "Internal sales extract; not a tax return"}`;
        commands.push(`0.42 0.32 0.53 rg BT /F1 7.3 Tf 1 0 0 1 30 20 Tm (${esc(footer)}) Tj ET`);
    });
    // A complete PDF object/xref table for all pages, using only ASCII content.
    const objects: string[] = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "", // Filled with all page references after the streams are built.
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ];
    const references: string[] = [];
    pages.forEach((commands) => {
        const pageId = objects.length + 1;
        const streamId = pageId + 1;
        const stream = commands.join("\n") + "\n";
        references.push(`${pageId} 0 R`);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    });
    objects[1] = `<< /Type /Pages /Kids [${references.join(" ")}] /Count ${references.length} >>`;
    let contents = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((obj, i) => {
        offsets.push(contents.length);
        contents += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = contents.length;
    contents += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) contents += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    contents += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([contents], { type: "application/pdf" });
}

/** Database-backed transaction detail. Missing historical values remain null. */
export type BookingBilling = {
    bookingPaid: number; bookingRefunded: number; balance: number;
    depositRequired: number; depositCollected: number; depositApplied: number;
    depositRefunded: number; depositHeld: number; additionalCharges: number;
    chargePaid: number; claimBalance: number; settlementStatus: string | null;
};

export type OwnerOrderInvoice = {
    orderId: string;
    storeName: string;
    branchName: string;
    storeAddress?: string | null;
    branchAddress?: string | null;
    businessName?: string | null;
    tin?: string | null;
    salesSource: "WALK_IN" | "BOOKING";
    customerName: string;
    cashierName?: string | null;
    date: string;
    createdAt: string;
    paymentMode: string;
    taxType: string | null;
    vatAmount: number | null;
    vatableSales?: number | null;
    subtotal?: number | null;
    amountTendered?: number | null;
    changeDue?: number | null;
    paymentStatus?: string | null;
    total: number | null;
    bookingBilling?: BookingBilling;
    items: Array<{ name: string; quantity: number; unitPrice: number | null; lineTotal: number | null; included?: boolean }>;
    itemsAvailable: boolean;
    detailNotice: string | null;
    officialInvoiceNumber: null;
};

// Shared between Owner and Manager; booking payments and deposit settlement are separate from sales.
export function bookingBillingRows(b: BookingBilling): Array<[string, number]> {
    return [["Booking Payments", b.bookingPaid], ["Booking Refunds", b.bookingRefunded],
        ["Remaining Booking Balance", b.balance], ["Security Deposit Required", b.depositRequired],
        ["Security Deposit Collected", b.depositCollected], ["Additional Charges", b.additionalCharges],
        ["Deposit Applied", b.depositApplied], ["Additional Charge Payments", b.chargePaid],
        ["Deposit Refunded", b.depositRefunded], ["Remaining Deposit", b.depositHeld],
        ["Remaining Additional Charges", b.claimBalance]];
}
export function BookingBillingPreview({ billing }: { billing: BookingBilling }) {
    return <div className="mt-3 space-y-1 border-t border-[#E8DFF0] pt-3">
        <p className="font-bold text-[#2B174C]">Booking billing &amp; deposit settlement</p>
        {bookingBillingRows(billing).map(([label, amount]) => <p key={label} className="flex justify-between gap-4"><span className="text-[#806A8C]">{label}</span><strong>{peso(amount)}</strong></p>)}
        <p className="flex justify-between gap-4"><span className="text-[#806A8C]">Settlement Status</span><strong className="capitalize">{billing.settlementStatus?.replace(/_/g, " ") || "Not recorded"}</strong></p>
    </div>;
}
export function BookingFinancials({ order }: { order: Order }) {
    const values: Array<[string, number | null | undefined]> = [["Sales",order.total], ["Additional Charges",order.additionalCharges], ["Deposit Refunded",order.depositRefunded]];
    return <div className="min-w-0 space-y-0.5">{values.map(([label,value]) => <p key={label} className="flex flex-wrap items-center justify-between gap-x-2"><span className="text-[#806A8C]">{label}</span><strong className="whitespace-nowrap text-right">{value == null ? "—" : peso(value)}</strong></p>)}</div>;
}

/** Retrieve a fresh, role-scoped database record at download time. */
export async function fetchOrderInvoiceDetail(orderId: string, salesSource: "WALK_IN" | "BOOKING"): Promise<OwnerOrderInvoice> {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Please log in again to download the transaction.");
    const response = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "get_pos_invoice_detail", order_id: orderId, sales_source: salesSource }),
    });
    const data = await response.json() as { success?: boolean; detail?: OwnerOrderInvoice; error?: string };
    if (!response.ok || !data.success || !data.detail) {
        throw new Error(data.error || "Unable to retrieve invoice information. Check the POS backend integration.");
    }
    if (data.detail.orderId !== orderId || data.detail.salesSource !== salesSource) {
        throw new Error("The returned transaction does not match the requested order.");
    }
    return data.detail;
}

/** Shared printable invoice-style PDF. No new package dependency. */
export function createOrderInvoicePdf(detail: OwnerOrderInvoice): Blob {
    const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    if (!detail.itemsAvailable || !known(detail.total) || !detail.items.length || !detail.items.every(item =>
        item.name.trim() && known(item.quantity) && item.quantity > 0 && known(item.unitPrice) && known(item.lineTotal))) {
        throw new Error("Verified itemized information is required before exporting this order.");
    }
    const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim()
        .replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-")
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, ch => ch.normalize("NFKD").replace(/[^\x20-\x7E]/g, "") || "?");
    const escape = (v: unknown) => clean(v).replace(/[\\()\xA0-\xFF]/g, ch =>
        ch.charCodeAt(0) >= 160 ? `\\${ch.charCodeAt(0).toString(8).padStart(3, "0")}` : `\\${ch}`);
    const display = (v: unknown) => clean(v) || "Not recorded";
    const currency = (n: number | null | undefined) => known(n)
        ? `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Not recorded";
    // Standard PDF Helvetica metrics (WinAnsi), for accurate alignment and line wrapping.
    const regularWidths = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
    const boldWidths = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,761,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
    const width = (v: unknown, size: number, bold = false) => [...clean(v)].reduce((n, c) =>
        n + ((bold ? boldWidths : regularWidths)[c.charCodeAt(0) - 32] ?? 600), 0) * size / 1000;
    const wrap = (v: unknown, max: number, size: number, bold = false) => {
        const out: string[] = []; let current = "";
        for (const word of display(v).split(" ")) {
            if (current && width(`${current} ${word}`, size, bold) > max) { out.push(current); current = ""; }
            if (width(word, size, bold) > max) {
                for (const ch of word) {
                    if (current && width(current + ch, size, bold) > max) { out.push(current); current = ""; }
                    current += ch;
                }
            } else current = current ? `${current} ${word}` : word;
        }
        if (current) out.push(current);
        return out;
    };
    const W = 595.28, H = 841.89, L = 48, R = W - L, inner = R - L;
    const rgb = (hex: string) => [0, 2, 4].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(" ");
    const ink = rgb("1A1220"), purple = rgb("2B174C"), muted = rgb("5F4E75"), border = rgb("E6DDF0"), tint = rgb("F9F6FD"), cream = rgb("FDFAF4"), green = rgb("168A48");
    const pages: string[][] = []; let page: string[] = []; let y = 0;
    const rect = (x: number, top: number, w: number, h: number, fill: string) => page.push(`${fill} rg ${x} ${H - top - h} ${w} ${h} re f`);
    const text = (v: unknown, x: number, top: number, size = 11, bold = false, color = ink, align: "left" | "center" | "right" = "left") => {
        const shift = align === "left" ? 0 : width(v, size, bold) / (align === "center" ? 2 : 1);
        page.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${(x - shift).toFixed(2)} ${(H - top).toFixed(2)} Tm (${escape(v)}) Tj ET`);
    };
    const rule = (top: number) => page.push(`${border} RG 0.7 w ${L} ${H - top} m ${R} ${H - top} l S`);
    const centered = (v: unknown, size: number, bold = false, color = ink) => {
        for (const row of wrap(v, inner - 16, size, bold)) { text(row, W / 2, y, size, bold, color, "center"); y += size + 3; }
    };
    const formatDateTime = (raw: string) => {
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/);
        if (!match) return raw;
        const [, year, month, day, hour, minute] = match;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const date = `${months[Number(month) - 1] || month} ${Number(day)}, ${year}`;
        return hour == null ? date : `${date} | ${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? "PM" : "AM"}`;
    };
    const tax = String(detail.taxType || "").toUpperCase().replace(/-/g, "_");
    const isVat = ["VAT", "VAT_REGISTERED"].includes(tax);
    const isNonVat = ["NON_VAT", "NON_VAT_REGISTERED"].includes(tax);
    const payment = String(detail.paymentMode || "").toUpperCase();
    const paymentName = payment.includes(",") ? payment.split(",").map(method => ({ CASH: "Cash", GCASH: "GCash", BANK_TRANSFER: "Bank Transfer" } as Record<string,string>)[method] || method.replace(/_/g," ")).join(", ") : ({ CASH: "Cash", GCASH: "GCash", BANK_TRANSFER: "Bank Transfer" } as Record<string, string>)[payment] || display(detail.paymentMode).replace(/_/g, " ");
    const startPage = (first: boolean) => {
        page = []; pages.push(page);
        rect(0, 0, W, H, cream); rect(25, 24, W - 50, H - 48, "1 1 1"); rect(25, 24, W - 50, 6, purple);
        y = 57;
        if (first) {
            centered(detail.storeName, 23, true, purple);
            if (detail.businessName && detail.businessName !== detail.storeName) centered(detail.businessName, 11, false, muted);
            centered(`Branch: ${display(detail.branchName)}`, 12, true, purple);
            centered(detail.branchAddress || "Branch address not recorded", 11, false, muted);
            if (detail.storeAddress && detail.storeAddress !== detail.branchAddress) centered(`Store address: ${detail.storeAddress}`, 10, false, muted);
            centered(isVat ? "VAT Registered (recorded sale)" : isNonVat ? "Non-VAT Registered (recorded sale)" : "Tax classification not verified", 11, true, purple);
            y += 1; rule(y); y += 25;
            centered("SALES INVOICE", 24, true, purple);
            centered(`${detail.salesSource === "BOOKING" ? "Booking Reference" : "Order ID"}: ${detail.orderId}`, 12, true);
            centered("Internal transaction copy", 10, false, muted);
            y += 5;
            const fieldPair = (a: string, av: unknown, b: string, bv: unknown) => {
                const x2 = W / 2 + 12, cell = inner / 2 - 18;
                text(a, L, y, 9, true, muted); text(b, x2, y, 9, true, muted); y += 17;
                const aa = wrap(av, cell, 11), bb = wrap(bv, cell, 11);
                aa.forEach((s, i) => text(s, L, y + i * 15)); bb.forEach((s, i) => text(s, x2, y + i * 15));
                y += Math.max(aa.length, bb.length) * 15 + 6;
            };
            fieldPair(detail.salesSource === "BOOKING" ? (/[T ]\d{2}:\d{2}/.test(detail.createdAt || "") ? "Completed At" : "Completion Time") : "Date & Time", detail.salesSource === "BOOKING" && !/[T ]\d{2}:\d{2}/.test(detail.createdAt || "") ? "Not recorded" : formatDateTime(detail.createdAt || detail.date), detail.salesSource === "BOOKING" ? "Settlement Reviewed By" : "Cashier", detail.cashierName);
            fieldPair("Customer", detail.customerName, "Payment Method", paymentName);
            text(`Sales Source: ${detail.salesSource === "BOOKING" ? "Booking" : "Walk-in"}`, L, y, 10, false, muted); y += 16;
        } else {
            centered(detail.storeName, 17, true, purple);
            centered(`Order ID: ${detail.orderId} (continued)`, 11, false, muted); y += 8;
        }
    };
    const tableHead = () => {
        rect(L, y, inner, 29, tint);
        text("Item", L + 8, y + 19, 11, true, purple);
        text("Qty", 321, y + 19, 11, true, purple, "center");
        text("Price", 426, y + 19, 11, true, purple, "right");
        text("Total", R - 8, y + 19, 11, true, purple, "right"); y += 29; rule(y);
    };
    startPage(true);
    if (y > 650) throw new Error("Store header is too long for the PDF. Please shorten the saved address or name.");
    tableHead();
    for (const item of detail.items) {
        const lines = wrap(item.name, 240, 11); let offset = 0;
        while (offset < lines.length) {
            if (y + 34 > 725) { startPage(false); tableHead(); }
            const count = Math.max(1, Math.floor((725 - y - 12) / 15));
            const part = lines.slice(offset, offset + count), h = Math.max(29, part.length * 15 + 12);
            part.forEach((s, i) => text(s, L + 8, y + 18 + i * 15));
            if (offset === 0) {
                text(item.quantity, 321, y + 18, 10, false, ink, "center");
                text(item.included ? "Included" : currency(item.unitPrice), 426, y + 18, 10, false, ink, "right");
                text(item.included ? "Included" : currency(item.lineTotal), R - 8, y + 18, 10, true, ink, "right");
            }
            y += h; rule(y); offset += part.length;
        }
    }
    const sum = (label: string, value: unknown) => { text(label, L + 4, y, 11, false, muted); text(value, R - 4, y, 11, true, ink, "right"); y += 22; };
    const linesTotal = detail.items.reduce((n, item) => n + Number(item.lineTotal), 0);
    const hasDifference = Math.abs(linesTotal - detail.total) > .02 || (known(detail.subtotal) && Math.abs(detail.subtotal - detail.total) > .02);
    const status = String(detail.paymentStatus || "").trim().toUpperCase();
    const statusLabel = status === "PAID" ? "PAID" : status === "UNPAID" ? "UNPAID" : status === "PARTIAL" ? "PARTIALLY PAID" : "Not verified";
    // Keep the totals/payment block together; no fabricated historic amounts.
    const blockHeight = 207 + (isVat ? 44 : 0) + (payment === "CASH" ? 22 : 0) + (hasDifference ? 15 : 0);
    if (y + blockHeight > 746) startPage(false);
    y += 23;
    sum(known(detail.subtotal) ? "Subtotal" : "Itemized subtotal", currency(known(detail.subtotal) ? detail.subtotal : linesTotal));
    if (isVat) {
        sum("VATable Sales", currency(detail.vatableSales));
        sum("VAT Amount (recorded)", currency(detail.vatAmount));
    }
    rect(L, y - 5, inner, 45, tint); rule(y - 5);
    text("TOTAL AMOUNT", L + 8, y + 24, 15, true, purple);
    text(currency(detail.total), R - 8, y + 24, 19, true, purple, "right"); y += 52;
    if (hasDifference) { text("Itemized amounts and recorded total differ; review original transaction.", L + 4, y, 9, false, muted); y += 15; }
    if (detail.salesSource === "BOOKING") {
        sum("Booking Payments", currency(detail.bookingBilling?.bookingPaid));
        sum("Remaining Booking Balance", currency(detail.bookingBilling?.balance));
    } else {
        sum(payment === "CASH" ? "Cash Received" : "Amount Received", currency(detail.amountTendered));
        if (payment === "CASH") sum("Change", currency(detail.changeDue));
    }
    text("Payment Status", L + 4, y, 11, true, purple);
    text(statusLabel, R - 4, y, 11, true, status === "PAID" ? green : muted, "right"); y += 17;
    if (detail.salesSource === "BOOKING" && detail.bookingBilling) {
        // Keep settlement separate, and move to a new page if necessary.
        const rows = bookingBillingRows(detail.bookingBilling).filter(([label]) => !["Booking Payments", "Remaining Booking Balance"].includes(label));
        if (y + rows.length * 22 + 105 > 730) startPage(false);
        y += 12; rule(y); y += 23;
        text("BOOKING BILLING & DEPOSIT SETTLEMENT", L + 4, y, 12, true, purple); y += 24;
        for (const [label, amount] of rows) sum(label, currency(amount));
        sum("Settlement Status", display(detail.bookingBilling.settlementStatus).replace(/_/g, " "));
        if (y + 65 > 730) startPage(false);
    }
    rule(y); y += 24;
    centered("Thank you for your purchase!", 14, true, purple);
    centered("Powered by StockNBook", 10, false, muted);
    // Page footer remains on every page. Order reference is not an official invoice serial.
    pages.forEach((commands, index) => {
        page = commands;
        rule(758);
        text("Internal transaction copy - not a BIR-registered sales invoice", W / 2, 773, 9, false, muted, "center");
        text(`Page ${index + 1} of ${pages.length}`, W / 2, 788, 8, false, muted, "center");
    });
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
    const refs: string[] = [];
    pages.forEach(commands => {
        const pageId = objects.length + 1, streamId = pageId + 1, stream = commands.join("\n") + "\n";
        refs.push(`${pageId} 0 R`);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    });
    objects[1] = `<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${pages.length} >>`;
    let result = "%PDF-1.4\n"; const offsets = [0];
    objects.forEach((obj, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${obj}\nendobj\n`; });
    const xref = result.length;
    result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) result += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([result], { type: "application/pdf" });
}

function TransactionTable({ pos, orders, branchName }: {
    pos: UsePOSReturn; orders: Order[]; branchName: (order: Order) => string;
}) {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
    const [details, setDetails] = useState<Record<string, OwnerOrderInvoice>>({});
    const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
    const grid = "grid min-w-[1050px] grid-cols-[minmax(235px,1.5fr)_minmax(155px,0.9fr)_minmax(135px,0.8fr)_minmax(105px,0.7fr)_minmax(160px,0.95fr)] gap-3";
    const total = pos.ownerOrderTotal;
    const orderKey = (order: Order) => `${sourceLabel(order) === "Booking" ? "BOOKING" : "WALK_IN"}:${order.id}`;

    const loadDetail = async (order: Order, key: string): Promise<OwnerOrderInvoice | null> => {
        if (details[key]) return details[key];
        setLoadingKey(key);
        setDetailErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Please log in again to view order details.");
            const response = await fetch("/api/pos", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "get_owner_order_detail",
                    order_id: order.id,
                    sales_source: sourceLabel(order) === "Booking" ? "BOOKING" : "WALK_IN",
                }),
            });
            const data = await response.json() as { success?: boolean; detail?: OwnerOrderInvoice; error?: string };
            if (!response.ok || !data.success || !data.detail) {
                throw new Error(data.error || "Unable to load this order's items.");
            }
            setDetails(prev => ({ ...prev, [key]: data.detail! }));
            return data.detail;
        } catch (error) {
            setDetailErrors(prev => ({
                ...prev, [key]: error instanceof Error ? error.message : "Unable to load this order.",
            }));
            return null;
        } finally {
            setLoadingKey(current => current === key ? null : current);
        }
    };

    const toggleOrder = (order: Order) => {
        const key = orderKey(order);
        if (expandedKey === key) { setExpandedKey(null); return; }
        setExpandedKey(key);
        if (!details[key]) void loadDetail(order, key);
    };

    const downloadInvoice = async (detail: OwnerOrderInvoice, key: string) => {
        if (downloadingKey || !detail.itemsAvailable) return;
        setDownloadingKey(key);
        try {
            const invoiceDetail = await fetchOrderInvoiceDetail(detail.orderId, detail.salesSource);
            const blob = createOrderInvoicePdf(invoiceDetail);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `stocknbook-order-${detail.orderId.replace(/[^a-z0-9_-]/gi, "-")}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            setDetailErrors(prev => ({
                ...prev, [key]: error instanceof Error ? error.message : "PDF export failed.",
            }));
        } finally {
            setDownloadingKey(null);
        }
    };

    return (
        <>
            <div className="max-h-[560px] min-h-0 overflow-auto overscroll-contain rounded-xl border border-[#E6DDF0]">
                <div className={`${grid} sticky top-0 z-10 border-b border-[#E6DDF0] bg-[#F9F6FD] px-4 py-3 text-xs font-semibold text-[#5F4E75]`}>
                    <div>Order ID</div><div>Date / Time</div><div>Branch</div>
                    <div>Sales Source</div><div>Financials</div>
                </div>
                {orders.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-[#9B8AAA]">
                        {pos.ownerRevenueError || "No transactions match these filters."}
                    </div>
                ) : orders.map((order) => {
                    const costKnown = order.cost != null && Number.isFinite(Number(order.cost));
                    const profitKnown = order.profit != null && Number.isFinite(Number(order.profit));
                    const key = orderKey(order);
                    const isExpanded = expandedKey === key;
                    const detail = details[key];
                    return (
                        <div key={key} className="border-b border-[#EFE7F4] last:border-0">
                            <div className={`${grid} items-start px-4 py-3 text-xs hover:bg-[#FFFCF7]`}>
                                <div className="flex min-w-0 items-start gap-2">
                                    <button
                                        type="button"
                                        onClick={() => toggleOrder(order)}
                                        aria-expanded={isExpanded}
                                        aria-label={`${isExpanded ? "Collapse" : "Expand"} items for order ${order.id}`}
                                        title="View included items and order details"
                                        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#684B87] hover:bg-[#F1E9FF]"
                                    >
                                        <ChevronRight size={16} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                    </button>
                                    <p className="min-w-0 break-all pt-1 font-bold text-[#2B174C]">{order.id}</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-[#2B174C]">{order.date}</p>
                                    <p className="mt-1 text-[11px] text-[#806A8C]">{order.salesSource === "BOOKING" && formatPOSOrderTime(order) === "—" ? "" : formatPOSOrderTime(order)}</p>
                                </div>
                                <p className="truncate font-semibold text-[#1A1220]" title={branchName(order)}>{branchName(order)}</p>
                                <p className="font-semibold text-[#4F3572]">{sourceLabel(order)}</p>
                                {order.salesSource === "BOOKING" ? <BookingFinancials order={order} /> : (
                                    <div className="min-w-0 space-y-0.5">
                                        <p className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2"><span className="text-[#806A8C]">Sales</span><strong className="whitespace-nowrap text-right">{peso(Number(order.total || 0))}</strong></p>
                                        <p className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2"><span className="text-[#806A8C]">Cost</span><strong className="whitespace-nowrap text-right">{costKnown ? peso(Number(order.cost)) : "—"}</strong></p>
                                        <p className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2"><span className="text-[#806A8C]">Gross</span><strong className="whitespace-nowrap text-right text-black">{profitKnown ? peso(Number(order.profit)) : "—"}</strong></p>
                                    </div>
                                )}
                            </div>
                            {isExpanded && (
                                <div className="bg-[#FBF9FF] px-4 py-4 sm:pl-12">
                                    {loadingKey === key && <p role="status" className="text-xs text-[#806A8C]">Loading original order items...</p>}
                                    {detailErrors[key] && (
                                        <div className="flex flex-wrap items-center gap-3">
                                            <p role="alert" className="text-xs text-[#B42318]">{detailErrors[key]}</p>
                                            {!detail && <button type="button" onClick={() => void loadDetail(order, key)} className="text-xs font-semibold text-[#5A35A5] underline">Try again</button>}
                                        </div>
                                    )}
                                    {detail && (
                                        <section aria-label={`Details for order ${order.id}`} className="overflow-hidden rounded-xl border border-[#E3D8EA] bg-white shadow-sm">
                                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E8DFF0] px-4 py-3">
                                                <div className="space-y-1">
                                                    <h3 className="text-sm font-bold text-[#2B174C]">Transaction invoice preview</h3>
                                                    <p className="text-[11px] text-[#806A8C]">{detail.storeName} · {detail.branchName} · {detail.salesSource === "BOOKING" && !/[T ]\d{2}:\d{2}/.test(detail.createdAt || "") ? `${detail.date} (event date; completion time unavailable)` : detail.createdAt || detail.date}</p>
                                                    <p className="text-[11px] text-[#806A8C]">Customer: {detail.customerName || "Walk-in"} · Payment: {detail.paymentMode ? detail.paymentMode.replace(/_/g," ") : "Not recorded"} · Tax: {detail.taxType || "Unverified"}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => void downloadInvoice(detail, key)}
                                                    disabled={!detail.itemsAvailable || downloadingKey === key}
                                                    title={detail.itemsAvailable ? "Download itemized order PDF" : "Item details must be verified before PDF download"}
                                                    aria-label={`Download PDF for order ${order.id}`}
                                                    className="inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-xl border border-[#D5C4EB] bg-white text-[#57328E] hover:bg-[#F1EAFF] disabled:cursor-not-allowed disabled:opacity-40"
                                                ><Download size={17} /></button>
                                            </div>
                                            {detail.itemsAvailable ? (
                                                <div className="overflow-x-auto px-4 py-3">
                                                    <table className="w-full min-w-[530px] text-left text-xs">
                                                        <thead className="border-b border-[#E8DFF0] bg-[#FAF7FF] text-[10px] font-semibold uppercase text-[#806A8C]">
                                                        <tr><th className="px-3 py-2">Item / Service</th><th className="px-3 py-2 text-center">Qty</th><th className="px-3 py-2 text-right">Unit Price</th><th className="px-3 py-2 text-right">Amount</th></tr>
                                                        </thead>
                                                        <tbody>
                                                        {detail.items.map((item, i) => (
                                                            <tr key={`${i}-${item.name}`} className="border-b border-[#F0EAF5] last:border-0">
                                                                <td className="px-3 py-2 font-medium text-[#2B174C]">{item.name}</td>
                                                                <td className="px-3 py-2 text-center">{item.quantity}</td>
                                                                <td className="px-3 py-2 text-right">{item.included ? "Included" : item.unitPrice == null ? "—" : peso(item.unitPrice)}</td>
                                                                <td className="px-3 py-2 text-right font-semibold">{item.included ? "Included" : item.lineTotal == null ? "—" : peso(item.lineTotal)}</td>
                                                            </tr>
                                                        ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <p className="px-4 py-4 text-xs text-[#806A8C]">{detail.detailNotice || "Original items and prices could not be verified."} PDF export is unavailable for this transaction.</p>
                                            )}
                                            <div className="space-y-1 border-t border-[#E8DFF0] bg-[#FAF7FF] px-4 py-3 text-xs">
                                                {["VAT", "VAT_REGISTERED"].includes(detail.taxType?.toUpperCase() || "") && detail.vatAmount != null && detail.total != null && (
                                                    <>
                                                        <p className="flex justify-between gap-4"><span className="text-[#806A8C]">VATable Sales (recorded)</span><strong>{peso(detail.total - detail.vatAmount)}</strong></p>
                                                        <p className="flex justify-between gap-4"><span className="text-[#806A8C]">Output VAT (recorded)</span><strong>{peso(detail.vatAmount)}</strong></p>
                                                    </>
                                                )}
                                                <p className="flex justify-between gap-4 font-bold text-[#2B174C]"><span>Recorded Total</span><span>{detail.total == null ? "—" : peso(detail.total)}</span></p>
                                                {detail.bookingBilling && <BookingBillingPreview billing={detail.bookingBilling} />}
                                                <p className="pt-2 text-[10px] text-[#806A8C]">Internal transaction copy only. An Order ID is not a BIR-issued invoice number.</p>
                                            </div>
                                        </section>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E6DDF0] px-4 py-3">
                {pos.ownerOrderTotalPages > 1 && (
                    <div className="flex gap-2">
                        <button type="button" disabled={pos.ownerOrderPage <= 1} onClick={() => pos.setOwnerOrderPage(Math.max(1, pos.ownerOrderPage - 1))}
                                className="rounded-lg border border-[#D8CBE7] px-3.5 py-2 text-xs font-semibold text-[#2B174C] disabled:opacity-40">Previous</button>
                        <button type="button" disabled={pos.ownerOrderPage >= pos.ownerOrderTotalPages} onClick={() => pos.setOwnerOrderPage(Math.min(pos.ownerOrderTotalPages, pos.ownerOrderPage + 1))}
                                className="rounded-lg bg-[#2B174C] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40">Next</button>
                    </div>
                )}
            </div>
        </>
    );
}

type OwnerPOSKpiKey = "sales" | "booking" | "walk";
export type POSKpiKey = OwnerPOSKpiKey | "transactions";
export type POSKpiDetail = {
    title: string;
    amount: number | null;
    period: string;
    scope: string;
    scopeNote?: string;
    formula: string;
    items: [string, number | null][];
    description: string;
};

const ownerPOSKpiVisuals = {
    sales: { Icon: CircleDollarSign, icon: "bg-[#F0E9FF] text-[#5A35A5]", surface: "border-[#E6DDF0] bg-[#F8F4FE] text-[#543099]" },
    booking: { Icon: WalletCards, icon: "bg-[#FFF2E5] text-[#D56A1F]", surface: "border-[#F3E2C2] bg-[#FFFAF0] text-[#8C601F]" },
    walk: { Icon: ShoppingBag, icon: "bg-[#EAF1FF] text-[#245EDB]", surface: "border-[#D6E5FC] bg-[#F2F7FF] text-[#205AA8]" },
    transactions: { Icon: ReceiptText, icon: "bg-[#E9F8EF] text-[#168A48]", surface: "border-[#D7EBDF] bg-[#F0FAF4] text-[#206B49]" },
} as const;

function posKpiVisual(key: POSKpiKey, manager: boolean) {
    const visual = ownerPOSKpiVisuals[key];
    if (manager && key === "booking") return { ...visual, Icon: CalendarDays, icon: "bg-[#FFF2E5] text-[#C8791D]" };
    if (manager && key === "walk") return { ...visual, icon: "bg-[#E8F0FF] text-[#2865D9]" };
    return visual;
}

function formatKpiAmount(key: POSKpiKey, amount: number | null) {
    if (amount == null || !Number.isFinite(amount)) return "Unavailable";
    if (key === "transactions") return amount.toLocaleString("en-PH", { maximumFractionDigits: 0 });
    return amount < 0 ? `−${peso(Math.abs(amount))}` : peso(amount);
}

export function POSKpiCard({ kpiKey, detail, helper, onClick, manager = false }: {
    kpiKey: POSKpiKey; detail: POSKpiDetail; helper: string; onClick: () => void; manager?: boolean;
}) {
    const visual = posKpiVisual(kpiKey, manager);
    const Icon = visual.Icon;
    return (
        <button type="button" onClick={onClick}
                aria-label={`View how ${detail.title} is calculated`} aria-haspopup="dialog"
                title={`View ${detail.title} breakdown`}
                className="flex min-h-[128px] min-w-0 w-full cursor-pointer items-center gap-4 rounded-[18px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm transition hover:border-[#B6A1D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]">
            <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${visual.icon}`}><Icon size={18} /></span>
            <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-[#2B174C]">{detail.title}</span>
                <span className="mt-0.5 block break-words text-[26px] font-bold leading-tight tabular-nums text-[#1A1220]">{detail.amount == null || !Number.isFinite(detail.amount) ? "—" : formatKpiAmount(kpiKey, detail.amount)}</span>
                <span className="mt-1 block text-xs text-[#806A8C]">{helper}</span>
            </span>
        </button>
    );
}

export function POSKpiDetailModal({kpiKey,detail,onClose,manager=false}:{kpiKey:POSKpiKey;detail:POSKpiDetail;onClose:()=>void;manager?:boolean}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const visual = posKpiVisual(kpiKey, manager);
    const Icon = visual.Icon;
    const tone = visual;
    const amountText = (amount:number|null) => formatKpiAmount(kpiKey, amount);
    const isNegative = detail.amount !== null && detail.amount < 0;
    const resultLabel = detail.title;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const trigger = document.activeElement;
        if (!dialog.open) dialog.showModal();
        return () => {
            if (dialog.open) dialog.close();
            if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({preventScroll:true});
        };
    }, []);

    return (
        <dialog ref={dialogRef} aria-labelledby="owner-pos-kpi-detail-title"
                aria-describedby="owner-pos-kpi-detail-period"
                onCancel={event=>{event.preventDefault();onClose();}}
                onClick={event=>{if(event.target===event.currentTarget)onClose();}}
                className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[540px] overflow-y-auto rounded-[20px] border border-[#E6DDF0] bg-white p-0 text-[#25153D] shadow-2xl backdrop:bg-[#170B29]/55 backdrop:backdrop-blur-[2px]">
            <div className="font-sans">
                <header className="flex items-center gap-3 border-b border-[#EEE7F5] px-5 py-4 sm:px-6">
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone.icon}`} aria-hidden="true"><Icon size={23}/></span>
                    <div className="min-w-0 flex-1">
                        <h2 id="owner-pos-kpi-detail-title" className="text-[18px] font-bold leading-tight text-[#25153D]">{detail.title}</h2>
                        <p className="mt-1 text-[11px] text-[#806A8C]">Calculation breakdown</p>
                    </div>
                    <button type="button" aria-label="Close calculation" onClick={onClose}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] transition hover:bg-[#F6F0FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]"><X size={18}/></button>
                </header>
                <div className="space-y-4 px-5 py-5 sm:px-6">
                    <div className={`rounded-2xl border px-4 py-4 ${tone.surface}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide">{resultLabel}</p>
                            <span className="flex items-center gap-1.5 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium"><CalendarDays size={13} aria-hidden="true"/><span id="owner-pos-kpi-detail-period">{detail.period}</span></span>
                        </div>
                        <p className={`mt-2 break-words text-[30px] font-bold leading-tight tracking-tight tabular-nums ${isNegative?"text-[#B42318]":"text-[#25153D]"}`}>{amountText(detail.amount)}</p>
                        <p className="mt-1 text-[11px] text-[#806A8C]">{detail.scope} · {detail.scopeNote ?? "All matching sales (not table search or source filter)"}</p>
                    </div>
                    <section aria-label="Formula" className="rounded-xl border border-[#E9E1EE] bg-[#FAF8FC] px-4 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#806A8C]"><Calculator size={15} aria-hidden="true"/>Formula</div>
                        <p className="mt-2 break-words text-[13px] font-semibold leading-5 text-[#392648]">{detail.formula}</p>
                        {kpiKey === "sales" && detail.amount !== null && detail.items.every(([, amount]) => amount !== null && Number.isFinite(amount)) && (
                            <p className="mt-1 break-words text-[12px] tabular-nums text-[#5F4E75]">{detail.items.map(([, amount]) => amountText(amount)).join(" + ")} = {amountText(detail.amount)}</p>
                        )}
                    </section>
                    <section aria-label="Calculation details" className="overflow-hidden rounded-xl border border-[#E6DDF0]">
                        <div className="flex justify-between gap-2 bg-[#FFFCF8] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]"><span>Breakdown</span><span>{kpiKey === "transactions" ? "Count" : "Amount"}</span></div>
                        <dl className="divide-y divide-[#F1ECF4]">
                            {detail.items.map(([name,amount])=>(
                                <div key={name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-[12px]">
                                    <dt className="min-w-0 flex-1 text-[#5F4E75]">{name}</dt>
                                    <dd className="break-words text-right font-semibold tabular-nums text-[#25153D]">{amountText(amount)}</dd>
                                </div>
                            ))}
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#F8F5FC] px-4 py-3">
                                <dt className="text-[12px] font-bold text-[#25153D]">{"Total"}</dt>
                                <dd className={`break-words text-right text-[17px] font-bold tabular-nums ${isNegative?"text-[#B42318]":"text-[#25153D]"}`}>{amountText(detail.amount)}</dd>
                            </div>
                        </dl>
                    </section>
                    <div className="flex items-start gap-2 rounded-xl bg-[#FAF8FC] px-3 py-3">
                        <Info size={15} className="mt-0.5 shrink-0 text-[#806A8C]" aria-hidden="true"/>
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-[#5F4E75]">How this is calculated</p>
                            <p className="mt-1 text-[11px] leading-[1.6] text-[#6C5E76]">{detail.description}</p>
                        </div>
                    </div>
                </div>
                <footer className="flex justify-end border-t border-[#EEE7F5] px-5 py-3 sm:px-6">
                    <button type="button" onClick={onClose} className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#1B0D31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]">Close</button>
                </footer>
            </div>
        </dialog>
    );
}

export default function OwnerPOS({ pos }: { pos: UsePOSReturn }) {
    const [selectedKpi, setSelectedKpi] = useState<OwnerPOSKpiKey | null>(null);
    const [branchQuery, setBranchQuery] = useState("All Branches");
    const [menuOpen, setMenuOpen] = useState(false);
    const [downloadingVat, setDownloadingVat] = useState(false);
    const [vatDownloadError, setVatDownloadError] = useState<string | null>(null);
    const branchRef = useRef<HTMLDivElement>(null);
    const selectedBranch = pos.branches.find(b => String(b.id) === pos.selectedSalesBranchId);
    const isAllBranches = !pos.selectedSalesBranchId;
    const matchingBranches = useMemo(() => pos.branches.filter(b => b.branchName.toLowerCase().includes(branchQuery.trim().toLowerCase())), [pos.branches, branchQuery]);

    useEffect(() => {
        function outside(event: MouseEvent) {
            if (branchRef.current && !branchRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
                setBranchQuery(selectedBranch?.branchName || "All Branches");
            }
        }
        document.addEventListener("mousedown", outside);
        return () => document.removeEventListener("mousedown", outside);
    }, [selectedBranch?.branchName]);

    const report = pos.ownerRevenue;
    const summary = report?.summary;
    const dateFrom = pos.ownerOrderStartDate;
    const dateTo = pos.ownerOrderEndDate;
    const dateFilter = usePOSDatePeriod(dateFrom, dateTo, pos.setOwnerOrderDateRange);
    const branchName = (order: Order) => order.branchName || pos.branches.find(b => b.id === order.branchId)?.branchName || "—";
    const isVatRegistered = report?.taxRegistration === "VAT_REGISTERED";
    const vatSummary = report?.vatSummary;
    // These are the server's branch/date-scoped totals, not the sum of the current page.
    // The table's search and sales-source filters do not restrict the Owner KPI totals.
    const period = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateFrom ? `From ${dateFrom}` : dateTo ? `Through ${dateTo}` : "All time";
    const scope = selectedBranch?.branchName || "All Branches";
    const bookingSales = summary?.bookingSales ?? null;
    const walkInSales = summary?.walkInSales ?? null;
    const totalSales = summary?.totalSales ?? null;
    const bookingRule = "Completed bookings are grouped by their recorded completion date. Older bookings without a recorded completion time use their event date as a reporting fallback. Each uses the saved agreed price when positive, otherwise the saved package price. Refundable security deposits and separate settlement charges or refunds are not included in this sales total.";
    const walkRule = "Completed walk-in POS orders are grouped by order date. The report sums their saved transaction totals, including any recorded VAT, without deducting costs.";
    const kpiDetails: Record<OwnerPOSKpiKey, POSKpiDetail> = {
        sales: { title: "Total Sales", amount: totalSales, period, scope,
            formula: "Total Sales = Booking Sales + Walk-in Sales",
            items: [["Booking Sales", bookingSales], ["Walk-in Sales", walkInSales]],
            description: `Adds completed booking sales and completed walk-in sales for the selected branch and date range, before deducting costs or recorded VAT. Refundable deposits and separate settlement adjustments are excluded. If booking totals are unavailable, combined sales are also unavailable.` },
        booking: { title: "Booking Sales", amount: bookingSales, period, scope,
            formula: "Booking Sales = Sum of completed booking prices",
            items: [["Completed booking sales", bookingSales]],
            description: bookingRule },
        walk: { title: "Walk-in Sales", amount: walkInSales, period, scope,
            formula: "Walk-in Sales = Sum of completed walk-in order totals",
            items: [["Completed walk-in sales", walkInSales]],
            description: walkRule },
    };


    const downloadTransactionReport = async () => {
        if (downloadingVat) return;
        setVatDownloadError(null);
        setDownloadingVat(true);
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Please log in again to download the transaction report.");
            const response = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_owner_sales_report",
                    vat_export: true,
                    ...(pos.selectedSalesBranchId ? { branch_id: Number(pos.selectedSalesBranchId) } : {}),
                    ...(dateFrom ? { date_from: dateFrom } : {}),
                    ...(dateTo ? { date_to: dateTo } : {}),
                    sales_source: pos.ownerSalesSource,
                    ...(pos.ownerPaymentFilter ? { payment_method: pos.ownerPaymentFilter } : {}),
                    ...(pos.ownerOrderSearch.trim() ? { search: pos.ownerOrderSearch.trim() } : {}),
                }),
            });
            const data = await response.json() as {
                export?: boolean;
                error?: string;
                taxRegistration?: string;
                transactionSummary?: { count: number; totalSales: number };
                bookingIntegration?: { available: boolean };
                vatSummary?: {
                    vatableSales: number; outputVat: number; customerTotal: number;
                    coverage: string; coverageReason: string | null;
                    unverifiedRecords: number;
                } | null;
                rows?: Array<{
                    orderId: string; date: string; createdAt?: string; branchName: string; salesSource: string;
                    paymentMode: string; taxType: string; totalInclusive: number;
                    vatableSales: number | null; outputVat: number | null; vatStatus: string;
                }>;
            };
            if (!response.ok || !data.export || !Array.isArray(data.rows)) {
                throw new Error(data.error || "Transaction report could not be downloaded.");
            }

            const scopeName = selectedBranch?.branchName || "All Branches";
            const storeName = sessionStorage.getItem("business_name") ||
                sessionStorage.getItem("store_name") ||
                sessionStorage.getItem("stocknbook_store_name") || "StockNBook Store";
            const sourceName = pos.ownerSalesSource === "ALL" ? "All Sales" :
                pos.ownerSalesSource === "BOOKING" ? "Booking" : "Walk-in";
            const pdf = createVatReportPdf(
                { vatSummary: data.vatSummary, transactionSummary: data.transactionSummary, bookingIntegration: data.bookingIntegration, rows: data.rows },
                storeName, scopeName, dateFrom, dateTo, sourceName, data.taxRegistration || "NON_VAT",
            );
            const url = URL.createObjectURL(pdf);
            const link = document.createElement("a");
            link.href = url;
            const safeBranch = (selectedBranch?.branchName || "all-branches")
                .replace(/[^a-z0-9_-]+/gi, "-").slice(0, 50);
            link.download = `stocknbook-transactions-${safeBranch}-${dateFrom || "all"}-to-${dateTo || "all"}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            setVatDownloadError(error instanceof Error ? error.message : "Transaction download failed.");
        } finally {
            setDownloadingVat(false);
        }
    };

    return (
        <POSLayout role="owner" isOwner={true} activeBranchName="" onRefresh={() => pos.refreshAll()}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <POSKpiCard kpiKey="sales" detail={kpiDetails.sales}
                                helper="Earned booking + completed walk-in sales" onClick={() => setSelectedKpi("sales")} />
                    <POSKpiCard kpiKey="booking" detail={kpiDetails.booking}
                                helper="Completed bookings only" onClick={() => setSelectedKpi("booking")} />
                    <POSKpiCard kpiKey="walk" detail={kpiDetails.walk}
                                helper="Completed POS walk-in transactions" onClick={() => setSelectedKpi("walk")} />
                </div>
                {isVatRegistered && vatSummary && (
                    <section aria-label="VAT registered store summary" className="rounded-[16px] border border-[#E8DEF3] bg-gradient-to-r from-[#FAF7FF] via-white to-[#F7F2FF] px-4 py-3 shadow-sm">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                            <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#EEE5FF] px-3 py-2 text-xs font-bold text-[#6536BD]">
                                <ShieldCheck size={16} strokeWidth={2} /> VAT Registered
                            </div>
                            <div className="hidden h-10 border-l border-[#DCD1E8] xl:block" />
                            <div className="min-w-[150px] flex-1 text-xs text-[#6B587F]">
                                VATable Sales: <strong className="text-[14px] text-[#2B174C]">{peso(vatSummary.vatableSales)}</strong>
                            </div>
                            <div className="hidden h-10 border-l border-[#DCD1E8] xl:block" />
                            <div className="min-w-[145px] flex-1 text-xs text-[#6B587F]">
                                Output VAT (recorded): <strong className="text-[14px] text-[#2B174C]">{peso(vatSummary.outputVat)}</strong>
                            </div>
                            <div className="hidden h-10 border-l border-[#DCD1E8] xl:block" />
                            <div className="min-w-[170px] flex-1 text-xs text-[#6B587F]">
                                Customer Total (incl. VAT): <strong className="text-[14px] text-[#2B174C]">{peso(vatSummary.customerTotal)}</strong>
                            </div>
                        </div>
                    </section>
                )}
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <div className="mb-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="text-[16px] font-bold text-[#1A1220]">{isAllBranches ? "All Branches Orders" : `${selectedBranch?.branchName || "Branch"} Orders`}</h2>
                                <p className="mt-0.5 text-xs text-[#7A6A84]">Booking and walk-in sales records · {pos.ownerOrderTotal} matching transactions</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void downloadTransactionReport()}
                                disabled={downloadingVat}
                                title="Download all matching transactions as PDF"
                                aria-label="Download all matching transactions as PDF"
                                className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-[#D5C4EB] bg-white text-[#57328E] transition hover:bg-[#F1EAFF] disabled:cursor-wait disabled:opacity-50"
                            >
                                <Download size={18} strokeWidth={2} />
                            </button>
                        </div>
                        {vatDownloadError && (
                            <p role="alert" className="mt-2 text-xs font-medium text-[#B42318]">{vatDownloadError}</p>
                        )}
                    </div>
                    <div className="mb-3">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(170px,205px)_minmax(145px,175px)_minmax(170px,205px)]">
                            <div className="relative min-w-0">
                                <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                <input value={pos.ownerOrderSearch} onChange={e => pos.setOwnerOrderSearch(e.target.value)}
                                       placeholder="Search Order ID or customer..." aria-label="Search Order ID or customer name"
                                       className={`${fieldClass} pl-10 placeholder:text-[#9B8AAA]`} />
                            </div>
                            <POSPeriodFilter filter={dateFilter} />
                            <FilterSelect icon={<SlidersHorizontal size={15} />} label="Sales Source" value={pos.ownerSalesSource}
                                          onChange={v => pos.setOwnerSalesSource(v as "ALL" | "BOOKING" | "WALK_IN")}
                                          options={[{value:"ALL",label:"All Sales"},{value:"BOOKING",label:"Booking"},{value:"WALK_IN",label:"Walk-in"}]} />
                            <div ref={branchRef} className="relative min-w-0">
                                <Building2 size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                <input value={branchQuery} onFocus={() => {setMenuOpen(true);setBranchQuery("");}}
                                       onChange={e => {setBranchQuery(e.target.value);setMenuOpen(true);}}
                                       onKeyDown={e => {if(e.key==="Escape"){setMenuOpen(false);setBranchQuery(selectedBranch?.branchName || "All Branches");}}}
                                       role="combobox" aria-expanded={menuOpen} aria-controls="owner-sales-branches"
                                       aria-label="Select branch" placeholder="Search or select branch..."
                                       className={`${fieldClass} pl-10 pr-10 font-semibold placeholder:text-[#9B8AAA]`} />
                                <button type="button" aria-label="Show branches" onClick={() => {setMenuOpen(o=>!o);setBranchQuery("");}}
                                        className="absolute right-1 top-0 flex h-full w-9 items-center justify-center text-[#2B174C]"><ChevronDown size={15} /></button>
                                {menuOpen && (
                                    <div id="owner-sales-branches" role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[#D8CBE7] bg-white py-1 shadow-lg">
                                        <button type="button" role="option" aria-selected={isAllBranches} onClick={() => {pos.setSelectedSalesBranchId("");setBranchQuery("All Branches");setMenuOpen(false);}}
                                                className="flex w-full justify-between px-4 py-2.5 text-left text-sm text-[#2B174C] hover:bg-[#F7F1FF]">All Branches {isAllBranches && <Check size={15} />}</button>
                                        {matchingBranches.map(b => <button type="button" key={b.id} role="option" aria-selected={String(b.id)===pos.selectedSalesBranchId}
                                                                           onClick={() => {pos.setSelectedSalesBranchId(String(b.id));setBranchQuery(b.branchName);setMenuOpen(false);}}
                                                                           className="flex w-full justify-between gap-3 px-4 py-2.5 text-left text-sm text-[#2B174C] hover:bg-[#F7F1FF]">
                                            <span className="truncate">{b.branchName}</span>{String(b.id)===pos.selectedSalesBranchId && <Check size={15} />}
                                        </button>)}
                                        {matchingBranches.length===0 && <p className="px-4 py-3 text-xs text-[#806A8C]">No matching branch found.</p>}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <TransactionTable pos={pos} orders={pos.orders} branchName={branchName} />
                </section>
            </div>
            {selectedKpi && <POSKpiDetailModal kpiKey={selectedKpi} detail={kpiDetails[selectedKpi]} onClose={() => setSelectedKpi(null)} />}
        </POSLayout>
    );
}
