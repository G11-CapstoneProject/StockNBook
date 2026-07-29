"use client";

import {
    Building2,
    CalendarDays,
    CircleDollarSign,
    Check,
    ChevronDown,
    ReceiptText,
    RefreshCw,
    Search,
    TrendingUp,
    WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import type { UsePOSReturn } from "@/hooks/usePOS";
import {
    OrdersTable,
    StatCard,
    peso,
    type Branch,
    type Order,
    type Product,
} from "./_shared";

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

function toTransactionDateValue(value: string) {
    const rawValue = String(value || "").trim();
    const isoDateMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);

    if (isoDateMatch) {
        return isoDateMatch[1];
    }

    const parsed = new Date(rawValue);

    if (Number.isNaN(parsed.getTime())) {
        return "";
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function formatTransactionDate(value: string) {
    if (!value) return "";

    const parsed = new Date(`${value}T00:00:00`);

    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function isOrderWithinDateRange(
    orderDate: string,
    startDate: string,
    endDate: string,
) {
    const dateValue = toTransactionDateValue(orderDate);

    if (!dateValue) return false;
    if (startDate && dateValue < startDate) return false;
    if (endDate && dateValue > endDate) return false;

    return true;
}

function formatDateRangeDescription(startDate: string, endDate: string) {
    if (startDate && endDate && startDate === endDate) {
        return `on ${formatTransactionDate(startDate)}`;
    }

    if (startDate && endDate) {
        return `from ${formatTransactionDate(startDate)} to ${formatTransactionDate(endDate)}`;
    }

    if (startDate) {
        return `from ${formatTransactionDate(startDate)} onward`;
    }

    if (endDate) {
        return `up to ${formatTransactionDate(endDate)}`;
    }

    return "";
}

function normalizeOrderItemName(value: string) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s*\/\s*/g, "/")
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, " ");
}

function buildProductCostLookup(products: Product[]) {
    const lookup = new Map<string, number>();

    const addCost = (name: string, cost: number) => {
        const normalizedName = normalizeOrderItemName(name);
        const normalizedCost = Number(cost || 0);

        if (!normalizedName || !Number.isFinite(normalizedCost)) return;
        lookup.set(normalizedName, Math.max(0, normalizedCost));
    };

    products.forEach((product) => {
        const variants = Array.isArray(product.variants)
            ? product.variants
            : [];

        if (variants.length > 0) {
            variants.forEach((variant) => {
                const productName = String(product.name || "").trim();
                const variantName = String(variant.name || "").trim();
                const variantCost = Number(variant.originalPrice || 0);

                addCost(`${productName}/${variantName}`, variantCost);
                addCost(`${productName} / ${variantName}`, variantCost);
                addCost(`${productName}-${variantName}`, variantCost);
                addCost(`${productName} - ${variantName}`, variantCost);
            });

            return;
        }

        addCost(product.name, Number(product.originalPrice || 0));
    });

    return lookup;
}

type OrderWithFinancials = Order & Record<string, unknown>;

function readOrderNumber(order: OrderWithFinancials, keys: string[]) {
    for (const key of keys) {
        const rawValue = order[key];

        if (rawValue === null || rawValue === undefined || rawValue === "") {
            continue;
        }

        const value = Number(rawValue);

        if (Number.isFinite(value)) {
            return value;
        }
    }

    return null;
}

