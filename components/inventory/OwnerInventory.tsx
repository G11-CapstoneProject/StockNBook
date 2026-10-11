"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import {
    AlertTriangle, Building2, CheckCircle2, ChevronDown, Download, Eye, Package,
    ReceiptText, RefreshCw, Search, ShoppingCart, X,
} from "lucide-react";
import { useInventoryController } from "@/hooks/useInventory";
import { EmptyInventory, type Product } from "./_shared";

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


// Owner-only financial risk categories. Expiration takes precedence over sales inactivity.
type AtRiskCategoryKey =
    | "expired"
    | "expiringSoon"
    | "deadStock"
    | "slowMoving";

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

const OWNER_SLOW_MOVING_DAYS = 90;
const OWNER_DEAD_STOCK_DAYS = 180;

type RiskDatedSales = {
    lastSoldAt: Date | null;
    hasUndatedSales: boolean;
};

function getOwnerAtRiskBreakdown(
    products: Product[],
    salesAnalytics: OwnerSalesAnalytics,
    salesReady: boolean,
    orders: OwnerPosOrder[]
): AtRiskBreakdown {
    const values: Record<AtRiskCategoryKey, number> = {
        expired: 0,
        expiringSoon: 0,
        deadStock: 0,
        slowMoving: 0,
    };

    // This breakdown only needs POS dates/variant IDs; the other sales metrics
    // and their 12-month rules remain untouched.
    const byProductId = new Map(products.map(product => [String(product.id), product]));
    const uniqueProductNames = new Map<string, string>();
    const ambiguousNames = new Set<string>();
    products.forEach(product => {
        const nameKey = normalizeSalesProductName(product.name);
        const productId = String(product.id);
        if (uniqueProductNames.has(nameKey) && uniqueProductNames.get(nameKey) !== productId) {
            ambiguousNames.add(nameKey);
        } else {
            uniqueProductNames.set(nameKey, productId);
        }
    });

    const productSales = new Map<string, RiskDatedSales>();
    const variantSales = new Map<string, RiskDatedSales>();
    const unattributedVariantSales = new Set<string>();
    const unattributedProductSales = new Set<string>();

    const trackDatedSale = (map: Map<string, RiskDatedSales>, key: string, date: Date | null) => {
        const entry = map.get(key) ?? { lastSoldAt: null, hasUndatedSales: false };
        if (!date) entry.hasUndatedSales = true;
        else if (!entry.lastSoldAt || date > entry.lastSoldAt) entry.lastSoldAt = date;
        map.set(key, entry);
    };

    if (salesReady) {
        orders.filter(isValidCompletedOrder).forEach(order => {
            const date = parseOwnerOrderDate(order);
            const orderBranch = order.branchId ?? order.branch_id;
            const items = Array.isArray(order.orderItems) ? order.orderItems :
                Array.isArray(order.order_items) ? order.order_items : parseLegacyOrderItems(order.item);

            items.forEach(item => {
                if (getOrderItemQuantity(item) <= 0) return;
                const rawId = getOrderItemProductId(item);
                const nameKey = getOrderItemName(item);
                // Product IDs are authoritative. Fall back to a name only when
                // it belongs to precisely one product across the Owner's store.
                if (!rawId && ambiguousNames.has(nameKey)) {
                    products.forEach(candidate => {
                        if (normalizeSalesProductName(candidate.name) === nameKey &&
                            (orderBranch == null || orderBranch === "" || Number(candidate.branchId) === Number(orderBranch))) {
                            unattributedProductSales.add(String(candidate.id));
                        }
                    });
                    return;
                }
                const productId = rawId || uniqueProductNames.get(nameKey);
                if (!productId) return;
                const product = byProductId.get(productId);
                if (!product) return;
                if (orderBranch != null && orderBranch !== "" &&
                    Number(orderBranch) !== Number(product.branchId)) return;

                trackDatedSale(productSales, productId, date);
                if (!product.hasVariants || !product.variants?.length) return;

                const orderItem = item as OwnerPosOrderItem & {
                    variantId?: number | string | null;
                    variant_id?: number | string | null;
                };
                const variantId = String(orderItem.variantId ?? orderItem.variant_id ?? "").trim();
                const knownVariant = variantId && product.variants.some(variant => String(variant.id) === variantId);
                if (knownVariant) {
                    trackDatedSale(variantSales, `${productId}:${variantId}`, date);
                } else {
                    // Older POS records without a valid variant ID cannot prove
                    // that a particular variant has NOT been sold.
                    unattributedVariantSales.add(productId);
                }
            });
        });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parseCreatedAt = (value?: string | null): Date | null => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime()) || parsed > new Date()) return null;
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    };
    const latestDate = (a: Date | null, b: Date | null) =>
        !a ? b : !b ? a : a > b ? a : b;

    const classifyStock = (
        stock: number,
        unitCost: number,
        expirationDate: string | null | undefined,
        createdAt: string | null | undefined,
        sale: RiskDatedSales | undefined,
        unknownSalesDate: boolean
    ) => {
        const stockValue = Math.max(0, stock) * Math.max(0, unitCost);
        if (!Number.isFinite(stockValue) || stockValue <= 0) return;

        // Priority: expired -> expiring -> dead -> slow. Each stock line is
        // counted at most once, so variant values do not double-count parents.
        const daysUntilExpiry = getOwnerDaysUntilExpiration(expirationDate);
        if (daysUntilExpiry !== null && daysUntilExpiry < 0) {
            values.expired += stockValue;
            return;
        }
        if (daysUntilExpiry !== null && daysUntilExpiry <= OWNER_EXPIRING_SOON_DAYS) {
            values.expiringSoon += stockValue;
            return;
        }

        // POS data must be complete and dated enough to support inactivity.
        // Missing creation dates or undated sales are NOT evidence of dead stock.
        if (!salesReady || unknownSalesDate || sale?.hasUndatedSales) return;
        const created = parseCreatedAt(createdAt);
        const lastSold = sale?.lastSoldAt ?? null;
        const anchor = latestDate(created, lastSold);
        if (!anchor) return;
        const anchorDay = new Date(anchor);
        anchorDay.setHours(0, 0, 0, 0);
        const daysInactive = Math.floor((today.getTime() - anchorDay.getTime()) / DAY_IN_MILLISECONDS);
        if (daysInactive >= OWNER_DEAD_STOCK_DAYS) {
            values.deadStock += stockValue;
        } else if (daysInactive >= OWNER_SLOW_MOVING_DAYS) {
            values.slowMoving += stockValue;
        }
    };

    products.forEach(product => {
        const productId = String(product.id);
        const data = product as OwnerFinancialProduct;
        const productDate = data.createdAt ?? data.created_at;
        const parentActivity = productSales.get(productId);
        // Existing POS analytics are retained, but only trusted for a matching
        // product ID or an unambiguous product name (never a cross-branch guess).
        const key = normalizeSalesProductName(product.name);
        const trustedName = !ambiguousNames.has(key) && uniqueProductNames.get(key) === productId;
        const metric = getSalesMetricForProduct(product, salesAnalytics);
        const analyticDate = (salesAnalytics.byProductId.has(productId) || trustedName)
            ? metric.lastSoldAt : null;
        const parentDate = latestDate(parentActivity?.lastSoldAt ?? null, analyticDate);
        const fullParentActivity: RiskDatedSales = {
            lastSoldAt: parentDate,
            hasUndatedSales: parentActivity?.hasUndatedSales ?? false,
        };

        if (product.hasVariants && product.variants?.length) {
            product.variants.forEach(variant => {
                const variantData = variant as typeof variant & { created_at?: string | null };
                const knownSale = variantSales.get(`${productId}:${variant.id}`);
                const cannotAttribute = unattributedVariantSales.has(productId);
                const effectiveSale: RiskDatedSales = {
                    lastSoldAt: cannotAttribute
                        ? latestDate(knownSale?.lastSoldAt ?? null, parentDate)
                        : knownSale?.lastSoldAt ?? null,
                    hasUndatedSales: knownSale?.hasUndatedSales ?? false,
                };
                classifyStock(
                    Number(variant.stock || 0), Number(variant.originalPrice || 0),
                    variant.expirationDate, variantData.createdAt ?? variantData.created_at ?? productDate,
                    effectiveSale, unattributedProductSales.has(productId) ||
                    (cannotAttribute && fullParentActivity.hasUndatedSales)
                );
            });
        } else {
            classifyStock(
                Number(product.stock || 0), Number(product.originalPrice || 0),
                product.expirationDate, productDate, fullParentActivity, unattributedProductSales.has(productId)
            );
        }
    });

    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    const definitions: Array<{ key: AtRiskCategoryKey; label: string; color: string }> = [
        { key: "expired", label: "Expired Inventory", color: "#E93B4F" },
        { key: "expiringSoon", label: "Expiring Soon", color: "#F5A12D" },
        { key: "deadStock", label: "Dead Stock", color: "#7255D9" },
        { key: "slowMoving", label: "Slow-Moving Inventory", color: "#F6C443" },
    ];
    const rows = definitions.map(definition => ({
        ...definition,
        value: values[definition.key],
        percentage: total > 0 ? (values[definition.key] / total) * 100 : 0,
    }));

    let currentAngle = 0;
    const gradientStops = rows.filter(row => row.value > 0).map(row => {
        const startAngle = currentAngle;
        currentAngle += row.percentage * 3.6;
        return `${row.color} ${startAngle}deg ${currentAngle}deg`;
    });
    return {
        total,
        rows,
        gradient: gradientStops.length > 0
            ? `conic-gradient(${gradientStops.join(", ")})`
            : "conic-gradient(#EEE7F2 0deg 360deg)",
    };
}


