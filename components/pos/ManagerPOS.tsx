"use client";

import { useEffect, useState } from "react";

import {
    CalendarDays,
    CheckCircle2,
    Download,
    ChevronDown,
    CircleDollarSign,
    ChevronRight,
    Minus,
    Plus,
    Search,
    ReceiptText,
    ShoppingBag,
    Trash2,
    X,
    WalletCards,
} from "lucide-react";
import type { UsePOSReturn } from "@/hooks/usePOS";
import { createVatReportPdf, createOrderInvoicePdf, type OwnerOrderInvoice } from "./OwnerPOS";
import {
    OrdersTable,
    formatPOSOrderTime,
    formatPOSCustomerType,
    POSLayout,
    StatCard,
    peso,
    type Order,
} from "./_shared";

function parsePOSExpirationDate(value?: string | null) {
    const rawValue = String(value || "").trim();

    if (!rawValue) return null;

    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? new Date(`${rawValue}T00:00:00`)
        : new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) return null;

    parsedDate.setHours(0, 0, 0, 0);
    return parsedDate;
}

function isPOSItemExpired(value?: string | null) {
    const expirationDate = parsePOSExpirationDate(value);

    if (!expirationDate) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return expirationDate.getTime() < today.getTime();
}

function formatPOSExpirationDate(value?: string | null) {
    const expirationDate = parsePOSExpirationDate(value);

    if (!expirationDate) return "";

    return expirationDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}


