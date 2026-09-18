"use client";

import * as React from "react";
import {
    AlertTriangle,
    Boxes,
    CalendarClock,
    CheckCircle2,
    ChevronDown,
    ClipboardList,
    Download,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    ShoppingCart,
    Trash2,
    Upload,
} from "lucide-react";
import {
    useInventoryController,
    type InventoryController,
} from "@/hooks/useInventory";

/* -------------------------------------------------------------------------- */
/*                                  TYPES                                     */
/* -------------------------------------------------------------------------- */

type ProductVariant = {
    id: number;
    productId: number;
    variantValues: Record<string, string>;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
    createdAt?: string;
};

type ProductVariantSave = {
    id?: number;
    variantValues: Record<string, string>;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
};

type Product = {
    id: number;
    storeId?: number | null;
    branchId?: number | null;
    branchName?: string | null;
    packageId?: number | null;
    packageName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
    createdAt?: string;
    updatedAt?: string;
    lastRestock?: string | null;
    hasVariants: boolean;
    variants?: ProductVariant[];
};

type ProductSaveData = {
    storeId?: number | null;
    branchId?: number | null;
    branchName?: string | null;
    packageId?: number | null;
    packageName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
    hasVariants: boolean;
    variants?: ProductVariantSave[];
};

type Branch = {
    id: number;
    branchName: string;
};

type VariantEditorController = InventoryController & {
    variants?: ProductVariantSave[];
    addVariantRow: () => void;
    removeVariantRow: (index: number) => void;
    updateVariantValue: (index: number, key: string, value: string) => void;
    updateVariantField: (
        index: number,
        field: "stock" | "alertLevel" | "originalPrice" | "salesPrice",
        value: string
    ) => void;
};

type ManagerStockLine = {
    id: string;
    product: Product;
    productName: string;
    category: string;
    variantName: string;
    stock: number;
    alertLevel: number;
    expirationDate?: string | null;
    costPrice: number;
};

type ManagerInventoryStatus =
    | "In Stock"
    | "Low Stock"
    | "Out of Stock"
    | "Expiring Soon"
    | "Expired";

type ManagerPosOrderItem = {
    productId?: number | string | null;
    product_id?: number | string | null;
    productName?: string | null;
    product_name?: string | null;
    name?: string | null;
    quantity?: number | string | null;
    qty?: number | string | null;
};

type ManagerPosOrder = {
    id?: number | string | null;
    orderId?: string | null;
    order_id?: string | null;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    createdAt?: string | null;
    created_at?: string | null;
    orderDate?: string | null;
    order_date?: string | null;
    date?: string | null;
    item?: string | null;
    orderItems?: ManagerPosOrderItem[];
    order_items?: ManagerPosOrderItem[];
};

type ManagerPosOrdersResponse = {
    success?: boolean;
    orders?: ManagerPosOrder[];
    error?: string;
};

type SalesMovement = {
    productId: string;
    productName: string;
    quantity: number;
    date: Date | null;
    source: string;
};

type ActionCenterRow = {
    id: string;
    product: Product;
    productName: string;
    currentStock: number;
    reorderLevel: number;
    salesDemand: "High" | "Medium" | "Low" | "—";
    issue:
        | "Out of Stock"
        | "Low Stock"
        | "Expired"
        | "Expiring"
        | "Slow Moving";
    action:
        | "Reorder Now"
        | "Reorder"
        | "Review / Remove"
        | "Prioritize Sale"
        | "Do Not Reorder";
};

/* -------------------------------------------------------------------------- */
/*                               BASIC HELPERS                                */
/* -------------------------------------------------------------------------- */

const EXPIRING_SOON_DAYS = 30;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const labelClass = "text-xs font-semibold text-[#5A476A]";
const fieldClass =
    "w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]";

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

function formatNumber(value: number | string) {
    return Number(value || 0).toLocaleString("en-PH");
}

