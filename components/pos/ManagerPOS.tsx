"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
    CheckCircle2,
    ChevronDown,
    CircleDollarSign,
    ChevronRight,
    Minus,
    Plus,
    Search,
    ReceiptText,
    ShoppingBag,
    Boxes,
    Trash2,
    X,
    Phone,
    WalletCards,
} from "lucide-react";
import type { UsePOSReturn } from "@/hooks/usePOS";
import {
    OrdersTable,
    formatPOSOrderTime,
    formatPOSCustomerType,
    POSLayout,
    StatCard,
    peso,
    type CreditCheckResult,
    type CreditCollection,
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


const EMPTY_CREDIT_CHECK: CreditCheckResult = {
    status: "UNVERIFIED",
    restricted: false,
    matchedOrders: 0,
    openOrders: 0,
    outstandingBalance: 0,
    overdueBalance: 0,
    oldestDueDate: null,
};

function normalizeCreditContact(value?: string | null) {
    let digits = String(value || "").replace(/\D/g, "");

    if (digits.startsWith("63") && digits.length === 12) {
        digits = `0${digits.slice(2)}`;
    } else if (digits.length === 10 && digits.startsWith("9")) {
        digits = `0${digits}`;
    }

    return digits;
}

function isValidCreditContact(value?: string | null) {
    const raw = String(value || "").trim();

    if (!raw || !/^[+\d\s()-]+$/.test(raw)) {
        return false;
    }

    return /^09\d{9}$/.test(normalizeCreditContact(raw));
}

function maskCreditContact(value?: string | null) {
    const raw = String(value || "").trim();
    const digits = normalizeCreditContact(raw);

    if (digits.length < 7) return raw || "—";

    return `${digits.slice(0, 2)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-4)}`;
}

/** Management view: business sales and transactions from the assigned branch only. */
function ManagerSalesView({ pos }: { pos: UsePOSReturn }) {
    const [query, setQuery] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    // POS API scopes get_orders to the logged-in Manager's assigned branch.
    const allBranchOrders = pos.orders.filter(isWalkInPosOrder);
    const filteredOrders = allBranchOrders.filter((order) => {
        const date = String(order.date || "").slice(0, 10);
        if (from && date < from) return false;
        if (to && date > to) return false;
        const term = query.trim().toLowerCase();
        return !term || [order.id, formatPOSCustomerType(order)]
            .some((value) => String(value || "").toLowerCase().includes(term));
    });
    const validOrders = filteredOrders.filter((order) =>
        !["VOID", "VOIDED", "CANCELLED", "CANCELED", "REFUNDED", "FAILED", "SCHEDULED", "PENDING", "PENDING PAYMENT", "UNPAID", "DRAFT"]
            .includes(String(order.status || "").toUpperCase())
    );
    const sales = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const vat = validOrders.reduce((sum, order) => sum + Number(order.vatAmount || 0), 0);

    return (
        <POSLayout role="manager" isOwner={false} activeBranchName={pos.activeBranchName} onRefresh={() => pos.refreshAll()}>
            <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard label="Branch Sales" value={peso(sales)} helper="Recorded sales for the selected period (VAT-inclusive)"
                              icon={<CircleDollarSign size={18} />} />
                    <StatCard label="Transactions" value={validOrders.length} helper="Non-voided branch transactions in the selected period"
                              icon={<ReceiptText size={18} />} />
                    <StatCard label="VAT in Sales" value={peso(vat)} helper="12% VAT contained in VAT-registered transactions"
                              icon={<WalletCards size={18} />} iconClassName="bg-[#E9F8EF] text-[#168A48]" />
                    <StatCard label="Average Sale" value={peso(validOrders.length ? sales / validOrders.length : 0)}
                              helper="Average completed transaction value"
                              icon={<ShoppingBag size={18} />} iconClassName="bg-[#FFF2E5] text-[#C8791D]" />
                </div>
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <h2 className="mb-3 text-base font-bold text-[#1A1220]">Branch Transaction List</h2>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                        <label className="sr-only" htmlFor="manager-pos-search">Search transactions</label>
                        <input id="manager-pos-search" value={query} onChange={(e) => setQuery(e.target.value)}
                               placeholder="Search Order ID or customer type..."
                               className="h-10 rounded-xl border border-[#E6DDF0] px-3 text-sm outline-none focus:border-[#5F3CB0]" />
                        <label className="sr-only" htmlFor="manager-pos-from">Date from</label>
                        <input id="manager-pos-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                               className="h-10 rounded-xl border border-[#E6DDF0] px-3 text-sm outline-none focus:border-[#5F3CB0]" />
                        <label className="sr-only" htmlFor="manager-pos-to">Date to</label>
                        <input id="manager-pos-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
                               className="h-10 rounded-xl border border-[#E6DDF0] px-3 text-sm outline-none focus:border-[#5F3CB0]" />
                    </div>
                    <p className="my-3 text-xs text-[#806A8C]">{filteredOrders.length} transactions found. Staff handle checkout; managers can review branch sales here.</p>
                    <div className="max-h-[560px] overflow-auto rounded-xl border border-[#E6DDF0]">
                        <table className="w-full min-w-[1080px] text-left text-xs">
                            <thead className="sticky top-0 bg-[#F9F6FD] text-[#5F4E75]">
                            <tr>{["Order ID", "Date", "Customer Type", "Payment", "Tax", "VAT Amount", "Total", "Processed By", "Download Receipt"].map((heading) =>
                                <th key={heading} className="px-3 py-3 font-semibold">{heading}</th>
                            )}</tr>
                            </thead>
                            <tbody>
                            {filteredOrders.length === 0 ? (
                                <tr><td colSpan={9} className="px-3 py-9 text-center text-[#806A8C]">No branch transactions found.</td></tr>
                            ) : filteredOrders.map((order) => (
                                <tr key={order.id} className="border-t border-[#E6DDF0] hover:bg-[#FFFCF7]">
                                    <td className="px-3 py-3 font-semibold text-[#2B174C]">{order.id}</td>
                                    <td className="px-3 py-3">
                                        <div className="font-medium text-[#2B174C]">{order.date}</div>
                                        <div className="mt-1 text-[11px] text-[#806A8C]">{formatPOSOrderTime(order)}</div>
                                    </td>
                                    <td className="px-3 py-3">{formatPOSCustomerType(order)}</td>
                                    <td className="px-3 py-3">{order.paymentMode || "Cash"}</td>
                                    <td className="px-3 py-3">{String(order.taxType || "").toUpperCase() === "VAT" ? "VAT 12%" : "Non-VAT"}</td>
                                    <td className="px-3 py-3">{peso(Number(order.vatAmount || 0))}</td>
                                    <td className="px-3 py-3 font-bold">{peso(order.total)}</td>
                                    <td className="px-3 py-3">{order.cashierName || (order.cashierId ? `Staff #${order.cashierId}` : "—")}</td>
                                    <td className="px-3 py-3">
                                        <button type="button" onClick={() => downloadSalesReceiptPDF(order)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBE7] bg-white px-3 py-1.5 font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"
                                                title="Download this sales receipt as PDF">
                                            <ReceiptText size={14} /> Download
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </POSLayout>
    );
}

/** Compact booking-style KPI: circular icon at left, content at right. */
function StaffBookingStyleStat({
                                   label,
                                   value,
                                   helper,
                                   icon,
                                   iconBackground,
                                   iconColor,
                               }: {
    label: string;
    value: string | number;
    helper: string;
    icon: ReactNode;
    iconBackground: string;
    iconColor: string;
}) {
    return (
        <section className="flex min-h-[128px] items-center gap-4 rounded-[18px] border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconBackground} ${iconColor}`}>
                {icon}
            </div>
            <div className="min-w-0">
                <h2 className="text-[14px] font-medium text-[#2B174C]">{label}</h2>
                <p className="mt-0.5 text-[26px] font-bold leading-tight text-[#1A1220]">{value}</p>
                <p className="mt-1 text-xs text-[#806A8C]">{helper}</p>
            </div>
        </section>
    );
}

function isWalkInPosOrder(order: Order) {
    if (String(order.customerType || "").toUpperCase() === "WALK_IN") return true;
    const customer = String(order.customer || "").trim().toLowerCase();
    const posOrder = String(order.id || "").toUpperCase().includes("-POS-");
    const posInvoice = String(order.controlNumber || "").toUpperCase().startsWith("INV-");
    return (customer === "walk-in" || customer === "walk-in customer") && (posOrder || posInvoice);
}

function isCompletedPosOrder(order: Order) {
    return !["VOID", "VOIDED", "CANCELLED", "CANCELED", "REFUNDED", "FAILED", "PENDING", "UNPAID"]
        .includes(String(order.status || "COMPLETED").trim().toUpperCase());
}

export function BranchPOSView({ pos }: { pos: UsePOSReturn }) {
    const isManager = pos.role === "manager";
    const [voidTarget, setVoidTarget] = useState<Order | null>(null);
    // Only Staff render checkout; Manager has a separate read-only sales view.
    if (isManager) return <ManagerSalesView pos={pos} />;
    const staffTodayOrders = pos.todayOrders.filter(isWalkInPosOrder);
    const completedTodayOrders = staffTodayOrders.filter(isCompletedPosOrder);
    const staffTodaySales = completedTodayOrders.reduce((total, order) => total + Number(order.total || 0), 0);

    return (
        <POSLayout
            role={pos.role}
            isOwner={pos.isOwner}
            activeBranchName={pos.activeBranchName}
            onRefresh={() => pos.refreshAll()}
        >
            <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StaffBookingStyleStat
                    label="Today's Branch Sales"
                    value={peso(staffTodaySales)}
                    helper="Completed walk-in sales at your branch today"
                    icon={<CircleDollarSign size={24} strokeWidth={1.9} />}
                    iconBackground="bg-[#F1E8FF]"
                    iconColor="text-[#7036D6]"
                />
                <StaffBookingStyleStat
                    label="Today's Transactions"
                    value={completedTodayOrders.length}
                    helper="Completed walk-in POS transactions today"
                    icon={<ReceiptText size={24} strokeWidth={1.9} />}
                    iconBackground="bg-[#E8F0FF]"
                    iconColor="text-[#2865D9]"
                />
                <StaffBookingStyleStat
                    label="VAT Collected"
                    value={peso(completedTodayOrders.reduce((sum, order) => sum + Number(order.vatAmount || 0), 0))}
                    helper="VAT included in today's completed sales"
                    icon={<WalletCards size={24} strokeWidth={1.9} />}
                    iconBackground="bg-[#E7F8EF]"
                    iconColor="text-[#168A48]"
                />
                <StaffBookingStyleStat
                    label="Average Sale"
                    value={peso(completedTodayOrders.length ? staffTodaySales / completedTodayOrders.length : 0)}
                    helper="Average value of today's transactions"
                    icon={<ShoppingBag size={24} strokeWidth={1.9} />}
                    iconBackground="bg-[#FFF3E4]"
                    iconColor="text-[#C8791D]"
                />
            </div>

            <div className="space-y-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
                    <section className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
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
                        allowHorizontalScroll
                        stickyHeader
                        showPayment
                        showTimeOnly
                    />
                </div>
            </div>

            {isManager && (
                <VoidOrderModal
                    key={voidTarget?.id || "void-none"}
                    order={voidTarget}
                    pos={pos}
                    onClose={() => setVoidTarget(null)}
                />
            )}
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
                    className={`${productGridClass} border-b border-[#E6DDF0] bg-white px-5 py-3 text-xs font-semibold text-[#806A8C]`}
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

function VoidOrderModal({
                            order,
                            pos,
                            onClose,
                        }: {
    order: Order | null;
    pos: UsePOSReturn;
    onClose: () => void;
}) {
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    if (!order) return null;

    const submitVoid = async () => {
        const cleanReason = reason.trim();

        if (cleanReason.length < 5) {
            alert("Please enter a clear void reason of at least 5 characters.");
            return;
        }

        const confirmed = window.confirm(
            `Void transaction ${order.id}? Stock will be restored and the transaction will remain in the audit history.`
        );
        if (!confirmed) return;

        setSaving(true);
        try {
            const success = await pos.voidPosOrder(order.id, cleanReason);
            if (!success) return;
            setReason("");
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[175] flex items-center justify-center bg-black/35 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-[#1A1220]">Void POS Transaction</h3>
                        <p className="mt-1 text-xs text-[#806A8C]">
                            {order.id} · {peso(Number(order.total || 0))}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} disabled={saving} className="text-[#806A8C]">
                        <X size={18} />
                    </button>
                </div>

                <div className="mt-4 rounded-xl border border-[#F2D4D4] bg-[#FFF8F8] p-3 text-xs leading-5 text-[#7A3A3A]">
                    Voiding keeps the original sale for audit history, reverses its inventory deduction, and removes it from realized sales summaries. Completed sales are not directly edited or deleted.
                </div>

                <label className="mt-4 block text-xs font-semibold text-[#5A476A]">Void reason</label>
                <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Example: Incorrect item entered at checkout"
                    className="mt-1 w-full resize-none rounded-xl border border-[#E3D8EA] bg-white px-3 py-2.5 text-sm text-[#1A1220] outline-none focus:border-[#2B174C]"
                />

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-xl border border-[#D8CBE7] px-4 py-2 text-sm font-semibold text-[#2B174C] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void submitVoid()}
                        disabled={saving || reason.trim().length < 5}
                        className="rounded-xl bg-[#B42318] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? "Voiding..." : "Void Transaction"}
                    </button>
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

/** An 80-mm receipt-size PDF generated in-browser without new dependencies.
 *  Uses the stored VAT, sale amount, and purchased lines; no tax re-computation.
 *  Designed for internal transaction receipts, not a substitute for a registered invoice.
 */
function downloadSalesReceiptPDF(order: Order) {
    const storeName =
        sessionStorage.getItem("business_name") ||
        sessionStorage.getItem("store_name") ||
        sessionStorage.getItem("stocknbook_store_name") ||
        "StockNBook Store";
    const branchName = order.branchName || "Assigned Branch";
    const control = order.controlNumber || order.id;
    const cashier = order.cashierName ||
        (order.cashierId ? `Employee #${order.cashierId}` : "Not available");
    const time = formatPOSOrderTime(order);
    const paymentLabels: Record<string, string> = {
        CASH: "Cash", GCASH: "GCash", BANK_TRANSFER: "Bank Transfer", CREDIT: "Credit",
    };
    const paymentLabel = paymentLabels[String(order.paymentMode || "CASH").toUpperCase()] ||
        String(order.paymentMode || "Cash");
    const currency = (value: unknown) =>
        `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // Core PDF fonts only support WinAnsi. Use ASCII so PDF byte offsets are accurate.
    const ascii = (value: unknown) => String(value ?? "")
        .normalize("NFKD").replace(/[^\x20-\x7E]/g, "-");
    const escapePDF = (value: unknown) => ascii(value)
        .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

    const width = 227; // approximately 80 mm
    const margin = 13;
    const right = width - margin;
    const usable = right - margin;
    const entries: Array<{ kind: "text" | "rule"; text?: string; y: number; x?: number; font?: "F1" | "F2"; size?: number }> = [];
    let top = 16;
    const measuredWidth = (text: string, size: number) =>
        Array.from(ascii(text)).reduce((n, ch) => n + ("WM@%".includes(ch) ? 0.82 : "il1.,:;!| ".includes(ch) ? 0.28 : 0.52) * size, 0);
    const drawText = (value: unknown, size = 9, font: "F1" | "F2" = "F1", align: "left" | "center" | "right" = "left", gap = 13) => {
        const text = ascii(value);
        let x = margin;
        if (align === "right") x = right - measuredWidth(text, size);
        if (align === "center") x = margin + (usable - measuredWidth(text, size)) / 2;
        entries.push({ kind: "text", text, size, font, x: Math.max(4, x), y: top });
        top += gap;
    };
    const rule = () => { top += 2; entries.push({ kind: "rule", y: top }); top += 10; };
    const wrapped = (value: unknown, size = 9, font: "F1" | "F2" = "F1") => {
        const words = ascii(value).split(/\s+/).filter(Boolean);
        let line = "";
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (line && measuredWidth(next, size) > usable) {
                drawText(line, size, font, "left", 12);
                line = word;
            } else {
                line = next;
            }
        }
        if (line) drawText(line, size, font, "left", 12);
    };
    const amountRow = (label: string, amount: unknown, bold = false, size = 9) => {
        const font = bold ? "F2" : "F1";
        const labelText = ascii(label);
        const amountText = currency(amount);
        const priceX = Math.max(margin + 73, right - measuredWidth(amountText, size));
        entries.push({ kind: "text", text: labelText, size, font, x: margin, y: top });
        entries.push({ kind: "text", text: amountText, size, font, x: priceX, y: top });
        top += bold ? 18 : 14;
    };

    drawText(storeName, 13, "F2", "center", 18);
    drawText(branchName, 9, "F1", "center", 14);
    drawText("SALES RECEIPT", 11, "F2", "center", 20);
    rule();
    wrapped(`Order: ${order.id}`, 8);
    wrapped(`Control: ${control}`, 8);
    drawText(`Date: ${order.date}`, 8, "F1", "left", 12);
    drawText(`Time: ${time}`, 8, "F1", "left", 12);
    wrapped(`Processed By: ${cashier}`, 8);
    drawText(`Payment: ${paymentLabel}`, 8, "F1", "left", 12);
    drawText(`Tax: ${String(order.taxType || "NON_VAT").toUpperCase() === "VAT" ? "VAT Registered (12%)" : "Non-VAT"}`, 8, "F1", "left", 13);
    rule();
    drawText("ITEMS PURCHASED", 9, "F2", "left", 16);

    if (Array.isArray(order.items) && order.items.length) {
        for (const item of order.items) {
            wrapped(item.name || "Product", 9, "F2");
            const qty = Math.max(0, Number(item.quantity || 0));
            const hasUnitPrice = item.unitPrice !== undefined && item.unitPrice !== null;
            const hasLineTotal = item.lineTotal !== undefined && item.lineTotal !== null;
            if (hasUnitPrice || hasLineTotal) {
                // These are the original prices saved in order_items, not
                // reconstructed from the grand total or current inventory.
                const unit = hasUnitPrice
                    ? Number(item.unitPrice)
                    : qty > 0 ? Number(item.lineTotal) / qty : 0;
                const lineTotal = hasLineTotal
                    ? Number(item.lineTotal)
                    : unit * qty;
                // Clearly label both values while staying within 80-mm paper.
                drawText(`Qty: ${qty}  |  Unit Price: ${currency(unit)}`, 8, "F1", "left", 13);
                amountRow("Item Total", lineTotal, true, 8);
            } else {
                drawText(`Qty: ${qty}  |  Price not available in historical record`, 7, "F1", "left", 13);
            }
            top += 5;
        }
    } else {
        drawText("Item detail unavailable in POS data", 8, "F1", "left", 14);
    }
    rule();
    if (String(order.taxType || "").toUpperCase() === "VAT") {
        amountRow("VATable Sales", order.vatableSales ?? 0);
        amountRow("VAT Amount (12%)", order.vatAmount ?? 0);
    } else {
        amountRow("Non-VAT Sales", order.total);
        amountRow("VAT Amount", 0);
    }
    rule();
    amountRow("GRAND TOTAL", order.total, true, 10);
    amountRow("Amount Received", order.customerPayment ?? order.total);
    amountRow("Change", order.changeDue ?? 0);
    rule();
    drawText("THANK YOU FOR YOUR PURCHASE!", 9, "F2", "center", 15);
    drawText("Generated by StockNBook POS", 7, "F1", "center", 12);

    const height = Math.max(330, top + 15);
    const stream = entries.map((entry) => {
        if (entry.kind === "rule") {
            const yy = height - entry.y;
            return `0.72 G 0.45 w ${margin} ${yy} m ${right} ${yy} l S`;
        }
        const yy = height - entry.y;
        const isHeading = entry.font === "F2";
        const gray = isHeading ? "0.10 g" : "0.23 g";
        return `${gray} BT /${entry.font || "F1"} ${entry.size || 9} Tf 1 0 0 1 ${(entry.x || margin).toFixed(2)} ${yy.toFixed(2)} Tm (${escapePDF(entry.text)}) Tj ET`;
    }).join("\n");

    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let source = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((obj, index) => {
        offsets.push(source.length);
        source += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = source.length;
    source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index++) {
        source += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const file = new Blob([source], { type: "application/pdf" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `StockNBook-Receipt-${order.id.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CurrentOrderPanel({ pos }: { pos: UsePOSReturn }) {
    const [successToast, setSuccessToast] =
        useState<SaleSuccessToastMessage | null>(null);

    const canUseCreditSales = pos.canUseCreditSales;
    const creditCustomerName =
        String(pos.customerName || "").trim().toLowerCase() === "walk-in"
            ? ""
            : String(pos.customerName || "");
    const creditCustomerAddress =
        String(pos.customerAddress || "").trim().toLowerCase() === "n/a"
            ? ""
            : String(pos.customerAddress || "");
    const [creditTermsAccepted, setCreditTermsAccepted] = useState(false);
    const [creditRisk, setCreditRisk] =
        useState<CreditCheckResult>(EMPTY_CREDIT_CHECK);
    const [creditCheckLoading, setCreditCheckLoading] = useState(false);
    const [checkedCreditContact, setCheckedCreditContact] = useState("");

    useEffect(() => {
        if (
            pos.paymentMode !== "CREDIT" ||
            !isValidCreditContact(pos.customerContactNumber)
        ) {
            return;
        }

        const contactAtRequestTime = normalizeCreditContact(
            pos.customerContactNumber
        );

        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setCreditCheckLoading(true);
            const result = await pos.checkCustomerCredit(
                pos.customerContactNumber
            );

            if (!cancelled) {
                setCreditRisk(result);
                setCheckedCreditContact(contactAtRequestTime);
                setCreditCheckLoading(false);
            }
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [
        pos.paymentMode,
        pos.customerContactNumber,
        pos.checkCustomerCredit,
    ]);

    const currentCreditContact = normalizeCreditContact(
        pos.customerContactNumber
    );
    const creditCheckMatchesCurrentContact =
        pos.paymentMode === "CREDIT" &&
        isValidCreditContact(pos.customerContactNumber) &&
        checkedCreditContact === currentCreditContact;

    const effectiveCreditRisk = creditCheckMatchesCurrentContact
        ? creditRisk
        : EMPTY_CREDIT_CHECK;

    const creditIdentityComplete =
        creditCustomerName.trim().length >= 2 &&
        isValidCreditContact(pos.customerContactNumber);

    const creditStatusVerified =
        effectiveCreditRisk.status === "NEW" ||
        effectiveCreditRisk.status === "CLEARED" ||
        effectiveCreditRisk.restricted;

    const creditSaleBlocked =
        pos.paymentMode === "CREDIT" &&
        (
            !canUseCreditSales ||
            !creditIdentityComplete ||
            !creditTermsAccepted ||
            creditCheckLoading ||
            !creditStatusVerified ||
            effectiveCreditRisk.restricted
        );

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

        const isCredit = pos.paymentMode === "CREDIT";
        const paymentText = String(pos.payment || "").trim();
        const paidAmount =
            isCredit && paymentText === ""
                ? 0
                : Number(paymentText.replace(/,/g, ""));

        if (!isCredit && paymentText === "") {
            alert("Please enter customer payment.");
            return;
        }

        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
            alert("Please enter a valid customer payment.");
            return;
        }

        if (!isCredit && paidAmount < pos.total) {
            alert("Amount Received must be equal to or greater than Grand Total.");
            return;
        }

        if (isDigitalPayment && Math.round(paidAmount * 100) !== Math.round(pos.total * 100)) {
            alert("GCash and Bank Transfer must be verified for the exact Grand Total; no change is given.");
            return;
        }

        if (isCredit && paidAmount > pos.total) {
            alert("Credit sale payment cannot exceed the order total.");
            return;
        }

        if (isCredit) {
            if (!canUseCreditSales) {
                alert("Only an assigned Manager can create credit sales.");
                return;
            }

            if (creditCustomerName.trim().length < 2) {
                alert("Customer full name is required for credit sales.");
                return;
            }

            if (!isValidCreditContact(pos.customerContactNumber)) {
                alert("Enter a valid customer contact number for the credit sale.");
                return;
            }

            setCreditCheckLoading(true);
            const latestCreditRisk = await pos.checkCustomerCredit(
                pos.customerContactNumber
            );
            setCreditCheckLoading(false);
            setCreditRisk(latestCreditRisk);
            setCheckedCreditContact(
                normalizeCreditContact(pos.customerContactNumber)
            );

            if (latestCreditRisk.status === "UNVERIFIED") {
                alert("Unable to verify the customer's credit status. Please try again.");
                return;
            }

            if (latestCreditRisk.restricted) {
                alert(
                    `New credit is blocked while this customer has an outstanding balance of ${peso(
                        latestCreditRisk.outstandingBalance
                    )}. Cash/non-credit purchases are still allowed.`
                );
                return;
            }

            if (!creditTermsAccepted) {
                alert(
                    "Confirm that the customer acknowledges the balance, due date, and credit restriction terms."
                );
                return;
            }
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

        if (isCredit) {
            setCreditTermsAccepted(false);
            setCreditRisk(EMPTY_CREDIT_CHECK);
        }
    };

    return (
        <>
            <SaleSuccessToast
                toast={successToast}
                onClose={() => setSuccessToast(null)}
            />

            <aside className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm xl:sticky xl:top-24 xl:self-start">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[19px] font-bold text-[#1A1220]">
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
                        {pos.paymentMode === "CREDIT" ? (
                            <div className="space-y-2">
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                            Customer Full Name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            value={creditCustomerName}
                                            onChange={(e) =>
                                                pos.setCustomerName(e.target.value)
                                            }
                                            placeholder="Full name"
                                            autoComplete="name"
                                            className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] shadow-sm focus:border-[#2B174C] focus:outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                            Contact Number <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            value={pos.customerContactNumber}
                                            onChange={(e) => pos.setCustomerContactNumber(e.target.value)}
                                            placeholder="e.g. 0917 123 4567"
                                            inputMode="tel"
                                            autoComplete="tel"
                                            className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] shadow-sm focus:border-[#2B174C] focus:outline-none"
                                        />
                                        <p className="mt-1 text-[10px] text-[#8B7A95]">
                                            Use a valid Philippine mobile number, e.g. 0917 123 4567 or +63 917 123 4567.
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                        Billing / Customer Address <span className="text-[10px] font-normal text-[#8B7A95]">(Optional)</span>
                                    </label>
                                    <input
                                        value={creditCustomerAddress}
                                        onChange={(e) =>
                                            pos.setCustomerAddress(e.target.value)
                                        }
                                        placeholder="Optional — for delivery or billing use"
                                        autoComplete="street-address"
                                        className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] shadow-sm focus:border-[#2B174C] focus:outline-none"
                                    />
                                    <p className="mt-1 text-[10px] text-[#8B7A95]">
                                        Optional. Use only when needed for delivery, billing, or business records.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                    Customer Type
                                </label>
                                <div className="flex min-h-[42px] items-center rounded-xl border border-[#E3D8EA] bg-[#F8F5FA] px-4 py-2.5 text-sm font-semibold text-[#1A1220]">
                                    Walk-in
                                </div>
                            </div>
                        )}

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
                                        pos.setCreditTerm("N/A");
                                        pos.setCustomerName("Walk-in");
                                        pos.setCustomerAddress("N/A");
                                        pos.setCustomerContactNumber("");
                                        setCreditTermsAccepted(false);
                                        setCreditRisk(EMPTY_CREDIT_CHECK);
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

                        {pos.paymentMode === "CREDIT" && (
                            <div className="space-y-3">
                                <div
                                    className={`rounded-xl border px-3 py-2.5 ${
                                        effectiveCreditRisk.restricted
                                            ? "border-red-200 bg-red-50"
                                            : effectiveCreditRisk.status === "CLEARED"
                                                ? "border-emerald-200 bg-emerald-50"
                                                : "border-[#E6DDF0] bg-[#FAF7FC]"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-[11px] font-bold text-[#2B174C]">
                                                Customer Credit Check
                                            </p>
                                            <p className="mt-0.5 text-[10px] text-[#6A5D6F]">
                                                {creditCheckLoading
                                                    ? "Checking the store-wide credit history..."
                                                    : effectiveCreditRisk.status === "OVERDUE"
                                                        ? "Credit restricted: overdue balance must be settled first."
                                                        : effectiveCreditRisk.status === "OUTSTANDING"
                                                            ? "Credit restricted: an existing credit balance is still open."
                                                            : effectiveCreditRisk.status === "CLEARED"
                                                                ? "Previous credit is fully settled. New credit is eligible."
                                                                : effectiveCreditRisk.status === "NEW"
                                                                    ? "No outstanding credit found for this contact number."
                                                                    : "Enter the contact number to verify credit eligibility."}
                                            </p>
                                        </div>

                                        <span
                                            className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${
                                                effectiveCreditRisk.restricted
                                                    ? "bg-red-100 text-red-700"
                                                    : effectiveCreditRisk.status === "CLEARED"
                                                        ? "bg-emerald-100 text-emerald-700"
                                                        : "bg-violet-100 text-[#5B2FC6]"
                                            }`}
                                        >
                                            {creditCheckLoading ? "CHECKING" : effectiveCreditRisk.status}
                                        </span>
                                    </div>

                                    {effectiveCreditRisk.restricted && (
                                        <div className="mt-2 border-t border-red-200 pt-2 text-[10px] text-red-700">
                                            <p>
                                                Outstanding: <strong>{peso(effectiveCreditRisk.outstandingBalance)}</strong>
                                                {effectiveCreditRisk.overdueBalance > 0
                                                    ? ` • Overdue: ${peso(effectiveCreditRisk.overdueBalance)}`
                                                    : ""}
                                            </p>

                                            {effectiveCreditRisk.oldestDueDate && (
                                                <p className="mt-0.5">
                                                    Oldest due date: {formatCollectionDate(
                                                    effectiveCreditRisk.oldestDueDate
                                                        ? addDaysToDate(effectiveCreditRisk.oldestDueDate, 0)
                                                        : null
                                                )}
                                                </p>
                                            )}

                                            <p className="mt-1 font-semibold">
                                                New credit is disabled until the balance is fully settled.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                        Credit Term
                                    </label>
                                    <select
                                        value={pos.creditTerm}
                                        onChange={(e) => pos.setCreditTerm(e.target.value)}
                                        className="w-full rounded-xl border border-[#E3D8EA] bg-white px-3 py-2.5 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C]"
                                    >
                                        <option value="15 Days">15 Days</option>
                                        <option value="30 Days">30 Days</option>
                                    </select>

                                    {pos.creditDueDate && (
                                        <p className="mt-1 text-[11px] font-medium text-[#806A8C]">
                                            Due Date: <span className="font-semibold text-[#5A476A]">{pos.creditDueDate}</span>
                                        </p>
                                    )}
                                </div>

                                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#E6DDF0] bg-[#FCFAFD] px-3 py-2.5">
                                    <input
                                        type="checkbox"
                                        checked={creditTermsAccepted}
                                        onChange={(e) => setCreditTermsAccepted(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 accent-[#2B174C]"
                                    />
                                    <span className="text-[10px] leading-4 text-[#6A5D6F]">
                                        Customer name and contact number were verified, and the customer acknowledges
                                        the balance, due date, and that another credit sale will be blocked while
                                        any previous credit balance remains unpaid.
                                    </span>
                                </label>
                            </div>
                        )}
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
                                hasExpiredCartItem ||
                                creditSaleBlocked
                            }
                            title={
                                hasExpiredCartItem
                                    ? "Remove expired items before placing the order"
                                    : creditSaleBlocked
                                        ? creditCheckLoading
                                            ? "Wait for the customer credit check to finish"
                                            : effectiveCreditRisk.restricted
                                                ? "Settle the customer's outstanding credit before creating another credit sale"
                                                : "Enter a valid customer name/contact number, verify credit eligibility, and confirm the credit terms"
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

function addDaysToDate(value: string, days: number) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return null;

    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? new Date(`${rawValue}T00:00:00`)
        : new Date(rawValue);

    if (Number.isNaN(parsed.getTime())) return null;

    parsed.setHours(0, 0, 0, 0);
    parsed.setDate(parsed.getDate() + days);
    return parsed;
}

function formatCollectionDate(value: Date | null) {
    if (!value) return "—";
    return value.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function getManilaISODate(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);

    const readPart = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value || "";

    return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}

function getLocalISODate(value: Date | null) {
    if (!value) return "";

    return [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, "0"),
        String(value.getDate()).padStart(2, "0"),
    ].join("-");
}

function getCollectionStatus(order: Order, dueDate: Date | null, balance: number) {
    // Use the Philippine business date for overdue decisions.
    if (balance <= 0) return "PAID";

    const storedDueDate =
        String(order.creditDueDate || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
    const dueDateISO = storedDueDate || getLocalISODate(dueDate);

    if (dueDateISO && dueDateISO < getManilaISODate()) {
        return "OVERDUE";
    }

    const totalPaid = Number(order.totalPaid ?? order.customerPayment ?? 0);
    return totalPaid > 0 ? "PARTIAL" : "PENDING";
}

function CollectionPaymentModal({
                                    order,
                                    pos,
                                    onClose,
                                }: {
    order: Order | null;
    pos: UsePOSReturn;
    onClose: () => void;
}) {
    const [amount, setAmount] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("CASH");
    const [referenceNumber, setReferenceNumber] = useState("");
    const [history, setHistory] = useState<CreditCollection[]>([]);
    const [saving, setSaving] = useState(false);
    const selectedOrderId = order?.id || "";

    useEffect(() => {
        if (!selectedOrderId) return;

        let active = true;
        void pos.getCollectionHistory(selectedOrderId).then((rows) => {
            if (active) setHistory(rows);
        });

        return () => {
            active = false;
        };
    }, [selectedOrderId, pos.getCollectionHistory]);

    if (!order) return null;

    const totalPaid = Number(order.totalPaid ?? order.customerPayment ?? 0);
    const balance = Math.max(
        0,
        Number(order.balance ?? Number(order.total || 0) - totalPaid)
    );

    const submitPayment = async () => {
        const numericAmount = Number(String(amount).replace(/,/g, ""));
        const normalizedMethod = String(paymentMethod || "CASH").toUpperCase();
        const cleanReference = referenceNumber.trim();

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            alert("Enter a valid collection amount.");
            return;
        }

        if (numericAmount > balance) {
            alert("Collection amount cannot exceed the remaining balance.");
            return;
        }

        if (
            normalizedMethod !== "CASH" &&
            !cleanReference
        ) {
            alert("Reference number is required for non-cash collection payments.");
            return;
        }

        setSaving(true);

        try {
            const success = await pos.recordCreditPayment(
                order.id,
                numericAmount,
                normalizedMethod,
                cleanReference
            );

            if (!success) {
                return;
            }

            // Reload the orders after credit_collections is updated.
            // This makes totalPaid, balance, collectionStatus and the
            // Pending Collections list update automatically.
            await pos.refreshAll();

            setAmount("");
            setReferenceNumber("");
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/35 p-4">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="flex items-start justify-between border-b border-[#E6DDF0] px-5 py-4">
                    <div>
                        <h3 className="text-lg font-bold text-[#1A1220]">Record Credit Payment</h3>
                        <p className="mt-1 text-xs text-[#7A6A84]">
                            {order.controlNumber || order.id} • {order.customer || "Customer"}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[#806A8C] hover:text-[#2B174C]"
                        aria-label="Close collection dialog"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="grid gap-4 p-5 md:grid-cols-2">
                    <div className="space-y-3">
                        <div className="rounded-xl bg-[#FAF7FC] p-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[#7A6A84]">Original Total</span>
                                <strong>{peso(Number(order.total || 0))}</strong>
                            </div>
                            <div className="mt-1 flex justify-between">
                                <span className="text-[#7A6A84]">Paid</span>
                                <strong>{peso(totalPaid)}</strong>
                            </div>
                            <div className="mt-2 flex justify-between border-t border-[#E6DDF0] pt-2">
                                <span className="font-semibold text-[#2B174C]">Balance</span>
                                <strong className="text-[#2B174C]">{peso(balance)}</strong>
                            </div>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                Collection Amount
                            </label>
                            <input
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                inputMode="decimal"
                                placeholder="0.00"
                                className="w-full rounded-xl border border-[#E3D8EA] px-4 py-2.5 text-sm outline-none focus:border-[#2B174C]"
                            />
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                Payment Method
                            </label>
                            <select
                                value={paymentMethod}
                                onChange={(e) => setPaymentMethod(e.target.value)}
                                className="w-full rounded-xl border border-[#E3D8EA] px-3 py-2.5 text-sm outline-none focus:border-[#2B174C]"
                            >
                                <option value="CASH">Cash</option>
                                <option value="GCASH">GCash</option>
                                <option value="BANK_TRANSFER">Bank Transfer</option>
                                <option value="OTHER">Other</option>
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                Reference Number
                                {paymentMethod !== "CASH" && (
                                    <span className="text-red-500"> *</span>
                                )}
                            </label>
                            <input
                                value={referenceNumber}
                                onChange={(e) => setReferenceNumber(e.target.value)}
                                placeholder={paymentMethod === "CASH" ? "Optional for cash" : "Required for non-cash payment"}
                                className="w-full rounded-xl border border-[#E3D8EA] px-4 py-2.5 text-sm outline-none focus:border-[#2B174C]"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => void submitPayment()}
                            disabled={saving || balance <= 0}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                        >
                            <WalletCards size={16} />
                            {saving ? "Saving..." : "Record Payment"}
                        </button>
                    </div>

                    <div className="min-w-0">
                        <h4 className="mb-2 text-sm font-bold text-[#1A1220]">Collection History</h4>
                        <div className="max-h-[330px] overflow-y-auto rounded-xl border border-[#E6DDF0]">
                            {history.length === 0 ? (
                                <p className="px-4 py-8 text-center text-xs text-[#8A7D90]">
                                    No follow-up payments recorded yet.
                                </p>
                            ) : (
                                history.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="border-b border-[#EFE7F4] px-4 py-3 text-xs last:border-0"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <strong className="text-[#2B174C]">{peso(entry.amount)}</strong>
                                            <span className="text-[#806A8C]">
                                                {formatCollectionDate(addDaysToDate(entry.paymentDate, 0))}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[#6A5D6F]">
                                            {entry.paymentMethod}
                                            {entry.referenceNumber ? ` • ${entry.referenceNumber}` : ""}
                                        </p>
                                        <p className="mt-0.5 text-[10px] text-[#9B8AAA]">
                                            Received by {entry.receivedByName || entry.receivedByRole || "Manager"}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PendingCollections({ pos }: { pos: UsePOSReturn }) {
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    const pending = pos.pendingCreditOrders
        .filter((order) => {
            const mode = String(order.paymentMode || "").toUpperCase();
            const balance = Math.max(
                0,
                Number(
                    order.balance ??
                    Number(order.total || 0) -
                    Number(order.totalPaid ?? order.customerPayment ?? 0)
                )
            );
            return mode === "CREDIT" && balance > 0;
        })
        .map((order) => {
            const fallbackDays = String(order.creditTerm || "").startsWith("30") ? 30 : 15;
            const dueDate = order.creditDueDate
                ? addDaysToDate(order.creditDueDate, 0)
                : addDaysToDate(order.date, fallbackDays);
            const totalPaid = Number(order.totalPaid ?? order.customerPayment ?? 0);
            const balance = Math.max(
                0,
                Number(order.balance ?? Number(order.total || 0) - totalPaid)
            );
            const status = getCollectionStatus(order, dueDate, balance);
            return { order, dueDate, balance, totalPaid, status };
        })
        .sort((a, b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0));

    return (
        <>
            <CollectionPaymentModal
                order={selectedOrder}
                pos={pos}
                onClose={() => setSelectedOrder(null)}
            />

            <section className="flex h-[320px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                <div className="border-b border-[#E9E1EE] px-4 py-3.5">
                    <h2 className="text-[16px] font-bold text-[#21132E]">Pending Collections</h2>
                    <p className="mt-0.5 text-[11px] text-[#86778F]">
                        Credit sales with an outstanding balance. Status updates automatically from payments and due dates.
                    </p>
                </div>

                {pending.length === 0 ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-7 text-center text-sm text-[#8A7D90]">
                        No pending credit collections.
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full min-w-[650px] table-fixed text-[11px]">
                            <thead className="sticky top-0 z-10 bg-white">
                            <tr className="border-b border-[#EEE6F2] text-left text-[#806A8C]">
                                <th className="w-[24%] px-3 py-3 font-semibold">Customer / Contact</th>
                                <th className="w-[18%] px-3 py-3 font-semibold">Control No.</th>
                                <th className="w-[19%] px-3 py-3 font-semibold">Due / Status</th>
                                <th className="w-[18%] px-3 py-3 text-right font-semibold">Paid / Total</th>
                                <th className="w-[21%] px-3 py-3 text-right font-semibold">Balance / Action</th>
                            </tr>
                            </thead>
                            <tbody>
                            {pending.map(({ order, dueDate, balance, totalPaid, status }) => (
                                <tr key={order.id} className="border-b border-[#F0EAF3] align-top last:border-0">
                                    <td className="px-3 py-3">
                                        <p className="break-words font-semibold text-[#2B174C]">
                                            {order.customer || "—"}
                                        </p>
                                        {order.customerContactNumber ? (
                                            <a
                                                href={`tel:${order.customerContactNumber}`}
                                                className="mt-1 inline-flex items-center gap-1 break-all text-[10px] font-semibold text-[#5B2FC6] hover:underline"
                                            >
                                                <Phone size={10} />
                                                {order.customerContactNumber}
                                            </a>
                                        ) : (
                                            <p className="mt-1 text-[10px] text-red-500">No contact saved</p>
                                        )}
                                    </td>
                                    <td className="break-all px-3 py-3 text-[#5F4E75]">
                                        {order.controlNumber || order.id}
                                    </td>
                                    <td className="px-3 py-3">
                                        <p className="text-[#5F4E75]">{formatCollectionDate(dueDate)}</p>
                                        <span
                                            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ${
                                                status === "OVERDUE"
                                                    ? "bg-red-50 text-red-600"
                                                    : status === "PARTIAL"
                                                        ? "bg-amber-50 text-amber-700"
                                                        : "bg-violet-50 text-[#5B2FC6]"
                                            }`}
                                        >
                                            {status}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                        <p className="font-semibold text-[#1A1220]">{peso(totalPaid)}</p>
                                        <p className="mt-1 text-[10px] text-[#806A8C]">
                                            of {peso(Number(order.total || 0))}
                                        </p>
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                        <p className="font-bold text-[#2B174C]">{peso(balance)}</p>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedOrder(order)}
                                            className="mt-1 rounded-lg border border-[#D8CBE7] px-2 py-1 text-[9px] font-bold text-[#2B174C] hover:bg-[#F7F1FF]"
                                        >
                                            Record Payment
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </>
    );
}

export default function ManagerPOS({ pos }: { pos: UsePOSReturn }) {
    return <BranchPOSView pos={pos} />;
}