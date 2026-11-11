"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import ManagerRentalInventory from "@/components/inventory/ManagerRentalInventory";
import {
    AlertTriangle,
    Boxes,
    CalendarClock,
    CheckCircle2,
    ChevronDown,
    ClipboardList,
    PackagePlus,
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

// Keep Inventory filters visually consistent without changing their values or handlers.
function ManagerInventoryFilterSelect({ containerClassName = "", className = "", children, ...props }:
                                          React.ComponentProps<"select"> & { containerClassName?: string }) {
    return (
        <span className={`relative inline-flex min-w-0 ${containerClassName}`}>
            <select {...props} className={`h-9 w-full min-w-0 appearance-none rounded-xl border border-[#E3D8EA] bg-white py-1 pl-3 pr-9 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#BFA8E2] focus-visible:ring-2 focus-visible:ring-[#F1EBFF] ${className}`}>
                {children}
            </select>
            <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#806A8C]" />
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/*                                  TYPES                                     */
/* -------------------------------------------------------------------------- */

type ProductVariant = {
    sellableStock?: number;
    expiredBatchUnits?: number;
    branchStock?: number;
    batchStock?: number;
    ledgerMismatch?: boolean;
    id: number;
    productId: number;
    barcode?: string | number | null;
    variantNumber?: string | null;
    variantValues: Record<string, string>;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    pricingMethod?: InventoryPricingMethod;
    markupPercentage?: number | null;
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
    pricingMethod?: InventoryPricingMethod;
    markupPercentage?: number | null;
    expirationDate?: string | null;
};

type Product = {
    sellableStock?: number;
    expiredBatchUnits?: number;
    branchStock?: number;
    batchStock?: number;
    ledgerMismatch?: boolean;
    id: number;
    barcode?: string | number | null;
    productNumber?: string | null;
    product_number?: string | null;
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
    pricingMethod?: InventoryPricingMethod;
    markupPercentage?: number | null;
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
    pricingMethod?: InventoryPricingMethod;
    markupPercentage?: number | null;
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
    variantId: number | null;
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
    orderNumber?: string | null;
    order_number?: string | null;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    status?: string | null;
    orderStatus?: string | null;
    order_status?: string | null;
    transactionStatus?: string | null;
    transaction_status?: string | null;
    createdAt?: string | null;
    created_at?: string | null;
    completedAt?: string | null;
    completed_at?: string | null;
    paidAt?: string | null;
    paid_at?: string | null;
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
    hasRecordedTime?: boolean;
    source: string;
    referenceNumber?: string;
};

type RestockHistoryRecord = {
    id?: number | string | null;
    productId?: number | string | null;
    product_id?: number | string | null;
    product?: string | null;
    productName?: string | null;
    product_name?: string | null;
    variantName?: string | null;
    variant_name?: string | null;
    quantityAdded?: number | string | null;
    quantity_added?: number | string | null;
    date?: string | null;
    createdAt?: string | null;
    created_at?: string | null;
    restockDate?: string | null;
    restock_date?: string | null;
    time?: string | null;
    productNumber?: string | null;
    movementType?: string | null;
    isParentRow?: boolean;
    branchId?: number | string | null;
    branch_id?: number | string | null;
};

type InventoryEmployeeAction = {
    id?: number | string | null;
    action?: string | null;
    module?: string | null;
    referenceId?: number | string | null;
    reference_id?: number | string | null;
    referenceNumber?: string | null;
    reference_number?: string | null;
    details?: string | null;
    date?: string | null;
    time?: string | null;
    createdAt?: string | null;
    created_at?: string | null;
    branchId?: number | string | null;
    branch_id?: number | string | null;
};

type InventoryReportsResponse = {
    success?: boolean;
    data?: {
        restockHistory?: RestockHistoryRecord[];
        employeeActions?: InventoryEmployeeAction[];
    };
    error?: string;
};

type LastStockInRecord = {
    productId: number | string;
    variantId?: number | string | null;
    variantName?: string | null;
    stockInDate: string;
};

type ExpiredDisposalActivityRecord = {
    id: number;
    recordedAt?: string | null;
    productName: string;
    variantValues?: Record<string, string> | string | null;
    quantity: number;
};

type RecentStockMovement = {
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    date: Date | null;
    hasRecordedTime?: boolean;
    movement: "Stock In" | "Stock Out" | "Disposed";
    source: "Added" | "Restock" | "POS Sale" | "Expired Disposal";
    referenceNumber?: string;
};

type SalesVelocityLabel = "High" | "Medium" | "Low";

type ActionCenterRow = {
    id: string;
    product: Product;
    // Preserve the specific affected variant in the stock-risk review dialog.
    variantId?: number | null;
    expirationDate?: string | null;
    productName: string;
    currentStock: number;
    reorderPoint: number;
    salesVelocity: SalesVelocityLabel;
    salesVelocityValue: number;
    issue:
        | "Out of Stock"
        | "Low Stock"
        | "Expired"
        | "Expiring"
        | "Slow Moving";
    action:
        | "Restock Now"
        | "Restock"
        | "Review / Remove"
        | "Dispose Expired"
        | "Prioritize Sale"
        | "Do Not Restock";
};

type ActionCenterFilter =
    | "All"
    | "Low Stock Items"
    | "Out of Stock Items"
    | "Expiring / Expired"
    | "Slow Moving";

// Inventory downloads reuse the same report format as StockNBook's management modules.
async function downloadManagerInventoryReport(
    title: string, headers: string[], rows: string[][],
    branchName: string, dateRange: string, filename: string
) {
    const { exportTableAsPdf } = await import("@/components/dashboard/_shared");
    exportTableAsPdf({ title, headers, rows }, {
        storeName: sessionStorage.getItem("store_name") || "StockNBook",
        branch: branchName,
        dateRange,
    }, filename);
}

function manilaActivityDateKey(value: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(value);
    const part = (type: string) => parts.find(item => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}

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

function formatImportExpirationDate(value: unknown) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return "—";

        return value.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const parsed = XLSX.SSF.parse_date_code(value);

        if (!parsed) return "—";

        const date = new Date(
            parsed.y,
            Math.max(0, parsed.m - 1),
            parsed.d
        );

        if (Number.isNaN(date.getTime())) return "—";

        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }

    const raw = String(value).trim();
    if (!raw) return "—";

    // Keep support for the system's normal ISO date format.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return formatDate(raw);
    }

    // Support the dd/mm/yyyy format shown in the StockNBook template.
    const dayFirstMatch = raw.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

    if (dayFirstMatch) {
        const day = Number(dayFirstMatch[1]);
        const month = Number(dayFirstMatch[2]);
        const year = Number(dayFirstMatch[3]);

        const date = new Date(year, month - 1, day);

        if (
            !Number.isNaN(date.getTime()) &&
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        ) {
            return date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
            });
        }
    }

    const parsed = new Date(raw);

    if (Number.isNaN(parsed.getTime())) return "—";

    return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function parseStockActivityDateTime(
    dateValue?: string | null,
    timeValue?: string | null
) {
    const rawDate = String(dateValue || "").trim();
    const rawTime = String(timeValue || "").trim();

    if (!rawDate) return null;

    // Reports may provide the date and time as separate fields.
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawTime) {
        const twelveHourMatch = rawTime.match(
            /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i
        );

        if (twelveHourMatch) {
            let hour = Number(twelveHourMatch[1]);
            const minute = Number(twelveHourMatch[2]);
            const second = Number(twelveHourMatch[3] || 0);
            const meridiem = twelveHourMatch[4].toLowerCase();

            if (hour === 12) hour = 0;
            if (meridiem === "pm") hour += 12;

            const candidate = new Date(
                `${rawDate}T${String(hour).padStart(2, "0")}:${String(
                    minute
                ).padStart(2, "0")}:${String(second).padStart(2, "0")}`
            );

            return Number.isNaN(candidate.getTime()) ? null : candidate;
        }

        if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(rawTime)) {
            const candidate = new Date(
                `${rawDate}T${rawTime.length === 5 ? `${rawTime}:00` : rawTime}`
            );

            return Number.isNaN(candidate.getTime()) ? null : candidate;
        }
    }

    // MySQL DATETIME strings are safest to parse with a T separator.
    const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(rawDate)
        ? rawDate.replace(/\s+/, "T")
        : rawDate;

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatStockActivityDate(value: Date | null) {
    if (!value) return "—";

    return value.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatStockActivityTime(value: Date | null) {
    if (!value) return "—";

    return value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();
}

function getActivityRecordProductId(value: {
    productId?: number | string | null;
    product_id?: number | string | null;
}) {
    const numeric = Number(value.productId ?? value.product_id);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "";
}

function getActivityRecordProductName(value: RestockHistoryRecord) {
    const baseName = String(
        value.product ??
        value.productName ??
        value.product_name ??
        "Unknown Product"
    ).trim();

    const variantName = String(
        value.variantName ??
        value.variant_name ??
        ""
    ).trim();

    return variantName ? `${baseName} - ${variantName}` : baseName;
}

function getRestockActionDate(
    record: RestockHistoryRecord,
    employeeActions: InventoryEmployeeAction[]
) {
    const productId = getActivityRecordProductId(record);
    const rawRestockDate =
        record.createdAt ??
        record.created_at ??
        record.date ??
        record.restockDate ??
        record.restock_date ??
        null;

    const restockDate = parseStockActivityDateTime(rawRestockDate);
    const restockDay = restockDate
        ? restockDate.toLocaleDateString("en-CA")
        : String(rawRestockDate || "").slice(0, 10);

    const matchingAction = employeeActions
        .filter((action) => {
            const actionName = String(action.action || "").trim().toLowerCase();
            if (!actionName.includes("restocked inventory")) return false;

            const actionProductId = String(
                action.referenceId ??
                action.reference_id ??
                ""
            ).trim();

            if (productId && actionProductId && actionProductId !== productId) {
                return false;
            }

            const actionDate = parseStockActivityDateTime(
                action.createdAt ??
                action.created_at ??
                action.date ??
                null,
                action.time ?? null
            );

            if (!restockDay || !actionDate) return true;

            return actionDate.toLocaleDateString("en-CA") === restockDay;
        })
        .map((action) =>
            parseStockActivityDateTime(
                action.createdAt ??
                action.created_at ??
                action.date ??
                null,
                action.time ?? null
            )
        )
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0];

    // Employee actions preserve the exact action time. Prefer that timestamp
    // when the Restock Report only exposes a date.
    return matchingAction || restockDate;
}

function buildRestockMovements(
    records: RestockHistoryRecord[],
    employeeActions: InventoryEmployeeAction[],
    branchId?: number
): RecentStockMovement[] {
    return records
        .filter((record) => {
            if (!branchId || !Number.isFinite(branchId) || branchId <= 0) {
                return true;
            }

            const rawBranchId = record.branchId ?? record.branch_id;
            return (
                rawBranchId === null ||
                rawBranchId === undefined ||
                rawBranchId === "" ||
                Number(rawBranchId) === branchId
            );
        })
        .map((record, index): RecentStockMovement | null => {
            const quantity = Math.max(
                0,
                Number(record.quantityAdded ?? record.quantity_added ?? 0)
            );

            if (quantity <= 0) return null;
            // A variant product's parent row is never shown; only its variants are.
            if (record.isParentRow) return null;

            const productId = getActivityRecordProductId(record);
            const recordedDay = record.date ?? record.restockDate ?? record.restock_date ?? null;

            return {
                id: `restock-${String(record.id ?? index)}`,
                productId,
                productName: getActivityRecordProductName(record),
                quantity,
                // Each stock-in movement carries its own exact time.
                date: record.time
                    ? parseStockActivityDateTime(recordedDay, record.time)
                    : getRestockActionDate(record, employeeActions),
                movement: "Stock In" as const,
                // New-product opening stock is "Added"; later receipts are "Restock".
                source: String(record.movementType || "").toUpperCase() === "OPENING_STOCK"
                    ? "Added" as const
                    : "Restock" as const,
                referenceNumber: String(record.productNumber || "").trim(),
            };
        })
        .filter(
            (movement): movement is RecentStockMovement =>
                movement !== null
        );
}

function buildExpiredDisposalMovements(records: ExpiredDisposalActivityRecord[]): RecentStockMovement[] {
    return records.map((record) => {
        let variantValues: Record<string, unknown> = {};
        if (record.variantValues && typeof record.variantValues === "object") {
            variantValues = record.variantValues;
        } else if (typeof record.variantValues === "string") {
            try {
                const parsed: unknown = JSON.parse(record.variantValues);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    variantValues = parsed as Record<string, unknown>;
                }
            } catch { /* Preserve the base product name when variant metadata is unavailable. */ }
        }
        const variantName = Object.values(variantValues)
            .map((value) => String(value ?? "").trim())
            .filter(Boolean).join(", ");
        const quantity = Math.abs(Number(record.quantity));
        return {
            id: `expired-disposal-${record.id}`,
            productId: "",
            productName: variantName ? `${record.productName} - ${variantName}` : record.productName,
            quantity,
            date: parseStockActivityDateTime(record.recordedAt),
            movement: "Disposed" as const,
            source: "Expired Disposal" as const,
            referenceNumber: `DISP-${String(record.id).padStart(6, "0")}`,
        };
    }).filter((movement) => movement.quantity > 0 && Boolean(movement.productName));
}

function buildRecentStockMovements({
                                       salesMovements,
                                       restockRecords,
                                       employeeActions,
                                       branchId,
                                       disposalRecords,
                                   }: {
    salesMovements: SalesMovement[];
    restockRecords: RestockHistoryRecord[];
    employeeActions: InventoryEmployeeAction[];
    branchId?: number;
    disposalRecords: ExpiredDisposalActivityRecord[];
}) {
    // Added and restocked stock both come from the recorded stock-in movements,
    // one row per product or variant, so each stock-in appears exactly once.
    const restockMovements = buildRestockMovements(
        restockRecords,
        employeeActions,
        branchId
    );

    const stockOutMovements: RecentStockMovement[] = salesMovements.map(
        (movement, index) => ({
            id: `sale-${movement.productId || movement.productName}-${index}-${movement.date?.getTime() ?? 0}`,
            productId: movement.productId,
            productName: movement.productName,
            quantity: movement.quantity,
            date: movement.date,
            hasRecordedTime: movement.hasRecordedTime,
            movement: "Stock Out",
            source: "POS Sale",
            referenceNumber: movement.referenceNumber || "",
        })
    );

    return [
        ...restockMovements,
        ...stockOutMovements,
        ...buildExpiredDisposalMovements(disposalRecords),
    ]
        .filter((movement) => Boolean(movement.productName))
        .sort((a, b) => {
            const aTime = a.date?.getTime() ?? 0;
            const bTime = b.date?.getTime() ?? 0;
            return bTime - aTime;
        })
        .slice(0, 100);
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
            variantId: variant.id,
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
            variantId: null,
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

// A recorded positive restock wins over opening stock. The separate products
// endpoint provides all-time restock dates, not only the last 30 days used by
// Recent Stock Activity. Only this table and its matching export use this map.
function readStockInCalendarDate(value: unknown): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    // The API returns database calendar dates already normalized to YYYY-MM-DD.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parsed = new Date(`${raw}T00:00:00`);
        return !Number.isNaN(parsed.getTime()) &&
        parsed.getFullYear() === Number(raw.slice(0, 4)) &&
        parsed.getMonth() + 1 === Number(raw.slice(5, 7)) &&
        parsed.getDate() === Number(raw.slice(8, 10))
            ? raw : "";
    }

    // createdAt arrives as an ISO timestamp from MySQL. Use the business's
    // Philippine calendar day rather than taking the UTC date prefix.
    const date = parseStockActivityDateTime(raw);
    if (!date) return "";
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const part = (name: string) => parts.find((p) => p.type === name)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}

function buildLastStockInDates(
    products: Product[],
    records: LastStockInRecord[]
) {
    const productDates: Record<number, string> = {};
    const variantDates: Record<string, string> = {};
    const today = readStockInCalendarDate(new Date().toISOString());

    const newer = (current: string, candidate: string) =>
        candidate && candidate <= today && candidate > current ? candidate : current;

    // For existing records with opening inventory, creation is the earliest
    // available stock-in date. Do not label a zero-stock creation as Stock In.
    products.forEach((product) => {
        const openingDate = readStockInCalendarDate(product.createdAt);
        const variants = product.hasVariants ? product.variants || [] : [];
        if (variants.length > 0) {
            variants.forEach((variant) => {
                if (Number(variant.stock) <= 0) return;
                const date = readStockInCalendarDate(variant.createdAt || product.createdAt);
                const key = `${product.id}:${variant.id}`;
                variantDates[key] = newer(variantDates[key] || "", date);
                productDates[product.id] = newer(productDates[product.id] || "", date);
            });
        } else if (Number(product.stock) > 0) {
            productDates[product.id] = newer(productDates[product.id] || "", openingDate);
        }
    });

    records.forEach((record) => {
        const productId = Number(record.productId);
        if (!Number.isInteger(productId) || productId <= 0) return;
        const product = products.find((item) => Number(item.id) === productId);
        if (!product) return;
        const date = readStockInCalendarDate(record.stockInDate);
        if (!date || date > today) return;

        productDates[productId] = newer(productDates[productId] || "", date);
        const variantName = normalizeLookupText(record.variantName || "");
        const variantId = Number(record.variantId || 0);
        if (!variantName && !variantId) return;
        (product.variants || []).forEach((variant) => {
            if (variantId ? Number(variant.id)!==variantId
                : normalizeLookupText(getVariantName(variant)) !== variantName) return;
            const key = `${productId}:${variant.id}`;
            variantDates[key] = newer(variantDates[key] || "", date);
        });
    });

    return { productDates, variantDates };
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

// Recent Stock Activity must use the recorded POS transaction timestamp,
// not order_date if that field only represents the calendar day.
function getPosSaleActivityTime(order: ManagerPosOrder): {
    date: Date | null;
    hasRecordedTime: boolean;
} {
    // Completion/payment timestamps take precedence if the POS API provides them.
    // created_at is normally the exact timestamp for an immediately completed sale.
    const exactCandidates = [
        order.completedAt,
        order.completed_at,
        order.paidAt,
        order.paid_at,
        order.createdAt,
        order.created_at,
    ];

    // Check actual event timestamps first; order_date may only be a DATE column.
    for (const value of exactCandidates) {
        const raw = String(value ?? "").trim();
        // Do not turn a date-only order_date into a fabricated sale time.
        if (!/^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}/.test(raw)) {
            continue;
        }

        const date = parseStockActivityDateTime(raw);
        if (date) return { date, hasRecordedTime: true };
    }

    // Some POS APIs provide the full transaction time in order_date itself.
    // A midnight-UTC ISO value in that field can instead be a serialized SQL
    // DATE; do not mistake that for an 8:00 AM sale in the Philippines.
    for (const value of [order.orderDate, order.order_date, order.date]) {
        const raw = String(value ?? "").trim();
        if (/T00:00:00(?:\.0+)?Z$/i.test(raw)) continue;
        if (!/^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}/.test(raw)) continue;
        const date = parseStockActivityDateTime(raw);
        if (date) return { date, hasRecordedTime: true };
    }

    // A date-only record can still appear in the correct day's activity list,
    // but it must never be labeled with a misleading 8:00 AM / 12:00 AM time.
    for (const value of [
        order.orderDate, order.order_date, order.date,
        order.createdAt, order.created_at,
    ]) {
        const day = String(value ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|T00:00:00(?:\.\d+)?Z$)/);
        if (!day) continue;

        const date = new Date(`${day[1]}T00:00:00`);
        if (!Number.isNaN(date.getTime())) {
            return { date, hasRecordedTime: false };
        }
    }

    return { date: null, hasRecordedTime: false };
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

function getOrderStatus(order: ManagerPosOrder) {
    return String(
        order.status ??
        order.orderStatus ??
        order.order_status ??
        order.transactionStatus ??
        order.transaction_status ??
        ""
    )
        .trim()
        .toLowerCase();
}