function money(value: number | string) {
    const amount = Number(value || 0);

    return `₱${amount.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatDate(value?: string | null) {
    const raw = String(value || "").trim();
    if (!raw) return "—";

    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(`${raw}T00:00:00`)
        : new Date(raw);

    if (Number.isNaN(parsed.getTime())) return "—";

    return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatExpirationDateInput(value?: string | null) {
    const rawValue = String(value || "").trim();

    if (!rawValue) return "";

    const datePrefix = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);

    if (datePrefix) {
        return datePrefix[1];
    }

    const parsedDate = new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) {
        return "";
    }

    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const day = String(parsedDate.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function normalizeLookupText(value: unknown) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function parseInventoryExpirationDate(value?: string | null) {
    const rawValue = String(value || "").trim();

    if (!rawValue) return null;

    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? new Date(`${rawValue}T00:00:00`)
        : new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) return null;

    parsedDate.setHours(0, 0, 0, 0);
    return parsedDate;
}

function getDaysUntilExpiration(value?: string | null) {
    const expirationDate = parseInventoryExpirationDate(value);

    if (!expirationDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.round(
        (expirationDate.getTime() - today.getTime()) / DAY_IN_MILLISECONDS
    );
}

function getVariantName(variant: ProductVariant) {
    const values = Object.values(variant.variantValues || {})
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    return values.length > 0 ? values.join(", ") : "Variant";
}

function getProductStockLines(product: Product): ManagerStockLine[] {
    const variants = Array.isArray(product.variants) ? product.variants : [];

    if (product.hasVariants && variants.length > 0) {
        return variants.map((variant) => ({
            id: `${product.id}-${variant.id}`,
            product,
            productName: product.name,
            category: product.category,
            variantName: getVariantName(variant),
            stock: Number(variant.stock || 0),
            alertLevel: Number(variant.alertLevel || 0),
            expirationDate: variant.expirationDate,
            costPrice: Number(variant.originalPrice || 0),
        }));
    }

    return [
        {
            id: `${product.id}-regular`,
            product,
            productName: product.name,
            category: product.category,
            variantName: "Regular",
            stock: Number(product.stock || 0),
            alertLevel: Number(product.alertLevel || 0),
            expirationDate: product.expirationDate,
            costPrice: Number(product.originalPrice || 0),
        },
    ];
}

function getLineStatus(line: ManagerStockLine): ManagerInventoryStatus {
    const daysRemaining = getDaysUntilExpiration(line.expirationDate);

    if (daysRemaining !== null && daysRemaining < 0) return "Expired";
    if (
        daysRemaining !== null &&
        daysRemaining >= 0 &&
        daysRemaining <= EXPIRING_SOON_DAYS
    ) {
        return "Expiring Soon";
    }
    if (line.stock <= 0) return "Out of Stock";
    if (line.stock <= line.alertLevel) return "Low Stock";
    return "In Stock";
}

function getProductStatus(product: Product): ManagerInventoryStatus {
    const lines = getProductStockLines(product);
    const statuses = lines.map(getLineStatus);

    if (statuses.includes("Expired")) return "Expired";
    if (statuses.includes("Expiring Soon")) return "Expiring Soon";
    if (statuses.every((status) => status === "Out of Stock")) {
        return "Out of Stock";
    }
    if (statuses.includes("Out of Stock") || statuses.includes("Low Stock")) {
        return "Low Stock";
    }
    return "In Stock";
}

function getProductTotalStock(product: Product) {
    return getProductStockLines(product).reduce(
        (sum, line) => sum + Math.max(0, line.stock),
        0
    );
}

function getProductReorderLevel(product: Product) {
    return getProductStockLines(product).reduce(
        (sum, line) => sum + Math.max(0, line.alertLevel),
        0
    );
}

function getProductExpiration(product: Product) {
    const dates = getProductStockLines(product)
        .map((line) => parseInventoryExpirationDate(line.expirationDate))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime());

    return dates[0] || null;
}

function getProductLastRestock(product: Product) {
    const raw = product as Product & Record<string, unknown>;

    return (
        (raw.lastRestock as string | undefined) ??
        (raw.last_restock as string | undefined) ??
        (raw.lastRestockDate as string | undefined) ??
        (raw.last_restock_date as string | undefined) ??
        ""
    );
}

function getNumericSalesValue(value: unknown) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSalesProductName(value: unknown) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getOrderDate(order: ManagerPosOrder) {
    const raw =
        order.orderDate ??
        order.order_date ??
        order.createdAt ??
        order.created_at ??
        order.date ??
        null;

    if (!raw) return null;

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseLegacyOrderItems(value?: string | null): ManagerPosOrderItem[] {
    return String(value || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const match = part.match(/^(.*?)(?:\s+x|\s*×\s*)(\d+)\s*$/i);

            if (!match) {
                return { name: part, quantity: 0 };
            }

            return {
                name: match[1].trim(),
                quantity: Number(match[2] || 0),
            };
        });
}

function getOrderItems(order: ManagerPosOrder) {
    const structured = Array.isArray(order.orderItems)
        ? order.orderItems
        : Array.isArray(order.order_items)
            ? order.order_items
            : [];

    return structured.length > 0 ? structured : parseLegacyOrderItems(order.item);
}

function getOrderItemQuantity(item: ManagerPosOrderItem) {
    const value = getNumericSalesValue(item.quantity ?? item.qty);
    return value !== null && value > 0 ? value : 0;
}

function getOrderItemProductId(item: ManagerPosOrderItem) {
    const numeric = Number(item.productId ?? item.product_id);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "";
}

function getOrderItemName(item: ManagerPosOrderItem) {
    return String(
        item.productName ?? item.product_name ?? item.name ?? "Unknown Product"
    ).trim();
}

function getRecentThirtyDaySales(orders: ManagerPosOrder[]) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 29);

    const byProductId = new Map<string, number>();
    const byProductName = new Map<string, number>();
    const movements: SalesMovement[] = [];

    orders.forEach((order) => {
        const orderDate = getOrderDate(order);

        if (orderDate && orderDate.getTime() < cutoff.getTime()) return;

        getOrderItems(order).forEach((item) => {
            const quantity = getOrderItemQuantity(item);
            if (quantity <= 0) return;

            const productId = getOrderItemProductId(item);
            const productName = getOrderItemName(item);
            const productNameKey = normalizeSalesProductName(productName);

            if (productId) {
                byProductId.set(
                    productId,
                    (byProductId.get(productId) || 0) + quantity
                );
            }

            if (productNameKey) {
                byProductName.set(
                    productNameKey,
                    (byProductName.get(productNameKey) || 0) + quantity
                );
            }

            movements.push({
                productId,
                productName,
                quantity,
                date: orderDate,
                source: "POS Sale",
            });
        });
    });

    movements.sort((a, b) => {
        const aTime = a.date?.getTime() ?? 0;
        const bTime = b.date?.getTime() ?? 0;
        return bTime - aTime;
    });

    return { byProductId, byProductName, movements };
}

function getProductUnitsSold(
    product: Product,
    sales: ReturnType<typeof getRecentThirtyDaySales>
) {
    const byId = sales.byProductId.get(String(product.id));
    if (byId !== undefined) return byId;

    return sales.byProductName.get(normalizeSalesProductName(product.name)) || 0;
}

function getSalesDemandLabel(unitsSold: number, maxUnitsSold: number) {
    if (maxUnitsSold <= 0) return "—" as const;
    if (unitsSold <= 0) return "Low" as const;

    const ratio = unitsSold / maxUnitsSold;
    if (ratio >= 0.6) return "High" as const;
    if (ratio >= 0.25) return "Medium" as const;
    return "Low" as const;
}

function getActionCenterRows(
    products: Product[],
    sales: ReturnType<typeof getRecentThirtyDaySales>
): ActionCenterRow[] {
    const maxUnitsSold = Math.max(
        0,
        ...products.map((product) => getProductUnitsSold(product, sales))
    );

    const rows: ActionCenterRow[] = [];

    products.forEach((product) => {
        const totalStock = getProductTotalStock(product);
        const reorderLevel = getProductReorderLevel(product);
        const unitsSold = getProductUnitsSold(product, sales);
        const salesDemand = getSalesDemandLabel(unitsSold, maxUnitsSold);
        const expiration = getProductExpiration(product);
        const expirationDays = expiration
            ? getDaysUntilExpiration(expiration.toISOString())
            : null;

        let issue: ActionCenterRow["issue"] | null = null;
        let action: ActionCenterRow["action"] | null = null;

        if (expirationDays !== null && expirationDays < 0) {
            issue = "Expired";
            action = "Review / Remove";
        } else if (totalStock <= 0) {
            issue = "Out of Stock";
            action = "Reorder Now";
        } else if (totalStock <= reorderLevel) {
            issue = "Low Stock";
            action = "Reorder";
        } else if (
            expirationDays !== null &&
            expirationDays >= 0 &&
            expirationDays <= EXPIRING_SOON_DAYS
        ) {
            issue = "Expiring";
            action = "Prioritize Sale";
        } else if (unitsSold === 0 && totalStock > reorderLevel) {
            issue = "Slow Moving";
            action = "Do Not Reorder";
        }

        if (!issue || !action) return;

        rows.push({
            id: String(product.id),
            product,
            productName: product.name,
            currentStock: totalStock,
            reorderLevel,
            salesDemand,
            issue,
            action,
        });
    });

    const priority: Record<ActionCenterRow["issue"], number> = {
        "Out of Stock": 0,
        "Low Stock": 1,
        Expired: 2,
        Expiring: 3,
        "Slow Moving": 4,
    };

    return rows
        .sort((a, b) => {
            if (priority[a.issue] !== priority[b.issue]) {
                return priority[a.issue] - priority[b.issue];
            }
            return a.currentStock - b.currentStock;
        })
        .slice(0, 5);
}

function exportManagerInventoryCsv(products: Product[]) {
    const escapeCsv = (value: string | number) =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;

    const rows = products.map((product) => [
        product.name,
        product.category,
        getProductTotalStock(product),
        getProductReorderLevel(product),
        formatDate(getProductLastRestock(product)),
        getProductExpiration(product)
            ? formatDate(getProductExpiration(product)!.toISOString())
            : "—",
        getProductStatus(product),
    ]);

    const csv = [
        [
            "Product",
            "Category",
            "Available Stock",
            "Reorder Level",
            "Last Restock",
            "Expiration",
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
    link.href = url;
    link.download = `manager-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function PesoPriceInput({
                            value,
                            onChange,
                            compact = false,
                        }: {
    value: string | number;
    onChange: (value: string) => void;
    compact?: boolean;
}) {
    return (
        <div className="relative w-full">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#806A8C]">
                ₱
            </span>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className={
                    compact
                        ? "h-10 w-full min-w-0 rounded-lg border border-[#E3D8EA] bg-white px-3 py-2 pl-8 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]"
                        : "w-full rounded-xl border border-[#E3D8EA] bg-white p-3 pl-8 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]"
                }
            />
        </div>
    );
}

function VariantToggle({
                           checked,
                           onChange,
                       }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={[
                "relative inline-flex h-8 w-20 shrink-0 items-center rounded-full transition",
                checked
                    ? "border-2 border-[#2B174C] bg-[#2B174C]"
                    : "border-2 border-[#8A7A91] bg-[#FFFDF8] ring-2 ring-[#EFE8F8]",
            ].join(" ")}
        >
            <span
                className={[
                    "absolute text-[10px] font-bold uppercase tracking-wide transition",
                    checked ? "left-3 text-white" : "right-3 text-[#5A476A]",
                ].join(" ")}
            >
                {checked ? "YES" : "NO"}
            </span>

            <span
                className={[
                    "inline-block h-6 w-6 transform rounded-full shadow-sm transition",
                    checked ? "translate-x-12 bg-white" : "translate-x-1 bg-[#8A7A91]",
                ].join(" ")}
            />
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/*                             MANAGER MAIN VIEW                              */
/* -------------------------------------------------------------------------- */

export default function ManagerInventory() {
    const inv = useInventoryController();
    const [currentDateTime, setCurrentDateTime] = React.useState<Date | null>(
        null
    );
    const [statusFilter, setStatusFilter] = React.useState("All Status");
    const [salesOrders, setSalesOrders] = React.useState<ManagerPosOrder[]>([]);
    const [salesLoading, setSalesLoading] = React.useState(false);

    React.useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());
        updateDateTime();

        const timer = window.setInterval(updateDateTime, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const branchBadge = inv.assignedBranchName || "Assigned Branch";
    const managerBranchId = Number(
        (inv as any).assignedBranchId ??
        (inv as any).branchId ??
        (inv as any).selectedBranchId
    );

    const managerProducts = React.useMemo(
        () =>
            (Array.isArray(inv.baseProducts)
                ? inv.baseProducts
                : []) as Product[],
        [inv.baseProducts]
    );

    React.useEffect(() => {
        let cancelled = false;

        const loadSales = async () => {
            if (typeof window === "undefined") return;

            const token = sessionStorage.getItem("token");
            if (!token) return;

            const request: Record<string, unknown> = {
                action: "get_orders",
                include_order_items: true,
            };

            if (Number.isFinite(managerBranchId) && managerBranchId > 0) {
                request.branch_id = managerBranchId;
            }

            setSalesLoading(true);

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
                    .catch(() => ({}))) as ManagerPosOrdersResponse;

                if (
                    !response.ok ||
                    payload.success === false ||
                    !Array.isArray(payload.orders)
                ) {
                    throw new Error(payload.error || "Unable to load POS orders.");
                }

                if (!cancelled) setSalesOrders(payload.orders);
            } catch (error) {
                console.warn("Manager inventory sales loading failed:", error);
                if (!cancelled) setSalesOrders([]);
            } finally {
                if (!cancelled) setSalesLoading(false);
            }
        };

        void loadSales();

        return () => {
            cancelled = true;
        };
    }, [managerBranchId]);

    const allStockLines = React.useMemo(
        () => managerProducts.flatMap(getProductStockLines),
        [managerProducts]
    );

    const lowStockCount = allStockLines.filter(
        (line) => line.stock > 0 && line.stock <= line.alertLevel
    ).length;

    const outOfStockCount = allStockLines.filter(
        (line) => line.stock <= 0
    ).length;

    const expiringExpiredCount = allStockLines.filter((line) => {
        const days = getDaysUntilExpiration(line.expirationDate);
        return days !== null && days <= EXPIRING_SOON_DAYS;
    }).length;

    const reorderNeededCount = allStockLines.filter((line) => {
        const days = getDaysUntilExpiration(line.expirationDate);
        const isExpired = days !== null && days < 0;
        return !isExpired && line.stock <= line.alertLevel;
    }).length;

    const recentSales = React.useMemo(
        () => getRecentThirtyDaySales(salesOrders),
        [salesOrders]
    );

    const actionRows = React.useMemo(
        () => getActionCenterRows(managerProducts, recentSales),
        [managerProducts, recentSales]
    );

    const tableProducts = React.useMemo(() => {
        const base = (Array.isArray(inv.filteredProducts)
            ? inv.filteredProducts
            : managerProducts) as Product[];

        if (statusFilter === "All Status") return base;

        return base.filter((product) => getProductStatus(product) === statusFilter);
    }, [inv.filteredProducts, managerProducts, statusFilter]);

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[74px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                Inventory
                            </h1>

                            <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">
                                {branchBadge}
                            </span>
                        </div>

                        <p className="mt-0.5 text-xs text-[#766983]">
                            Operational view of stock control and replenishment.
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
                            onClick={() => window.location.reload()}
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <RefreshCw size={16} />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <main className="space-y-4 px-5 py-5 font-sans">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ManagerMetricCard
                        label="Low Stock Items"
                        value={lowStockCount}
                        helper="Items approaching shortage"
                        icon={<AlertTriangle size={20} />}
                        tone="amber"
                    />
                    <ManagerMetricCard
                        label="Out of Stock Items"
                        value={outOfStockCount}
                        helper="Items already unavailable"
                        icon={<Boxes size={20} />}
                        tone="red"
                    />
                    <ManagerMetricCard
                        label="Expiring / Expired"
                        value={expiringExpiredCount}
                        helper="Inventory requiring immediate handling"
                        icon={<CalendarClock size={20} />}
                        tone="purple"
                    />
                    <ManagerMetricCard
                        label="Reorder Needed"
                        value={reorderNeededCount}
                        helper="Products that should potentially be purchased"
                        icon={<ShoppingCart size={20} />}
                        tone="blue"
                    />
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
                    <StockActionCenter
                        rows={actionRows}
                        onEdit={inv.handleEditProduct}
                    />

                    <RecentStockActivity
                        movements={recentSales.movements.slice(0, 4)}
                        loading={salesLoading}
                    />
                </div>

                <ManagerSearchActions inv={inv} />

                <ManagerCategoryPills
                    categories={inv.categories}
                    selectedCategory={inv.selectedCategory}
                    setSelectedCategory={inv.setSelectedCategory}
                />

                <ManagerInventoryTable
                    products={tableProducts}
                    categories={inv.categories}
                    selectedCategory={inv.selectedCategory}
                    onCategoryChange={inv.setSelectedCategory}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    onEdit={inv.handleEditProduct}
                    onDelete={inv.requestDeleteProduct}
                />
            </main>

            <InventoryDialogs inv={inv} />
        </>
    );
}

