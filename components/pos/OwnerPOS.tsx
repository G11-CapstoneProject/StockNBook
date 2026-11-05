"use client";

import {
    Building2, CalendarDays, Check, ChevronDown, ChevronRight, CircleDollarSign,
    Download, RefreshCw, Search, ShieldCheck, ShoppingBag, SlidersHorizontal,
    TrendingUp, WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import type { UsePOSReturn } from "@/hooks/usePOS";
import { StatCard, formatPOSOrderTime, peso, type Order } from "./_shared";

const fieldClass = "h-[42px] w-full min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm text-[#1A1220] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10";
const sourceLabel = (order: Order) =>
    order.salesSource === "BOOKING" || String(order.customerType || "").toUpperCase() === "BOOKING"
        ? "Booking" : "Walk-in";

function DateField({ label, value, min, max, onChange }: {
    label: string; value: string; min?: string; max?: string; onChange: (value: string) => void;
}) {
    return (
        <div className="relative min-w-0">
            <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
            <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">{label}</span>
            <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
                   aria-label={`${label} date`} className={`${fieldClass} pl-[75px] pr-2 text-xs font-medium`} />
        </div>
    );
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
    orderId: string; date: string; branchName: string; salesSource: string;
    paymentMode: string; taxType: string; totalInclusive: number;
    vatableSales: number | null; outputVat: number | null; vatStatus: string;
};
type OwnerVatExport = {
    vatSummary?: {
        vatableSales: number; outputVat: number; customerTotal: number;
        coverage: string; coverageReason: string | null;
        unverifiedRecords: number;
    } | null;
    rows: OwnerVatExportRow[];
};

function createVatReportPdf(data: OwnerVatExport, store: string, branch: string, dateFrom: string, dateTo: string, salesSource: string): Blob {
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
        txt("STOCKNBOOK  /  VAT TRANSACTION REPORT", 30, 36, first ? 17 : 13, true);
        txt("INTERNAL REPORT - NOT A BIR TAX RETURN", 584, 36, 8, false, "0.42 0.32 0.53");
        line(30, 47, 812);
        if (first) {
            txt(`Store: ${store}`, 30, 63, 10, true);
            txt(`Branch: ${branch}`, 30, 78, 9);
            txt(`Period: ${dateFrom || "All dates"} to ${dateTo || "All dates"}`, 300, 78, 9);
            txt(`Source: ${salesSource}`, 644, 78, 9);
            const sums = data.vatSummary;
            rect(30, 91, 782, 59, "0.965 0.950 0.992");
            txt("VATABLE SALES (recorded)", 43, 108, 8);
            txt(money(sums?.vatableSales), 43, 132, 13, true);
            txt("OUTPUT VAT (recorded)", 299, 108, 8);
            txt(money(sums?.outputVat), 299, 132, 13, true);
            txt("CUSTOMER TOTAL (incl. VAT)", 554, 108, 8);
            txt(money(sums?.customerTotal), 554, 132, 13, true);
            const reason = sums?.coverageReason || "Only recorded, verifiable VAT transactions are included.";
            txt(`Coverage: ${sums?.coverage || "UNKNOWN"}  |  Unverified records: ${sums?.unverifiedRecords ?? "--"}`, 30, 163, 8, true);
            // Two annotation rows are reserved to avoid overlapping the table.
            chunks(reason, 140).slice(0, 2).forEach((part, i) => txt(part, 30, 178 + i * 11, 8));
            cursorY = 203;
        } else {
            txt(`Branch: ${branch}  |  ${dateFrom || "All dates"} to ${dateTo || "All dates"}  |  ${salesSource}`, 30, 64, 8);
            cursorY = 83;
        }
    };
    const positions = [30, 91, 248, 346, 407, 478, 516, 593, 675, 753];
    const widths = [61, 157, 98, 61, 71, 38, 77, 82, 78, 59];
    const headings = ["DATE", "ORDER ID", "BRANCH", "SOURCE", "PAYMENT", "TAX", "TOTAL incl.", "VATABLE", "OUTPUT VAT", "STATUS"];
    const tableHead = () => {
        rect(30, cursorY, 782, 23, "0.94 0.91 0.98");
        headings.forEach((heading, i) => txt(heading, positions[i] + 3, cursorY + 15, 7.1, true));
        cursorY += 23;
    };
    startPage(true);
    tableHead();
    if (!data.rows.length) txt("No matching VAT transactions for the selected scope.", 35, cursorY + 24, 10);
    for (let n = 0; n < data.rows.length; n++) {
        const row = data.rows[n];
        const tax = String(row.taxType || "").toUpperCase();
        const status = String(row.vatStatus || "").toUpperCase();
        const cells = [
            ascii(row.date), ascii(row.orderId), ascii(row.branchName),
            ascii(row.salesSource), ascii(row.paymentMode).replace(/_/g, " "),
            tax === "VAT" ? "VAT" : tax === "NON_VAT" ? "Non-VAT" : tax,
            money(row.totalInclusive).replace("PHP ", ""),
            money(row.vatableSales).replace("PHP ", ""),
            money(row.outputVat).replace("PHP ", ""),
            status === "VAT_RECORDED" ? "Recorded" : status === "NON_VAT" ? "Non-VAT" : "Unverified",
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
        const footer = `Generated ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })} | Page ${i + 1} of ${pages.length} | Output VAT only; input VAT and adjustments are excluded`;
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

/** Itemized order detail returned by the existing owner-scoped POS Lambda. */
type OwnerOrderInvoice = {
    orderId: string;
    storeName: string;
    branchName: string;
    salesSource: "WALK_IN" | "BOOKING";
    customerName: string;
    date: string;
    createdAt: string;
    paymentMode: string;
    taxType: string | null;
    vatAmount: number | null;
    total: number | null;
    items: Array<{ name: string; quantity: number; unitPrice: number | null; lineTotal: number | null }>;
    itemsAvailable: boolean;
    detailNotice: string | null;
    officialInvoiceNumber: null;
};

/** PDF produced in the existing OwnerPOS source, without extra dependencies. */
function createOrderInvoicePdf(detail: OwnerOrderInvoice): Blob {
    if (!detail.itemsAvailable || detail.total == null || detail.items.length === 0) {
        throw new Error("Verified itemized information is required before exporting this order.");
    }
    const ascii = (value: unknown) => String(value ?? "").normalize("NFKD")
        .replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
    const escaped = (value: unknown) => ascii(value)
        .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const currency = (value: number | null | undefined) => value == null || !Number.isFinite(value)
        ? "Not recorded"
        : `PHP ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const W = 595.28, H = 841.89; // A4 portrait
    const pages: string[][] = [];
    let page: string[] = [];
    let cursor = 0;
    const push = (s: string) => { page.push(s); };
    const rect = (x: number, y: number, width: number, height: number, rgb: string) =>
        push(`${rgb} rg ${x} ${H - y - height} ${width} ${height} re f`);
    const text = (v: unknown, x: number, y: number, size = 9, bold = false, rgb = "0.18 0.12 0.28") =>
        push(`${rgb} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${(H - y).toFixed(2)} Tm (${escaped(v)}) Tj ET`);
    const line = (y: number) => push(`0.86 0.82 0.91 RG 0.7 w 35 ${H - y} m 560 ${H - y} l S`);
    const split = (value: unknown, max: number) => {
        const words = ascii(value).split(" ");
        const lines: string[] = [];
        let current = "";
        for (const word of words) {
            if (current && `${current} ${word}`.length > max) { lines.push(current); current = ""; }
            if (word.length > max) {
                if (current) { lines.push(current); current = ""; }
                for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max));
            } else current = current ? `${current} ${word}` : word;
        }
        if (current) lines.push(current);
        return lines.length ? lines : ["--"];
    };
    const newPage = (first: boolean) => {
        page = [];
        pages.push(page);
        rect(0, 0, W, 12, "0.17 0.09 0.30");
        text("STOCKNBOOK", 35, 42, 15, true);
        text("INVOICE-STYLE TRANSACTION COPY", 311, 42, 9, true, "0.40 0.30 0.51");
        line(54);
        if (first) {
            text(detail.storeName, 35, 80, 13, true);
            text(`Branch: ${detail.branchName}`, 35, 98, 9);
            text(`Order ID: ${detail.orderId}`, 35, 126, 10, true);
            text(`Date / Time: ${detail.createdAt || detail.date}`, 35, 145, 9);
            text(`Sales Source: ${detail.salesSource === "BOOKING" ? "Booking" : "Walk-in"}`, 35, 162, 9);
            text(`Customer: ${detail.customerName || "Walk-in"}`, 310, 126, 9);
            text(`Payment: ${detail.paymentMode || "Not recorded"}`, 310, 145, 9);
            text(`Tax: ${detail.taxType || "Unverified"}`, 310, 162, 9);
            cursor = 190;
        } else {
            text(`Order ID: ${detail.orderId}  |  Continued`, 35, 78, 9);
            cursor = 98;
        }
        rect(35, cursor, 525, 26, "0.93 0.90 0.97");
        text("DESCRIPTION", 43, cursor + 17, 9, true);
        text("QTY", 339, cursor + 17, 9, true);
        text("UNIT PRICE", 395, cursor + 17, 9, true);
        text("AMOUNT", 487, cursor + 17, 9, true);
        cursor += 26;
    };
    newPage(true);
    for (const item of detail.items) {
        const descriptions = split(item.name, 53);
        const height = Math.max(28, 14 + descriptions.length * 12);
        if (cursor + height > 708) newPage(false);
        if (detail.items.indexOf(item) % 2 === 0) rect(35, cursor, 525, height, "0.985 0.980 0.994");
        descriptions.forEach((part, index) => text(part, 43, cursor + 17 + index * 12, 8.5));
        text(String(item.quantity), 344, cursor + 17, 8.5);
        text(currency(item.unitPrice).replace("PHP ", ""), 391, cursor + 17, 8.1);
        text(currency(item.lineTotal).replace("PHP ", ""), 480, cursor + 17, 8.1);
        cursor += height;
        line(cursor);
    }
    // Grand total comes from the original order header; it is not reconstructed
    // from item lines (discounts and adjustments may not be itemized).
    if (cursor + 104 > 708) newPage(false);
    cursor += 22;
    const isVat = ["VAT", "VAT_REGISTERED"].includes(String(detail.taxType || "").toUpperCase());
    if (isVat && detail.vatAmount != null) {
        text("VATable amount (recorded)", 317, cursor, 9);
        text(currency(Math.max(0, detail.total - detail.vatAmount)), 444, cursor, 9, true);
        cursor += 20;
        text("Output VAT (recorded)", 317, cursor, 9);
        text(currency(detail.vatAmount), 444, cursor, 9, true);
        cursor += 18;
    }
    line(cursor + 4);
    cursor += 24;
    text("RECORDED TOTAL", 313, cursor, 11, true);
    text(currency(detail.total), 437, cursor, 11, true, "0.11 0.47 0.27");
    const recordedLines = detail.items.reduce((total, line) => total + Number(line.lineTotal || 0), 0);
    if (Math.abs(recordedLines - detail.total) > 0.02) {
        cursor += 22;
        text("Line items and order total differ; discounts/adjustments may apply.", 35, cursor, 8);
    }
    pages.forEach((commands, index) => {
        // Each page is explicitly labelled to prevent an internal order copy from
        // being mistaken for a BIR-issued sales invoice.
        commands.push(`0.88 0.84 0.92 RG 0.7 w 35 65 m 560 65 l S`);
        const footer = `INTERNAL TRANSACTION COPY - NOT A BIR-REGISTERED SALES INVOICE   |   Page ${index + 1} of ${pages.length}`;
        commands.push(`0.43 0.34 0.50 rg BT /F1 7.2 Tf 1 0 0 1 35 48 Tm (${escaped(footer)}) Tj ET`);
        commands.push(`0.43 0.34 0.50 rg BT /F1 7.2 Tf 1 0 0 1 35 33 Tm (${escaped("Original Order ID retained; no official invoice number has been issued by this report.")}) Tj ET`);
    });
    const objects: string[] = [
        "<< /Type /Catalog /Pages 2 0 R >>", "",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ];
    const refs: string[] = [];
    pages.forEach((commands) => {
        const pageId = objects.length + 1;
        const streamId = pageId + 1;
        const stream = commands.join("\n") + "\n";
        refs.push(`${pageId} 0 R`);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    });
    objects[1] = `<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${refs.length} >>`;
    let result = "%PDF-1.4\n";
    const offsets: number[] = [0];
    objects.forEach((obj, index) => {
        offsets.push(result.length);
        result += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const startXref = result.length;
    result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) result += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
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
    const grid = "grid min-w-[850px] grid-cols-[minmax(235px,1.5fr)_minmax(120px,0.9fr)_minmax(110px,0.75fr)_160px_minmax(155px,0.95fr)] gap-3";
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
            const blob = createOrderInvoicePdf(detail);
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
            <div className="h-[440px] min-h-0 overflow-auto overscroll-contain">
                <div className={`${grid} sticky top-0 z-10 border-b border-[#E6DDF0] bg-white px-4 py-3 text-[10px] font-semibold text-[#806A8C]`}>
                    <div>Order ID</div><div>Branch</div><div>Sales Source</div>
                    <div>Financials</div><div>Date / Time</div>
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
                            <div className={`${grid} items-start px-4 py-3 text-[11px] hover:bg-[#FFFCF7]`}>
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
                                <p className="truncate font-semibold text-[#1A1220]" title={branchName(order)}>{branchName(order)}</p>
                                <p className="font-semibold text-[#4F3572]">{sourceLabel(order)}</p>
                                <div className="min-w-0 space-y-0.5">
                                    <p className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2"><span className="text-[#806A8C]">Sales</span><strong className="whitespace-nowrap text-right">{peso(Number(order.total || 0))}</strong></p>
                                    <p className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2"><span className="text-[#806A8C]">Cost</span><strong className="whitespace-nowrap text-right">{costKnown ? peso(Number(order.cost)) : "—"}</strong></p>
                                    <p className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2"><span className="text-[#806A8C]">Gross</span><strong className="whitespace-nowrap text-right text-[#168A48]">{profitKnown ? peso(Number(order.profit)) : "—"}</strong></p>
                                </div>
                                <div>
                                    <p className="font-semibold text-[#2B174C]">{order.date}</p>
                                    <p className="mt-1 text-[10px] text-[#806A8C]">{formatPOSOrderTime(order)}</p>
                                </div>
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
                                                    <p className="text-[11px] text-[#806A8C]">{detail.storeName} · {detail.branchName} · {detail.createdAt || detail.date}</p>
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
                                                                <td className="px-3 py-2 text-right">{item.unitPrice == null ? "—" : peso(item.unitPrice)}</td>
                                                                <td className="px-3 py-2 text-right font-semibold">{item.lineTotal == null ? "—" : peso(item.lineTotal)}</td>
                                                            </tr>
                                                        ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <p className="px-4 py-4 text-xs text-[#806A8C]">{detail.detailNotice || "Original items and prices could not be verified."} PDF export is unavailable for this transaction.</p>
                                            )}
                                            <div className="space-y-1 border-t border-[#E8DFF0] bg-[#FAF7FF] px-4 py-3 text-xs">
                                                {detail.taxType?.toUpperCase() === "VAT" && detail.vatAmount != null && detail.total != null && (
                                                    <>
                                                        <p className="flex justify-between gap-4"><span className="text-[#806A8C]">VATable Sales (recorded)</span><strong>{peso(detail.total - detail.vatAmount)}</strong></p>
                                                        <p className="flex justify-between gap-4"><span className="text-[#806A8C]">Output VAT (recorded)</span><strong>{peso(detail.vatAmount)}</strong></p>
                                                    </>
                                                )}
                                                <p className="flex justify-between gap-4 font-bold text-[#2B174C]"><span>Recorded Total</span><span>{detail.total == null ? "—" : peso(detail.total)}</span></p>
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
                <p className="text-xs text-[#806A8C]">{total} matching transaction{total !== 1 ? "s" : ""} · Page {pos.ownerOrderPage} of {pos.ownerOrderTotalPages}</p>
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

export default function OwnerPOS({ pos }: { pos: UsePOSReturn }) {
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [branchQuery, setBranchQuery] = useState("All Branches");
    const [menuOpen, setMenuOpen] = useState(false);
    const [downloadingVat, setDownloadingVat] = useState(false);
    const [vatDownloadError, setVatDownloadError] = useState<string | null>(null);
    const branchRef = useRef<HTMLDivElement>(null);
    const selectedBranch = pos.branches.find(b => String(b.id) === pos.selectedSalesBranchId);
    const isAllBranches = !pos.selectedSalesBranchId;
    const matchingBranches = useMemo(() => pos.branches.filter(b => b.branchName.toLowerCase().includes(branchQuery.trim().toLowerCase())), [pos.branches, branchQuery]);

    useEffect(() => {
        setCurrentDateTime(new Date());
        const timer = window.setInterval(() => setCurrentDateTime(new Date()), 30000);
        return () => window.clearInterval(timer);
    }, []);
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
    const branchName = (order: Order) => order.branchName || pos.branches.find(b => b.id === order.branchId)?.branchName || "—";
    const isVatRegistered = report?.taxRegistration === "VAT_REGISTERED";
    const vatSummary = report?.vatSummary;

    const downloadVatReport = async () => {
        if (downloadingVat || !isVatRegistered) return;
        setVatDownloadError(null);
        setDownloadingVat(true);
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Please log in again to download the VAT report.");
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
                    ...(pos.ownerOrderSearch.trim() ? { search: pos.ownerOrderSearch.trim() } : {}),
                }),
            });
            const data = await response.json() as {
                export?: boolean;
                error?: string;
                taxRegistration?: string;
                vatSummary?: {
                    vatableSales: number; outputVat: number; customerTotal: number;
                    coverage: string; coverageReason: string | null;
                    unverifiedRecords: number;
                } | null;
                rows?: Array<{
                    orderId: string; date: string; branchName: string; salesSource: string;
                    paymentMode: string; taxType: string; totalInclusive: number;
                    vatableSales: number | null; outputVat: number | null; vatStatus: string;
                }>;
            };
            if (!response.ok || !data.export || data.taxRegistration !== "VAT_REGISTERED" || !Array.isArray(data.rows)) {
                throw new Error(data.error || "VAT report could not be downloaded.");
            }

            const scopeName = selectedBranch?.branchName || "All Branches";
            const storeName = sessionStorage.getItem("business_name") ||
                sessionStorage.getItem("store_name") ||
                sessionStorage.getItem("stocknbook_store_name") || "StockNBook Store";
            const sourceName = pos.ownerSalesSource === "ALL" ? "All Sales" :
                pos.ownerSalesSource === "BOOKING" ? "Booking" : "Walk-in";
            const pdf = createVatReportPdf(
                { vatSummary: data.vatSummary, rows: data.rows },
                storeName, scopeName, dateFrom, dateTo, sourceName,
            );
            const url = URL.createObjectURL(pdf);
            const link = document.createElement("a");
            link.href = url;
            const safeBranch = (selectedBranch?.branchName || "all-branches")
                .replace(/[^a-z0-9_-]+/gi, "-").slice(0, 50);
            link.download = `stocknbook-vat-${safeBranch}-${dateFrom || "all"}-to-${dateTo || "all"}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            setVatDownloadError(error instanceof Error ? error.message : "VAT download failed.");
        } finally {
            setDownloadingVat(false);
        }
    };

    return (
        <div className="flex min-h-screen font-sans text-[#1A1220]" style={{ backgroundColor: "#FDFAF4" }}>
            <RoleSidebar />
            <main className="min-w-0 flex-1 overflow-x-hidden font-sans">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">Sales &amp; Revenue</h1>
                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime ? `${currentDateTime.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} | ${currentDateTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()}` : "Loading date..."}
                            </span>
                            <button type="button" onClick={() => void pos.refreshAll()} aria-label="Refresh sales and revenue"
                                    className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]">
                                <RefreshCw size={16} /> Refresh
                            </button>
                        </div>
                    </div>
                </header>
                <div className="space-y-3 px-6 py-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard label="Total Sales" value={summary?.totalSales == null ? "—" : peso(summary.totalSales)}
                                  helper="Earned booking + completed walk-in sales" icon={<CircleDollarSign size={18} />} iconClassName="bg-[#F0E9FF] text-[#5A35A5]" />
                        <StatCard label="Gross Profit" value={summary?.grossProfit == null ? "—" : peso(summary.grossProfit)}
                                  helper="Revenue less recorded VAT and direct costs" icon={<TrendingUp size={18} />} iconClassName="bg-[#EAF8EF] text-[#168A48]" valueClassName="text-[#168A48]" />
                        <StatCard label="Booking Sales" value={summary?.bookingSales == null ? "—" : peso(summary.bookingSales)}
                                  helper="Completed and fulfilled bookings only" icon={<WalletCards size={18} />} iconClassName="bg-[#FFF2E5] text-[#D56A1F]" valueClassName="text-[#D56A1F]" />
                        <StatCard label="Walk-in Sales" value={summary ? peso(summary.walkInSales) : "—"}
                                  helper="Completed POS walk-in transactions" icon={<ShoppingBag size={18} />} iconClassName="bg-[#EAF1FF] text-[#245EDB]" valueClassName="text-[#245EDB]" />
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
                    {report && report.bookingIntegration.available && summary && summary.missingCostRecords > 0 && (
                        <p role="status" className="px-1 text-xs text-[#806A8C]">Gross profit is unavailable for this scope because {summary.missingCostRecords} transaction(s) lack complete historical direct-cost or tax records.</p>
                    )}
                    <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                        <div className="border-b border-[#E6DDF0] px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-[16px] font-bold text-[#1A1220]">{isAllBranches ? "All Branches Orders" : `${selectedBranch?.branchName || "Branch"} Orders`}</h2>
                                    <p className="mt-0.5 text-xs text-[#7A6A84]">Booking and walk-in sales records · {pos.ownerOrderTotal} matching transactions</p>
                                </div>
                                {isVatRegistered && (
                                    <button
                                        type="button"
                                        onClick={() => void downloadVatReport()}
                                        disabled={downloadingVat}
                                        title="Download filtered VAT transaction PDF"
                                        aria-label="Download filtered VAT transaction PDF"
                                        className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-[#D5C4EB] bg-white text-[#57328E] transition hover:bg-[#F1EAFF] disabled:cursor-wait disabled:opacity-50"
                                    >
                                        <Download size={18} strokeWidth={2} />
                                    </button>
                                )}
                            </div>
                            {vatDownloadError && (
                                <p role="alert" className="mt-2 text-xs font-medium text-[#B42318]">{vatDownloadError}</p>
                            )}
                        </div>
                        <div className="space-y-3 border-b border-[#E6DDF0] px-4 py-3">
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(175px,1fr)_minmax(180px,210px)_minmax(180px,210px)_minmax(125px,155px)_minmax(150px,190px)]">
                                <div className="relative min-w-0">
                                    <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                    <input value={pos.ownerOrderSearch} onChange={e => pos.setOwnerOrderSearch(e.target.value)}
                                           placeholder="Search Order ID or customer..." aria-label="Search Order ID or customer name"
                                           className={`${fieldClass} pl-10 placeholder:text-[#9B8AAA]`} />
                                </div>
                                <DateField label="From" value={dateFrom} max={dateTo || undefined} onChange={v => pos.setOwnerOrderDateRange(v,dateTo)} />
                                <DateField label="To" value={dateTo} min={dateFrom || undefined} onChange={v => pos.setOwnerOrderDateRange(dateFrom,v)} />
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
            </main>
        </div>
    );
}
