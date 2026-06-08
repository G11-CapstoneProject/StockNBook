"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
    ChevronDown,
    ChevronRight,
    Minus,
    Plus,
    Search,
    ShoppingBag,
    Trash2,
    X,
} from "lucide-react";
import type { UsePOSReturn } from "@/hooks/usePOS";
import { OrdersTable, POSLayout, StatCard, peso } from "./_shared";

export function BranchPOSView({ pos }: { pos: UsePOSReturn }) {
    return (
        <POSLayout
            role={pos.role}
            isOwner={pos.isOwner}
            activeBranchName={pos.activeBranchName}
            currentMonth={pos.currentMonth}
            onRefresh={() => window.location.reload()}
        >
            <div className="mb-5 grid gap-4 md:grid-cols-3">
                <StatCard label="Today's Sales" value={peso(pos.todayRevenue)} />
                <StatCard label="Orders Today" value={pos.todayOrders.length} />
                <StatCard label="Today's Profit" value={peso(pos.todayProfit)} />
            </div>

            <div className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
                    <section className="min-w-0 rounded-[22px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
                            <div className="relative">
                                <Search
                                    size={16}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                                />

                                <input
                                    value={pos.search}
                                    onChange={(e) => pos.setSearch(e.target.value)}
                                    placeholder="Search items or variants..."
                                    className="h-12 w-full rounded-xl border border-[#E3D8EA] bg-white px-4 pl-11 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                                />
                            </div>

                            <select
                                value={pos.categoryFilter}
                                onChange={(e) => pos.setCategoryFilter(e.target.value)}
                                className="h-12 rounded-xl border border-[#E3D8EA] bg-white px-4 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C]"
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

                <OrdersTable
                    title="Today's Orders"
                    subtitle={`${pos.todayOrders.length} recorded order${
                        pos.todayOrders.length !== 1 ? "s" : ""
                    } today`}
                    orders={pos.todayOrders}
                    emptyText="No orders for today yet."
                />
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

    const renderQtyControls = (key: string, stock: number) => {
        const qty = pos.cart[key] || 0;
        const out = stock <= 0;
        const isMax = qty >= stock && stock > 0;

        return (
            <div className="flex items-center justify-center gap-3">
                <button
                    onClick={() => pos.handleQty(key, -1)}
                    disabled={qty <= 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                >
                    <Minus size={13} />
                </button>

                <span className="min-w-6 text-center font-serif text-sm font-semibold text-[#1A1220]">
                    {qty}
                </span>

                <button
                    onClick={() => pos.handleQty(key, 1)}
                    disabled={out || isMax}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                >
                    <Plus size={13} />
                </button>
            </div>
        );
    };

    const productGridClass =
        "grid grid-cols-[minmax(260px,1.45fr)_minmax(130px,0.9fr)_minmax(90px,0.65fr)_minmax(110px,0.7fr)_minmax(170px,0.9fr)]";

    if (pos.displayProducts.length === 0) {
        return (
            <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                <p className="text-sm text-[#9B8AAA]">No products found.</p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-[#E6DDF0] bg-white">
            <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                    <div
                        className={`${productGridClass} border-b border-[#E6DDF0] bg-[#FFFCF7] px-5 py-3 text-[11px] font-semibold tracking-[0.08em] text-[#3D2B76]`}
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
                                            className={`${productGridClass} min-h-[82px] items-center px-5 hover:bg-[#FFFCF7]`}
                                        >
                                            <div className="min-w-0 pr-4">
                                                <div className="flex items-start gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleProduct(product.id)}
                                                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF]"
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
                                                        <p className="truncate font-serif text-base font-semibold text-[#1A1220]">
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

                                            <div className="text-center font-serif text-sm font-semibold text-[#9B8AAA]" />

                                            <div className="flex justify-center">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleProduct(product.id)}
                                                    className="inline-flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-[#F1E9FF] px-4 py-2 text-xs font-semibold text-[#4E2C66] hover:bg-[#E6DDF0]"
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
                                                    const isFirstVariant = index === 0;
                                                    const isLastVariant =
                                                        index === variants.length - 1;

                                                    return (
                                                        <div
                                                            key={key}
                                                            className={`${productGridClass} min-h-[78px] items-center border-b border-[#E6DDF0] bg-[#F7F1FF] px-5 last:border-0`}
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
                                                                        <p className="truncate font-serif text-sm font-semibold text-[#2B174C]">
                                                                            {variant.name || "Variant"}
                                                                        </p>

                                                                        <p
                                                                            className={`mt-0.5 text-xs font-semibold ${status.className}`}
                                                                        >
                                                                            {status.label}
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

                                                            <div className="text-center font-serif text-sm font-semibold text-[#1A1220]">
                                                                {peso(Number(variant.salesPrice || 0))}
                                                            </div>

                                                            {renderQtyControls(
                                                                key,
                                                                Number(variant.stock || 0)
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

                            return (
                                <div
                                    key={product.id}
                                    className={`${productGridClass} min-h-[78px] items-center border-b border-[#EFE7F4] px-5 py-4 last:border-0 hover:bg-[#FFFCF7]`}
                                >
                                    <div className="min-w-0 pl-9 pr-4">
                                        <p className="truncate font-serif text-base font-semibold text-[#1A1220]">
                                            {product.name}
                                        </p>

                                        <p
                                            className={`mt-0.5 text-xs font-semibold ${status.className}`}
                                        >
                                            {status.label}
                                        </p>
                                    </div>

                                    <div className="truncate text-center text-sm text-[#5F4E75]">
                                        {product.category || "Uncategorized"}
                                    </div>

                                    <div className="text-center text-sm font-semibold text-[#1A1220]">
                                        {product.stock}
                                    </div>

                                    <div className="text-center font-serif text-sm font-semibold text-[#1A1220]">
                                        {peso(Number(product.salesPrice || 0))}
                                    </div>

                                    {renderQtyControls(key, Number(product.stock || 0))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

function CurrentOrderPanel({ pos }: { pos: UsePOSReturn }) {
    const [showSuccessDialog, setShowSuccessDialog] = useState(false);
    const successTimeoutRef = useRef<number | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    const orderGridClass =
        "grid grid-cols-[minmax(0,1fr)_62px_76px_82px_24px]";

    useEffect(() => {
        setIsMounted(true);

        return () => {
            if (successTimeoutRef.current) {
                window.clearTimeout(successTimeoutRef.current);
            }
        };
    }, []);

    const handlePlaceOrderClick = async () => {
        if (pos.cartItems.length === 0) return;

        await Promise.resolve(pos.handlePlaceOrder());

        setShowSuccessDialog(true);

        if (successTimeoutRef.current) {
            window.clearTimeout(successTimeoutRef.current);
        }

        successTimeoutRef.current = window.setTimeout(() => {
            setShowSuccessDialog(false);
        }, 4000);
    };

    return (
        <aside className="min-w-0 rounded-[22px] border border-[#E6DDF0] bg-white p-5 shadow-sm xl:sticky xl:top-24 xl:self-start">{isMounted &&
            showSuccessDialog &&
            createPortal(
                <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/35 px-4 backdrop-blur-lg">
                    <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#D8F0DD] bg-[#EEF9F0] px-6 py-5 text-center shadow-xl">
                        <p className="text-base font-bold text-green-700">
                            Successfully placed the order.
                        </p>

                        <p className="mt-2 text-sm font-medium text-green-700/80">
                            The order has been recorded successfully.
                        </p>
                    </div>
                </div>,
                document.body
            )}

            <div className="mb-5 flex items-center justify-between">
                <h2 className="font-serif text-xl font-semibold text-[#1A1220]">
                    Current Order
                </h2>

                {pos.cartItems.length > 0 && (
                    <button
                        type="button"
                        onClick={pos.resetOrderDraft}
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
                                                disabled={item.qty <= 0}
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
                                                className="h-6 w-8 rounded-lg border border-[#E6DDF0] bg-white text-center text-[11px] font-semibold leading-4 text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-1 focus:ring-[#2B174C]"
                                                inputMode="numeric"
                                            />

                                            <button
                                                onClick={() =>
                                                    pos.handleQty(item.key, 1)
                                                }
                                                disabled={item.qty >= item.stock}
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

            <div className="mt-5 border-t border-dashed border-[#D6CBE0] pt-5">
                <div className="mb-4 flex items-center justify-between">
                    <span className="font-serif text-xl font-semibold text-[#1A1220]">
                        Total
                    </span>

                    <span className="font-serif text-2xl font-semibold text-[#1A1220]">
                        {peso(pos.total)}
                    </span>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-[#5A476A]">
                            Customer Payment
                        </label>

                        <input
                            value={pos.payment}
                            onChange={(e) => pos.setPayment(e.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="h-12 w-full rounded-xl border border-[#E3D8EA] px-4 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none"
                        />
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-[#D8F0DD] bg-[#EEF9F0] px-4 py-3">
                        <span className="text-sm font-semibold text-green-700">
                            Change
                        </span>

                        <span className="text-sm font-semibold text-[#1A1220]">
                            {peso(pos.change)}
                        </span>
                    </div>

                    <button
                        onClick={() => void handlePlaceOrderClick()}
                        disabled={pos.cartItems.length === 0}
                        className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#4D16C9] text-base font-semibold text-white shadow-sm hover:bg-[#381094] disabled:cursor-not-allowed disabled:opacity-40"
                        type="button"
                    >
                        <ShoppingBag size={20} />
                        Place Order
                    </button>
                </div>
            </div>
        </aside>
    );
}

export default function ManagerPOS({ pos }: { pos: UsePOSReturn }) {
    return <BranchPOSView pos={pos} />;
}