function ManagerMetricCard({
                               label,
                               value,
                               helper,
                               icon,
                               tone,
                           }: {
    label: string;
    value: number;
    helper: string;
    icon: React.ReactNode;
    tone: "amber" | "red" | "purple" | "blue";
}) {
    const styles = {
        amber: {
            icon: "bg-[#FFF3DE] text-[#E68A00]",
            value: "text-[#D87B00]",
        },
        red: {
            icon: "bg-[#FFE8E8] text-[#E23B4A]",
            value: "text-[#D52035]",
        },
        purple: {
            icon: "bg-[#F1ECFF] text-[#5F35D8]",
            value: "text-[#4E2DB8]",
        },
        blue: {
            icon: "bg-[#E9F2FF] text-[#1E6FE8]",
            value: "text-[#1E6FE8]",
        },
    }[tone];

    return (
        <section className="rounded-[16px] border border-[#E7DFEC] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-[#21132E]">{label}</p>
                    <p className={`mt-2 text-[27px] font-bold leading-none ${styles.value}`}>
                        {formatNumber(value)}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-4 text-[#86778F]">
                        {helper}
                    </p>
                </div>

                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.icon}`}
                >
                    {icon}
                </span>
            </div>
        </section>
    );
}

function StockActionCenter({
                               rows,
                               onEdit,
                           }: {
    rows: ActionCenterRow[];
    onEdit: (product: Product) => void;
}) {
    return (
        <section className="overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                    <ClipboardList size={18} />
                </span>
                <div>
                    <h2 className="text-[15px] font-bold text-[#21132E]">
                        Stock Action Center
                    </h2>
                    <p className="mt-0.5 text-[11px] text-[#86778F]">
                        Items that need your attention and what action to take.
                    </p>
                </div>
            </div>

            {rows.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">
                    No stock action is currently required.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[690px] table-fixed text-[11px]">
                        <colgroup>
                            <col className="w-[28%]" />
                            <col className="w-[12%]" />
                            <col className="w-[12%]" />
                            <col className="w-[13%]" />
                            <col className="w-[16%]" />
                            <col className="w-[19%]" />
                        </colgroup>
                        <thead className="bg-[#FFFCF8]">
                        <tr className="border-b border-[#E9E1EE]">
                            <MiniHeader>Product</MiniHeader>
                            <MiniHeader center>Current Stock</MiniHeader>
                            <MiniHeader center>Reorder Level</MiniHeader>
                            <MiniHeader center>Sales Demand</MiniHeader>
                            <MiniHeader center>Issue</MiniHeader>
                            <MiniHeader center>Suggested Action</MiniHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((row) => (
                            <tr
                                key={row.id}
                                className="border-b border-[#EFE8F2] last:border-b-0"
                            >
                                <td className="px-4 py-2.5 font-semibold text-[#2B174C]">
                                    {row.productName}
                                </td>
                                <td className="px-2 py-2.5 text-center font-semibold text-[#4F3A5A]">
                                    {formatNumber(row.currentStock)}
                                </td>
                                <td className="px-2 py-2.5 text-center text-[#5F4E75]">
                                    {row.reorderLevel > 0
                                        ? formatNumber(row.reorderLevel)
                                        : "—"}
                                </td>
                                <td className="px-2 py-2.5 text-center font-medium text-[#2B174C]">
                                    {row.salesDemand}
                                </td>
                                <td className="px-2 py-2.5 text-center">
                                    <ActionIssueBadge issue={row.issue} />
                                </td>
                                <td className="px-2 py-2.5 text-center">
                                    <button
                                        type="button"
                                        onClick={() => onEdit(row.product)}
                                        className={[
                                            "inline-flex min-w-[108px] justify-center rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition",
                                            row.action === "Reorder Now"
                                                ? "border-[#5B31D4] bg-[#5B31D4] text-white hover:bg-[#4423A9]"
                                                : "border-[#D9CDF0] bg-[#F5F0FF] text-[#5330B6] hover:bg-[#ECE3FF]",
                                        ].join(" ")}
                                    >
                                        {row.action}
                                    </button>
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

function ActionIssueBadge({ issue }: { issue: ActionCenterRow["issue"] }) {
    const className =
        issue === "Out of Stock"
            ? "bg-[#FFE7EA] text-[#D92C3F]"
            : issue === "Low Stock"
                ? "bg-[#FFF2D3] text-[#C77A00]"
                : issue === "Slow Moving"
                    ? "bg-[#E8F2FF] text-[#3372BA]"
                    : issue === "Expired"
                        ? "bg-[#F4E9F8] text-[#8E4AA6]"
                        : "bg-[#EEE8FF] text-[#6944C9]";

    return (
        <span
            className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-semibold ${className}`}
        >
            {issue}
        </span>
    );
}