// Financial purchase records are transaction-based. A supplier invoice belongs
// to a purchase, not to each product/variant in that purchase.
type OwnerSupplierPayable = {
    purchaseId: number;
    branchId: number;
    branchName?: string | null;
    purchaseNumber: string;
    supplier: string;
    supplierInvoiceNumber: string | null;
    purchaseTotal: number;
    amountPaid: number;
    outstandingBalance: number;
    paymentStatus: string;
    paymentMethod: "cash" | "credit";
    purchaseDate: string;
    paymentDueDate: string | null;
};

type OwnerPurchaseItem = {
    productId: number;
    productNumber: string | null;
    productName: string;
    variantId: number | null;
    variantNumber: string | null;
    variantValues: Record<string, string> | string | null;
    quantity: number;
    unitCost: number;
    lineTotal: number;
};

type OwnerFinancialProduct = Product & {
    productNumber?: string | null;
    product_number?: string | null;
    created_at?: string | null;
};

type DetailedPosItem = OwnerPosOrderItem & {
    unitPrice?: number | string | null;
    unit_price?: number | string | null;
    sellingPrice?: number | string | null;
    selling_price?: number | string | null;
    price?: number | string | null;
    lineTotal?: number | string | null;
    line_total?: number | string | null;
    totalPrice?: number | string | null;
    total_price?: number | string | null;
    subtotal?: number | string | null;
    variantId?: number | string | null;
    variant_id?: number | string | null;
};

type PurchasedProductSales = {
    units: number;
    revenue: number;
    // Unknown revenue is NOT estimated from today's selling price.
    revenueComplete: boolean;
};

type PurchasingVariantRow = {
    id: string;
    variantNumber: string;
    variantName: string;
    stockValue: number;
    unitsSold: number | null;
    salesRevenue: number | null;
};

type PurchasingRow = {
    id: string;
    productNumber: string;
    productName: string;
    branchName: string;
    category: string;
    stockValue: number;
    unitsSold: number;
    salesRevenue: number | null;
    velocity: number;
    salesVelocity: "High" | "Medium" | "Low" | "No Data";
    variants: PurchasingVariantRow[];
};

type PayableStatus = "Paid" | "Partially Paid" | "Unpaid" | "Overdue";
type PaymentStatusFilter = "All Statuses" | "Outstanding" | PayableStatus;

// The Owner purchasing table uses a vertical scroll, not numbered pages.
// Load rows in chunks so stores with thousands of products remain responsive.
const PURCHASING_SCROLL_BATCH = 100;

function formatShortDate(date?: string | null) {
    if (!date) return "—";
    const value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date(date);
    return Number.isNaN(value.getTime()) ? "—" : value.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function businessDateString() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}

function ownerProductNumber(product: OwnerFinancialProduct) {
    // Never derive a fake business reference from the numeric database ID.
    return String(product.productNumber ?? product.product_number ?? "").trim() || "—";
}

function payableIsOverdue(record: OwnerSupplierPayable) {
    if (Number(record.outstandingBalance || 0) <= 0 || !record.paymentDueDate) return false;
    return String(record.paymentDueDate).slice(0, 10) < businessDateString();
}

function payableStatus(record: OwnerSupplierPayable): PayableStatus {
    if (Number(record.outstandingBalance || 0) <= 0) return "Paid";
    if (payableIsOverdue(record)) return "Overdue";
    return Number(record.amountPaid || 0) > 0 ? "Partially Paid" : "Unpaid";
}

function PayableBadge({ status }: { status: PayableStatus }) {
    const palette = {
        "Paid": "border-[#BDE6CC] bg-[#ECF8F0] text-[#168A48]",
        "Partially Paid": "border-[#F4D79A] bg-[#FFF8D8] text-[#A56607]",
        "Unpaid": "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
        "Overdue": "border-[#F2C4C4] bg-[#FFE8E8] text-[#CE263E]",
    }[status];
    return <span className={`inline-flex min-w-[94px] justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${palette}`}>{status}</span>;
}

async function ownerPurchasesRequest(body: Record<string, unknown>) {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true) {
        throw new Error(String(payload.error || `Request failed (HTTP ${response.status}).`));
    }
    return payload;
}

function isValidCompletedOrder(order: OwnerPosOrder) {
    const value = order as OwnerPosOrder & Record<string, unknown>;
    const status = String(value.status ?? value.orderStatus ?? value.order_status ??
        value.transactionStatus ?? value.transaction_status ?? "").trim().toLowerCase();
    if (!status) return true; // Existing POS get_orders endpoint ordinarily returns recorded sales.
    if (["cancel", "invalid", "void", "refund", "pending", "fail"].some(word => status.includes(word))) return false;
    return ["complete", "paid", "success"].some(word => status.includes(word));
}

function getItemRevenue(item: DetailedPosItem, units: number): number | null {
    const lineTotal = getNumericSalesValue(item.lineTotal ?? item.line_total ?? item.totalPrice ?? item.total_price ?? item.subtotal);
    if (lineTotal !== null && lineTotal >= 0) return lineTotal;
    const unitPrice = getNumericSalesValue(item.unitPrice ?? item.unit_price ?? item.sellingPrice ?? item.selling_price ?? item.price);
    if (unitPrice !== null && unitPrice >= 0) return Math.round(unitPrice * units * 100) / 100;
    return null;
}

function getProductMonthsActive(product: OwnerFinancialProduct, now: Date) {
    const raw = String(product.createdAt ?? product.created_at ?? "");
    const created = new Date(raw);
    if (!raw || Number.isNaN(created.getTime())) return 12;
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    if (created <= yearAgo) return 12;
    if (created > now) return 1;
    return Math.min(12, Math.max(1, Math.ceil((now.getTime() - created.getTime()) / (30.4375 * DAY_IN_MILLISECONDS))));
}