function calculateOrderCost(
    order: Order,
    productCostLookup: Map<string, number>,
    fallbackCostRatio: number,
) {
    const financialOrder = order as OrderWithFinancials;
    const sales = Math.max(0, Number(order.total || 0));

    const explicitCost = readOrderNumber(financialOrder, [
        "totalCost",
        "total_cost",
        "cost",
        "costAmount",
        "cost_amount",
    ]);

    if (explicitCost !== null) {
        return Math.max(0, explicitCost);
    }

    const explicitProfit = readOrderNumber(financialOrder, [
        "profit",
        "grossProfit",
        "gross_profit",
    ]);

    if (explicitProfit !== null) {
        return Math.max(0, sales - explicitProfit);
    }

    const items = Array.isArray(order.items) ? order.items : [];

    if (items.length > 0) {
        let calculatedCost = 0;
        let allItemsMatched = true;

        for (const item of items) {
            const key = normalizeOrderItemName(item.name);

            if (!productCostLookup.has(key)) {
                allItemsMatched = false;
                break;
            }

            calculatedCost +=
                Number(productCostLookup.get(key) || 0) *
                Math.max(0, Number(item.quantity || 0));
        }

        if (allItemsMatched) {
            return calculatedCost;
        }
    }

    return sales * fallbackCostRatio;
}