function RecentStockActivity({
                                 movements,
                                 loading,
                             }: {
    movements: SalesMovement[];
    loading: boolean;
}) {
    return (
        <section className="overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                    <CalendarClock size={18} />
                </span>
                <div>
                    <h2 className="text-[15px] font-bold text-[#21132E]">
                        Recent Stock Activity
                    </h2>
                    <p className="mt-0.5 text-[11px] text-[#86778F]">
                        Latest inventory movements recorded from POS sales.
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">
                    Loading recent stock activity...
                </div>
            ) : movements.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">
                    No recent stock movement data is available yet.
                </div>
            ) : (
                <table className="w-full table-fixed text-[11px]">
                    <colgroup>
                        <col className="w-[19%]" />
                        <col className="w-[31%]" />
                        <col className="w-[20%]" />
                        <col className="w-[12%]" />
                        <col className="w-[18%]" />
                    </colgroup>
                    <thead className="bg-[#FFFCF8]">
                    <tr className="border-b border-[#E9E1EE]">
                        <MiniHeader>Date</MiniHeader>
                        <MiniHeader>Product</MiniHeader>
                        <MiniHeader center>Movement</MiniHeader>
                        <MiniHeader center>Qty</MiniHeader>
                        <MiniHeader center>Source</MiniHeader>
                    </tr>
                    </thead>
                    <tbody>
                    {movements.map((movement, index) => (
                        <tr
                            key={`${movement.productId}-${movement.productName}-${index}`}
                            className="border-b border-[#EFE8F2] last:border-b-0"
                        >
                            <td className="px-3 py-2.5 text-[#4F3A5A]">
                                {movement.date
                                    ? movement.date.toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                    })
                                    : "—"}
                            </td>
                            <td className="px-3 py-2.5 font-medium text-[#2B174C]">
                                {movement.productName}
                            </td>
                            <td className="px-2 py-2.5 text-center">
                                    <span className="rounded-full bg-[#FFE7EA] px-3 py-1 text-[10px] font-semibold text-[#D92C3F]">
                                        Stock Out
                                    </span>
                            </td>
                            <td className="px-2 py-2.5 text-center font-semibold text-[#4F3A5A]">
                                -{formatNumber(movement.quantity)}
                            </td>
                            <td className="px-2 py-2.5 text-center text-[#5F4E75]">
                                {movement.source}
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function MiniHeader({
                        children,
                        center = false,
                    }: {
    children: React.ReactNode;
    center?: boolean;
}) {
    return (
        <th
            className={`px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[#806A8C] ${
                center ? "text-center" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function ManagerSearchActions({ inv }: { inv: InventoryController }) {
    return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div className="relative">
                <Search
                    size={16}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                />
                <input
                    value={inv.search}
                    onChange={(event) => inv.setSearch(event.target.value)}
                    placeholder="Search products, categories, or SKU..."
                    className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                />
            </div>

            <button
                type="button"
                onClick={inv.openImportDialog}
                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#E3D8EA] bg-white px-5 text-sm font-semibold text-[#2B174C] shadow-sm hover:bg-[#F8F3FC]"
            >
                <Upload size={16} />
                Upload File
            </button>

            <button
                type="button"
                onClick={inv.openManageCategories}
                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#E3D8EA] bg-white px-5 text-sm font-semibold text-[#2B174C] shadow-sm hover:bg-[#F8F3FC]"
            >
                <Settings2 size={16} />
                Manage Categories
            </button>

            <button
                type="button"
                onClick={inv.openAddProduct}
                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4A238B] to-[#6842E4] px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            >
                <Plus size={17} />
                Add Product
            </button>
        </div>
    );
}

function ManagerCategoryPills({
                                  categories,
                                  selectedCategory,
                                  setSelectedCategory,
                              }: {
    categories: string[];
    selectedCategory: string;
    setSelectedCategory: (value: string) => void;
}) {
    return (
        <div className="overflow-x-auto pb-1">
            <div className="flex w-max min-w-full items-center gap-2">
                <button
                    type="button"
                    onClick={() => setSelectedCategory("All")}
                    className={
                        selectedCategory === "All"
                            ? "rounded-full bg-[#5631C5] px-5 py-2 text-xs font-semibold text-white shadow-sm"
                            : "rounded-full border border-[#DED4E6] bg-white px-5 py-2 text-xs font-semibold text-[#5F4E75] hover:bg-[#F8F3FC]"
                    }
                >
                    All
                </button>

                {categories.map((category) => (
                    <button
                        key={category}
                        type="button"
                        onClick={() => setSelectedCategory(category)}
                        className={
                            selectedCategory === category
                                ? "rounded-full bg-[#5631C5] px-5 py-2 text-xs font-semibold text-white shadow-sm"
                                : "rounded-full border border-[#DED4E6] bg-white px-5 py-2 text-xs font-semibold text-[#5F4E75] hover:bg-[#F8F3FC]"
                        }
                    >
                        {category}
                    </button>
                ))}
            </div>
        </div>
    );
}

function ManagerInventoryTable({
                                   products,
                                   categories,
                                   selectedCategory,
                                   onCategoryChange,
                                   statusFilter,
                                   onStatusFilterChange,
                                   onEdit,
                                   onDelete,
                               }: {
    products: Product[];
    categories: string[];
    selectedCategory: string;
    onCategoryChange: (value: string) => void;
    statusFilter: string;
    onStatusFilterChange: (value: string) => void;
    onEdit: (product: Product) => void;
    onDelete: (product: Product) => void;
}) {
    const [expandedIds, setExpandedIds] = React.useState<Record<number, boolean>>(
        {}
    );

    return (
        <section className="overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#E9E1EE] px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                        <Boxes size={18} />
                    </span>
                    <div>
                        <h2 className="text-[15px] font-bold text-[#21132E]">
                            Branch Inventory List
                        </h2>
                        <p className="mt-0.5 text-[11px] text-[#86778F]">
                            Manage your product inventory, update stock levels, and take quick actions.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={selectedCategory}
                        onChange={(event) => onCategoryChange(event.target.value)}
                        className="h-9 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none"
                    >
                        <option value="All">All Categories</option>
                        {categories.map((category) => (
                            <option key={category} value={category}>
                                {category}
                            </option>
                        ))}
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(event) => onStatusFilterChange(event.target.value)}
                        className="h-9 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none"
                    >
                        <option>All Status</option>
                        <option>In Stock</option>
                        <option>Low Stock</option>
                        <option>Out of Stock</option>
                        <option>Expiring Soon</option>
                        <option>Expired</option>
                    </select>

                    <button
                        type="button"
                        onClick={() => exportManagerInventoryCsv(products)}
                        disabled={products.length === 0}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#D9CDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC] disabled:opacity-50"
                    >
                        <Download size={14} />
                        Export
                    </button>
                </div>
            </div>

            {products.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-[#8A7D90]">
                    No products found for the current filters.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1020px] table-fixed text-[11px]">
                        <colgroup>
                            <col className="w-[23%]" />
                            <col className="w-[14%]" />
                            <col className="w-[10%]" />
                            <col className="w-[10%]" />
                            <col className="w-[12%]" />
                            <col className="w-[12%]" />
                            <col className="w-[10%]" />
                            <col className="w-[9%]" />
                        </colgroup>
                        <thead className="bg-[#FFFCF8]">
                        <tr className="border-b border-[#E9E1EE]">
                            <MiniHeader>Product</MiniHeader>
                            <MiniHeader>Category</MiniHeader>
                            <MiniHeader center>Available Stock</MiniHeader>
                            <MiniHeader center>Reorder Level</MiniHeader>
                            <MiniHeader center>Last Restock</MiniHeader>
                            <MiniHeader center>Expiration</MiniHeader>
                            <MiniHeader center>Status</MiniHeader>
                            <MiniHeader center>Action</MiniHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {products.map((product) => {
                            const variants = Array.isArray(product.variants)
                                ? product.variants
                                : [];
                            const expandable = product.hasVariants && variants.length > 0;
                            const expanded = Boolean(expandedIds[product.id]);
                            const expiration = getProductExpiration(product);
                            const status = getProductStatus(product);

                            return (
                                <React.Fragment key={product.id}>
                                    <tr
                                        className={`border-b border-[#EFE8F2] ${
                                            expandable
                                                ? "cursor-pointer hover:bg-[#FFFCF8]"
                                                : ""
                                        }`}
                                        onClick={
                                            expandable
                                                ? () =>
                                                    setExpandedIds((current) => ({
                                                        ...current,
                                                        [product.id]: !current[product.id],
                                                    }))
                                                : undefined
                                        }
                                    >
                                        <td className="px-4 py-2.5 font-semibold text-[#2B174C]">
                                            <div className="flex items-center gap-2">
                                                {expandable ? (
                                                    <ChevronDown
                                                        size={13}
                                                        className={`shrink-0 transition ${
                                                            expanded ? "rotate-180" : ""
                                                        }`}
                                                    />
                                                ) : (
                                                    <span className="w-[13px]" />
                                                )}
                                                <span>{product.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-[#5F4E75]">
                                            {product.category || "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-semibold text-[#2B174C]">
                                            {formatNumber(getProductTotalStock(product))}
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-[#5F4E75]">
                                            {formatNumber(getProductReorderLevel(product))}
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-[#5F4E75]">
                                            {formatDate(getProductLastRestock(product))}
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-[#5F4E75]">
                                            {expiration
                                                ? formatDate(expiration.toISOString())
                                                : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <ManagerStatusBadge status={status} />
                                        </td>
                                        <td className="px-2 py-2.5 text-center">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onEdit(product);
                                                    }}
                                                    className="inline-flex items-center gap-1 rounded-lg bg-[#F1EBFF] px-2.5 py-1.5 text-[10px] font-semibold text-[#5734B3] hover:bg-[#E7DCFF]"
                                                >
                                                    <Pencil size={11} />
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onDelete(product);
                                                    }}
                                                    className="inline-flex items-center gap-1 rounded-lg bg-[#FFF0F0] px-2.5 py-1.5 text-[10px] font-semibold text-[#D83A45] hover:bg-[#FFE2E2]"
                                                >
                                                    <Trash2 size={11} />
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>

                                    {expandable &&
                                        expanded &&
                                        variants.map((variant) => {
                                            const line: ManagerStockLine = {
                                                id: `${product.id}-${variant.id}`,
                                                product,
                                                productName: product.name,
                                                category: product.category,
                                                variantName: getVariantName(variant),
                                                stock: Number(variant.stock || 0),
                                                alertLevel: Number(
                                                    variant.alertLevel || 0
                                                ),
                                                expirationDate:
                                                variant.expirationDate,
                                                costPrice: Number(
                                                    variant.originalPrice || 0
                                                ),
                                            };

                                            return (
                                                <tr
                                                    key={variant.id}
                                                    className="border-b border-[#EFE8F2] bg-[#FCF9FF]"
                                                >
                                                    <td className="px-4 py-2.5 pl-10 text-[10px] font-semibold text-[#5F3D82]">
                                                        ↳ {getVariantName(variant)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-[#8A7D90]">
                                                        Variant
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center font-semibold text-[#2B174C]">
                                                        {formatNumber(variant.stock)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center text-[#5F4E75]">
                                                        {formatNumber(variant.alertLevel)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center text-[#8A7D90]">
                                                        —
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center text-[#5F4E75]">
                                                        {formatDate(
                                                            variant.expirationDate
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <ManagerStatusBadge
                                                            status={getLineStatus(line)}
                                                        />
                                                    </td>
                                                    <td className="px-2 py-2.5" />
                                                </tr>
                                            );
                                        })}
                                </React.Fragment>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function ManagerStatusBadge({ status }: { status: ManagerInventoryStatus }) {
    const className =
        status === "In Stock"
            ? "bg-[#E5F8EC] text-[#23834A]"
            : status === "Low Stock"
                ? "bg-[#FFF2D3] text-[#C77A00]"
                : status === "Out of Stock"
                    ? "bg-[#FFE7EA] text-[#D92C3F]"
                    : status === "Expiring Soon"
                        ? "bg-[#EEE8FF] text-[#6944C9]"
                        : "bg-[#F4E9F8] text-[#8E4AA6]";

    return (
        <span
            className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-semibold ${className}`}
        >
            {status}
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/*                   DIALOGS / FORMS — KEPT IN THIS FILE                     */
/* -------------------------------------------------------------------------- */

type SuccessToastMessage = {
    title: string;
    message: string;
};

type ProductSuccessAction = "add" | "update";

function SuccessToast({
                          toast,
                          onClose,
                      }: {
    toast: SuccessToastMessage | null;
    onClose: () => void;
}) {
    const [isFadingOut, setIsFadingOut] = React.useState(false);

    React.useEffect(() => {
        if (!toast) {
            setIsFadingOut(false);
            return;
        }

        setIsFadingOut(false);

        const fadeTimer = window.setTimeout(() => {
            setIsFadingOut(true);
        }, 5000);

        const closeTimer = window.setTimeout(() => {
            onClose();
        }, 5600);

        return () => {
            window.clearTimeout(fadeTimer);
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
            className={[
                "fixed bottom-5 right-5 z-[140] flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl border border-[#BCE8CA] bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)] transition-all duration-700 ease-out",
                isFadingOut
                    ? "translate-y-3 opacity-0"
                    : "translate-y-0 opacity-100",
            ].join(" ")}
        >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E5F8EC] text-[#23834A]">
                <CheckCircle2 size={20} strokeWidth={2.4} />
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1A1220]">{toast.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-[#6A5D6F]">{toast.message}</p>
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


export function InventoryDialogs({ inv }: { inv: InventoryController }) {
    const [pendingProductSuccess, setPendingProductSuccess] = React.useState<{
        action: ProductSuccessAction;
        name: string;
    } | null>(null);
    const [pendingDeletedProductName, setPendingDeletedProductName] =
        React.useState("");
    const [productToast, setProductToast] =
        React.useState<SuccessToastMessage | null>(null);
    const [productExpirationDate, setProductExpirationDate] =
        React.useState("");
    const [variantExpirationDates, setVariantExpirationDates] =
        React.useState<string[]>([]);

    React.useEffect(() => {
        if (!inv.showForm || inv.formMode !== "product") return;

        if (!inv.editingId) {
            setProductExpirationDate("");
            setVariantExpirationDates([]);
            return;
        }

        const availableProducts = [
            ...(Array.isArray(inv.products) ? inv.products : []),
            ...(Array.isArray(inv.baseProducts) ? inv.baseProducts : []),
        ];

        const editingProduct = availableProducts.find(
            (product) => Number(product.id) === Number(inv.editingId)
        ) as Product | undefined;

        setProductExpirationDate(
            formatExpirationDateInput(editingProduct?.expirationDate)
        );
        setVariantExpirationDates(
            (editingProduct?.variants || []).map((variant) =>
                formatExpirationDateInput(variant.expirationDate)
            )
        );
    }, [
        inv.baseProducts,
        inv.editingId,
        inv.formMode,
        inv.products,
        inv.showForm,
    ]);

    const closeProductToast = React.useCallback(() => {
        setProductToast(null);
    }, []);

    const closeConfirmProductSaveDialog = React.useCallback(() => {
        setPendingProductSuccess(null);
        inv.closeConfirmProductSaveDialog();
    }, [inv]);

    const confirmSaveProduct = React.useCallback(async () => {
        const pendingSave = inv.pendingProductSave;

        if (!pendingSave) {
            return;
        }

        const currentSaveData =
            pendingSave.mode === "edit"
                ? pendingSave.after
                : pendingSave.data;

        const saveData: ProductSaveData = currentSaveData.hasVariants
            ? {
                ...currentSaveData,
                expirationDate: null,
                variants: (currentSaveData.variants || []).map(
                    (variant, index) => ({
                        ...variant,
                        expirationDate:
                            variantExpirationDates[index] || null,
                    })
                ),
            }
            : {
                ...currentSaveData,
                expirationDate:
                    productExpirationDate || null,
            };

        const productName = saveData.name.trim();

        setPendingProductSuccess({
            action: pendingSave.mode === "edit" ? "update" : "add",
            name: productName,
        });

        await inv.confirmSaveProduct(saveData);
    }, [
        inv,
        productExpirationDate,
        variantExpirationDates,
    ]);

    const confirmDeleteProduct = React.useCallback(async () => {
        const productName = inv.productToDelete?.name.trim() || "";

        if (!productName) {
            return;
        }

        setPendingDeletedProductName(productName);
        await inv.confirmDeleteProduct();
    }, [inv]);

    React.useEffect(() => {
        if (!pendingProductSuccess || inv.showConfirmProductSaveDialog) {
            return;
        }

        const isUpdate = pendingProductSuccess.action === "update";

        setProductToast({
            title: isUpdate
                ? "Product updated successfully"
                : "Product added successfully",
            message: isUpdate
                ? `“${pendingProductSuccess.name}” was updated in inventory.`
                : `“${pendingProductSuccess.name}” was added to inventory.`,
        });
        setPendingProductSuccess(null);
    }, [inv.showConfirmProductSaveDialog, pendingProductSuccess]);

    React.useEffect(() => {
        if (
            !pendingDeletedProductName ||
            inv.showDeleteProductDialog ||
            inv.productToDelete
        ) {
            return;
        }

        setProductToast({
            title: "Product deleted successfully",
            message: `“${pendingDeletedProductName}” was removed from inventory.`,
        });
        setPendingDeletedProductName("");
    }, [
        inv.productToDelete,
        inv.showDeleteProductDialog,
        pendingDeletedProductName,
    ]);

    const productSaveTitle =
        inv.pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";
    const productSaveButton =
        inv.pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";

    return (
        <>
            <SuccessToast toast={productToast} onClose={closeProductToast} />
            {inv.showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div
                        className={[
                            "w-full rounded-2xl bg-white p-5 shadow-xl sm:p-6",
                            inv.formMode === "category"
                                ? "h-140 max-h-[88vh] max-w-5xl overflow-hidden"
                                : "max-h-[90vh] max-w-5xl overflow-y-auto",
                        ].join(" ")}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-[18px] font-bold text-[#1A1220]">
                                {inv.formMode === "category"
                                    ? "Manage Categories"
                                    : inv.editingId
                                        ? "Edit Product"
                                        : "Add Product"}
                            </h2>
                            <button
                                type="button"
                                onClick={() => inv.setShowForm(false)}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <form
                            onSubmit={(e) => {
                                if (inv.formMode === "product") inv.handleSubmitProduct(e);
                                else e.preventDefault();
                            }}
                            className={
                                inv.formMode === "category"
                                    ? "h-[calc(100%-44px)]"
                                    : "space-y-3"
                            }
                        >
                            {inv.formMode === "category" ? (
                                <CategoryForm inv={inv} />
                            ) : (
                                <ProductForm
                                    inv={inv}
                                    productExpirationDate={
                                        productExpirationDate
                                    }
                                    setProductExpirationDate={
                                        setProductExpirationDate
                                    }
                                    variantExpirationDates={
                                        variantExpirationDates
                                    }
                                    setVariantExpirationDates={
                                        setVariantExpirationDates
                                    }
                                />
                            )}
                        </form>
                    </div>
                </div>
            )}

            {inv.showConfirmProductSaveDialog && inv.pendingProductSave && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="mb-3 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">
                                    {productSaveTitle}
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    Are you sure you want to save this product?
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeConfirmProductSaveDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeConfirmProductSaveDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmSaveProduct()}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                {productSaveButton}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {inv.showImportDialog && (
                <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">
                                    Upload Inventory File
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    Select an Excel or CSV file. Products will not be added yet.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                inv.setSelectedImportFile(e.target.files?.[0] || null)
                            }
                            className="w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] file:mr-4 file:rounded-lg file:border-0 file:bg-[#2B174C] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                        />

                        {inv.selectedImportFile && (
                            <p className="mt-2 text-xs text-[#6A5D6F]">
                                Selected:{" "}
                                <span className="font-semibold text-[#1A1220]">
                                    {inv.selectedImportFile.name}
                                </span>
                            </p>
                        )}

                        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <a
                                href="/templates/StockNBook_Inventory_Import_Template.xlsx"
                                download="StockNBook_Inventory_Import_Template.xlsx"
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#CDB9E1] bg-[#F7F1FF] px-4 py-2 text-sm font-semibold text-[#2B174C] transition hover:bg-[#EFE5FA]"
                            >
                                <Download size={15} />
                                Download Format
                            </a>

                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={inv.closeImportDialog}
                                    className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    disabled={inv.isImporting || !inv.selectedImportFile}
                                    onClick={() => void inv.importProductsFromExcel()}
                                    className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {inv.isImporting ? "Reading..." : "Preview Import"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {inv.showImportConfirmDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">
                                    Confirm Imported Products
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    Review the products below before adding them to the system.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-[#E6DDF0]">
                            <table className="w-full min-w-245 text-sm">
                                <thead>
                                <tr className="border-b border-[#E6DDF0] bg-[#FFFCF7]">
                                    {[
                                        "Product",
                                        "Category",
                                        "Stock",
                                        "Alert",
                                        "Cost Price",
                                        "Selling Price",
                                        "Type",
                                    ].map((head) => (
                                        <th
                                            key={head}
                                            className={`${head === "Product" ? "text-left" : "text-center"} px-1 pb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]`}                                        >
                                            {head}
                                        </th>
                                    ))}
                                </tr>
                                </thead>

                                <tbody>
                                {inv.importPreviewProducts.map((product) => {
                                    const variants = product.variants || [];

                                    return (
                                        <React.Fragment key={product.tempId}>
                                            <tr className="border-b border-[#EFE7F4]">
                                                <td className="px-3 py-4">
                                                    <p className="text-sm font-semibold text-[#1A1220]">
                                                        {product.name || "Unnamed Product"}
                                                    </p>
                                                    {product.hasVariants && (
                                                        <p className="mt-1 text-xs font-medium text-[#806A8C]">
                                                            {variants.length} variant{variants.length !== 1 ? "s" : ""}
                                                        </p>
                                                    )}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#6A5D6F]">
                                                    {product.category || "Uncategorized"}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#1A1220]">
                                                    {Number(product.stock || 0)}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#6A5D6F]">
                                                    {Number(product.alertLevel || 0)}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#6A5D6F]">
                                                    {money(Number(product.originalPrice || 0))}
                                                </td>

                                                <td className="px-3 py-4 text-center font-semibold text-[#1A1220]">
                                                    {money(Number(product.salesPrice || 0))}
                                                </td>

                                                <td className="px-3 py-4 text-center">
                                                    <span className="rounded-full bg-[#F7F1FF] px-3 py-1 text-xs font-semibold text-[#4E2C66]">
                                                        {product.hasVariants ? "With Variants" : "Regular"}
                                                    </span>
                                                </td>
                                            </tr>

                                            {product.hasVariants && variants.map((variant, variantIndex) => {
                                                const variantName = Object.values(variant.variantValues || {})
                                                    .filter(Boolean)
                                                    .join(" / ") || `Variant ${variantIndex + 1}`;

                                                return (
                                                    <tr
                                                        key={`${product.tempId}-variant-${variantIndex}`}
                                                        className="border-b border-[#EFE7F4] bg-[#FFFCF7] last:border-0"
                                                    >
                                                        <td className="px-3 py-3">
                                                            <div className="ml-6 rounded-xl bg-white px-3 py-2 ring-1 ring-[#E6DDF0]">
                                                                <p className="text-sm font-semibold text-[#2B174C]">
                                                                    {variantName}
                                                                </p>
                                                            </div>
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#9B8AAA]">
                                                            Variant
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#1A1220]">
                                                            {Number(variant.stock || 0)}
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#6A5D6F]">
                                                            {Number(variant.alertLevel || 0)}
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#6A5D6F]">
                                                            {money(Number(variant.originalPrice || 0))}
                                                        </td>

                                                        <td className="px-3 py-3 text-center font-semibold text-[#1A1220]">
                                                            {money(Number(variant.salesPrice || 0))}
                                                        </td>

                                                        <td className="px-3 py-3 text-center">
                                                            <span className="rounded-full bg-[#F7F1FF] px-3 py-1 text-xs font-semibold text-[#4E2C66]">
                                                                Variant
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    inv.setShowImportConfirmDialog(false);
                                    inv.setShowImportDialog(true);
                                }}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Back
                            </button>

                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                disabled={inv.isImporting || inv.importPreviewProducts.length === 0}
                                onClick={() => void inv.confirmImportProducts()}
                                className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {inv.isImporting ? "Importing..." : "Confirm Import"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {inv.showDeleteProductDialog && inv.productToDelete && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Delete Product
                        </h3>
                        <p className="mt-1 text-sm text-[#6A5D6F]">
                            Are you sure you want to delete{" "}
                            <span className="font-semibold">
                                {inv.productToDelete.name}
                            </span>
                            ?
                        </p>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={inv.closeDeleteProductDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmDeleteProduct()}
                                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                            >
                                Delete Product
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function CategoryForm({ inv }: { inv: InventoryController }) {
    const [showAddCategoryDialog, setShowAddCategoryDialog] = React.useState(false);
    const [categoryToAdd, setCategoryToAdd] = React.useState("");
    const [pendingAddedCategoryName, setPendingAddedCategoryName] =
        React.useState("");
    const [categoryToast, setCategoryToast] =
        React.useState<SuccessToastMessage | null>(null);

    const closeCategoryToast = React.useCallback(() => {
        setCategoryToast(null);
    }, []);

    React.useEffect(() => {
        if (!pendingAddedCategoryName) {
            return;
        }

        const categoryWasSaved = inv.categories.some(
            (category) =>
                normalizeLookupText(category) ===
                normalizeLookupText(pendingAddedCategoryName)
        );

        if (categoryWasSaved && !inv.category.trim()) {
            setCategoryToast({
                title: "Category added successfully",
                message: `“${pendingAddedCategoryName}” is now available for inventory products.`,
            });
            setPendingAddedCategoryName("");
        }
    }, [inv.categories, inv.category, pendingAddedCategoryName]);

    const [showEditCategoryDialog, setShowEditCategoryDialog] =
        React.useState(false);
    const [showConfirmEditCategoryDialog, setShowConfirmEditCategoryDialog] =
        React.useState(false);

    const [showDeleteCategoryDialog, setShowDeleteCategoryDialog] =
        React.useState(false);
    const [showCannotDeleteCategoryDialog, setShowCannotDeleteCategoryDialog] =
        React.useState(false);

    const [categoryToEdit, setCategoryToEdit] = React.useState("");
    const [editCategoryDraft, setEditCategoryDraft] = React.useState("");

    const [categoryToDelete, setCategoryToDelete] = React.useState("");

    const openEditCategoryDialog = (category: string) => {
        setCategoryToEdit(category);
        setEditCategoryDraft(category);
        setShowEditCategoryDialog(true);
        setShowConfirmEditCategoryDialog(false);
    };

    const closeEditCategoryDialog = () => {
        setShowEditCategoryDialog(false);
        setShowConfirmEditCategoryDialog(false);
        setCategoryToEdit("");
        setEditCategoryDraft("");
    };

    const openConfirmEditCategoryDialog = () => {
        const cleanValue = editCategoryDraft.trim();

        if (!cleanValue) {
            alert("❌ Please enter a category name.");
            return;
        }

        if (cleanValue === categoryToEdit) {
            alert("No changes made.");
            return;
        }

        setShowEditCategoryDialog(false);
        setShowConfirmEditCategoryDialog(true);
    };

    const confirmEditCategory = async () => {
        await inv.updateCategoryNow(categoryToEdit, editCategoryDraft.trim());
        closeEditCategoryDialog();
    };

    const openAddCategoryDialog = () => {
        const cleanValue = inv.category.trim();

        if (!cleanValue) {
            alert("❌ Please enter a category name.");
            return;
        }

        setCategoryToAdd(cleanValue);
        setShowAddCategoryDialog(true);
    };

    const closeAddCategoryDialog = () => {
        setShowAddCategoryDialog(false);
        setCategoryToAdd("");
    };

    const confirmAddCategory = async () => {
        if (!categoryToAdd) return;

        setPendingAddedCategoryName(categoryToAdd);
        await inv.addCategoryNow(categoryToAdd);
        closeAddCategoryDialog();
    };

    const openDeleteCategoryDialog = (category: string) => {
        const hasProducts = inv.products.some((product) => product.category === category);

        setCategoryToDelete(category);

        if (hasProducts) {
            setShowCannotDeleteCategoryDialog(true);
            return;
        }

        setShowDeleteCategoryDialog(true);
    };

    const closeDeleteCategoryDialog = () => {
        setShowDeleteCategoryDialog(false);
        setShowCannotDeleteCategoryDialog(false);
        setCategoryToDelete("");
    };

    const confirmDeleteCategory = async () => {
        if (!categoryToDelete) return;

        await inv.deleteCategoryNow(categoryToDelete);
        closeDeleteCategoryDialog();
    };

    return (
        <>
            <SuccessToast toast={categoryToast} onClose={closeCategoryToast} />

            {showAddCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Add Category
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            Are you sure you want to add{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToAdd}
                            </span>
                            ?
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeAddCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void confirmAddCategory()}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Add Category
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[#E6DDF0] bg-[#FFFCF7] p-4">
                    <div>
                        <p className="text-sm font-semibold text-[#1A1220]">
                            Add New Category
                        </p>
                        <p className="mt-1 text-xs text-[#9B8AAA]">
                            Type a category name, then click Add.
                        </p>
                    </div>

                    <div className="mt-5 space-y-1">
                        <label className={labelClass}>Category Name</label>
                        <input
                            value={inv.category}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                inv.setCategory(e.target.value)
                            }
                            placeholder="Type to search or add new..."
                            className={fieldClass}
                        />
                    </div>

                    <button
                        type="button"
                        onClick={openAddCategoryDialog}
                        className="mt-3 w-full rounded-xl bg-[#2B174C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                    >
                        Add Category
                    </button>
                </div>

                <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[#E6DDF0] bg-white p-4">
                    <div className="mb-3 shrink-0">
                        <p className="text-sm font-semibold text-[#1A1220]">
                            Existing Categories
                        </p>
                        <p className="text-xs text-[#9B8AAA]">
                            {inv.filteredCategoriesForManage.length} shown
                        </p>
                    </div>

                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
                        {inv.filteredCategoriesForManage.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] p-4 text-sm text-[#9B8AAA]">
                                No matching categories.
                            </p>
                        ) : (
                            inv.filteredCategoriesForManage.map((c: string) => (
                                <CategoryRow
                                    key={c}
                                    category={c}
                                    onEdit={() => openEditCategoryDialog(c)}
                                    onDelete={() => openDeleteCategoryDialog(c)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {showEditCategoryDialog && (
                <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[18px] font-bold text-[#1A1220]">
                                    Edit Category
                                </h3>
                                <p className="mt-1 text-xs text-[#8A7A91]">
                                    Change the category name below.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={closeEditCategoryDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-1">
                            <label className={labelClass}>Category Name</label>
                            <input
                                value={editCategoryDraft}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setEditCategoryDraft(e.target.value)
                                }
                                className={fieldClass}
                                autoFocus
                            />
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeEditCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={openConfirmEditCategoryDialog}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showConfirmEditCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Confirm Category Update
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            Are you sure you want to change{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToEdit}
                            </span>{" "}
                            to{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {editCategoryDraft.trim()}
                            </span>
                            ?
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowConfirmEditCategoryDialog(false);
                                    setShowEditCategoryDialog(true);
                                }}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Back
                            </button>

                            <button
                                type="button"
                                onClick={closeEditCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void confirmEditCategory()}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCannotDeleteCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Cannot Delete Category
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            You cannot delete{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToDelete}
                            </span>{" "}
                            because there are products using this category.
                        </p>

                        <p className="mt-2 text-xs text-[#9B8AAA]">
                            Move or edit those products to another category first, then try
                            deleting again.
                        </p>

                        <div className="mt-5 flex justify-end">
                            <button
                                type="button"
                                onClick={closeDeleteCategoryDialog}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Okay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Delete Category
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            Are you sure you want to delete{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToDelete}
                            </span>
                            ?
                        </p>

                        <p className="mt-2 text-xs text-[#9B8AAA]">
                            This action cannot be undone.
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeDeleteCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void confirmDeleteCategory()}
                                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                            >
                                Delete Category
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function CategoryRow({
                         category,
                         onEdit,
                         onDelete,
                     }: {
    category: string;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-xl bg-[#F8F2EA] p-2 text-[#1A1220]">
            <span className="text-sm font-medium">{category}</span>

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onEdit}
                    className="text-xs font-semibold text-[#2B174C] hover:underline"
                >
                    Edit
                </button>

                <button
                    type="button"
                    onClick={onDelete}
                    className="text-xs font-semibold text-red-500 hover:underline"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

function ProductForm({
                         inv,
                         productExpirationDate,
                         setProductExpirationDate,
                         variantExpirationDates,
                         setVariantExpirationDates,
                     }: {
    inv: InventoryController;
    productExpirationDate: string;
    setProductExpirationDate: (value: string) => void;
    variantExpirationDates: string[];
    setVariantExpirationDates: React.Dispatch<
        React.SetStateAction<string[]>
    >;
}) {
    return (
        <>
            {inv.isOwner && (
                <div className="space-y-1">
                    <label className={labelClass}>Branch</label>
                    <select
                        value={inv.productBranchId}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                            inv.setProductBranchId(e.target.value)
                        }
                        className={fieldClass}
                    >
                        <option value="">Select branch</option>
                        {inv.branches.map((b: Branch) => (
                            <option key={b.id} value={b.id}>
                                {b.branchName}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {inv.isBranchUser && (
                <div className="rounded-xl bg-[#F7F1FF] px-3 py-2 text-xs font-medium text-[#4E2C66]">
                    Branch: {inv.assignedBranchName || "Assigned Branch"}
                </div>
            )}

            <div className="space-y-1">
                <label className={labelClass}>Product Name</label>
                <input
                    value={inv.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        inv.setName(e.target.value)
                    }
                    className={fieldClass}
                />
            </div>

            <div className="space-y-1">
                <label className={labelClass}>Category</label>
                <select
                    value={inv.category}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        inv.setCategory(e.target.value)
                    }
                    className={fieldClass}
                >
                    <option value="">Select category</option>
                    {inv.categories.map((c: string) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>
            </div>

            <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-[#1A1220]">
                            Product Variants
                        </p>
                        <p className="mt-0.5 text-xs text-[#9B8AAA]">
                            Enable if product has different variations like color, size,
                            packaging, etc.
                        </p>
                    </div>

                    {inv.hasVariants && (
                        <span className="rounded-full bg-[#2B174C] px-3 py-1 text-[11px] font-semibold text-white">
                            Enabled
                        </span>
                    )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[#2B174C]">
                        Product has variants
                    </span>

                    <VariantToggle
                        checked={inv.hasVariants}
                        onChange={inv.setHasVariants}
                    />
                </div>
            </div>

            {inv.hasVariants ? (
                <VariantEditor
                    inv={inv as VariantEditorController}
                    variantExpirationDates={variantExpirationDates}
                    setVariantExpirationDates={
                        setVariantExpirationDates
                    }
                />
            ) : (
                <>
                    <div className="space-y-1">
                        <label className={labelClass}>
                            Expiration Date (Optional)
                        </label>
                        <input
                            type="date"
                            value={productExpirationDate}
                            onChange={(
                                e: React.ChangeEvent<HTMLInputElement>
                            ) =>
                                setProductExpirationDate(
                                    e.target.value
                                )
                            }
                            className={fieldClass}
                        />
                        <p className="text-[11px] text-[#9B8AAA]">
                            Leave blank when the product has no expiration date.
                        </p>
                    </div>

                    <SimpleProductFields inv={inv} />
                </>
            )}

            <button
                type="submit"
                className="w-full rounded-xl bg-[#2B174C] py-3 text-sm font-semibold text-white transition hover:bg-[#1B0D31]"
            >
                Save Product
            </button>
        </>
    );
}


function SimpleProductFields({ inv }: { inv: InventoryController }) {
    return (
        <>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className={labelClass}>Stock</label>
                    <input
                        type="number"
                        value={inv.stock}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            inv.setStock(e.target.value)
                        }
                        className={fieldClass}
                    />
                </div>

                <div className="space-y-1">
                    <label className={labelClass}>Alert Level</label>
                    <input
                        type="number"
                        value={inv.alertLevel}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            inv.setAlertLevel(e.target.value)
                        }
                        className={fieldClass}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className={labelClass}>Cost Price</label>
                    <PesoPriceInput
                        value={inv.originalPrice}
                        onChange={(value) => inv.setOriginalPrice(value)}
                    />
                </div>

                <div className="space-y-1">
                    <label className={labelClass}>Selling Price</label>
                    <PesoPriceInput
                        value={inv.salesPrice}
                        onChange={(value) => inv.setSalesPrice(value)}
                    />
                </div>
            </div>
        </>
    );
}

function VariantEditor({
                           inv,
                           variantExpirationDates,
                           setVariantExpirationDates,
                       }: {
    inv: VariantEditorController;
    variantExpirationDates: string[];
    setVariantExpirationDates: React.Dispatch<
        React.SetStateAction<string[]>
    >;
}) {
    const [variantColumnInput, setVariantColumnInput] = React.useState("");
    const [variantColumns, setVariantColumns] = React.useState<string[]>([]);
    const hasAddedInitialRow = React.useRef(false);
    const lastEditorKey = React.useRef<string | null>(null);

    const variants = React.useMemo<ProductVariantSave[]>(() => {
        return Array.isArray(inv.variants) ? inv.variants : [];
    }, [inv.variants]);

    const compactVariantFieldClass =
        "h-10 w-full min-w-0 rounded-lg border border-[#E3D8EA] bg-white px-3 py-2 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]";

    React.useEffect(() => {
        setVariantExpirationDates((currentDates) =>
            variants.map(
                (variant, index) =>
                    currentDates[index] ??
                    String(variant.expirationDate || "")
            )
        );
    }, [
        setVariantExpirationDates,
        variants,
        variants.length,
    ]);

    const getColumnsFromVariants = React.useCallback(
        (rows: ProductVariantSave[]) => {
            const columns: string[] = [];

            rows.forEach((variant) => {
                Object.entries(variant.variantValues || {}).forEach(([key, value]) => {
                    const cleanKey = String(key || "").trim();
                    const cleanValue = String(value || "").trim();

                    if (!cleanKey || !cleanValue) return;

                    const alreadyExists = columns.some(
                        (column) => column.toLowerCase() === cleanKey.toLowerCase()
                    );

                    if (!alreadyExists) {
                        columns.push(cleanKey.toLowerCase());
                    }
                });
            });

            return columns;
        },
        []
    );

    const getVariantInputValue = (
        values: Record<string, string> | undefined,
        column: string
    ) => {
        if (!values) return "";

        const directValue = values[column];

        if (directValue !== undefined && directValue !== null) {
            return String(directValue);
        }

        const matchedKey = Object.keys(values).find(
            (key) => key.toLowerCase() === column.toLowerCase()
        );

        return matchedKey ? String(values[matchedKey] || "") : "";
    };

    const variantKeySignature = React.useMemo(
        () =>
            variants
                .map((variant) =>
                    Object.keys(variant.variantValues || {})
                        .map((key) => String(key || "").trim().toLowerCase())
                        .filter(Boolean)
                        .sort((a, b) => a.localeCompare(b))
                        .join("|")
                )
                .join("||"),
        [variants]
    );

    React.useEffect(() => {
        const editorKey = `${inv.editingId ?? "new"}-${
            inv.hasVariants ? "variants" : "simple"
        }`;

        if (lastEditorKey.current !== editorKey) {
            lastEditorKey.current = editorKey;
            hasAddedInitialRow.current = variants.length > 0;

            const inferredColumns = getColumnsFromVariants(variants);
            setVariantColumns(inferredColumns);
            return;
        }

        if (variants.length > 0) {
            const inferredColumns = getColumnsFromVariants(variants);

            if (inferredColumns.length === 0) return;

            setVariantColumns((prev) => {
                const merged = [...prev];

                inferredColumns.forEach((column) => {
                    const alreadyExists = merged.some(
                        (item) => item.toLowerCase() === column.toLowerCase()
                    );

                    if (!alreadyExists) {
                        merged.push(column);
                    }
                });

                return merged;
            });
        }
    }, [
        getColumnsFromVariants,
        inv.editingId,
        inv.hasVariants,
        variantKeySignature,
        variants,
        variants.length,
    ]);

    React.useEffect(() => {
        if (!hasAddedInitialRow.current && variants.length === 0) {
            hasAddedInitialRow.current = true;
            inv.addVariantRow();
        }
    }, [inv, variants.length]);

    const addVariantColumn = () => {
        const nextColumn = variantColumnInput.trim();

        if (!nextColumn) return;

        const normalizedNextColumn = nextColumn.toLowerCase();

        const alreadyExists = variantColumns.some(
            (col) => col.toLowerCase() === normalizedNextColumn
        );

        if (alreadyExists) {
            setVariantColumnInput("");
            return;
        }

        setVariantColumns((prev) => [...prev, normalizedNextColumn]);
        setVariantColumnInput("");
    };

    const removeVariantColumn = (columnToRemove: string) => {
        setVariantColumns((prev) =>
            prev.filter(
                (col) => col.toLowerCase() !== columnToRemove.toLowerCase()
            )
        );

        variants.forEach((_variant, index) => {
            inv.updateVariantValue(index, columnToRemove, "");
        });
    };

    return (
        <div className="rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm">
            <div>
                <p className="text-sm font-semibold text-[#1A1220]">
                    Variant Matrix
                </p>
                <p className="text-xs text-[#9B8AAA]">
                    Add columns like Color, Size, Packaging, etc.
                </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px]">
                <input
                    value={variantColumnInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setVariantColumnInput(e.target.value)
                    }
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addVariantColumn();
                        }
                    }}
                    className={fieldClass}
                    placeholder="Variant column name"
                />

                <button
                    type="button"
                    onClick={addVariantColumn}
                    className="rounded-xl bg-[#2B174C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                >
                    Add Column
                </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="flex w-max gap-2 pb-1">
                        {variantColumns.length === 0 ? (
                            <p className="text-xs font-semibold text-red-500">
                                No variant column yet. Add something like color, size, or packaging.
                            </p>
                        ) : (
                            variantColumns.map((col: string) => (
                                <div
                                    key={col}
                                    className="flex shrink-0 items-center gap-2 rounded-full bg-[#F7F1FF] px-4 py-2 text-xs font-semibold text-[#2B174C]"
                                >
                                    <span>{col}</span>

                                    <button
                                        type="button"
                                        onClick={() => removeVariantColumn(col)}
                                        className="flex h-4 w-4 items-center justify-center rounded-full text-[12px] font-bold text-[#2B174C] hover:bg-[#E6DDF0]"
                                        aria-label={`Remove ${col} column`}
                                        title={`Remove ${col}`}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        inv.addVariantRow();
                        setVariantExpirationDates((currentDates) => [
                            ...currentDates,
                            "",
                        ]);
                    }}
                    className="shrink-0 rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"
                >
                    + Add Variant
                </button>
            </div>

            <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[900px] table-fixed text-sm">
                    <thead>
                    <tr className="border-b border-[#E6DDF0]">
                        {variantColumns.map((col: string) => (
                            <th
                                key={col}
                                className="pb-2 pr-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]"
                            >
                                {col}
                            </th>
                        ))}

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Stocks
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Alert
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Cost Price
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Selling Price
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Expiration Date
                        </th>

                        <th className="pb-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Action
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {variants.map((variant: ProductVariantSave, index: number) => (
                        <tr key={index} className="border-b border-[#EFE7F4]">
                            {variantColumns.map((col: string) => (
                                <td key={col} className="py-1.5 pr-1.5">
                                    <input
                                        className={compactVariantFieldClass}
                                        value={getVariantInputValue(
                                            variant.variantValues,
                                            col
                                        )}
                                        placeholder={`Enter ${col}`}
                                        onChange={(
                                            e: React.ChangeEvent<HTMLInputElement>
                                        ) =>
                                            inv.updateVariantValue(
                                                index,
                                                col,
                                                e.target.value
                                            )
                                        }
                                    />
                                </td>
                            ))}

                            <td className="py-1.5 pr-1.5">
                                <input
                                    type="number"
                                    className={compactVariantFieldClass}
                                    value={variant.stock}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        inv.updateVariantField(
                                            index,
                                            "stock",
                                            e.target.value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-1.5 pr-1.5">
                                <input
                                    type="number"
                                    className={compactVariantFieldClass}
                                    value={variant.alertLevel}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        inv.updateVariantField(
                                            index,
                                            "alertLevel",
                                            e.target.value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-1.5 pr-1.5">
                                <PesoPriceInput
                                    compact
                                    value={variant.originalPrice}
                                    onChange={(value) =>
                                        inv.updateVariantField(
                                            index,
                                            "originalPrice",
                                            value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-1.5 pr-1.5">
                                <PesoPriceInput
                                    compact
                                    value={variant.salesPrice}
                                    onChange={(value) =>
                                        inv.updateVariantField(
                                            index,
                                            "salesPrice",
                                            value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-1.5 pr-1.5">
                                <input
                                    type="date"
                                    value={
                                        variantExpirationDates[index] ||
                                        ""
                                    }
                                    onChange={(
                                        e: React.ChangeEvent<HTMLInputElement>
                                    ) =>
                                        setVariantExpirationDates(
                                            (currentDates) => {
                                                const nextDates = [
                                                    ...currentDates,
                                                ];
                                                nextDates[index] =
                                                    e.target.value;
                                                return nextDates;
                                            }
                                        )
                                    }
                                    aria-label={`Expiration date for variant ${
                                        index + 1
                                    }`}
                                    className={compactVariantFieldClass}
                                />
                            </td>

                            <td className="py-1.5 text-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        inv.removeVariantRow(index);
                                        setVariantExpirationDates(
                                            (currentDates) =>
                                                currentDates.filter(
                                                    (_date, dateIndex) =>
                                                        dateIndex !== index
                                                )
                                        );
                                    }}
                                    className="text-xs font-semibold text-red-500 hover:underline"
                                >
                                    Remove
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

}