function getOwnerPurchasingRows(products: OwnerFinancialProduct[], orders: OwnerPosOrder[], salesReady: boolean): PurchasingRow[] {
    const now = new Date();
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
    const salesById = new Map<string, PurchasedProductSales>();
    const salesByVariantId = new Map<string, PurchasedProductSales>();
    const unattributedVariantProducts = new Set<string>();
    const validVariantsByProduct = new Map<string, Set<string>>();
    products.forEach(product => {
        validVariantsByProduct.set(String(product.id), new Set(
            (product.variants || []).map(variant => String(variant.id)).filter(Boolean)
        ));
    });
    const productIds = new Set(products.map(product => String(product.id)));
    const uniqueNames = new Map<string, string>();
    const duplicatedNames = new Set<string>();
    products.forEach(product => {
        const key = normalizeSalesProductName(product.name);
        if (uniqueNames.has(key) && uniqueNames.get(key) !== String(product.id)) duplicatedNames.add(key);
        else uniqueNames.set(key, String(product.id));
    });

    if (salesReady) orders.forEach(order => {
        if (!isValidCompletedOrder(order)) return;
        const date = parseOwnerOrderDate(order);
        if (!date || date < start || date > now) return;
        const items = Array.isArray(order.orderItems) ? order.orderItems :
            Array.isArray(order.order_items) ? order.order_items : parseLegacyOrderItems(order.item);
        items.forEach(raw => {
            const item = raw as DetailedPosItem;
            const units = getOrderItemQuantity(item);
            if (units <= 0) return;
            const id = getOrderItemProductId(item);
            const nameKey = getOrderItemName(item);
            const resolvedId = id && productIds.has(id) ? id :
                !id && !duplicatedNames.has(nameKey) ? uniqueNames.get(nameKey) : undefined;
            if (!resolvedId) return;
            const prev = salesById.get(resolvedId) ?? { units: 0, revenue: 0, revenueComplete: true };
            const lineRevenue = getItemRevenue(item, units);
            salesById.set(resolvedId, {
                units: prev.units + units,
                revenue: prev.revenue + (lineRevenue ?? 0),
                revenueComplete: prev.revenueComplete && lineRevenue !== null,
            });
            // Allocate sales to a variant ONLY when the POS line supplies a
            // real variant ID belonging to this product. Otherwise do not guess.
            const variantId = String(item.variantId ?? item.variant_id ?? "").trim();
            if ((validVariantsByProduct.get(resolvedId)?.size ?? 0) > 0) {
                if (!variantId || !validVariantsByProduct.get(resolvedId)?.has(variantId)) {
                    unattributedVariantProducts.add(resolvedId);
                } else {
                    const variantKey = `${resolvedId}:${variantId}`;
                    const variantSales = salesByVariantId.get(variantKey) ?? {
                        units: 0, revenue: 0, revenueComplete: true,
                    };
                    salesByVariantId.set(variantKey, {
                        units: variantSales.units + units,
                        revenue: variantSales.revenue + (lineRevenue ?? 0),
                        revenueComplete: variantSales.revenueComplete && lineRevenue !== null,
                    });
                }
            }
        });
    });

    const rows: PurchasingRow[] = products.map(product => {
        const financials = getOwnerProductFinancials(product);
        const history = salesById.get(String(product.id));
        const units = history?.units ?? 0;
        const canAllocateVariantSales = salesReady && !unattributedVariantProducts.has(String(product.id));
        const variants: PurchasingVariantRow[] = product.hasVariants
            ? (product.variants || []).map(variant => {
                const variantId = String(variant.id);
                const variantSales = salesByVariantId.get(`${product.id}:${variantId}`);
                const variantData = variant as typeof variant & {
                    variantNumber?: string | null;
                    variant_number?: string | null;
                };
                const values = Object.values(variant.variantValues || {})
                    .map(value => String(value || "").trim()).filter(Boolean);
                return {
                    id: variantId,
                    variantNumber: String(variantData.variantNumber ?? variantData.variant_number ?? "").trim() || "—",
                    variantName: values.join(", ") || "Variant",
                    stockValue: Math.max(0, Number(variant.stock || 0)) * Number(variant.originalPrice || 0),
                    unitsSold: canAllocateVariantSales ? (variantSales?.units ?? 0) : null,
                    salesRevenue: !canAllocateVariantSales ? null : !variantSales ? 0 :
                        variantSales.revenueComplete ? variantSales.revenue : null,
                };
            }) : [];
        return {
            id: String(product.id),
            productNumber: ownerProductNumber(product),
            productName: product.name,
            branchName: product.branchName || "Unassigned Branch",
            category: product.category || "Uncategorized",
            stockValue: financials.inventoryValue,
            unitsSold: units,
            salesRevenue: !salesReady ? null : !history ? 0 : history.revenueComplete ? history.revenue : null,
            velocity: units / getProductMonthsActive(product, now),
            salesVelocity: salesReady ? "Low" : "No Data",
            variants,
        };
    });

    // Rank products against other products in the SAME branch, not the whole store.
    const byBranch = new Map<string, PurchasingRow[]>();
    rows.forEach(row => byBranch.set(row.branchName, [...(byBranch.get(row.branchName) || []), row]));
    for (const branchRows of byBranch.values()) {
        const sold = branchRows.filter(row => row.velocity > 0)
            .sort((a, b) => b.velocity - a.velocity || a.productName.localeCompare(b.productName));
        sold.forEach((row, index) => {
            const group = Math.min(2, Math.floor(index * 3 / Math.max(1, sold.length)));
            row.salesVelocity = group === 0 ? "High" : group === 1 ? "Medium" : "Low";
        });
    }
    return rows;
}

function OwnerVelocityBadge({ value }: { value: PurchasingRow["salesVelocity"] }) {
    const palette = {
        High: "bg-[#ECF8F0] text-[#168A48] border-[#BDE6CC]",
        Medium: "bg-[#FFF8D8] text-[#A56607] border-[#F4D79A]",
        Low: "bg-[#FFF0F0] text-[#C32F2F] border-[#F2C4C4]",
        "No Data": "bg-[#F5F0F8] text-[#86778F] border-[#E6DDF0]",
    }[value];
    return <span className={`inline-flex min-w-[76px] justify-center rounded-full border px-2 py-1 text-[11px] font-semibold ${palette}`}>{value}</span>;
}

// Owner-only exports use the already-filtered table data, not just visible scroll rows.
// Excel uses the existing project's xlsx dependency; PDF follows the Manager's
// package-free canvas / PDF download approach. Neither alters database records.
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

function ownerPurchasingReport(rows: PurchasingRow[], salesReady: boolean): OwnerReportTable {
    return {
        headers: ["Product No.", "Product", "Branch", "Category", "Stock Value (PHP)",
            "Units Sold (12 Mo.)", "Sales Revenue (PHP)", "Sales Velocity"],
        rows: rows.map(row => [row.productNumber, row.productName, row.branchName, row.category,
            row.stockValue, salesReady ? row.unitsSold : "Unavailable", row.salesRevenue ?? "Unavailable", row.salesVelocity]),
        columnWidths: [112, 175, 133, 123, 97, 91, 107, 76],
        moneyColumns: [4, 6],
    };
}