function isCompletedPosOrder(order: ManagerPosOrder) {
    const status = getOrderStatus(order);

    // The POS get_orders endpoint is used for recorded sales. When it also
    // provides a status, explicitly reject cancelled/invalid/non-completed rows.
    if (!status) return true;

    if (
        status.includes("cancel") ||
        status.includes("invalid") ||
        status.includes("void") ||
        status.includes("refund") ||
        status.includes("pending") ||
        status.includes("fail")
    ) {
        return false;
    }

    return (
        status.includes("complete") ||
        status.includes("paid") ||
        status.includes("success")
    );
}

function isOrderForBranch(order: ManagerPosOrder, branchId?: number) {
    if (!branchId || !Number.isFinite(branchId) || branchId <= 0) return true;

    const rawBranchId = order.branchId ?? order.branch_id;
    if (rawBranchId === null || rawBranchId === undefined || rawBranchId === "") {
        // The request itself is already scoped with branch_id.
        return true;
    }

    return Number(rawBranchId) === branchId;
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

function getPosOrderReference(order: ManagerPosOrder) {
    // Prefer a saved Order No.; otherwise display the REAL order primary key.
    return String(
        order.orderNumber ?? order.order_number ??
        order.orderId ?? order.order_id ?? order.id ?? ""
    ).trim();
}

function getRecentThirtyDaySales(orders: ManagerPosOrder[], branchId?: number) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 29);

    const byProductId = new Map<string, number>();
    const byProductName = new Map<string, number>();
    const movements: SalesMovement[] = [];

    orders.forEach((order) => {
        if (!isCompletedPosOrder(order) || !isOrderForBranch(order, branchId)) return;

        const saleTime = getPosSaleActivityTime(order);
        const orderDate = saleTime.date;

        if (!orderDate || orderDate.getTime() < cutoff.getTime()) return;

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
                hasRecordedTime: saleTime.hasRecordedTime,
                source: "POS Sale",
                referenceNumber: getPosOrderReference(order),
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

type ProductSalesTotals = {
    byProductId: Map<string, number>;
    byProductName: Map<string, number>;
};

type ProductVelocityInfo = {
    value: number;
    label: SalesVelocityLabel;
    activeMonths: number;
};

function getTrailingTwelveMonthSales(
    orders: ManagerPosOrder[],
    branchId?: number
): ProductSalesTotals {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const cutoff = new Date(today);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    cutoff.setHours(0, 0, 0, 0);

    const byProductId = new Map<string, number>();
    const byProductName = new Map<string, number>();

    orders.forEach((order) => {
        if (!isCompletedPosOrder(order) || !isOrderForBranch(order, branchId)) return;

        const orderDate = getOrderDate(order);

        // Sales Velocity is historical only: use completed POS sales from the
        // trailing 12 months and ignore future-dated demo/seed transactions.
        if (
            !orderDate ||
            orderDate.getTime() < cutoff.getTime() ||
            orderDate.getTime() > today.getTime()
        ) {
            return;
        }

        getOrderItems(order).forEach((item) => {
            const quantity = getOrderItemQuantity(item);
            if (quantity <= 0) return;

            const productId = getOrderItemProductId(item);
            const productNameKey = normalizeSalesProductName(getOrderItemName(item));

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
        });
    });

    return { byProductId, byProductName };
}

function getProductUnitsSold(
    product: Product,
    sales: ProductSalesTotals
) {
    const byId = sales.byProductId.get(String(product.id));
    if (byId !== undefined) return byId;

    return sales.byProductName.get(normalizeSalesProductName(product.name)) || 0;
}

function getProductActiveMonths(product: Product) {
    const raw = product as Product & Record<string, unknown>;
    const createdValue =
        product.createdAt ??
        (raw.created_at as string | undefined) ??
        "";

    if (!createdValue) return 12;

    const createdAt = new Date(createdValue);
    if (Number.isNaN(createdAt.getTime())) return 12;

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const twelveMonthsAgo = new Date(today);
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    if (createdAt.getTime() <= twelveMonthsAgo.getTime()) return 12;
    if (createdAt.getTime() > today.getTime()) return 1;

    const averageMonthMilliseconds = 30.4375 * DAY_IN_MILLISECONDS;
    const activeMilliseconds = Math.max(
        DAY_IN_MILLISECONDS,
        today.getTime() - createdAt.getTime()
    );

    return Math.min(
        12,
        Math.max(1, Math.ceil(activeMilliseconds / averageMonthMilliseconds))
    );
}

function getSalesVelocity(unitsSold: number, activeMonths: number) {
    return Math.max(0, unitsSold) / Math.max(1, activeMonths);
}

function getProductVelocityMap(
    products: Product[],
    sales: ProductSalesTotals
): Map<string, ProductVelocityInfo> {
    const records = products.map((product) => {
        const activeMonths = getProductActiveMonths(product);
        const unitsSold = getProductUnitsSold(product, sales);
        const value = getSalesVelocity(unitsSold, activeMonths);

        return {
            productId: String(product.id),
            productName: product.name,
            value,
            activeMonths,
        };
    });

    const positiveRecords = records
        .filter((record) => record.value > 0)
        .sort((a, b) => {
            if (b.value !== a.value) return b.value - a.value;
            return a.productName.localeCompare(b.productName);
        });

    const labelByProductId = new Map<string, SalesVelocityLabel>();
    const positiveCount = positiveRecords.length;

    positiveRecords.forEach((record, index) => {
        const group = Math.min(
            2,
            Math.floor((index * 3) / Math.max(1, positiveCount))
        );

        labelByProductId.set(
            record.productId,
            group === 0 ? "High" : group === 1 ? "Medium" : "Low"
        );
    });

    const result = new Map<string, ProductVelocityInfo>();

    records.forEach((record) => {
        result.set(record.productId, {
            value: record.value,
            activeMonths: record.activeMonths,
            // Products with no completed POS sales in the period are naturally
            // part of the slowest-selling group.
            label: record.value <= 0
                ? "Low"
                : labelByProductId.get(record.productId) || "Low",
        });
    });

    return result;
}

function getActionCenterRows(
    stockLines: ManagerStockLine[],
    velocityByProductId: Map<string, ProductVelocityInfo>
): ActionCenterRow[] {
    const rows: ActionCenterRow[] = [];

    stockLines.forEach((line) => {
        const product = line.product;
        const velocity = velocityByProductId.get(String(product.id)) || {
            value: 0,
            label: "Low" as const,
            activeMonths: 12,
        };
        const expirationDays = getDaysUntilExpiration(line.expirationDate);
        const variantLabel =
            product.hasVariants && line.variantName !== "Regular"
                ? ` - ${line.variantName}`
                : "";
        const productName = `${line.productName}${variantLabel}`;

        if (line.stock <= 0) {
            rows.push({
                id: `${line.id}-out-of-stock`,
                product,
                productName,
                currentStock: line.stock,
                reorderPoint: line.alertLevel,
                salesVelocity: velocity.label,
                salesVelocityValue: velocity.value,
                issue: "Out of Stock",
                action: "Restock Now",
            });
        } else if (line.stock <= line.alertLevel) {
            rows.push({
                id: `${line.id}-low-stock`,
                product,
                productName,
                currentStock: line.stock,
                reorderPoint: line.alertLevel,
                salesVelocity: velocity.label,
                salesVelocityValue: velocity.value,
                issue: "Low Stock",
                action: "Restock",
            });
        }

        if (expirationDays !== null && expirationDays <= EXPIRING_SOON_DAYS) {
            const expired = expirationDays < 0;

            rows.push({
                id: `${line.id}-${expired ? "expired" : "expiring"}`,
                product,
                variantId: line.variantId,
                expirationDate: line.expirationDate,
                productName,
                currentStock: line.stock,
                reorderPoint: line.alertLevel,
                salesVelocity: velocity.label,
                salesVelocityValue: velocity.value,
                issue: expired ? "Expired" : "Expiring",
                action: expired ? "Dispose Expired" : "Prioritize Sale",
            });
        }
    });

    const priority: Record<ActionCenterRow["issue"], number> = {
        "Out of Stock": 0,
        "Low Stock": 1,
        Expired: 2,
        Expiring: 3,
        "Slow Moving": 4,
    };

    return rows.sort((a, b) => {
        if (priority[a.issue] !== priority[b.issue]) {
            return priority[a.issue] - priority[b.issue];
        }
        return a.currentStock - b.currentStock;
    });
}

function getProductNumber(product: Product) {
    // Product No. must come from the database. Do not manufacture a display
    // number from store_id / branch_id / product.id because the persisted
    // identifier is the business reference used for search and records.
    return String(
        product.productNumber ??
        product.product_number ??
        ""
    ).trim();
}

function productMatchesInventorySearch(product: Product, rawSearch: string) {
    const search = rawSearch.trim().toLowerCase();
    if (!search) return true;

    const values: string[] = [
        getProductNumber(product),
        ...(product.variants || []).map(v => String(v.variantNumber || "")),
        product.name,
        product.category,
        String(product.barcode ?? ""),
    ];

    for (const variant of product.variants || []) {
        values.push(
            String(variant.barcode ?? ""),
            ...Object.values(variant.variantValues || {})
        );
    }

    return values.some((value) =>
        String(value || "").toLowerCase().includes(search)
    );
}

// Export the same filtered product rows and columns currently shown in the
// Branch Inventory List. Keep the product/stock-in/status calculations unchanged.
function getManagerInventoryExportRows(
    products: Product[],
    productStockInDates: Record<number, string>
): Array<Array<string | number>> {
    return [
        [
            "Product No.",
            "Product",
            "Category",
            "Available Stock",
            "Reorder Point",
            "Last Stock In",
            "Expiration",
            "Status",
        ],
        ...products.map((product) => [
            getProductNumber(product),
            product.name,
            product.category,
            getProductTotalStock(product),
            getProductReorderLevel(product),
            formatDate(productStockInDates[product.id]),
            getProductExpiration(product)
                ? formatDate(getProductExpiration(product)!.toISOString())
                : "—",
            getProductStatus(product),
        ]),
    ];
}

type ManagerInventoryExportDetails = {
    storeName: string;
    branchName: string;
    categoryFilter: string;
    statusFilter: string;
    generatedAt: Date;
};

function getManagerInventoryReportFilename(
    extension: "xlsx" | "pdf",
    details: ManagerInventoryExportDetails
) {
    const slug = (value: string) => String(value || "Unknown")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 35) || "Unknown";
    const date = details.generatedAt;
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return `StockNBook_Inventory_${slug(details.storeName)}_${slug(details.branchName)}_${stamp}.${extension}`;
}

function getManagerInventoryReportDate(date: Date) {
    return date.toLocaleString("en-PH", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
    });
}

