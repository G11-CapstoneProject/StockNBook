"use client";

import { useEffect, useState } from "react";

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
    Printer,
    WalletCards,
} from "lucide-react";
import type { UsePOSReturn } from "@/hooks/usePOS";
import {
    OrdersTable,
    POSLayout,
    StatCard,
    peso,
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

export function BranchPOSView({ pos }: { pos: UsePOSReturn }) {
    const isManager = pos.role === "manager";
    const lowStockCount = pos.displayProducts.filter(
        (product) => Number(product.stock || 0) <= Number(product.alertLevel || 0)
    ).length;

    return (
        <POSLayout
            role={pos.role}
            isOwner={pos.isOwner}
            activeBranchName={pos.activeBranchName}
            onRefresh={() => window.location.reload()}
        >
            <div className={`mb-3 grid gap-3 ${isManager ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}>
                <StatCard
                    label="Today's Sales"
                    value={peso(pos.todayRevenue)}
                    helper="Sales recorded today"
                    icon={<CircleDollarSign size={18} strokeWidth={1.9} />}
                    iconClassName="bg-[#F0E9FF] text-[#5A35A5]"
                />

                <StatCard
                    label="Transactions Completed"
                    value={pos.todayOrders.length}
                    helper="Completed transactions today"
                    icon={<ReceiptText size={18} strokeWidth={1.9} />}
                    iconClassName="bg-[#EAF1FF] text-[#245EDB]"
                    valueClassName="text-[#245EDB]"
                />

                {isManager && (
                    <StatCard
                        label="Low Stock Items"
                        value={lowStockCount}
                        helper="Items at or below alert level"
                        icon={<Boxes size={18} strokeWidth={1.9} />}
                        iconClassName="bg-[#FFF2E5] text-[#D56A1F]"
                        valueClassName="text-[#D56A1F]"
                    />
                )}
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

                <div className={`grid gap-3 ${isManager ? "lg:grid-cols-2" : "grid-cols-1"}`}>
                    {isManager && (
                        <PendingCollections pos={pos} />
                    )}

                    <OrdersTable
                        title="Today's Orders"
                        subtitle={`${pos.todayOrders.length} recorded order${
                            pos.todayOrders.length !== 1 ? "s" : ""
                        } today`}
                        orders={pos.todayOrders}
                        emptyText="No orders for today yet."
                        containerClassName="h-[320px] min-h-0 flex flex-col"
                        scrollAreaClassName="min-h-0 flex-1 overflow-y-auto"
                        allowHorizontalScroll={false}
                        stickyHeader
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
        "grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)_minmax(70px,0.55fr)_minmax(90px,0.65fr)_minmax(145px,0.9fr)]";

    if (pos.displayProducts.length === 0) {
        return (
            <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                <p className="text-sm text-[#9B8AAA]">No products found.</p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white">
            <div className="w-full min-w-0">
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

function escapeInvoiceText(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function printSalesInvoice(order: Order) {
    const businessName =
        sessionStorage.getItem("business_name") ||
        sessionStorage.getItem("store_name") ||
        sessionStorage.getItem("stocknbook_store_name") ||
        "StockNBook Store";
    const businessAddress =
        sessionStorage.getItem("business_address") ||
        sessionStorage.getItem("store_address") ||
        "";
    const tin =
        sessionStorage.getItem("tin") ||
        sessionStorage.getItem("store_tin") ||
        "";

    const itemsHtml = (order.items || [])
        .map((item) => {
            const unitPrice = Number(
                item.unitPrice ??
                (item.quantity > 0 ? Number(item.lineTotal || 0) / item.quantity : 0)
            );
            const lineTotal = Number(
                item.lineTotal ?? unitPrice * Number(item.quantity || 0)
            );

            return `
                <tr>
                    <td>${escapeInvoiceText(item.name)}</td>
                    <td style="text-align:center">${Number(item.quantity || 0)}</td>
                    <td style="text-align:right">${escapeInvoiceText(peso(unitPrice))}</td>
                    <td style="text-align:right">${escapeInvoiceText(peso(lineTotal))}</td>
                </tr>
            `;
        })
        .join("");

    const totalPaid = Number(order.totalPaid ?? order.customerPayment ?? 0);
    const balance = Math.max(
        0,
        Number(order.balance ?? Number(order.total || 0) - totalPaid)
    );
    const isCredit = String(order.paymentMode || "").toUpperCase() === "CREDIT";
    const taxLabel =
        String(order.taxType || "").toUpperCase() === "VAT"
            ? "VAT Registered (12%)"
            : "Non-VAT Registered";

    const popup = window.open("", "_blank", "width=900,height=720");
    if (!popup) {
        alert("Please allow pop-ups to print the sales invoice.");
        return;
    }

    popup.document.write(`
        <!doctype html>
        <html>
        <head>
            <title>Sales Invoice ${escapeInvoiceText(order.controlNumber || order.id)}</title>
            <style>
                body { font-family: Arial, sans-serif; color:#1a1220; margin:32px; }
                .head { display:flex; justify-content:space-between; gap:24px; margin-bottom:20px; }
                h1 { margin:0 0 6px; font-size:24px; }
                p { margin:3px 0; font-size:12px; }
                table { width:100%; border-collapse:collapse; margin-top:16px; font-size:12px; }
                th, td { padding:9px 8px; border-bottom:1px solid #ddd; }
                th { text-align:left; background:#f8f5fa; }
                .summary { width:360px; margin-left:auto; margin-top:18px; }
                .row { display:flex; justify-content:space-between; gap:20px; padding:4px 0; font-size:12px; }
                .grand { border-top:1px solid #999; margin-top:4px; padding-top:8px; font-weight:700; }
                .credit { margin-top:18px; border:1px solid #ddd; padding:12px; border-radius:8px; }
                .footer { margin-top:28px; font-size:10px; color:#666; }
                @media print { button { display:none; } body { margin:18px; } }
            </style>
        </head>
        <body>
            <div class="head">
                <div>
                    <h1>${escapeInvoiceText(businessName)}</h1>
                    ${businessAddress ? `<p>${escapeInvoiceText(businessAddress)}</p>` : ""}
                    ${tin ? `<p>TIN: ${escapeInvoiceText(tin)}</p>` : ""}
                    <p>${escapeInvoiceText(taxLabel)}</p>
                </div>
                <div style="text-align:right">
                    <h2 style="margin:0 0 6px">Sales Invoice</h2>
                    <p><strong>Control No.:</strong> ${escapeInvoiceText(order.controlNumber || order.id)}</p>
                    <p><strong>Date:</strong> ${escapeInvoiceText(order.date)}</p>
                    <p><strong>Branch:</strong> ${escapeInvoiceText(order.branchName || "—")}</p>
                    <p><strong>Processed By:</strong> ${escapeInvoiceText(order.cashierName || order.cashierRole || "—")}</p>
                </div>
            </div>

            <div>
                <p><strong>Customer:</strong> ${escapeInvoiceText(order.customer || "—")}</p>
                ${order.customerContactNumber ? `<p><strong>Contact:</strong> ${escapeInvoiceText(order.customerContactNumber)}</p>` : ""}
            </div>

            <table>
                <thead>
                    <tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>

            <div class="summary">
                ${
        String(order.taxType || "").toUpperCase() === "VAT"
            ? `
                            <div class="row"><span>VATable Sales</span><strong>${escapeInvoiceText(peso(Number(order.vatableSales || 0)))}</strong></div>
                            <div class="row"><span>VAT Amount (12%)</span><strong>${escapeInvoiceText(peso(Number(order.vatAmount || 0)))}</strong></div>
                        `
            : `<div class="row"><span>Non-VAT Sales</span><strong>${escapeInvoiceText(peso(Number(order.total || 0)))}</strong></div>`
    }
                <div class="row grand"><span>Grand Total</span><strong>${escapeInvoiceText(peso(Number(order.total || 0)))}</strong></div>
                <div class="row"><span>Amount Paid</span><strong>${escapeInvoiceText(peso(totalPaid))}</strong></div>
                <div class="row"><span>${isCredit ? "Balance Due" : "Change"}</span><strong>${escapeInvoiceText(peso(isCredit ? balance : Number(order.changeDue || 0)))}</strong></div>
            </div>

            ${
        isCredit
            ? `<div class="credit">
                        <p><strong>Payment Type:</strong> Credit</p>
                        <p><strong>Credit Term:</strong> ${escapeInvoiceText(order.creditTerm || "—")}</p>
                        <p><strong>Due Date:</strong> ${escapeInvoiceText(
                order.creditDueDate
                    ? formatCollectionDate(addDaysToDate(order.creditDueDate, 0))
                    : "—"
            )}</p>
                       </div>`
            : `<div class="credit"><p><strong>Payment Type:</strong> Cash</p></div>`
    }

            <p class="footer">Generated by StockNBook POS.</p>
            <script>window.onload = () => window.print();</script>
        </body>
        </html>
    `);
    popup.document.close();
}

function InvoiceModal({
                          order,
                          onClose,
                      }: {
    order: Order | null;
    onClose: () => void;
}) {
    if (!order) return null;

    const totalPaid = Number(order.totalPaid ?? order.customerPayment ?? 0);
    const balance = Math.max(
        0,
        Number(order.balance ?? Number(order.total || 0) - totalPaid)
    );
    const isCredit = String(order.paymentMode || "").toUpperCase() === "CREDIT";

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/35 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-[#1A1220]">Sales Invoice Ready</h3>
                        <p className="mt-1 text-xs text-[#806A8C]">
                            {order.controlNumber || order.id}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="text-[#806A8C]">
                        <X size={18} />
                    </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#FAF7FC] p-4 text-xs">
                    <div>
                        <p className="text-[#806A8C]">Customer</p>
                        <p className="mt-1 font-semibold">{order.customer || "—"}</p>
                    </div>
                    <div>
                        <p className="text-[#806A8C]">Payment</p>
                        <p className="mt-1 font-semibold">{isCredit ? "Credit Sale" : "Cash Sale"}</p>
                    </div>
                    <div>
                        <p className="text-[#806A8C]">Grand Total</p>
                        <p className="mt-1 font-semibold">{peso(Number(order.total || 0))}</p>
                    </div>
                    <div>
                        <p className="text-[#806A8C]">{isCredit ? "Balance Due" : "Change"}</p>
                        <p className="mt-1 font-semibold">
                            {peso(isCredit ? balance : Number(order.changeDue || 0))}
                        </p>
                    </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl border border-[#D8CBE7] px-4 py-2 text-sm font-semibold text-[#2B174C]"
                    >
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={() => printSalesInvoice(order)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white"
                    >
                        <Printer size={16} />
                        Print Invoice
                    </button>
                </div>
            </div>
        </div>
    );
}

function CurrentOrderPanel({ pos }: { pos: UsePOSReturn }) {
    const [successToast, setSuccessToast] =
        useState<SaleSuccessToastMessage | null>(null);

    const hasExpiredCartItem = pos.cartItems.some((item) =>
        isPOSItemExpired(item.expirationDate)
    );

    const orderGridClass =
        "grid grid-cols-[minmax(0,1fr)_62px_76px_82px_24px]";

    const [lastInvoice, setLastInvoice] = useState<Order | null>(null);

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
            alert("Payment must be equal or greater than the total for a cash sale.");
            return;
        }

        if (isCredit && paidAmount > pos.total) {
            alert("Credit sale payment cannot exceed the order total.");
            return;
        }

        if (isCredit && !pos.customerContactNumber.trim()) {
            alert("Customer contact number is required for credit sales.");
            return;
        }

        const placedOrder = await Promise.resolve(pos.handlePlaceOrder());

        if (!placedOrder) {
            return;
        }

        setLastInvoice(placedOrder);
        setSuccessToast({
            title: "Order placed successfully",
            message:
                "The sale has been recorded, inventory was updated, and the invoice is ready to print.",
        });
    };

    return (
        <>
            <SaleSuccessToast
                toast={successToast}
                onClose={() => setSuccessToast(null)}
            />

            <InvoiceModal
                order={lastInvoice}
                onClose={() => setLastInvoice(null)}
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
                    <div className="w-full">
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
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                Customer
                            </label>
                            <div className="flex min-h-[42px] items-center rounded-xl border border-[#E3D8EA] bg-[#F8F5FA] px-4 py-2.5 text-sm font-semibold text-[#1A1220]">
                                Walk-in
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-[#5A476A]">Payment Mode</label>
                                <select
                                    value={pos.paymentMode}
                                    onChange={(e) => {
                                        const mode = e.target.value as "CASH" | "CREDIT";
                                        pos.setPaymentMode(mode);
                                        if (mode === "CASH") pos.setCreditTerm("N/A");
                                        else if (pos.creditTerm === "N/A") pos.setCreditTerm("15 Days");
                                    }}
                                    className="w-full rounded-xl border border-[#E3D8EA] bg-white px-3 py-2.5 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C]"
                                >
                                    <option value="CASH">Cash Sale</option>
                                    <option value="CREDIT">Credit Sale</option>
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
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                        Customer Contact Number <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        value={pos.customerContactNumber}
                                        onChange={(e) => pos.setCustomerContactNumber(e.target.value)}
                                        placeholder="e.g. 0917 123 4567"
                                        inputMode="tel"
                                        className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] shadow-sm focus:border-[#2B174C] focus:outline-none"
                                    />
                                    <p className="mt-1 text-[10px] text-[#8B7A95]">
                                        Required for collection follow-ups.
                                    </p>
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-medium text-[#5A476A]">Credit Term</label>
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
                        <div className="flex items-center justify-between text-[#6A5D6F]">
                            <span>VATable Sales</span>
                            <span className="font-semibold text-[#1A1220]">{peso(pos.vatableSales)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[#6A5D6F]">
                            <span>VAT Amount (12%)</span>
                            <span className="font-semibold text-[#1A1220]">{peso(pos.vatAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-[#E6DDF0] pt-1.5 font-semibold text-[#2B174C]">
                            <span>Grand Total</span>
                            <span>{peso(pos.total)}</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                                {pos.paymentMode === "CREDIT" ? "Initial Payment / Down Payment" : "Customer Payment"}
                            </label>

                            <input
                                value={pos.payment}
                                onChange={(e) => pos.setPayment(e.target.value)}
                                inputMode="decimal"
                                placeholder="0.00"
                                className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] shadow-sm focus:border-[#2B174C] focus:outline-none"
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-[#D8F0DD] bg-[#EEF9F0] px-4 py-3">
                            <span className="text-sm font-semibold text-green-700">
                                {pos.paymentMode === "CREDIT" ? "Remaining Balance" : "Change"}
                            </span>

                            <span className="text-sm font-semibold text-[#1A1220]">
                                {peso(pos.paymentMode === "CREDIT" ? Math.max(0, pos.total - (Number(pos.payment) || 0)) : pos.change)}
                            </span>
                        </div>

                        <button
                            onClick={() => void handlePlaceOrderClick()}
                            disabled={
                                !pos.canPlaceOrder ||
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

function addDaysToDate(value: string, days: number) {
    const parsed = new Date(value);
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

function getCollectionStatus(order: Order, dueDate: Date | null, balance: number) {
    const backendStatus = String(order.collectionStatus || "").toUpperCase();
    if (backendStatus) return backendStatus;
    if (balance <= 0) return "PAID";
    if (dueDate && dueDate.getTime() < new Date(new Date().setHours(0, 0, 0, 0)).getTime()) {
        return "OVERDUE";
    }
    return Number(order.totalPaid ?? order.customerPayment ?? 0) > 0
        ? "PARTIAL"
        : "PENDING";
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

    useEffect(() => {
        if (!order) {
            setHistory([]);
            return;
        }

        let active = true;
        void pos.getCollectionHistory(order.id).then((rows) => {
            if (active) setHistory(rows);
        });

        return () => {
            active = false;
        };
    }, [order, pos]);

    if (!order) return null;

    const totalPaid = Number(order.totalPaid ?? order.customerPayment ?? 0);
    const balance = Math.max(
        0,
        Number(order.balance ?? Number(order.total || 0) - totalPaid)
    );

    const submitPayment = async () => {
        const numericAmount = Number(String(amount).replace(/,/g, ""));

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            alert("Enter a valid collection amount.");
            return;
        }

        if (numericAmount > balance) {
            alert("Collection amount cannot exceed the remaining balance.");
            return;
        }

        setSaving(true);
        const success = await pos.recordCreditPayment(
            order.id,
            numericAmount,
            paymentMethod,
            referenceNumber.trim()
        );
        setSaving(false);

        if (success) {
            onClose();
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
                            </label>
                            <input
                                value={referenceNumber}
                                onChange={(e) => setReferenceNumber(e.target.value)}
                                placeholder="Optional for cash"
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

    const pending = pos.orders
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
                        Credit sales that still have an outstanding balance.
                    </p>
                </div>

                {pending.length === 0 ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-7 text-center text-sm text-[#8A7D90]">
                        No pending credit collections.
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                        <table className="w-full table-fixed text-[11px]">
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