function ownerSupplierReport(rows: OwnerSupplierPayable[], branches: Array<{ id: number; branchName: string }>): OwnerReportTable {
    const branchById = new Map(branches.map(branch => [Number(branch.id), branch.branchName]));
    return {
        headers: ["Purchase No.", "Supplier", "Branch", "Method", "Total (PHP)",
            "Paid (PHP)", "Outstanding (PHP)", "Payment Deadline", "Status"],
        rows: rows.map(row => [row.purchaseNumber, row.supplier,
            row.branchName || branchById.get(Number(row.branchId)) || "Unassigned Branch",
            row.paymentMethod === "cash" ? "Cash" : "Credit",
            Number(row.purchaseTotal) || 0, Number(row.amountPaid) || 0,
            Number(row.outstandingBalance) || 0, formatShortDate(row.paymentDueDate), payableStatus(row)]),
        columnWidths: [92, 122, 122, 66, 88, 88, 104, 101, 85],
        moneyColumns: [4, 5, 6],
    };
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

// Download a real A4 landscape PDF with repeating table headings and page numbers.
// Reuse the image-backed PDF generator design already used by Manager Inventory.
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

function OwnerCard({ label, value, helper, icon, tone = "purple" }: {
    label: string; value: string; helper: string; icon: React.ReactNode;
    tone?: "purple" | "blue" | "red" | "amber";
}) {
    const tones = {
        purple: { icon: "bg-[#F1ECFF] text-[#5F35D8]", value: "text-[#2B174C]" },
        blue: { icon: "bg-[#E9F2FF] text-[#1E6FE8]", value: "text-[#1E6FE8]" },
        red: { icon: "bg-[#FFE8E8] text-[#E23B4A]", value: "text-[#D52035]" },
        amber: { icon: "bg-[#FFF3DE] text-[#E68A00]", value: "text-[#D87B00]" },
    }[tone];
    return <section className="min-w-0 rounded-[16px] border border-[#E7DFEC] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <p className="text-sm font-bold text-[#21132E]">{label}</p>
                <p className={`mt-2 break-words text-[clamp(19px,1.7vw,27px)] font-bold leading-tight tabular-nums tracking-tight ${tones.value}`}>{value}</p>
                <p className="mt-1.5 text-[11px] leading-4 text-[#86778F]">{helper}</p>
            </div>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tones.icon}`}>{icon}</span>
        </div>
    </section>;
}

function OwnerTableTh({ children, right = false, center = false }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
    return <th scope="col" className={`break-words px-2 py-2.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C] ${center ? "text-center" : right ? "text-right" : "text-left"}`}>{children}</th>;
}

// Manager-style export control for the two Owner inventory tables.
// Keep both existing PDF and Excel generators unchanged.
function OwnerReportExportMenu({
                                   source,
                                   disabled,
                                   onExport,
                               }: {
    source: "suppliers" | "purchasing";
    disabled: boolean;
    onExport: (source: "suppliers" | "purchasing", format: "pdf" | "xlsx") => void;
}) {
    const [open, setOpen] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const handleOutsideClick = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", handleOutsideClick);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("pointerdown", handleOutsideClick);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [open]);

    return (
        <div ref={menuRef} className="relative shrink-0">
            <button
                type="button"
                disabled={disabled}
                aria-expanded={open}
                aria-haspopup="true"
                aria-label={`Export ${source === "suppliers" ? "supplier payments" : "inventory purchasing"}`}
                onClick={() => setOpen(value => !value)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E3D8EA] bg-white px-4 text-xs font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
            >
                <Download size={16} /> Export
            </button>
            {open && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-[#DDD2ED] bg-white py-1.5 shadow-[0_6px_22px_rgba(43,23,76,0.16)]" aria-label="Choose report format">
                    <button type="button" onClick={() => { setOpen(false); onExport(source, "xlsx"); }} className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#2B174C] hover:bg-[#F7F1FF]">
                        Excel (.xlsx)
                    </button>
                    <button type="button" onClick={() => { setOpen(false); onExport(source, "pdf"); }} className="block w-full px-4 py-2.5 text-left text-xs font-medium text-[#2B174C] hover:bg-[#F7F1FF]">
                        PDF (.pdf)
                    </button>
                </div>
            )}
        </div>
    );
}

function OwnerInventory() {
    const [refreshKey, setRefreshKey] = React.useState(0);
    const [date, setDate] = React.useState<Date | null>(null);
    React.useEffect(() => {
        const update = () => setDate(new Date());
        update();
        const timer = window.setInterval(update, 30_000);
        return () => window.clearInterval(timer);
    }, []);
    return <>
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
            <div className="flex min-h-[74px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                <div>
                    <h1 className="text-[25px] font-bold text-[#1A1220]">Inventory</h1>
                    <p className="mt-0.5 text-xs text-[#766983]">Strategic and financial view of inventory purchasing across branches.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                        {date ? formatCurrentDateTime(date) : "Loading date..."}
                    </span>
                    <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"><RefreshCw size={16}/>Refresh</button>
                </div>
            </div>
        </header>
        <OwnerInventoryContent key={refreshKey}/>
    </>;
}
export default OwnerInventory;

function OwnerInventoryContent() {
    const inv = useInventoryController();
    const [productNumbersById, setProductNumbersById] = React.useState<Record<number, string>>({});
    const [productCreatedAtById, setProductCreatedAtById] = React.useState<Record<number, string>>({});
    const [variantNumbersById, setVariantNumbersById] = React.useState<Record<number, string>>({});
    const products = React.useMemo(() => ((Array.isArray(inv.products) ? inv.products : []) as OwnerFinancialProduct[])
        .map(product => {
            const id = Number(product.id);
            const number = String(product.productNumber || product.product_number || productNumbersById[id] || "").trim();
            const createdAt = product.createdAt || product.created_at || productCreatedAtById[id] || undefined;
            return {
                ...product,
                productNumber: number || null,
                createdAt,
                variants: (product.variants || []).map(variant => {
                    const item = variant as typeof variant & { variantNumber?: string | null; variant_number?: string | null };
                    return { ...variant, variantNumber: item.variantNumber || item.variant_number || variantNumbersById[Number(variant.id)] || null };
                }),
            };
        }), [inv.products, productNumbersById, productCreatedAtById, variantNumbersById]);
    // The owner list may omit permanent product references; use the same
    // read-only get_products lookup already used by Manager Inventory.
    React.useEffect(() => {
        let active = true;
        const loadProductNumbers = async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) return;
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_products" }), cache: "no-store",
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !Array.isArray(payload.products)) return;
                const ids: Record<number, string> = {};
                const createdDates: Record<number, string> = {};
                const variantNumbers: Record<number, string> = {};
                for (const product of payload.products) {
                    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
                        const variantId = Number(variant.id);
                        const variantNumber = String(variant.variantNumber ?? variant.variant_number ?? "").trim();
                        if (Number.isInteger(variantId) && variantId > 0 && variantNumber) {
                            variantNumbers[variantId] = variantNumber;
                        }
                    }
                    const id = Number(product.id);
                    const number = String(product.productNumber ?? product.product_number ?? "").trim();
                    const createdAt = String(product.createdAt ?? product.created_at ?? "").trim();
                    if (Number.isInteger(id) && id > 0) {
                        if (number) ids[id] = number;
                        if (createdAt) createdDates[id] = createdAt;
                    }
                }
                if (active) {
                    setProductNumbersById(previous => ({ ...previous, ...ids }));
                    setProductCreatedAtById(previous => ({ ...previous, ...createdDates }));
                    setVariantNumbersById(previous => ({ ...previous, ...variantNumbers }));
                }
            } catch { /* This is an optional read-only reference lookup. */ }
        };
        void loadProductNumbers();
        window.addEventListener("stocknbook:created-product-numbers", loadProductNumbers);
        window.addEventListener("stocknbook:imported-product-numbers", loadProductNumbers);
        return () => {
            active = false;
            window.removeEventListener("stocknbook:created-product-numbers", loadProductNumbers);
            window.removeEventListener("stocknbook:imported-product-numbers", loadProductNumbers);
        };
    }, []);
    const overview = React.useMemo(() => getOwnerInventoryOverview(products), [products]);
    const branchValues = React.useMemo(() => getInventoryValueByBranch(products), [products]);
    const [orders, setOrders] = React.useState<OwnerPosOrder[]>([]);
    const [salesReady, setSalesReady] = React.useState(false);
    const [salesLoading, setSalesLoading] = React.useState(true);
    const [salesError, setSalesError] = React.useState("");
    const [payables, setPayables] = React.useState<OwnerSupplierPayable[]>([]);
    const [payablesReady, setPayablesReady] = React.useState(false);
    const [payablesError, setPayablesError] = React.useState("");
    const [payablesLoading, setPayablesLoading] = React.useState(true);
    const [paymentNotice, setPaymentNotice] = React.useState("");
    React.useEffect(() => {
        if (!paymentNotice) return;
        const timeout = window.setTimeout(() => setPaymentNotice(""), 5000);
        return () => window.clearTimeout(timeout);
    }, [paymentNotice]);
    const payablesRequestSequence = React.useRef(0);

    const loadPayables = React.useCallback(async () => {
        const sequence = ++payablesRequestSequence.current;
        const payload = await ownerPurchasesRequest({ action: "get_supplier_payables" });
        if (sequence !== payablesRequestSequence.current) return;
        setPayables(Array.isArray(payload.payables) ? payload.payables : []);
        setPayablesReady(true);
        setPayablesError("");
    }, []);
    React.useEffect(() => {
        let active = true;
        const requestSequence = payablesRequestSequence;
        const refresh = () => {
            if (document.visibilityState === "hidden") return;
            void loadPayables().catch(error => {
                if (active) setPayablesError(error instanceof Error ? error.message : "Unable to load supplier purchases.");
            }).finally(() => { if (active) setPayablesLoading(false); });
        };
        refresh();
        const refreshIfVisible = () => { if (document.visibilityState === "visible") refresh(); };
        window.addEventListener("stocknbook:purchase-updated", refresh);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refreshIfVisible);
        const interval = window.setInterval(refresh, 30_000);
        return () => {
            active = false;
            requestSequence.current++;
            window.clearInterval(interval);
            window.removeEventListener("stocknbook:purchase-updated", refresh);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refreshIfVisible);
        };
    }, [loadPayables]);

    const retrySupplierPayables = () => {
        setPayablesLoading(true);
        void loadPayables().catch(error => {
            setPayablesError(error instanceof Error ? error.message : "Unable to load supplier purchases.");
        }).finally(() => setPayablesLoading(false));
    };

    // Obtain recorded POS order lines from the database through the existing POS API.
    // Some installations require a branch_id for Owner requests; request each
    // store branch independently to avoid silently showing only one branch.
    const ownerBranchIds = React.useMemo(
        () => [...new Set(inv.branches.map(branch => Number(branch.id)).filter(id => Number.isInteger(id) && id > 0))],
        [inv.branches]
    );
    const ownerBranchIdsKey = ownerBranchIds.join(",");
    React.useEffect(() => {
        let active = true;
        const load = async () => {
            setSalesLoading(true);
            setSalesReady(false);
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Your session has expired. Please sign in again.");
                const branchIds = ownerBranchIdsKey.split(",").filter(Boolean).map(Number);
                const requests = branchIds.length ? branchIds : [null];
                const results = await Promise.allSettled(requests.map(async branchId => {
                    const response = await fetch("/api/pos", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({
                            action: "get_orders", include_order_items: true,
                            ...(branchId ? { branch_id: branchId } : {}),
                        }),
                        cache: "no-store",
                    });
                    const payload = (await response.json().catch(() => ({}))) as OwnerPosOrdersResponse;
                    if (!response.ok || payload.success === false || !Array.isArray(payload.orders)) {
                        throw new Error(payload.error || `Failed to fetch POS orders${branchId ? ` for branch ${branchId}` : ""}.`);
                    }
                    // Trust a branch-scoped request only for its branch. When the API
                    // supplies branch IDs, reject unrelated orders defensively.
                    return payload.orders.filter(order => {
                        const raw = order.branchId ?? order.branch_id;
                        return !branchId || raw == null || raw === "" || Number(raw) === branchId;
                    });
                }));
                if (!active) return;
                const failures = results.filter(result => result.status === "rejected");
                // Partial data must not be treated as a complete cross-branch report.
                if (failures.length) {
                    throw new Error(failures.map(result => result.status === "rejected"
                        ? (result.reason instanceof Error ? result.reason.message : "POS request failed") : "").join("; "));
                }
                const seen = new Set<string>();
                const allOrders: OwnerPosOrder[] = [];
                results.forEach((result, branchIndex) => {
                    if (result.status !== "fulfilled") return;
                    result.value.forEach((order, index) => {
                        const reference = String(order.orderId ?? order.order_id ?? "").trim();
                        const branch = String(order.branchId ?? order.branch_id ?? requests[branchIndex] ?? "");
                        const dedupeKey = reference ? `${branch}:${reference}` : `${branch}:${branchIndex}:${index}`;
                        if (seen.has(dedupeKey)) return;
                        seen.add(dedupeKey);
                        allOrders.push(order);
                    });
                });
                setOrders(allOrders);
                setSalesReady(true);
                setSalesError("");
            } catch (error) {
                if (active) {
                    setSalesReady(false);
                    setSalesError(error instanceof Error ? error.message : "Unable to load recorded POS sales.");
                }
            } finally { if (active) setSalesLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [ownerBranchIdsKey]);

    const riskAnalytics = React.useMemo(() => getOwnerSalesAnalytics(orders.filter(isValidCompletedOrder)), [orders]);
    const riskBreakdown = React.useMemo(() => getOwnerAtRiskBreakdown(products, riskAnalytics, salesReady, orders), [products, riskAnalytics, salesReady, orders]);
    const allPurchasingRows = React.useMemo(() => getOwnerPurchasingRows(products, orders, salesReady), [products, orders, salesReady]);
    const unpaidTotal = payables.reduce((sum, row) => sum + Math.max(0, Number(row.outstandingBalance) || 0), 0);
    const overdueTotal = payables.reduce((sum, row) => sum + (payableIsOverdue(row) ? Math.max(0, Number(row.outstandingBalance) || 0) : 0), 0);

    const [purchaseSearch, setPurchaseSearch] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState<PaymentStatusFilter>("All Statuses");
    const [methodFilter, setMethodFilter] = React.useState("all");
    const filteredPayables = payables.filter(row => {
        const matchesText = [row.purchaseNumber, row.supplier, row.supplierInvoiceNumber, row.paymentMethod]
            .some(value => String(value ?? "").toLowerCase().includes(purchaseSearch.trim().toLowerCase()));
        const status = payableStatus(row);
        return matchesText && (statusFilter === "All Statuses" || (statusFilter === "Outstanding" ? row.outstandingBalance > 0 : status === statusFilter))
            && (methodFilter === "all" || methodFilter === row.paymentMethod);
    }).sort((first, second) => {
        // Outstanding purchases come first, oldest/nearest deadlines at the top
        // (including overdue balances). Paid purchases are listed afterward.
        const firstOutstanding = Number(first.outstandingBalance || 0) > 0;
        const secondOutstanding = Number(second.outstandingBalance || 0) > 0;
        if (firstOutstanding !== secondOutstanding) return firstOutstanding ? -1 : 1;

        if (firstOutstanding && secondOutstanding) {
            const firstDeadline = String(first.paymentDueDate ?? "").slice(0, 10);
            const secondDeadline = String(second.paymentDueDate ?? "").slice(0, 10);
            if (!firstDeadline && secondDeadline) return 1;
            if (firstDeadline && !secondDeadline) return -1;
            if (firstDeadline !== secondDeadline) return firstDeadline.localeCompare(secondDeadline);
        }
        // Keep a predictable order for equal/missing deadlines and paid purchases.
        return Number(second.purchaseId) - Number(first.purchaseId);
    });

    const [productSearch, setProductSearch] = React.useState("");
    const [categoryFilter, setCategoryFilter] = React.useState("All Categories");
    const [branchFilter, setBranchFilter] = React.useState("All Branches");
    const [visibleProductCount, setVisibleProductCount] = React.useState(PURCHASING_SCROLL_BATCH);
    const [expandedProductIds, setExpandedProductIds] = React.useState<Record<string, boolean>>({});
    const purchasingScrollRef = React.useRef<HTMLDivElement>(null);
    const resetPurchasingScroll = () => {
        setVisibleProductCount(PURCHASING_SCROLL_BATCH);
        if (purchasingScrollRef.current) purchasingScrollRef.current.scrollTop = 0;
    };
    const onPurchasingScroll = (event: React.UIEvent<HTMLDivElement>) => {
        const element = event.currentTarget;
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - 220) {
            setVisibleProductCount(current => Math.min(current + PURCHASING_SCROLL_BATCH, filteredPurchasingRows.length));
        }
    };
    const categories = React.useMemo(() => [...new Set(products.map(product => product.category).filter(Boolean))].sort(), [products]);
    const branches = React.useMemo(() => [...new Set(products.map(product => product.branchName || "Unassigned Branch"))].sort(), [products]);
    const filteredPurchasingRows = allPurchasingRows.filter(row => {
        const search = productSearch.trim().toLowerCase();
        const matchesSearch = !search || [row.productNumber, row.productName, row.category].some(value => value.toLowerCase().includes(search));
        return matchesSearch && (categoryFilter === "All Categories" || row.category === categoryFilter)
            && (branchFilter === "All Branches" || row.branchName === branchFilter);
    });
    const visiblePurchasingRows = filteredPurchasingRows.slice(0, visibleProductCount);

    const downloadOwnerReport = (source: "suppliers" | "purchasing", format: "pdf" | "xlsx") => {
        const table = source === "suppliers"
            ? ownerSupplierReport(filteredPayables, inv.branches)
            : ownerPurchasingReport(filteredPurchasingRows, salesReady);
        const details: OwnerReportDetails = source === "suppliers"
            ? {
                title: "Supplier Payment Overview", fileTag: "Supplier_Payments", sheetName: "Supplier Payments",
                storeName: inv.storeName || "Unknown Store", branchName: "All Branches",
                filters: [statusFilter, methodFilter === "all" ? "All Methods" : methodFilter,
                    purchaseSearch.trim() ? `Search: ${purchaseSearch.trim()}` : "All Purchases"],
                generatedAt: new Date(),
            }
            : {
                title: "Inventory Purchasing Overview", fileTag: "Inventory_Purchasing", sheetName: "Inventory Purchasing",
                storeName: inv.storeName || "Unknown Store", branchName: branchFilter,
                filters: [categoryFilter, branchFilter,
                    productSearch.trim() ? `Search: ${productSearch.trim()}` : "All Products",
                    "POS Sales: Last 12 Months"],
                generatedAt: new Date(),
            };
        try {
            if (format === "pdf") exportOwnerTablePdf(table, details);
            else exportOwnerTableExcel(table, details);
        } catch (error) {
            alert(error instanceof Error ? `Unable to export report: ${error.message}` : "Unable to export report.");
        }
    };

    const [dialog, setDialog] = React.useState<{ mode: "view" | "pay"; record: OwnerSupplierPayable } | null>(null);
    const [purchaseItems, setPurchaseItems] = React.useState<OwnerPurchaseItem[]>([]);
    const [itemsLoading, setItemsLoading] = React.useState(false);
    const [dialogError, setDialogError] = React.useState("");
    const [savingPayment, setSavingPayment] = React.useState(false);
    const [paymentAmount, setPaymentAmount] = React.useState("");
    const [paymentDate, setPaymentDate] = React.useState(businessDateString);
    const [confirmPayment, setConfirmPayment] = React.useState(false);
    const paymentKey = React.useRef("");

    const openPurchase = async (record: OwnerSupplierPayable, mode: "view" | "pay") => {
        setDialog({ mode, record });
        setDialogError("");
        setPurchaseItems([]);
        setConfirmPayment(false);
        setPaymentAmount(String(Number(record.outstandingBalance).toFixed(2)));
        setPaymentDate(businessDateString());
        paymentKey.current = crypto.randomUUID();
        if (mode === "view") {
            setItemsLoading(true);
            try {
                const response = await ownerPurchasesRequest({ action: "get_supplier_purchase_items", purchaseId: record.purchaseId, branch_id: record.branchId });
                setPurchaseItems(Array.isArray(response.items) ? response.items : []);
            } catch (error) { setDialogError(error instanceof Error ? error.message : "Unable to load purchase details."); }
            finally { setItemsLoading(false); }
        }
    };

    const preparePayment = (event: React.FormEvent) => {
        event.preventDefault();
        if (!dialog || dialog.mode !== "pay" || savingPayment) return;
        const amount = Number(paymentAmount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > Number(dialog.record.outstandingBalance)) {
            setDialogError("The payment must be greater than zero and cannot exceed the outstanding balance."); return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
            setDialogError("Enter a valid payment date."); return;
        }
        setDialogError("");
        setConfirmPayment(true);
    };

    const recordPayment = async () => {
        if (!dialog || dialog.mode !== "pay" || savingPayment || !confirmPayment) return;
        setSavingPayment(true);
        setDialogError("");
        setPaymentNotice("");
        try {
            const result = await ownerPurchasesRequest({ action: "pay_supplier_purchase", purchaseId: dialog.record.purchaseId,
                amount: Number(paymentAmount), paymentDate, branch_id: dialog.record.branchId, requestKey: paymentKey.current });
            paymentKey.current = crypto.randomUUID();
            setPaymentNotice(result.alreadyProcessed ? "This supplier payment was already recorded." : `Payment recorded for ${dialog.record.purchaseNumber}.`);
            // Recording succeeded: a later refresh failure must not be reported
            // as a failed payment or lead the Owner to accidentally pay twice.
            try {
                await loadPayables();
            } catch (refreshError) {
                setPayablesError(refreshError instanceof Error ? refreshError.message : "Unable to refresh supplier balances.");
            }
            setDialog(null);
            setConfirmPayment(false);
        } catch (error) { setDialogError(error instanceof Error ? error.message : "Unable to record the payment."); }
        finally { setSavingPayment(false); }
    };

    return <main className="space-y-4 px-5 py-5 font-sans">
        {paymentNotice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[150] flex w-[min(380px,calc(100vw-32px))] items-start gap-3 rounded-2xl border border-[#BDE6CC] bg-white p-4 shadow-[0_8px_36px_rgba(43,23,76,0.15)]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E6F8ED] text-[#168A48]"><CheckCircle2 size={21}/></span>
            <div className="min-w-0 flex-1"><p className="text-[13px] font-bold text-[#21132E]">Supplier payment {paymentNotice.includes("already") ? "already recorded" : "recorded successfully"}</p><p className="mt-1 text-xs text-[#7A6A84]">{paymentNotice}</p></div>
            <button type="button" aria-label="Dismiss payment notification" onClick={() => setPaymentNotice("")} className="rounded-md p-1 text-[#86778F] hover:bg-[#F7F1FF]"><X size={16}/></button>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OwnerCard label="Inventory Value at Cost" value={formatPeso(overview.inventoryCostValue)} helper="Capital currently tied to stock at acquisition cost." icon={<Package size={21}/>} />
            <OwnerCard label="Inventory Sales" value={formatPeso(overview.retailValue)} helper="Estimated sales value if current stock is sold; not actual revenue." icon={<ShoppingCart size={21}/>} tone="blue"/>
            <OwnerCard label="Supplier Payables" value={payablesReady ? formatPeso(unpaidTotal) : "—"} helper="Outstanding balances from recorded supplier purchases." icon={<ReceiptText size={21}/>} tone="red"/>
            <OwnerCard label="Overdue Payables" value={payablesReady ? formatPeso(overdueTotal) : "—"} helper="Supplier balances past the payment due date." icon={<AlertTriangle size={21}/>} tone="red"/>
        </div>

        <div className="grid items-stretch gap-4 xl:grid-cols-2">
            <InventoryValueByBranchCard rows={branchValues}/>
            <AtRiskInventoryBreakdownCard breakdown={riskBreakdown}/>
        </div>

        <section className="scroll-mt-32 overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="relative z-20 flex flex-col gap-3 border-b border-[#E6DDF0] p-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1ECFF] text-[#5F35D8]"><ReceiptText size={20}/></span>
                    <div><h2 className="text-[16px] font-bold text-[#21132E]">Supplier Payment Overview</h2><p className="mt-0.5 text-[11px] text-[#86778F]">Track and pay outstanding supplier purchases by transaction.</p></div>
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
                    <div className="relative min-w-[185px] flex-1 xl:max-w-[270px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/><input aria-label="Search supplier purchases" value={purchaseSearch} onChange={event => { setPurchaseSearch(event.target.value); }} placeholder="Search purchase no., supplier, invoice..." className="h-10 w-full rounded-xl border border-[#E3D8EA] bg-white pl-9 pr-3 text-xs text-[#21132E] outline-none focus:border-[#2B174C]"/></div>
                    <select aria-label="Filter supplier payment status" value={statusFilter} onChange={event => { setStatusFilter(event.target.value as PaymentStatusFilter); }} className="h-10 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none">
                        {["All Statuses", "Outstanding", "Overdue", "Unpaid", "Partially Paid", "Paid"].map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <select aria-label="Filter supplier payment method" value={methodFilter} onChange={event => { setMethodFilter(event.target.value); }} className="h-10 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none">
                        <option value="all">All Methods</option><option value="cash">Cash</option><option value="credit">Credit</option>
                    </select>
                    <OwnerReportExportMenu source="suppliers" disabled={!filteredPayables.length} onExport={downloadOwnerReport}/>
                </div>
            </div>
            {payablesError && <div role="alert" className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs ${payablesReady ? "border-[#F4D79A] bg-[#FFF8ED] text-[#966310]" : "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"}`}>
                <span>{payablesReady ? "Unable to refresh supplier payments. Showing previously loaded records." : "Unable to load supplier payments."} {payablesError === "Failed to fetch" ? "Check the inventory API connection." : payablesError}</span>
                <button type="button" onClick={retrySupplierPayables} disabled={payablesLoading} className="rounded-lg border border-current px-3 py-1.5 font-semibold transition hover:bg-white/70 disabled:opacity-50">{payablesLoading ? "Retrying..." : "Retry"}</button>
            </div>}
            {payablesLoading && !payablesReady ? <p className="px-5 py-9 text-sm text-[#806A8C]">Loading supplier purchases...</p> :
                filteredPayables.length === 0 ? <p className="px-5 py-9 text-sm text-[#806A8C]">{payablesReady ? "No supplier purchases match the selected filters." : "Supplier purchase records are unavailable."}</p> :
                    <div className="h-[310px] w-full overflow-y-auto overflow-x-auto overscroll-contain" aria-label="Scrollable supplier payment table" tabIndex={0}><table className="w-full min-w-[1030px] table-fixed border-collapse">
                        <colgroup><col className="w-[12%]"/><col className="w-[15%]"/><col className="w-[9%]"/><col className="w-[10%]"/><col className="w-[10%]"/><col className="w-[12%]"/><col className="w-[12%]"/><col className="w-[11%]"/><col className="w-[9%]"/></colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]"><tr className="h-[40px] border-b border-[#E6DDF0]"><OwnerTableTh>Purchase No.</OwnerTableTh><OwnerTableTh>Supplier</OwnerTableTh><OwnerTableTh>Method</OwnerTableTh><OwnerTableTh right>Total</OwnerTableTh><OwnerTableTh right>Paid</OwnerTableTh><OwnerTableTh right>Outstanding</OwnerTableTh><OwnerTableTh>Payment Deadline</OwnerTableTh><OwnerTableTh>Status</OwnerTableTh><OwnerTableTh>Action</OwnerTableTh></tr></thead>
                        <tbody>{filteredPayables.map(row => <tr key={row.purchaseId} className="h-[54px] border-b border-[#EEE7F2] last:border-b-0 hover:bg-[#FFFCF9]">
                            <td className="px-3 py-2.5 text-xs font-semibold text-[#4E2DB8]"><button type="button" className="text-left hover:underline" onClick={() => void openPurchase(row, "view")}>{row.purchaseNumber}</button></td>
                            <td className="px-3 py-2.5 text-xs text-[#21132E]">{row.supplier || "—"}</td>
                            <td className="px-3 py-2.5 text-xs text-[#5F4E75]">{row.paymentMethod === "cash" ? "Cash" : "Credit"}</td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[#5F4E75]">{formatPeso(Number(row.purchaseTotal) || 0)}</td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[#5F4E75]">{formatPeso(Number(row.amountPaid) || 0)}</td>
                            <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-[#2B174C]">{formatPeso(Number(row.outstandingBalance) || 0)}</td>
                            <td className={`whitespace-nowrap px-3 py-2.5 text-xs tabular-nums ${payableIsOverdue(row) ? "font-semibold text-[#C32F2F]" : "text-[#5F4E75]"}`}>{formatShortDate(row.paymentDueDate)}</td>
                            <td className="px-3 py-2.5"><PayableBadge status={payableStatus(row)}/></td>
                            <td className="px-3 py-2.5">{Number(row.outstandingBalance) > 0 ?
                                <button type="button" onClick={() => void openPurchase(row, "pay")} className="inline-flex min-w-[82px] justify-center rounded-lg bg-[#2B174C] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1B0D31]">Pay Now</button> :
                                <button type="button" onClick={() => void openPurchase(row, "view")} className="inline-flex min-w-[82px] justify-center rounded-lg border border-[#DDD2ED] bg-[#F7F1FF] px-3 py-1.5 text-[11px] font-semibold text-[#2B174C] hover:bg-[#EFE6FF]"><Eye size={13} className="mr-1"/>View</button>}</td>
                        </tr>)}</tbody>
                    </table></div>}
            {filteredPayables.length > 0 && <p className="border-t border-[#EEE7F2] px-4 py-2.5 text-[11px] text-[#806A8C]" role="status">
                Showing {filteredPayables.length.toLocaleString("en-PH")} of {payables.length.toLocaleString("en-PH")} supplier purchases · Scroll inside the table to see all records
            </p>}
        </section>

        <section className="scroll-mt-32 overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="relative z-20 flex flex-col gap-3 border-b border-[#E6DDF0] p-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1ECFF] text-[#5F35D8]"><ShoppingCart size={20}/></span><div><h2 className="text-[16px] font-bold text-[#21132E]">Inventory Purchasing Overview</h2><p className="mt-0.5 text-[11px] text-[#86778F]">Stock investment and recorded POS sales across branches (last 12 months).</p></div></div>
                <div className="flex flex-1 flex-wrap gap-2 xl:justify-end">
                    <div className="relative min-w-[185px] flex-1 xl:max-w-[240px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/><input aria-label="Search products" value={productSearch} onChange={event => { setProductSearch(event.target.value); resetPurchasingScroll(); }} placeholder="Search product no. or name..." className="h-10 w-full rounded-xl border border-[#E3D8EA] bg-white pl-9 pr-3 text-xs text-[#21132E] outline-none focus:border-[#2B174C]"/></div>
                    <select aria-label="Filter products by category" value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); resetPurchasingScroll(); }} className="h-10 max-w-[180px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none"><option>All Categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
                    <select aria-label="Filter products by branch" value={branchFilter} onChange={event => { setBranchFilter(event.target.value); resetPurchasingScroll(); }} className="h-10 max-w-[190px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none"><option>All Branches</option>{branches.map(value => <option key={value}>{value}</option>)}</select>
                    <OwnerReportExportMenu source="purchasing" disabled={!filteredPurchasingRows.length} onExport={downloadOwnerReport}/>
                </div>
            </div>
            {salesError && <div role="alert" className="mx-4 mt-3 rounded-lg border border-[#F2C4C4] bg-[#FFF0F0] p-3 text-xs text-[#C32F2F]">POS sales are unavailable: {salesError}. Stock values are still shown; sales metrics are not estimated.</div>}
            {salesLoading && <p className="px-4 pt-3 text-xs text-[#806A8C]">Loading sales metrics...</p>}
            {filteredPurchasingRows.length === 0 ? <div className="p-4"><EmptyInventory message="No products found for the selected filters."/></div> :
                <div ref={purchasingScrollRef} onScroll={onPurchasingScroll}
                     className="max-h-[610px] w-full overflow-y-auto overflow-x-hidden overscroll-contain"
                     aria-label="Scrollable inventory purchasing table" tabIndex={0}>
                    <table className="w-full table-fixed text-[10px] xl:text-[11px]">
                        <colgroup>
                            <col className="w-[11%]"/>
                            <col className="w-[18%]"/>
                            <col className="w-[17%]"/>
                            <col className="w-[14%]"/>
                            <col className="w-[12%]"/>
                            <col className="w-[8%]"/>
                            <col className="w-[12%]"/>
                            <col className="w-[8%]"/>
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                        <tr className="border-b border-[#E9E1EE]">
                            <OwnerTableTh center>Product No.</OwnerTableTh>
                            <OwnerTableTh>Product</OwnerTableTh>
                            <OwnerTableTh>Branch</OwnerTableTh>
                            <OwnerTableTh>Category</OwnerTableTh>
                            <OwnerTableTh center>Stock Value</OwnerTableTh>
                            <OwnerTableTh center>Units Sold</OwnerTableTh>
                            <OwnerTableTh center>Sales Revenue</OwnerTableTh>
                            <OwnerTableTh center>Sales Velocity</OwnerTableTh>
                        </tr>
                        </thead>
                        <tbody>
                        {visiblePurchasingRows.map(row => {
                            const expandable = row.variants.length > 0;
                            const expanded = Boolean(expandedProductIds[row.id]);
                            return <React.Fragment key={row.id}>
                                <tr className="border-b border-[#EFE8F2] hover:bg-[#FFFCF8]">
                                    <td className="break-words px-2 py-2.5 text-center font-mono text-[9px] font-semibold text-[#5F4E75] xl:text-[10px]">
                                        <div className="flex items-center justify-center gap-1">
                                            {expandable ? <button type="button"
                                                                  aria-label={`${expanded ? "Collapse" : "Expand"} variants of ${row.productName}`}
                                                                  aria-expanded={expanded}
                                                                  onClick={() => setExpandedProductIds(current => ({ ...current, [row.id]: !current[row.id] }))}
                                                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#5F35D8] hover:bg-[#F1EBFF] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5F35D8]"
                                                                  title={expanded ? "Hide variants" : "Show variants"}>
                                                <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`}/>
                                            </button> : <span className="inline-block w-6 shrink-0"/>}
                                            <span>{row.productNumber}</span>
                                        </div>
                                    </td>
                                    <td className="break-words px-3 py-2.5 font-semibold text-[#2B174C]">{row.productName}</td>
                                    <td className="break-words px-2 py-2.5 text-[#5F4E75]">{row.branchName}</td>
                                    <td className="break-words px-2 py-2.5 text-[#5F4E75]">{row.category}</td>
                                    <td className="break-words px-2 py-2.5 text-center font-semibold tabular-nums text-[#2B174C]">{formatPeso(row.stockValue)}</td>
                                    <td className="px-2 py-2.5 text-center tabular-nums text-[#5F4E75]">{salesReady ? formatNumber(row.unitsSold) : "—"}</td>
                                    <td className="break-words px-2 py-2.5 text-center tabular-nums text-[#5F4E75]" title={row.salesRevenue === null ? "Recorded line-level POS selling prices are not available." : "Recorded POS line-item revenue"}>{row.salesRevenue === null ? "—" : formatPeso(row.salesRevenue)}</td>
                                    <td className="px-1 py-2.5 text-center"><OwnerVelocityBadge value={row.salesVelocity}/></td>
                                </tr>
                                {expandable && expanded && row.variants.map(variant =>
                                    <tr key={`${row.id}-variant-${variant.id}`} className="border-b border-[#EFE8F2] bg-[#FCF9FF]">
                                        <td className="break-all px-2 py-2.5 text-center font-mono text-[9px] text-[#9B8AAA]" title="Variant Number">{variant.variantNumber}</td>
                                        <td className="break-words px-3 py-2.5 pl-8 text-[10px] font-semibold text-[#5F3D82]">↳ {variant.variantName}</td>
                                        <td className="break-words px-2 py-2.5 text-[#8A7D90]">{row.branchName}</td>
                                        <td className="break-words px-2 py-2.5 text-[#8A7D90]">Variant</td>
                                        <td className="break-words px-2 py-2.5 text-center font-semibold tabular-nums text-[#2B174C]">{formatPeso(variant.stockValue)}</td>
                                        <td className="px-2 py-2.5 text-center tabular-nums text-[#5F4E75]" title={variant.unitsSold === null ? "POS sales cannot be reliably attributed to this variant." : "Recorded variant POS units sold"}>{variant.unitsSold === null ? "—" : formatNumber(variant.unitsSold)}</td>
                                        <td className="break-words px-2 py-2.5 text-center tabular-nums text-[#5F4E75]" title={variant.salesRevenue === null ? "Recorded variant POS line revenue is unavailable." : "Recorded variant POS line revenue"}>{variant.salesRevenue === null ? "—" : formatPeso(variant.salesRevenue)}</td>
                                        <td className="px-2 py-2.5 text-center text-[#8A7D90]" title="Sales velocity is ranked per product within its branch.">—</td>
                                    </tr>)}
                            </React.Fragment>;
                        })}
                        </tbody>
                    </table>
                </div>}
            <p className="border-t border-[#EEE7F2] px-4 py-2.5 text-[11px] text-[#806A8C]" role="status">
                Showing {Math.min(visibleProductCount, filteredPurchasingRows.length).toLocaleString("en-PH")} of {filteredPurchasingRows.length.toLocaleString("en-PH")} products · Scroll down to see more
            </p>
            <p className="border-t border-[#EEE7F2] px-4 py-2.5 text-[10px] leading-4 text-[#86778F]">Stock Value uses current stock × inventory cost. Units Sold and Sales Velocity use completed POS transactions over the previous 12 months. Sales Revenue appears only when recorded POS line-item prices are available. H/M/L is ranked within each branch. Expanded variants show saved Variant Numbers and stock value; variant sales appear only when POS records identify the variant.</p>
        </section>

        {dialog && <div role="dialog" aria-modal="true" aria-label={dialog.mode === "pay" ? "Record supplier payment" : "View supplier purchase"} className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#E3D8EA] px-5 py-4"><div><h2 className="text-lg font-bold text-[#2B174C]">{dialog.mode === "pay" ? "Pay Supplier" : "Purchase Details"}</h2><p className="mt-0.5 text-xs text-[#806A8C]">{dialog.record.purchaseNumber} · {dialog.record.supplier}</p></div><button type="button" aria-label="Close dialog" disabled={savingPayment} onClick={() => setDialog(null)} className="rounded-lg p-2 text-[#806A8C] hover:bg-[#F7F1FF]"><X size={20}/></button></div>
                <div className="space-y-4 overflow-y-auto p-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl bg-[#FBF8FF] p-3"><p className="text-xs text-[#806A8C]">Total Purchase</p><p className="mt-1 text-lg font-bold text-[#2B174C]">{formatPeso(Number(dialog.record.purchaseTotal))}</p></div>
                        <div className="rounded-xl bg-[#FBF8FF] p-3"><p className="text-xs text-[#806A8C]">Outstanding Balance</p><p className="mt-1 text-lg font-bold text-[#2B174C]">{formatPeso(Number(dialog.record.outstandingBalance))}</p></div>
                        <div className="text-xs text-[#5F4E75]">Already Paid: <strong>{formatPeso(Number(dialog.record.amountPaid))}</strong></div>
                        <div className="text-xs text-[#5F4E75]">Due Date: <strong>{formatShortDate(dialog.record.paymentDueDate)}</strong></div>
                        <div className="text-xs text-[#5F4E75]">Purchase Date: <strong>{formatShortDate(dialog.record.purchaseDate)}</strong></div>
                        <div className="text-xs text-[#5F4E75]">Invoice: <strong>{dialog.record.supplierInvoiceNumber || "—"}</strong></div>
                    </div>
                    {dialogError && <p role="alert" className="rounded-lg border border-[#F2C4C4] bg-[#FFF0F0] p-3 text-xs text-[#C32F2F]">{dialogError}</p>}
                    {dialog.mode === "view" ? <section className="space-y-3"><h3 className="text-sm font-bold text-[#2B174C]">Products in this Purchase</h3>
                            {itemsLoading ? <p className="text-xs text-[#806A8C]">Loading purchased items...</p> : purchaseItems.length === 0 ? <p className="text-xs text-[#806A8C]">No line items available.</p> :
                                <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-[#FFFCF7] text-[#806A8C]"><tr><th className="p-2">Product / Variant</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit Cost</th><th className="p-2 text-right">Line Total</th></tr></thead><tbody>{purchaseItems.map((item, idx) => <tr key={`${item.productId}-${item.variantId ?? "regular"}-${idx}`} className="border-b border-[#EEE7F2]"><td className="p-2"><strong>{item.productName}</strong> {item.productNumber || ""}{item.variantNumber ? <p className="text-[#806A8C]">Variant {item.variantNumber}</p> : null}</td><td className="p-2 text-right">{formatNumber(Number(item.quantity))}</td><td className="p-2 text-right">{formatPeso(Number(item.unitCost))}</td><td className="p-2 text-right">{formatPeso(Number(item.lineTotal))}</td></tr>)}</tbody></table></div>}
                            <p className="text-[11px] text-[#806A8C]">Purchase quantities are historical records; they do not represent current remaining stock.</p>
                        </section> :
                        <form onSubmit={preparePayment} className="space-y-4">
                            <p className="text-xs text-[#806A8C]">Record a payment against this purchase. This reduces the supplier balance and does not change product stock.</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-1 text-xs font-semibold text-[#5A476A]">Amount Paid (₱)<input type="number" min="0.01" max={dialog.record.outstandingBalance} step="0.01" required disabled={confirmPayment || savingPayment} value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} className="h-11 w-full rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm text-[#21132E] outline-none focus:border-[#2B174C]"/></label>
                                <label className="space-y-1 text-xs font-semibold text-[#5A476A]">Payment Date<input type="date" required disabled={confirmPayment || savingPayment} value={paymentDate} onChange={event => setPaymentDate(event.target.value)} className="h-11 w-full rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm text-[#21132E] outline-none focus:border-[#2B174C]"/></label>
                            </div>
                            {confirmPayment && <p className="rounded-lg border border-[#D8CBE7] bg-[#F7F1FF] p-3 text-sm text-[#2B174C]">Confirm payment of <strong>{formatPeso(Number(paymentAmount))}</strong> for <strong>{dialog.record.purchaseNumber}</strong> on {formatShortDate(paymentDate)}?</p>}
                            <div className="flex flex-wrap justify-end gap-2">{confirmPayment ? <><button type="button" disabled={savingPayment} onClick={() => setConfirmPayment(false)} className="rounded-xl border border-[#E3D8EA] px-4 py-2.5 text-xs font-semibold text-[#2B174C]">Back</button><button type="button" disabled={savingPayment} onClick={() => void recordPayment()} className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{savingPayment ? "Recording..." : "Confirm Payment"}</button></> : <button type="submit" disabled={savingPayment} className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-xs font-semibold text-white">Continue</button>}</div>
                        </form>}
                </div>
            </div>
        </div>}
    </main>;
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

const OWNER_RISK_DEFINITIONS: Record<AtRiskCategoryKey, string> = {
    expired: "Current remaining stock past its recorded expiration date. Value = affected stock × unit acquisition cost; this category takes priority over inactivity.",
    expiringSoon: "Current remaining stock expiring today or within the next 30 days. Value = affected stock × unit acquisition cost; expired stock is excluded.",
    deadStock: "Current stock with no verified sale for at least 180 days, using product/variant creation and dated POS history when available. Missing or ambiguous sales data are not treated as zero sales.",
    slowMoving: "Current stock with no verified sale for 90–179 days, based on creation and dated POS history when available. Items already expired or expiring soon are excluded.",
};

function AtRiskInventoryBreakdownCard({
                                          breakdown,
                                      }: {
    breakdown: AtRiskBreakdown;
}) {
    return (
        <section className="min-w-0 rounded-[16px] border border-[#E8E1ED] bg-white p-4 shadow-[0_1px_3px_rgba(43,23,76,0.08)]">
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

            <div className="grid w-full min-w-0 grid-cols-1 items-center gap-3 py-1 sm:grid-cols-[minmax(0,152px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,170px)_minmax(0,1fr)]">
                <div className="relative mx-auto aspect-square w-full min-w-0 max-w-[170px]">
                    <div
                        className="h-full w-full rounded-full"
                        style={{ background: breakdown.gradient }}
                    />

                    <div className="absolute inset-[19%] flex min-w-0 flex-col items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_#F1EDF3]">
                        <span className="max-w-full px-1 text-center text-[clamp(12px,1vw,17px)] font-bold leading-none text-[#23122F]">
                            {formatCompactPeso(breakdown.total)}
                        </span>
                        <span className="mt-2 text-[10px] font-medium text-[#8A7D90]">
                            At-Risk Value
                        </span>
                    </div>
                </div>

                <div className="min-w-0 divide-y divide-[#EEE8F1]">
                    {breakdown.rows.map((row) => (
                        <div
                            key={row.key}
                            className="group relative grid min-h-[42px] min-w-0 grid-cols-[10px_minmax(0,1fr)_minmax(72px,125px)_36px] items-center gap-1.5 py-1.5 text-[11px] hover:z-20 focus-within:z-20"
                            tabIndex={0}
                            aria-label={`${row.label}: ${OWNER_RISK_DEFINITIONS[row.key]}`}
                        >
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: row.color }}
                            />

                            <span className="min-w-0 break-words font-medium text-[#51445A]">
                                {row.label}
                            </span>

                            <span className="min-w-0 break-words text-right text-[10px] font-bold tabular-nums text-[#23122F]">
                                {formatPeso(row.value)}
                            </span>

                            <span className="text-right font-medium text-[#8A7D90]">
                                {row.percentage.toFixed(1)}%
                            </span>
                            <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-1 hidden w-[min(300px,80vw)] rounded-xl border border-[#E3D8EA] bg-white px-3 py-2 text-left text-[11px] font-normal leading-4 text-[#51445A] shadow-[0_8px_25px_rgba(43,23,76,0.18)] group-hover:block group-focus:block">
                                <strong className="block pb-1 text-[#2B174C]">{row.label}</strong>
                                {OWNER_RISK_DEFINITIONS[row.key]}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