function exportManagerInventoryExcel(
    products: Product[],
    productStockInDates: Record<number, string>,
    details: ManagerInventoryExportDetails
) {
    const reportRows: Array<Array<string | number>> = [
        ["StockNBook - Branch Inventory List"],
        ["Store", details.storeName],
        ["Branch", details.branchName],
        ["Report Date", getManagerInventoryReportDate(details.generatedAt)],
        ["Category Filter", details.categoryFilter === "All" ? "All Categories" : details.categoryFilter],
        ["Status Filter", details.statusFilter],
        ["Total Products", products.length],
        [],
        ...getManagerInventoryExportRows(products, productStockInDates),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(reportRows);
    sheet["!cols"] = [
        { wch: 19 }, { wch: 42 }, { wch: 25 }, { wch: 18 },
        { wch: 17 }, { wch: 20 }, { wch: 20 }, { wch: 18 },
    ];
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
    // Row 9 contains the actual product headings, below the report information.
    sheet["!autofilter"] = { ref: `A9:H${Math.max(9, 9 + products.length)}` };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Branch Inventory");
    XLSX.writeFile(workbook, getManagerInventoryReportFilename("xlsx", details), {
        bookType: "xlsx",
    });
}

// Download a real PDF directly (not via a print dialog or a pop-up window).
// The canvas renderer and minimal PDF image wrapper use browser APIs already
// available in Next.js; no new packages or unrelated backend changes are needed.
function exportManagerInventoryPdf(
    products: Product[],
    productStockInDates: Record<number, string>,
    details: ManagerInventoryExportDetails
) {
    const [headers, ...rows] = getManagerInventoryExportRows(products, productStockInDates);
    const pageWidth = 841.89; // A4 landscape, in PDF points
    const pageHeight = 595.28;
    const scale = 2; // keep text readable even with hundreds of products
    const widths = [102, 175, 123, 71, 80, 81, 87, 62];
    const tableWidth = widths.reduce((sum, value) => sum + value, 0);
    const tableLeft = (pageWidth - tableWidth) / 2;
    const tableTop = 139;
    const tableHeaderHeight = 31;
    const footerTop = 561;
    const rowLineHeight = 11;
    const paddingX = 5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pageWidth * scale);
    canvas.height = Math.round(pageHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser cannot create the PDF canvas.");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const textLines = (rawValue: string | number, maxWidth: number) => {
        const value = String(rawValue ?? "").replace(/\s+/g, " ").trim() || "—";
        const lines: string[] = [];
        let line = "";
        for (const word of value.split(" ")) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width <= maxWidth) {
                line = next;
                continue;
            }
            if (line) lines.push(line);
            line = "";
            // Long product references must not overflow the next column.
            for (const character of word) {
                if (ctx.measureText(line + character).width > maxWidth && line) {
                    lines.push(line);
                    line = "";
                }
                line += character;
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : ["—"];
    };

    const makeRow = (row: Array<string | number>) => {
        ctx.font = "8.2px Arial, sans-serif";
        const wrapped = row.map((cell, col) => textLines(cell, widths[col] - paddingX * 2));
        return {
            wrapped,
            height: Math.max(21, Math.max(...wrapped.map((lines) => lines.length)) * rowLineHeight + 9),
        };
    };
    const rowModels = rows.map(makeRow);
    // Determine page boundaries before drawing so the PDF can show page counts.
    const pages: Array<Array<{ wrapped: string[][]; height: number }>> = [[]];
    let usedHeight = tableTop + tableHeaderHeight;
    for (const row of rowModels) {
        if (usedHeight + row.height > footerTop - 4 && pages[pages.length - 1].length) {
            pages.push([]);
            usedHeight = tableTop + tableHeaderHeight;
        }
        pages[pages.length - 1].push(row);
        usedHeight += row.height;
    }

    const drawGridRow = (wrapped: string[][], y: number, height: number, header = false, alt = false) => {
        ctx.fillStyle = header ? "#F1EBFF" : alt ? "#FAF8FD" : "#FFFFFF";
        ctx.fillRect(tableLeft, y, tableWidth, height);
        let x = tableLeft;
        wrapped.forEach((lines, index) => {
            ctx.strokeStyle = "#E3D8EA";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, widths[index], height);
            ctx.fillStyle = header ? "#4E2C66" : "#21132E";
            ctx.font = header ? "bold 8px Arial, sans-serif" : "8.2px Arial, sans-serif";
            lines.forEach((line, lineIndex) => {
                ctx.fillText(line, x + paddingX, y + 12 + lineIndex * rowLineHeight);
            });
            x += widths[index];
        });
    };

    const imageBytes: Uint8Array[] = [];
    pages.forEach((pageRows, pageIndex) => {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, pageWidth, pageHeight);
        ctx.fillStyle = "#2B174C";
        ctx.font = "bold 17px Arial, sans-serif";
        ctx.fillText("StockNBook - Branch Inventory List", tableLeft, 33);
        ctx.font = "10px Arial, sans-serif";
        ctx.fillText(`Store: ${details.storeName}`, tableLeft, 57);
        ctx.fillText(`Branch: ${details.branchName}`, tableLeft, 73);
        ctx.fillText(`Report Date: ${getManagerInventoryReportDate(details.generatedAt)}`, tableLeft, 89);
        ctx.fillStyle = "#5A476A";
        ctx.font = "9px Arial, sans-serif";
        ctx.fillText(
            `Category: ${details.categoryFilter === "All" ? "All Categories" : details.categoryFilter}  |  Status: ${details.statusFilter}  |  Products: ${products.length}`,
            tableLeft, 111
        );
        ctx.strokeStyle = "#D9CDF0";
        ctx.beginPath();
        ctx.moveTo(tableLeft, 119);
        ctx.lineTo(tableLeft + tableWidth, 119);
        ctx.stroke();
        ctx.font = "bold 8px Arial, sans-serif";
        const wrappedHeaders = headers.map((label, index) => textLines(label, widths[index] - 10));
        drawGridRow(wrappedHeaders, tableTop, tableHeaderHeight, true);
        let y = tableTop + tableHeaderHeight;
        pageRows.forEach((row, index) => {
            drawGridRow(row.wrapped, y, row.height, false, index % 2 === 1);
            y += row.height;
        });
        ctx.fillStyle = "#806A8C";
        ctx.font = "9px Arial, sans-serif";
        ctx.fillText("StockNBook  |  Branch Inventory", tableLeft, pageHeight - 20);
        ctx.textAlign = "right";
        ctx.fillText(`Page ${pageIndex + 1} of ${pages.length}`, tableLeft + tableWidth, pageHeight - 20);
        ctx.textAlign = "left";
        const base64 = canvas.toDataURL("image/jpeg", 0.86).split(",")[1];
        const binary = atob(base64);
        const jpeg = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) jpeg[i] = binary.charCodeAt(i);
        imageBytes.push(jpeg);
    });

    // Place each JPEG page in a standards-compliant PDF without printing.
    const encoder = new TextEncoder();
    const chunks: BlobPart[] = [];
    let bytePosition = 0;
    const write = (value: string | Uint8Array) => {
        const chunk = typeof value === "string" ? encoder.encode(value) : value;
        chunks.push(chunk as BlobPart);
        bytePosition += chunk.byteLength;
    };
    const objectOffsets: number[] = [];
    const writeObject = (id: number, content: () => void) => {
        objectOffsets[id] = bytePosition;
        write(`${id} 0 obj\n`);
        content();
        write("\nendobj\n");
    };
    write("%PDF-1.4\n%StockNBook\n");
    writeObject(1, () => write("<< /Type /Catalog /Pages 2 0 R >>"));
    const pageRefs = imageBytes.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
    writeObject(2, () => write(`<< /Type /Pages /Kids [${pageRefs}] /Count ${imageBytes.length} >>`));
    imageBytes.forEach((jpeg, index) => {
        const pageId = 3 + index * 3;
        const imageId = pageId + 1;
        const streamId = pageId + 2;
        writeObject(pageId, () => write(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
            `/Resources << /XObject << /PageImage ${imageId} 0 R >> >> /Contents ${streamId} 0 R >>`
        ));
        writeObject(imageId, () => {
            write(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
                `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
            write(jpeg);
            write("\nendstream");
        });
        const stream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/PageImage Do\nQ\n`;
        writeObject(streamId, () => write(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`));
    });
    const startXref = bytePosition;
    const objectCount = 2 + imageBytes.length * 3;
    write(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= objectCount; id += 1) {
        write(`${String(objectOffsets[id]).padStart(10, "0")} 00000 n \n`);
    }
    write(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`);

    const file = new Blob(chunks, { type: "application/pdf" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = getManagerInventoryReportFilename("pdf", details);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type InventoryPricingMethod = "markup" | "manual";


function isValidMarkupPercentage(value: string) {
    return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function calculateMarkupSellingPrice(cost: string | number, markup: string) {
    const costPrice = Number(cost);
    const percentage = Number(markup);

    if (!Number.isFinite(costPrice) || costPrice < 0 || !isValidMarkupPercentage(markup)) {
        return null;
    }

    return (Math.round((costPrice * (1 + percentage / 100) + Number.EPSILON) * 100) / 100).toFixed(2);
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
    // UI-only switch: the existing Sales inventory remains unchanged.
    const [inventoryTab, setInventoryTab] = React.useState<"sales" | "rentals">("sales");
    const [currentDateTime, setCurrentDateTime] = React.useState<Date | null>(
        null
    );
    const [statusFilter, setStatusFilter] = React.useState("All Status");
    const [salesOrders, setSalesOrders] = React.useState<ManagerPosOrder[]>([]);
    const [salesLoading, setSalesLoading] = React.useState(false);
    const [restockHistory, setRestockHistory] = React.useState<
        RestockHistoryRecord[]
    >([]);
    const [expiredDisposalActivity, setExpiredDisposalActivity] = React.useState<ExpiredDisposalActivityRecord[]>([]);
    const [inventoryEmployeeActions, setInventoryEmployeeActions] =
        React.useState<InventoryEmployeeAction[]>([]);
    const [stockActivityLoading, setStockActivityLoading] =
        React.useState(false);
    const [stockActivityRefreshKey, setStockActivityRefreshKey] =
        React.useState(0);
    const [productNumbersById, setProductNumbersById] = React.useState<
        Record<number, string>
    >({});
    const [variantNumbersById, setVariantNumbersById] = React.useState<Record<number,string>>({});
    const [lastStockInRecords, setLastStockInRecords] = React.useState<LastStockInRecord[]>([]);
    const [receivingProduct, setReceivingProduct] = React.useState<Product | null>(null);
    const [disposalSelection, setDisposalSelection] = React.useState<{product: Product; variantId: number | null} | null>(null);
    const [restockToast, setRestockToast] = React.useState<SuccessToastMessage | null>(null);
    const closeRestockToast = React.useCallback(() => setRestockToast(null), []);

    React.useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());
        updateDateTime();

        const timer = window.setInterval(updateDateTime, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const branchBadge = inv.assignedBranchName || "Assigned Branch";
    const branchSelection = inv as InventoryController & {
        branchId?: string | number | null;
    };
    const managerBranchId = Number(
        branchSelection.assignedBranchId ??
        branchSelection.branchId ??
        branchSelection.selectedBranchId
    );

    React.useEffect(() => {
        let cancelled = false;

        const loadProductNumbers = async () => {
            if (typeof window === "undefined") return;

            const token = sessionStorage.getItem("token");
            if (!token) return;

            const request: Record<string, unknown> = {
                action: "get_products",
            };

            if (Number.isFinite(managerBranchId) && managerBranchId > 0) {
                request.branch_id = managerBranchId;
            }

            try {
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(request),
                    cache: "no-store",
                });

                const payload = await response.json().catch(() => ({}));

                if (!response.ok || !Array.isArray(payload.products)) {
                    throw new Error(
                        payload.error || "Unable to load product numbers."
                    );
                }

                const nextLookup: Record<number, string> = {};
                const nextVariantLookup: Record<number, string> = {};

                for (const rawProduct of payload.products) {
                    for(const rawVariant of Array.isArray(rawProduct.variants)?rawProduct.variants:[]) {
                        const variantId=Number(rawVariant.id);
                        const variantNumber=String(rawVariant.variantNumber??rawVariant.variant_number??"").trim();
                        if(Number.isInteger(variantId)&&variantId>0&&variantNumber) nextVariantLookup[variantId]=variantNumber;
                    }
                    const id = Number(rawProduct?.id);
                    const productNumber = String(
                        rawProduct?.productNumber ??
                        rawProduct?.product_number ??
                        ""
                    ).trim();

                    if (
                        Number.isInteger(id) &&
                        id > 0 &&
                        productNumber
                    ) {
                        nextLookup[id] = productNumber;
                    }
                }

                if (!cancelled) {
                    // Keep Product Nos. received from successful Add Product saves
                    // even if an earlier product-list request finishes afterward.
                    setProductNumbersById((current) => ({ ...current, ...nextLookup }));
                    setVariantNumbersById(current=>({...current,...nextVariantLookup}));
                }
            } catch (error) {
                console.warn(
                    "Manager inventory product-number loading failed:",
                    error
                );
            }
        };

        void loadProductNumbers();
        window.addEventListener("stocknbook:created-product-numbers",loadProductNumbers);
        window.addEventListener("stocknbook:imported-product-numbers",loadProductNumbers);
        return () => {
            cancelled = true;
            window.removeEventListener("stocknbook:created-product-numbers",loadProductNumbers);
            window.removeEventListener("stocknbook:imported-product-numbers",loadProductNumbers);
        };
    }, [managerBranchId]);

    React.useEffect(() => {
        const handlePersistedProductNumbers = (event: Event) => {
            const customEvent = event as CustomEvent<
                Array<Record<string, unknown>>
            >;

            const importedProducts = Array.isArray(customEvent.detail)
                ? customEvent.detail
                : [];

            if (importedProducts.length === 0) return;

            setProductNumbersById((current) => {
                const next = { ...current };

                for (const product of importedProducts) {
                    const id = Number(product.id);
                    const productNumber = String(
                        product.productNumber ??
                        product.product_number ??
                        ""
                    ).trim();

                    if (
                        Number.isInteger(id) &&
                        id > 0 &&
                        productNumber
                    ) {
                        next[id] = productNumber;
                    }
                }

                return next;
            });
        };

        window.addEventListener(
            "stocknbook:imported-product-numbers",
            handlePersistedProductNumbers
        );
        // Newly created products receive their permanent Product No. from
        // create_product; update the existing lookup without a page reload.
        window.addEventListener(
            "stocknbook:created-product-numbers",
            handlePersistedProductNumbers
        );

        return () => {
            window.removeEventListener(
                "stocknbook:imported-product-numbers",
                handlePersistedProductNumbers
            );
            window.removeEventListener(
                "stocknbook:created-product-numbers",
                handlePersistedProductNumbers
            );
        };
    }, []);

    const managerProducts = React.useMemo(
        () =>
            (
                Array.isArray(inv.baseProducts)
                    ? inv.baseProducts
                    : []
            ).map((rawProduct) => {
                const product = rawProduct as Product;

                const persistedProductNumber =
                    getProductNumber(product) ||
                    productNumbersById[Number(product.id)] ||
                    "";

                return {
                    ...product,
                    productNumber: persistedProductNumber || null,
                    product_number: persistedProductNumber || null,
                    variants:Array.isArray(product.variants)?product.variants.map(variant=>({
                        ...variant,variantNumber:variant.variantNumber||variantNumbersById[Number(variant.id)]||null
                    })):[],
                } as Product;
            }),
        [inv.baseProducts, productNumbersById, variantNumbersById]
    );

    React.useEffect(() => {
        let cancelled = false;
        let requestInFlight = false;
        let hasLoadedOnce = false;

        const loadSales = async () => {
            if (cancelled || requestInFlight) return;
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

            requestInFlight = true;
            if (!hasLoadedOnce) setSalesLoading(true);

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
                // Keep previously displayed sales during a background refresh failure.
                if (!cancelled && !hasLoadedOnce) setSalesOrders([]);
            } finally {
                requestInFlight = false;
                hasLoadedOnce = true;
                if (!cancelled) setSalesLoading(false);
            }
        };

        void loadSales();

        // Keep POS activity near-real-time while the inventory page is open.
        // Avoid simultaneous full-order requests or polling hidden tabs.
        const salesRefreshTimer = window.setInterval(() => {
            if (document.visibilityState === "visible") void loadSales();
        }, 30_000);

        const refreshSalesOnFocus = () => { void loadSales(); };
        window.addEventListener("focus", refreshSalesOnFocus);

        return () => {
            cancelled = true;
            window.clearInterval(salesRefreshTimer);
            window.removeEventListener("focus", refreshSalesOnFocus);
        };
    }, [managerBranchId, stockActivityRefreshKey]);

    // Refresh disposal history through the same event used by the receiving
    // dialog. Branch scoping and authorization are enforced by the Lambda.
    React.useEffect(() => {
        let cancelled = false;
        const loadExpiredDisposals = async () => {
            const token = sessionStorage.getItem("token");
            if (!token || !Number.isSafeInteger(managerBranchId) || managerBranchId <= 0) {
                if (!cancelled) setExpiredDisposalActivity([]);
                return;
            }
            try {
                const response = await fetch("/api/products", {
                    method: "POST",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_recent_expired_disposals", branch_id: managerBranchId }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || result.success === false || !Array.isArray(result.disposals)) {
                    throw new Error(result.error || "Unable to load expired-stock disposal activity.");
                }
                if (!cancelled) setExpiredDisposalActivity(result.disposals);
            } catch (error) {
                console.warn("Manager expired-stock disposal activity loading failed:", error);
                // Keep previously loaded rows when a background refresh fails.
            }
        };
        void loadExpiredDisposals();
        return () => { cancelled = true; };
    }, [managerBranchId, stockActivityRefreshKey]);

    React.useEffect(() => {
        let cancelled = false;

        const loadInventoryActivityHistory = async () => {
            if (typeof window === "undefined") return;

            const token = sessionStorage.getItem("token");
            if (!token) {
                if (!cancelled) {
                    setRestockHistory([]);
                    setInventoryEmployeeActions([]);
                }
                return;
            }

            const now = new Date();
            const start = new Date(now);
            start.setDate(start.getDate() - 29);

            const toLocalDateParam = (value: Date) => {
                const year = value.getFullYear();
                const month = String(value.getMonth() + 1).padStart(2, "0");
                const day = String(value.getDate()).padStart(2, "0");
                return `${year}-${month}-${day}`;
            };

            const assignedBranchName =
                inv.assignedBranchName || "Assigned Branch";

            const query = new URLSearchParams({
                branch: assignedBranchName,
                month: toLocalDateParam(start).slice(0, 7),
                startDate: toLocalDateParam(start),
                endDate: toLocalDateParam(now),
                role: "manager",
                assignedBranch: assignedBranchName,
            });

            if (Number.isFinite(managerBranchId) && managerBranchId > 0) {
                query.set("branch_id", String(managerBranchId));
            }

            setStockActivityLoading(true);

            try {
                const response = await fetch(
                    `/api/reports?${query.toString()}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                        cache: "no-store",
                    }
                );

                const payload = (await response
                    .json()
                    .catch(() => ({}))) as InventoryReportsResponse;

                if (
                    !response.ok ||
                    payload.success === false ||
                    !payload.data
                ) {
                    throw new Error(
                        payload.error ||
                        "Unable to load inventory activity history."
                    );
                }

                if (!cancelled) {
                    setRestockHistory(
                        Array.isArray(payload.data.restockHistory)
                            ? payload.data.restockHistory
                            : []
                    );
                    setInventoryEmployeeActions(
                        Array.isArray(payload.data.employeeActions)
                            ? payload.data.employeeActions
                            : []
                    );
                }
            } catch (error) {
                console.warn(
                    "Manager inventory stock activity loading failed:",
                    error
                );

                if (!cancelled) {
                    setRestockHistory([]);
                    setInventoryEmployeeActions([]);
                }
            } finally {
                if (!cancelled) {
                    setStockActivityLoading(false);
                }
            }
        };

        void loadInventoryActivityHistory();

        return () => {
            cancelled = true;
        };
    }, [
        inv.assignedBranchName,
        managerBranchId,
        stockActivityRefreshKey,
    ]);

    React.useEffect(() => {
        const handleStockActivityRefresh = () => {
            setStockActivityRefreshKey((current) => current + 1);
        };

        window.addEventListener(
            "stocknbook:stock-activity-refresh",
            handleStockActivityRefresh
        );

        return () => {
            window.removeEventListener(
                "stocknbook:stock-activity-refresh",
                handleStockActivityRefresh
            );
        };
    }, []);

    // Fetch the full recorded stock-in history independently of the
    // 30-day Recent Stock Activity feed. No stock/price/write operations.
    React.useEffect(() => {
        let cancelled = false;
        const loadLastStockInDates = async () => {
            const token = sessionStorage.getItem("token");
            if (!token || !Number.isInteger(managerBranchId) || managerBranchId <= 0) {
                if (!cancelled) setLastStockInRecords([]);
                return;
            }
            try {
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ action: "get_last_stock_in", branch_id: managerBranchId }),
                    cache: "no-store",
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || result.success === false || !Array.isArray(result.stockInRecords)) {
                    throw new Error(result.error || "Unable to load stock-in dates.");
                }
                if (!cancelled) setLastStockInRecords(result.stockInRecords);
            } catch (error) {
                console.warn("Manager inventory stock-in date lookup failed:", error);
                if (!cancelled) setLastStockInRecords([]);
            }
        };
        void loadLastStockInDates();
        return () => { cancelled = true; };
    }, [managerBranchId, stockActivityRefreshKey]);

    const lastStockInDates = React.useMemo(
        () => buildLastStockInDates(managerProducts, lastStockInRecords),
        [managerProducts, lastStockInRecords]
    );

    // KPI cards and the Stock Action Center count the same sellable stock shown in
    // the Branch Inventory List ("Available Stock"). Each line keeps its original
    // product, so edit/restock/dispose actions still receive the unmodified record.
    const allStockLines = React.useMemo(
        () => managerProducts.flatMap((product) =>
            getProductStockLines(product).map((line) => {
                const variant = line.variantId == null
                    ? null
                    : (product.variants || []).find((item) => item.id === line.variantId);
                const sellable = variant ? variant.sellableStock : product.sellableStock;
                return sellable == null ? line : {...line, stock: Number(sellable)};
            })
        ),
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
        () => getRecentThirtyDaySales(salesOrders, managerBranchId),
        [managerBranchId, salesOrders]
    );

    const recentStockMovements = React.useMemo(() => {
        // Keep the loaded recent activity available for the date and movement filters.
        return buildRecentStockMovements({
            salesMovements: recentSales.movements,
            restockRecords: restockHistory,
            employeeActions: inventoryEmployeeActions,
            branchId: managerBranchId,
            disposalRecords: expiredDisposalActivity,
        });
    }, [
        inventoryEmployeeActions,
        expiredDisposalActivity,
        managerBranchId,
        recentSales.movements,
        restockHistory,
    ]);

    const trailingTwelveMonthSales = React.useMemo(
        () => getTrailingTwelveMonthSales(salesOrders, managerBranchId),
        [managerBranchId, salesOrders]
    );

    const productVelocityMap = React.useMemo(
        () => getProductVelocityMap(managerProducts, trailingTwelveMonthSales),
        [managerProducts, trailingTwelveMonthSales]
    );

    const actionRows = React.useMemo(
        () => getActionCenterRows(allStockLines, productVelocityMap),
        [allStockLines, productVelocityMap]
    );

    const tableProducts = React.useMemo(() => {
        let base = managerProducts.filter((product) => {
            const matchesCategory =
                inv.selectedCategory === "All" ||
                product.category === inv.selectedCategory;

            const matchesSearch = productMatchesInventorySearch(
                product,
                inv.search
            );

            return matchesCategory && matchesSearch;
        });

        if (statusFilter !== "All Status") {
            base = base.filter(
                (product) => getProductStatus(product) === statusFilter
            );
        }

        return base;
    }, [
        inv.search,
        inv.selectedCategory,
        managerProducts,
        statusFilter,
    ]);

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
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
                            Manage products for sales and equipment for rentals.
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
                {/* Sales / Rentals are separate inventory views. No sales data is reused for rentals. */}
                <section aria-label="Inventory type" className="flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-[#F1F3FF] to-[#F7F5FF] px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#5A35A5]">
                            {inventoryTab === "sales" ? <ShoppingCart size={22} /> : <CalendarClock size={22} />}
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-[25px] font-bold text-[#1A1220]">
                                {inventoryTab === "sales" ? "Consumable Inventory" : "Rental Inventory"}
                            </h2>
                            <p className="mt-0.5 text-xs text-[#766983]">
                                {inventoryTab === "sales"
                                    ? "Daily stock handling for products sold to customers."
                                    : "Daily equipment preparation, releases, returns and inspections."}
                            </p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3" aria-label="Select inventory view">
                        <button
                            type="button"
                            aria-pressed={inventoryTab === "sales"}
                            onClick={() => setInventoryTab("sales")}
                            className={`inline-flex h-[42px] min-w-[145px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B31D4] ${inventoryTab === "sales"
                                ? "bg-[#2B174C] text-white hover:bg-[#1B0D31]"
                                : "border border-[#E2DCF2] bg-white text-[#24164D] hover:bg-[#F8F5FF]"}`}
                        >
                            <ShoppingCart size={17} /> Consumable
                        </button>
                        <button
                            type="button"
                            aria-pressed={inventoryTab === "rentals"}
                            onClick={() => setInventoryTab("rentals")}
                            className={`inline-flex h-[42px] min-w-[145px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B31D4] ${inventoryTab === "rentals"
                                ? "bg-[#2B174C] text-white hover:bg-[#1B0D31]"
                                : "border border-[#E2DCF2] bg-white text-[#24164D] hover:bg-[#F8F5FF]"}`}
                        >
                            <CalendarClock size={17} /> Rental
                        </button>
                    </div>
                </section>

                {inventoryTab === "sales" ? (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <ManagerMetricCard
                                label="Low Stock Items"
                                value={lowStockCount}
                                helper="Positive stock at or below the reorder level"
                                icon={<AlertTriangle size={20} />}
                                loading={inv.productsLoading}
                                tone="amber"
                            />
                            <ManagerMetricCard
                                label="Out of Stock Items"
                                value={outOfStockCount}
                                helper="Stock lines with zero available units"
                                icon={<Boxes size={20} />}
                                loading={inv.productsLoading}
                                tone="red"
                            />
                            <ManagerMetricCard
                                label="Expiring / Expired"
                                value={expiringExpiredCount}
                                helper="Expiry within 30 days or already expired"
                                icon={<CalendarClock size={20} />}
                                loading={inv.productsLoading}
                                tone="purple"
                            />
                            <ManagerMetricCard
                                label="Reorder Needed"
                                value={reorderNeededCount}
                                helper="Low/out-of-stock lines; may overlap other alerts"
                                icon={<ShoppingCart size={20} />}
                                loading={inv.productsLoading}
                                tone="blue"
                            />
                        </div>

                        <div className="grid items-stretch gap-4 xl:grid-cols-[1.15fr_1fr]">
                            <StockActionCenter
                                rows={actionRows}
                                branchName={branchBadge}
                                onEdit={inv.handleEditProduct}
                                onReceive={(product) => setReceivingProduct(product)}
                                onDispose={(product, variantId) => setDisposalSelection({product, variantId})}
                                onDelete={inv.requestDeleteProduct}
                                onVariantRemoved={async (name, mode) => {
                                    await inv.refreshAll();
                                    setStockActivityRefreshKey((current) => current + 1);
                                    setRestockToast({
                                        title: mode === "archive" ? "Variant archived successfully" : "Variant deleted successfully",
                                        message: `“${name}” was removed from active inventory. Other variants remain unchanged.`,
                                    });
                                }}
                            />

                            <RecentStockActivity
                                movements={recentStockMovements}
                                branchName={branchBadge}
                                loading={salesLoading || stockActivityLoading}
                            />
                        </div>

                        <ManagerInventoryTable
                            inv={inv}
                            products={tableProducts}
                            storeName={inv.storeName}
                            branchName={branchBadge}
                            lastStockInDates={lastStockInDates}
                            categories={inv.categories}
                            selectedCategory={inv.selectedCategory}
                            onCategoryChange={inv.setSelectedCategory}
                            statusFilter={statusFilter}
                            onStatusFilterChange={setStatusFilter}
                            onEdit={inv.handleEditProduct}
                            onRestock={(product) => setReceivingProduct(product)}
                            onDispose={(product, variantId) => setDisposalSelection({product, variantId})}
                            onDelete={inv.requestDeleteProduct}
                        />
                    </>
                ) : (
                    <ManagerRentalInventory branchId={Number.isSafeInteger(managerBranchId) && managerBranchId > 0 ? managerBranchId : undefined} />
                )}
            </main>

            <InventoryDialogs inv={inv} />
            <SuccessToast toast={restockToast} onClose={closeRestockToast} />
            {disposalSelection && (
                <ExpiredStockDisposalDialog
                    product={disposalSelection.product}
                    variantId={disposalSelection.variantId}
                    onClose={() => setDisposalSelection(null)}
                    onCompleted={async (quantity) => {
                        const disposedName = disposalSelection.product.name;
                        await inv.refreshAll();
                        setStockActivityRefreshKey((current) => current + 1);
                        window.dispatchEvent(new Event("stocknbook:stock-activity-refresh"));
                        setDisposalSelection(null);
                        setRestockToast({
                            title: "Expired stock disposal recorded",
                            message: `${formatNumber(quantity)} units of “${disposedName}” were recorded as physically disposed. History is retained.`,
                        });
                    }}
                />
            )}
            {receivingProduct && (
                <ReceiveStockDialog
                    product={receivingProduct}
                    onClose={() => setReceivingProduct(null)}
                    onSaved={async (receivedQuantity) => {
                        await inv.refreshAll();
                        window.dispatchEvent(new Event("stocknbook:stock-activity-refresh"));
                        setReceivingProduct(null);
                        setRestockToast({
                            title: "Stock restocked successfully",
                            message: `“${receivingProduct.name}” received +${formatNumber(receivedQuantity)} units in inventory.`,
                        });
                    }}
                />
            )}
        </>
    );
}

function ManagerMetricCard({label, value, helper, icon, tone, loading = false}: {
    label: string;
    value: number;
    helper: string;
    icon: React.ReactNode;
    tone: "amber" | "red" | "purple" | "blue";
    loading?: boolean;
}) {
    const iconClassName = {
        amber: "bg-[#FFF3DE] text-[#E68A00]",
        red: "bg-[#FFE8E8] text-[#E23B4A]",
        purple: "bg-[#F1ECFF] text-[#5F35D8]",
        blue: "bg-[#E9F2FF] text-[#1E6FE8]",
    }[tone];
    return (
        <section aria-busy={loading} className="flex min-h-[146px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm">
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
                    <span className="mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1A1220] tabular-nums">{formatNumber(value)}</span>
                    <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{helper}</span>
                </span>
            </>}
        </section>
    );
}

/* -------------------------------------------------------------------------- */
/*              RECEIVE STOCK -- NEVER OPENS THE EDIT PRODUCT FORM            */
/* -------------------------------------------------------------------------- */

type ReceiveStockLine = {
    variantId: number | null;
    variantNumber?: string | null;
    variantName: string;
    currentStock: number;
    currentSellableStock: number;
    currentAverageCost: number;
    currentSellingPrice: number;
    pricingMethod: InventoryPricingMethod;
    markupPercentage: number | null;
    quantity: string;
    expirationDate: string;
};

// An expired batch is never deleted automatically. Managers record only the
// physically disposed quantity; the backend retains batch and movement history.
type ExpiredDisposalBatch = {
    batchId: number;
    batchCode: string | null;
    remainingQuantity: number;
    expirationDate: string;
    status: string;
};

function ExpiredStockDisposalDialog({product, variantId, onClose, onCompleted}: {
    product: Product;
    variantId: number | null;
    onClose: () => void;
    onCompleted: (quantity: number) => Promise<void>;
}) {
    const [batches, setBatches] = React.useState<ExpiredDisposalBatch[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [batchId, setBatchId] = React.useState("");
    const [quantity, setQuantity] = React.useState("");
    const [reason, setReason] = React.useState("");
    const [physicallyRemoved, setPhysicallyRemoved] = React.useState(false);
    const [error, setError] = React.useState("");
    const requestKey = React.useRef<string | null>(null);
    React.useEffect(() => {
        const controller = new AbortController();
        const read = async () => {
            setLoading(true);
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Session expired. Sign in again.");
                const res = await fetch("/api/products", {
                    method: "POST", cache: "no-store", signal: controller.signal,
                    headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
                    body: JSON.stringify({action: "get_expired_batches", productId: product.id, variantId}),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok || !body.success) throw new Error(body.error || "Unable to load expired batches.");
                if (!controller.signal.aborted) {
                    const rows = Array.isArray(body.batches) ? body.batches : [];
                    setBatches(rows);
                    setBatchId(rows.length ? String(rows[0].batchId) : "");
                }
            } catch (caught) {
                if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to load batches.");
            } finally { if (!controller.signal.aborted) setLoading(false); }
        };
        void read();
        return () => controller.abort();
    }, [product.id, variantId]);
    const selected = batches.find(batch => String(batch.batchId) === batchId);
    const amount = Number(quantity);
    const valid = Boolean(selected && Number.isSafeInteger(amount) && amount > 0 && amount <= Number(selected.remainingQuantity)
        && reason.trim().length >= 8 && physicallyRemoved);
    const confirmDisposal = async () => {
        if (!valid || !selected || saving) return;
        setSaving(true);
        setError("");
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Session expired. Sign in again.");
            if (!requestKey.current) requestKey.current = `expired-disposal:${crypto.randomUUID()}`;
            const response = await fetch("/api/products", {
                method: "POST", cache: "no-store",
                headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
                body: JSON.stringify({action: "dispose_expired_batch", productId: product.id, variantId,
                    batchId: selected.batchId, quantity: amount, reason: reason.trim(),
                    physicallyRemoved: true, requestKey: requestKey.current}),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) throw new Error(result.error || "Disposal was not saved.");
            await onCompleted(amount);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Unable to record disposal.");
        } finally { setSaving(false); }
    };
    return <div role="presentation" className="fixed inset-0 z-[160] flex items-center justify-center bg-black/50 px-3 py-5">
        <div role="dialog" aria-modal="true" aria-label="Dispose expired stock"
             className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E9E1EE] px-5 py-4">
                <div><h2 className="text-lg font-bold text-[#21132E]">Dispose Expired Stock</h2>
                    <p className="mt-1 text-xs text-[#806A8C]">{product.name} · Product No. {product.productNumber || "—"}</p></div>
                <button type="button" disabled={saving} onClick={onClose} aria-label="Close disposal dialog"
                        className="rounded-lg px-2 py-1 text-lg text-[#806A8C] hover:bg-[#F7F1FF]">×</button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
                <p className="rounded-xl border border-[#F3D0D5] bg-[#FFF4F4] p-3 text-xs leading-5 text-[#AA2435]">
                    Expired batches are already unavailable for POS and Bookings. This action records physical disposal; it does not delete the product or its history. Confirm the actual units removed before saving.
                </p>
                {loading ? <p className="text-sm text-[#806A8C]">Loading expired batches...</p>
                    : batches.length === 0 ? <p className="text-sm text-[#806A8C]">No expired units remain pending disposal for this product or variant.</p>
                        : <>
                            <div className="space-y-1"><label className={labelClass} htmlFor="expired-disposal-batch">Expired batch</label>
                                <select id="expired-disposal-batch" className={fieldClass} value={batchId} disabled={saving}
                                        onChange={e => {setBatchId(e.target.value);setQuantity("");setPhysicallyRemoved(false);requestKey.current=null;}}>
                                    {batches.map(b => <option key={b.batchId} value={String(b.batchId)}>
                                        {b.batchCode || `Batch #${b.batchId}`} · Exp. {b.expirationDate} · {b.remainingQuantity} recorded units
                                    </option>)}
                                </select></div>
                            <div className="space-y-1"><label className={labelClass} htmlFor="expired-disposal-quantity">Physically removed units</label>
                                <input id="expired-disposal-quantity" type="number" min={1} max={selected?.remainingQuantity}
                                       step={1} value={quantity} className={fieldClass} disabled={saving}
                                       onChange={e => {setQuantity(e.target.value);requestKey.current=null;}} placeholder="Enter the verified removed quantity" />
                                <p className="text-[11px] text-[#806A8C]">Maximum recorded for this batch: {selected?.remainingQuantity ?? 0} units. Partial disposal is allowed.</p>
                            </div>
                            <div className="space-y-1"><label className={labelClass} htmlFor="expired-disposal-reason">Disposal reason (required)</label>
                                <textarea id="expired-disposal-reason" value={reason} rows={3} maxLength={500}
                                          disabled={saving} className={fieldClass}
                                          onChange={e => {setReason(e.target.value);requestKey.current=null;}}
                                          placeholder="Example: Expired stock physically removed and segregated for disposal" />
                            </div>
                            <label className="flex items-start gap-2 text-xs text-[#4F3A5A]">
                                <input type="checkbox" checked={physicallyRemoved} disabled={saving}
                                       onChange={e => {setPhysicallyRemoved(e.target.checked);requestKey.current=null;}} />
                                I confirm the specified units have been physically removed from inventory and checked against this batch.
                            </label>
                        </>}
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E9E1EE] bg-white px-5 py-4">
                <button type="button" onClick={onClose} disabled={saving}
                        className="rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                <button type="button" disabled={!valid || loading || saving} onClick={() => void confirmDisposal()}
                        className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    {saving ? "Recording..." : "Record Disposal"}
                </button>
            </div>
        </div>
    </div>;
}

function ReceiveStockDialog({ product, onClose, onSaved }: {
    product: Product;
    onClose: () => void;
    onSaved: (receivedQuantity: number) => Promise<void>;
}) {
    const [details, setDetails] = React.useState<Product>(product);
    const [lines, setLines] = React.useState<ReceiveStockLine[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const savingRef = React.useRef(false);
    const receivingRequestKey = React.useRef(crypto.randomUUID());
    const [error, setError] = React.useState("");
    // Restock only adds quantity; the receiving date is always today (Philippine time).
    const receivedDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });

    React.useEffect(() => {
        const abort = new AbortController();
        setLoading(true);
        (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Session expired. Please sign in again.");
                // Fetch the authoritative cost/variant identifiers, not the redacted list view.
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_product_editor_details", id: product.id }),
                    cache: "no-store",
                    signal: abort.signal,
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.product) {
                    throw new Error(result.error || "Unable to load product receiving details.");
                }
                if (abort.signal.aborted) return;
                const current = result.product as Product;
                setDetails(current);
                const stockLines: ReceiveStockLine[] = current.hasVariants && (current.variants || []).length
                    ? (current.variants || []).map(v => ({
                        variantId: Number(v.id), variantNumber: v.variantNumber || null, variantName: getVariantName(v),
                        currentStock: Number(v.stock || 0),
                        currentSellableStock: Math.max(0, Number(v.sellableStock ?? 0)),
                        currentAverageCost: Number(v.originalPrice || 0),
                        currentSellingPrice: Number(v.salesPrice || 0),
                        pricingMethod: v.pricingMethod === "markup" ? "markup" : "manual",
                        markupPercentage: v.markupPercentage == null ? null : Number(v.markupPercentage),
                        quantity: "", expirationDate: "",
                    }))
                    : [{
                        variantId: null, variantName: "Regular",
                        currentStock: Number(current.stock || 0),
                        currentSellableStock: Math.max(0, Number(current.sellableStock ?? 0)),
                        currentAverageCost: Number(current.originalPrice || 0),
                        currentSellingPrice: Number(current.salesPrice || 0),
                        pricingMethod: current.pricingMethod === "markup" ? "markup" : "manual",
                        markupPercentage: current.markupPercentage == null ? null : Number(current.markupPercentage),
                        quantity: "", expirationDate: "",
                    }];
                setLines(stockLines);
            } catch (e) {
                if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load product.");
            } finally {
                if (!abort.signal.aborted) setLoading(false);
            }
        })();
        return () => abort.abort();
    }, [product.id]);

    // A receiving dialog may remain open while Staff completes another receipt
    // or POS/Bookings changes stock. Refresh its read-only balances without
    // resetting quantities or expiration dates.
    React.useEffect(() => {
        if (loading || saving) return;
        const controller = new AbortController();
        const refreshBalances = async () => {
            if (controller.signal.aborted || document.visibilityState !== "visible") return;
            const token = sessionStorage.getItem("token");
            if (!token) return;
            try {
                const response = await fetch("/api/products", {
                    method: "POST", cache: "no-store", signal: controller.signal,
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_product_editor_details", id: product.id }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.product || controller.signal.aborted) return;
                const current = result.product as Product;
                setDetails(current);
                setLines(previous => previous.map(line => {
                    const currentLine = line.variantId === null ? current :
                        (current.variants || []).find(v => Number(v.id) === line.variantId);
                    if (!currentLine) return line;
                    return { ...line,
                        currentStock: Number(currentLine.stock || 0),
                        currentSellableStock: Math.max(0, Number(currentLine.sellableStock ?? 0)),
                    };
                }));
            } catch { /* The save operation still revalidates on the server. */ }
        };
        const interval = window.setInterval(() => void refreshBalances(), 15000);
        return () => { controller.abort(); window.clearInterval(interval); };
    }, [product.id, loading, saving]);

    const updateLine = (index: number, field: "quantity" | "expirationDate", value: string) => {
        setLines(previous => previous.map((line, i) => i === index ? { ...line, [field]: value } : line));
    };
    const totalQuantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    // The receiving summary shows the exact sellable balance used by POS and Bookings.
    const catalogStockBefore = lines.reduce((sum, line) => sum + line.currentStock, 0);
    const availableBefore = lines.reduce((sum, line) => sum + line.currentSellableStock, 0);
    const inventoryNeedsReconciliation = lines.some(line => line.currentStock !== line.currentSellableStock);

    const saveReceiving = async (event: React.SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (savingRef.current || loading) return;
        setError("");
        const selected = lines.filter(line => line.quantity.trim() !== "" && Number(line.quantity) > 0);
        if (!selected.length || lines.some(line => line.quantity.trim() !== "" &&
            (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 0))) {
            setError("Enter a positive whole quantity for at least one product or variant."); return;
        }
        if (selected.some(line => line.expirationDate && line.expirationDate < receivedDate)) {
            setError("Do not add stock that has already expired."); return;
        }
        savingRef.current = true;
        setSaving(true);
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Session expired. Please sign in again.");
            const response = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "receive_stock", requestKey: receivingRequestKey.current,
                    product_id: details.id,
                    branch_id: details.branchId,
                    receivedDate,
                    // Quantity only: cost and selling price stay as they are.
                    lines: selected.map(line => ({
                        variantId: line.variantId, quantity: Number(line.quantity),
                        expirationDate: line.expirationDate || null,
                        pricingDecision: "keep",
                        expectedPricing: {
                            stock: line.currentStock,
                            averageCost: line.currentAverageCost,
                            sellingPrice: line.currentSellingPrice,
                            pricingMethod: line.pricingMethod,
                            markupPercentage: line.markupPercentage,
                        },
                    })),
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success !== true) {
                throw new Error(result.error || `Receive Stock failed (HTTP ${response.status}).`);
            }
            await onSaved(totalQuantity);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to receive stock.");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <div role="dialog" aria-modal="true" aria-label="Receive Stock"
             className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-3 py-5">
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#E9E1EE] px-6 py-4">
                    <h2 className="text-xl font-bold text-[#21132E]">Receive Stock</h2>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close Receive Stock"
                            className="text-2xl text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50">×</button>
                </div>
                <form onSubmit={saveReceiving} className="flex min-h-0 flex-col">
                    <div className="space-y-5 overflow-y-auto px-6 py-5">
                        <div>
                            <h3 className="text-base font-bold text-[#21132E]">{details.name}</h3>
                            <p className="mt-1 text-xs text-[#806A8C]">Product No. {getProductNumber(details) || "—"} · {details.category}</p>
                            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-4">
                                <div><div className="text-xs text-[#806A8C]">Available Now (POS / Bookings)</div>
                                    <div className="mt-1 text-xl font-bold text-[#2B174C]">{loading ? "—" : formatNumber(availableBefore)}</div></div>
                                <div><div className="text-xs text-[#806A8C]">Available After Receiving</div>
                                    <div className="mt-1 text-xl font-bold text-[#2B174C]">{loading || inventoryNeedsReconciliation ? "—" : formatNumber(availableBefore + totalQuantity)}</div></div>
                            </div>
                            {!loading && inventoryNeedsReconciliation && <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                The catalog records {formatNumber(catalogStockBefore)} units, but only {formatNumber(availableBefore)} are currently sellable in this branch. This difference may reflect old stock records, expired batches, or missing batch balances. Reconcile the affected stock before recording another receipt; no new availability is projected until the records agree.
                            </p>}
                        </div>
                        {loading ? <p className="text-sm text-[#806A8C]">Loading receiving details...</p> : (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-bold text-[#21132E]">{details.hasVariants ? "Variants to Restock" : "Stock to Receive"}</h3>
                                    <p className="text-xs text-[#806A8C]">Enter the quantity to add. Leave other variants blank to keep them unchanged.</p>
                                    {lines.map((line, i) => (
                                        <div key={String(line.variantId ?? "regular")} className="space-y-3 rounded-xl border border-[#E3D8EA] p-4">
                                            <div className="flex justify-between gap-3">
                                                <div><strong className="text-sm text-[#2B174C]">{line.variantName}</strong>
                                                    {line.variantNumber && <p className="mt-1 text-[11px] text-[#806A8C]">Variant No. {line.variantNumber}</p>}</div>
                                                <span className="text-xs text-[#806A8C]">Available: {formatNumber(line.currentSellableStock)} pcs</span>
                                            </div>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="space-y-1"><label className={labelClass}>Quantity to Add</label>
                                                    <input type="number" min="0" step="1" value={line.quantity}
                                                           onChange={e => updateLine(i, "quantity", e.target.value)}
                                                           placeholder="0" className={fieldClass}/></div>
                                                <div className="space-y-1"><label className={labelClass}>Expiration Date (Optional)</label>
                                                    <input type="date" value={line.expirationDate}
                                                           onChange={e => updateLine(i, "expirationDate", e.target.value)}
                                                           className={fieldClass}/></div>
                                            </div>
                                            <p className="text-xs text-[#806A8C]">Available after receiving: {line.currentStock !== line.currentSellableStock ? "Reconciliation required" : `${formatNumber(line.currentSellableStock + (Number(line.quantity) || 0))} pcs`}</p>
                                        </div>
                                    ))}
                                    <div className="flex justify-between border-t border-[#E3D8EA] pt-3 text-sm font-semibold text-[#2B174C]">
                                        <span>Total Stock to Add</span><span>+{formatNumber(totalQuantity)} pcs</span>
                                    </div>
                                </section>
                            </>
                        )}
                        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                    </div>
                    <div className="flex justify-end gap-2 border-t border-[#E3D8EA] bg-white px-6 py-4">
                        <button type="button" onClick={onClose} disabled={saving}
                                className="rounded-xl border border-[#E3D8EA] px-5 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                        <button type="submit" disabled={loading || saving || totalQuantity <= 0}
                                className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                            {saving ? "Saving..." : "Confirm Stock In"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function StockActionCenter({
                               rows,
                               branchName,
                               onEdit,
                               onReceive,
                               onDispose,
                               onDelete,
                               onVariantRemoved,
                           }: {
    rows: ActionCenterRow[];
    branchName: string;
    onEdit: (product: Product) => void;
    onReceive: (product: Product) => void;
    onDispose: (product: Product, variantId: number | null) => void;
    onDelete: (product: Product) => void;
    onVariantRemoved: (name: string, mode: "archive" | "permanent") => Promise<void>;
}) {
    const [filter, setFilter] = React.useState<ActionCenterFilter>("All");
    const [reviewRow, setReviewRow] = React.useState<ActionCenterRow | null>(null);
    const [exportError, setExportError] = React.useState("");

    const visibleRows = React.useMemo(() => {
        return rows.filter((row) => {
            if (filter === "Low Stock Items") return row.issue === "Low Stock";
            if (filter === "Out of Stock Items") return row.issue === "Out of Stock";
            if (filter === "Expiring / Expired") {
                return row.issue === "Expiring" || row.issue === "Expired";
            }
            if (filter === "Slow Moving") return row.issue === "Slow Moving";
            return true;
        });
    }, [filter, rows]);

    return (
        <section className="flex h-[470px] min-h-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#E9E1EE] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                        <ClipboardList size={18} />
                    </span>
                    <div>
                        <h2 className="text-[15px] font-bold text-[#21132E]">
                            Stock Action Center
                        </h2>
                        <p className="mt-0.5 text-[11px] text-[#86778F]">
                            Review low stock, expiry risks, and slow-moving items.
                        </p>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <ManagerInventoryFilterSelect containerClassName="w-[165px]"
                                                  value={filter}
                                                  onChange={(event) =>
                                                      setFilter(event.target.value as ActionCenterFilter)
                                                  }
                                                  aria-label="Filter stock action center"
                    >
                        <option value="All">All</option>
                        <option value="Low Stock Items">Low Stock Items</option>
                        <option value="Out of Stock Items">Out of Stock Items</option>
                        <option value="Expiring / Expired">Expiring / Expired</option>
                        <option value="Slow Moving">Slow Moving</option>
                    </ManagerInventoryFilterSelect>
                    <button type="button" title="Download filtered stock action report (PDF)" aria-label="Download stock action report"
                            onClick={() => void downloadManagerInventoryReport("Stock Action Center",
                                ["Product", "Current Stock", "Reorder Point", "Sales Velocity", "Status", "Action"],
                                visibleRows.map(row => [row.productName, String(row.currentStock), String(row.reorderPoint), row.salesVelocity, row.issue, row.action]),
                                branchName, filter, "stocknbook_stock_action_center")
                                .then(() => setExportError(""))
                                .catch(() => setExportError("Unable to download stock action report."))}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#D9CDF0] bg-white text-[#5A35A5] hover:bg-[#F7F1FF]">
                        <Download size={16}/>
                    </button>
                </div>
            </div>
            {exportError && <p role="alert" className="px-4 py-1 text-xs text-red-600">{exportError}</p>}

            {visibleRows.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">
                    No items found for the selected stock action filter.
                </div>
            ) : (
                <div className="min-h-0 flex-1 w-full overflow-y-auto overflow-x-hidden">
                    <table className="w-full min-w-0 table-fixed text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <colgroup>
                            <col className="w-[24%]" />
                            <col className="w-[15%]" />
                            <col className="w-[14.5%]" />
                            <col className="w-[15%]" />
                            <col className="w-[12.5%]" />
                            <col className="w-[19%]" />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                        <tr className="border-b border-[#E9E1EE]">
                            <MiniHeader center>Product</MiniHeader>
                            <MiniHeader center>Current Stock</MiniHeader>
                            <MiniHeader center>Reorder Point</MiniHeader>
                            <MiniHeader center>Sales Velocity</MiniHeader>
                            <MiniHeader center>Status</MiniHeader>
                            <MiniHeader center>Action</MiniHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {visibleRows.map((row) => (
                            <tr
                                key={row.id}
                                className="border-b border-[#EFE8F2] last:border-b-0"
                            >
                                <td className="break-words py-2 font-semibold text-[#2B174C] px-4 text-left">
                                    {row.productName}
                                </td>
                                <td className="px-2 py-2 text-center font-semibold text-[#4F3A5A]">
                                    {formatNumber(row.currentStock)}
                                </td>
                                <td className="px-2 py-2 text-center text-[#5F4E75]">
                                    {row.reorderPoint > 0
                                        ? formatNumber(row.reorderPoint)
                                        : "—"}
                                </td>
                                <td className="px-2 py-2 text-center font-semibold text-[#2B174C]">
                                    {row.salesVelocity}
                                </td>
                                <td className="px-2 py-2 text-center">
                                    <ActionIssueBadge issue={row.issue} />
                                </td>
                                <td className="px-2 py-2 text-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (row.action === "Restock" || row.action === "Restock Now") {
                                                onReceive(row.product);
                                            } else if (row.issue === "Expired") {
                                                onDispose(row.product, row.variantId ?? null);
                                            } else if (row.action === "Review / Remove" || row.action === "Prioritize Sale") {
                                                setReviewRow(row);
                                            } else {
                                                onEdit(row.product);
                                            }
                                        }}
                                        className="inline-flex w-full max-w-[118px] items-center justify-center rounded-lg border border-[#D9CDF0] bg-[#F5F0FF] px-2 py-1.5 text-center text-[10px] font-semibold leading-4 text-[#5330B6] transition hover:bg-[#ECE3FF]"
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
            {reviewRow && (
                <StockActionReviewDialog
                    row={reviewRow}
                    onClose={() => setReviewRow(null)}
                    onReviewRemoval={() => {
                        // Only regular products use the existing whole-product deletion dialog.
                        // Variant rows are handled inside StockActionReviewDialog by variant ID.
                        if (reviewRow.variantId != null) return;
                        const product = reviewRow.product;
                        setReviewRow(null);
                        onDelete(product);
                    }}
                    onVariantRemoved={async (mode) => {
                        await onVariantRemoved(reviewRow.productName, mode);
                        setReviewRow(null);
                    }}
                />
            )}
        </section>
    );
}


function StockActionReviewDialog({
                                     row,
                                     onClose,
                                     onReviewRemoval,
                                     onVariantRemoved,
                                 }: {
    row: ActionCenterRow;
    onClose: () => void;
    onReviewRemoval: () => void;
    onVariantRemoved: (mode: "archive" | "permanent") => Promise<void>;
}) {
    const [variantImpact, setVariantImpact] = React.useState<{
        mode: "archive" | "permanent" | "blocked";
        blockers: string[];
        history: string[];
    } | null>(null);
    const [impactLoading, setImpactLoading] = React.useState(false);
    const [removeConfirm, setRemoveConfirm] = React.useState(false);
    const [removing, setRemoving] = React.useState(false);
    const [removeError, setRemoveError] = React.useState("");
    const product = row.product;
    const selectedVariant = row.variantId == null
        ? null
        : (product.variants || []).find((variant) => variant.id === row.variantId) || null;
    const selectedVariantId = selectedVariant?.id ?? null;
    const hasVariants = product.hasVariants && (product.variants || []).length > 0;
    const expirationDays = getDaysUntilExpiration(row.expirationDate);
    const unitCost = Number(selectedVariant?.originalPrice ?? product.originalPrice ?? 0);
    const sellingPrice = Number(selectedVariant?.salesPrice ?? product.salesPrice ?? 0);
    const riskIsExpired = row.issue === "Expired";

    React.useEffect(() => {
        if (selectedVariantId === null) return;
        const controller = new AbortController();
        const loadImpact = async () => {
            setImpactLoading(true);
            setVariantImpact(null);
            setRemoveError("");
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Session expired. Sign in again.");
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        action: "get_variant_removal_impact", id: product.id,
                        variantId: selectedVariantId,
                    }),
                    cache: "no-store",
                    signal: controller.signal,
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || result.success !== true || !result.impact ||
                    !["archive", "permanent", "blocked"].includes(result.impact.mode)) {
                    throw new Error(result.error || "Unable to check the variant's removal history.");
                }
                if (!controller.signal.aborted) setVariantImpact(result.impact);
            } catch (error) {
                if (!controller.signal.aborted) setRemoveError(error instanceof Error ? error.message : "Unable to check variant removal.");
            } finally {
                if (!controller.signal.aborted) setImpactLoading(false);
            }
        };
        void loadImpact();
        return () => controller.abort();
    }, [product.id, selectedVariantId]);

    const confirmVariantRemoval = async () => {
        if (!selectedVariant || removing || !variantImpact || variantImpact.mode === "blocked") return;
        setRemoving(true);
        setRemoveError("");
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Session expired. Sign in again.");
            const response = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "delete_variant", id: product.id, variantId: selectedVariant.id }),
                cache: "no-store",
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success !== true || !["archive", "permanent"].includes(result.mode)) {
                throw new Error(result.error || "Could not remove this variant.");
            }
            await onVariantRemoved(result.mode);
        } catch (error) {
            setRemoveError(error instanceof Error ? error.message : "Could not remove variant.");
            setRemoveConfirm(false);
        } finally {
            setRemoving(false);
        }
    };

    return (
        <div
            role="presentation"
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 px-3 py-5"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="stock-action-review-title"
                className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-3 border-b border-[#E9E1EE] px-5 py-4">
                    <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#5A35A5]">
                            <ClipboardList size={20} />
                        </span>
                        <div>
                            <h2 id="stock-action-review-title" className="text-lg font-bold text-[#21132E]">
                                {row.action === "Review / Remove" ? "Review / Remove Affected Item" : "Prioritize Sale — Affected Item Review"}
                            </h2>
                            <p className="mt-1 text-xs text-[#806A8C]">Review the affected inventory before taking action.</p>
                        </div>
                    </div>
                    <button type="button" aria-label="Close product review" onClick={onClose}
                            className="shrink-0 rounded-lg px-2 py-1 text-xl text-[#806A8C] hover:bg-[#F7F1FF]">×</button>
                </div>
                <div className="space-y-4 overflow-y-auto p-5">
                    <div className={`rounded-xl border px-4 py-3 ${riskIsExpired
                        ? "border-[#F2C7CC] bg-[#FFF3F4]"
                        : "border-[#E3D8EA] bg-[#F8F3FF]"}`}>
                        <div className={`text-sm font-bold ${riskIsExpired ? "text-[#B42335]" : "text-[#4E2C66]"}`}>
                            {riskIsExpired ? "Expired stock — do not sell" : "Expiring soon — review for priority sale"}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[#5A476A]">
                            {riskIsExpired
                                ? "This item is past its recorded expiration date. Review the stock and follow the business's disposal procedure before any removal."
                                : "This item is within the 30-day expiring-soon period. Only sell stock that is still safe and within its expiration date."}
                        </p>
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-[#21132E]">{row.productName}</h3>
                        <p className="mt-1 text-xs text-[#806A8C]">
                            Product No. {getProductNumber(product) || "—"}
                            {selectedVariant?.variantNumber ? ` · Variant No. ${selectedVariant.variantNumber}` : ""}
                        </p>
                    </div>
                    <div className="grid gap-3 rounded-xl border border-[#E9E1EE] bg-[#FFFCF8] p-4 sm:grid-cols-2">
                        <div><p className="text-[11px] text-[#806A8C]">Category</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{product.category || "—"}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Branch</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{product.branchName || "Assigned Branch"}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Affected Stock</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{formatNumber(row.currentStock)} pcs</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Reorder Point</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{formatNumber(row.reorderPoint)} pcs</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Expiration Date</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{formatDate(row.expirationDate)}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Expiration Status</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{expirationDays === null ? "—" : expirationDays < 0 ? `${Math.abs(expirationDays)} day(s) overdue` : expirationDays === 0 ? "Expires today" : `${expirationDays} day(s) left`}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Unit Cost</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{money(unitCost)}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Selling Price</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{money(sellingPrice)}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Sales Velocity</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{row.salesVelocity}</p></div>
                        <div><p className="text-[11px] text-[#806A8C]">Affected Stock Value (Cost)</p><p className="mt-1 text-sm font-semibold text-[#2B174C]">{money(Math.max(0, row.currentStock) * unitCost)}</p></div>
                    </div>
                    {hasVariants && (
                        <div className="rounded-xl border border-[#E9E1EE] p-4">
                            <h3 className="text-sm font-bold text-[#21132E]">Product Variants</h3>
                            <p className="mt-1 text-xs text-[#806A8C]">Only the highlighted expiring or expired variant is eligible for removal here. All other variants remain active and unchanged.</p>
                            <div className="mt-3 space-y-2">
                                {(product.variants || []).map((variant) => (
                                    <div key={variant.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${variant.id === row.variantId ? "bg-[#F1EBFF]" : "bg-[#FAF8FC]"}`}>
                                        <span className="font-semibold text-[#2B174C]">{getVariantName(variant)} {variant.variantNumber ? `· ${variant.variantNumber}` : ""}</span>
                                        <span className="text-[#5F4E75]">{formatNumber(variant.stock)} pcs · Exp. {formatDate(variant.expirationDate)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <p className="rounded-xl border border-[#E9E1EE] bg-[#FCF9FF] p-3 text-xs leading-5 text-[#5A476A]">
                        <strong>Before removal:</strong> StockNBook checks active bookings/packages and recorded POS,
                        restock and adjustment history. Only the selected variant (or regular product) can be removed.
                        Referenced inventory is archived; unused inventory may be permanently deleted. Other active variants stay untouched.
                    </p>
                    {selectedVariant && (
                        <div className="rounded-xl border border-[#E3D8EA] bg-[#F9F6FD] p-3 text-xs text-[#5A476A]">
                            {impactLoading ? "Checking variant transactions and dependencies..."
                                : variantImpact?.mode === "blocked"
                                    ? `Removal blocked: ${variantImpact.blockers?.join(" ") || "Resolve active commitments first."}`
                                    : variantImpact?.mode === "archive"
                                        ? "This variant has existing records or an expired inventory record and will be archived, not erased."
                                        : variantImpact?.mode === "permanent"
                                            ? "No recorded dependencies found. This variant can be permanently deleted."
                                            : "The variant removal check could not be completed."}
                        </div>
                    )}
                    {removeError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{removeError}</p>}
                    {removeConfirm && selectedVariant && (
                        <div role="alertdialog" aria-label="Confirm variant removal" className="rounded-xl border border-[#E4CCD9] bg-[#FFF7F8] p-4 text-sm">
                            <p className="font-semibold text-[#2B174C]">Confirm removal of {getVariantName(selectedVariant)} only?</p>
                            <p className="mt-1 text-xs text-[#806A8C]">{variantImpact?.mode === "archive" ? "This variant will be archived." : "This variant will be deleted."} All other variants will remain active.</p>
                            <div className="mt-3 flex justify-end gap-2">
                                <button type="button" disabled={removing} onClick={() => setRemoveConfirm(false)} className="rounded-lg border border-[#E3D8EA] px-3 py-2 text-xs">Back</button>
                                <button type="button" disabled={removing} onClick={() => void confirmVariantRemoval()} className="rounded-lg bg-[#2B174C] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{removing ? "Removing..." : "Confirm Variant Removal"}</button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-[#E9E1EE] bg-white px-5 py-4">
                    <button type="button" disabled={removing} onClick={onClose}
                            className="rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] hover:bg-[#F8F3FC]">
                        Keep Item
                    </button>
                    <button type="button" disabled={removing || (Boolean(selectedVariant) && (impactLoading || !variantImpact || variantImpact.mode === "blocked"))}
                            onClick={selectedVariant ? () => setRemoveConfirm(true) : onReviewRemoval}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50">
                        <Trash2 size={15} /> {selectedVariant ? "Review Variant Removal" : "Review Delete / Archive"}
                    </button>
                </div>
            </div>
        </div>
    );
}


function ActionIssueBadge({ issue }: { issue: ActionCenterRow["issue"] }) {
    const className =
        issue === "Out of Stock"
            ? "text-[#D92C3F]"
            : issue === "Low Stock"
                ? "text-[#C77A00]"
                : issue === "Slow Moving"
                    ? "text-[#3372BA]"
                    : issue === "Expired"
                        ? "text-[#8E4AA6]"
                        : "text-[#6944C9]";

    return (
        <span
            className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 ${className}`}
        >
            {issue}
        </span>
    );
}

function RecentStockActivity({
                                 movements,
                                 branchName,
                                 loading,
                             }: {
    movements: RecentStockMovement[];
    branchName: string;
    loading: boolean;
}) {
    const [activityDateFilter, setActivityDateFilter] = React.useState<"today" | "all" | "date">("today");
    const [selectedDate, setSelectedDate] = React.useState("");
    const [movementFilter, setMovementFilter] = React.useState<"all" | "in" | "out">("all");
    const [exportError, setExportError] = React.useState("");
    const todayKey = manilaActivityDateKey(new Date());
    const filteredMovements = React.useMemo(() => movements.filter(movement => {
        if (!movement.date) return false;
        const key = manilaActivityDateKey(movement.date);
        if (activityDateFilter === "today" && key !== todayKey) return false;
        if (activityDateFilter === "date" && (!selectedDate || key !== selectedDate)) return false;
        if (movementFilter === "in" && movement.movement !== "Stock In") return false;
        if (movementFilter === "out" && movement.movement === "Stock In") return false;
        return true;
    }), [movements, activityDateFilter, selectedDate, movementFilter, todayKey]);
    const downloadActivity = () => void downloadManagerInventoryReport(
        "Consumable Stock Activity", ["Date", "Time", "Product", "Movement", "Qty", "Reference No."],
        filteredMovements.map(m => [formatStockActivityDate(m.date),
            m.source === "POS Sale" && !m.hasRecordedTime ? "Not recorded" : formatStockActivityTime(m.date),
            m.productName, m.movement, String(m.movement === "Stock In" ? m.quantity : -m.quantity),
            m.referenceNumber || "—"]), branchName,
        `${activityDateFilter === "all" ? "All loaded dates" : activityDateFilter === "today" ? "Today" : selectedDate || "Select a date"} · ${movementFilter === "all" ? "All activity" : movementFilter === "in" ? "Stock In" : "Stock Out"}`,
        "stocknbook_consumable_stock_activity")
        .then(() => setExportError(""))
        .catch(() => setExportError("Unable to download the activity report."));
    return (
        <section className="flex h-[470px] min-h-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <div className="flex min-w-0 flex-col gap-2 border-b border-[#E9E1EE] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                    <CalendarClock size={18} />
                </span>
                    <div>
                        <h2 className="text-[15px] font-bold text-[#21132E]">
                            Consumable Stock Activity
                        </h2>
                        <p className="mt-0.5 text-[11px] text-[#86778F]">
                            Recorded consumable stock movements for the selected period.
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-1.5">
                    <ManagerInventoryFilterSelect containerClassName="w-[105px]" aria-label="Filter consumable activity date" value={activityDateFilter} onChange={e => setActivityDateFilter(e.target.value as "today" | "all" | "date")}>
                        <option value="today">Today</option><option value="all">All loaded</option><option value="date">Choose date</option>
                    </ManagerInventoryFilterSelect>
                    {activityDateFilter === "date" && <input type="date" aria-label="Choose consumable activity date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                                                             className="h-9 max-w-[135px] rounded-xl border border-[#E3D8EA] bg-white px-1 text-[11px] text-[#2B174C]" />}
                    <ManagerInventoryFilterSelect containerClassName="w-[116px]" aria-label="Filter consumable activity direction" value={movementFilter} onChange={e => setMovementFilter(e.target.value as "all" | "in" | "out")}>
                        <option value="all">All Activity</option><option value="in">Stock In</option><option value="out">Stock Out</option>
                    </ManagerInventoryFilterSelect>
                    <button type="button" title="Download filtered activity PDF" aria-label="Download filtered consumable activity" onClick={downloadActivity}
                            disabled={loading || (activityDateFilter === "date" && !selectedDate)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#D9CDF0] bg-white text-[#5A35A5] hover:bg-[#F7F1FF] disabled:opacity-40"><Download size={16}/></button>
                </div>
            </div>
            {exportError && <p role="alert" className="px-4 text-xs text-red-600">{exportError}</p>}

            {loading ? (
                <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">
                    Loading recent stock activity...
                </div>
            ) : filteredMovements.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">
                    No stock movements match the selected filters.
                </div>
            ) : (
                <div className="min-h-0 flex-1 w-full overflow-y-auto overflow-x-hidden">
                    <table className="w-full min-w-0 table-fixed text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <colgroup>
                            <col className="w-[19%]" />
                            <col className="w-[27%]" />
                            <col className="w-[18%]" />
                            <col className="w-[9%]" />
                            <col className="w-[27%]" />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                        <tr className="border-b border-[#E9E1EE]">
                            <MiniHeader center>Date & Time</MiniHeader>
                            <MiniHeader center>Product</MiniHeader>
                            <MiniHeader center>Movement</MiniHeader>
                            <MiniHeader center>Qty</MiniHeader>
                            <MiniHeader center>Reference No.</MiniHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {filteredMovements.map((movement) => {
                            const isStockIn = movement.movement === "Stock In";

                            return (
                                <tr
                                    key={movement.id}
                                    className="border-b border-[#EFE8F2] last:border-b-0"
                                >
                                    <td className="py-2 text-[#4F3A5A] px-4 text-left">
                                        <div className="whitespace-nowrap font-medium">
                                            {formatStockActivityDate(movement.date)}
                                        </div>
                                        <div className="mt-0.5 whitespace-nowrap text-[10px] text-[#8A7D90]">
                                            {movement.source === "POS Sale" && movement.hasRecordedTime === false
                                                ? "Time not recorded"
                                                : formatStockActivityTime(movement.date)}
                                        </div>
                                    </td>
                                    <td className="break-words px-2 py-2 font-medium text-[#2B174C]">
                                        {movement.productName}
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <span
                                            className={[
                                                "inline-block text-[10px] font-semibold",
                                                isStockIn
                                                    ? "text-[#23834A]"
                                                    : "text-[#D92C3F]",
                                            ].join(" ")}
                                        >
                                            {movement.movement}
                                        </span>
                                    </td>
                                    <td
                                        className={[
                                            "px-2 py-2 text-center font-semibold",
                                            isStockIn
                                                ? "text-[#23834A]"
                                                : "text-[#D92C3F]",
                                        ].join(" ")}
                                    >
                                        {isStockIn ? "+" : "-"}
                                        {formatNumber(movement.quantity)}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[#5F4E75]">
                                        {movement.referenceNumber || "—"}
                                    </td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
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
            className={`truncate px-2 py-2 text-[10px] font-semibold uppercase tracking-normal text-[#806A8C] ${
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
                    placeholder="Search product no., products, or categories..."
                    className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                />
            </div>

            <button
                type="button"
                onClick={inv.openImportDialog}
                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-5 text-sm font-semibold text-[#5330B6] shadow-sm transition hover:bg-[#ECE3FF]"
            >
                <Upload size={16} />
                Upload File
            </button>

            <button
                type="button"
                onClick={inv.openManageCategories}
                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-5 text-sm font-semibold text-[#5330B6] shadow-sm transition hover:bg-[#ECE3FF]"
            >
                <Settings2 size={16} />
                Manage Categories
            </button>

            <button
                type="button"
                onClick={inv.openAddProduct}
                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-5 text-sm font-semibold text-[#5330B6] shadow-sm transition hover:bg-[#ECE3FF]"
            >
                <Plus size={17} />
                Add Product
            </button>
        </div>
    );
}

function ManagerInventoryTable({
                                   inv,
                                   products,
                                   storeName,
                                   branchName,
                                   lastStockInDates,
                                   categories,
                                   selectedCategory,
                                   onCategoryChange,
                                   statusFilter,
                                   onStatusFilterChange,
                                   onEdit,
                                   onRestock,
                                   onDispose,
                                   onDelete,
                               }: {
    inv: InventoryController;
    products: Product[];
    storeName: string;
    branchName: string;
    lastStockInDates: { productDates: Record<number, string>; variantDates: Record<string, string> };
    categories: string[];
    selectedCategory: string;
    onCategoryChange: (value: string) => void;
    statusFilter: string;
    onStatusFilterChange: (value: string) => void;
    onEdit: (product: Product) => void;
    onRestock: (product: Product) => void;
    onDispose: (product: Product, variantId: number | null) => void;
    onDelete: (product: Product) => void;
}) {
    const [expandedIds, setExpandedIds] = React.useState<Record<number, boolean>>(
        {}
    );
    const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
    const [exportToast, setExportToast] = React.useState<SuccessToastMessage | null>(null);
    const closeExportToast = React.useCallback(() => setExportToast(null), []);
    const exportInventory = (format: "xlsx" | "pdf") => {
        setExportMenuOpen(false);
        const options = {
            storeName, branchName,
            categoryFilter: selectedCategory,
            statusFilter,
            generatedAt: new Date(),
        };
        try {
            if (format === "xlsx") exportManagerInventoryExcel(products, lastStockInDates.productDates, options);
            else exportManagerInventoryPdf(products, lastStockInDates.productDates, options);
            setExportToast({title: "Inventory export started", message: `${format === "xlsx" ? "Excel" : "PDF"} report prepared. Check your browser downloads.`});
        } catch (error) {
            setExportToast({title: "Unable to export inventory", message: error instanceof Error ? error.message : "Please try again.", tone: "error"});
        }
    };

    return (
        <section className="overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
            <SuccessToast toast={exportToast} onClose={closeExportToast} />
            <div className="flex flex-col gap-3 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                        <Boxes size={18} />
                    </span>
                    <div>
                        <h2 className="text-[15px] font-bold text-[#21132E]">
                            Branch Inventory List
                        </h2>
                        <p className="mt-0.5 text-[11px] text-[#86778F]">
                            Search, filter, and maintain the sales products assigned to this branch.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <ManagerInventoryFilterSelect containerClassName="w-[168px]"
                                                  value={selectedCategory}
                                                  onChange={(event) => onCategoryChange(event.target.value)}
                    >
                        <option value="All">All Categories</option>
                        {categories.map((category) => (
                            <option key={category} value={category}>
                                {category}
                            </option>
                        ))}
                    </ManagerInventoryFilterSelect>

                    <ManagerInventoryFilterSelect containerClassName="w-[140px]"
                                                  value={statusFilter}
                                                  onChange={(event) => onStatusFilterChange(event.target.value)}
                    >
                        <option>All Status</option>
                        <option>In Stock</option>
                        <option>Low Stock</option>
                        <option>Out of Stock</option>
                        <option>Expiring Soon</option>
                        <option>Expired</option>
                    </ManagerInventoryFilterSelect>

                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setExportMenuOpen((open) => !open)}
                            disabled={products.length === 0}
                            aria-haspopup="menu"
                            aria-expanded={exportMenuOpen}
                            aria-label="Download filtered inventory list"
                            title="Download filtered inventory list"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#D9CDF0] bg-white text-[#2B174C] hover:bg-[#F8F3FC] disabled:opacity-50"
                        >
                            <Download size={16} />
                        </button>
                        {exportMenuOpen && (
                            <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-xl border border-[#D9CDF0] bg-white py-1 shadow-lg">
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => exportInventory("xlsx")}
                                    className="block w-full px-4 py-2 text-left text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC]"
                                >
                                    Excel (.xlsx)
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => exportInventory("pdf")}
                                    className="block w-full px-4 py-2 text-left text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC]"
                                >
                                    PDF (.pdf)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="border-b border-[#E9E1EE] px-4 pb-4">
                <ManagerSearchActions inv={inv} />
            </div>

            {products.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center px-5 text-center text-sm text-[#8A7D90]">
                    No products found for the current filters.
                </div>
            ) : (
                <div className="max-h-[360px] w-full overflow-y-auto overflow-x-hidden overscroll-contain" style={{ maxHeight: 360 }} role="region" aria-label="Branch inventory list" tabIndex={0}>
                    <table className="w-full min-w-0 table-fixed text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <colgroup>
                            <col className="w-[10%]" />
                            <col className="w-[20%]" />
                            <col className="w-[11%]" />
                            <col className="w-[9%]" />
                            <col className="w-[8.5%]" />
                            <col className="w-[9%]" />
                            <col className="w-[8.5%]" />
                            <col className="w-[8%]" />
                            <col className="w-[16%]" />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                        <tr className="border-b border-[#E9E1EE]">
                            <MiniHeader center>Product No.</MiniHeader>
                            <MiniHeader center>Product</MiniHeader>
                            <MiniHeader center>Category</MiniHeader>
                            <MiniHeader center>Available Stock</MiniHeader>
                            <MiniHeader center>Reorder Point</MiniHeader>
                            <MiniHeader center>Last Stock In</MiniHeader>
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
                            // The column is "Available Stock", so display eligible batch
                            // stock, not legacy catalog stock used for receiving accounting.
                            const sellableProduct = {
                                ...product,
                                stock: product.sellableStock ?? product.stock,
                                variants: variants.map(v=>({...v,stock:v.sellableStock ?? v.stock})),
                            };
                            const status = getProductStatus(sellableProduct);

                            return (
                                <React.Fragment key={product.id}>
                                    <tr
                                        className={`h-12 border-b border-[#EFE8F2] hover:bg-[#FFFCF8] ${
                                            expandable
                                                ? "cursor-pointer"
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
                                        <td className="break-all py-2 font-mono text-[9px] font-semibold text-[#5F4E75] xl:text-[10px] px-4 text-left">
                                            <div className="flex items-center justify-start gap-1.5">
                                                <span>{getProductNumber(product) || "—"}</span>
                                                {expandable ? (
                                                    <ChevronDown
                                                        size={13}
                                                        className={`shrink-0 transition ${
                                                            expanded ? "rotate-180" : ""
                                                        }`}
                                                    />
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="break-words px-2 py-2 font-semibold text-[#2B174C]">
                                            <span>{product.name}</span>
                                            {product.ledgerMismatch && (
                                                <span
                                                    className="mt-1 block text-[10px] font-medium text-[#C03945]"
                                                    title={`Catalog: ${product.stock}; Branch: ${product.branchStock ?? 0}; Batches: ${product.batchStock ?? 0}. Verify physical stock and receipts before receiving more.`}
                                                >
                                                    Stock records need review
                                                </span>
                                            )}
                                        </td>
                                        <td className="break-words px-2 py-2 text-[#5F4E75]">
                                            {product.category || "—"}
                                        </td>
                                        <td className="px-2 py-2 text-center font-semibold text-[#2B174C]">
                                            {formatNumber(getProductTotalStock(sellableProduct))}
                                        </td>
                                        <td className="px-2 py-2 text-center text-[#5F4E75]">
                                            {formatNumber(getProductReorderLevel(product))}
                                        </td>
                                        <td className="px-2 py-2 text-center text-[#5F4E75]">
                                            {formatDate(lastStockInDates.productDates[product.id])}
                                        </td>
                                        <td className="px-2 py-2 text-center text-[#5F4E75]">
                                            {expiration
                                                ? formatDate(expiration.toISOString())
                                                : "—"}
                                        </td>
                                        <td className="px-2 py-2 text-center">
                                            <ManagerStatusBadge status={status} />
                                        </td>
                                        <td className="px-2 py-2 text-center">
                                            <div className="flex flex-wrap items-center justify-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onRestock(product);
                                                    }}
                                                    aria-label={`Restock ${product.name}`}
                                                    className="inline-flex items-center gap-1 rounded-lg bg-[#E5F8EC] px-2 py-1.5 text-[10px] font-semibold text-[#23834A] hover:bg-[#D5F0DF]"
                                                >
                                                    <PackagePlus size={11} />
                                                    Restock
                                                </button>
                                                {Number(product.expiredBatchUnits || 0) > 0 && !product.hasVariants && (
                                                    <button type="button" onClick={(event) => {
                                                        event.stopPropagation();
                                                        onDispose(product, null);
                                                    }} className="inline-flex items-center gap-1 rounded-lg bg-[#FFF0F0] px-2 py-1.5 text-[10px] font-semibold text-[#B42335] hover:bg-[#FFE2E2]">
                                                        Dispose Expired ({product.expiredBatchUnits})
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onEdit(product);
                                                    }}
                                                    className="inline-flex items-center gap-1 rounded-lg bg-[#F1EBFF] px-2 py-1.5 text-[10px] font-semibold text-[#5734B3] hover:bg-[#E7DCFF]"
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
                                                    className="inline-flex items-center gap-1 rounded-lg bg-[#FFF0F0] px-2 py-1.5 text-[10px] font-semibold text-[#D83A45] hover:bg-[#FFE2E2]"
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
                                                variantId: variant.id,
                                                product,
                                                productName: product.name,
                                                category: product.category,
                                                variantName: getVariantName(variant),
                                                stock: Number(variant.sellableStock ?? variant.stock ?? 0),
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
                                                    className="h-12 border-b border-[#EFE8F2] bg-[#FCF9FF]"
                                                >
                                                    <td className="break-all py-2 px-4 text-left font-mono text-[9px] text-[#9B8AAA]" title="Variant Number">
                                                        {variant.variantNumber || "—"}
                                                    </td>
                                                    <td className="break-words px-2 py-2 pl-8 text-[10px] font-semibold text-[#5F3D82]">
                                                        ↳ {getVariantName(variant)}
                                                    </td>
                                                    <td className="px-2 py-2 text-[#8A7D90]">
                                                        Variant
                                                    </td>
                                                    <td className="px-2 py-2 text-center font-semibold text-[#2B174C]">
                                                        {formatNumber(variant.sellableStock ?? variant.stock)}
                                                    </td>
                                                    <td className="px-2 py-2 text-center text-[#5F4E75]">
                                                        {formatNumber(variant.alertLevel)}
                                                    </td>
                                                    <td className="px-2 py-2 text-center text-[#5F4E75]">
                                                        {formatDate(lastStockInDates.variantDates[`${product.id}:${variant.id}`])}
                                                    </td>
                                                    <td className="px-2 py-2 text-center text-[#5F4E75]">
                                                        {formatDate(
                                                            variant.expirationDate
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-2 text-center">
                                                        <ManagerStatusBadge
                                                            status={getLineStatus(line)}
                                                        />
                                                    </td>
                                                    <td className="px-2 py-2 text-center">
                                                        {Number(variant.expiredBatchUnits || 0) > 0 && (
                                                            <button type="button" onClick={() => onDispose(product, variant.id)}
                                                                    className="rounded-lg bg-[#FFF0F0] px-2 py-1.5 text-[10px] font-semibold text-[#B42335] hover:bg-[#FFE2E2]">
                                                                Dispose Expired ({variant.expiredBatchUnits})
                                                            </button>
                                                        )}
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
            )}
        </section>
    );
}

function ManagerStatusBadge({ status }: { status: ManagerInventoryStatus }) {
    const className =
        status === "In Stock"
            ? "text-[#23834A]"
            : status === "Low Stock"
                ? "text-[#C77A00]"
                : status === "Out of Stock"
                    ? "text-[#D92C3F]"
                    : status === "Expiring Soon"
                        ? "text-[#6944C9]"
                        : "text-[#8E4AA6]";

    return (
        <span
            className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 ${className}`}
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
    tone?: "success" | "error";
};

type ProductSuccessAction = "add" | "update";

type ProductRemovalMode = "permanent" | "archive" | "blocked";

type ProductRemovalImpact = {
    mode: ProductRemovalMode;
    blockers?: string[];
    history?: string[];
    counts?: {
        completedPosSales?: number;
        bookingRecords?: number;
        activeBookings?: number;
        packageRecords?: number;
        activePackages?: number;
        restockRecords?: number;
        expiredInventory?: boolean;
    };
};

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
    }, [toast?.title, toast?.message, toast?.tone, onClose]);

    if (!toast) {
        return null;
    }

    const isError = toast.tone === "error";

    return (
        <div
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            className={[
                "fixed bottom-4 right-4 z-[210] flex w-[min(360px,calc(100vw-2rem))] sm:bottom-5 sm:right-5 items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)] transition-all duration-700 ease-out",
                isError ? "border-[#F4BFC5]" : "border-[#BCE8CA]",
                isFadingOut
                    ? "translate-y-3 opacity-0"
                    : "translate-y-0 opacity-100",
            ].join(" ")}
        >
            <span
                className={[
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    isError
                        ? "bg-[#FFE7EA] text-[#D92C3F]"
                        : "bg-[#E5F8EC] text-[#23834A]",
                ].join(" ")}
            >
                {isError ? (
                    <AlertTriangle size={20} strokeWidth={2.4} />
                ) : (
                    <CheckCircle2 size={20} strokeWidth={2.4} />
                )}
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


function getImportProductInitialCost(product: {hasVariants: boolean; variants?: Array<{stock:number;originalPrice:number}>;
    stock:number;originalPrice:number}) {
    return product.hasVariants
        ? (product.variants || []).reduce((sum, v) => sum + Number(v.stock || 0) * Number(v.originalPrice || 0), 0)
        : Number(product.stock || 0) * Number(product.originalPrice || 0);
}

function previewPricingLabel(value: { pricingMethod?: string;markupPercentage?: number|null }) {
    return value.pricingMethod === "markup" ? `Markup ${Number(value.markupPercentage ?? 0)}%` : "Manual";
}

export function InventoryDialogs({ inv }: { inv: InventoryController }) {
    const [pendingProductSuccess, setPendingProductSuccess] = React.useState<{
        action: ProductSuccessAction;
        name: string;
    } | null>(null);
    const [pendingRemovalResult, setPendingRemovalResult] = React.useState<{
        name: string;
        mode: Exclude<ProductRemovalMode, "blocked">;
    } | null>(null);
    const [removalImpact, setRemovalImpact] =
        React.useState<ProductRemovalImpact | null>(null);
    const [removalImpactLoading, setRemovalImpactLoading] =
        React.useState(false);
    const [removalImpactError, setRemovalImpactError] =
        React.useState("");
    const [productToast, setProductToast] =
        React.useState<SuccessToastMessage | null>(null);
    // Import-only validation message stays visible until the file is corrected.
    const [importValidationMessage, setImportValidationMessage] = React.useState("");
    const [productExpirationDate, setProductExpirationDate] =
        React.useState("");
    const [variantExpirationDates, setVariantExpirationDates] =
        React.useState<string[]>([]);

    const [purchaseLoading, setPurchaseLoading] = React.useState(false);
    const [purchaseError, setPurchaseError] = React.useState("");
    const [pricingMethod, setPricingMethod] = React.useState<InventoryPricingMethod>("manual");
    const [markupPercentage, setMarkupPercentage] = React.useState("");
    const [variantPricingMethods, setVariantPricingMethods] = React.useState<InventoryPricingMethod[]>([]);
    const [variantMarkupPercentages, setVariantMarkupPercentages] = React.useState<string[]>([]);

    const editingProduct = React.useMemo(() => {
        if (!inv.editingId) return undefined;

        const availableProducts = [
            ...(Array.isArray(inv.products) ? inv.products : []),
            ...(Array.isArray(inv.baseProducts) ? inv.baseProducts : []),
        ] as Product[];

        return availableProducts.find(
            (product) => Number(product.id) === Number(inv.editingId)
        );
    }, [inv.baseProducts, inv.editingId, inv.products]);

    React.useEffect(() => {
        if (!inv.showForm || inv.formMode !== "product") return;

        if (!inv.editingId) {
            setProductExpirationDate("");
            setVariantExpirationDates([]);
            return;
        }

        setProductExpirationDate(
            formatExpirationDateInput(editingProduct?.expirationDate)
        );
        setVariantExpirationDates(
            (editingProduct?.variants || []).map((variant) =>
                formatExpirationDateInput(variant.expirationDate)
            )
        );
    }, [
        editingProduct,
        inv.editingId,
        inv.formMode,
        inv.showForm,
    ]);

    // Keep the latest controller actions without refetching editor data on every
    // controller re-render (which would reset the user's unsaved form fields).
    const editorControllerRef = React.useRef(inv);
    React.useEffect(() => {
        editorControllerRef.current = inv;
    });
    const editorIsOpen = inv.showForm;
    const editorMode = inv.formMode;
    const editorProductId = inv.editingId;

    // Add and Edit display identical pricing fields. Edit reads the
    // persisted values before changes can be submitted, including manager cost
    // fields deliberately hidden from the overview inventory table.
    React.useEffect(() => {
        if (!editorIsOpen || editorMode !== "product") return;
        const productId = Number(editorProductId || 0);
        setPricingMethod("manual");
        setMarkupPercentage("");
        setVariantPricingMethods([]);
        setVariantMarkupPercentages([]);
        setPurchaseError("");
        if (!productId) {
            setPurchaseLoading(false);
            return;
        }
        let cancelled = false;
        const abort = new AbortController();
        setPurchaseLoading(true);
        (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Please sign in again.");
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_product_editor_details", id: productId }),
                    cache: "no-store",
                    signal: abort.signal,
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.product) {
                    throw new Error(data.error || "Unable to load the saved product details.");
                }
                if (cancelled) return;
                const saved = data.product as Product;
                setPricingMethod(saved.pricingMethod === "markup" ? "markup" : "manual");
                setMarkupPercentage(saved.markupPercentage == null ? "" : String(saved.markupPercentage));
                setVariantPricingMethods((saved.variants || []).map((v) => v.pricingMethod === "markup" ? "markup" : "manual"));
                setVariantMarkupPercentages((saved.variants || []).map((v) => v.markupPercentage == null ? "" : String(v.markupPercentage)));
                // Use authoritative editing values rather than overview values
                // (overview hides cost prices from non-owner roles).
                if (!saved.hasVariants) {
                    editorControllerRef.current.setOriginalPrice(String(saved.originalPrice));
                    editorControllerRef.current.setSalesPrice(String(saved.salesPrice));
                } else {
                    (saved.variants || []).forEach((v, index) => {
                        (editorControllerRef.current as VariantEditorController).updateVariantField(index, "originalPrice", String(v.originalPrice));
                        (editorControllerRef.current as VariantEditorController).updateVariantField(index, "salesPrice", String(v.salesPrice));
                    });
                }
            } catch (error) {
                if (cancelled || abort.signal.aborted) return;
                setPurchaseError(error instanceof Error ? error.message : "Unable to load the saved product details.");
            } finally {
                if (!cancelled) setPurchaseLoading(false);
            }
        })();
        return () => { cancelled = true; abort.abort(); };
        // The editor opens/closes or switches product IDs. Do not re-fetch after
        // each keystroke or controller render.
    }, [editorProductId, editorMode, editorIsOpen]);

    const closeProductToast = React.useCallback(() => {
        setProductToast(null);
    }, []);


    const showImportDuplicateToast = React.useCallback(
        (rawMessage: unknown) => {
            const message = String(rawMessage ?? "")
                .replace(/^❌\s*/, "")
                .trim();

            const existingProductMatch = message.match(
                /Product\s+"([^"]+)"\s+already exists in this branch\.?/i
            );

            if (existingProductMatch) {
                const productName = existingProductMatch[1].trim();

                setProductToast({
                    tone: "error",
                    title: "Product already exists",
                    message: `“${productName}” is already in this branch and was not imported.`,
                });

                return true;
            }

            const duplicateFileMatch = message.match(
                /Product\s+"([^"]+)"\s+is duplicated in the Excel file\.?/i
            );

            if (duplicateFileMatch) {
                const productName = duplicateFileMatch[1].trim();

                setProductToast({
                    tone: "error",
                    title: "Duplicate product in import file",
                    message: `“${productName}” appears more than once in the selected file.`,
                });

                return true;
            }

            return false;
        },
        []
    );

    const showImportValidationWarning = React.useCallback((rawMessage: unknown) => {
        const message = String(rawMessage ?? "").replace(/^[❌\s]+/, "").trim() ||
            "Please check the Excel file and try again.";
        setImportValidationMessage(message);
        // Preserve the existing specialized duplicate-product notification.
        if (!showImportDuplicateToast(message)) {
            setProductToast({
                tone: "error",
                title: "Excel import validation warning",
                message,
            });
        }
    }, [showImportDuplicateToast]);

    const handleImportFileSelection = React.useCallback(
        async (file: File | null) => {
            setImportValidationMessage("");
            if (!file) {
                inv.setSelectedImportFile(null);
                return;
            }

            const extension = file.name
                .split(".")
                .pop()
                ?.trim()
                .toLowerCase();

            /*
             * Only change XLSX worksheet selection.
             * All other existing file validation/import behavior remains owned
             * by the current inventory controller.
             */
            if (extension !== "xlsx") {
                inv.setSelectedImportFile(file);
                return;
            }

            try {
                const buffer = await file.arrayBuffer();

                const workbook = XLSX.read(buffer, {
                    type: "array",
                    cellDates: true,
                });

                // The complete import template has its own data sheet.
                // Preserve the workbook for the updated controller; the
                // legacy "Format" path below is untouched.
                if (workbook.SheetNames.includes("PRODUCTS AND VARIANTS")) {
                    inv.setSelectedImportFile(file);
                    return;
                }

                const formatSheetName = workbook.SheetNames.find(
                    (sheetName) =>
                        sheetName.trim().toLowerCase() === "format"
                );

                if (!formatSheetName) {
                    setProductToast({
                        tone: "error",
                        title: "Format sheet not found",
                        message:
                            'The selected XLSX file must contain a worksheet named “Format”.',
                    });
                    inv.setSelectedImportFile(null);
                    return;
                }

                const formatWorksheet =
                    workbook.Sheets[formatSheetName];

                /*
                 * Keep the actual template unchanged.
                 *
                 * The downloaded template currently contains the header
                 * "Expiraion Date (Optional)" (missing the second "t" in
                 * "Expiration"). The existing inventory importer therefore
                 * does not recognize that column and leaves expirationDate
                 * empty, which is why the confirmation table shows "—".
                 *
                 * Fix ONLY the in-memory copy used for import:
                 * - still read the "Format" worksheet
                 * - normalize only the expiration-date header
                 * - keep every other cell/column untouched
                 */
                const formatRows = XLSX.utils.sheet_to_json<unknown[]>(
                    formatWorksheet,
                    {
                        header: 1,
                        raw: true,
                        defval: "",
                    }
                );

                if (formatRows.length > 0) {
                    const headers = formatRows[0];

                    const expirationColumnIndex = headers.findIndex(
                        (header: unknown) => {
                            const normalized = String(header ?? "")
                                .trim()
                                .toLowerCase()
                                .replace(/\s+/g, " ");

                            return (
                                normalized ===
                                "expiraion date (optional)" ||
                                normalized ===
                                "expiration date (optional)" ||
                                normalized === "expiration date"
                            );
                        }
                    );

                    if (expirationColumnIndex >= 0) {
                        /*
                         * This is the field name expected by the import parser.
                         * The user's original workbook is NOT modified.
                         */
                        headers[expirationColumnIndex] =
                            "Expiration Date";

                        /*
                         * Normalize only expiration-date values so Excel dates
                         * such as 30/07/2026 reach the existing importer as a
                         * stable YYYY-MM-DD value.
                         */
                        for (
                            let rowIndex = 1;
                            rowIndex < formatRows.length;
                            rowIndex += 1
                        ) {
                            const rawExpiration =
                                formatRows[rowIndex]?.[
                                    expirationColumnIndex
                                    ];

                            if (
                                rawExpiration === null ||
                                rawExpiration === undefined ||
                                rawExpiration === ""
                            ) {
                                continue;
                            }

                            let normalizedExpiration = "";

                            if (rawExpiration instanceof Date) {
                                if (
                                    !Number.isNaN(
                                        rawExpiration.getTime()
                                    )
                                ) {
                                    const year =
                                        rawExpiration.getFullYear();
                                    const month = String(
                                        rawExpiration.getMonth() + 1
                                    ).padStart(2, "0");
                                    const day = String(
                                        rawExpiration.getDate()
                                    ).padStart(2, "0");

                                    normalizedExpiration =
                                        `${year}-${month}-${day}`;
                                }
                            } else if (
                                typeof rawExpiration === "number" &&
                                Number.isFinite(rawExpiration)
                            ) {
                                const parsedDate =
                                    XLSX.SSF.parse_date_code(
                                        rawExpiration
                                    );

                                if (parsedDate) {
                                    normalizedExpiration =
                                        `${String(parsedDate.y).padStart(
                                            4,
                                            "0"
                                        )}-${String(
                                            parsedDate.m
                                        ).padStart(
                                            2,
                                            "0"
                                        )}-${String(
                                            parsedDate.d
                                        ).padStart(2, "0")}`;
                                }
                            } else {
                                const text = String(
                                    rawExpiration
                                ).trim();

                                const dayFirstMatch = text.match(
                                    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
                                );

                                if (dayFirstMatch) {
                                    normalizedExpiration =
                                        `${dayFirstMatch[3]}-${dayFirstMatch[2].padStart(
                                            2,
                                            "0"
                                        )}-${dayFirstMatch[1].padStart(
                                            2,
                                            "0"
                                        )}`;
                                } else {
                                    normalizedExpiration = text;
                                }
                            }

                            if (normalizedExpiration) {
                                formatRows[rowIndex][
                                    expirationColumnIndex
                                    ] = normalizedExpiration;
                            }
                        }
                    }
                }

                const normalizedFormatWorksheet =
                    XLSX.utils.aoa_to_sheet(formatRows);

                const formatOnlyWorkbook = XLSX.utils.book_new();

                /*
                 * The existing useInventory import logic can continue reading
                 * its first worksheet. We only supply it a temporary in-memory
                 * copy containing the actual Format sheet, so the Instructions
                 * worksheet is never parsed as inventory data.
                 */
                XLSX.utils.book_append_sheet(
                    formatOnlyWorkbook,
                    normalizedFormatWorksheet,
                    "Format"
                );

                const formatOnlyBytes = XLSX.write(
                    formatOnlyWorkbook,
                    {
                        bookType: "xlsx",
                        type: "array",
                        cellDates: true,
                    }
                );

                const formatOnlyFile = new File(
                    [formatOnlyBytes],
                    file.name,
                    {
                        type:
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        lastModified: file.lastModified,
                    }
                );

                inv.setSelectedImportFile(formatOnlyFile);
            } catch (error) {
                console.error(
                    "Unable to read the Format worksheet:",
                    error
                );

                setProductToast({
                    tone: "error",
                    title: "Unable to read import file",
                    message: error instanceof Error ? error.message :
                        'StockNBook could not read the selected XLSX file.',
                });
                setImportValidationMessage(error instanceof Error ? error.message :
                    "Unable to open this Excel file. Download the StockNBook template and try again.");

                inv.setSelectedImportFile(null);
            }
        },
        [inv]
    );

    const previewImportProductsWithToast = React.useCallback(async () => {
        setImportValidationMessage("");
        const originalAlert = window.alert;
        // Only intercept notifications during this import; always restore alert afterward.
        window.alert = (message?: unknown) => showImportValidationWarning(message);
        try {
            await inv.importProductsFromExcel();
        } catch (error) {
            showImportValidationWarning(error instanceof Error ? error.message : "Unable to preview the Excel file.");
        } finally {
            window.alert = originalAlert;
        }
    }, [inv, showImportValidationWarning]);

    const confirmImportProductsWithToast = React.useCallback(async () => {
        if (
            inv.isImporting ||
            !Array.isArray(inv.importPreviewProducts) ||
            inv.importPreviewProducts.length === 0
        ) {
            return;
        }

        const importedSnapshot = inv.importPreviewProducts.map(
            (product) => ({
                name: String(product.name || "").trim(),
                branchId: Number(product.branchId || 0),
            })
        );

        const importedNames = new Set(
            importedSnapshot
                .map((product) => product.name.toLowerCase())
                .filter(Boolean)
        );

        let importSucceeded = false;
        const originalAlert = window.alert;

        /*
         * Keep the controller's existing import logic exactly as-is.
         * We only replace its browser popups with StockNBook notifications.
         */
        window.alert = (message?: unknown) => {
            const alertText = String(message ?? "");

            if (
                alertText
                    .toLowerCase()
                    .includes("products imported successfully")
            ) {
                importSucceeded = true;
                return;
            }

            showImportValidationWarning(alertText);
        };

        try {
            await inv.confirmImportProducts();
        } catch (error) {
            showImportValidationWarning(error instanceof Error ? error.message : "Unable to import the Excel file.");
        } finally {
            window.alert = originalAlert;
        }

        if (!importSucceeded) {
            return;
        }

        /*
         * create_product already assigns and stores the unique Product No.
         * (STORECODE-BRANCHCODE-SEQUENCE). Re-read the database silently so
         * imported rows display those persisted Product Nos. immediately.
         * This is NOT a browser/page refresh.
         */
        try {
            const token = sessionStorage.getItem("token");

            if (token) {
                const branchId =
                    importedSnapshot.find(
                        (product) => product.branchId > 0
                    )?.branchId || 0;

                const request: Record<string, unknown> = {
                    action: "get_products",
                };

                if (Number.isFinite(branchId) && branchId > 0) {
                    request.branch_id = branchId;
                }

                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(request),
                    cache: "no-store",
                });

                const payload = await response.json().catch(() => ({}));

                if (
                    response.ok &&
                    Array.isArray(payload?.products)
                ) {
                    const authoritativeImportedProducts =
                        payload.products.filter(
                            (product: Record<string, unknown>) =>
                                importedNames.has(
                                    String(product?.name ?? "")
                                        .trim()
                                        .toLowerCase()
                                )
                        );

                    window.dispatchEvent(
                        new CustomEvent(
                            "stocknbook:imported-product-numbers",
                            {
                                detail: authoritativeImportedProducts,
                            }
                        )
                    );
                }
            }
        } catch (syncError) {
            console.warn(
                "Imported Product No. synchronization failed:",
                syncError
            );
        }

        const importedCount = importedSnapshot.length;
        setImportValidationMessage("");

        setProductToast({
            title: "Products imported successfully",
            message:
                importedCount === 1
                    ? "1 product was added and assigned a unique Product No."
                    : `${importedCount} products were added and assigned unique Product Nos.`,
        });

        window.dispatchEvent(
            new Event("stocknbook:stock-activity-refresh")
        );
    }, [inv, showImportValidationWarning]);

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

        // Keep the existing controller-confirmation flow; attach only the new
        // pricing fields to the same save request.
        saveData.pricingMethod = pricingMethod;
        saveData.markupPercentage = pricingMethod === "markup"
            ? (markupPercentage.trim() ? Number(markupPercentage) : null)
            : null;
        if (saveData.hasVariants) {
            saveData.variants = (saveData.variants || []).map((variant, index) => ({
                ...variant,
                pricingMethod: variantPricingMethods[index] === "markup" ? "markup" : "manual",
                markupPercentage: variantPricingMethods[index] === "markup"
                    ? (variantMarkupPercentages[index]?.trim()
                        ? Number(variantMarkupPercentages[index]) : null)
                    : null,
            }));
        }
        if (purchaseLoading || purchaseError) return;
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
        pricingMethod, markupPercentage, variantPricingMethods,
        variantMarkupPercentages, purchaseLoading, purchaseError,
    ]);

    const requestEditingProductDelete = React.useCallback(() => {
        if (!editingProduct) return;

        inv.setShowForm(false);
        inv.requestDeleteProduct(editingProduct);
    }, [editingProduct, inv]);

    const showRemovalDialog = inv.showDeleteProductDialog;
    const removalProductId = inv.productToDelete?.id;
    React.useEffect(() => {
        if (!showRemovalDialog || !removalProductId) {
            setRemovalImpact(null);
            setRemovalImpactError("");
            setRemovalImpactLoading(false);
            return;
        }

        const controller = new AbortController();
        const productId = Number(removalProductId);

        const loadRemovalImpact = async () => {
            if (typeof window === "undefined") return;

            const token = sessionStorage.getItem("token");

            if (!token) {
                setRemovalImpactError(
                    "Unable to verify product usage because your session is unavailable."
                );
                return;
            }

            setRemovalImpact(null);
            setRemovalImpactError("");
            setRemovalImpactLoading(true);

            try {
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_product_removal_impact",
                        id: productId,
                    }),
                    cache: "no-store",
                    signal: controller.signal,
                });

                const payload = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(
                        String(
                            payload.error ||
                            "Unable to verify whether this product can be removed."
                        )
                    );
                }

                const impact = (payload.impact || payload) as ProductRemovalImpact;

                if (
                    impact.mode !== "permanent" &&
                    impact.mode !== "archive" &&
                    impact.mode !== "blocked"
                ) {
                    throw new Error("Invalid product removal response.");
                }

                setRemovalImpact(impact);
            } catch (error) {
                if ((error as Error)?.name === "AbortError") return;

                setRemovalImpactError(
                    error instanceof Error
                        ? error.message
                        : "Unable to verify whether this product can be removed."
                );
            } finally {
                if (!controller.signal.aborted) {
                    setRemovalImpactLoading(false);
                }
            }
        };

        void loadRemovalImpact();

        return () => controller.abort();
    }, [
        removalProductId,
        showRemovalDialog,
    ]);

    const confirmDeleteProduct = React.useCallback(async () => {
        const productName = inv.productToDelete?.name.trim() || "";

        if (
            !productName ||
            !removalImpact ||
            removalImpact.mode === "blocked"
        ) {
            return;
        }

        setPendingRemovalResult({
            name: productName,
            mode: removalImpact.mode,
        });

        await inv.confirmDeleteProduct();
    }, [inv, removalImpact]);

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

        window.dispatchEvent(
            new Event("stocknbook:stock-activity-refresh")
        );

        setPendingProductSuccess(null);
    }, [inv.showConfirmProductSaveDialog, pendingProductSuccess]);

    React.useEffect(() => {
        if (
            !pendingRemovalResult ||
            inv.showDeleteProductDialog ||
            inv.productToDelete
        ) {
            return;
        }

        const wasArchived = pendingRemovalResult.mode === "archive";

        setProductToast({
            title: wasArchived
                ? "Product archived successfully"
                : "Product deleted permanently",
            message: wasArchived
                ? `“${pendingRemovalResult.name}” was removed from future operations while its historical records were preserved.`
                : `“${pendingRemovalResult.name}” had no business history and was permanently deleted.`,
        });
        setPendingRemovalResult(null);
    }, [
        inv.productToDelete,
        inv.showDeleteProductDialog,
        pendingRemovalResult,
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
                                if (inv.formMode === "product" && !purchaseLoading && !purchaseError) inv.handleSubmitProduct(e);
                                else e.preventDefault();
                            }}
                            className={
                                inv.formMode === "category"
                                    ? "h-[calc(100%-44px)]"
                                    : "space-y-3"
                            }
                        >
                            {inv.formMode === "product" && purchaseLoading && (
                                <p className="rounded-xl bg-[#F7F1FF] p-3 text-sm text-[#4E2C66]">Loading saved pricing details...</p>
                            )}
                            {inv.formMode === "product" && purchaseError && (
                                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{purchaseError}. Close and reopen Edit Product to retry.</p>
                            )}
                            {inv.formMode === "category" ? (
                                <CategoryForm inv={inv} />
                            ) : (!purchaseLoading && !purchaseError) ? (
                                <ProductForm
                                    inv={inv}
                                    pricingMethod={pricingMethod}
                                    setPricingMethod={setPricingMethod}
                                    markupPercentage={markupPercentage}
                                    setMarkupPercentage={setMarkupPercentage}
                                    variantPricingMethods={variantPricingMethods}
                                    setVariantPricingMethods={setVariantPricingMethods}
                                    variantMarkupPercentages={variantMarkupPercentages}
                                    setVariantMarkupPercentages={setVariantMarkupPercentages}
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
                                    onDeleteProduct={
                                        editingProduct
                                            ? requestEditingProductDelete
                                            : undefined
                                    }
                                />
                            ) : null}
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
                                    Select the StockNBook XLSX template. Products will not be added until confirmed.
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
                                void handleImportFileSelection(
                                    e.target.files?.[0] || null
                                )
                            }
                            className="w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] file:mr-4 file:rounded-lg file:border-0 file:bg-[#2B174C] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                        />

                        {importValidationMessage && (
                            <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                <p className="font-semibold">Check your Excel file</p>
                                <p className="mt-1 whitespace-pre-wrap break-words">{importValidationMessage}</p>
                                <p className="mt-1 text-xs">No products were saved. Correct the cell and preview again.</p>
                            </div>
                        )}
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
                                href="/templates/StockNBook_Bulk_Import_Detailed_Instructions.xlsx"
                                download="StockNBook_Bulk_Import_Detailed_Instructions.xlsx"
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
                                    onClick={() => void previewImportProductsWithToast()}
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
                    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E6DDF0] px-5 py-4 sm:px-6">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">Confirm Imported Products</h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">Review all products and variants before importing.</p>
                                <p className="mt-1 text-xs font-semibold text-[#5A476A]">
                                    {inv.importPreviewProducts.length} product(s) • {inv.importPreviewProducts.reduce((total, p) => total + (p.hasVariants ? (p.variants || []).length : 1), 0)} inventory line(s)
                                </p>
                            </div>
                            <button type="button" onClick={inv.closeImportDialog} aria-label="Close import preview"
                                    className="text-[#9B8AAA] hover:text-[#1A1220]">✕</button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                            {importValidationMessage && (
                                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                    <p className="font-semibold">Import not saved — check the following</p>
                                    <p className="mt-1 whitespace-pre-wrap break-words">{importValidationMessage}</p>
                                </div>
                            )}
                            {inv.importPreviewProducts.map((product) => {
                                const lines = product.hasVariants && (product.variants || []).length
                                    ? product.variants || [] : [{
                                        stock: product.stock, alertLevel: product.alertLevel,
                                        originalPrice: product.originalPrice, salesPrice: product.salesPrice,
                                        expirationDate: product.expirationDate,
                                        pricingMethod: product.pricingMethod || "manual",
                                        markupPercentage: product.markupPercentage ?? null,
                                        variantValues: {} as Record<string,string>,
                                    }];
                                return (
                                    <section key={product.tempId} className="overflow-hidden rounded-xl border border-[#E3D8EA] bg-[#FFFCF8]">
                                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E3D8EA] bg-white p-4">
                                            <div>
                                                <p className="text-[15px] font-bold text-[#21132E]">{product.name}</p>
                                                <p className="mt-1 text-xs text-[#675875]">Category: {product.category} • Variants: {product.hasVariants ? "Yes" : "No"}</p>
                                            </div>
                                            <span className="text-xs font-semibold text-[#23834A]">Valid</span>
                                        </div>
                                        <div className="space-y-3 p-4">
                                            <h4 className="text-sm font-bold text-[#21132E]">Inventory &amp; Pricing Details</h4>
                                            <div className="max-h-[320px] overflow-auto overscroll-contain rounded-lg border border-[#E9E1EE] bg-white">
                                                <table className="w-full min-w-0 table-fixed text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                                                    <colgroup>
                                                        <col className="w-[24%]"/><col className="w-[9%]"/>
                                                        <col className="w-[10%]"/><col className="w-[12%]"/>
                                                        <col className="w-[16%]"/><col className="w-[13%]"/>
                                                        <col className="w-[16%]"/>
                                                    </colgroup>
                                                    <thead className="sticky top-0 z-10 bg-[#F8F3FC] text-[#5A476A]"><tr>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Variant</th>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Stock</th>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Reorder Point</th>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Cost Price</th>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Pricing Method</th>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Selling Price</th>
                                                        <th className="truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]">Expiration Date</th>
                                                    </tr></thead>
                                                    <tbody>
                                                    {lines.map((rawLine, index) => {
                                                        const line = rawLine as typeof rawLine & {pricingMethod?: string;markupPercentage?: number|null};
                                                        const variantName = product.hasVariants
                                                            ? Object.entries(line.variantValues || {}).map(([k, v]) => `${k}: ${v}`).join(" / ") || `Variant ${index + 1}`
                                                            : "Regular";
                                                        return <tr key={`${product.tempId}-${index}`} className="border-t border-[#EFE7F4]">
                                                            <td className="break-words py-2 font-semibold text-[#2B174C] px-4 text-left">{variantName}</td>
                                                            <td className="px-2 py-2 text-center">{formatNumber(line.stock)}</td>
                                                            <td className="px-2 py-2 text-center">{formatNumber(line.alertLevel)}</td>
                                                            <td className="px-2 py-2 text-center">{money(Number(line.originalPrice))}</td>
                                                            <td className="px-2 py-2 text-center">{previewPricingLabel(line)}</td>
                                                            <td className="px-2 py-2 text-center font-bold text-[#21132E]">{money(Number(line.salesPrice))}</td>
                                                            <td className="px-2 py-2 text-center">{formatImportExpirationDate(line.expirationDate)}</td>
                                                        </tr>;
                                                    })}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="flex flex-wrap justify-between gap-2 text-xs text-[#5A476A]">
                                                <span>Initial stock: <strong>{formatNumber(product.stock)}</strong></span>
                                                <span>Total reorder point: <strong>{formatNumber(product.alertLevel)}</strong></span>
                                                <span>Product Purchase Cost: <strong>{money(getImportProductInitialCost(product))}</strong></span>
                                            </div>
                                        </div>

                                    </section>
                                );
                            })}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[#E6DDF0] bg-white px-5 py-4 sm:px-6">
                            <button type="button" onClick={() => { inv.setShowImportConfirmDialog(false); inv.setShowImportDialog(true); }}
                                    className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]">Back</button>
                            <button type="button" onClick={inv.closeImportDialog}
                                    className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]">Cancel</button>
                            <button type="button" disabled={inv.isImporting || inv.importPreviewProducts.length === 0}
                                    onClick={() => void confirmImportProductsWithToast()}
                                    className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40">
                                {inv.isImporting ? "Importing..." : "Confirm Import"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {inv.showDeleteProductDialog && inv.productToDelete && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[18px] font-bold text-[#1A1220]">
                                    Remove Product
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    StockNBook checks business usage before removing{" "}
                                    <span className="font-semibold text-[#1A1220]">
                                        {inv.productToDelete.name}
                                    </span>
                                    .
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={inv.closeDeleteProductDialog}
                                className="shrink-0 text-[#9B8AAA] hover:text-[#1A1220]"
                                aria-label="Close product removal dialog"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="mt-4">
                            {removalImpactLoading ? (
                                <div className="rounded-xl border border-[#E6DDF0] bg-[#FAF7FC] px-4 py-3 text-sm text-[#6A5D6F]">
                                    Checking POS sales, bookings, packages, and inventory history...
                                </div>
                            ) : removalImpactError ? (
                                <div className="rounded-xl border border-[#F2C7CC] bg-[#FFF3F4] px-4 py-3">
                                    <p className="text-sm font-semibold text-[#B42335]">
                                        Product removal could not be verified.
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-[#7F5960]">
                                        {removalImpactError}
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-[#7F5960]">
                                        No product will be removed until the safety check succeeds.
                                    </p>
                                </div>
                            ) : removalImpact?.mode === "blocked" ? (
                                <div className="rounded-xl border border-[#F1D39D] bg-[#FFF8E8] px-4 py-3">
                                    <p className="text-sm font-semibold text-[#9A6500]">
                                        This product cannot be removed yet.
                                    </p>
                                    <div className="mt-1 space-y-1 text-xs leading-5 text-[#785C27]">
                                        {(removalImpact.blockers || []).map((blocker) => (
                                            <p key={blocker}>• {blocker}</p>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-[#785C27]">
                                        Resolve the active booking or remove the product from the active package first.
                                    </p>
                                </div>
                            ) : removalImpact?.mode === "archive" ? (
                                <div className="rounded-xl border border-[#D8CBE9] bg-[#F8F3FF] px-4 py-3">
                                    <p className="text-sm font-semibold text-[#4E2C66]">
                                        This product has business history and will be archived.
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-[#6A5D6F]">
                                        It will disappear from future POS, booking, reorder, and active inventory selections,
                                        while historical sales, bookings, reports, and analytics remain preserved.
                                    </p>
                                    {(removalImpact.history || []).length > 0 && (
                                        <p className="mt-2 text-xs font-medium text-[#5A476A]">
                                            History found: {(removalImpact.history || []).join(", ")}.
                                        </p>
                                    )}
                                </div>
                            ) : removalImpact?.mode === "permanent" ? (
                                <div className="rounded-xl border border-[#F2C7CC] bg-[#FFF3F4] px-4 py-3">
                                    <p className="text-sm font-semibold text-[#B42335]">
                                        This product has no business history.
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-[#7F5960]">
                                        It can be permanently deleted because it has never been used in POS sales,
                                        bookings, packages, or restock history.
                                    </p>
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={inv.closeDeleteProductDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={
                                    removalImpactLoading ||
                                    Boolean(removalImpactError) ||
                                    !removalImpact ||
                                    removalImpact.mode === "blocked"
                                }
                                onClick={() => void confirmDeleteProduct()}
                                className={[
                                    "rounded-xl px-4 py-2 text-sm font-semibold transition",
                                    removalImpact?.mode === "archive"
                                        ? "bg-[#2B174C] text-white hover:bg-[#1B0D31]"
                                        : "bg-red-600 text-white hover:bg-red-700",
                                    "disabled:cursor-not-allowed disabled:opacity-40",
                                ].join(" ")}
                            >
                                {removalImpactLoading
                                    ? "Checking..."
                                    : removalImpact?.mode === "archive"
                                        ? "Archive Product"
                                        : removalImpact?.mode === "permanent"
                                            ? "Delete Permanently"
                                            : removalImpact?.mode === "blocked"
                                                ? "Removal Blocked"
                                                : "Unavailable"}
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
            setCategoryToast({title:"Category name required",message:"Please enter a category name before continuing.",tone:"error"});
            return;
        }

        if (cleanValue === categoryToEdit) {
            setCategoryToast({title:"No changes made",message:"Enter a different category name to save your update.",tone:"error"});
            return;
        }

        setShowEditCategoryDialog(false);
        setShowConfirmEditCategoryDialog(true);
    };

    const confirmEditCategory = async () => {
        const previousCategoryName = categoryToEdit;
        const updatedCategoryName = editCategoryDraft.trim();

        await inv.updateCategoryNow(previousCategoryName, updatedCategoryName);

        setCategoryToast({
            title: "Category updated successfully",
            message: `“${previousCategoryName}” was changed to “${updatedCategoryName}”.`,
        });

        closeEditCategoryDialog();
    };

    const openAddCategoryDialog = () => {
        const cleanValue = inv.category.trim();

        if (!cleanValue) {
            setCategoryToast({title:"Category name required",message:"Please enter a category name before continuing.",tone:"error"});
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

        const deletedCategoryName = categoryToDelete;

        await inv.deleteCategoryNow(deletedCategoryName);

        setCategoryToast({
            title: "Category deleted successfully",
            message: `“${deletedCategoryName}” was deleted from inventory categories.`,
        });

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
                         onDeleteProduct,
                         pricingMethod, setPricingMethod, markupPercentage, setMarkupPercentage,
                         variantPricingMethods, setVariantPricingMethods,
                         variantMarkupPercentages, setVariantMarkupPercentages,
                     }: {
    inv: InventoryController;
    productExpirationDate: string;
    setProductExpirationDate: (value: string) => void;
    variantExpirationDates: string[];
    setVariantExpirationDates: React.Dispatch<
        React.SetStateAction<string[]>
    >;
    onDeleteProduct?: () => void;
    pricingMethod: InventoryPricingMethod;
    setPricingMethod: (value: InventoryPricingMethod) => void;
    markupPercentage: string;
    setMarkupPercentage: (value: string) => void;
    variantPricingMethods: InventoryPricingMethod[];
    setVariantPricingMethods: React.Dispatch<React.SetStateAction<InventoryPricingMethod[]>>;
    variantMarkupPercentages: string[];
    setVariantMarkupPercentages: React.Dispatch<React.SetStateAction<string[]>>;
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

            <h3 className="pt-2 text-sm font-bold text-[#1A1220]">Product Information</h3>
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

            <h3 className="border-t border-[#E6DDF0] pt-5 text-sm font-bold text-[#1A1220]">Inventory &amp; Pricing</h3>
            {inv.hasVariants ? (
                <VariantEditor
                    key={inv.editingId ?? "new"}
                    inv={inv as VariantEditorController}
                    variantPricingMethods={variantPricingMethods}
                    setVariantPricingMethods={setVariantPricingMethods}
                    variantMarkupPercentages={variantMarkupPercentages}
                    setVariantMarkupPercentages={setVariantMarkupPercentages}
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

                    <SimpleProductFields inv={inv} pricingMethod={pricingMethod}
                                         setPricingMethod={setPricingMethod} markupPercentage={markupPercentage}
                                         setMarkupPercentage={setMarkupPercentage} />
                </>
            )}

            {inv.editingId && onDeleteProduct ? (
                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={onDeleteProduct}
                        className="w-full rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
                    >
                        <span className="inline-flex items-center justify-center gap-2">
                            <Trash2 size={15} />
                            DELETE PRODUCT
                        </span>
                    </button>

                    <button
                        type="submit"
                        className="w-full rounded-xl bg-[#2B174C] py-3 text-sm font-semibold text-white transition hover:bg-[#1B0D31]"
                    >
                        UPDATE PRODUCT
                    </button>
                </div>
            ) : (
                <button
                    type="submit"
                    className="w-full rounded-xl bg-[#2B174C] py-3 text-sm font-semibold text-white transition hover:bg-[#1B0D31]"
                >
                    Save Product
                </button>
            )}
        </>
    );
}


function SimpleProductFields({ inv, pricingMethod, setPricingMethod, markupPercentage, setMarkupPercentage }: {
    inv: InventoryController;
    pricingMethod: InventoryPricingMethod;
    setPricingMethod: (value: InventoryPricingMethod) => void;
    markupPercentage: string;
    setMarkupPercentage: (value: string) => void;
}) {
    // Pricing selection is saved alongside the final editable selling price.

    const handleCostPriceChange = (value: string) => {
        inv.setOriginalPrice(value);
        if (pricingMethod === "markup") {
            const calculated = calculateMarkupSellingPrice(value, markupPercentage);
            if (calculated !== null) inv.setSalesPrice(calculated);
        }
    };

    const handleMarkupChange = (value: string) => {
        setMarkupPercentage(value);
        if (pricingMethod === "markup") {
            const calculated = calculateMarkupSellingPrice(inv.originalPrice, value);
            if (calculated !== null) inv.setSalesPrice(calculated);
        }
    };

    const handlePricingMethodChange = (value: InventoryPricingMethod) => {
        setPricingMethod(value);
        if (value === "markup") {
            const calculated = calculateMarkupSellingPrice(inv.originalPrice, markupPercentage);
            if (calculated !== null) inv.setSalesPrice(calculated);
        }
    };

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
                    <label className={labelClass}>Reorder Point</label>
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <label className={labelClass}>Cost Price</label>
                    <PesoPriceInput
                        value={inv.originalPrice}
                        onChange={handleCostPriceChange}
                    />
                </div>

                <div className="space-y-1">
                    <label className={labelClass}>Pricing Method</label>
                    <select
                        value={pricingMethod}
                        onChange={(e) => handlePricingMethodChange(e.target.value as InventoryPricingMethod)}
                        className={fieldClass}
                    >
                        <option value="manual">Manual Selling Price</option>
                        <option value="markup">Percentage Markup</option>
                    </select>
                </div>

                {pricingMethod === "markup" && (
                    <div className="space-y-1">
                        <label className={labelClass}>Markup Percentage (%)</label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={markupPercentage}
                            onChange={(e) => handleMarkupChange(e.target.value)}
                            placeholder="e.g. 5"
                            required
                            className={fieldClass}
                        />
                        <p className="text-[11px] text-[#9B8AAA]">
                            Selling price = Cost price × (1 + Markup ÷ 100).
                        </p>
                    </div>
                )}

                <div className="space-y-1">
                    <label className={labelClass}>Final Selling Price</label>
                    <PesoPriceInput
                        value={inv.salesPrice}
                        onChange={(value) => {
                            // An explicit final price overrides the suggested percentage.
                            setPricingMethod("manual");
                            inv.setSalesPrice(value);
                        }}
                    />
                    <p className="text-[11px] text-[#9B8AAA]">
                        You can enter any final price; editing it uses manual pricing.
                    </p>
                </div>
            </div>
        </>
    );
}

function VariantEditor({
                           inv,
                           variantPricingMethods, setVariantPricingMethods,
                           variantMarkupPercentages, setVariantMarkupPercentages,
                           variantExpirationDates,
                           setVariantExpirationDates,
                       }: {
    inv: VariantEditorController;
    variantPricingMethods: InventoryPricingMethod[];
    setVariantPricingMethods: React.Dispatch<React.SetStateAction<InventoryPricingMethod[]>>;
    variantMarkupPercentages: string[];
    setVariantMarkupPercentages: React.Dispatch<React.SetStateAction<string[]>>;
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

    React.useEffect(() => {
        variants.forEach((variant, index) => {
            if ((variantPricingMethods[index] || "manual") !== "markup") return;

            const calculated = calculateMarkupSellingPrice(
                variant.originalPrice,
                variantMarkupPercentages[index] || ""
            );
            if (calculated !== null && Number(variant.salesPrice) !== Number(calculated)) {
                inv.updateVariantField(index, "salesPrice", calculated);
            }
        });
    }, [variants, variantPricingMethods, variantMarkupPercentages, inv.updateVariantField]);

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
                    placeholder="Attribute column name"
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
                        setVariantPricingMethods((current) => [...current, "manual"]);
                        setVariantMarkupPercentages((current) => [...current, ""]);
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

            <div className="mt-5 space-y-3">
                {variants.map((variant: ProductVariantSave, index: number) => (
                    <div key={index} className="rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div><p className="text-sm font-bold text-[#2B174C]">Variant {index + 1}{Object.values(variant.variantValues || {}).filter(Boolean).length ? ` — ${Object.values(variant.variantValues || {}).filter(Boolean).join(' / ')}` : ''}</p>
                                {variant.id && <p className="mt-1 text-[11px] text-[#806A8C]">Variant No. {(((inv.products as unknown as Product[]).find(p=>p.id===inv.editingId)?.variants || []).find(v=>v.id===variant.id)?.variantNumber) || "—"}</p>}</div>
                            <button type="button" className="text-xs font-semibold text-red-500 hover:underline" onClick={() => {
                                if (inv.editingId && variant.id) return;
                                inv.removeVariantRow(index);
                                setVariantPricingMethods((current) => current.filter((_, i) => i !== index));
                                setVariantMarkupPercentages((current) => current.filter((_, i) => i !== index));
                                setVariantExpirationDates((current) => current.filter((_, i) => i !== index));
                            }} disabled={Boolean(inv.editingId && variant.id)}
                                    title={inv.editingId && variant.id ? "Existing variants must be archived in a dedicated action" : undefined}
                            >Remove</button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {variantColumns.map((column) => (
                                <div className="space-y-1" key={column}>
                                    <label className={labelClass}>{column}</label>
                                    <input className={compactVariantFieldClass} value={getVariantInputValue(variant.variantValues, column)} placeholder={`Enter ${column}`}
                                           onChange={(e) => inv.updateVariantValue(index, column, e.target.value)} />
                                </div>
                            ))}
                            <div className="space-y-1">
                                <label className={labelClass}>Stock</label>
                                <input type="number" min="0" className={compactVariantFieldClass} value={variant.stock}
                                       onChange={(e) => inv.updateVariantField(index, "stock", e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>Reorder Point</label>
                                <input type="number" min="0" className={compactVariantFieldClass} value={variant.alertLevel}
                                       onChange={(e) => inv.updateVariantField(index, "alertLevel", e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>Cost Price</label>
                                <PesoPriceInput compact value={variant.originalPrice}
                                                onChange={(value) => inv.updateVariantField(index, "originalPrice", value)} />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>Pricing Method</label>
                                <select className={compactVariantFieldClass} value={variantPricingMethods[index] || "manual"}
                                        onChange={(e) => {
                                            const method = e.target.value as InventoryPricingMethod;
                                            setVariantPricingMethods((current) => { const next = [...current]; next[index] = method; return next; });
                                        }}>
                                    <option value="manual">Manual Selling Price</option>
                                    <option value="markup">Percentage Markup</option>
                                </select>
                            </div>
                            {(variantPricingMethods[index] || "manual") === "markup" && (
                                <div className="space-y-1">
                                    <label className={labelClass}>Markup (%)</label>
                                    <input type="number" min="0" step="0.01" className={compactVariantFieldClass}
                                           value={variantMarkupPercentages[index] || ""}
                                           required
                                           onChange={(e) => {
                                               const value = e.target.value;
                                               setVariantMarkupPercentages((current) => { const next = [...current]; next[index] = value; return next; });
                                           }} />
                                </div>
                            )}
                            <div className="space-y-1">
                                <label className={labelClass}>Final Selling Price</label>
                                <PesoPriceInput compact value={variant.salesPrice} onChange={(value) => {
                                    setVariantPricingMethods((current) => { const next = [...current]; next[index] = "manual"; return next; });
                                    inv.updateVariantField(index, "salesPrice", value);
                                }} />
                            </div>
                            <div className="space-y-1">
                                <label className={labelClass}>Expiration Date (Optional)</label>
                                <input type="date" className={compactVariantFieldClass} value={variantExpirationDates[index] || ""}
                                       onChange={(e) => setVariantExpirationDates((current) => { const next = [...current]; next[index] = e.target.value; return next; })} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

}