/** Management view: verified sales and transactions from the signed-in manager's branch only. */
function ManagerSalesView({ pos }: { pos: UsePOSReturn }) {
    const orders = pos.orders;
    const sales = pos.managerOrderSummary.sales;
    const bookingSales = pos.managerOrderSummary.bookingSales;
    const walkInSales = pos.managerOrderSummary.walkInSales;
    const transactions = pos.managerOrderSummary.transactions;
    const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null);
    const [details, setDetails] = useState<Record<string, OwnerOrderInvoice>>({});
    const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
    const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
    const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);
    const [downloadingReport, setDownloadingReport] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);

    const orderKey = (order: Order) => `${order.salesSource === "BOOKING" ? "BOOKING" : "WALK_IN"}:${order.id}`;
    const salesSourceLabel = (order: Order) => order.salesSource === "BOOKING" ? "Booking" : "Walk-in";
    const paymentLabel = (mode?: string | null) => {
        const value = String(mode || "").toUpperCase();
        return ({ CASH: "Cash", GCASH: "GCash", BANK_TRANSFER: "Bank Transfer" } as Record<string, string>)[value]
            || (mode ? mode.replace(/_/g, " ") : "—");
    };
    const downloadFile = (blob: Blob, name: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const loadDetail = async (order: Order, key: string) => {
        if (details[key]) return;
        setLoadingDetail(key);
        setDetailErrors(previous => { const updated = { ...previous }; delete updated[key]; return updated; });
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Please log in again to view transaction details.");
            const response = await fetch("/api/pos", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "get_branch_order_detail",
                    order_id: order.id,
                    sales_source: order.salesSource === "BOOKING" ? "BOOKING" : "WALK_IN",
                }),
            });
            const data = await response.json() as { success?: boolean; error?: string; detail?: OwnerOrderInvoice };
            if (!response.ok || !data.success || !data.detail) {
                throw new Error(data.error || "Unable to retrieve the recorded transaction items.");
            }
            setDetails(previous => ({ ...previous, [key]: data.detail! }));
        } catch (error) {
            setDetailErrors(previous => ({ ...previous,
                [key]: error instanceof Error ? error.message : "Unable to retrieve the transaction." }));
        } finally {
            setLoadingDetail(current => current === key ? null : current);
        }
    };
    const toggleOrder = (order: Order) => {
        const key = orderKey(order);
        if (expandedOrderKey === key) { setExpandedOrderKey(null); return; }
        setExpandedOrderKey(key);
        if (!details[key]) void loadDetail(order, key);
    };
    const downloadInvoice = (detail: OwnerOrderInvoice, key: string) => {
        if (downloadingInvoice || !detail.itemsAvailable) return;
        setDownloadingInvoice(key);
        try {
            downloadFile(createOrderInvoicePdf(detail),
                `stocknbook-order-${detail.orderId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`);
        } catch (error) {
            setDetailErrors(previous => ({ ...previous,
                [key]: error instanceof Error ? error.message : "Unable to download the receipt." }));
        } finally {
            setDownloadingInvoice(null);
        }
    };
    const downloadFilteredReport = async () => {
        if (downloadingReport) return;
        setDownloadingReport(true);
        setReportError(null);
        const dateFrom = pos.managerOrderStartDate;
        const dateTo = pos.managerOrderEndDate;
        const search = pos.managerOrderSearch.trim();
        const source = pos.managerSalesSource;
        const payment = pos.managerPaymentFilter;
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Please log in again to download transactions.");
            const response = await fetch("/api/pos", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "get_branch_sales_report", vat_export: true, sales_source: source,
                    ...(payment !== "ALL" ? { payment_method: payment } : {}),
                    ...(dateFrom ? { date_from: dateFrom } : {}),
                    ...(dateTo ? { date_to: dateTo } : {}),
                    ...(search ? { search } : {}),
                }),
            });
            const data = await response.json() as {
                success?: boolean; export?: boolean; error?: string; taxRegistration?: string;
                rows?: Array<{
                    orderId: string; date: string; createdAt?: string; branchName: string; salesSource: string;
                    paymentMode: string; taxType: string; totalInclusive: number;
                    vatableSales: number | null; outputVat: number | null; vatStatus: string;
                }>;
                transactionSummary?: { count: number; totalSales: number };
                vatSummary?: { vatableSales: number; outputVat: number; customerTotal: number;
                    coverage: string; coverageReason: string | null; unverifiedRecords: number } | null;
                bookingIntegration?: { available: boolean };
            };
            if (!response.ok || !data.success || !data.export || !Array.isArray(data.rows)) {
                throw new Error(data.error || "Unable to download the filtered branch report.");
            }
            const storeName = sessionStorage.getItem("business_name") ||
                sessionStorage.getItem("store_name") ||
                sessionStorage.getItem("stocknbook_store_name") || "StockNBook Store";
            const sourceName = source === "ALL" ? "All Sales" : source === "BOOKING" ? "Booking" : "Walk-in";
            const paymentName = payment === "ALL" ? "" : ` / ${paymentLabel(payment)}`;
            const pdf = createVatReportPdf({
                    rows: data.rows, transactionSummary: data.transactionSummary,
                    vatSummary: data.vatSummary, bookingIntegration: data.bookingIntegration,
                }, storeName, pos.activeBranchName || "Assigned Branch", dateFrom, dateTo,
                `${sourceName}${paymentName}`, data.taxRegistration || "UNKNOWN");
            downloadFile(pdf,
                `stocknbook-branch-transactions-${source.toLowerCase()}-${payment.toLowerCase()}-${dateFrom || "all"}-to-${dateTo || "all"}.pdf`);
        } catch (error) {
            setReportError(error instanceof Error ? error.message : "Transaction download failed.");
        } finally {
            setDownloadingReport(false);
        }
    };

    const filterClass = "h-[42px] w-full min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm text-[#1A1220] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10";
    const tableGrid = "grid w-full min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,.9fr)_minmax(0,.7fr)_minmax(0,.8fr)_minmax(0,1fr)] gap-3";
    const dateField = (id: string, label: string, value: string, min: string | undefined, max: string | undefined, onChange: (next: string) => void) => (
        <div className="relative min-w-0">
            <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
            <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase text-[#806A8C]">{label}</span>
            <input id={id} type="date" value={value} min={min} max={max} onChange={e => onChange(e.target.value)}
                   aria-label={`${label} date`} className={`${filterClass} pl-[75px] pr-2 text-xs font-medium`} />
        </div>
    );

    return (
        <POSLayout role="manager" isOwner={false} activeBranchName={pos.activeBranchName} onRefresh={() => pos.refreshAll()}>
            <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard label="Branch Sales" value={peso(sales)} helper="Verified branch sales matching the selected filters"
                              icon={<CircleDollarSign size={18} />} />
                    <StatCard label="Booking Sales" value={bookingSales == null ? "—" : peso(bookingSales)}
                              helper={bookingSales == null ? "Booking sales could not be verified" : "Completed booking sales matching the selected filters"}
                              icon={<CalendarDays size={18} />} iconClassName="bg-[#FFF2E5] text-[#C8791D]" />
                    <StatCard label="Walk-in Sales" value={peso(walkInSales)}
                              helper="Completed walk-in sales matching the selected filters"
                              icon={<ShoppingBag size={18} />} iconClassName="bg-[#E8F0FF] text-[#2865D9]" />
                    <StatCard label="Transactions" value={transactions} helper="Matching completed branch transactions"
                              icon={<ReceiptText size={18} />} iconClassName="bg-[#E9F8EF] text-[#168A48]" />
                </div>
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">Branch Transaction List</h2>
                            <p className="mt-0.5 text-xs text-[#7A6A84]">{pos.managerOrderTotal} matching branch transactions · {pos.managerSalesSource === "ALL" ? "All Sales" : pos.managerSalesSource === "BOOKING" ? "Booking" : "Walk-in"}</p>
                        </div>
                        <button type="button" onClick={() => void downloadFilteredReport()} disabled={downloadingReport}
                                title="Download all matching branch transactions as PDF" aria-label="Download all matching branch transactions as PDF"
                                className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-[#D5C4EB] bg-white text-[#57328E] transition hover:bg-[#F1EAFF] disabled:cursor-wait disabled:opacity-50">
                            <Download size={18} strokeWidth={2} />
                        </button>
                    </div>
                    {reportError && <p role="alert" className="mb-3 text-xs font-medium text-[#B42318]">{reportError}</p>}
                    {pos.managerOrderError && <p role="alert" className="mb-3 text-xs font-medium text-[#B42318]">{pos.managerOrderError}</p>}
                    {pos.managerBookingAvailable === false && pos.managerSalesSource !== "WALK_IN" && (
                        <p className="mb-3 text-xs text-[#806A8C]">Booking sales could not be verified from the available records. Only verified transactions are listed.</p>
                    )}
                    <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(152px,180px)_minmax(152px,180px)_minmax(135px,155px)_minmax(140px,165px)]">
                        <div className="relative min-w-0">
                            <label className="sr-only" htmlFor="manager-pos-search">Search transactions by Order ID or customer</label>
                            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                            <input id="manager-pos-search" value={pos.managerOrderSearch} onChange={e => pos.setManagerOrderSearch(e.target.value)}
                                   placeholder="Search Order ID or customer..." className={`${filterClass} pl-10 placeholder:text-[#9B8AAA]`} />
                        </div>
                        {dateField("manager-pos-from", "From", pos.managerOrderStartDate, undefined,
                            pos.managerOrderEndDate || undefined, value => pos.setManagerOrderDateRange(value, pos.managerOrderEndDate))}
                        {dateField("manager-pos-to", "To", pos.managerOrderEndDate,
                            pos.managerOrderStartDate || undefined, undefined, value => pos.setManagerOrderDateRange(pos.managerOrderStartDate, value))}
                        <div className="relative min-w-0">
                            <select aria-label="Sales Source" value={pos.managerSalesSource}
                                    onChange={event => pos.setManagerSalesSource(event.target.value as "ALL" | "BOOKING" | "WALK_IN")}
                                    className={`${filterClass} appearance-none pr-8 font-semibold`}>
                                <option value="ALL">All Sales</option>
                                <option value="BOOKING">Booking</option>
                                <option value="WALK_IN">Walk-in</option>
                            </select>
                            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2B174C]" />
                        </div>
                        <div className="relative min-w-0">
                            <select aria-label="Payment Method" value={pos.managerPaymentFilter}
                                    onChange={event => pos.setManagerPaymentFilter(event.target.value as "ALL" | "CASH" | "GCASH" | "BANK_TRANSFER")}
                                    className={`${filterClass} appearance-none pr-8 font-semibold`}>
                                <option value="ALL">All Payments</option>
                                <option value="CASH">Cash</option>
                                <option value="GCASH">GCash</option>
                                <option value="BANK_TRANSFER">Bank Transfer</option>
                            </select>
                            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2B174C]" />
                        </div>
                    </div>
                    {(pos.managerOrderSearch || pos.managerOrderStartDate || pos.managerOrderEndDate || pos.managerSalesSource !== "ALL" || pos.managerPaymentFilter !== "ALL") && (
                        <div className="mb-3 text-right">
                            <button type="button" onClick={() => {
                                pos.setManagerOrderSearch(""); pos.setManagerOrderDateRange("", ""); pos.setManagerSalesSource("ALL"); pos.setManagerPaymentFilter("ALL");
                            }} className="text-xs font-semibold text-[#2B174C] hover:text-[#5B2FC6]">Clear filters</button>
                        </div>
                    )}
                    <div className="max-h-[560px] min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-[#E6DDF0]">
                        <div className={`${tableGrid} sticky top-0 z-10 border-b border-[#E6DDF0] bg-[#F9F6FD] px-4 py-3 text-xs font-semibold text-[#5F4E75]`}>
                            <div>Order ID</div><div>Date / Time</div><div>Payment</div><div>Sales Source</div><div>Total</div><div>Processed By</div>
                        </div>
                        {orders.length === 0 ? (
                            <div className="px-4 py-12 text-center text-sm text-[#9B8AAA]">No branch transactions match these filters.</div>
                        ) : orders.map(order => {
                            const key = orderKey(order);
                            const expanded = expandedOrderKey === key;
                            const detail = details[key];
                            const recordedVat = String(detail?.taxType || "").toUpperCase() === "VAT";
                            const cashier = order.cashierName || (order.cashierId ? `Staff #${order.cashierId}` : "—");
                            return (
                                <div key={key} className="border-b border-[#EFE7F4] last:border-0">
                                    <div className={`${tableGrid} items-start px-4 py-3 text-xs hover:bg-[#FFFCF7]`}>
                                        <div className="flex min-w-0 items-start gap-2">
                                            <button type="button" onClick={() => toggleOrder(order)} aria-expanded={expanded}
                                                    aria-label={`${expanded ? "Collapse" : "Expand"} receipt for order ${order.id}`}
                                                    title="View purchased items and receipt"
                                                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#684B87] hover:bg-[#F1E9FF]">
                                                <ChevronRight size={16} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                                            </button>
                                            <span className="min-w-0 break-all pt-1 font-bold text-[#2B174C]">{order.id}</span>
                                        </div>
                                        <div><p className="font-semibold text-[#2B174C]">{order.date}</p>
                                            <p className="mt-1 text-[11px] text-[#806A8C]">{formatPOSOrderTime(order)}</p></div>
                                        <p className="break-words font-medium text-[#2B174C]">{paymentLabel(order.paymentMode)}</p>
                                        <p className="font-semibold text-[#4F3572]">{salesSourceLabel(order)}</p>
                                        <p className="font-bold text-[#2B174C]">{peso(order.total)}</p>
                                        <p className="break-words text-[#2B174C]">{cashier}</p>
                                    </div>
                                    {expanded && (
                                        <div className="bg-[#FBF9FF] px-4 py-4 sm:pl-12">
                                            {loadingDetail === key && <p role="status" className="text-xs text-[#806A8C]">Loading original transaction details...</p>}
                                            {detailErrors[key] && <div className="flex items-center gap-3">
                                                <p role="alert" className="text-xs text-[#B42318]">{detailErrors[key]}</p>
                                                {!detail && <button type="button" className="text-xs font-semibold text-[#5A35A5] underline"
                                                                    onClick={() => void loadDetail(order, key)}>Try again</button>}
                                            </div>}
                                            {detail && (
                                                <section aria-label={`Receipt for order ${order.id}`} className="overflow-hidden rounded-xl border border-[#E3D8EA] bg-white shadow-sm">
                                                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E8DFF0] px-4 py-3">
                                                        <div className="space-y-1">
                                                            <h3 className="text-sm font-bold text-[#2B174C]">Transaction invoice preview</h3>
                                                            <p className="text-[11px] text-[#806A8C]">{detail.storeName} · {detail.branchName} · {detail.createdAt || detail.date}</p>
                                                            <p className="text-[11px] text-[#806A8C]">Customer: {detail.customerName || "Walk-in"} · Payment: {paymentLabel(detail.paymentMode)} · Tax: {detail.taxType || "Unverified"}</p>
                                                        </div>
                                                        <button type="button" onClick={() => downloadInvoice(detail, key)}
                                                                disabled={!detail.itemsAvailable || downloadingInvoice === key}
                                                                title={detail.itemsAvailable ? "Download itemized order PDF" : "Original items must be verified before export"}
                                                                aria-label={`Download receipt for ${order.id}`}
                                                                className="inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-xl border border-[#D5C4EB] bg-white text-[#57328E] hover:bg-[#F1EAFF] disabled:cursor-not-allowed disabled:opacity-40">
                                                            <Download size={17} />
                                                        </button>
                                                    </div>
                                                    {detail.itemsAvailable ? (
                                                        <div className="overflow-x-auto px-4 py-3">
                                                            <table className="w-full min-w-[530px] text-left text-xs">
                                                                <thead className="border-b border-[#E8DFF0] bg-[#FAF7FF] text-[10px] font-semibold uppercase text-[#806A8C]">
                                                                <tr><th className="px-3 py-2">Item / Service</th><th className="px-3 py-2 text-center">Qty</th><th className="px-3 py-2 text-right">Unit Price</th><th className="px-3 py-2 text-right">Amount</th></tr>
                                                                </thead>
                                                                <tbody>
                                                                {detail.items.map((item, index) => (
                                                                    <tr key={`${index}-${item.name}`} className="border-b border-[#F0EAF5] last:border-0">
                                                                        <td className="px-3 py-2 font-medium text-[#2B174C]">{item.name}</td>
                                                                        <td className="px-3 py-2 text-center">{item.quantity}</td>
                                                                        <td className="px-3 py-2 text-right">{item.unitPrice == null ? "—" : peso(item.unitPrice)}</td>
                                                                        <td className="px-3 py-2 text-right font-semibold">{item.lineTotal == null ? "—" : peso(item.lineTotal)}</td>
                                                                    </tr>
                                                                ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : <p className="px-4 py-4 text-xs text-[#806A8C]">{detail.detailNotice || "Itemized details are not available in the saved transaction."} The invoice cannot be downloaded without verified item prices.</p>}
                                                    <div className="space-y-1 border-t border-[#E8DFF0] bg-[#FAF7FF] px-4 py-3 text-xs">
                                                        {recordedVat && detail.vatAmount != null && detail.total != null && <>
                                                            <p className="flex justify-between gap-4"><span className="text-[#806A8C]">VATable Sales (recorded)</span><strong>{peso(detail.total - detail.vatAmount)}</strong></p>
                                                            <p className="flex justify-between gap-4"><span className="text-[#806A8C]">Output VAT (recorded)</span><strong>{peso(detail.vatAmount)}</strong></p>
                                                        </>}
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
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        {pos.managerOrderTotalPages > 1 && <div className="flex gap-2">
                            <button type="button" disabled={pos.managerOrderPage <= 1}
                                    onClick={() => pos.setManagerOrderPage(Math.max(1, pos.managerOrderPage - 1))}
                                    className="rounded-lg border border-[#D8CBE7] px-3.5 py-2 text-xs font-semibold text-[#2B174C] disabled:opacity-40">Previous</button>
                            <button type="button" disabled={pos.managerOrderPage >= pos.managerOrderTotalPages}
                                    onClick={() => pos.setManagerOrderPage(Math.min(pos.managerOrderTotalPages, pos.managerOrderPage + 1))}
                                    className="rounded-lg bg-[#2B174C] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40">Next</button>
                        </div>}
                    </div>
                </section>
            </div>
        </POSLayout>
    );
}

function isWalkInPosOrder(order: Order) {
    if (String(order.customerType || "").toUpperCase() === "WALK_IN") return true;
    const customer = String(order.customer || "").trim().toLowerCase();
    const posOrder = String(order.id || "").toUpperCase().includes("-POS-");
    const posInvoice = String(order.controlNumber || "").toUpperCase().startsWith("INV-");
    return (customer === "walk-in" || customer === "walk-in customer") && (posOrder || posInvoice);
}

export function BranchPOSView({ pos }: { pos: UsePOSReturn }) {
    const isManager = pos.role === "manager";
    // Only Staff render checkout; Manager has a separate read-only sales view.
    if (isManager) return <ManagerSalesView pos={pos} />;
    const staffTodayOrders = pos.todayOrders.filter(isWalkInPosOrder);
    const completedTodayOrders = staffTodayOrders;
    const staffTodaySales = completedTodayOrders.reduce((total, order) => total + Number(order.total || 0), 0);
    const staffCashSales = completedTodayOrders
        .filter(order => String(order.paymentMode || "").toUpperCase() === "CASH")
        .reduce((total, order) => total + Number(order.total || 0), 0);
    // Count product units sold, not the number of orders or distinct products.
    // Avoid reporting an incomplete total as zero when item quantities are unavailable.
    const itemsSoldComplete = completedTodayOrders.every(order =>
        order.items.length > 0 && order.items.every(item =>
            Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0));
    const itemsSoldToday = completedTodayOrders.reduce((total, order) =>
        total + order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0), 0);

    // Use the original completed order item snapshots for the same A4 invoice-style
    // internal copy used by Owner and Manager; never infer missing line prices.
    const downloadStaffInvoice = (order: Order) => {
        const lines = order.items.map(item => ({
            name: item.name, quantity: item.quantity,
            unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
            lineTotal: item.lineTotal == null ? null : Number(item.lineTotal),
        }));
        const itemsAvailable = lines.length > 0 && lines.every(item =>
            Boolean(item.name.trim()) && Number(item.quantity) > 0 &&
            item.unitPrice != null && Number.isFinite(item.unitPrice) &&
            item.lineTotal != null && Number.isFinite(item.lineTotal));
        if (!itemsAvailable) return;
        const detail: OwnerOrderInvoice = {
            orderId: order.id,
            storeName: sessionStorage.getItem("business_name") ||
                sessionStorage.getItem("store_name") ||
                sessionStorage.getItem("stocknbook_store_name") || "StockNBook Store",
            branchName: order.branchName || pos.activeBranchName || "Assigned Branch",
            salesSource: "WALK_IN", customerName: "Walk-in", date: order.date,
            createdAt: order.createdAt || order.date,
            paymentMode: order.paymentMode || "Not recorded",
            taxType: order.taxType || null,
            vatAmount: order.taxType?.toUpperCase() === "VAT" ? Number(order.vatAmount || 0) : null,
            total: Number(order.total), items: lines, itemsAvailable,
            detailNotice: null, officialInvoiceNumber: null,
        };
        try {
            const pdf = createOrderInvoicePdf(detail);
            const url = URL.createObjectURL(pdf);
            const link = document.createElement("a");
            link.href = url;
            link.download = `stocknbook-order-${order.id.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            alert(error instanceof Error ? error.message : "Unable to download the recorded transaction.");
        }
    };

    return (
        <POSLayout
            role={pos.role}
            isOwner={pos.isOwner}
            activeBranchName={pos.activeBranchName}
            onRefresh={() => pos.refreshAll()}
        >
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Today's Walk-in Sales" value={peso(staffTodaySales)}
                          helper="Completed walk-in sales at your branch today"
                          icon={<CircleDollarSign size={18} />} />
                <StatCard label="Walk-in Transactions" value={completedTodayOrders.length}
                          helper="Completed walk-in POS transactions today"
                          icon={<ReceiptText size={18} />} iconClassName="bg-[#E8F0FF] text-[#2865D9]" />
                <StatCard label="Cash Walk-in Sales" value={peso(staffCashSales)}
                          helper="Today's walk-in payments made in cash"
                          icon={<WalletCards size={18} />} iconClassName="bg-[#E9F8EF] text-[#168A48]" />
                <StatCard label="Items Sold Today" value={itemsSoldComplete ? itemsSoldToday : "—"}
                          helper={itemsSoldComplete ? "Product units sold in today's completed walk-in sales" : "Some completed sales lack item quantities"}
                          icon={<ShoppingBag size={18} />} iconClassName="bg-[#FFF2E5] text-[#C8791D]" />
            </div>

            <div className="space-y-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
                    <section className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                        <div className="mb-3 grid gap-3 lg:grid-cols-[1fr_220px]">
                            <div className="relative">
                                <Search
                                    size={16}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                                />

                                <input
                                    value={pos.search}
                                    onChange={(e) => pos.setSearch(e.target.value)}
                                    placeholder="Search items or variants..."
                                    className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                                />
                            </div>

                            <select
                                value={pos.categoryFilter}
                                onChange={(e) => pos.setCategoryFilter(e.target.value)}
                                className="rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm font-semibold text-[#1A1220] outline-none shadow-sm focus:border-[#2B174C]"
                            >
                                {pos.categories.map((c) => (
                                    <option key={c} value={c}>
                                        {c === "All" ? "All Categories" : c}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <POSProductTable pos={pos} />
                    </section>

                    <CurrentOrderPanel pos={pos} />
                </div>

                <div className="grid grid-cols-1 gap-3">
                    <OrdersTable
                        title="Today's Orders"
                        subtitle={`${staffTodayOrders.length} walk-in POS transaction${staffTodayOrders.length !== 1 ? "s" : ""} recorded today`}
                        orders={staffTodayOrders}
                        emptyText="No walk-in POS orders recorded today."
                        containerClassName="min-h-[320px] flex flex-col"
                        scrollAreaClassName="max-h-[380px] flex-1 overflow-y-auto"
                        allowHorizontalScroll={false}
                        stickyHeader
                        showPayment
                        showTimeOnly
                        renderActions={order => {
                            const verified = order.items.length > 0 && order.items.every(item =>
                                Boolean(item.name.trim()) && item.quantity > 0 &&
                                item.unitPrice != null && Number.isFinite(Number(item.unitPrice)) &&
                                item.lineTotal != null && Number.isFinite(Number(item.lineTotal)));
                            return (
                                <button type="button" onClick={() => downloadStaffInvoice(order)} disabled={!verified}
                                        aria-label={`Download transaction invoice for ${order.id}`}
                                        title={verified ? "Download itemized transaction PDF" : "Historical item details must be verified before download"}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#D5C4EB] bg-white text-[#57328E] hover:bg-[#F1EAFF] disabled:cursor-not-allowed disabled:opacity-40">
                                    <Download size={17} />
                                </button>
                            );
                        }}
                    />
                </div>
            </div>

        </POSLayout>
    );
}

function POSProductTable({ pos }: { pos: UsePOSReturn }) {
    const [expandedProductIds, setExpandedProductIds] = useState<Record<number, boolean>>({});

    const toggleProduct = (productId: number) => {
        setExpandedProductIds((prev) => ({
            ...prev,
            [productId]: !(prev[productId] ?? false),
        }));
    };

    const getProductKey = (productId: number) => String(productId);

    const getVariantKey = (productId: number, variantId: number) =>
        `${productId}-${variantId}`;

    const getStockStatus = (stock: number, alertLevel: number) => {
        if (stock <= 0) {
            return {
                label: "Out of stock",
                className: "text-red-600",
            };
        }

        if (stock <= alertLevel) {
            return {
                label: "Low stock",
                className: "text-[#B7791F]",
            };
        }

        return {
            label: "Available",
            className: "text-green-600",
        };
    };

    const renderQtyControls = (
        key: string,
        stock: number,
        expired: boolean
    ) => {
        const qty = pos.cart[key] || 0;
        const out = stock <= 0;
        const isMax = qty >= stock && stock > 0;

        return (
            <div className="flex items-center justify-center gap-3">
                <button
                    onClick={() => pos.handleQty(key, -1)}
                    disabled={qty <= 0 || expired || out}
                    title={expired ? "Expired item cannot be sold" : out ? "Out-of-stock item cannot be sold" : undefined}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                >
                    <Minus size={13} />
                </button>

                <span className="min-w-6 text-center text-sm font-semibold text-[#1A1220]">
                    {qty}
                </span>

                <button
                    onClick={() => pos.handleQty(key, 1)}
                    disabled={expired || out || isMax}
                    aria-label={expired ? "Expired item cannot be sold" : out ? "Out-of-stock item cannot be sold" : "Increase quantity"}
                    title={expired ? "Expired item cannot be sold" : out ? "Out-of-stock item cannot be sold" : undefined}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                >
                    <Plus size={13} />
                </button>
            </div>
        );
    };

    const productGridClass =
        "grid min-w-[760px] grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)_minmax(70px,0.55fr)_minmax(90px,0.65fr)_minmax(145px,0.9fr)]";

    if (pos.displayProducts.length === 0) {
        return (
            <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                <p className="text-sm text-[#9B8AAA]">No products found.</p>
            </div>
        );
    }

    return (
        <div className="max-w-full overflow-x-auto rounded-[14px] border border-[#E6DDF0] bg-white">
            <div className="w-full min-w-[760px]">
                <div
                    className={`${productGridClass} border-b border-[#E6DDF0] bg-[#F9F6FD] px-5 py-3 text-xs font-semibold text-[#5F4E75]`}
                >
                    <div className="text-left">Product</div>
                    <div className="text-center">Category</div>
                    <div className="text-center">Stock</div>
                    <div className="text-center">Price</div>
                    <div className="text-center">Qty / Action</div>
                </div>

                <div className="max-h-[560px] overflow-y-auto">
                    {pos.displayProducts.map((product) => {
                        const variants = Array.isArray(product.variants)
                            ? product.variants
                            : [];
                        const hasVariants = variants.length > 0;
                        const isExpanded = expandedProductIds[product.id] ?? false;

                        if (hasVariants) {
                            return (
                                <div
                                    key={product.id}
                                    className="border-b border-[#EFE7F4] last:border-0"
                                >
                                    <div
                                        className={`${productGridClass} min-h-[78px] items-center px-5 transition hover:bg-[#FFFCF7]`}
                                    >
                                        <div className="min-w-0 pr-4">
                                            <div className="flex items-start gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleProduct(product.id)}
                                                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[#2B174C] hover:text-[#5F4E75]"
                                                    title={
                                                        isExpanded
                                                            ? "Hide variants"
                                                            : "Show variants"
                                                    }
                                                >
                                                    {isExpanded ? (
                                                        <ChevronDown size={17} />
                                                    ) : (
                                                        <ChevronRight size={17} />
                                                    )}
                                                </button>

                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold text-[#1A1220]">
                                                        {product.name}
                                                    </p>

                                                    <p className="mt-0.5 text-xs font-medium text-[#806A8C]">
                                                        Click to view {variants.length} variant
                                                        {variants.length !== 1 ? "s" : ""}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="truncate text-center text-sm text-[#5F4E75]">
                                            {product.category || "Uncategorized"}
                                        </div>

                                        <div className="text-center text-sm font-semibold text-[#9B8AAA]" />

                                        <div className="text-center text-sm font-semibold text-[#9B8AAA]" />

                                        <div className="flex justify-center">
                                            <button
                                                type="button"
                                                onClick={() => toggleProduct(product.id)}
                                                className="inline-flex min-w-[150px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-3 py-2 text-xs font-semibold text-[#2B174C] shadow-sm hover:bg-[#F7F1FF]"
                                            >
                                                Choose Variant
                                                {isExpanded ? (
                                                    <ChevronDown size={14} />
                                                ) : (
                                                    <ChevronRight size={14} />
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="overflow-hidden">
                                            {variants.map((variant, index) => {
                                                const key = getVariantKey(
                                                    product.id,
                                                    variant.id
                                                );
                                                const status = getStockStatus(
                                                    Number(variant.stock || 0),
                                                    Number(variant.alertLevel || 0)
                                                );
                                                const isExpired = isPOSItemExpired(
                                                    variant.expirationDate
                                                );
                                                const isFirstVariant = index === 0;
                                                const isLastVariant =
                                                    index === variants.length - 1;

                                                return (
                                                    <div
                                                        key={key}
                                                        className={`${productGridClass} min-h-[78px] items-center border-b border-[#EFE7F4] bg-[#FCF9FF] px-5 last:border-0`}
                                                    >
                                                        <div className="min-w-0 pr-4">
                                                            <div className="ml-8 flex items-center gap-3">
                                                                <div className="relative flex h-10 w-5 shrink-0 justify-center">
                                                                    {!isFirstVariant && (
                                                                        <span className="absolute -top-5 h-8 border-l border-dashed border-[#B99DDB]" />
                                                                    )}

                                                                    {!isLastVariant && (
                                                                        <span className="absolute top-5 h-10 border-l border-dashed border-[#B99DDB]" />
                                                                    )}

                                                                    <span className="relative z-10 mt-[15px] h-2.5 w-2.5 rounded-full bg-[#9B6BD3]" />
                                                                </div>

                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <p
                                                                            className={`truncate text-sm font-semibold ${
                                                                                isExpired
                                                                                    ? "text-[#C32F2F]"
                                                                                    : "text-[#2B174C]"
                                                                            }`}
                                                                        >
                                                                            {variant.name || "Variant"}
                                                                        </p>

                                                                        {isExpired && (
                                                                            <span className="rounded-full border border-[#F2C4C4] bg-[#FFF0F0] px-2 py-0.5 text-[10px] font-semibold text-[#C32F2F]">
                                                                                Expired
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    <p
                                                                        className={`mt-0.5 text-xs font-semibold ${
                                                                            isExpired
                                                                                ? "text-[#C32F2F]"
                                                                                : status.className
                                                                        }`}
                                                                    >
                                                                        {isExpired
                                                                            ? `Expired ${formatPOSExpirationDate(
                                                                                variant.expirationDate
                                                                            )} · Cannot be sold`
                                                                            : status.label}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="truncate text-center text-xs text-[#9B8AAA]">
                                                            —
                                                        </div>

                                                        <div className="text-center text-sm font-semibold text-[#1A1220]">
                                                            {variant.stock}
                                                        </div>

                                                        <div className="text-center text-sm font-semibold text-[#1A1220]">
                                                            {peso(Number(variant.salesPrice || 0))}
                                                        </div>

                                                        {renderQtyControls(
                                                            key,
                                                            Number(variant.stock || 0),
                                                            isExpired
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        const key = getProductKey(product.id);
                        const status = getStockStatus(
                            Number(product.stock || 0),
                            Number(product.alertLevel || 0)
                        );
                        const isExpired = isPOSItemExpired(
                            product.expirationDate
                        );

                        return (
                            <div
                                key={product.id}
                                className={`${productGridClass} min-h-[78px] items-center border-b border-[#EFE7F4] px-5 py-4 transition last:border-0 hover:bg-[#FFFCF7]`}
                            >
                                <div className="min-w-0 pl-9 pr-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p
                                            className={`truncate text-sm font-semibold ${
                                                isExpired
                                                    ? "text-[#C32F2F]"
                                                    : "text-[#1A1220]"
                                            }`}
                                        >
                                            {product.name}
                                        </p>

                                        {isExpired && (
                                            <span className="rounded-full border border-[#F2C4C4] bg-[#FFF0F0] px-2 py-0.5 text-[10px] font-semibold text-[#C32F2F]">
                                                Expired
                                            </span>
                                        )}
                                    </div>

                                    <p
                                        className={`mt-0.5 text-xs font-semibold ${
                                            isExpired
                                                ? "text-[#C32F2F]"
                                                : status.className
                                        }`}
                                    >
                                        {isExpired
                                            ? `Expired ${formatPOSExpirationDate(
                                                product.expirationDate
                                            )} · Cannot be sold`
                                            : status.label}
                                    </p>
                                </div>

                                <div className="truncate text-center text-sm text-[#5F4E75]">
                                    {product.category || "Uncategorized"}
                                </div>

                                <div className="text-center text-sm font-semibold text-[#1A1220]">
                                    {product.stock}
                                </div>

                                <div className="text-center text-sm font-semibold text-[#1A1220]">
                                    {peso(Number(product.salesPrice || 0))}
                                </div>

                                {renderQtyControls(
                                    key,
                                    Number(product.stock || 0),
                                    isExpired
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

type SaleSuccessToastMessage = {
    title: string;
    message: string;
};

function SaleSuccessToast({
                              toast,
                              onClose,
                          }: {
    toast: SaleSuccessToastMessage | null;
    onClose: () => void;
}) {
    useEffect(() => {
        if (!toast) {
            return;
        }

        const closeTimer = window.setTimeout(() => {
            onClose();
        }, 5600);

        return () => {
            window.clearTimeout(closeTimer);
        };
    }, [toast, onClose]);

    if (!toast) {
        return null;
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed bottom-5 right-5 z-[140] flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl border border-[#BCE8CA] bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)]"
        >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E5F8EC] text-[#23834A]">
                <CheckCircle2 size={20} strokeWidth={2.4} />
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1A1220]">{toast.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-[#6A5D6F]">
                    {toast.message}
                </p>
            </div>

            <button
                type="button"
                onClick={onClose}
                aria-label="Dismiss notification"
                className="shrink-0 text-lg leading-none text-[#9B8AAA] transition hover:text-[#2B174C]"
            >
                ×
            </button>
        </div>
    );
}

function CurrentOrderPanel({ pos }: { pos: UsePOSReturn }) {
    const [successToast, setSuccessToast] =
        useState<SaleSuccessToastMessage | null>(null);

    const staffPaymentMode = String(pos.paymentMode || "CASH").toUpperCase();
    const isDigitalPayment = staffPaymentMode === "GCASH" || staffPaymentMode === "BANK_TRANSFER";

    // Digital payments are entered and confirmed by Staff, never auto-filled.
    // Do not generate a completed order before the full received amount is verified.

    const hasExpiredCartItem = pos.cartItems.some((item) =>
        isPOSItemExpired(item.expirationDate)
    );

    const orderGridClass =
        "grid min-w-[360px] grid-cols-[minmax(0,1fr)_62px_76px_82px_24px]";


    const handlePlaceOrderClick = async () => {
        if (pos.cartItems.length === 0) return;

        const expiredCartItem = pos.cartItems.find((item) =>
            isPOSItemExpired(item.expirationDate)
        );

        if (expiredCartItem) {
            alert(
                `Expired item "${expiredCartItem.name}" cannot be sold. Remove it from the current order first.`
            );
            return;
        }

        const paymentText = String(pos.payment || "").trim();
        const paidAmount =
            Number(paymentText.replace(/,/g, ""));

        if (paymentText === "") {
            alert("Please enter customer payment.");
            return;
        }

        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
            alert("Please enter a valid customer payment.");
            return;
        }

        if (paidAmount < pos.total) {
            alert("Amount Received must be equal to or greater than Grand Total.");
            return;
        }

        if (isDigitalPayment && Math.round(paidAmount * 100) !== Math.round(pos.total * 100)) {
            alert("GCash and Bank Transfer must be verified for the exact Grand Total; no change is given.");
            return;
        }

        const placedOrder = await Promise.resolve(pos.handlePlaceOrder());

        if (!placedOrder) {
            return;
        }

        setSuccessToast({
            title: "Order placed successfully",
            message:
                "Payment recorded and inventory updated.",
        });

    };

    return (
        <>
            <SaleSuccessToast
                toast={successToast}
                onClose={() => setSuccessToast(null)}
            />

            <aside className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm xl:sticky xl:top-24 xl:self-start">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                        Current Order
                    </h2>

                    {pos.cartItems.length > 0 && (
                        <button
                            type="button"
                            onClick={() => pos.resetOrderDraft("Walk-in")}
                            className="text-red-500 hover:text-red-600"
                            title="Clear order"
                        >
                            <Trash2 size={20} />
                        </button>
                    )}
                </div>

                <div className="border-t border-[#E6DDF0] pt-4">
                    <div className="w-full overflow-x-auto">
                        <div
                            className={`${orderGridClass} gap-1 px-1 pb-3 text-[10px] font-semibold text-[#5F4E75]`}
                        >
                            <div>Item</div>
                            <div className="text-center">Qty</div>
                            <div className="text-right whitespace-nowrap">Unit Price</div>
                            <div className="text-right whitespace-nowrap">Subtotal</div>
                            <div />
                        </div>

                        <div className="max-h-[330px] space-y-0 overflow-y-auto pr-1">
                            {pos.cartItems.length === 0 ? (
                                <div className="flex min-h-[150px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                                    <p className="text-sm text-[#9B8AAA]">
                                        No items added yet.
                                    </p>
                                </div>
                            ) : (
                                pos.cartItems.map((item) => {
                                    const itemExpired = isPOSItemExpired(item.expirationDate);
                                    const itemOutOfStock = Number(item.stock || 0) <= 0;
                                    const nameParts = item.name.split("/");
                                    const productName = nameParts[0] || item.name;
                                    const variantName = nameParts.slice(1).join(" / ");

                                    return (
                                        <div
                                            key={item.key}
                                            className={`${orderGridClass} items-center gap-1 border-b border-[#EFE7F4] px-1 py-3 last:border-0`}
                                        >
                                            <div className="min-w-0 pr-1">
                                                <p className="truncate text-[12px] font-semibold leading-4 text-[#1A1220]">
                                                    {productName}
                                                </p>

                                                {variantName && (
                                                    <p
                                                        className="mt-0.5 truncate text-[10px] font-medium leading-4 text-[#6A5D6F]"
                                                        title={variantName}
                                                    >
                                                        / {variantName}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() =>
                                                        pos.handleQty(item.key, -1)
                                                    }
                                                    disabled={item.qty <= 0 || itemExpired || itemOutOfStock}
                                                    className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] disabled:cursor-not-allowed disabled:opacity-40"
                                                    type="button"
                                                >
                                                    <Minus size={10} />
                                                </button>

                                                <input
                                                    value={String(item.qty)}
                                                    onChange={(e) => {
                                                        const cleanValue =
                                                            e.target.value.replace(
                                                                /[^0-9]/g,
                                                                ""
                                                            );
                                                        const nextQty =
                                                            cleanValue === ""
                                                                ? 0
                                                                : Number(cleanValue);

                                                        pos.setQty(item.key, nextQty);
                                                    }}
                                                    onFocus={(e) => e.target.select()}
                                                    disabled={itemExpired || itemOutOfStock}
                                                    className="h-6 w-8 rounded-lg border border-[#E6DDF0] bg-white text-center text-[11px] font-semibold leading-4 text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-1 focus:ring-[#2B174C] disabled:cursor-not-allowed disabled:bg-[#F5F1F7] disabled:text-[#9B8AAA]"
                                                    inputMode="numeric"
                                                />

                                                <button
                                                    onClick={() =>
                                                        pos.handleQty(item.key, 1)
                                                    }
                                                    disabled={itemExpired || itemOutOfStock || item.qty >= item.stock}
                                                    className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] disabled:cursor-not-allowed disabled:opacity-40"
                                                    type="button"
                                                >
                                                    <Plus size={10} />
                                                </button>
                                            </div>

                                            <div className="text-right text-[12px] font-semibold leading-4 text-[#1A1220]">
                                                {peso(item.price)}
                                            </div>

                                            <div className="text-right text-[12px] font-semibold leading-4 text-[#1A1220]">
                                                {peso(item.lineTotal)}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    pos.removeItemFromCart(item.key)
                                                }
                                                className="flex h-6 w-6 items-center justify-center rounded-lg text-[#5F4E75] hover:bg-[#F7F1FF] hover:text-red-500"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-4 border-t border-dashed border-[#D6CBE0] pt-4">
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">Customer Type</label>
                            <div className="flex min-h-[42px] items-center rounded-xl border border-[#E3D8EA] bg-[#F8F5FA] px-4 py-2.5 text-sm font-semibold text-[#1A1220]">Walk-in</div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-[#5A476A]">Payment Mode</label>
                                <select
                                    value={String(pos.paymentMode).toUpperCase()}
                                    onChange={(e) => {
                                        const mode = e.target.value as "CASH" | "GCASH" | "BANK_TRANSFER";
                                        // Existing usePOS state is the source for checkout's payment_mode.
                                        // Extend its PaymentMode union to include GCASH and BANK_TRANSFER.
                                        pos.setPaymentMode(mode as Parameters<typeof pos.setPaymentMode>[0]);
                                        pos.setCustomerName("Walk-in");
                                        pos.setCustomerAddress("N/A");
                                        pos.setCustomerContactNumber("");
                                        pos.setPayment("");
                                    }}
                                    className="w-full rounded-xl border border-[#E3D8EA] bg-white px-3 py-2.5 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C]"
                                >
                                    <option value="CASH">Cash</option>
                                    <option value="GCASH">GCash</option>
                                    <option value="BANK_TRANSFER">Bank Transfer</option>
                                </select>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                    Tax Treatment <span className="text-[10px] font-normal text-[#8B7A95]">(System-controlled)</span>
                                </label>
                                <div
                                    className="flex min-h-[42px] items-center rounded-xl border border-[#E3D8EA] bg-[#F8F5FA] px-3 py-2.5 text-sm font-semibold text-[#1A1220]"
                                    title="Tax treatment is controlled by the business tax registration."
                                >
                                    {pos.taxType === "VAT" ? "VAT Registered (12%)" : "Non-VAT Registered"}
                                </div>
                            </div>
                        </div>

                    </div>

                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-[19px] font-bold text-[#1A1220]">
                            Total
                        </span>
                        <span className="text-[19px] font-bold text-[#1A1220]">
                            {peso(pos.total)}
                        </span>
                    </div>

                    <div className="mb-3 space-y-1.5 rounded-xl border border-[#E6DDF0] bg-[#FCFAFD] px-4 py-3 text-xs">
                        {pos.taxType === "VAT" ? (
                            <>
                                <div className="flex items-center justify-between text-[#6A5D6F]">
                                    <span>VATable Sales</span>
                                    <span className="font-semibold text-[#1A1220]">{peso(pos.vatableSales)}</span>
                                </div>
                                <div className="flex items-center justify-between text-[#6A5D6F]">
                                    <span>VAT Amount (12%)</span>
                                    <span className="font-semibold text-[#1A1220]">{peso(pos.vatAmount)}</span>
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center justify-between text-[#6A5D6F]">
                                <span>Non-VAT Sales</span>
                                <span className="font-semibold text-[#1A1220]">{peso(pos.total)}</span>
                            </div>
                        )}
                        <div className="flex items-center justify-between border-t border-[#E6DDF0] pt-1.5 font-semibold text-[#2B174C]">
                            <span>Grand Total</span>
                            <span>{peso(pos.total)}</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                Amount Received
                            </label>

                            <input
                                value={pos.payment}
                                onChange={(e) => pos.setPayment(e.target.value)}
                                title={isDigitalPayment ? "Enter the amount actually verified in GCash or the bank account" : undefined}
                                inputMode="decimal"
                                placeholder="0.00"
                                className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] shadow-sm focus:border-[#2B174C] focus:outline-none"
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-[#D8F0DD] bg-[#EEF9F0] px-4 py-3">
                            <span className="text-sm font-semibold text-green-700">
                                {isDigitalPayment ? "Digital Payment" : "Change"}
                            </span>

                            <span className="text-sm font-semibold text-[#1A1220]">
                                {isDigitalPayment ? "No cash change" : peso(pos.change)}
                            </span>
                        </div>

                        <button
                            onClick={() => void handlePlaceOrderClick()}
                            disabled={
                                (isDigitalPayment
                                    ? pos.cartItems.length === 0 || Math.round(Number(pos.payment || 0) * 100) !== Math.round(pos.total * 100)
                                    : !pos.canPlaceOrder) ||
                                hasExpiredCartItem
                            }
                            title={
                                hasExpiredCartItem
                                    ? "Remove expired items before placing the order"
                                    : undefined
                            }
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40"
                            type="button"
                        >
                            <ShoppingBag size={20} />
                            Place Order
                        </button>
                    </div>
                </div>
            </aside>

        </>
    );
}

export default function ManagerPOS({ pos }: { pos: UsePOSReturn }) {
    return <BranchPOSView pos={pos} />;
}
