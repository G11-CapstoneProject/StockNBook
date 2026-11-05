"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { fieldClass, labelClass } from "./_shared";
import {
    BarChart3, Box, Building2, CheckCircle2,
    Download,
    ReceiptText, RefreshCw, Search, ShoppingCart, TrendingUp, Wallet, X,
} from "lucide-react";

type Branch = { id: number; branchName: string };
type Amount = number | null;
type TrendPoint = { date: string; consumableSales: Amount; rentalRevenue: Amount };
type BranchRevenue = { branchId: number | null; branchName: string; consumableSales: Amount; rentalRevenue: Amount };
type ConsumablePerformance = { key: string; name: string; unitsSold: number; sales: number; grossProfit: Amount };
type RentalPerformance = { key: string; name: string; revenue: number; share: number };
type OwnerPerformance = {
    dateRange: { startDate: string; endDate: string };
    asOfDate: string;
    storeName: string;
    branches: Branch[];
    totals: { consumableSales: Amount; consumableGrossProfit: Amount; rentalRevenue: Amount; totalRevenue: Amount };
    trend: TrendPoint[];
    branchRevenue: BranchRevenue[];
    consumables: ConsumablePerformance[];
    rentals: RentalPerformance[];
    warnings: string[];
};
type SupplierPurchase = {
    purchaseId: number; branchId: number; branchName?: string | null; purchaseNumber: string;
    supplier: string; supplierInvoiceNumber: string | null; purchaseTotal: number; amountPaid: number;
    outstandingBalance: number; paymentStatus: string; paymentMethod: "cash" | "credit";
    purchaseDate: string; recordedAt?: string | null; paymentDueDate: string | null;
};
type SupplierBill = SupplierPurchase & { key: string; source: "consumable" | "rental" };
type PurchaseItem = {
    productId?: number; productNumber?: string | null; productName?: string;
    equipmentId?: number; equipmentNumber?: string | null; name?: string;
    variantId?: number | null; variantNumber?: string | null;
    variantValues?: Record<string, string> | string | null;
    quantity: number; unitCost: number; lineTotal: number;
};
type BillStatus = "Paid" | "Overdue" | "Due soon" | "Partially paid" | "Unpaid";
type DateRange = { startDate: string; endDate: string };

const cardClass = "min-w-0 overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm";
const scrollPanel = "min-h-0 w-full overflow-auto overscroll-contain border-t border-[#E9E1EE]";
const headerCell = "truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
const bodyCell = "px-2 py-2 text-center text-xs text-[#4F3A5A]";
const firstBodyCell = "px-4 py-2 text-left text-xs text-[#4F3A5A]";

