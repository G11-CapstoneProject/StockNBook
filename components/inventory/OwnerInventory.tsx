"use client";

import * as React from "react";
import {
    AlertTriangle,
    Building2,
    Check,
    ChevronDown,
    DollarSign,
    Download,
    RefreshCw,
    Search,
    TrendingDown,
    TrendingUp,
    Wallet,
} from "lucide-react";
import { useInventoryController } from "@/hooks/useInventory";
import { EmptyInventory, type Branch, type Product } from "./_shared";

const OWNER_EXPIRING_SOON_DAYS = 30;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

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

function formatNumber(value: number) {
    return value.toLocaleString("en-PH", {
        maximumFractionDigits: 0,
    });
}

function formatPeso(value: number) {
    return value.toLocaleString("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatCompactPeso(value: number) {
    return value.toLocaleString("en-PH", {
        style: "currency",
        currency: "PHP",
        notation: "compact",
        maximumFractionDigits: 1,
    });
}

function parseOwnerExpirationDate(value?: string | null) {
    const rawValue = String(value || "").trim();

    if (!rawValue) return null;

    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? new Date(`${rawValue}T00:00:00`)
        : new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) return null;

    parsedDate.setHours(0, 0, 0, 0);
    return parsedDate;
}

function getOwnerDaysUntilExpiration(value?: string | null) {
    const expirationDate = parseOwnerExpirationDate(value);

    if (!expirationDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.round(
        (expirationDate.getTime() - today.getTime()) / DAY_IN_MILLISECONDS
    );
}

type OwnerStockLine = {
    stock: number;
    alertLevel: number;
    costPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
};

function getProductStockLines(product: Product): OwnerStockLine[] {
    const variants = Array.isArray(product.variants) ? product.variants : [];

    if (product.hasVariants && variants.length > 0) {
        return variants.map((variant) => ({
            stock: Number(variant.stock || 0),
            alertLevel: Number(variant.alertLevel || 0),
            costPrice: Number(variant.originalPrice || 0),
            salesPrice: Number(variant.salesPrice || 0),
            expirationDate: variant.expirationDate,
        }));
    }

    return [
        {
            stock: Number(product.stock || 0),
            alertLevel: Number(product.alertLevel || 0),
            costPrice: Number(product.originalPrice || 0),
            salesPrice: Number(product.salesPrice || 0),
            expirationDate: product.expirationDate,
        },
    ];
}

type OwnerProductStatus =
    | "In Stock"
    | "Low Stock"
    | "Out of Stock"
    | "Expiring"
    | "Expired";

function getStockLineStatus(line: OwnerStockLine): OwnerProductStatus {
    const daysRemaining = getOwnerDaysUntilExpiration(line.expirationDate);

    if (daysRemaining !== null && daysRemaining < 0) {
        return "Expired";
    }

    if (
        daysRemaining !== null &&
        daysRemaining >= 0 &&
        daysRemaining <= OWNER_EXPIRING_SOON_DAYS
    ) {
        return "Expiring";
    }

    if (line.stock <= 0) {
        return "Out of Stock";
    }

    if (line.stock <= line.alertLevel) {
        return "Low Stock";
    }

    return "In Stock";
}

function getProductStatus(product: Product): OwnerProductStatus {
    const lines = getProductStockLines(product);
    const statuses = lines.map(getStockLineStatus);

    if (statuses.includes("Expired")) return "Expired";
    if (statuses.includes("Expiring")) return "Expiring";
    if (statuses.every((status) => status === "Out of Stock")) {
        return "Out of Stock";
    }
    if (statuses.includes("Low Stock") || statuses.includes("Out of Stock")) {
        return "Low Stock";
    }

    return "In Stock";
}

function getOwnerProductFinancials(product: Product) {
    return getProductStockLines(product).reduce(
        (totals, line) => {
            const availableStock = Math.max(0, line.stock);
            const inventoryValue = availableStock * line.costPrice;
            const retailValue = availableStock * line.salesPrice;

            totals.stock += availableStock;
            totals.inventoryValue += inventoryValue;
            totals.retailValue += retailValue;
            totals.potentialProfit += retailValue - inventoryValue;

            return totals;
        },
        {
            stock: 0,
            inventoryValue: 0,
            retailValue: 0,
            potentialProfit: 0,
        }
    );
}

function getOwnerInventoryOverview(products: Product[]) {
    return products.reduce(
        (totals, product) => {
            getProductStockLines(product).forEach((line) => {
                const availableStock = Math.max(0, line.stock);
                const costValue = availableStock * line.costPrice;
                const retailValue = availableStock * line.salesPrice;
                const status = getStockLineStatus(line);

                totals.inventoryCostValue += costValue;
                totals.retailValue += retailValue;

                if (status !== "In Stock") {
                    totals.atRiskInventoryValue += costValue;
                }
            });

            totals.potentialGrossProfit =
                totals.retailValue - totals.inventoryCostValue;

            return totals;
        },
        {
            inventoryCostValue: 0,
            retailValue: 0,
            potentialGrossProfit: 0,
            atRiskInventoryValue: 0,
        }
    );
}

type BranchValueRow = {
    branchName: string;
    costValue: number;
    retailValue: number;
    potentialProfit: number;
};

function getInventoryValueByBranch(products: Product[]): BranchValueRow[] {
    const branchMap = new Map<string, BranchValueRow>();

    products.forEach((product) => {
        const branchName = product.branchName || "Unassigned Branch";
        const financials = getOwnerProductFinancials(product);
        const current = branchMap.get(branchName) || {
            branchName,
            costValue: 0,
            retailValue: 0,
            potentialProfit: 0,
        };

        current.costValue += financials.inventoryValue;
        current.retailValue += financials.retailValue;
        current.potentialProfit += financials.potentialProfit;

        branchMap.set(branchName, current);
    });

    return Array.from(branchMap.values()).sort(
        (first, second) => second.costValue - first.costValue
    );
}

type OwnerPosOrderItem = {
    productId?: number | string | null;
    product_id?: number | string | null;
    productName?: string | null;
    product_name?: string | null;
    name?: string | null;
    quantity?: number | string | null;
    qty?: number | string | null;
};

type OwnerPosOrder = {
    orderId?: string | null;
    order_id?: string | null;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    branchName?: string | null;
    branch_name?: string | null;
    date?: string | null;
    orderDate?: string | null;
    order_date?: string | null;
    createdAt?: string | null;
    created_at?: string | null;
    item?: string | null;
    orderItems?: OwnerPosOrderItem[];
    order_items?: OwnerPosOrderItem[];
};

type OwnerPosOrdersResponse = {
    success?: boolean;
    orders?: OwnerPosOrder[];
    error?: string;
};

type OwnerSalesState = {
    loading: boolean;
    ready: boolean;
    orders: OwnerPosOrder[];
    error: string | null;
};

function getNumericSalesValue(value: unknown) {
    if (value === null || value === undefined || value === "") return null;

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeSalesProductName(value: unknown) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getOrderItemProductId(item: OwnerPosOrderItem) {
    const rawId = item.productId ?? item.product_id;
    const numericId = Number(rawId);

    return Number.isFinite(numericId) && numericId > 0
        ? String(numericId)
        : "";
}

function getOrderItemQuantity(item: OwnerPosOrderItem) {
    const quantity = getNumericSalesValue(item.quantity ?? item.qty);
    return quantity !== null && quantity > 0 ? quantity : 0;
}

function getOrderItemName(item: OwnerPosOrderItem) {
    return normalizeSalesProductName(
        item.productName ?? item.product_name ?? item.name ?? ""
    );
}

/*
 * Current POS responses already return structured orderItems containing
 * productId and quantity. This legacy parser is only a fallback for older
 * saved orders that may contain the comma-separated `item` text instead.
 */
function parseLegacyOrderItems(value?: string | null): OwnerPosOrderItem[] {
    return String(value || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const match = part.match(/^(.*?)(?:\s+x|\s*×\s*)(\d+)\s*$/i);

            if (!match) {
                return {
                    name: part,
                    quantity: 0,
                };
            }

            return {
                name: match[1].trim(),
                quantity: Number(match[2] || 0),
            };
        });
}

type OwnerProductSalesMetric = {
    unitsLast30Days: number;
    allTimeUnits: number;
    lastSoldAt: Date | null;
};

type OwnerSalesAnalytics = {
    byProductId: Map<string, OwnerProductSalesMetric>;
    byProductName: Map<string, OwnerProductSalesMetric>;
    hasDatedOrders: boolean;
};

const OWNER_SALES_PERIOD_DAYS = 30;

function parseOwnerOrderDate(order: OwnerPosOrder) {
    const rawValue = String(
        order.orderDate ??
        order.order_date ??
        order.createdAt ??
        order.created_at ??
        order.date ??
        ""
    ).trim();

    if (!rawValue) return null;

    const parsedDate = new Date(rawValue);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function createEmptySalesMetric(): OwnerProductSalesMetric {
    return {
        unitsLast30Days: 0,
        allTimeUnits: 0,
        lastSoldAt: null,
    };
}

function addSalesMetric(
    map: Map<string, OwnerProductSalesMetric>,
    key: string,
    quantity: number,
    orderDate: Date | null,
    includeInLast30Days: boolean
) {
    if (!key) return;

    const current = map.get(key) || createEmptySalesMetric();

    current.allTimeUnits += quantity;

    if (includeInLast30Days) {
        current.unitsLast30Days += quantity;
    }

    if (
        orderDate &&
        (!current.lastSoldAt || orderDate.getTime() > current.lastSoldAt.getTime())
    ) {
        current.lastSoldAt = orderDate;
    }

    map.set(key, current);
}

function getOwnerSalesAnalytics(orders: OwnerPosOrder[]): OwnerSalesAnalytics {
    const byProductId = new Map<string, OwnerProductSalesMetric>();
    const byProductName = new Map<string, OwnerProductSalesMetric>();
    const parsedOrderDates = orders.map(parseOwnerOrderDate);
    const hasDatedOrders = parsedOrderDates.some(Boolean);

    const today = new Date();
    const periodStart = new Date(today);
    periodStart.setHours(0, 0, 0, 0);
    periodStart.setDate(periodStart.getDate() - (OWNER_SALES_PERIOD_DAYS - 1));

    orders.forEach((order, orderIndex) => {
        const orderDate = parsedOrderDates[orderIndex];
        const includeInLast30Days = hasDatedOrders
            ? Boolean(orderDate && orderDate.getTime() >= periodStart.getTime())
            : true;

        const structuredItems = Array.isArray(order.orderItems)
            ? order.orderItems
            : Array.isArray(order.order_items)
                ? order.order_items
                : [];

        const items =
            structuredItems.length > 0
                ? structuredItems
                : parseLegacyOrderItems(order.item);

        items.forEach((item) => {
            const quantity = getOrderItemQuantity(item);

            if (quantity <= 0) return;

            const productId = getOrderItemProductId(item);
            const productName = getOrderItemName(item);

            addSalesMetric(
                byProductId,
                productId,
                quantity,
                orderDate,
                includeInLast30Days
            );
            addSalesMetric(
                byProductName,
                productName,
                quantity,
                orderDate,
                includeInLast30Days
            );
        });
    });

    return {
        byProductId,
        byProductName,
        hasDatedOrders,
    };
}

function getSalesMetricForProduct(
    product: Product,
    analytics: OwnerSalesAnalytics
): OwnerProductSalesMetric {
    const productId = String(product.id ?? "").trim();
    const productNameKey = normalizeSalesProductName(product.name);

    return (
        (productId ? analytics.byProductId.get(productId) : undefined) ??
        analytics.byProductName.get(productNameKey) ??
        createEmptySalesMetric()
    );
}

type MovementProductRow = {
    id: string;
    productName: string;
    totalSold: number;
    currentStock: number;
    stockValue: number;
    lastSoldAt: Date | null;
    status: OwnerProductStatus;
};

function getMovementProducts(
    products: Product[],
    salesAnalytics: OwnerSalesAnalytics,
    salesReady: boolean
) {
    const rows = products.map((product) => {
        const productId = String(product.id ?? "").trim();
        const productNameKey = normalizeSalesProductName(product.name);
        const salesMetric = getSalesMetricForProduct(product, salesAnalytics);
        const financials = getOwnerProductFinancials(product);

        return {
            id: productId || productNameKey,
            productName: product.name,
            totalSold: salesMetric.unitsLast30Days,
            currentStock: financials.stock,
            stockValue: financials.inventoryValue,
            lastSoldAt: salesMetric.lastSoldAt,
            status: getProductStatus(product),
        } satisfies MovementProductRow;
    });

    const fastMoving = [...rows]
        .filter((row) => row.totalSold > 0)
        .sort((first, second) => {
            if (second.totalSold !== first.totalSold) {
                return second.totalSold - first.totalSold;
            }

            return first.productName.localeCompare(second.productName);
        })
        .slice(0, 5);

    const slowMoving = [...rows]
        .filter((row) => row.currentStock > 0)
        .sort((first, second) => {
            if (first.totalSold !== second.totalSold) {
                return first.totalSold - second.totalSold;
            }

            const firstLastSold = first.lastSoldAt?.getTime() ?? 0;
            const secondLastSold = second.lastSoldAt?.getTime() ?? 0;

            if (firstLastSold !== secondLastSold) {
                return firstLastSold - secondLastSold;
            }

            return second.stockValue - first.stockValue;
        })
        .slice(0, 5);

    return {
        hasSalesData: salesReady && rows.some((row) => row.totalSold > 0),
        fastMoving,
        slowMoving,
    };
}

type AtRiskCategoryKey =
    | "slowMoving"
    | "expiringSoon"
    | "expired"
    | "lowStockHighDemand";

type AtRiskBreakdownRow = {
    key: AtRiskCategoryKey;
    label: string;
    value: number;
    percentage: number;
    color: string;
};

type AtRiskBreakdown = {
    total: number;
    rows: AtRiskBreakdownRow[];
    gradient: string;
};

function getOwnerAtRiskBreakdown(
    products: Product[],
    salesAnalytics: OwnerSalesAnalytics,
    salesReady: boolean
): AtRiskBreakdown {
    const values: Record<AtRiskCategoryKey, number> = {
        slowMoving: 0,
        expiringSoon: 0,
        expired: 0,
        lowStockHighDemand: 0,
    };

    products.forEach((product) => {
        const financials = getOwnerProductFinancials(product);

        if (financials.inventoryValue <= 0) return;

        const status = getProductStatus(product);
        const salesMetric = getSalesMetricForProduct(product, salesAnalytics);

        // Categories are intentionally mutually exclusive so the At-Risk total
        // always equals the sum shown in the breakdown.
        if (status === "Expired") {
            values.expired += financials.inventoryValue;
            return;
        }

        if (status === "Expiring") {
            values.expiringSoon += financials.inventoryValue;
            return;
        }

        if (
            (status === "Low Stock" || status === "Out of Stock") &&
            salesMetric.unitsLast30Days > 0
        ) {
            values.lowStockHighDemand += financials.inventoryValue;
            return;
        }

        if (salesReady && salesMetric.unitsLast30Days === 0) {
            values.slowMoving += financials.inventoryValue;
        }
    });

    const total = Object.values(values).reduce((sum, value) => sum + value, 0);

    const definitions: Array<{
        key: AtRiskCategoryKey;
        label: string;
        color: string;
    }> = [
        {
            key: "slowMoving",
            label: "Slow-Moving / Dead Stock",
            color: "#E93B4F",
        },
        {
            key: "expiringSoon",
            label: "Expiring Soon",
            color: "#F5A12D",
        },
        {
            key: "expired",
            label: "Expired",
            color: "#7255D9",
        },
        {
            key: "lowStockHighDemand",
            label: "Low Stock (High-Demand)",
            color: "#F6C443",
        },
    ];

    const rows = definitions.map((definition) => ({
        ...definition,
        value: values[definition.key],
        percentage: total > 0 ? (values[definition.key] / total) * 100 : 0,
    }));

    let currentAngle = 0;
    const gradientStops = rows
        .filter((row) => row.value > 0)
        .map((row) => {
            const startAngle = currentAngle;
            currentAngle += row.percentage * 3.6;
            return `${row.color} ${startAngle}deg ${currentAngle}deg`;
        });

    return {
        total,
        rows,
        gradient:
            gradientStops.length > 0
                ? `conic-gradient(${gradientStops.join(", ")})`
                : "conic-gradient(#EEE7F2 0deg 360deg)",
    };
}

function formatOwnerLastSold(value: Date | null) {
    if (!value) return "No recorded sale";

    return value.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function escapeCsv(value: string | number) {
    const stringValue = String(value ?? "");
    return `"${stringValue.replace(/"/g, '""')}"`;
}

function exportOwnerInventoryCsv(products: Product[]) {
    const rows = products.map((product) => {
        const financials = getOwnerProductFinancials(product);

        return [
            product.name,
            product.branchName || "—",
            financials.stock,
            financials.inventoryValue.toFixed(2),
            financials.retailValue.toFixed(2),
            financials.potentialProfit.toFixed(2),
            getProductStatus(product),
        ];
    });

    const csv = [
        [
            "Product",
            "Branch",
            "Stock",
            "Inventory Value",
            "Retail Value",
            "Potential Profit",
            "Status",
        ],
        ...rows,
    ]
        .map((row) => row.map(escapeCsv).join(","))
        .join("\n");

    const blob = new Blob([`\uFEFF${csv}`], {
        type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateLabel = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `owner-inventory-${dateLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export default function OwnerInventory() {
    const [refreshKey, setRefreshKey] = React.useState(0);
    const [currentDateTime, setCurrentDateTime] =
        React.useState<Date | null>(null);

    React.useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const refreshInventoryDetails = React.useCallback(() => {
        setRefreshKey((currentKey) => currentKey + 1);
    }, []);

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div>
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Inventory
                        </h1>
                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                            Business and financial view of inventory investment.
                        </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            type="button"
                            onClick={refreshInventoryDetails}
                            aria-label="Refresh inventory"
                            title="Refresh inventory"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <RefreshCw size={16} />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <OwnerInventoryContent key={refreshKey} />
        </>
    );
}

function OwnerInventoryContent() {
    const inv = useInventoryController();

    const [isAllBranchesView, setIsAllBranchesView] = React.useState(true);
    const [branchQuery, setBranchQuery] = React.useState("All Branches");
    const [isBranchMenuOpen, setIsBranchMenuOpen] = React.useState(false);

    const branchSelectorRef = React.useRef<HTMLDivElement>(null);
    const selectedBranch = isAllBranchesView ? null : inv.selectedBranch;

    const [salesState, setSalesState] = React.useState<OwnerSalesState>({
        loading: true,
        ready: false,
        orders: [],
        error: null,
    });

    React.useEffect(() => {
        let cancelled = false;

        const loadOwnerSales = async () => {
            if (typeof window === "undefined") return;

            const token = sessionStorage.getItem("token");

            if (!token) {
                if (!cancelled) {
                    setSalesState({
                        loading: false,
                        ready: false,
                        orders: [],
                        error: "Unable to load sales movement because the login token is missing.",
                    });
                }
                return;
            }

            if (!cancelled) {
                setSalesState((current) => ({
                    ...current,
                    loading: true,
                    ready: false,
                    error: null,
                }));
            }

            const request: Record<string, unknown> = {
                action: "get_orders",
                // The current POS backend only returns structured orderItems
                // when this flag is explicitly true. Fast/slow moving products
                // need productId + quantity from those order_items rows.
                include_order_items: true,
            };

            const numericBranchId = Number(inv.selectedBranchId);

            if (
                !isAllBranchesView &&
                Number.isFinite(numericBranchId) &&
                numericBranchId > 0
            ) {
                request.branch_id = numericBranchId;
            }

            try {
                const response = await fetch("/api/pos", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(request),
                    cache: "no-store",
                });

                const payload = (await response
                    .json()
                    .catch(() => ({}))) as OwnerPosOrdersResponse;

                if (
                    !response.ok ||
                    payload.success === false ||
                    !Array.isArray(payload.orders)
                ) {
                    throw new Error(
                        payload.error || "Unable to load POS sales movement."
                    );
                }

                if (cancelled) return;

                setSalesState({
                    loading: false,
                    ready: true,
                    orders: payload.orders,
                    error: null,
                });
            } catch (error) {
                if (cancelled) return;

                console.warn("Owner inventory sales movement loading failed:", error);

                setSalesState({
                    loading: false,
                    ready: false,
                    orders: [],
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unable to load POS sales movement.",
                });
            }
        };

        void loadOwnerSales();

        return () => {
            cancelled = true;
        };
    }, [isAllBranchesView, inv.selectedBranchId]);

    const matchingBranches = React.useMemo(() => {
        const query = branchQuery.trim().toLowerCase();

        if (!query || query === "all branches") {
            return inv.branches;
        }

        return inv.branches.filter((branch) =>
            branch.branchName.toLowerCase().includes(query)
        );
    }, [branchQuery, inv.branches]);

    const displayedProducts = React.useMemo(
        () => (isAllBranchesView ? inv.products : inv.baseProducts),
        [inv.baseProducts, inv.products, isAllBranchesView]
    );

    const filteredProducts = React.useMemo(() => {
        const query = inv.search.trim().toLowerCase();

        return displayedProducts.filter((product) => {
            const variantText = (product.variants || [])
                .map((variant) =>
                    Object.values(variant.variantValues || {}).join(" ")
                )
                .join(" ")
                .toLowerCase();

            const matchesCategory =
                inv.selectedCategory === "All" ||
                product.category === inv.selectedCategory;

            const matchesSearch =
                !query ||
                product.name.toLowerCase().includes(query) ||
                product.category.toLowerCase().includes(query) ||
                (product.branchName || "").toLowerCase().includes(query) ||
                variantText.includes(query);

            return matchesCategory && matchesSearch;
        });
    }, [displayedProducts, inv.search, inv.selectedCategory]);

    const overview = React.useMemo(
        () => getOwnerInventoryOverview(displayedProducts),
        [displayedProducts]
    );

    const branchValues = React.useMemo(
        () => getInventoryValueByBranch(displayedProducts),
        [displayedProducts]
    );

    const salesAnalytics = React.useMemo(
        () => getOwnerSalesAnalytics(salesState.orders),
        [salesState.orders]
    );

    const movementProducts = React.useMemo(
        () =>
            getMovementProducts(
                displayedProducts,
                salesAnalytics,
                salesState.ready
            ),
        [displayedProducts, salesAnalytics, salesState.ready]
    );

    const atRiskBreakdown = React.useMemo(
        () =>
            getOwnerAtRiskBreakdown(
                displayedProducts,
                salesAnalytics,
                salesState.ready
            ),
        [displayedProducts, salesAnalytics, salesState.ready]
    );

    const handleSelectAllBranches = () => {
        setIsAllBranchesView(true);
        inv.setSelectedBranchId("");
        setBranchQuery("All Branches");
        setIsBranchMenuOpen(false);
        inv.setSearch("");
        inv.setSelectedCategory("All");
    };

    const handleSelectBranch = (branch: Branch) => {
        setIsAllBranchesView(false);
        inv.setSelectedBranchId(String(branch.id));
        setBranchQuery(branch.branchName);
        setIsBranchMenuOpen(false);
        inv.setSearch("");
        inv.setSelectedCategory("All");
    };

    React.useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (
                branchSelectorRef.current &&
                !branchSelectorRef.current.contains(event.target as Node)
            ) {
                setIsBranchMenuOpen(false);

                if (isAllBranchesView) {
                    setBranchQuery("All Branches");
                } else if (selectedBranch) {
                    setBranchQuery(selectedBranch.branchName);
                }
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [isAllBranchesView, selectedBranch]);

    return (
        <section className="px-6 py-4 font-sans">
            <div className="space-y-4">
                <OwnerFinancialCards
                    overview={{
                        ...overview,
                        atRiskInventoryValue: atRiskBreakdown.total,
                    }}
                />

                <div className="grid gap-3 xl:grid-cols-2">
                    <InventoryValueByBranchCard rows={branchValues} />
                    <AtRiskInventoryBreakdownCard breakdown={atRiskBreakdown} />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                    <MovementCard
                        title="Top 5 Fast Moving Products"
                        subtitle="Last 30 days. Products with the highest sales volume."
                        icon="fast"
                        rows={movementProducts.fastMoving}
                        hasSalesData={movementProducts.hasSalesData}
                        isLoading={salesState.loading}
                        emptyMessage={
                            salesState.error ||
                            "No completed POS sales have been recorded for this inventory view yet."
                        }
                    />

                    <MovementCard
                        title="Top 5 Slow Moving Products"
                        subtitle="Last 30 days. Products with the lowest sales volume (tying up capital)."
                        icon="slow"
                        rows={movementProducts.slowMoving}
                        hasSalesData={movementProducts.hasSalesData}
                        isLoading={salesState.loading}
                        emptyMessage={
                            salesState.error ||
                            "No completed POS sales have been recorded for this inventory view yet."
                        }
                    />
                </div>

                <section className="rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-[#E6DDF0] p-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                All Products
                            </h2>
                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                Complete inventory list with financial value and profit potential.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                            <div className="relative min-w-[230px] flex-1 sm:flex-none">
                                <Search
                                    size={15}
                                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                                />
                                <input
                                    value={inv.search}
                                    onChange={(event) =>
                                        inv.setSearch(event.target.value)
                                    }
                                    placeholder="Search product or category"
                                    className="h-[40px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-9 pr-3 text-sm text-[#1A1220] outline-none transition placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                />
                            </div>

                            <select
                                value={inv.selectedCategory}
                                onChange={(event) =>
                                    inv.setSelectedCategory(event.target.value)
                                }
                                className="h-[40px] min-w-[150px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm font-semibold text-[#2B174C] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                aria-label="Filter inventory by category"
                            >
                                <option value="All">All Categories</option>
                                {inv.categories.map((category) => (
                                    <option key={category} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>

                            <div
                                ref={branchSelectorRef}
                                className="relative min-w-[190px]"
                            >
                                <Building2
                                    size={15}
                                    className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-[#9B8AAA]"
                                />

                                <input
                                    value={branchQuery}
                                    onFocus={() => {
                                        setIsBranchMenuOpen(true);

                                        if (
                                            branchQuery === "All Branches" ||
                                            branchQuery ===
                                            selectedBranch?.branchName
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
                                    placeholder="All Branches"
                                    className="h-[40px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-9 pr-9 text-sm font-semibold text-[#2B174C] outline-none transition placeholder:font-normal placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                    role="combobox"
                                    aria-expanded={isBranchMenuOpen}
                                    aria-controls="owner-inventory-branch-options"
                                    aria-autocomplete="list"
                                />

                                <button
                                    type="button"
                                    onMouseDown={(event) =>
                                        event.preventDefault()
                                    }
                                    onClick={() => {
                                        setIsBranchMenuOpen(
                                            (isOpen) => !isOpen
                                        );
                                        setBranchQuery("");
                                    }}
                                    className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-[#2B174C]"
                                    aria-label="Show branch choices"
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
                                        id="owner-inventory-branch-options"
                                        className="absolute right-0 z-30 mt-1 max-h-60 w-full min-w-[220px] overflow-y-auto rounded-xl border border-[#D8CBE7] bg-white py-1 shadow-lg"
                                        role="listbox"
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
                                                    inv.selectedBranchId;

                                                return (
                                                    <button
                                                        key={branch.id}
                                                        type="button"
                                                        role="option"
                                                        aria-selected={
                                                            isSelected
                                                        }
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

                            <button
                                type="button"
                                onClick={() =>
                                    exportOwnerInventoryCsv(filteredProducts)
                                }
                                disabled={filteredProducts.length === 0}
                                className="inline-flex h-[40px] items-center justify-center gap-2 rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Download size={15} />
                                Export
                            </button>
                        </div>
                    </div>

                    {filteredProducts.length === 0 ? (
                        <div className="p-4">
                            <EmptyInventory
                                message={
                                    inv.search ||
                                    inv.selectedCategory !== "All"
                                        ? "No products found for the current search or category."
                                        : isAllBranchesView
                                            ? "No products found across all branches."
                                            : "No products found for this branch."
                                }
                            />
                        </div>
                    ) : (
                        <OwnerProductsTable products={filteredProducts} />
                    )}
                </section>
            </div>
        </section>
    );
}

function OwnerFinancialCards({
                                 overview,
                             }: {
    overview: {
        inventoryCostValue: number;
        retailValue: number;
        potentialGrossProfit: number;
        atRiskInventoryValue: number;
    };
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OwnerMetricCard
                label="Inventory Cost Value"
                value={formatPeso(overview.inventoryCostValue)}
                helper="Total value of current stock at cost price"
                icon={<Wallet size={18} strokeWidth={1.9} />}
                iconClassName="bg-[#F0E9FF] text-[#5A35A5]"
            />

            <OwnerMetricCard
                label="Retail Value"
                value={formatPeso(overview.retailValue)}
                helper="Total value of current stock at selling price"
                icon={<DollarSign size={18} strokeWidth={2} />}
                iconClassName="bg-[#EAF1FF] text-[#245EDB]"
                valueClassName="text-[#245EDB]"
            />

            <OwnerMetricCard
                label="Potential Gross Profit"
                value={formatPeso(overview.potentialGrossProfit)}
                helper="Potential profit if remaining stock sells at retail price"
                icon={<TrendingUp size={18} strokeWidth={1.9} />}
                iconClassName="bg-[#EAF8EF] text-[#168A48]"
                valueClassName="text-[#168A48]"
            />

            <OwnerMetricCard
                label="At-Risk Inventory Value"
                value={formatPeso(overview.atRiskInventoryValue)}
                helper="Value of slow-moving, expiring or underperforming stock"
                icon={<AlertTriangle size={18} strokeWidth={1.9} />}
                iconClassName="bg-[#FFF0F0] text-[#C32F2F]"
                valueClassName="text-[#C32F2F]"
                cardClassName="border-[#F3D1D1] bg-[#FFFDFD]"
            />
        </div>
    );
}

function OwnerMetricCard({
                             label,
                             value,
                             helper,
                             icon,
                             iconClassName,
                             valueClassName = "text-[#1A1220]",
                             cardClassName = "border-[#E6DDF0] bg-white",
                         }: {
    label: string;
    value: string;
    helper: string;
    icon: React.ReactNode;
    iconClassName: string;
    valueClassName?: string;
    cardClassName?: string;
}) {
    return (
        <div
            className={`min-h-[132px] rounded-[18px] border p-4 shadow-sm ${cardClassName}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1A1220]">
                        {label}
                    </p>
                    <p
                        className={`mt-2 break-words text-[23px] font-bold leading-tight tracking-[-0.025em] ${valueClassName}`}
                    >
                        {value}
                    </p>
                </div>

                <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
                >
                    {icon}
                </span>
            </div>

            <p className="mt-2 text-[10px] leading-4 text-[#8A7D90]">
                {helper}
            </p>
        </div>
    );
}

function InventoryValueByBranchCard({ rows }: { rows: BranchValueRow[] }) {
    const visibleRows = rows.slice(0, 6);
    const rawMaxValue = Math.max(0, ...visibleRows.map((row) => row.costValue));

    const getNiceAxisMax = (value: number) => {
        if (value <= 0) return 500000;

        const roughStep = value / 4;
        const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const normalized = roughStep / magnitude;
        const niceMultiplier =
            normalized <= 1
                ? 1
                : normalized <= 2
                    ? 2
                    : normalized <= 2.5
                        ? 2.5
                        : normalized <= 5
                            ? 5
                            : 10;
        const step = niceMultiplier * magnitude;

        return step * 4;
    };

    const axisMax = getNiceAxisMax(rawMaxValue);
    const axisStep = axisMax / 4;
    const axisTicks = [axisMax, axisStep * 3, axisStep * 2, axisStep, 0];

    const formatAxisPeso = (value: number) =>
        value.toLocaleString("en-PH", {
            style: "currency",
            currency: "PHP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });

    const barColors = [
        "#4E2A91",
        "#6D4BD2",
        "#9278E5",
        "#B5A0EF",
        "#C7B8F5",
        "#D7CDF9",
    ];

    return (
        <section className="rounded-[16px] border border-[#E8E1ED] bg-white p-4 shadow-[0_1px_3px_rgba(43,23,76,0.08)]">
            <div className="mb-3 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                    <Building2 size={19} strokeWidth={1.9} />
                </span>

                <div className="min-w-0">
                    <h2 className="text-[15px] font-bold leading-5 text-[#1A1220]">
                        Inventory Value by Branch
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#7A6A84]">
                        Total inventory value (at cost price) per branch
                    </p>
                </div>
            </div>

            {visibleRows.length === 0 ? (
                <div className="flex py-10 items-center justify-center text-sm text-[#7A6A84]">
                    No branch inventory data available.
                </div>
            ) : (
                <div className="overflow-x-auto overflow-y-hidden">
                    <div className="min-w-[560px]">
                        <div className="grid grid-cols-[78px_minmax(0,1fr)]">
                            <div className="relative h-[210px] pb-[42px] pt-[14px]">
                                {axisTicks.map((tickValue, index) => {
                                    const top = (index / 4) * 150 + 14;

                                    return (
                                        <span
                                            key={`${tickValue}-${index}`}
                                            className="absolute right-3 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-[#817489]"
                                            style={{ top }}
                                        >
                                            {formatAxisPeso(tickValue)}
                                        </span>
                                    );
                                })}
                            </div>

                            <div className="relative h-[210px] pb-[42px] pt-[14px]">
                                <div className="absolute inset-x-0 top-[14px] h-[150px]">
                                    {axisTicks.map((_, index) => (
                                        <div
                                            key={index}
                                            className="absolute left-0 right-0 border-t border-[#ECE7F0]"
                                            style={{ top: `${(index / 4) * 100}%` }}
                                        />
                                    ))}
                                </div>

                                <div className="absolute inset-x-2 top-[14px] flex h-[150px] items-end justify-around gap-4">
                                    {visibleRows.map((row, index) => {
                                        const barHeight = Math.max(
                                            7,
                                            Math.min(150, (row.costValue / axisMax) * 150)
                                        );

                                        return (
                                            <div
                                                key={row.branchName}
                                                className="relative flex h-full min-w-[68px] flex-1 items-end justify-center"
                                            >
                                                <div
                                                    className="relative w-full max-w-[72px] rounded-t-[7px] shadow-[0_1px_2px_rgba(43,23,76,0.10)]"
                                                    style={{
                                                        height: `${barHeight}px`,
                                                        backgroundColor:
                                                            barColors[index % barColors.length],
                                                    }}
                                                    title={`${row.branchName}: ${formatPeso(
                                                        row.costValue
                                                    )}`}
                                                >
                                                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-[#24152F]">
                                                        {formatAxisPeso(row.costValue)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="absolute inset-x-2 bottom-0 flex h-[36px] justify-around gap-4">
                                    {visibleRows.map((row) => (
                                        <div
                                            key={`${row.branchName}-label`}
                                            className="min-w-[68px] flex-1 text-center"
                                        >
                                            <p className="mx-auto max-w-[88px] text-[10px] font-semibold leading-[13px] text-[#51445A]">
                                                {row.branchName}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

function AtRiskInventoryBreakdownCard({
                                          breakdown,
                                      }: {
    breakdown: AtRiskBreakdown;
}) {
    return (
        <section className="rounded-[16px] border border-[#E8E1ED] bg-white p-4 shadow-[0_1px_3px_rgba(43,23,76,0.08)]">
            <div className="mb-3 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#FFF0F0] text-[#C32F2F]">
                    <AlertTriangle size={19} strokeWidth={1.9} />
                </span>

                <div className="min-w-0">
                    <h2 className="text-[15px] font-bold leading-5 text-[#1A1220]">
                        At-Risk Inventory Breakdown
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#7A6A84]">
                        Inventory that may lose value or tie up capital.
                    </p>
                </div>
            </div>

            <div className="grid items-center gap-5 py-1 md:grid-cols-[168px_minmax(0,1fr)] xl:grid-cols-[160px_minmax(0,1fr)]">
                <div className="relative mx-auto h-[156px] w-[156px]">
                    <div
                        className="h-full w-full rounded-full"
                        style={{ background: breakdown.gradient }}
                    />

                    <div className="absolute inset-[30px] flex flex-col items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_#F1EDF3]">
                        <span className="text-[19px] font-bold leading-none text-[#23122F]">
                            {formatCompactPeso(breakdown.total)}
                        </span>
                        <span className="mt-2 text-[10px] font-medium text-[#8A7D90]">
                            At-Risk Value
                        </span>
                    </div>
                </div>

                <div className="divide-y divide-[#EEE8F1]">
                    {breakdown.rows.map((row) => (
                        <div
                            key={row.key}
                            className="grid min-h-[38px] grid-cols-[12px_minmax(0,1fr)_86px_48px] items-center gap-2 text-[11px]"
                        >
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: row.color }}
                            />

                            <span className="font-medium text-[#51445A]">
                                {row.label}
                            </span>

                            <span className="text-right font-bold tabular-nums text-[#23122F]">
                                {formatPeso(row.value)}
                            </span>

                            <span className="text-right font-medium text-[#8A7D90]">
                                {row.percentage.toFixed(1)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function MovementCard({
                          title,
                          subtitle,
                          icon,
                          rows,
                          hasSalesData,
                          isLoading,
                          emptyMessage,
                      }: {
    title: string;
    subtitle: string;
    icon: "fast" | "slow";
    rows: MovementProductRow[];
    hasSalesData: boolean;
    isLoading: boolean;
    emptyMessage: string;
}) {
    const isFast = icon === "fast";

    return (
        <section className="rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-[#E6DDF0] px-4 py-3.5">
                <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isFast
                            ? "bg-[#EAF8EF] text-[#168A48]"
                            : "bg-[#FFF0F0] text-[#C32F2F]"
                    }`}
                >
                    {isFast ? (
                        <TrendingUp size={16} />
                    ) : (
                        <TrendingDown size={16} />
                    )}
                </span>

                <div>
                    <h2 className="text-sm font-bold text-[#1A1220]">
                        {title}
                    </h2>
                    <p className="mt-0.5 text-[10px] text-[#8A7D90]">
                        {subtitle}
                    </p>
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center px-6 py-10 text-center text-sm leading-6 text-[#7A6A84]">
                    Loading POS sales movement...
                </div>
            ) : !hasSalesData ? (
                <div className="flex items-center justify-center px-6 py-10 text-center text-sm leading-6 text-[#7A6A84]">
                    {emptyMessage}
                </div>
            ) : isFast ? (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] table-fixed border-collapse">
                        <colgroup>
                            <col className="w-[7%]" />
                            <col className="w-[43%]" />
                            <col className="w-[16%]" />
                            <col className="w-[17%]" />
                            <col className="w-[17%]" />
                        </colgroup>

                        <thead className="bg-[#FFFCF7]">
                        <tr className="border-b border-[#E6DDF0]">
                            <MovementHeader align="center">#</MovementHeader>
                            <MovementHeader>Product</MovementHeader>
                            <MovementHeader align="center">Units Sold</MovementHeader>
                            <MovementHeader align="center">Current Stock</MovementHeader>
                            <MovementHeader align="center">Status</MovementHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((row, index) => (
                            <tr
                                key={row.id}
                                className="border-b border-[#EEE7F2] last:border-b-0 hover:bg-[#FFFCF9]"
                            >
                                <td className="px-3 py-3 text-center text-xs font-semibold text-[#8A7D90]">
                                    {index + 1}
                                </td>
                                <td className="px-4 py-3 text-left text-xs font-semibold leading-5 text-[#2B174C]">
                                    {row.productName}
                                </td>
                                <td className="px-3 py-3 text-center text-xs font-medium tabular-nums text-[#5F4E75]">
                                    {formatNumber(row.totalSold)}
                                </td>
                                <td className="px-3 py-3 text-center text-xs font-medium tabular-nums text-[#5F4E75]">
                                    {formatNumber(row.currentStock)}
                                </td>
                                <td className="px-3 py-3 text-center">
                                    <div className="flex justify-center">
                                        <OwnerStatusBadge status={row.status} />
                                    </div>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="w-full overflow-hidden">
                    <table className="w-full table-fixed border-collapse">
                        <colgroup>
                            <col className="w-[5%]" />
                            <col className="w-[39%]" />
                            <col className="w-[13%]" />
                            <col className="w-[16%]" />
                            <col className="w-[13%]" />
                            <col className="w-[14%]" />
                        </colgroup>

                        <thead className="bg-[#FFFCF7]">
                        <tr className="border-b border-[#E6DDF0]">
                            <MovementHeader align="center">#</MovementHeader>
                            <MovementHeader>Product</MovementHeader>
                            <MovementHeader align="center">Current Stock</MovementHeader>
                            <MovementHeader align="center">Stock Value</MovementHeader>
                            <MovementHeader align="center">Last Sold</MovementHeader>
                            <MovementHeader align="center">Status</MovementHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((row, index) => (
                            <tr
                                key={row.id}
                                className="border-b border-[#EEE7F2] last:border-b-0 hover:bg-[#FFFCF9]"
                            >
                                <td className="px-1.5 py-3 text-center text-[11px] font-semibold text-[#8A7D90]">
                                    {index + 1}
                                </td>
                                <td className="px-2 py-3 text-left text-[11px] font-semibold leading-[17px] text-[#2B174C]">
                                    <span className="block break-words">
                                        {row.productName}
                                    </span>
                                </td>
                                <td className="px-1.5 py-3 text-center text-[11px] font-medium tabular-nums text-[#5F4E75]">
                                    {formatNumber(row.currentStock)}
                                </td>
                                <td className="px-1.5 py-3 text-center text-[11px] font-medium tabular-nums text-[#5F4E75]">
                                    <span className="whitespace-nowrap">
                                        {formatPeso(row.stockValue)}
                                    </span>
                                </td>
                                <td className="px-1.5 py-3 text-center text-[10px] font-medium leading-[14px] text-[#5F4E75]">
                                    <span className="block break-words">
                                        {formatOwnerLastSold(row.lastSoldAt)}
                                    </span>
                                </td>
                                <td className="px-1.5 py-3 text-center">
                                    <div className="flex justify-center">
                                        {row.status === "Expired" ? (
                                            <OwnerStatusBadge status="Expired" />
                                        ) : (
                                            <span className="inline-flex whitespace-nowrap rounded-full border border-[#F4D79A] bg-[#FFF7EA] px-2 py-1 text-[10px] font-semibold text-[#C66A00]">
                                                Slow Moving
                                            </span>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function MovementHeader({
                            children,
                            align = "left",
                        }: {
    children: React.ReactNode;
    align?: "left" | "center";
}) {
    return (
        <th
            className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C] ${
                align === "center" ? "text-center" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function OwnerProductsTable({ products }: { products: Product[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed border-collapse">
                <colgroup>
                    <col className="w-[36%]" />
                    <col className="w-[14%]" />
                    <col className="w-[8%]" />
                    <col className="w-[12%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[7%]" />
                </colgroup>

                <thead className="bg-[#FFFCF7]">
                <tr className="border-b border-[#E6DDF0]">
                    <OwnerTableHeader>Product</OwnerTableHeader>
                    <OwnerTableHeader align="center">Branch</OwnerTableHeader>
                    <OwnerTableHeader align="center">Stock</OwnerTableHeader>
                    <OwnerTableHeader align="center">Inventory Value</OwnerTableHeader>
                    <OwnerTableHeader align="center">Retail Value</OwnerTableHeader>
                    <OwnerTableHeader align="center">Potential Profit</OwnerTableHeader>
                    <OwnerTableHeader align="center">Status</OwnerTableHeader>
                </tr>
                </thead>

                <tbody>
                {products.map((product) => {
                    const financials = getOwnerProductFinancials(product);
                    const status = getProductStatus(product);

                    return (
                        <tr
                            key={product.id}
                            className="border-b border-[#EEE7F2] last:border-b-0 hover:bg-[#FFFCF9]"
                        >
                            <td className="px-4 py-3 text-left">
                                <p className="text-sm font-semibold leading-5 text-[#1A1220]">
                                    {product.name}
                                </p>
                                <p className="mt-0.5 text-[11px] text-[#8A7D90]">
                                    {product.category || "Uncategorized"}
                                </p>
                            </td>

                            <td className="px-3 py-3 text-center text-sm text-[#5F4E75]">
                                {product.branchName || "—"}
                            </td>

                            <td className="px-3 py-3 text-center text-sm font-semibold tabular-nums text-[#2B174C]">
                                {formatNumber(financials.stock)}
                            </td>

                            <td className="px-3 py-3 text-center text-sm tabular-nums text-[#5F4E75]">
                                {formatPeso(financials.inventoryValue)}
                            </td>

                            <td className="px-3 py-3 text-center text-sm font-semibold tabular-nums text-[#245EDB]">
                                {formatPeso(financials.retailValue)}
                            </td>

                            <td className="px-3 py-3 text-center text-sm font-semibold tabular-nums text-[#168A48]">
                                {formatPeso(financials.potentialProfit)}
                            </td>

                            <td className="px-3 py-3 text-center">
                                <div className="flex justify-center">
                                    <OwnerStatusBadge status={status} />
                                </div>
                            </td>
                        </tr>
                    );
                })}
                </tbody>
            </table>
        </div>
    );
}

function OwnerTableHeader({
                              children,
                              align = "left",
                          }: {
    children: React.ReactNode;
    align?: "left" | "center";
}) {
    return (
        <th
            className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#806A8C] ${
                align === "center" ? "text-center" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function OwnerStatusBadge({ status }: { status: OwnerProductStatus }) {
    const className =
        status === "In Stock"
            ? "border-[#BDE6CC] bg-[#ECF8F0] text-[#168A48]"
            : status === "Low Stock"
                ? "border-[#F4D79A] bg-[#FFF8D8] text-[#A56607]"
                : status === "Out of Stock"
                    ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
                    : status === "Expiring"
                        ? "border-[#D8C5F3] bg-[#F7F1FF] text-[#6D35D4]"
                        : "border-[#E1CAE9] bg-[#F5EDF8] text-[#8B4F9F]";

    return (
        <span
            className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}
        >
            {status}
        </span>
    );
}