export default function OwnerPOS({ pos }: { pos: UsePOSReturn }) {
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [isAllBranchesView, setIsAllBranchesView] = useState(true);
    const [branchQuery, setBranchQuery] = useState("All Branches");
    const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
    const [orderIdQuery, setOrderIdQuery] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    const branchSelectorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();

        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const selectedBranch = useMemo(() => {
        if (isAllBranchesView) return null;

        return (
            pos.branches.find(
                (branch) =>
                    String(branch.id) === String(pos.selectedSalesBranchId)
            ) ?? null
        );
    }, [
        isAllBranchesView,
        pos.branches,
        pos.selectedSalesBranchId,
    ]);

    const matchingBranches = useMemo(() => {
        const query = branchQuery.trim().toLowerCase();

        if (!query || query === "all branches") {
            return pos.branches;
        }

        return pos.branches.filter((branch) =>
            branch.branchName.toLowerCase().includes(query)
        );
    }, [branchQuery, pos.branches]);

    const scopeSales = isAllBranchesView
        ? {
            orders: pos.orders,
            sales: pos.totalRevenue,
            profit: pos.totalProfit,
        }
        : selectedBranch
            ? pos.getBranchSales(selectedBranch)
            : {
                orders: [] as Order[],
                sales: 0,
                profit: 0,
            };

    const scopeTotalCost = Math.max(
        0,
        Number(scopeSales.sales || 0) - Number(scopeSales.profit || 0),
    );

    const extendedPOS = pos as UsePOSReturn & {
        products?: Product[];
        displayProducts?: Product[];
    };

    const productsForCostCalculation = Array.isArray(extendedPOS.products)
        ? extendedPOS.products
        : Array.isArray(extendedPOS.displayProducts)
            ? extendedPOS.displayProducts
            : [];

    const productCostLookup = useMemo(
        () => buildProductCostLookup(productsForCostCalculation),
        [productsForCostCalculation],
    );

    const hasDateFilter = Boolean(startDate || endDate);
    const dateRangeDescription = formatDateRangeDescription(
        startDate,
        endDate,
    );

    const dateFilteredOrders = useMemo(() => {
        if (!hasDateFilter) {
            return scopeSales.orders;
        }

        return scopeSales.orders.filter((order) =>
            isOrderWithinDateRange(order.date, startDate, endDate),
        );
    }, [endDate, hasDateFilter, scopeSales.orders, startDate]);

    const overviewTotals = useMemo(() => {
        if (!hasDateFilter) {
            return {
                sales: Number(scopeSales.sales || 0),
                cost: scopeTotalCost,
                profit: Number(scopeSales.profit || 0),
                transactions: scopeSales.orders.length,
            };
        }

        const scopeSalesValue = Number(scopeSales.sales || 0);
        const fallbackCostRatio =
            scopeSalesValue > 0
                ? Math.max(0, scopeTotalCost / scopeSalesValue)
                : 0;

        return dateFilteredOrders.reduce(
            (totals, order) => {
                const sales = Math.max(0, Number(order.total || 0));
                const cost = calculateOrderCost(
                    order,
                    productCostLookup,
                    fallbackCostRatio,
                );

                totals.sales += sales;
                totals.cost += cost;
                totals.profit += sales - cost;
                totals.transactions += 1;

                return totals;
            },
            {
                sales: 0,
                cost: 0,
                profit: 0,
                transactions: 0,
            },
        );
    }, [
        dateFilteredOrders,
        hasDateFilter,
        productCostLookup,
        scopeSales.orders.length,
        scopeSales.profit,
        scopeSales.sales,
        scopeTotalCost,
    ]);

    const orderBranchNames = useMemo(() => {
        const names = new Map<string, string>();

        pos.orders.forEach((order) => {
            if (order.branchName?.trim()) {
                names.set(order.id, order.branchName.trim());
                return;
            }

            if (order.branchId) {
                const branch = pos.branches.find(
                    (item) => String(item.id) === String(order.branchId)
                );

                if (branch) {
                    names.set(order.id, branch.branchName);
                }
            }
        });

        // Fallback for older orders without stored branch information.
        pos.branches.forEach((branch) => {
            pos.getBranchSales(branch).orders.forEach((order) => {
                if (!names.has(order.id)) {
                    names.set(order.id, branch.branchName);
                }
            });
        });

        return names;
    }, [pos.branches, pos.getBranchSales, pos.orders]);

    const getOrderBranchName = (order: Order) => {
        if (order.branchName?.trim()) {
            return order.branchName.trim();
        }

        if (order.branchId) {
            const branch = pos.branches.find(
                (item) => String(item.id) === String(order.branchId)
            );

            if (branch) {
                return branch.branchName;
            }
        }

        if (!isAllBranchesView && selectedBranch) {
            return selectedBranch.branchName;
        }

        return orderBranchNames.get(order.id) || "—";
    };

    const visibleOrders = useMemo(() => {
        const orderId = orderIdQuery.trim().toLowerCase();

        return dateFilteredOrders.filter((order) => {
            return (
                !orderId ||
                String(order.id || "").toLowerCase().includes(orderId)
            );
        });
    }, [dateFilteredOrders, orderIdQuery]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (
                branchSelectorRef.current &&
                !branchSelectorRef.current.contains(event.target as Node)
            ) {
                setIsBranchMenuOpen(false);
                setBranchQuery(
                    isAllBranchesView
                        ? "All Branches"
                        : selectedBranch?.branchName || ""
                );
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [isAllBranchesView, selectedBranch]);

    const handleSelectAllBranches = () => {
        setIsAllBranchesView(true);
        pos.setSelectedSalesBranchId("");
        setBranchQuery("All Branches");
        setIsBranchMenuOpen(false);
    };

    const handleSelectBranch = (branch: Branch) => {
        setIsAllBranchesView(false);
        pos.setSelectedSalesBranchId(String(branch.id));
        setBranchQuery(branch.branchName);
        setIsBranchMenuOpen(false);
    };

    const handleRefresh = async () => {
        await pos.refreshAll();
        setCurrentDateTime(new Date());
    };

    const tableTitle = isAllBranchesView
        ? "All Branches Orders"
        : `${selectedBranch?.branchName || "Branch"} Orders`;

    const dateRangeSuffix = dateRangeDescription
        ? ` ${dateRangeDescription}`
        : "";

    const tableSubtitle = isAllBranchesView
        ? `${visibleOrders.length} transaction${
            visibleOrders.length !== 1 ? "s" : ""
        } shown across all branches${dateRangeSuffix}.`
        : `${visibleOrders.length} transaction${
            visibleOrders.length !== 1 ? "s" : ""
        } shown for ${selectedBranch?.branchName || "this branch"}${dateRangeSuffix}.`;

    const hasActiveFilters = Boolean(
        orderIdQuery.trim() || startDate || endDate,
    );

    const salesHelper = dateRangeDescription
        ? `Sales ${dateRangeDescription}`
        : "Sales in the selected scope";
    const costHelper = dateRangeDescription
        ? `Cost of items sold ${dateRangeDescription}`
        : "Cost of items sold in this scope";
    const profitHelper = dateRangeDescription
        ? `Profit earned ${dateRangeDescription}`
        : "Profit earned in the selected scope";
    const transactionHelper = dateRangeDescription
        ? `Transactions ${dateRangeDescription}`
        : "Transactions in the selected scope";

    return (
        <div
            className="flex min-h-screen font-sans text-[#1A1220]"
            style={{ backgroundColor: "#FDFAF4" }}
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-x-hidden font-sans">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                POS / Sales
                            </h1>
                        </div>

                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime
                                    ? formatCurrentDateTime(currentDateTime)
                                    : "Loading date..."}
                            </span>

                            <button
                                type="button"
                                onClick={() => void handleRefresh()}
                                aria-label="Refresh POS details"
                                title="Refresh"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                            >
                                <RefreshCw size={16} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <div className="space-y-3 px-6 py-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard
                            label="Total Sales"
                            value={peso(overviewTotals.sales)}
                            helper={salesHelper}
                            icon={<CircleDollarSign size={18} strokeWidth={1.9} />}
                            iconClassName="bg-[#F0E9FF] text-[#5A35A5]"
                        />

                        <StatCard
                            label="Total Cost"
                            value={peso(overviewTotals.cost)}
                            helper={costHelper}
                            icon={<WalletCards size={18} strokeWidth={1.9} />}
                            iconClassName="bg-[#FFF2E5] text-[#D56A1F]"
                            valueClassName="text-[#D56A1F]"
                        />

                        <StatCard
                            label="Profit"
                            value={peso(overviewTotals.profit)}
                            helper={profitHelper}
                            icon={<TrendingUp size={18} strokeWidth={1.9} />}
                            iconClassName="bg-[#EAF8EF] text-[#168A48]"
                            valueClassName="text-[#168A48]"
                        />

                        <StatCard
                            label="Transactions"
                            value={overviewTotals.transactions}
                            helper={transactionHelper}
                            icon={<ReceiptText size={18} strokeWidth={1.9} />}
                            iconClassName="bg-[#EAF1FF] text-[#245EDB]"
                            valueClassName="text-[#245EDB]"
                        />
                    </div>

                    <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_190px_190px_290px]">
                        <div className="relative">
                            <Search
                                size={15}
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                value={orderIdQuery}
                                onChange={(event) =>
                                    setOrderIdQuery(event.target.value)
                                }
                                placeholder="Search order ID..."
                                aria-label="Search order ID"
                                className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white px-4 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>

                        <div className="relative">
                            <CalendarDays
                                size={15}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                                From
                            </span>

                            <input
                                type="date"
                                value={startDate}
                                max={endDate || undefined}
                                onChange={(event) =>
                                    setStartDate(event.target.value)
                                }
                                aria-label="Filter transactions from date"
                                className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-[76px] pr-2 text-xs font-medium text-[#1A1220] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>

                        <div className="relative">
                            <CalendarDays
                                size={15}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                                To
                            </span>

                            <input
                                type="date"
                                value={endDate}
                                min={startDate || undefined}
                                onChange={(event) =>
                                    setEndDate(event.target.value)
                                }
                                aria-label="Filter transactions to date"
                                className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-[58px] pr-2 text-xs font-medium text-[#1A1220] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>

                        <div ref={branchSelectorRef} className="relative">
                            <Building2
                                size={15}
                                className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                value={branchQuery}
                                onFocus={() => {
                                    setIsBranchMenuOpen(true);

                                    if (
                                        branchQuery === "All Branches" ||
                                        branchQuery === selectedBranch?.branchName
                                    ) {
                                        setBranchQuery("");
                                    }
                                }}
                                onChange={(event) => {
                                    setBranchQuery(event.target.value);
                                    setIsBranchMenuOpen(true);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        setIsBranchMenuOpen(false);
                                        event.currentTarget.blur();
                                    }
                                }}
                                placeholder="Search or select branch..."
                                aria-label="Search or select sales branch"
                                role="combobox"
                                aria-expanded={isBranchMenuOpen}
                                aria-controls="owner-pos-branch-options"
                                aria-autocomplete="list"
                                className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white px-10 pr-10 text-sm font-semibold text-[#1A1220] outline-none shadow-sm placeholder:font-normal placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />

                            <button
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    setIsBranchMenuOpen((isOpen) => !isOpen);
                                    setBranchQuery("");
                                }}
                                aria-label="Show sales branch choices"
                                className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-[#2B174C]"
                            >
                                <ChevronDown
                                    size={14}
                                    className={`transition ${
                                        isBranchMenuOpen ? "rotate-180" : ""
                                    }`}
                                />
                            </button>

                            {isBranchMenuOpen && (
                                <div
                                    id="owner-pos-branch-options"
                                    role="listbox"
                                    className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[#D8CBE7] bg-white py-1 shadow-lg"
                                >
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={isAllBranchesView}
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={handleSelectAllBranches}
                                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ${
                                            isAllBranchesView
                                                ? "bg-[#F1E9FF] font-semibold text-[#2B174C]"
                                                : "text-[#1A1220] hover:bg-[#F7F1FF]"
                                        }`}
                                    >
                                        <span>All Branches</span>

                                        {isAllBranchesView && (
                                            <Check
                                                size={15}
                                                className="shrink-0"
                                            />
                                        )}
                                    </button>

                                    {matchingBranches.length === 0 ? (
                                        <p className="px-4 py-3 text-sm text-[#7A6A84]">
                                            No matching branch found.
                                        </p>
                                    ) : (
                                        matchingBranches.map((branch) => {
                                            const isSelected =
                                                !isAllBranchesView &&
                                                String(branch.id) ===
                                                String(
                                                    pos.selectedSalesBranchId
                                                );

                                            return (
                                                <button
                                                    key={branch.id}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    onMouseDown={(event) =>
                                                        event.preventDefault()
                                                    }
                                                    onClick={() =>
                                                        handleSelectBranch(
                                                            branch
                                                        )
                                                    }
                                                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ${
                                                        isSelected
                                                            ? "bg-[#F1E9FF] font-semibold text-[#2B174C]"
                                                            : "text-[#1A1220] hover:bg-[#F7F1FF]"
                                                    }`}
                                                >
                                                    <span className="truncate">
                                                        {branch.branchName}
                                                    </span>

                                                    {isSelected && (
                                                        <Check
                                                            size={15}
                                                            className="shrink-0"
                                                        />
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    </section>

                    {hasActiveFilters && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-2.5">
                            <p className="text-xs text-[#7A6A84]">
                                Showing filtered transactions
                                {dateRangeDescription
                                    ? ` ${dateRangeDescription}`
                                    : ""}
                                {orderIdQuery.trim()
                                    ? ` matching “${orderIdQuery.trim()}”`
                                    : ""}
                                .
                            </p>

                            <button
                                type="button"
                                onClick={() => {
                                    setOrderIdQuery("");
                                    setStartDate("");
                                    setEndDate("");
                                }}
                                className="text-xs font-semibold text-[#2B174C] transition hover:text-[#5B2FC6]"
                            >
                                Clear filters
                            </button>
                        </div>
                    )}

                    <OrdersTable
                        title={tableTitle}
                        subtitle={tableSubtitle}
                        orders={visibleOrders}
                        showBranch
                        getBranchName={getOrderBranchName}
                        emptyText={
                            hasActiveFilters
                                ? "No transactions match the current order ID or date range."
                                : isAllBranchesView
                                    ? "No orders found across all branches."
                                    : "No orders found for this branch."
                        }
                    />
                </div>
            </main>
        </div>
    );
}