function businessDateString() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}
// Revenue figures cover the 1st of the current month up to today (Philippine time),
// the same default period the inventory report API uses when no dates are sent.
function monthToDateRange(): DateRange {
    const today = businessDateString();
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}
function formatPeso(value: number) {
    return value.toLocaleString("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatNumber(value: number) {
    return value.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}
function shortDate(value?: string | null, year = true) {
    if (!value) return "—";
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", ...(year ? { year: "numeric" as const } : {}),
    });
}
function formatSupplierPurchaseDate(value?: string | null) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
    if (!match) return "—";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) return "—";
    const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
    return `${months[month - 1]} ${day}, ${year}`;
}
function formatPurchaseRecordedTime(value?: string | null) {
    // created_at records when StockNBook saved the purchase, not the supplier's transaction time.
    // The API returns database-local clock text; avoid converting an unknown timezone.
    const match = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/.exec(value || "");
    if (!match || Number(match[1]) > 23) return "—";
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}
function shownMoney(value: Amount | undefined) {
    return value == null || !Number.isFinite(value) ? "—" : formatPeso(value);
}
function billStatus(bill: SupplierPurchase, today = businessDateString()): BillStatus {
    if (Number(bill.outstandingBalance) <= 0) return "Paid";
    const due = bill.paymentDueDate?.slice(0, 10);
    if (due && due < today) return "Overdue";
    if (Number(bill.amountPaid) > 0) return "Partially paid";
    const soon = new Date(`${today}T00:00:00Z`);
    soon.setUTCDate(soon.getUTCDate() + 7);
    return due && due <= soon.toISOString().slice(0, 10) ? "Due soon" : "Unpaid";
}
function supplierEndpoint(source: SupplierBill["source"]) {
    return source === "rental" ? "/api/rental-inventory" : "/api/products";
}
async function ownerRequest<T>(endpoint: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body), cache: "no-store", signal,
    });
    const payload = await response.json().catch(() => {
        throw new Error(`The inventory API returned an invalid response (HTTP ${response.status}).`);
    }) as T & { success?: boolean; error?: string };
    if (!response.ok || payload.success === false) throw new Error(payload.error || `Inventory request failed (HTTP ${response.status}).`);
    return payload;
}
function SectionHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
    return <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5] [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
        <div className="min-w-0"><h2 className="text-[15px] font-bold text-[#21132E]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-[#86778F]">{subtitle}</p>}</div>
    </div>;
}
function MetricCard({ label, value, helper, icon, loading = false, tone = "purple" }: {
    label: string; value: string; helper: string; icon: React.ReactNode;
    loading?: boolean; tone?: "purple" | "green" | "blue" | "red";
}) {
    const iconClassName = {
        purple: "bg-[#F1ECFF] text-[#5F35D8]",
        green: "bg-[#E5F8EC] text-[#23834A]",
        blue: "bg-[#E9F2FF] text-[#1E6FE8]",
        red: "bg-[#FFE8E8] text-[#E23B4A]",
    }[tone];
    return (
        <article aria-busy={loading} className="flex min-h-[116px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm">
            {loading ? <>
                <span className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-[#EEE8F3]" aria-hidden="true"/>
                <span className="min-w-0 flex-1 space-y-2.5" role="status" aria-label={`Loading ${label}`}>
                    <span className="block h-3.5 w-32 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                    <span className="block h-7 w-24 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                    <span className="block h-2.5 w-40 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                </span>
            </> : <>
                <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClassName}`} aria-hidden="true">{icon}</span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{label}</span>
                    <span className="mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1A1220] tabular-nums">{value}</span>
                    <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{helper}</span>
                </span>
            </>}
        </article>
    );
}
function OwnerTableLoadingRow({ columns, label }: { columns: number; label: string }) {
    return <tr><td colSpan={columns} className="px-4 py-7 text-center text-xs text-[#86778F]" role="status">
        <span className="block">{label}</span>
        <span className="mx-auto mt-3 block h-3 w-2/3 max-w-[330px] animate-pulse rounded-full bg-[#F1EBF8]" aria-hidden="true"/>
    </td></tr>;
}

function ExpandedPurchaseProducts({ bill }: { bill: SupplierBill }) {
    const [items, setItems] = React.useState<PurchaseItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState("");
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void ownerRequest<{ items: PurchaseItem[] }>(supplierEndpoint(bill.source), {
            action: bill.source === "rental" ? "get_rental_purchase_items" : "get_supplier_purchase_items",
            purchaseId: bill.purchaseId,
            branch_id: bill.branchId,
        }, controller.signal).then(result => {
            if (!Array.isArray(result.items)) throw new Error("The purchase items were not returned by the inventory API.");
            if (!controller.signal.aborted) setItems(result.items);
        }).catch(reason => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load purchase items.");
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [bill.key, bill.purchaseId, bill.branchId, bill.source, retry]);
    return <tr className="border-b border-[#E9E1EE] bg-[#FAF7FF]">
        <td colSpan={8} className="min-w-0 px-3 py-3 text-left sm:px-4">
            <div className="rounded-xl border border-[#E3D8EA] bg-[#FAF7FF] p-3">
                <h3 className="text-xs font-bold text-[#2B174C]">{bill.purchaseNumber} — Linked Products</h3>
                <p className="mt-1 text-[11px] text-[#806A8C]">Only products or equipment recorded for this purchase are shown. Purchased quantities may differ from current stock.</p>
                {loading ? <p className="py-4 text-xs text-[#806A8C]">Loading purchased products…</p> : error ?
                    <div role="alert" className="flex flex-wrap items-center gap-3 py-3 text-xs text-[#C32F2F]">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="rounded-lg border border-[#E3D8EA] bg-white px-3 py-1.5 text-[#2B174C]">Retry</button></div> :
                    items.length === 0 ? <p className="py-4 text-xs text-[#806A8C]">No linked purchase items were returned.</p> :
                        <div className="mt-3 max-h-[320px] w-full overflow-y-auto overflow-x-hidden overscroll-contain"><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[44%]"/><col className="w-[17%]"/><col className="w-[18%]"/><col className="w-[21%]"/></colgroup>
                            <thead className="sticky top-0 z-10 border-b border-[#BCA9CE] bg-[#FAF7FF]"><tr><th className={headerCell}>Product / Variant</th><th className={`${headerCell} text-center`}>Quantity Purchased</th><th className={`${headerCell} text-center`}>Unit Cost</th><th className={`${headerCell} text-center`}>Line Total</th></tr></thead>
                            <tbody>{items.map((item, index) => <tr key={`${item.productId ?? item.equipmentId ?? 'item'}-${item.variantId ?? 'base'}-${index}`} className="border-b border-[#E3D8EA] last:border-0">
                                <td className={firstBodyCell}><span className="font-semibold text-[#2B174C]">{item.productName || item.name || "Recorded item"}</span><span className="ml-1 text-[11px] text-[#806A8C]">{item.productNumber || item.equipmentNumber ? `(${item.productNumber || item.equipmentNumber})` : ""}</span>{item.variantNumber && <p className="mt-0.5 text-[10px] text-[#806A8C]">Variant: {item.variantNumber}</p>}</td>
                                <td className={`${bodyCell} text-center tabular-nums`}>{formatNumber(Number(item.quantity))}</td>
                                <td className={`${bodyCell} text-center tabular-nums`}>{formatPeso(Number(item.unitCost))}</td>
                                <td className={`${bodyCell} text-center tabular-nums`}>{formatPeso(Number(item.lineTotal))}</td>
                            </tr>)}</tbody>
                        </table></div>}
            </div>
        </td>
    </tr>;
}

function StatusBadge({ status }: { status: BillStatus }) {
    const colors = { Paid: "text-[#168A48]", Overdue: "text-[#C32F2F]", "Due soon": "text-[#A56607]", "Partially paid": "text-[#8A5A00]", Unpaid: "text-[#9A2424]" };
    return <span className={`font-semibold text-[11px] ${colors[status]}`}>{status}</span>;
}

function SupplierBillDialog({ bill, onClose, onPaid }: { bill: SupplierBill; onClose: () => void; onPaid: (message: string) => Promise<void> }) {
    const [items, setItems] = React.useState<PurchaseItem[]>([]);
    const [itemsLoading, setItemsLoading] = React.useState(true);
    const [itemsError, setItemsError] = React.useState("");
    const [error, setError] = React.useState("");
    const [amount, setAmount] = React.useState(() => Number(bill.outstandingBalance).toFixed(2));
    const [date, setDate] = React.useState(businessDateString);
    const [confirm, setConfirm] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const inFlight = React.useRef(false);
    const requestKey = React.useRef("");
    React.useEffect(() => { requestKey.current = crypto.randomUUID(); }, []);
    React.useEffect(() => {
        const abort = new AbortController();
        void ownerRequest<{ items: PurchaseItem[] }>(supplierEndpoint(bill.source), {
            action: bill.source === "rental" ? "get_rental_purchase_items" : "get_supplier_purchase_items",
            purchaseId: bill.purchaseId, branch_id: bill.branchId,
        }, abort.signal).then(result => setItems(Array.isArray(result.items) ? result.items : []))
            .catch(reason => { if (!abort.signal.aborted) setItemsError(reason instanceof Error ? reason.message : "Unable to load purchased items."); })
            .finally(() => { if (!abort.signal.aborted) setItemsLoading(false); });
        return () => abort.abort();
    }, [bill.source, bill.purchaseId, bill.branchId]);
    const prepare = (event: React.FormEvent) => {
        event.preventDefault(); if (saving) return;
        const payment = Number(amount);
        if (!Number.isFinite(payment) || payment <= 0 || payment > Number(bill.outstandingBalance) || Math.abs(payment * 100 - Math.round(payment * 100)) > 0.00001) {
            setError("Enter a positive payment with up to two decimal places, within this bill's outstanding balance."); return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > businessDateString()) { setError("Choose a valid payment date on or before today."); return; }
        setError(""); setConfirm(true);
    };
    const pay = async () => {
        if (inFlight.current || !confirm) return;
        inFlight.current = true; setSaving(true); setError("");
        try {
            const result = await ownerRequest<{ alreadyProcessed?: boolean }>(supplierEndpoint(bill.source), {
                action: bill.source === "rental" ? "pay_rental_supplier_purchase" : "pay_supplier_purchase",
                purchaseId: bill.purchaseId, branch_id: bill.branchId, amount: Number(amount), paymentDate: date, requestKey: requestKey.current,
            });
            await onPaid(result.alreadyProcessed ? "This supplier payment was already recorded." : `Payment recorded for ${bill.purchaseNumber}.`);
            onClose();
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record the payment."); setConfirm(false); }
        finally { inFlight.current = false; setSaving(false); }
    };
    return <div role="dialog" aria-modal="true" aria-labelledby="owner-bill-title" className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 px-3 py-5" onKeyDown={event => { if (event.key === "Escape" && !saving) { event.stopPropagation(); if (confirm) setConfirm(false); else onClose(); } }}>
        <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-[#E9E1EE] px-5 py-4">
                <div><h2 id="owner-bill-title" className="text-lg font-bold text-[#21132E]">{Number(bill.outstandingBalance) > 0 ? "Pay Supplier Bill" : "View Supplier Bill"}</h2><p className="mt-1 text-xs text-[#7A6A84]">{bill.purchaseNumber} · {bill.branchName || "Branch"} · {bill.source === "rental" ? "Rental equipment" : "Consumables"}</p></div>
                <button type="button" autoFocus disabled={saving} onClick={onClose} aria-label="Close supplier bill" className="rounded-lg p-2 text-[#7A6A84] hover:bg-[#F7F1FF] disabled:opacity-40"><X size={19}/></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5 sm:p-6">
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-[#F7F1FF] p-3"><p className="text-xs text-[#7A6A84]">Original purchase total</p><p className="mt-1 text-lg font-bold text-[#1A1220]">{formatPeso(Number(bill.purchaseTotal))}</p></div>
                    <div className="rounded-xl bg-[#FFF0F0] p-3"><p className="text-xs text-[#7A6A84]">Outstanding balance</p><p className="mt-1 text-lg font-bold text-[#C32F2F]">{formatPeso(Number(bill.outstandingBalance))}</p></div>
                </div>
                <dl className="grid gap-3 text-xs sm:grid-cols-2">
                    {[['Supplier', bill.supplier], ['Invoice', bill.supplierInvoiceNumber || '—'], ['Purchase date', formatSupplierPurchaseDate(bill.purchaseDate)], ['Due date', formatSupplierPurchaseDate(bill.paymentDueDate)], ['Already paid', formatPeso(Number(bill.amountPaid))], ['Payment method', bill.paymentMethod === 'cash' ? 'Cash' : 'Credit (Utang)']].map(([label, value]) => <div key={label}><dt className="text-[#7A6A84]">{label}</dt><dd className="mt-1 font-medium text-[#1A1220]">{value}</dd></div>)}
                </dl>
                <section className="space-y-2 border-t border-[#E6DDF0] pt-4"><h3 className="text-sm font-bold text-[#1A1220]">Purchased items</h3>
                    {itemsError ? <p role="alert" className="text-xs text-[#C32F2F]">{itemsError}</p> : itemsLoading ? <p className="text-xs text-[#7A6A84]">Loading purchase details…</p> : items.length === 0 ? <p className="text-xs text-[#7A6A84]">No purchased items are available.</p> :
                        <div className="max-h-[320px] w-full overflow-y-auto overflow-x-hidden overscroll-contain"><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]"><colgroup><col className="w-[46%]"/><col className="w-[14%]"/><col className="w-[20%]"/><col className="w-[20%]"/></colgroup><thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr><th className={headerCell}>Item</th><th className={`${headerCell} text-center`}>Qty</th><th className={`${headerCell} text-center`}>Unit cost</th><th className={`${headerCell} text-center`}>Total</th></tr></thead>
                            <tbody>{items.map((item, index) => <tr key={`${item.productId ?? item.equipmentId}-${item.variantId ?? ''}-${index}`} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]"><td className={firstBodyCell}>{item.productName || item.name || "Recorded item"}<p className="mt-0.5 text-[10px] text-[#7A6A84]">{item.productNumber || item.equipmentNumber || ""}{item.variantNumber ? ` · ${item.variantNumber}` : ""}</p></td><td className={`${bodyCell} text-center`}>{formatNumber(Number(item.quantity))}</td><td className={`${bodyCell} text-center`}>{formatPeso(Number(item.unitCost))}</td><td className={`${bodyCell} text-center`}>{formatPeso(Number(item.lineTotal))}</td></tr>)}</tbody>
                        </table></div>}
                </section>
                {Number(bill.outstandingBalance) > 0 ? <form onSubmit={prepare} className="space-y-3 border-t border-[#E6DDF0] pt-4">
                    <h3 className="text-sm font-bold text-[#1A1220]">Record full or partial payment</h3>
                    <fieldset disabled={saving || confirm} className="grid gap-3 sm:grid-cols-2">
                        <label className={`space-y-1 ${labelClass}`}>Amount paid (₱)<input type="number" required min="0.01" max={bill.outstandingBalance} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className={fieldClass}/></label>
                        <label className={`space-y-1 ${labelClass}`}>Payment date<input type="date" required max={businessDateString()} value={date} onChange={event => setDate(event.target.value)} className={fieldClass}/></label>
                    </fieldset>
                    {error && <p role="alert" className="rounded-lg bg-[#FFF0F0] p-3 text-xs text-[#C32F2F]">{error}</p>}
                    {confirm && <p className="rounded-lg bg-[#F7F1FF] p-3 text-sm text-[#5F4E75]">Record <strong>{formatPeso(Number(amount))}</strong> for <strong>{bill.purchaseNumber}</strong> on {formatSupplierPurchaseDate(date)}?</p>}
                    <div className="flex justify-end gap-2">{confirm ? <><button type="button" disabled={saving} onClick={() => setConfirm(false)} className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]">Back</button><button type="button" disabled={saving} onClick={() => void pay()} className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Recording…" : "Confirm payment"}</button></> : <button type="submit" className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white">Continue</button>}</div>
                </form> : <p className="flex items-center gap-2 rounded-lg bg-[#EAF8EF] p-3 text-xs font-medium text-[#168A48]"><CheckCircle2 size={15}/>This supplier bill is fully paid.</p>}
            </div>
        </div>
    </div>;
}

const compactControl = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F8F5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B31D4] disabled:opacity-50";

function BranchPicker({ branches, value, onChange, label }: { branches: Branch[] | null; value: string; onChange: (value: string) => void; label: string }) {
    return <label className={`${compactControl} relative max-w-full`}><Building2 size={15}/>
        <select aria-label={`${label} branch (updates all reports)`} value={value} onChange={event => onChange(event.target.value)} className="min-w-0 max-w-[150px] bg-transparent pr-1 outline-none">
            <option value="">All branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
        </select>
    </label>;
}
function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: 'xlsx' | 'pdf') => void }) {
    return <details className="relative"><summary aria-label="Export options" title="Export to Excel or PDF" className={`${compactControl} w-9 shrink-0 !px-0 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Download size={16}/></summary>
        <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-xl border border-[#E3D8EA] bg-white p-1 shadow-lg">
            {(['xlsx', 'pdf'] as const).map(format => <button type="button" key={format} disabled={disabled} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onExport(format); }} className="block w-full rounded px-3 py-2 text-left text-xs text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-40">{format === 'xlsx' ? 'Excel (.xlsx)' : 'PDF (.pdf)'}</button>)}
        </div>
    </details>;
}
export default function OwnerInventory() {
    const [clock, setClock] = React.useState('');
    React.useEffect(() => {
        const update = () => {
            const now = new Date();
            const dateLabel = now.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
            const timeLabel = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
            setClock(`${dateLabel} | ${timeLabel}`);
        };
        update(); const timer = window.setInterval(update, 30000); return () => window.clearInterval(timer);
    }, []);
    const [branch, setBranch] = React.useState("");
    const [range, setRange] = React.useState<DateRange>(monthToDateRange);
    const [refresh, setRefresh] = React.useState(0);
    const [performance, setPerformance] = React.useState<OwnerPerformance | null>(null);
    const [branches, setBranches] = React.useState<Branch[] | null>(null);
    const [performanceLoading, setPerformanceLoading] = React.useState(true);
    const [performanceError, setPerformanceError] = React.useState("");
    const [bills, setBills] = React.useState<SupplierBill[]>([]);
    const [billsLoading, setBillsLoading] = React.useState(true);
    const [billsReady, setBillsReady] = React.useState(false);
    const [billsError, setBillsError] = React.useState("");
    const [branchLoadError, setBranchLoadError] = React.useState("");
    const [supplierSearch, setSupplierSearch] = React.useState("");
    const [supplierFilter, setSupplierFilter] = React.useState("all");
    const [selectedBill, setSelectedBill] = React.useState<SupplierBill | null>(null);
    const [expandedPurchaseKey, setExpandedPurchaseKey] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState("");
    const billRequestSequence = React.useRef(0);
    const billTrigger = React.useRef<HTMLButtonElement | null>(null);
    React.useEffect(() => {
        const abort = new AbortController();
        setPerformanceLoading(true); setPerformanceError(""); setPerformance(null);
        void ownerRequest<{ performance: OwnerPerformance }>("/api/products", {
            action: "get_owner_inventory_performance", date_from: range.startDate, date_to: range.endDate,
            ...(branch ? { branch_id: Number(branch) } : {}),
        }, abort.signal).then(result => {
            if (!result.performance || !Array.isArray(result.performance.branches)) throw new Error("The owner inventory report is unavailable.");
            if (abort.signal.aborted) return;
            setPerformance(result.performance);
            setBranches(previous => JSON.stringify(previous) === JSON.stringify(result.performance.branches) ? previous : result.performance.branches);
        }).catch(reason => { if (!abort.signal.aborted) setPerformanceError(reason instanceof Error ? reason.message : "Unable to load the owner inventory report."); })
            .finally(() => { if (!abort.signal.aborted) setPerformanceLoading(false); });
        return () => abort.abort();
    }, [branch, range.startDate, range.endDate, refresh]);
    // Keep existing supplier bills accessible even if the new sales report is unavailable.
    React.useEffect(() => {
        const abort = new AbortController();
        setBranchLoadError("");
        const load = async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Your session has expired. Please sign in again.");
                const response = await fetch("/api/branches", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal });
                const payload = await response.json() as { branches?: Array<{ id?: number; branch_id?: number; branchId?: number; branchName?: string; branch_name?: string; name?: string }>; error?: string };
                if (!response.ok || !Array.isArray(payload.branches)) throw new Error(payload.error || "Branch information is unavailable.");
                const loaded = payload.branches.map(item => ({ id: Number(item.id ?? item.branch_id ?? item.branchId), branchName: item.branchName || item.branch_name || item.name || "Unnamed branch" })).filter(item => Number.isSafeInteger(item.id) && item.id > 0);
                if (!abort.signal.aborted) setBranches(previous => previous ?? loaded);
            } catch (reason) {
                if (!abort.signal.aborted) setBranchLoadError(reason instanceof Error ? reason.message : "Unable to load branch information.");
            }
        };
        void load();
        return () => abort.abort();
    }, [refresh]);
    const loadBills = React.useCallback(async () => {
        const sequence = ++billRequestSequence.current;
        // The sales backend already enforces store_id from the verified JWT.
        // Its unscoped action returns purchases from ALL branches in that store.
        // Do not discard returned purchases if /api/branches is incomplete.
        const scopedBranches = (branches ?? []).filter(item => !branch || String(item.id) === branch);
        const requests: Array<{ source: SupplierBill["source"]; branch?: Branch; endpoint: string; body: Record<string, unknown> }> = [
            { source: "consumable", endpoint: "/api/products", body: { action: "get_supplier_payables", ...(branch ? { branch_id: Number(branch) } : {}) } },
            ...scopedBranches.map(item => ({
                source: "rental" as const, branch: item, endpoint: "/api/rental-inventory",
                body: { action: "get_rental_supplier_payables", branch_id: item.id },
            })),
        ];
        const results = await Promise.allSettled(requests.map(async request => {
            const result = await ownerRequest<{ payables: SupplierPurchase[] }>(request.endpoint, request.body);
            if (!Array.isArray(result.payables)) throw new Error("The supplier purchase list is missing from the response.");
            return result.payables.flatMap(record => {
                const actualBranchId = Number(record.branchId ?? request.branch?.id);
                if (!Number.isSafeInteger(actualBranchId) || actualBranchId <= 0) return [];
                if (branch && String(actualBranchId) !== branch) return [];
                const matchingBranch = branches?.find(item => item.id === actualBranchId);
                return [{ ...record, source: request.source,
                    branchId: actualBranchId,
                    branchName: record.branchName || matchingBranch?.branchName || request.branch?.branchName || `Branch ${actualBranchId}`,
                    key: `${request.source}:${actualBranchId}:${record.purchaseId}`,
                }];
            });
        }));
        if (sequence !== billRequestSequence.current) return;
        const records = new Map<string, SupplierBill>();
        const failures: string[] = [];
        results.forEach((result, index) => {
            if (result.status === "fulfilled") result.value.forEach(row => records.set(row.key, row));
            else failures.push(`${requests[index].branch?.branchName || "Store-wide"} ${requests[index].source === "rental" ? "rental" : "sales"} purchases: ${result.reason instanceof Error ? result.reason.message : "Unable to load purchases."}`);
        });
        setBills([...records.values()]);
        setBillsReady(failures.length === 0);
        setBillsError(failures.join(" "));
        setBillsLoading(false);
    }, [branch, branches]);
    React.useEffect(() => {
        const requestSequence = billRequestSequence;
        setBillsLoading(true); setBillsReady(false); setBills([]); setBillsError("");
        void loadBills();
        const update = () => { if (document.visibilityState === "visible") void loadBills(); };
        window.addEventListener("stocknbook:purchase-updated", update);
        window.addEventListener("focus", update);
        document.addEventListener("visibilitychange", update);
        const timer = window.setInterval(update, 30000);
        return () => {
            requestSequence.current++;
            window.clearInterval(timer); window.removeEventListener("stocknbook:purchase-updated", update);
            window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update);
        };
    }, [branches, loadBills, refresh]);
    React.useEffect(() => { setExpandedPurchaseKey(null); }, [branch, supplierSearch, supplierFilter]);
    React.useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 6000); return () => window.clearTimeout(timer); }, [notice]);

    // Rental payables are loaded per branch, so the total is complete only once the branch list is known.
    const supplierTotalsReady = billsReady && branches !== null;
    const outstanding = supplierTotalsReady ? bills.reduce((sum, bill) => sum + Math.max(0, Number(bill.outstandingBalance) || 0), 0) : null;
    const overdue = supplierTotalsReady ? bills.reduce((sum, bill) => sum + (billStatus(bill) === "Overdue" ? Math.max(0, Number(bill.outstandingBalance) || 0) : 0), 0) : null;
    const supplierError = billsError || (branches === null ? branchLoadError : "");
    const filteredBills = bills.filter(bill => {
        const search = supplierSearch.trim().toLowerCase();
        const matches = !search || [bill.supplier, bill.supplierInvoiceNumber, bill.purchaseNumber, bill.branchName].some(value => String(value ?? "").toLowerCase().includes(search));
        return matches && (supplierFilter === "all" || (supplierFilter === "outstanding" ? bill.outstandingBalance > 0 : billStatus(bill) === supplierFilter));
    }).sort((a, b) => {
        const aOutstanding = Number(a.outstandingBalance) > 0;
        const bOutstanding = Number(b.outstandingBalance) > 0;
        if (aOutstanding !== bOutstanding) return aOutstanding ? -1 : 1;
        return (a.paymentDueDate || "9999").localeCompare(b.paymentDueDate || "9999") || b.purchaseId - a.purchaseId;
    });
    const consumables = performance?.consumables || [];
    const rentals = performance?.rentals || [];
    const branchName = branch ? branches?.find(item => String(item.id) === branch)?.branchName || "Selected branch" : "All branches";
    const selectedLabel = range.startDate === range.endDate ? shortDate(range.endDate) : `${shortDate(range.startDate, false)} – ${shortDate(range.endDate)}`;
    const periodLabel = `This month to date · ${selectedLabel}`;
    const closeBill = () => { setSelectedBill(null); window.setTimeout(() => billTrigger.current?.focus(), 0); };
    const onPaid = async (message: string) => {
        setNotice(message);
        try { await loadBills(); } catch (reason) { setBillsError(reason instanceof Error ? reason.message : "Payment saved. Supplier balances could not refresh."); }
        window.dispatchEvent(new Event("stocknbook:purchase-updated"));
    };
    const exportReport = (format: "xlsx" | "pdf", scope: "all" | "consumables" | "rentals" | "suppliers" = "all") => {
        if (!performance) return;

        const unavailable = "Not recorded yet";
        const value = (amount: Amount) => amount === null ? unavailable : amount;
        let report: OwnerReportTable = {
            headers: ["Section / Item", "Branch / Details", "Units", "Revenue (PHP)", "Gross profit (PHP)", "Balance (PHP)"],
            rows: [
                ["Total sales & rental revenue", selectedLabel, "", value(performance.totals.totalRevenue), "", ""],
                ["Consumable sales", selectedLabel, "", value(performance.totals.consumableSales), value(performance.totals.consumableGrossProfit), ""],
                ["Rental revenue", selectedLabel, "", value(performance.totals.rentalRevenue), "", ""],
                ["Supplier balance", `Current as of ${shortDate(businessDateString())}`, "", "", "", outstanding === null ? "Unavailable" : outstanding],
                ["Overdue supplier balance", "Current balances", "", "", "", overdue === null ? "Unavailable" : overdue],
                ...performance.branchRevenue.map(row => ["Branch consumable sales", row.branchName, "", value(row.consumableSales), "", ""] as Array<string | number>),
                ...performance.branchRevenue.map(row => ["Branch rental revenue", row.branchName, "", value(row.rentalRevenue), "", ""] as Array<string | number>),
                ...consumables.map(row => [row.name, "Consumables", row.unitsSold, row.sales, row.grossProfit === null ? "Historical cost unavailable" : row.grossProfit, ""] as Array<string | number>),
                ...rentals.map(row => [row.name, "Rentals", "", row.revenue, "", ""] as Array<string | number>),
                ...bills.map(row => [row.supplier, `${row.branchName || "Branch"} · ${row.purchaseNumber} · ${row.supplierInvoiceNumber || "No invoice"}`, "", "", "", Number(row.outstandingBalance)] as Array<string | number>),
            ], columnWidths: [180, 210, 55, 100, 110, 100], moneyColumns: [3, 4, 5],
        };
        const details: OwnerReportDetails = {
            title: "Owner Inventory Performance", fileTag: "Owner_Inventory_Performance", sheetName: "Business Performance",
            storeName: performance.storeName || "Store", branchName, generatedAt: new Date(),
            filters: [`Revenue: ${periodLabel}`, "Supplier balances are current, independent of the revenue period", "Gross profit = recorded POS sales less recorded cost at sale, before operating expenses; POS totals include VAT where applicable", ...performance.warnings, ...(billsError ? [billsError] : [])],
        };
        if (scope === 'consumables') report = { headers: ['Item', 'Units sold', 'Sales', 'Gross profit'], rows: consumables.map(row => [row.name, row.unitsSold, row.sales, value(row.grossProfit)]), columnWidths: [220, 80, 140, 140], moneyColumns: [2, 3] };
        if (scope === 'rentals') report = { headers: ['Item', 'Rental revenue', 'Revenue share (%)'], rows: rentals.map(row => [row.name, row.revenue, row.share]), columnWidths: [220, 140, 140], moneyColumns: [1] };
        if (scope === 'suppliers') report = { headers: ['Purchase', 'Supplier', 'Branch', 'Method', 'Total', 'Paid', 'Outstanding', 'Due date', 'Status'], rows: filteredBills.map(row => [row.purchaseNumber, row.supplier, row.branchName || 'Branch', row.paymentMethod === 'cash' ? 'Cash' : 'Credit', Number(row.purchaseTotal), Number(row.amountPaid), Number(row.outstandingBalance), row.paymentDueDate || '—', billStatus(row)]), columnWidths: [150, 160, 150, 90, 105, 105, 105, 100, 105], moneyColumns: [4, 5, 6] };
        if (scope !== 'all') {
            const titles = { consumables: 'Consumable Sales Performance', rentals: 'Rental Revenue Performance', suppliers: 'Supplier Payments' };
            details.title = titles[scope]; details.fileTag = titles[scope].replace(/ /g, '_'); details.sheetName = titles[scope].slice(0, 31);
            if (scope === 'suppliers') details.filters.push('Status: ' + supplierFilter, 'Search: ' + (supplierSearch || 'None'));
        }
        try { if (format === "pdf") exportOwnerTablePdf(report, details); else exportOwnerTableExcel(report, details); }
        catch (reason) { setNotice(reason instanceof Error ? `Export failed: ${reason.message}` : "Unable to export this report."); }
    };

    return <div className="min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
        <div inert={selectedBill ? true : undefined}>
            <header className="sticky top-0 z-20 flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 px-6 py-3 backdrop-blur">
                <div><h1 className="text-[25px] font-bold text-[#1A1220]">Inventory</h1><p className="mt-0.5 text-xs text-[#766983]">Sales performance for this month to date ({selectedLabel}) and current supplier payments across your business.</p></div>
                <div className="flex flex-wrap items-center gap-2.5"><time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{clock || 'Asia/Manila'}</time>
                    <button type="button" onClick={() => { setRange(monthToDateRange()); setRefresh(value => value + 1); }} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"><RefreshCw size={16} className={performanceLoading || billsLoading ? 'animate-spin' : ''}/>Refresh</button>
                </div>
            </header>
            <main className="space-y-4 px-5 py-5">
                {performanceError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] p-4 text-sm text-[#C32F2F]"><p>Could not load the owner report: {performanceError}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className="rounded-lg border border-current px-3 py-1.5 text-xs font-semibold">Retry</button></div>}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="Total sales & rental revenue" value={shownMoney(performance?.totals.totalRevenue)} loading={performanceLoading} helper={performanceLoading ? "Loading recorded revenue…" : performance?.totals.rentalRevenue === null ? "Total available once rentals are recorded" : periodLabel} icon={<BarChart3 size={19}/>}/>
                    <MetricCard label="Consumable sales" value={shownMoney(performance?.totals.consumableSales)} loading={performanceLoading} helper={`Gross profit: ${shownMoney(performance?.totals.consumableGrossProfit)} · this month to date`} icon={<TrendingUp size={19}/>} tone="green"/>
                    <MetricCard label="Rental revenue" value={shownMoney(performance?.totals.rentalRevenue)} loading={performanceLoading} helper={performanceLoading ? "Loading recorded revenue…" : performance?.totals.rentalRevenue === null ? "No itemized charges" : periodLabel} icon={<Box size={19}/>} tone="blue"/>
                    <MetricCard label="Supplier balance" value={shownMoney(outstanding)} loading={billsLoading || (branches === null && !branchLoadError)} helper={supplierTotalsReady ? `${formatPeso(overdue || 0)} overdue · all unpaid bills as of today` : "Supplier balances unavailable"} icon={<ReceiptText size={19}/>} tone="red"/>
                </div>
                {performance && performance.warnings.length > 0 && <p role="note" className="rounded-lg bg-[#F7F1FF] px-3 py-2 text-[11px] leading-5 text-[#806A8C]">{performance.warnings.join(" ")}</p>}
                <section className={`${cardClass} flex min-h-0 flex-col`}>
                    <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                        <SectionHeading icon={<ReceiptText size={19}/>} title="Supplier Payables" subtitle="Purchase-based supplier balances across sales and rental inventory. Pay outstanding bills or review settled purchases."/>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                            <label className="relative block min-w-[180px] flex-1 sm:max-w-[310px]">
                                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                                <input aria-label="Search supplier or invoice" value={supplierSearch} onChange={event => setSupplierSearch(event.target.value)} placeholder="Search supplier or invoice..." className="h-9 w-full rounded-xl border border-[#E3D8EA] bg-white pl-9 pr-3 text-xs text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"/>
                            </label>
                            <BranchPicker branches={branches} value={branch} onChange={setBranch} label="Supplier payments"/>
                            <select aria-label="Filter supplier payments by status" value={supplierFilter} onChange={event => setSupplierFilter(event.target.value)} className={compactControl}>
                                <option value="all">All purchases</option>
                                <option value="outstanding">Outstanding bills</option>
                                {(["Overdue", "Due soon", "Partially paid", "Unpaid", "Paid"] as const).map(status => <option key={status} value={status}>{status}</option>)}
                            </select>
                            <ExportMenu disabled={!performance || performanceLoading || billsLoading || !!supplierError} onExport={format => exportReport(format, "suppliers")}/>
                        </div>
                    </div>
                    {supplierError && <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FFF0F0] p-3 text-xs text-[#C32F2F]"><p>Some supplier records are unavailable. {supplierError}</p><button type="button" onClick={() => { setBillsLoading(true); if (branches === null) setRefresh(value => value + 1); else void loadBills(); }} className="rounded-md border border-current px-2.5 py-1 font-semibold">Retry</button></div>}
                    <div className="min-h-0 max-h-[360px] w-full overflow-y-auto overflow-x-hidden overscroll-contain border-t border-[#E9E1EE]" role="region" aria-label="Supplier Payables table" tabIndex={0}><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            <th className="truncate w-[20%] px-2 py-2 text-[10px] font-semibold uppercase text-[#806A8C] text-center tracking-normal">Purchase No.</th><th className="truncate w-[13%] px-2 py-2 text-[10px] font-semibold uppercase text-[#806A8C] text-center tracking-normal">Purchase Date / Time</th><th className="truncate w-[12%] px-2 py-2 text-[10px] font-semibold uppercase text-[#806A8C] text-center tracking-normal">Branch</th><th className="truncate w-[18%] px-2 py-2 text-[10px] font-semibold uppercase text-[#806A8C] text-center tracking-normal">Supplier</th>
                            <th className="truncate w-[8.5%] px-2 py-2 text-center text-[10px] font-semibold uppercase text-[#806A8C] tracking-normal">Total</th>
                            <th className="truncate w-[10%] px-2 py-2 text-center text-[10px] font-semibold uppercase text-[#806A8C] tracking-normal">Outstanding</th><th className="truncate w-[8.5%] px-2 py-2 text-center text-[10px] font-semibold uppercase text-[#806A8C] tracking-normal">Status</th>
                            <th className="truncate w-[10%] px-2 py-2 text-center text-[10px] font-semibold uppercase text-[#806A8C] tracking-normal">Action</th>
                        </tr></thead>
                        <tbody>
                        {filteredBills.map(bill => {
                            const unpaid = Number(bill.outstandingBalance) > 0;
                            return <React.Fragment key={bill.key}><tr className="border-b border-[#EFE8F2] hover:bg-[#FFFCF8]">
                                <td className="min-w-0 break-all py-2 text-[11px] px-4 text-left"><button type="button" aria-expanded={expandedPurchaseKey === bill.key} aria-label={`${expandedPurchaseKey === bill.key ? "Hide" : "Show"} linked products for ${bill.purchaseNumber}`} onClick={() => setExpandedPurchaseKey(current => current === bill.key ? null : bill.key)} className="font-semibold text-[#5330B6] underline underline-offset-2 hover:text-[#2B174C] focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B31D4]">{bill.purchaseNumber}</button></td><td className="min-w-0 px-2 py-2 text-[11px]"><span>{formatSupplierPurchaseDate(bill.purchaseDate)}</span><p className="mt-1 text-[10px] text-[#7A6A84]">{formatPurchaseRecordedTime(bill.recordedAt)}</p></td><td className="min-w-0 break-words px-2 py-2 text-[11px]"><span className="font-medium">{bill.branchName || branches?.find(item => item.id === bill.branchId)?.branchName || "Unknown branch"}</span></td>
                                <td className="min-w-0 break-words px-2 py-2 text-[11px]"><span className="font-medium">{bill.supplier}</span><p className="mt-1 text-[10px] text-[#7A6A84]">{bill.supplierInvoiceNumber || "No supplier invoice"}</p></td>

                                <td className="min-w-0 px-2 py-2 text-center text-[11px] tabular-nums">{formatPeso(Number(bill.purchaseTotal))}</td>

                                <td className="min-w-0 px-2 py-2 text-center text-[11px] font-semibold tabular-nums">{formatPeso(Number(bill.outstandingBalance))}<p className="mt-1 text-[10px] font-normal text-[#7A6A84]">{unpaid ? `Due ${formatSupplierPurchaseDate(bill.paymentDueDate)}` : "Settled"}</p></td>
                                <td className="min-w-0 px-2 py-2 text-center text-[11px]"><StatusBadge status={billStatus(bill)}/></td>
                                <td className="min-w-0 px-2 py-2 text-center"><button type="button" aria-label={`${unpaid ? "Pay" : "View"} supplier bill ${bill.purchaseNumber}`} onClick={event => { billTrigger.current = event.currentTarget; setSelectedBill(bill); }} className={`inline-flex w-full items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5330B6] ${unpaid ? "bg-[#2B174C] text-white hover:bg-[#1B0D31]" : "bg-[#F1EBFF] text-[#5330B6] hover:bg-[#EAE0FF]"}`}>{unpaid ? <Wallet size={13} className="shrink-0"/> : <ReceiptText size={13} className="shrink-0"/>}{unpaid ? "Pay Now" : "View Bill"}</button></td>
                            </tr>{expandedPurchaseKey === bill.key && <ExpandedPurchaseProducts bill={bill}/>}</React.Fragment>;
                        })}
                        {filteredBills.length === 0 && (billsLoading ? <OwnerTableLoadingRow columns={8} label="Loading supplier purchases..."/> : <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-[#7A6A84]">{supplierError ? "Supplier records are unavailable." : "No supplier purchases returned for the selected branches. Check Owner API access if Manager shows purchases."}</td></tr>)}
                        </tbody>
                    </table></div>
                </section>
                <div className="grid gap-4 xl:grid-cols-2">
                    <section className={cardClass}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5"><SectionHeading icon={<ShoppingCart size={23}/>} title="Consumable sales performance" subtitle={periodLabel}/><div className="flex gap-2"><BranchPicker branches={branches} value={branch} onChange={setBranch} label="Consumable sales performance"/><ExportMenu disabled={!performance || performanceLoading} onExport={format => exportReport(format, "consumables")}/></div></div>
                        <div className={`${scrollPanel} h-[360px]`} role="region" aria-label="Consumable sales performance scrollable table" tabIndex={0}><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[40%]"/><col className="w-[18%]"/><col className="w-[21%]"/><col className="w-[21%]"/></colgroup><thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr><th className={`${headerCell}`}>Item</th><th className={`${headerCell} text-center`}>Units sold</th><th className={`${headerCell} text-center`}>Sales</th><th className={`${headerCell} text-center`}>Gross profit</th></tr></thead><tbody>
                        {consumables.map(row => <tr key={row.key} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]"><td className={firstBodyCell}>{row.name}</td><td className={`${bodyCell} text-center tabular-nums`}>{formatNumber(row.unitsSold)}</td><td className={`${bodyCell} text-center tabular-nums`}>{formatPeso(row.sales)}</td><td title={row.grossProfit === null ? "Historical cost is not available for every sold item." : undefined} className={`${bodyCell} text-center tabular-nums`}>{shownMoney(row.grossProfit)}</td></tr>)}
                        {consumables.length === 0 && (performanceLoading ? <OwnerTableLoadingRow columns={4} label="Loading consumable sales..."/> : <tr><td colSpan={4} className="h-[123px] px-3 text-center text-xs text-[#7A6A84]">{performanceError ? "Sales report unavailable." : "No completed consumable sales in this period."}</td></tr>)}
                        </tbody></table></div>
                    </section>
                    <section className={cardClass}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5"><SectionHeading icon={<Box size={23}/>} title="Rental revenue performance" subtitle={periodLabel}/><div className="flex gap-2"><BranchPicker branches={branches} value={branch} onChange={setBranch} label="Rental revenue performance"/><ExportMenu disabled={!performance || performanceLoading} onExport={format => exportReport(format, "rentals")}/></div></div>
                        <div className={`${scrollPanel} h-[360px]`} role="region" aria-label="Rental revenue performance scrollable table" tabIndex={0}><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[46%]"/><col className="w-[27%]"/><col className="w-[27%]"/></colgroup><thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr><th className={`${headerCell}`}>Item</th><th className={`${headerCell} text-center`}>Rental revenue</th><th className={`${headerCell} text-center`}>Revenue share</th></tr></thead><tbody>
                        {rentals.map(row => <tr key={row.key} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]"><td className={firstBodyCell}>{row.name}</td><td className={`${bodyCell} text-center tabular-nums`}>{formatPeso(row.revenue)}</td><td className={`${bodyCell} text-center tabular-nums`}>{row.share.toFixed(1)}%</td></tr>)}
                        {rentals.length === 0 && (performanceLoading ? <OwnerTableLoadingRow columns={3} label="Loading rental revenue..."/> : <tr><td colSpan={3} className="h-[123px] px-5 text-center text-xs leading-5 text-[#7A6A84]">{performanceError ? "Rental report unavailable." : performance?.totals.rentalRevenue === null ? "No recorded itemized rental charges are available yet. Rental stock and daily rates alone are not rental revenue." : "No rental revenue recorded in this period."}</td></tr>)}
                        </tbody></table></div>
                    </section>
                </div>
            </main>
        </div>
        {notice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[150] flex max-w-[min(420px,calc(100vw-40px))] items-start gap-3 rounded-xl border border-[#E6DDF0] bg-white p-4 text-sm text-[#5F4E75] shadow-xl"><p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></button></div>}
        {selectedBill && <SupplierBillDialog key={selectedBill.key} bill={selectedBill} onClose={closeBill} onPaid={onPaid}/>}
    </div>;
}


type OwnerReportTable = {
    headers: string[];
    rows: Array<Array<string | number>>;
    columnWidths: number[];
    moneyColumns: number[];
};

type OwnerReportDetails = {
    title: string;
    fileTag: string;
    sheetName: string;
    storeName: string;
    branchName: string;
    filters: string[];
    generatedAt: Date;
};

function ownerReportDate(date: Date) {
    return date.toLocaleString("en-PH", {
        timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
    });
}

function ownerReportFilename(extension: "pdf" | "xlsx", details: OwnerReportDetails) {
    const slug = (value: string) => String(value || "Unknown")
        .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "Unknown";
    const date = details.generatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
    return `StockNBook_${details.fileTag}_${slug(details.storeName)}_${slug(details.branchName)}_${date}.${extension}`;
}

function exportOwnerTableExcel(table: OwnerReportTable, details: OwnerReportDetails) {
    const infoRows: Array<Array<string | number>> = [
        [`StockNBook - ${details.title}`],
        ["Store", details.storeName],
        ["Branch", details.branchName],
        ["Report Date", ownerReportDate(details.generatedAt)],
        ["Filters", details.filters.join(" | ") || "None"],
        ["Records", table.rows.length],
        [],
        table.headers,
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([...infoRows, ...table.rows]);
    worksheet["!cols"] = table.columnWidths.map(width => ({ wch: Math.max(13, Math.ceil(width / 6)) }));
    worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: table.headers.length - 1 } }];
    const excelColumn = (index: number) => {
        let value = index + 1;
        let letters = "";
        while (value > 0) {
            value--;
            letters = String.fromCharCode(65 + value % 26) + letters;
            value = Math.floor(value / 26);
        }
        return letters;
    };
    const lastColumn = excelColumn(table.headers.length - 1);
    worksheet["!autofilter"] = { ref: `A8:${lastColumn}${Math.max(8, 8 + table.rows.length)}` };
    // Keep monetary cells as numbers for Excel calculations/sorting.
    table.rows.forEach((row, rowIndex) => {
        table.moneyColumns.forEach(column => {
            if (typeof row[column] !== "number") return;
            const cell = worksheet[`${excelColumn(column)}${rowIndex + 9}`];
            if (cell) cell.z = '"₱"#,##0.00';
        });
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, details.sheetName);
    XLSX.writeFile(workbook, ownerReportFilename("xlsx", details), { bookType: "xlsx" });
}

function exportOwnerTablePdf(table: OwnerReportTable, details: OwnerReportDetails) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const scale = 1.7;
    const margin = 23;
    const availableWidth = pageWidth - margin * 2;
    const widthSum = table.columnWidths.reduce((sum, width) => sum + width, 0);
    const widths = table.columnWidths.map(width => width / widthSum * availableWidth);
    const tableTop = 152;
    const tableHeadHeight = 29;
    const tableBottom = 555;
    const rowLineHeight = 10;
    const paddingX = 4;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pageWidth * scale);
    canvas.height = Math.round(pageHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create a PDF canvas in this browser.");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const wrapCell = (value: string | number, maximumWidth: number): string[] => {
        const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ");
        const lines: string[] = [];
        let line = "";
        for (const word of words) {
            const combined = line ? `${line} ${word}` : word;
            if (ctx.measureText(combined).width <= maximumWidth) {
                line = combined;
            } else {
                if (line) lines.push(line);
                line = "";
                for (const letter of word) {
                    if (ctx.measureText(line + letter).width > maximumWidth && line) {
                        lines.push(line);
                        line = "";
                    }
                    line += letter;
                }
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : ["—"];
    };
    const shownRows = table.rows.map(row => row.map((value, column) =>
        table.moneyColumns.includes(column) && typeof value === "number" ? formatPeso(value) : value
    ));
    const mappedRows = shownRows.map(row => {
        ctx.font = "8px Arial, sans-serif";
        const wrapped = row.map((cell, col) => wrapCell(cell, widths[col] - paddingX * 2));
        return { wrapped, height: Math.max(21, Math.max(...wrapped.map(lines => lines.length)) * rowLineHeight + 8) };
    });
    const pages: Array<typeof mappedRows> = [[]];
    let used = tableTop + tableHeadHeight;
    mappedRows.forEach(row => {
        if (used + row.height > tableBottom && pages[pages.length - 1].length) {
            pages.push([]);
            used = tableTop + tableHeadHeight;
        }
        pages[pages.length - 1].push(row);
        used += row.height;
    });

    const drawRow = (cells: string[][], y: number, height: number, header: boolean, shaded: boolean) => {
        let x = margin;
        cells.forEach((lines, index) => {
            ctx.fillStyle = header ? "#F1EBFF" : shaded ? "#FAF8FD" : "#FFFFFF";
            ctx.fillRect(x, y, widths[index], height);
            ctx.strokeStyle = "#E3D8EA";
            ctx.lineWidth = 0.45;
            ctx.strokeRect(x, y, widths[index], height);
            ctx.fillStyle = header ? "#4E2C66" : "#21132E";
            ctx.font = header ? "bold 7.4px Arial, sans-serif" : "8px Arial, sans-serif";
            lines.forEach((line, indexLine) => ctx.fillText(line, x + paddingX, y + 12 + indexLine * rowLineHeight));
            x += widths[index];
        });
    };

    const jpegPages: Uint8Array[] = [];
    pages.forEach((pageRows, pageIndex) => {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, pageWidth, pageHeight);
        ctx.fillStyle = "#2B174C";
        ctx.font = "bold 16px Arial, sans-serif";
        ctx.fillText(`StockNBook - ${details.title}`, margin, 29);
        ctx.font = "9.5px Arial, sans-serif";
        ctx.fillText(`Store: ${details.storeName}`, margin, 51);
        ctx.fillText(`Branch: ${details.branchName}`, margin, 67);
        ctx.fillText(`Report Date: ${ownerReportDate(details.generatedAt)}`, margin, 83);
        ctx.fillStyle = "#5F4E75";
        ctx.font = "8.6px Arial, sans-serif";
        const filterText = `Filters: ${details.filters.join(" | ") || "None"}`;
        wrapCell(filterText, availableWidth).slice(0, 2).forEach((line, index) =>
            ctx.fillText(line, margin, 103 + index * 12));
        ctx.fillText(`Total Records: ${table.rows.length}`, margin, 136);
        ctx.font = "bold 7.4px Arial, sans-serif";
        const headerCells = table.headers.map((label, index) => wrapCell(label, widths[index] - 8));
        drawRow(headerCells, tableTop, tableHeadHeight, true, false);
        let y = tableTop + tableHeadHeight;
        pageRows.forEach((row, index) => {
            drawRow(row.wrapped, y, row.height, false, index % 2 === 1);
            y += row.height;
        });
        ctx.fillStyle = "#806A8C";
        ctx.font = "9px Arial, sans-serif";
        ctx.fillText(`StockNBook | ${details.title}`, margin, pageHeight - 21);
        ctx.textAlign = "right";
        ctx.fillText(`Page ${pageIndex + 1} of ${pages.length}`, pageWidth - margin, pageHeight - 21);
        ctx.textAlign = "left";
        const base64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
        const binary = atob(base64);
        const jpeg = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) jpeg[i] = binary.charCodeAt(i);
        jpegPages.push(jpeg);
    });

    const encoder = new TextEncoder();
    const chunks: BlobPart[] = [];
    const offsets: number[] = [];
    let byteCount = 0;
    const write = (content: string | Uint8Array) => {
        const bytes = typeof content === "string" ? encoder.encode(content) : content;
        chunks.push(bytes as BlobPart);
        byteCount += bytes.length;
    };
    const obj = (id: number, body: () => void) => {
        offsets[id] = byteCount;
        write(`${id} 0 obj\n`);
        body();
        write("\nendobj\n");
    };
    write("%PDF-1.4\n%StockNBook\n");
    obj(1, () => write("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => write(`<< /Type /Pages /Kids [${jpegPages.map((_,i) => `${3 + i*3} 0 R`).join(" ")}] /Count ${jpegPages.length} >>`));
    jpegPages.forEach((jpeg, index) => {
        const pageId = 3 + index * 3;
        const imageId = pageId + 1;
        const contentsId = pageId + 2;
        obj(pageId, () => write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /PageImage ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`));
        obj(imageId, () => {
            write(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
            write(jpeg);
            write("\nendstream");
        });
        const draw = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/PageImage Do\nQ\n`;
        obj(contentsId, () => write(`<< /Length ${encoder.encode(draw).length} >>\nstream\n${draw}endstream`));
    });
    const xref = byteCount;
    const totalObjects = 2 + jpegPages.length * 3;
    write(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= totalObjects; id++) write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    write(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const blob = new Blob(chunks, { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = ownerReportFilename("pdf", details);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}