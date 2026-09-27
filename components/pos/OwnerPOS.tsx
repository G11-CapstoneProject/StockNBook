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

function getLocalDateInputValue(value = new Date()) {
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

function normalizeBranchName(value: string | null | undefined) {
    return String(value || "")
        .trim()
        .toLowerCase()
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

function buildProductProfitLookup(products: Product[]) {
    const lookup = new Map<string, number>();

    const addProfit = (
        name: string,
        salesPrice: number,
        originalPrice: number,
    ) => {
        const normalizedName = normalizeOrderItemName(name);
        const profit =
            Number(salesPrice || 0) -
            Number(originalPrice || 0);

        if (!normalizedName || !Number.isFinite(profit)) return;

        lookup.set(normalizedName, profit);
    };

    products.forEach((product) => {
        const variants = Array.isArray(product.variants)
            ? product.variants
            : [];

        if (variants.length > 0) {
            variants.forEach((variant) => {
                const productName = String(product.name || "").trim();
                const variantName = String(variant.name || "").trim();

                addProfit(
                    `${productName}/${variantName}`,
                    Number(variant.salesPrice || 0),
                    Number(variant.originalPrice || 0),
                );

                addProfit(
                    `${productName} / ${variantName}`,
                    Number(variant.salesPrice || 0),
                    Number(variant.originalPrice || 0),
                );

                addProfit(
                    `${productName}-${variantName}`,
                    Number(variant.salesPrice || 0),
                    Number(variant.originalPrice || 0),
                );

                addProfit(
                    `${productName} - ${variantName}`,
                    Number(variant.salesPrice || 0),
                    Number(variant.originalPrice || 0),
                );
            });

            return;
        }

        addProfit(
            product.name,
            Number(product.salesPrice || 0),
            Number(product.originalPrice || 0),
        );
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

function OwnerAuditTable({
                             title,
                             subtitle,
                             orders,
                             getBranchName,
                             emptyText,
                         }: {
    title: string;
    subtitle: string;
    orders: Order[];
    getBranchName: (order: Order) => string;
    emptyText: string;
}) {
    return (
        <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="border-b border-[#E6DDF0] px-4 py-3">
                <h3 className="text-[16px] font-bold text-[#1A1220]">{title}</h3>
                <p className="mt-0.5 text-xs text-[#7A6A84]">{subtitle}</p>
            </div>

            <div className="max-h-[520px] overflow-y-auto overflow-x-hidden">
                <div className="sticky top-0 z-10 grid grid-cols-[1.25fr_1.2fr_0.95fr_1fr_1.25fr_1fr] gap-2 border-b border-[#E6DDF0] bg-white px-4 py-3 text-[10px] font-semibold text-[#806A8C]">
                    <div>Control / Order</div>
                    <div>Customer / Branch</div>
                    <div>Payment / Tax</div>
                    <div>Processed By</div>
                    <div>Financials</div>
                    <div>Status / Date</div>
                </div>

                {orders.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-[#9B8AAA]">
                        {emptyText}
                    </div>
                ) : (
                    orders.map((order) => {
                        const transactionStatus = String(order.status || "COMPLETED").toUpperCase();
                        const collectionStatus = String(order.collectionStatus || "").toUpperCase();
                        const processedBy =
                            order.cashierName ||
                            [order.cashierRole, order.cashierId ? `#${order.cashierId}` : ""]
                                .filter(Boolean)
                                .join(" ") ||
                            "—";

                        return (
                            <div
                                key={order.id}
                                className="grid grid-cols-[1.25fr_1.2fr_0.95fr_1fr_1.25fr_1fr] gap-2 border-b border-[#EFE7F4] px-4 py-3 text-[11px] last:border-0 hover:bg-[#FFFCF7]"
                            >
                                <div className="min-w-0">
                                    <p className="break-all font-bold text-[#2B174C]">
                                        {order.controlNumber || "No control no."}
                                    </p>
                                    <p className="mt-1 truncate text-[10px] text-[#806A8C]">{order.id}</p>
                                </div>

                                <div className="min-w-0">
                                    <p className="truncate font-semibold text-[#1A1220]">{order.customer || "—"}</p>
                                    <p className="mt-1 truncate text-[10px] text-[#806A8C]">{getBranchName(order)}</p>
                                    {order.customerContactNumber && (
                                        <p className="mt-1 truncate text-[10px] text-[#806A8C]">{order.customerContactNumber}</p>
                                    )}
                                </div>

                                <div className="min-w-0">
                                    <p className="font-semibold text-[#1A1220]">
                                        {String(order.paymentMode || "").toUpperCase() === "CREDIT" ? "Credit" : "Cash"}
                                    </p>
                                    <p className="mt-1 text-[10px] text-[#806A8C]">
                                        {String(order.taxType || "").toUpperCase() === "VAT" ? "VAT 12%" : "Non-VAT"}
                                    </p>
                                </div>

                                <div className="min-w-0">
                                    <p className="truncate font-semibold text-[#1A1220]">{processedBy}</p>
                                    <p className="mt-1 text-[10px] text-[#806A8C]">{order.cashierRole || "—"}</p>
                                </div>

                                <div className="min-w-0 space-y-0.5">
                                    <p className="flex justify-between gap-2"><span className="text-[#806A8C]">Sales</span><strong>{peso(Number(order.total || 0))}</strong></p>
                                    <p className="flex justify-between gap-2"><span className="text-[#806A8C]">Cost</span><strong>{peso(Number(order.cost || 0))}</strong></p>
                                    <p className="flex justify-between gap-2"><span className="text-[#806A8C]">Gross</span><strong className="text-[#168A48]">{peso(Number(order.profit || 0))}</strong></p>
                                </div>

                                <div className="min-w-0">
                                    <span
                                        className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ${
                                            transactionStatus === "VOIDED"
                                                ? "bg-red-50 text-red-600"
                                                : transactionStatus === "MODIFIED"
                                                    ? "bg-amber-50 text-amber-700"
                                                    : "bg-emerald-50 text-emerald-700"
                                        }`}
                                    >
                                        {transactionStatus}
                                    </span>
                                    {collectionStatus && String(order.paymentMode || "").toUpperCase() === "CREDIT" && (
                                        <p className={`mt-1 text-[9px] font-bold ${collectionStatus === "OVERDUE" ? "text-red-600" : "text-[#5B2FC6]"}`}>
                                            {collectionStatus}
                                        </p>
                                    )}
                                    <p className="mt-1 text-[10px] text-[#806A8C]">{order.date}</p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
}

export default function OwnerPOS({ pos }: { pos: UsePOSReturn }) {
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [isAllBranchesView, setIsAllBranchesView] = useState(true);
    const [branchQuery, setBranchQuery] = useState("All Branches");
    const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
    const [orderIdQuery, setOrderIdQuery] = useState("");
    const [taxSaving, setTaxSaving] = useState(false);
    const [startDate, setStartDate] = useState(() =>
        pos.ownerOrderStartDate || getLocalDateInputValue()
    );
    const [endDate, setEndDate] = useState(() =>
        pos.ownerOrderEndDate || getLocalDateInputValue()
    );

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

    /*
     * Owner branch filtering is done here instead of relying only on
     * pos.getBranchSales(). Some older/cached orders can contain the correct
     * branchName but an absent or mismatched branchId. Manager/Staff do not
     * notice that because their API response is already scoped to their branch.
     *
     * For Owner:
     * 1. Match the branch by ID when possible.
     * 2. Fall back to the normalized branch name.
     */
    const selectedBranchOrders = useMemo(() => {
        if (isAllBranchesView) {
            return pos.orders;
        }

        if (!selectedBranch) {
            return [] as Order[];
        }

        const selectedId = String(selectedBranch.id || "").trim();
        const selectedName = normalizeBranchName(selectedBranch.branchName);

        return pos.orders.filter((order) => {
            const orderBranchId = String(order.branchId || "").trim();
            const orderBranchName = normalizeBranchName(order.branchName);

            if (
                orderBranchId &&
                selectedId &&
                orderBranchId === selectedId
            ) {
                return true;
            }

            if (
                orderBranchName &&
                selectedName &&
                orderBranchName === selectedName
            ) {
                return true;
            }

            return false;
        });
    }, [
        isAllBranchesView,
        pos.orders,
        selectedBranch,
    ]);

    const selectedBranchSales = useMemo(
        () =>
            selectedBranchOrders.reduce(
                (sum, order) =>
                    sum + Number(order.total || 0),
                0,
            ),
        [selectedBranchOrders],
    );

    const scopeSales = isAllBranchesView
        ? {
            orders: pos.orders,
            sales: pos.totalRevenue,
            profit: pos.totalProfit,
        }
        : {
            orders: selectedBranchOrders,
            sales: selectedBranchSales,
            profit: 0,
        };

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

    /*
     * Use the same product scope as the selected branch when calculating
     * branch profit. This mirrors the Manager/Staff POS calculation, which
     * only uses products belonging to the assigned branch.
     */
    const productsForProfitCalculation = useMemo(() => {
        if (isAllBranchesView || !selectedBranch) {
            return productsForCostCalculation;
        }

        return productsForCostCalculation.filter(
            (product) =>
                String(product.branchId || "") ===
                String(selectedBranch.id),
        );
    }, [
        isAllBranchesView,
        productsForCostCalculation,
        selectedBranch,
    ]);

    const productProfitLookup = useMemo(
        () => buildProductProfitLookup(productsForProfitCalculation),
        [productsForProfitCalculation],
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
        const ordersToCalculate = hasDateFilter
            ? dateFilteredOrders
            : scopeSales.orders;

        return ordersToCalculate.reduce(
            (totals, order) => {
                const sales = Number(order.total || 0);
                const backendCost = Number(order.cost);
                const backendProfit = Number(order.profit);

                /*
                 * Prefer the exact per-order metrics returned by the POS
                 * backend. They are calculated from order_items using the
                 * order's product_id / variant_id, so branch changes now
                 * produce the correct branch-specific cost and profit.
                 *
                 * Keep the old lookup only as a compatibility fallback for
                 * any older cached order that does not yet contain metrics.
                 */
                let orderProfit = backendProfit;
                let orderCost = backendCost;

                if (!Number.isFinite(orderProfit)) {
                    orderProfit = (
                        Array.isArray(order.items) ? order.items : []
                    ).reduce((itemProfit, item) => {
                        const key = normalizeOrderItemName(item.name);
                        const unitProfit = productProfitLookup.get(key);

                        if (unitProfit === undefined) {
                            return itemProfit;
                        }

                        return (
                            itemProfit +
                            Number(unitProfit || 0) *
                            Number(item.quantity || 0)
                        );
                    }, 0);
                }

                if (!Number.isFinite(orderCost)) {
                    orderCost = sales - orderProfit;
                }

                totals.sales += sales;
                totals.cost += orderCost;
                totals.profit += orderProfit;
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
        productProfitLookup,
        scopeSales.orders,
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

        // Fallback for older orders without reliable branch IDs.
        pos.branches.forEach((branch) => {
            const branchId = String(branch.id || "").trim();
            const branchName = normalizeBranchName(branch.branchName);

            pos.orders.forEach((order) => {
                if (names.has(order.id)) {
                    return;
                }

                const orderBranchId =
                    String(order.branchId || "").trim();

                const orderBranchName =
                    normalizeBranchName(order.branchName);

                const matchesId =
                    Boolean(orderBranchId) &&
                    Boolean(branchId) &&
                    orderBranchId === branchId;

                const matchesName =
                    Boolean(orderBranchName) &&
                    Boolean(branchName) &&
                    orderBranchName === branchName;

                if (matchesId || matchesName) {
                    names.set(
                        order.id,
                        branch.branchName,
                    );
                }
            });
        });

        return names;
    }, [pos.branches, pos.orders]);

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
            if (!orderId) return true;

            return [
                order.id,
                order.controlNumber,
                order.customer,
            ].some((value) =>
                String(value || "").toLowerCase().includes(orderId)
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

    const handleStartDateChange = (value: string) => {
        setStartDate(value);
        pos.setOwnerOrderDateRange(value, endDate);
    };

    const handleEndDateChange = (value: string) => {
        setEndDate(value);
        pos.setOwnerOrderDateRange(startDate, value);
    };

    const handleSelectAllBranches = () => {
        setIsAllBranchesView(true);
        pos.setSelectedSalesBranchId("");
        setBranchQuery("All Branches");
        setIsBranchMenuOpen(false);
    };

    const handleSelectBranch = (branch: Branch) => {
        const today = getLocalDateInputValue();

        setIsAllBranchesView(false);
        pos.setSelectedSalesBranchId(String(branch.id));
        setBranchQuery(branch.branchName);
        setIsBranchMenuOpen(false);

        /*
         * Manager/Staff POS cards are "today" totals.
         * Default the Owner's selected-branch view to today as well so the
         * same store + same branch shows the same daily information.
         * The Owner can still manually change the From/To dates afterward.
         */
        setStartDate(today);
        setEndDate(today);
        pos.setOwnerOrderDateRange(today, today);
    };

    const handleRefresh = async () => {
        await pos.refreshAll();
        setCurrentDateTime(new Date());
    };

    const handleTaxRegistrationChange = async (value: string) => {
        const registration = value === "NON_VAT" ? "NON_VAT" : "VAT_REGISTERED";
        setTaxSaving(true);
        await pos.updateTaxRegistration(registration);
        setTaxSaving(false);
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
        ? `Cost of Sales ${dateRangeDescription}`
        : "Cost of Sales in the selected scope";
    const profitHelper = dateRangeDescription
        ? `Gross Profit ${dateRangeDescription}`
        : "Gross Profit (Sales − Cost of Sales) in the selected scope";
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
                                Sales History & Audit
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
                            label="Cost of Sales"
                            value={peso(overviewTotals.cost)}
                            helper={costHelper}
                            icon={<WalletCards size={18} strokeWidth={1.9} />}
                            iconClassName="bg-[#FFF2E5] text-[#D56A1F]"
                            valueClassName="text-[#D56A1F]"
                        />

                        <StatCard
                            label="Gross Profit"
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

                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-sm">
                        <div>
                            <p className="text-sm font-bold text-[#1A1220]">Business Tax Registration</p>
                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                Owner-controlled. Manager and Staff POS only read this setting.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <select
                                value={pos.taxType === "NON_VAT" ? "NON_VAT" : "VAT_REGISTERED"}
                                onChange={(event) => void handleTaxRegistrationChange(event.target.value)}
                                disabled={taxSaving}
                                className="h-[42px] min-w-[210px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C] disabled:opacity-50"
                            >
                                <option value="VAT_REGISTERED">VAT Registered (12%)</option>
                                <option value="NON_VAT">Non-VAT Registered</option>
                            </select>
                            {taxSaving && (
                                <span className="text-xs font-medium text-[#806A8C]">Saving...</span>
                            )}
                        </div>
                    </section>

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
                                placeholder="Search order, control no., or customer..."
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
                                    handleStartDateChange(event.target.value)
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
                                    handleEndDateChange(event.target.value)
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
                                    const today = getLocalDateInputValue();

                                    setOrderIdQuery("");
                                    setStartDate(today);
                                    setEndDate(today);
                                    pos.setOwnerOrderDateRange(today, today);
                                }}
                                className="text-xs font-semibold text-[#2B174C] transition hover:text-[#5B2FC6]"
                            >
                                Clear filters
                            </button>
                        </div>
                    )}

                    <OwnerAuditTable
                        title={tableTitle}
                        subtitle={tableSubtitle}
                        orders={visibleOrders}
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