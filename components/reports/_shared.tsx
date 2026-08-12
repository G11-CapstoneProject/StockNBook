"use client";

import {
    Fragment,
    type ComponentType,
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import * as XLSX from "xlsx";
import {
    ArrowLeft,
    ArrowRight,
    CalendarDays,
    ChevronDown,
    ChevronUp,
    DollarSign,
    FileSpreadsheet,
    FileText,
    MapPin,
    Package,
    RefreshCw,
    RotateCcw,
    Search,
    Store,
    Users,
} from "lucide-react";

export type UserRole = "owner" | "manager" | "staff";

export type ReportsViewConfig = {
    showBranchFilter: boolean;
    showBranchColumn: boolean;
};

export type ReportsWorkspaceProps = {
    initialRole: UserRole;
    assignedBranch: string;
    storeName: string;
    viewConfig: ReportsViewConfig;
};
type ReportKey =
    | "inventory"
    | "restock"
    | "bookings"
    | "sales"
    | "forecasting"
    | "staff"
    | "packages";

type InventoryStatus = "In Stock" | "Low Stock" | "Out of Stock";
type ExpirationStatus = "Good" | "Soon to Expire" | "Expired" | "No Expiry";
type InventoryFilter = "all" | "in" | "low" | "out" | "soon" | "expired";
type BookingFilter = "all" | BookingStatus;
type PackageStatusFilter = "all" | "active" | "inactive";
type BookingStatus =
    | "pending"
    | "confirmed"
    | "preparing"
    | "cancelled"
    | "completed";

type LiveApiRecord = Record<string, unknown>;

type LiveProductsResponse = {
    products?: unknown[];
    error?: string;
};

type LiveInventoryLoadState = {
    ready: boolean;
    items: InventoryItem[];
};

type LiveBranchOption = {
    id: string;
    name: string;
};

type LiveBranchesResponse = {
    branches?: unknown[];
    error?: string;
};

type LiveSalesResponse = {
    orders?: unknown[];
    sales?: unknown[];
    transactions?: unknown[];
    data?: unknown;
    error?: string;
};

type LiveSalesLoadState = {
    ready: boolean;
    items: SaleRecord[];
};

type LiveBookingsResponse = {
    bookings?: unknown[];
    records?: unknown[];
    data?: unknown;
    error?: string;
};

type LiveBookingsLoadState = {
    ready: boolean;
    items: BookingRecord[];
};

type InventoryVariant = {
    id: string;
    name: string;
    sku?: string;
    stock: number;
    reorderLevel?: number;
    status?: InventoryStatus;
    costPrice?: number;
    salesPrice?: number;
    expiryDate?: string;
    lastUpdated?: string;
    updatedBy?: string;
};

type InventoryItem = {
    id: string;
    product: string;
    category: string;
    branch: string;
    stock: number;
    reorderLevel: number;
    status: InventoryStatus;
    costPrice?: number;
    salesPrice?: number;
    expiryDate?: string;
    lastUpdated?: string;
    updatedBy?: string;
    variants?: InventoryVariant[];
};

type RestockRecord = {
    id: string;
    date: string;
    product: string;
    variantName?: string;
    branch: string;
    quantityAdded: number;
    currentStock: number;
    stockBefore?: number;
    receivedBy?: string;
    reference?: string;
    notes?: string;
};

type BookingRecord = {
    id: string;
    reference: string;
    date: string;
    eventDate: string;
    scheduleTime?: string;
    branch: string;
    branchId?: string;
    customer: string;
    phone?: string;
    venue?: string;
    packageName: string;
    status: BookingStatus;
    statusLabel?: string;
    amount: number;
    amountPaid?: number;
    requiredDownPayment?: number;
    balance?: number;
    paymentStatus?: string;
    notes?: string;
};

type RevenueSource = "pos" | "booking";

type SaleRecord = {
    id: string;
    reference: string;
    date: string;
    branch: string;
    branchId?: string;
    customer: string;
    product: string;
    itemsText?: string;
    category: string;
    quantity: number;
    amount: number;
    /*
      Orders returned by /api/pos include both true POS orders and
      booking-linked order records. Keep the source on every order so the
      Report can place it in exactly one revenue column.
    */
    revenueSource: RevenueSource;
    linkedBookingId?: string;
    linkedBookingReference?: string;
    statusLabel?: string;
};


type ForecastRecord = {
    id: string;
    item: string;
    type: "Product" | "Package";
    currentValue: string;
    forecastedDemand: string;
    suggestedRestock: string;
    riskLevel: "Low" | "Medium" | "High";
};

type SeasonalInsight = {
    period: string;
    trend: string;
    recommendation: string;
};

type SystemModule = "Bookings" | "Inventory" | "Packages" | "Sales / POS";
type StaffModuleFilter = "all" | SystemModule;

type StaffActivity = {
    id: string;
    date: string;
    time?: string;
    staffName: string;
    role: string;
    action: string;
    module: SystemModule;
    reference?: string;
    details?: string;
    branch: string;
};

type PackageRecord = {
    id: string;
    name: string;
    description?: string;
    category?: string;
    branch: string;
    price: number;
    itemCount?: number;
    status: string;
    updatedAt?: string;
    updatedBy?: string;
};

type BookingSummary = {
    totalBookings: number;
    pending: number;
    confirmed?: number;
    preparing?: number;
    cancelled: number;
    completed: number;
};

type ReportData = {
    branch?: string;
    storeName?: string;
    store_name?: string;
    businessName?: string;
    business_name?: string;
    monthLabel?: string;
    dateRange?: {
        startDate: string;
        endDate: string;
    };
    summary?: {
        grossSales: number;
        bookingRevenue: number;
        totalTransactions: number;
        averageOrderValue: number;
    };
    bookingSummary?: BookingSummary;
    branchOptions?: string[];
    access?: {
        role?: UserRole;
        assignedBranch?: string;
        branchLocked?: boolean;
    };
    inventoryList?: InventoryItem[];
    lowStockItems?: InventoryItem[];
    outOfStockItems?: InventoryItem[];
    restockHistory?: RestockRecord[];
    bookingList?: BookingRecord[];
    salesList?: SaleRecord[];
    forecasting?: ForecastRecord[];
    seasonalInsights?: SeasonalInsight[];
    staffActivities?: StaffActivity[];
    packageList?: PackageRecord[];
};

type ReportCard = {
    key: ReportKey;
    title: string;
    subtitle: string;
    icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
    iconClassName: string;
};

type ExportTable = {
    title: string;
    headers: string[];
    rows: string[][];
};

const DEFAULT_BRANCH = "Assigned Branch";
const ALL_BRANCHES = "All Branches";

function isAllBranches(value: string) {
    return value.trim().toLowerCase() === "all branches";
}

const REPORT_CARDS: ReportCard[] = [
    {
        key: "inventory",
        title: "Inventory Report",
        subtitle: "View stock levels, item movement, and inventory valuation.",
        icon: Package,
        iconClassName: "bg-[#F1E8FF] text-[#6F3EE8]",
    },
    {
        key: "restock",
        title: "Restock Report",
        subtitle: "Identify low-stock items and recommended restock quantities.",
        icon: RotateCcw,
        iconClassName: "bg-[#FFF0DF] text-[#F47A18]",
    },
    {
        key: "sales",
        title: "POS Report",
        subtitle: "Analyze sales performance, revenue, and transaction summaries.",
        icon: DollarSign,
        iconClassName: "bg-[#E7F7EE] text-[#0E9A53]",
    },
    {
        key: "bookings",
        title: "Booking Report",
        subtitle: "Review booking activity, status, and revenue over time.",
        icon: CalendarDays,
        iconClassName: "bg-[#E8F2FF] text-[#2F7BEA]",
    },
    {
        key: "packages",
        title: "Packages Report",
        subtitle: "View all package offerings, details, and pricing information.",
        icon: Package,
        iconClassName: "bg-[#FFF3DB] text-[#E9A008]",
    },
    {
        key: "staff",
        title: "Employee Actions",
        subtitle: "Monitor ongoing actions and recent activity by employees.",
        icon: Users,
        iconClassName: "bg-[#F1E8FF] text-[#7A3FF2]",
    },
];

function getToday() {
    return new Date().toISOString().slice(0, 10);
}

function getMonthStart(date: string) {
    return `${date.slice(0, 7)}-01`;
}


function formatPeso(value: number) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
    }).format(Number(value || 0));
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("en-PH").format(Number(value || 0));
}

function formatDate(value: string) {
    if (!value) return "—";

    return new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
}

function formatDateRange(startDate: string, endDate: string) {
    if (!startDate || !endDate) return "Selected period";
    if (startDate === endDate) return formatDate(startDate);

    return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}


function getExpirationStatus(expiryDate?: string): ExpirationStatus {
    const normalizedDate = toReportDateValue(expiryDate);

    if (!normalizedDate) return "No Expiry";

    const today = getToday();

    if (normalizedDate < today) return "Expired";

    const soonLimit = new Date(`${today}T12:00:00`);
    soonLimit.setDate(soonLimit.getDate() + 30);
    const soonLimitValue = soonLimit.toISOString().slice(0, 10);

    return normalizedDate <= soonLimitValue ? "Soon to Expire" : "Good";
}

function expirationStatusClass(status: ExpirationStatus) {
    if (status === "Expired") return "bg-[#FCE9E7] text-[#C7372F]";
    if (status === "Soon to Expire") return "bg-[#FFF4D8] text-[#B66A00]";
    if (status === "Good") return "bg-[#E8F6EC] text-[#17733A]";
    return "bg-[#F2EEF5] text-[#766A7E]";
}

function getEarliestExpiryDate(values: Array<string | undefined>) {
    const dates = values
        .map((value) => toReportDateValue(value))
        .filter(Boolean)
        .sort();

    return dates[0] || "";
}


function getStoredSessionValue(keys: string[]) {
    if (typeof window === "undefined") {
        return "";
    }

    for (const key of keys) {
        const value =
            sessionStorage.getItem(key) ||
            localStorage.getItem(key) ||
            "";

        if (value.trim()) {
            return value.trim();
        }
    }

    return "";
}

function asLiveRecord(value: unknown): LiveApiRecord {
    return value && typeof value === "object"
        ? (value as LiveApiRecord)
        : {};
}

function asLiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function asLiveText(...values: unknown[]) {
    for (const value of values) {
        const text = String(value ?? "").trim();

        if (text) {
            return text;
        }
    }

    return "";
}

/*
  API Gateway/Lambda responses can return records in different wrappers:
  { orders: [] }, { bookings: [] }, { data: { orders: [] } }, or { data: [] }.
  This keeps POS and Bookings separate even when the response wrapper changes.
*/
function getLiveCollection(
    payload: unknown,
    keys: string[]
): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }

    const direct = asLiveRecord(payload);

    for (const key of keys) {
        if (Array.isArray(direct[key])) {
            return direct[key] as unknown[];
        }
    }

    const nested = asLiveRecord(direct.data);

    for (const key of keys) {
        if (Array.isArray(nested[key])) {
            return nested[key] as unknown[];
        }
    }

    if (Array.isArray(direct.data)) {
        return direct.data as unknown[];
    }

    return [];
}

/*
  The POS endpoint reads the shared orders table. That table contains:
  - POS receipts:      POS-... or <STORE>-POS-...
  - booking order rows: DEMO-FC-W-SC-03, DEMO-FC-SIGN-01, etc.

  Do not put every returned order in POS Sales. Use an explicit source field
  when the API returns one; otherwise treat only POS-pattern IDs as POS.
  Every other order ID belongs to Booking Revenue. This keeps the two database
  sources separate in Total Revenue without grouping unrelated records.
*/
function getOrderRevenueSource(
    rawValue: unknown,
    orderId: string
): RevenueSource {
    const raw = asLiveRecord(rawValue);
    const explicitSource = asLiveText(
        raw.revenueSource,
        raw.revenue_source,
        raw.orderSource,
        raw.order_source,
        raw.orderType,
        raw.order_type,
        raw.transactionType,
        raw.transaction_type,
        raw.recordType,
        raw.record_type,
        raw.source,
        raw.module
    ).toLowerCase();

    const hasLinkedBookingField = Boolean(
        raw.bookingId ??
        raw.booking_id ??
        raw.bookingReference ??
        raw.booking_reference ??
        raw.booking_ref ??
        raw.bookingRef
    );

    if (hasLinkedBookingField) {
        return "booking";
    }

    const normalizedOrderId = String(orderId || "")
        .trim()
        .toUpperCase();

    /*
      Examples classified as POS:
      POS-20260629-1782710218616
      DEMO-POS-20260629
      STELLISE-POS-20260629-02
    */
    if (
        normalizedOrderId.startsWith("POS-") ||
        normalizedOrderId.includes("-POS-") ||
        normalizedOrderId.includes("_POS_")
    ) {
        return "pos";
    }

    if (
        explicitSource.includes("booking") ||
        explicitSource.includes("reservation") ||
        explicitSource.includes("package")
    ) {
        return "booking";
    }

    if (explicitSource.includes("pos")) {
        return "pos";
    }

    /*
      Example classified as Booking Revenue:
      DEMO-FC-W-SC-03

      A non-POS order ID belongs to Booking Revenue. A generic "sales"
      source value must not override this convention because both modules use
      the same orders table.
    */
    return "booking";
}

function getBookingReportAmount(raw: LiveApiRecord) {
    /*
      The Bookings module can keep both agreed_price and package_price.
      Some records initialize agreed_price to 0, so choose the first positive
      booking amount rather than stopping at that placeholder zero.
    */
    const values = [
        raw.agreed_price,
        raw.agreedPrice,
        raw.package_price,
        raw.packagePrice,
        raw.total_price,
        raw.totalPrice,
        raw.total_amount,
        raw.totalAmount,
        raw.amount,
        raw.price,
    ];

    for (const value of values) {
        const amount = asLiveNumber(value);

        if (amount > 0) {
            return amount;
        }
    }

    return 0;
}

function getInventoryStatus(
    stock: number,
    reorderLevel: number
): InventoryStatus {
    if (stock <= 0) {
        return "Out of Stock";
    }

    if (stock <= reorderLevel) {
        return "Low Stock";
    }

    return "In Stock";
}

function getLiveVariantName(variant: LiveApiRecord, index: number) {
    const directName = asLiveText(
        variant.name,
        variant.variantName,
        variant.variant_name,
        variant.label
    );

    if (directName) {
        return directName;
    }

    const rawValues =
        variant.variantValues ??
        variant.variant_values ??
        variant.values ??
        {};

    const values =
        rawValues && typeof rawValues === "object"
            ? Object.values(rawValues as Record<string, unknown>)
                .map((value) => String(value ?? "").trim())
                .filter(Boolean)
            : [];

    return values.join(", ") || `Variant ${index + 1}`;
}

function normalizeLiveInventoryProduct(
    rawValue: unknown,
    index: number,
    fallbackBranch: string
): InventoryItem {
    const raw = asLiveRecord(rawValue);
    const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
    const productId = asLiveText(raw.id, raw.productId, raw.product_id) || `live-product-${index + 1}`;

    const variants = rawVariants.map((rawVariant, variantIndex) => {
        const variant = asLiveRecord(rawVariant);
        const stock = asLiveNumber(variant.stock);
        const reorderLevel = asLiveNumber(
            variant.alertLevel ?? variant.alert_level ?? variant.reorderLevel ?? variant.reorder_level
        );

        return {
            id:
                asLiveText(variant.id, variant.variantId, variant.variant_id) ||
                `${productId}-variant-${variantIndex + 1}`,
            sku: asLiveText(variant.sku, variant.code) || undefined,
            name: getLiveVariantName(variant, variantIndex),
            stock,
            reorderLevel,
            costPrice: asLiveNumber(
                variant.originalPrice ?? variant.original_price ?? variant.costPrice ?? variant.cost_price
            ),
            salesPrice: asLiveNumber(
                variant.salesPrice ?? variant.sales_price ?? variant.price
            ),
            expiryDate:
                toReportDateValue(
                    variant.expiryDate ??
                    variant.expiry_date ??
                    variant.expirationDate ??
                    variant.expiration_date
                ) || undefined,
            lastUpdated:
                asLiveText(
                    variant.updatedAt,
                    variant.updated_at,
                    variant.lastUpdated,
                    variant.last_updated
                ) || undefined,
            updatedBy:
                asLiveText(
                    variant.updatedByName,
                    variant.updated_by_name,
                    variant.updatedBy,
                    variant.updated_by
                ) || undefined,
            status: getInventoryStatus(stock, reorderLevel),
        } satisfies InventoryVariant;
    });

    const hasVariants = Boolean(
        raw.hasVariants ?? raw.has_variants ?? variants.length > 0
    );

    const stock = hasVariants && variants.length > 0
        ? variants.reduce((total, variant) => total + variant.stock, 0)
        : asLiveNumber(raw.stock);

    const reorderLevel = hasVariants && variants.length > 0
        ? variants.reduce(
            (total, variant) => total + Number(variant.reorderLevel || 0),
            0
        )
        : asLiveNumber(
            raw.alertLevel ??
            raw.alert_level ??
            raw.reorderLevel ??
            raw.reorder_level
        );

    const hasOutOfStockVariant = variants.some(
        (variant) => variant.status === "Out of Stock"
    );
    const hasLowStockVariant = variants.some(
        (variant) => variant.status === "Low Stock"
    );

    const status: InventoryStatus =
        hasVariants && variants.length > 0
            ? hasOutOfStockVariant
                ? "Out of Stock"
                : hasLowStockVariant
                    ? "Low Stock"
                    : "In Stock"
            : getInventoryStatus(stock, reorderLevel);

    return {
        id: productId,
        product: asLiveText(raw.name, raw.productName, raw.product_name) || "Unnamed Product",
        category: asLiveText(raw.category, raw.categoryName, raw.category_name) || "Uncategorized",
        branch:
            asLiveText(raw.branchName, raw.branch_name, raw.branch) ||
            fallbackBranch ||
            "Assigned Branch",
        stock,
        reorderLevel,
        status,
        costPrice: asLiveNumber(
            raw.originalPrice ?? raw.original_price ?? raw.costPrice ?? raw.cost_price
        ),
        salesPrice: asLiveNumber(
            raw.salesPrice ?? raw.sales_price ?? raw.price
        ),
        expiryDate:
            toReportDateValue(
                raw.expiryDate ??
                raw.expiry_date ??
                raw.expirationDate ??
                raw.expiration_date
            ) ||
            getEarliestExpiryDate(variants.map((variant) => variant.expiryDate)) ||
            undefined,
        lastUpdated:
            asLiveText(
                raw.updatedAt,
                raw.updated_at,
                raw.lastUpdated,
                raw.last_updated,
                raw.createdAt,
                raw.created_at
            ) || undefined,
        updatedBy:
            asLiveText(
                raw.updatedByName,
                raw.updated_by_name,
                raw.updatedBy,
                raw.updated_by,
                raw.modifiedBy,
                raw.modified_by
            ) || undefined,
        variants: variants.length > 0 ? variants : undefined,
    };
}

function toReportDateValue(value: unknown) {
    const text = String(value ?? "").trim();

    if (!text || text === "0000-00-00") {
        return "";
    }

    const directMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (directMatch) {
        return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
    }

    const parsed = new Date(text);

    if (Number.isNaN(parsed.getTime())) {
        return "";
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function isDateInSelectedRange(
    dateValue: string,
    startDate: string,
    endDate: string
) {
    return Boolean(
        dateValue &&
        (!startDate || dateValue >= startDate) &&
        (!endDate || dateValue <= endDate)
    );
}

function getLiveOrderItemsText(raw: LiveApiRecord) {
    const directItems = asLiveText(
        raw.item,
        raw.itemsText,
        raw.items_text,
        raw.orderItemsText,
        raw.order_items_text
    );

    if (directItems) {
        return directItems;
    }

    const rawItems = Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(raw.order_items)
            ? raw.order_items
            : [];

    const itemLabels = rawItems
        .map((rawItem) => {
            const item = asLiveRecord(rawItem);
            const name =
                asLiveText(
                    item.name,
                    item.itemName,
                    item.item_name,
                    item.productName,
                    item.product_name
                ) || "Item";
            const quantity = asLiveNumber(item.quantity ?? item.qty);

            return quantity > 0 ? `${name} × ${quantity}` : name;
        })
        .filter(Boolean);

    return itemLabels.join(", ") || "No items recorded";
}

function normalizeLivePosOrder(
    rawValue: unknown,
    index: number,
    fallbackBranch: string
): SaleRecord {
    const raw = asLiveRecord(rawValue);
    const orderId =
        asLiveText(
            raw.orderId,
            raw.order_id,
            raw.id,
            raw.reference,
            raw.referenceNo,
            raw.reference_no
        ) || `POS-ORDER-${index + 1}`;
    const date =
        [
            raw.orderDate,
            raw.order_date,
            raw.date,
            raw.createdAt,
            raw.created_at,
            raw.transactionDate,
            raw.transaction_date,
        ]
            .map((value) => toReportDateValue(value))
            .find(Boolean) || "";
    const itemText = getLiveOrderItemsText(raw);
    const revenueSource = getOrderRevenueSource(raw, orderId);

    return {
        id: orderId,
        reference: orderId,
        date,
        branch:
            asLiveText(raw.branchName, raw.branch_name, raw.branch) ||
            fallbackBranch ||
            "Assigned Branch",
        branchId: asLiveText(raw.branchId, raw.branch_id),
        customer:
            asLiveText(raw.customerName, raw.customer_name, raw.customer) ||
            "-",
        product: itemText,
        itemsText: itemText,
        category: asLiveText(raw.category, raw.categoryName, raw.category_name),
        quantity: asLiveNumber(
            raw.quantity ?? raw.totalQuantity ?? raw.total_quantity
        ),
        amount: asLiveNumber(
            raw.total ?? raw.amount ?? raw.grandTotal ?? raw.grand_total
        ),
        revenueSource,
        linkedBookingId:
            asLiveText(raw.bookingId, raw.booking_id) || undefined,
        linkedBookingReference:
            asLiveText(
                raw.bookingReference,
                raw.booking_reference,
                raw.booking_ref,
                raw.bookingRef
            ) || undefined,
        statusLabel:
            asLiveText(
                raw.status,
                raw.orderStatus,
                raw.order_status,
                raw.bookingStatus,
                raw.booking_status
            ) || undefined,
    };
}

function normalizeLiveBookingStatus(value: unknown): BookingStatus {
    const normalized = asLiveText(value).toLowerCase();

    if (normalized === "canceled" || normalized === "cancelled") {
        return "cancelled";
    }

    if (normalized.includes("complete")) {
        return "completed";
    }

    if (normalized.includes("confirm")) {
        return "confirmed";
    }

    if (normalized.includes("prepar")) {
        return "preparing";
    }

    return "pending";
}

function normalizeLiveBooking(
    rawValue: unknown,
    index: number,
    fallbackBranch: string
): BookingRecord {
    const raw = asLiveRecord(rawValue);
    const id =
        asLiveText(raw.id, raw.bookingId, raw.booking_id) ||
        `BOOKING-${index + 1}`;
    const reference =
        asLiveText(
            raw.bookingReference,
            raw.booking_reference,
            raw.reference,
            raw.referenceNo,
            raw.reference_no,
            raw.referenceNumber,
            raw.reference_number
        ) || id;
    const status = normalizeLiveBookingStatus(
        raw.status ?? raw.bookingStatus ?? raw.booking_status
    );
    const statusLabel = asLiveText(
        raw.statusLabel,
        raw.status_label,
        raw.status,
        raw.bookingStatus,
        raw.booking_status
    );

    /*
      Use the completion date when it exists because this is a revenue report.
      Fall back to updated/created/booking date for legacy records.
    */
    const date =
        [
            raw.completedAt,
            raw.completed_at,
            raw.eventDate,
            raw.event_date,
            raw.scheduleDate,
            raw.schedule_date,
            raw.bookingDate,
            raw.booking_date,
            raw.date,
            raw.updatedAt,
            raw.updated_at,
            raw.createdAt,
            raw.created_at,
        ]
            .map((value) => toReportDateValue(value))
            .find(Boolean) || "";

    const eventDate =
        [
            raw.eventDate,
            raw.event_date,
            raw.scheduleDate,
            raw.schedule_date,
            raw.bookingDate,
            raw.booking_date,
            raw.date,
        ]
            .map((value) => toReportDateValue(value))
            .find(Boolean) || date;

    return {
        id,
        reference,
        date,
        eventDate,
        scheduleTime:
            asLiveText(
                raw.scheduleTime,
                raw.schedule_time,
                raw.eventTime,
                raw.event_time,
                raw.time
            ) || undefined,
        branch:
            asLiveText(raw.branchName, raw.branch_name, raw.branch) ||
            fallbackBranch ||
            "Assigned Branch",
        branchId: asLiveText(raw.branchId, raw.branch_id) || undefined,
        customer:
            asLiveText(
                raw.customerName,
                raw.customer_name,
                raw.customer,
                raw.name,
                raw.fullName,
                raw.full_name,
                raw.facebookName,
                raw.facebook_name
            ) || "Customer",
        phone:
            asLiveText(raw.phone, raw.contactNumber, raw.contact_number) ||
            undefined,
        venue:
            asLiveText(
                raw.venue,
                raw.location,
                raw.eventVenue,
                raw.event_venue
            ) || undefined,
        packageName:
            asLiveText(
                raw.package,
                raw.packageName,
                raw.package_name,
                raw.packageTitle,
                raw.package_title,
                raw.serviceName,
                raw.service_name,
                raw.customOrder,
                raw.custom_order
            ) || "Custom booking",
        status,
        statusLabel:
            statusLabel ||
            `${status.charAt(0).toUpperCase()}${status.slice(1)}`,
        amount: getBookingReportAmount(raw),
        amountPaid:
            asLiveNumber(
                raw.amount_paid ??
                raw.amountPaid ??
                raw.paid_amount ??
                raw.paidAmount
            ) || undefined,
        requiredDownPayment:
            asLiveNumber(
                raw.required_down_payment ??
                raw.requiredDownPayment ??
                raw.down_payment_amount ??
                raw.downPaymentAmount
            ) || undefined,
        balance:
            asLiveNumber(
                raw.balance ?? raw.remainingBalance ?? raw.remaining_balance
            ) || undefined,
        paymentStatus:
            asLiveText(
                raw.payment_status,
                raw.paymentStatus,
                raw.payment
            ) || undefined,
        notes: asLiveText(raw.notes, raw.note) || undefined,
    };
}

function getSaleItemsLabel(sale: SaleRecord) {
    const directItems = String(sale.itemsText ?? "").trim();

    if (directItems) {
        return directItems;
    }

    return sale.quantity > 0
        ? `${sale.product} × ${formatNumber(sale.quantity)}`
        : sale.product || "No items recorded";
}


function sumBy<T>(items: T[], callback: (item: T) => number) {
    return items.reduce((total, item) => total + callback(item), 0);
}

function statusClass(status: string) {
    const value = status.toLowerCase();

    if (value.includes("out") || value === "cancelled") {
        return "bg-[#FCE9E7] text-[#B54235]";
    }

    if (
        value.includes("low") ||
        value === "pending" ||
        value === "preparing"
    ) {
        return "bg-[#FFF5D9] text-[#9A650B]";
    }

    if (value === "confirmed") {
        return "bg-[#F0EAFE] text-[#66429A]";
    }

    return "bg-[#E8F6EC] text-[#176C27]";
}

function riskClass(risk: ForecastRecord["riskLevel"]) {
    if (risk === "High") return "bg-[#FCE9E7] text-[#B54235]";
    if (risk === "Medium") return "bg-[#FFF5D9] text-[#9A650B]";
    return "bg-[#E8F6EC] text-[#176C27]";
}

function escapeHtml(value: string) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function normalizePdfText(value: string) {
    return String(value)
        .replace(/₱/g, "PHP ")
        .replace(/[–—]/g, "-")
        .replace(/•/g, "-")
        .replace(/↳/g, "-")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[^\x20-\x7E]/g, "");
}

function escapePdf(value: string) {
    return normalizePdfText(value)
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
}

function downloadFile(filename: string, mimeType: string, content: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function getPdfColumnWeight(header: string) {
    const key = header.toLowerCase();

    if (
        key.includes("product") ||
        key.includes("package") ||
        key.includes("customer") ||
        key.includes("details")
    ) {
        return 1.7;
    }

    if (
        key.includes("reference") ||
        key.includes("branch") ||
        key.includes("category") ||
        key.includes("suggested")
    ) {
        return 1.35;
    }

    if (key.includes("date") || key.includes("schedule")) return 1.15;
    if (key.includes("current") || key.includes("forecast")) return 1.1;
    if (key.includes("status") || key.includes("risk")) return 0.95;

    return 1;
}

function isPdfNumericColumn(header: string) {
    const key = header.toLowerCase();

    return [
        "stock",
        "level",
        "quantity",
        "sales",
        "revenue",
        "price",
        "value",
        "count",
        "added",
        "amount",
        "bookings",
    ].some((word) => key.includes(word));
}

function wrapPdfText(value: string, maxCharacters: number, maxLines = 3) {
    const text = normalizePdfText(value) || "-";
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (let word of words) {
        while (word.length > maxCharacters) {
            if (currentLine) {
                lines.push(currentLine);
                currentLine = "";
            }

            lines.push(word.slice(0, maxCharacters));
            word = word.slice(maxCharacters);

            if (lines.length >= maxLines) break;
        }

        if (lines.length >= maxLines) break;

        const candidate = currentLine ? `${currentLine} ${word}` : word;

        if (candidate.length <= maxCharacters) {
            currentLine = candidate;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }

        if (lines.length >= maxLines) break;
    }

    if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
    }

    const result = lines.length ? lines.slice(0, maxLines) : ["-"];

    if (
        lines.length > maxLines ||
        result.join(" ").length < text.length
    ) {
        const finalIndex = result.length - 1;
        result[finalIndex] =
            result[finalIndex].slice(0, Math.max(1, maxCharacters - 3)) + "...";
    }

    return result;
}

function createTablePdf({
                            title,
                            storeName,
                            branch,
                            dateRange,
                            headers,
                            rows,
                        }: {
    title: string;
    storeName: string;
    branch: string;
    dateRange: string;
    headers: string[];
    rows: string[][];
}) {
    const pageWidth = 842;
    const pageHeight = 595;
    const marginX = 28;
    const marginBottom = 28;
    const contentWidth = pageWidth - marginX * 2;
    const regularFont = "F1";
    const boldFont = "F2";
    const fontSize = headers.length >= 8 ? 5.8 : headers.length >= 6 ? 6.5 : 7.2;
    const headerFontSize = Math.max(5.6, fontSize - 0.2);
    const lineHeight = fontSize + 2.2;
    const cellPaddingX = 4.5;
    const cellPaddingY = 4.5;

    const weights = headers.map(getPdfColumnWeight);
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);

    let runningX = marginX;
    const columns = headers.map((header, index) => {
        const width = (contentWidth * weights[index]) / totalWeight;
        const column = {
            header,
            x: runningX,
            width,
            numeric: isPdfNumericColumn(header),
        };

        runningX += width;
        return column;
    });

    const characterLimits = columns.map((column) =>
        Math.max(6, Math.floor((column.width - cellPaddingX * 2) / (fontSize * 0.52)))
    );

    const headerLines = headers.map((header, index) =>
        wrapPdfText(header, characterLimits[index], 2)
    );
    const headerLineCount = Math.max(...headerLines.map((lines) => lines.length));
    const headerHeight = Math.max(
        20,
        headerLineCount * (headerFontSize + 1.8) + cellPaddingY * 2
    );

    const pages: string[] = [];
    let commands: string[] = [];
    let cursorY = 0;

    const point = (value: number) => Number(value.toFixed(2));

    function addText(
        value: string,
        x: number,
        y: number,
        size: number,
        font: string,
        color: [number, number, number]
    ) {
        commands.push(
            `q ${color.join(" ")} rg BT /${font} ${point(size)} Tf 1 0 0 1 ${point(
                x
            )} ${point(y)} Tm (${escapePdf(value)}) Tj ET Q`
        );
    }

    function fillRect(
        x: number,
        y: number,
        width: number,
        height: number,
        color: [number, number, number]
    ) {
        commands.push(
            `q ${color.join(" ")} rg ${point(x)} ${point(y)} ${point(width)} ${point(
                height
            )} re f Q`
        );
    }

    function strokeRect(
        x: number,
        y: number,
        width: number,
        height: number,
        color: [number, number, number]
    ) {
        commands.push(
            `q ${color.join(" ")} RG 0.45 w ${point(x)} ${point(y)} ${point(
                width
            )} ${point(height)} re S Q`
        );
    }

    function drawTableHeader() {
        const bottomY = cursorY - headerHeight;

        fillRect(marginX, bottomY, contentWidth, headerHeight, [0.17, 0.09, 0.3]);
        strokeRect(marginX, bottomY, contentWidth, headerHeight, [0.77, 0.69, 0.84]);

        columns.forEach((column, index) => {
            if (index > 0) {
                commands.push(
                    `q 0.92 0.87 0.96 RG 0.35 w ${point(column.x)} ${point(
                        bottomY
                    )} m ${point(column.x)} ${point(cursorY)} l S Q`
                );
            }

            const lines = headerLines[index];
            lines.forEach((line, lineIndex) => {
                const textWidth = line.length * headerFontSize * 0.52;
                const textX = column.numeric
                    ? column.x + column.width - cellPaddingX - textWidth
                    : column.x + cellPaddingX;

                addText(
                    line,
                    textX,
                    cursorY - cellPaddingY - headerFontSize - lineIndex * (headerFontSize + 1.8),
                    headerFontSize,
                    boldFont,
                    [1, 1, 1]
                );
            });
        });

        cursorY = bottomY;
    }

    function drawPageTitle(continued: boolean) {
        addText(
            `StockNBook - ${title}${continued ? " (continued)" : ""}`,
            marginX,
            pageHeight - 32,
            14,
            boldFont,
            [0.1, 0.07, 0.13]
        );

        let metadataY = pageHeight - 49;

        addText(
            `Store: ${storeName}`,
            marginX,
            metadataY,
            8.5,
            regularFont,
            [0.21, 0.15, 0.27]
        );

        if (branch) {
            metadataY -= 13;
            addText(
                `Branch: ${branch}`,
                marginX,
                metadataY,
                8.5,
                regularFont,
                [0.21, 0.15, 0.27]
            );
        }

        metadataY -= 13;
        addText(
            `Date range: ${dateRange}`,
            marginX,
            metadataY,
            8.5,
            regularFont,
            [0.21, 0.15, 0.27]
        );

        const dividerY = metadataY - 8;
        commands.push(
            `q 0.84 0.79 0.9 RG 0.6 w ${marginX} ${dividerY} m ${
                pageWidth - marginX
            } ${dividerY} l S Q`
        );

        cursorY = dividerY - 1;
        drawTableHeader();
    }

    function finishPage() {
        if (commands.length > 0) {
            pages.push(commands.join("\n"));
            commands = [];
        }
    }

    function startPage(continued: boolean) {
        if (commands.length > 0) finishPage();
        drawPageTitle(continued);
    }

    function drawTableRow(row: string[], rowIndex: number) {
        const cellLines = columns.map((_, index) =>
            wrapPdfText(row[index] ?? "-", characterLimits[index], 3)
        );
        const maxLines = Math.max(...cellLines.map((lines) => lines.length));
        const rowHeight = Math.max(20, maxLines * lineHeight + cellPaddingY * 2);

        if (cursorY - rowHeight < marginBottom + 10) {
            startPage(true);
        }

        const rowBottom = cursorY - rowHeight;
        const rowColor: [number, number, number] =
            rowIndex % 2 === 0 ? [1, 1, 1] : [0.985, 0.977, 0.99];

        fillRect(marginX, rowBottom, contentWidth, rowHeight, rowColor);
        strokeRect(marginX, rowBottom, contentWidth, rowHeight, [0.86, 0.81, 0.9]);

        columns.forEach((column, index) => {
            if (index > 0) {
                commands.push(
                    `q 0.9 0.85 0.94 RG 0.3 w ${point(column.x)} ${point(
                        rowBottom
                    )} m ${point(column.x)} ${point(cursorY)} l S Q`
                );
            }

            cellLines[index].forEach((line, lineIndex) => {
                const textWidth = line.length * fontSize * 0.52;
                const textX = column.numeric
                    ? column.x + column.width - cellPaddingX - textWidth
                    : column.x + cellPaddingX;

                addText(
                    line,
                    textX,
                    cursorY - cellPaddingY - fontSize - lineIndex * lineHeight,
                    fontSize,
                    regularFont,
                    [0.1, 0.07, 0.13]
                );
            });
        });

        cursorY = rowBottom;
    }

    startPage(false);

    if (rows.length === 0) {
        addText(
            "No records found for the selected report period.",
            marginX + 8,
            cursorY - 24,
            9,
            regularFont,
            [0.4, 0.35, 0.46]
        );
    } else {
        rows.forEach((row, index) => drawTableRow(row, index));
    }

    finishPage();

    const pageStreams = pages.map(
        (stream, index) =>
            `${stream}\nq 0.42 0.35 0.48 rg BT /F1 7 Tf 1 0 0 1 ${pageWidth - 100} 16 Tm (Page ${
                index + 1
            } of ${pages.length}) Tj ET Q`
    );

    const pageObjectIds = pageStreams.map((_, index) => 5 + index * 2);
    const contentObjectIds = pageStreams.map((_, index) => 6 + index * 2);

    const objects: Record<number, string> = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: `<< /Type /Pages /Kids [${pageObjectIds
            .map((id) => `${id} 0 R`)
            .join(" ")}] /Count ${pageObjectIds.length} >>`,
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    };

    pageStreams.forEach((stream, index) => {
        const pageId = pageObjectIds[index];
        const contentId = contentObjectIds[index];

        objects[pageId] =
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
            `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;

        objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    const maxObjectId = Math.max(...Object.keys(objects).map(Number));
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];

    for (let id = 1; id <= maxObjectId; id += 1) {
        offsets[id] = pdf.length;
        pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${maxObjectId + 1}\n`;
    pdf += "0000000000 65535 f \n";

    for (let id = 1; id <= maxObjectId; id += 1) {
        pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF`;

    return pdf;
}

function getInventoryVariants(item: InventoryItem) {
    return Array.isArray(item.variants) ? item.variants : [];
}

function getVariantStatus(variant: InventoryVariant): InventoryStatus {
    if (variant.status) return variant.status;

    const reorderLevel = variant.reorderLevel ?? 0;

    if (variant.stock <= 0) return "Out of Stock";
    if (reorderLevel > 0 && variant.stock <= reorderLevel) return "Low Stock";

    return "In Stock";
}

type InventoryPriceRange = {
    min: number;
    max: number;
};

function getInventoryPriceRange(
    item: InventoryItem,
    priceKey: "costPrice" | "salesPrice"
): InventoryPriceRange | null {
    const variantPrices = getInventoryVariants(item)
        .map((variant) => variant[priceKey])
        .filter(
            (price): price is number =>
                typeof price === "number" && Number.isFinite(price) && price > 0
        );

    if (variantPrices.length > 0) {
        return {
            min: Math.min(...variantPrices),
            max: Math.max(...variantPrices),
        };
    }

    const directPrice = item[priceKey];

    if (
        typeof directPrice === "number" &&
        Number.isFinite(directPrice) &&
        directPrice > 0
    ) {
        return { min: directPrice, max: directPrice };
    }

    return null;
}

function getPriceRange(
    item: InventoryItem,
    priceKey: "costPrice" | "salesPrice"
) {
    const range = getInventoryPriceRange(item, priceKey);

    if (!range) return "—";

    return range.min === range.max
        ? formatPeso(range.min)
        : `${formatPeso(range.min)} - ${formatPeso(range.max)}`;
}

function InventoryPriceValue({
                                 item,
                                 priceKey,
                             }: {
    item: InventoryItem;
    priceKey: "costPrice" | "salesPrice";
}) {
    const range = getInventoryPriceRange(item, priceKey);

    if (!range) {
        return (
            <span className="flex w-full items-center justify-center text-center tabular-nums">
                —
            </span>
        );
    }

    if (range.min === range.max) {
        return (
            <span className="flex w-full items-center justify-center whitespace-nowrap text-center tabular-nums">
                {formatPeso(range.min)}
            </span>
        );
    }

    return (
        <span className="flex w-full flex-col items-center justify-center text-center tabular-nums leading-[1.15]">
            <span className="whitespace-nowrap">{formatPeso(range.min)}</span>
            <span className="w-full text-center" aria-hidden="true">
                -
            </span>
            <span className="whitespace-nowrap">{formatPeso(range.max)}</span>
        </span>
    );
}

function getBookingStatusLabel(booking: BookingRecord) {
    return (
        booking.statusLabel ||
        `${booking.status.charAt(0).toUpperCase()}${booking.status.slice(1)}`
    );
}

function getBookingPaymentDetails(booking: BookingRecord) {
    const packagePrice = Number(booking.amount || 0);
    const requiredDownPayment =
        Number(booking.requiredDownPayment ?? Math.round(packagePrice * 0.1)) || 0;

    const defaultAmountPaid =
        booking.status === "completed"
            ? packagePrice
            : booking.status === "confirmed" || booking.status === "preparing"
                ? requiredDownPayment
                : 0;

    const amountPaid = Math.min(
        Math.max(Number(booking.amountPaid ?? defaultAmountPaid) || 0, 0),
        packagePrice
    );

    const balance = Math.max(
        Number(booking.balance ?? packagePrice - amountPaid) || 0,
        0
    );

    const paymentStatus =
        booking.paymentStatus ||
        (amountPaid >= packagePrice && packagePrice > 0
            ? "Fully Paid"
            : amountPaid >= requiredDownPayment && amountPaid > 0
                ? "Down Payment Paid"
                : amountPaid > 0
                    ? "Partial Payment"
                    : "Payment Pending");

    return {
        packagePrice,
        requiredDownPayment,
        amountPaid,
        balance,
        paymentStatus,
    };
}

function getBookingNextStep(status: BookingStatus) {
    if (status === "pending") return "Confirm Booking";
    if (status === "confirmed") return "Prepare Booking";
    if (status === "preparing") return "Complete Booking";
    if (status === "completed") return "Completed";
    return "Cancelled";
}

function getBookingStatusMessage(status: BookingStatus) {
    if (status === "completed") {
        return "This booking is already completed.";
    }

    if (status === "cancelled") {
        return "This booking has been cancelled.";
    }

    if (status === "preparing") {
        return "Prepare the package and event supplies before the event date.";
    }

    if (status === "confirmed") {
        return "The booking is confirmed and ready for preparation.";
    }

    return "Confirm the booking after verifying the required payment.";
}

function BookingDetailPanel({ booking }: { booking: BookingRecord }) {
    const payment = getBookingPaymentDetails(booking);
    const nextStep = getBookingNextStep(booking.status);

    return (
        <div className="border-t border-[#E6DDF0] bg-[#F9F4FF] p-3">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3">
                        <h4 className="text-[16px] font-bold text-[#1A1220]">
                            Payment Summary
                        </h4>

                        <div className="mt-4 space-y-3 text-sm">
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-[#7A6984]">Package Price</span>
                                <span className="font-semibold text-[#1A1220]">
                  {formatPeso(payment.packagePrice)}
                </span>
                            </div>

                            <div className="flex items-center justify-between gap-4">
                                <span className="text-[#7A6984]">Required Down Payment</span>
                                <span className="font-semibold text-[#1A1220]">
                  {formatPeso(payment.requiredDownPayment)}
                </span>
                            </div>

                            <div className="flex items-center justify-between gap-4">
                                <span className="text-[#7A6984]">Amount Paid</span>
                                <span className="font-semibold text-[#1A1220]">
                  {formatPeso(payment.amountPaid)}
                </span>
                            </div>

                            <div className="border-t border-[#EFE7F4] pt-3">
                                <div className="flex items-center justify-between gap-4">
                                    <span className="font-medium text-[#5E4A68]">Balance</span>
                                    <span className="text-[19px] font-bold text-[#2B174C]">
                    {formatPeso(payment.balance)}
                  </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3">
                        <h4 className="text-[16px] font-bold text-[#1A1220]">
                            Booking Notes
                        </h4>
                        <p className="mt-3 text-sm text-[#7A6984]">
                            {booking.notes || "No notes provided."}
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3">
                        <h4 className="text-[16px] font-bold text-[#1A1220]">
                            Payment Action
                        </h4>

                        <button
                            type="button"
                            onClick={() => {
                                window.location.href = "/bookings";
                            }}
                            className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            Manage Payment in Bookings
                        </button>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm text-[#7A6984]">Current Payment</span>
                            <StatusBadge status={payment.paymentStatus} />
                        </div>

                        <div className="mt-3 rounded-lg bg-[#F1EAF8] px-3 py-2.5 text-sm text-[#4E2C66]">
                            Paid {formatPeso(payment.amountPaid)} of{" "}
                            {formatPeso(payment.packagePrice)}
                        </div>
                    </div>

                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3">
                        <h4 className="text-[16px] font-bold text-[#1A1220]">
                            Booking Status
                        </h4>

                        <div className="mt-4 flex items-center justify-between gap-3">
                            <span className="text-sm text-[#7A6984]">Current Status</span>
                            <StatusBadge status={getBookingStatusLabel(booking)} />
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm text-[#7A6984]">Next Step</span>
                            <span className="text-sm font-semibold text-[#1A1220]">
                {nextStep}
              </span>
                        </div>

                        <div className="mt-3 rounded-lg bg-[#E9DFF0] px-3 py-2.5 text-center text-sm font-semibold text-[#6F5A7D]">
                            {nextStep}
                        </div>

                        <p className="mt-3 text-center text-xs text-[#95819C]">
                            {getBookingStatusMessage(booking.status)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    return (
        <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClass(
                status
            )}`}
        >
      {status}
    </span>
    );
}

function ActivityModuleBadge({ module }: { module: SystemModule }) {
    const className =
        module === "Bookings"
            ? "bg-[#F0EAFE] text-[#66429A]"
            : module === "Inventory"
                ? "bg-[#FFF5D9] text-[#9A650B]"
                : module === "Packages"
                    ? "bg-[#E8F4FF] text-[#25638A]"
                    : "bg-[#E8F6EC] text-[#176C27]";

    return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${className}`}>
      {module}
    </span>
    );
}

function StatCard({
                      label,
                      value,
                      helper,
                  }: {
    label: string;
    value: string;
    helper: string;
}) {
    return (
        <article className="rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold text-[#806A8C]">
                {label}
            </p>
            <p className="mt-1 text-[19px] font-bold text-[#1A1220]">
                {value}
            </p>
            <p className="mt-1 text-xs text-[#7A6A84]">{helper}</p>
        </article>
    );
}

function StaffModuleFilterCard({
                                   label,
                                   value,
                                   active,
                                   onClick,
                               }: {
    label: string;
    value: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`group h-[82px] cursor-pointer rounded-[14px] border p-3 text-left shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#2B174C]/30 ${
                active
                    ? "border-[#2B174C] bg-[#2B174C] text-white shadow-[0_8px_18px_rgba(43,23,76,0.18)] hover:bg-[#1B0D31] hover:shadow-[0_12px_24px_rgba(43,23,76,0.26)]"
                    : "border-[#E6DDF0] bg-white text-[#1A1220] hover:border-[#BFA3D5] hover:bg-[#FCF9FF] hover:shadow-[0_10px_22px_rgba(43,23,76,0.12)]"
            }`}
        >
            <p
                className={`truncate text-[11px] font-medium tracking-[0.08em] transition-colors ${
                    active
                        ? "text-[#EBDCFF]"
                        : "text-[#9B8AAA] group-hover:text-[#6F4D83]"
                }`}
            >
                {label}
            </p>

            <p className="mt-2 text-[19px] font-bold leading-none">
                {value}
            </p>
        </button>
    );
}

function BookingFilterCard({
                               label,
                               value,
                               active,
                               onClick,
                           }: {
    label: string;
    value: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`group h-[82px] cursor-pointer rounded-[14px] border p-3 text-left shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#2B174C]/30 ${
                active
                    ? "border-[#2B174C] bg-[#2B174C] text-white shadow-[0_8px_18px_rgba(43,23,76,0.18)] hover:bg-[#1B0D31] hover:shadow-[0_12px_24px_rgba(43,23,76,0.26)]"
                    : "border-[#E6DDF0] bg-white text-[#1A1220] hover:border-[#BFA3D5] hover:bg-[#FCF9FF] hover:shadow-[0_10px_22px_rgba(43,23,76,0.12)]"
            }`}
        >
            <p
                className={`truncate text-[11px] font-medium tracking-[0.08em] transition-colors ${
                    active
                        ? "text-[#EBDCFF]"
                        : "text-[#9B8AAA] group-hover:text-[#6F4D83]"
                }`}
            >
                {label}
            </p>

            <p className="mt-2 text-[19px] font-bold leading-none">
                {value}
            </p>
        </button>
    );
}

function SectionCard({
                         title,
                         subtitle,
                         children,
                     }: {
    title: string;
    subtitle: string;
    children: ReactNode;
}) {
    return (
        <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="border-b border-[#E6DDF0] bg-white px-3 py-3">
                <h3 className="text-[16px] font-bold text-[#1A1220]">
                    {title}
                </h3>
                <p className="mt-0.5 text-xs text-[#8A7A91]">{subtitle}</p>
            </div>
            <div className="p-3">{children}</div>
        </section>
    );
}

function InventoryExportMenu({
                                 onExportPdf,
                                 onExportXlsx,
                                 onExportDoc,
                             }: {
    onExportPdf: () => void;
    onExportXlsx: () => void;
    onExportDoc: () => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    const runExport = (callback: () => void) => {
        callback();
        setIsOpen(false);
    };

    return (
        <div
            className="relative mt-4"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsOpen(false);
                }
            }}
        >
            <button
                type="button"
                onClick={() => setIsOpen((current) => !current)}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#7C4DFF] bg-white text-[12px] font-bold text-[#6334D4] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#F4EDFF] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#7C4DFF]/20"
            >
                <FileSpreadsheet size={14} />
                Export Filtered Inventory
                <ChevronDown
                    size={14}
                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            {isOpen ? (
                <div
                    role="menu"
                    className="absolute bottom-[46px] left-0 right-0 z-30 overflow-hidden rounded-xl border border-[#E2D7EA] bg-white p-1.5 shadow-[0_14px_35px_rgba(43,23,76,0.18)]"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => runExport(onExportPdf)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-[#3C2947] transition hover:bg-[#F6F0FC] hover:text-[#6334D4]"
                    >
                        <FileText size={14} />
                        Export as PDF
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => runExport(onExportXlsx)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-[#3C2947] transition hover:bg-[#F6F0FC] hover:text-[#6334D4]"
                    >
                        <FileSpreadsheet size={14} />
                        Export as XLSX
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => runExport(onExportDoc)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-[#3C2947] transition hover:bg-[#F6F0FC] hover:text-[#6334D4]"
                    >
                        <FileText size={14} />
                        Export as DOC
                    </button>
                </div>
            ) : null}
        </div>
    );
}



type SearchableSelectOption<T extends string> = {
    value: T;
    label: string;
};

type SearchableFilterSelectProps<T extends string> = {
    value: T;
    options: ReadonlyArray<SearchableSelectOption<T>>;
    onChange: (value: T) => void;
    icon: ComponentType<{
        size?: number;
        className?: string;
        strokeWidth?: number;
    }>;
    ariaLabel: string;
    className?: string;
};

function SearchableFilterSelect<T extends string>({
                                                      value,
                                                      options,
                                                      onChange,
                                                      icon: Icon,
                                                      ariaLabel,
                                                      className = "",
                                                  }: SearchableFilterSelectProps<T>) {
    const selectedLabel =
        options.find((option) => option.value === value)?.label || "";
    const [query, setQuery] = useState(selectedLabel);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setQuery(selectedLabel);
        }
    }, [isOpen, selectedLabel]);

    const filteredOptions = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();

        if (!normalizedQuery || normalizedQuery === selectedLabel.toLowerCase()) {
            return options;
        }

        return options.filter((option) =>
            option.label.toLowerCase().includes(normalizedQuery)
        );
    }, [options, query, selectedLabel]);

    const selectOption = (option: SearchableSelectOption<T>) => {
        onChange(option.value);
        setQuery(option.label);
        setIsOpen(false);
    };

    return (
        <div
            className={`relative ${className}`}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsOpen(false);
                    setQuery(selectedLabel);
                }
            }}
        >
            <Icon
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#87748F]"
            />

            <input
                type="text"
                role="combobox"
                aria-label={ariaLabel}
                aria-expanded={isOpen}
                aria-autocomplete="list"
                value={query}
                onFocus={(event) => {
                    setIsOpen(true);
                    event.currentTarget.select();
                }}
                onClick={() => setIsOpen(true)}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setIsOpen(true);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && filteredOptions.length > 0) {
                        event.preventDefault();
                        selectOption(filteredOptions[0]);
                    }

                    if (event.key === "Escape") {
                        setIsOpen(false);
                        setQuery(selectedLabel);
                    }
                }}
                className="h-11 w-full rounded-xl border border-[#E3D9E9] bg-white pl-9 pr-8 text-[12px] font-semibold text-[#2D2035] shadow-sm outline-none transition focus:border-[#8D63C8] focus:ring-2 focus:ring-[#8D63C8]/10"
            />

            <button
                type="button"
                tabIndex={-1}
                aria-label={`Open ${ariaLabel}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setIsOpen((current) => !current)}
                className="absolute right-0 top-0 flex h-11 w-9 items-center justify-center text-[#6F5C7C]"
            >
                <ChevronDown
                    size={14}
                    className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            {isOpen ? (
                <div
                    role="listbox"
                    className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-56 overflow-y-auto rounded-xl border border-[#E3D9E9] bg-white p-1.5 shadow-[0_14px_35px_rgba(43,23,76,0.18)]"
                >
                    {filteredOptions.length > 0 ? (
                        filteredOptions.map((option) => {
                            const isSelected = option.value === value;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => selectOption(option)}
                                    className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[12px] font-semibold transition ${
                                        isSelected
                                            ? "bg-[#F1E9FF] text-[#6334D4]"
                                            : "text-[#3C2947] hover:bg-[#F8F3FF] hover:text-[#6334D4]"
                                    }`}
                                >
                                    {option.label}
                                </button>
                            );
                        })
                    ) : (
                        <p className="px-3 py-2 text-[11px] text-[#8A7A91]">
                            No matching option found.
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    );
}

type ReportFilterBarProps = {
    selectedReport: ReportKey | null;
    searchQuery: string;
    onSearchChange: (value: string) => void;
    startDate: string;
    endDate: string;
    onStartDateChange: (value: string) => void;
    onEndDateChange: (value: string) => void;
    categoryFilter: string;
    inventoryCategories: string[];
    onCategoryChange: (value: string) => void;
    bookingStatusFilter: BookingFilter;
    onBookingStatusChange: (value: BookingFilter) => void;
    packageStatusFilter: PackageStatusFilter;
    onPackageStatusChange: (value: PackageStatusFilter) => void;
    staffModuleFilter: StaffModuleFilter;
    onStaffModuleChange: (value: StaffModuleFilter) => void;
    showBranchFilter: boolean;
    branch: string;
    branchOptions: string[];
    onBranchChange: (value: string) => void;
    onClear: () => void;
};

function ReportFilterBar({
                             selectedReport,
                             searchQuery,
                             onSearchChange,
                             startDate,
                             endDate,
                             onStartDateChange,
                             onEndDateChange,
                             categoryFilter,
                             inventoryCategories,
                             onCategoryChange,
                             bookingStatusFilter,
                             onBookingStatusChange,
                             packageStatusFilter,
                             onPackageStatusChange,
                             staffModuleFilter,
                             onStaffModuleChange,
                             showBranchFilter,
                             branch,
                             branchOptions,
                             onBranchChange,
                             onClear,
                         }: ReportFilterBarProps) {
    const isInventory = selectedReport === "inventory";
    const isBooking = selectedReport === "bookings";
    const isPackages = selectedReport === "packages";
    const isStaff = selectedReport === "staff";
    const hasOptionFilter = isInventory || isBooking || isPackages || isStaff;
    const searchSpan = hasOptionFilter
        ? showBranchFilter
            ? "xl:col-span-3"
            : "xl:col-span-5"
        : showBranchFilter
            ? "xl:col-span-5"
            : "xl:col-span-7";
    const optionSpan = "xl:col-span-2";
    const bookingStatusOptions: Array<SearchableSelectOption<BookingFilter>> = [
        { value: "all", label: "All Status" },
        { value: "pending", label: "Pending" },
        { value: "confirmed", label: "Confirmed" },
        { value: "preparing", label: "Preparing" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
    ];
    const packageStatusOptions: Array<SearchableSelectOption<PackageStatusFilter>> = [
        { value: "all", label: "All Status" },
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
    ];
    const staffModuleOptions: Array<SearchableSelectOption<StaffModuleFilter>> = [
        { value: "all", label: "All Modules" },
        { value: "Bookings", label: "Bookings" },
        { value: "Inventory", label: "Inventory" },
        { value: "Packages", label: "Packages" },
        { value: "Sales / POS", label: "Sales / POS" },
    ];
    const searchableBranchOptions: Array<SearchableSelectOption<string>> =
        branchOptions.map((option) => ({ value: option, label: option }));

    const placeholder =
        selectedReport === "inventory"
            ? "Search products or variants..."
            : selectedReport === "restock"
                ? "Search restock records..."
                : selectedReport === "sales"
                    ? "Search POS order..."
                    : selectedReport === "bookings"
                        ? "Search booking or customer..."
                        : selectedReport === "staff"
                            ? "Search employee action..."
                            : "Search packages...";

    return (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12">
            <label className={`relative sm:col-span-2 ${searchSpan}`}>
                <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#887496]"
                />
                <input
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={placeholder}
                    className="h-11 w-full rounded-xl border border-[#E3D9E9] bg-white pl-9 pr-3 text-[12px] text-[#1A1220] shadow-sm outline-none transition focus:border-[#8D63C8] focus:ring-2 focus:ring-[#8D63C8]/10"
                />
            </label>

            <label className="relative xl:col-span-2">
                <CalendarDays
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#87748F]"
                />
                <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-[9px] font-bold tracking-[0.08em] text-[#8B7695]">
                    FROM
                </span>
                <input
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(event) => onStartDateChange(event.target.value)}
                    aria-label="Report start date"
                    className="h-11 w-full rounded-xl border border-[#E3D9E9] bg-white pb-0 pl-[72px] pr-2 text-[11px] font-semibold text-[#2D2035] shadow-sm outline-none transition focus:border-[#8D63C8]"
                />
            </label>

            <label className="relative xl:col-span-2">
                <CalendarDays
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#87748F]"
                />
                <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-[9px] font-bold tracking-[0.08em] text-[#8B7695]">
                    TO
                </span>
                <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(event) => onEndDateChange(event.target.value)}
                    aria-label="Report end date"
                    className="h-11 w-full rounded-xl border border-[#E3D9E9] bg-white pb-0 pl-[58px] pr-2 text-[11px] font-semibold text-[#2D2035] shadow-sm outline-none transition focus:border-[#8D63C8]"
                />
            </label>

            {isInventory ? (
                <label className={`relative ${optionSpan}`}>
                    <Package
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#87748F]"
                    />
                    <select
                        value={categoryFilter}
                        onChange={(event) => onCategoryChange(event.target.value)}
                        className="h-11 w-full appearance-none rounded-xl border border-[#E3D9E9] bg-white pl-9 pr-8 text-[12px] font-semibold text-[#2D2035] shadow-sm outline-none transition focus:border-[#8D63C8]"
                    >
                        <option value="all">All Categories</option>
                        {inventoryCategories.map((category) => (
                            <option key={category} value={category}>
                                {category}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6F5C7C]"
                    />
                </label>
            ) : null}

            {isBooking ? (
                <SearchableFilterSelect
                    className={optionSpan}
                    value={bookingStatusFilter}
                    options={bookingStatusOptions}
                    onChange={onBookingStatusChange}
                    icon={CalendarDays}
                    ariaLabel="Booking status filter"
                />
            ) : null}

            {isPackages ? (
                <SearchableFilterSelect
                    className={optionSpan}
                    value={packageStatusFilter}
                    options={packageStatusOptions}
                    onChange={onPackageStatusChange}
                    icon={Package}
                    ariaLabel="Package status filter"
                />
            ) : null}

            {isStaff ? (
                <SearchableFilterSelect
                    className={optionSpan}
                    value={staffModuleFilter}
                    options={staffModuleOptions}
                    onChange={onStaffModuleChange}
                    icon={Users}
                    ariaLabel="Employee action module filter"
                />
            ) : null}

            {showBranchFilter ? (
                <SearchableFilterSelect
                    className="xl:col-span-2"
                    value={branch}
                    options={searchableBranchOptions}
                    onChange={onBranchChange}
                    icon={Store}
                    ariaLabel="Branch filter"
                />
            ) : null}

            <button
                type="button"
                onClick={onClear}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#E3D9E9] bg-white px-3 text-[11px] font-semibold text-[#4F3B5C] shadow-sm transition-all duration-200 hover:border-[#A77CE8] hover:bg-[#F8F3FF] hover:text-[#5F2DB9] xl:col-span-1"
            >
                <RotateCcw size={14} />
                Clear
            </button>
        </div>
    );
}

type InventoryItemsTableProps = {
    items: InventoryItem[];
    showBranchColumn: boolean;
    expandedInventoryId: string | null;
    onToggleExpanded: (itemId: string) => void;
};

function InventoryItemsTable({
                                 items,
                                 showBranchColumn,
                                 expandedInventoryId,
                                 onToggleExpanded,
                             }: InventoryItemsTableProps) {
    const columnCount = showBranchColumn ? 10 : 9;

    return (
        <table className="w-full table-fixed border-collapse text-[11px]">
            <colgroup>
                <col className={showBranchColumn ? "w-[18%]" : "w-[25%]"} />
                {showBranchColumn ? <col className="w-[11%]" /> : null}
                <col className={showBranchColumn ? "w-[9%]" : "w-[13%]"} />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className={showBranchColumn ? "w-[9%]" : "w-[10%]"} />
                <col className={showBranchColumn ? "w-[9%]" : "w-[10%]"} />
                <col className={showBranchColumn ? "w-[13%]" : "w-[12%]"} />
                <col className={showBranchColumn ? "w-[11%]" : "w-[10%]"} />
            </colgroup>

            <thead>
            <tr className="border-b border-[#E8DFED] bg-[#FCFAFD]">
                <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Product
                </th>
                {showBranchColumn ? (
                    <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                        Branch
                    </th>
                ) : null}
                <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Category
                </th>
                <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Type
                </th>
                <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Stock
                </th>
                <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Alert
                </th>
                <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Cost Price
                </th>
                <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Selling Price
                </th>
                <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Expiration Date
                </th>
                <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                    Status
                </th>
            </tr>
            </thead>

            <tbody>
            {items.length > 0 ? (
                items.map((item) => {
                    const variants = getInventoryVariants(item);
                    const hasVariants = variants.length > 0;
                    const isExpanded = expandedInventoryId === item.id;
                    const expirationStatus = getExpirationStatus(item.expiryDate);
                    const stockTextClass =
                        item.status === "Out of Stock"
                            ? "text-[#E3322A]"
                            : item.status === "Low Stock"
                                ? "text-[#F07800]"
                                : "text-[#12A150]";
                    const productTextClass =
                        expirationStatus === "Expired"
                            ? "text-[#D7312A]"
                            : "text-[#20152A]";

                    return (
                        <Fragment key={item.id}>
                            <tr
                                className={`border-b border-[#EFE8F2] transition-colors ${
                                    isExpanded
                                        ? "bg-[#F8F2FC]"
                                        : "bg-white hover:bg-[#FCFAFF]"
                                }`}
                            >
                                <td className="px-3 py-3 align-top">
                                    <div className="flex min-w-0 items-start gap-2">
                                        {hasVariants ? (
                                            <button
                                                type="button"
                                                onClick={() => onToggleExpanded(item.id)}
                                                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#4E2C66] transition hover:bg-[#EEE4F7] hover:text-[#6D35D1]"
                                                aria-label={
                                                    isExpanded
                                                        ? `Hide ${item.product} variants`
                                                        : `Show ${item.product} variants`
                                                }
                                            >
                                                {isExpanded ? (
                                                    <ChevronUp size={14} />
                                                ) : (
                                                    <ChevronDown size={14} />
                                                )}
                                            </button>
                                        ) : (
                                            <span className="block h-5 w-5 shrink-0" />
                                        )}

                                        <div className="min-w-0">
                                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                <p className={`break-words font-semibold ${productTextClass}`}>
                                                    {item.product}
                                                </p>
                                                {expirationStatus === "Expired" ? (
                                                    <span className="shrink-0 rounded-full border border-[#F2B5B0] bg-[#FFF0EF] px-1.5 py-0.5 text-[8px] font-bold text-[#D7312A]">
                                                            Expired
                                                        </span>
                                                ) : null}
                                            </div>
                                            {hasVariants ? (
                                                <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">
                                                    {variants.length} variant{variants.length === 1 ? "" : "s"}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                </td>

                                {showBranchColumn ? (
                                    <td
                                        className="whitespace-normal break-words px-2 py-3 align-top leading-snug text-[#5F5267]"
                                        title={item.branch}
                                    >
                                        {item.branch}
                                    </td>
                                ) : null}

                                <td className="break-words px-2 py-3 align-top text-[#5F5267]">
                                    {item.category}
                                </td>
                                <td className="break-words px-2 py-3 align-top text-[#5F5267]">
                                    {hasVariants
                                        ? `${variants.length} variant${variants.length === 1 ? "" : "s"}`
                                        : "Regular"}
                                </td>
                                <td className={`px-2 py-3 text-center align-top font-bold ${stockTextClass}`}>
                                    {formatNumber(item.stock)}
                                </td>
                                <td className="px-2 py-3 text-center align-top font-semibold text-[#685674]">
                                    {formatNumber(item.reorderLevel)}
                                </td>
                                <td className="px-2 py-3 text-center align-top font-semibold text-[#5F5267]">
                                    <InventoryPriceValue item={item} priceKey="costPrice" />
                                </td>
                                <td className="px-2 py-3 text-center align-top font-bold text-[#251A2C]">
                                    <InventoryPriceValue item={item} priceKey="salesPrice" />
                                </td>
                                <td
                                    className={`px-2 py-3 text-center align-top text-[10px] font-semibold ${
                                        expirationStatus === "Expired"
                                            ? "text-[#D7312A]"
                                            : expirationStatus === "Soon to Expire"
                                                ? "text-[#D97706]"
                                                : "text-[#685674]"
                                    }`}
                                >
                                    {item.expiryDate ? formatDate(item.expiryDate) : "No Expiry"}
                                </td>
                                <td className="px-2 py-3 text-center align-top">
                                    <StatusBadge status={item.status} />
                                </td>
                            </tr>

                            {hasVariants && isExpanded
                                ? variants.map((variant) => {
                                    const variantExpiration = getExpirationStatus(
                                        variant.expiryDate
                                    );
                                    const variantStatus = getVariantStatus(variant);
                                    const variantStockClass =
                                        variantStatus === "Out of Stock"
                                            ? "text-[#E3322A]"
                                            : variantStatus === "Low Stock"
                                                ? "text-[#F07800]"
                                                : "text-[#12A150]";

                                    return (
                                        <tr
                                            key={variant.id}
                                            className="border-b border-[#E8DDF0] bg-[#FBF7FE] transition hover:bg-[#F6EFFB]"
                                        >
                                            <td className="px-3 py-3 align-top">
                                                <div className="flex min-w-0 items-start gap-3 pl-8">
                                                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#9B65D6]" />
                                                    <div className="min-w-0">
                                                        <p className="break-words font-semibold text-[#3C2947]">
                                                            {variant.name}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            {showBranchColumn ? (
                                                <td className="px-2 py-3 align-top text-[#9A8CA2]">—</td>
                                            ) : null}
                                            <td className="px-2 py-3 align-top text-[#9A8CA2]">—</td>
                                            <td className="px-2 py-3 align-top text-[#6A5D6F]">Variant</td>
                                            <td className={`px-2 py-3 text-center align-top font-bold ${variantStockClass}`}>
                                                {formatNumber(variant.stock)}
                                            </td>
                                            <td className="px-2 py-3 text-center align-top text-[#6A5D6F]">
                                                {formatNumber(variant.reorderLevel ?? 0)}
                                            </td>
                                            <td className="px-2 py-3 text-center align-top text-[#6A5D6F]">
                                                <span className="flex w-full items-center justify-center whitespace-nowrap text-center tabular-nums">
                                                    {typeof variant.costPrice === "number" && variant.costPrice > 0
                                                        ? formatPeso(variant.costPrice)
                                                        : "—"}
                                                </span>
                                            </td>
                                            <td className="px-2 py-3 text-center align-top font-semibold text-[#251A2C]">
                                                <span className="flex w-full items-center justify-center whitespace-nowrap text-center tabular-nums">
                                                    {typeof variant.salesPrice === "number" && variant.salesPrice > 0
                                                        ? formatPeso(variant.salesPrice)
                                                        : "—"}
                                                </span>
                                            </td>
                                            <td
                                                className={`px-2 py-3 text-center align-top text-[10px] font-semibold ${
                                                    variantExpiration === "Expired"
                                                        ? "text-[#D7312A]"
                                                        : variantExpiration === "Soon to Expire"
                                                            ? "text-[#D97706]"
                                                            : "text-[#685674]"
                                                }`}
                                            >
                                                {variant.expiryDate
                                                    ? formatDate(variant.expiryDate)
                                                    : "No Expiry"}
                                            </td>
                                            <td className="px-2 py-3 text-center align-top">
                                                <StatusBadge status={variantStatus} />
                                            </td>
                                        </tr>
                                    );
                                })
                                : null}
                        </Fragment>
                    );
                })
            ) : (
                <tr>
                    <td
                        colSpan={columnCount}
                        className="px-4 py-14 text-center text-sm text-[#8A7A91]"
                    >
                        No inventory items match the selected filters.
                    </td>
                </tr>
            )}
            </tbody>
        </table>
    );
}

type RestockReportViewProps = {
    records: RestockRecord[];
    showBranchColumn: boolean;
};

function RestockReportView({
                               records,
                               showBranchColumn,
                           }: RestockReportViewProps) {
    const totalUnitsAdded = sumBy(records, (item) => item.quantityAdded);
    const productsRestocked = new Set(
        records.map((item) => item.product.trim().toLowerCase()).filter(Boolean)
    ).size;
    const variantsRestocked = new Set(
        records
            .map((item) => item.variantName?.trim().toLowerCase() || "")
            .filter(Boolean)
    ).size;

    const latestRestock = [...records].sort((left, right) =>
        right.date.localeCompare(left.date)
    )[0];

    const restockByProduct = Array.from(
        records.reduce((summary, item) => {
            const product = item.product || "Unnamed Product";
            summary.set(
                product,
                (summary.get(product) || 0) + Number(item.quantityAdded || 0)
            );
            return summary;
        }, new Map<string, number>())
    )
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((left, right) => right.quantity - left.quantity)
        .slice(0, 6);

    const largestRestockQuantity = Math.max(
        1,
        ...restockByProduct.map((item) => item.quantity)
    );
    const columnCount = showBranchColumn ? 8 : 7;

    return (
        <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[#E5DDEA] bg-white shadow-sm">
                <div className="border-b border-[#ECE5F0] px-4 py-3.5">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                        Restock Report History
                    </h2>
                    <p className="mt-1 text-[11px] text-[#8A7A91]">
                        Review product restocks, quantities added, stock movement, and receiving details.
                    </p>
                </div>

                <table className="w-full table-fixed border-collapse text-[11px]">
                    <colgroup>
                        <col className={showBranchColumn ? "w-[13%]" : "w-[14%]"} />
                        <col className={showBranchColumn ? "w-[22%]" : "w-[27%]"} />
                        {showBranchColumn ? <col className="w-[12%]" /> : null}
                        <col className={showBranchColumn ? "w-[10%]" : "w-[11%]"} />
                        <col className={showBranchColumn ? "w-[9%]" : "w-[10%]"} />
                        <col className={showBranchColumn ? "w-[10%]" : "w-[11%]"} />
                        <col className={showBranchColumn ? "w-[10%]" : "w-[11%]"} />
                        <col className={showBranchColumn ? "w-[14%]" : "w-[16%]"} />
                    </colgroup>

                    <thead>
                    <tr className="border-b border-[#E8DFED] bg-[#FCFAFD]">
                        <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Date
                        </th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Product
                        </th>
                        {showBranchColumn ? (
                            <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                                Branch
                            </th>
                        ) : null}
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Type
                        </th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Stock Before
                        </th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Qty Added
                        </th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Current Stock
                        </th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Received By
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {records.length > 0 ? (
                        records.map((item) => {
                            const stockBefore =
                                typeof item.stockBefore === "number"
                                    ? item.stockBefore
                                    : Math.max(
                                        Number(item.currentStock || 0) -
                                        Number(item.quantityAdded || 0),
                                        0
                                    );

                            return (
                                <tr
                                    key={item.id}
                                    className="border-b border-[#EFE8F2] bg-white transition-colors hover:bg-[#FCFAFF]"
                                >
                                    <td className="px-3 py-3 align-top">
                                        <p className="font-semibold text-[#1A1220]">
                                            {formatDate(item.date)}
                                        </p>
                                        <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">
                                            {item.reference || item.id}
                                        </p>
                                    </td>

                                    <td className="px-2 py-3 align-top">
                                        <p className="break-words font-semibold text-[#20152A]">
                                            {item.product}
                                        </p>
                                        <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">
                                            {item.variantName || "Regular product"}
                                        </p>
                                    </td>

                                    {showBranchColumn ? (
                                        <td
                                            className="whitespace-normal break-words px-2 py-3 align-top leading-snug text-[#5F5267]"
                                            title={item.branch}
                                        >
                                            {item.branch}
                                        </td>
                                    ) : null}

                                    <td className="break-words px-2 py-3 align-top text-[#5F5267]">
                                        {item.variantName ? "Variant" : "Regular"}
                                    </td>
                                    <td className="px-2 py-3 text-center align-top font-semibold tabular-nums text-[#685674]">
                                        {formatNumber(stockBefore)}
                                    </td>
                                    <td className="px-2 py-3 text-center align-top font-bold tabular-nums text-[#12A150]">
                                        +{formatNumber(item.quantityAdded)}
                                    </td>
                                    <td className="px-2 py-3 text-center align-top font-bold tabular-nums text-[#1A1220]">
                                        {formatNumber(item.currentStock)}
                                    </td>
                                    <td className="break-words px-2 py-3 align-top text-[#5F5267]">
                                        {item.receivedBy || "Not recorded"}
                                    </td>
                                </tr>
                            );
                        })
                    ) : (
                        <tr>
                            <td
                                colSpan={columnCount}
                                className="px-4 py-14 text-center text-sm text-[#8A7A91]"
                            >
                                No restock records match the selected filters.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </section>

            <aside className="self-start rounded-[14px] border border-[#E5DDEA] bg-white p-3 shadow-sm">
                <h2 className="text-[16px] font-bold text-[#1A1220]">
                    Restock Summary
                </h2>

                <div className="mt-3 divide-y divide-[#EEE7F2]">
                    {[
                        {
                            label: "Restock Records",
                            value: records.length,
                            dot: "bg-[#7A45E8]",
                        },
                        {
                            label: "Units Added",
                            value: totalUnitsAdded,
                            dot: "bg-[#22B65B]",
                        },
                        {
                            label: "Products Restocked",
                            value: productsRestocked,
                            dot: "bg-[#FF8A00]",
                        },
                        {
                            label: "Variants Restocked",
                            value: variantsRestocked,
                            dot: "bg-[#2F80ED]",
                        },
                    ].map((summary) => (
                        <div
                            key={summary.label}
                            className="flex w-full items-center justify-between gap-3 px-1 py-2 text-[#392A42]"
                        >
                            <span className="flex items-center gap-2 text-[11px] font-semibold">
                                <span className={`h-2.5 w-2.5 rounded-full ${summary.dot}`} />
                                {summary.label}
                            </span>
                            <span className="text-[12px] font-bold tabular-nums">
                                {formatNumber(summary.value)}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">
                        Latest Restock
                    </h3>
                    {latestRestock ? (
                        <div className="mt-3 rounded-[12px] border border-[#EEE7F2] bg-[#FCFAFD] p-3">
                            <p className="break-words text-[11px] font-bold text-[#1A1220]">
                                {latestRestock.product}
                            </p>
                            <p className="mt-1 text-[10px] text-[#6A5D6F]">
                                {formatDate(latestRestock.date)}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-[#7A6984]">Quantity Added</span>
                                <span className="font-bold tabular-nums text-[#12A150]">
                                    +{formatNumber(latestRestock.quantityAdded)}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-3 text-[10px] text-[#8A7A91]">
                            No restock activity recorded.
                        </p>
                    )}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">
                        Most Restocked Products
                    </h3>
                    <div className="mt-3 space-y-2">
                        {restockByProduct.length > 0 ? (
                            restockByProduct.map((item) => (
                                <div
                                    key={item.name}
                                    className="grid grid-cols-[72px_1fr_auto] items-center gap-1.5 text-[9px]"
                                >
                                    <span className="truncate text-[#5F5267]" title={item.name}>
                                        {item.name}
                                    </span>
                                    <span className="h-1.5 overflow-hidden rounded-full bg-[#EFE9F4]">
                                        <span
                                            className="block h-full rounded-full bg-[#7041E5]"
                                            style={{
                                                width: `${
                                                    (item.quantity / largestRestockQuantity) * 100
                                                }%`,
                                            }}
                                        />
                                    </span>
                                    <span className="font-bold tabular-nums text-[#251A2C]">
                                        {formatNumber(item.quantity)}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <p className="text-[10px] text-[#8A7A91]">
                                No restock product data available.
                            </p>
                        )}
                    </div>
                </div>
            </aside>
        </div>
    );
}

type SummaryMetricRowProps = {
    label: string;
    value: string | number;
    dot: string;
    active?: boolean;
    onClick?: () => void;
};

function SummaryMetricRow({
                              label,
                              value,
                              dot,
                              active = false,
                              onClick,
                          }: SummaryMetricRowProps) {
    const content = (
        <>
            <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
                <span className="truncate">{label}</span>
            </span>
            <span className="shrink-0 text-[12px] font-bold tabular-nums">
                {typeof value === "number" ? formatNumber(value) : value}
            </span>
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition hover:bg-[#FAF6FF] ${
                    active ? "text-[#5C2FC0]" : "text-[#392A42]"
                }`}
            >
                {content}
            </button>
        );
    }

    return (
        <div className="flex w-full items-center justify-between gap-3 px-1 py-2 text-[#392A42]">
            {content}
        </div>
    );
}

type SummaryBarItem = {
    name: string;
    value: number;
};

function SummaryBarList({
                            items,
                            emptyText,
                        }: {
    items: SummaryBarItem[];
    emptyText: string;
}) {
    const maximum = Math.max(1, ...items.map((item) => item.value));

    if (items.length === 0) {
        return <p className="text-[10px] text-[#8A7A91]">{emptyText}</p>;
    }

    return (
        <div className="space-y-2">
            {items.map((item) => (
                <div
                    key={item.name}
                    className="grid grid-cols-[72px_1fr_auto] items-center gap-1.5 text-[9px]"
                >
                    <span className="truncate text-[#5F5267]" title={item.name}>
                        {item.name}
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-[#EFE9F4]">
                        <span
                            className="block h-full rounded-full bg-[#7041E5]"
                            style={{ width: `${(item.value / maximum) * 100}%` }}
                        />
                    </span>
                    <span className="font-bold tabular-nums text-[#251A2C]">
                        {formatNumber(item.value)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function PosReportView({
                           records,
                           showBranchColumn,
                       }: {
    records: SaleRecord[];
    showBranchColumn: boolean;
}) {
    const totalSalesValue = sumBy(records, (item) => item.amount);
    const totalItemsSold = sumBy(records, (item) => item.quantity);
    const averageTransaction = records.length
        ? totalSalesValue / records.length
        : 0;
    const latestTransaction = [...records].sort((left, right) =>
        right.date.localeCompare(left.date)
    )[0];
    const topSellingItems = Array.from(
        records.reduce((summary, item) => {
            const name = item.product || item.itemsText || "Unspecified Item";
            summary.set(name, (summary.get(name) || 0) + Number(item.quantity || 0));
            return summary;
        }, new Map<string, number>())
    )
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 6);
    const columnCount = showBranchColumn ? 5 : 4;

    return (
        <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[#E5DDEA] bg-white shadow-sm">
                <div className="border-b border-[#ECE5F0] px-4 py-3.5">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                        POS Report History
                    </h2>
                    <p className="mt-1 text-[11px] text-[#8A7A91]">
                        Review order IDs, items sold, totals, transaction dates, and branch records.
                    </p>
                </div>

                <table className="w-full table-fixed border-collapse text-[11px]">
                    <colgroup>
                        <col className={showBranchColumn ? "w-[20%]" : "w-[22%]"} />
                        {showBranchColumn ? <col className="w-[18%]" /> : null}
                        <col className={showBranchColumn ? "w-[34%]" : "w-[48%]"} />
                        <col className={showBranchColumn ? "w-[14%]" : "w-[15%]"} />
                        <col className={showBranchColumn ? "w-[14%]" : "w-[15%]"} />
                    </colgroup>
                    <thead>
                    <tr className="border-b border-[#E8DFED] bg-[#FCFAFD]">
                        <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Order ID
                        </th>
                        {showBranchColumn ? (
                            <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                                Branch
                            </th>
                        ) : null}
                        <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Items
                        </th>
                        <th className="px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Total
                        </th>
                        <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">
                            Date
                        </th>
                    </tr>
                    </thead>
                    <tbody>
                    {records.length > 0 ? (
                        records.map((item) => (
                            <tr
                                key={item.id}
                                className="border-b border-[#EFE8F2] bg-white transition-colors hover:bg-[#FCFAFF]"
                            >
                                <td className="break-words px-3 py-3 align-top font-mono text-[10px] font-semibold text-[#6039A4]">
                                    {item.reference || item.id}
                                </td>
                                {showBranchColumn ? (
                                    <td className="break-words px-3 py-3 align-top text-[#5F5267]">
                                        {item.branch || "—"}
                                    </td>
                                ) : null}
                                <td className="break-words px-3 py-3 align-top text-[#5F5267]">
                                    {getSaleItemsLabel(item)}
                                </td>
                                <td className="px-3 py-3 text-right align-top font-bold tabular-nums text-[#1A1220]">
                                    {formatPeso(item.amount)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 align-top font-semibold text-[#1A1220]">
                                    {formatDate(item.date)}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={columnCount} className="px-4 py-14 text-center text-sm text-[#8A7A91]">
                                No POS orders match the selected filters.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </section>

            <aside className="self-start rounded-[14px] border border-[#E5DDEA] bg-white p-3 shadow-sm">
                <h2 className="text-[16px] font-bold text-[#1A1220]">POS Summary</h2>
                <div className="mt-3 divide-y divide-[#EEE7F2]">
                    <SummaryMetricRow label="Total Transactions" value={records.length} dot="bg-[#7A45E8]" />
                    <SummaryMetricRow label="Total POS Sales" value={formatPeso(totalSalesValue)} dot="bg-[#22B65B]" />
                    <SummaryMetricRow label="Average Transaction" value={formatPeso(averageTransaction)} dot="bg-[#FF8A00]" />
                    <SummaryMetricRow label="Items Sold" value={totalItemsSold} dot="bg-[#2F80ED]" />
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Latest Transaction</h3>
                    {latestTransaction ? (
                        <div className="mt-3 rounded-[12px] border border-[#EEE7F2] bg-[#FCFAFD] p-3">
                            <p className="break-words text-[11px] font-bold text-[#1A1220]">
                                {latestTransaction.reference || latestTransaction.id}
                            </p>
                            <p className="mt-1 text-[10px] text-[#6A5D6F]">
                                {formatDate(latestTransaction.date)}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-[#7A6984]">Amount</span>
                                <span className="font-bold tabular-nums text-[#12A150]">
                                    {formatPeso(latestTransaction.amount)}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-3 text-[10px] text-[#8A7A91]">No POS activity recorded.</p>
                    )}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Top Selling Items</h3>
                    <div className="mt-3">
                        <SummaryBarList items={topSellingItems} emptyText="No item sales data available." />
                    </div>
                </div>
            </aside>
        </div>
    );
}

type BookingReportViewProps = {
    records: BookingRecord[];
    searchQuery: string;
    activeFilter: BookingFilter;
    onFilterChange: (filter: BookingFilter) => void;
    expandedBookingId: string | null;
    onToggleExpanded: (bookingId: string) => void;
    showBranchColumn: boolean;
};

function BookingReportView({
                               records,
                               searchQuery,
                               activeFilter,
                               onFilterChange,
                               expandedBookingId,
                               onToggleExpanded,
                               showBranchColumn,
                           }: BookingReportViewProps) {
    const query = searchQuery.trim().toLowerCase();
    const searchedRecords = records.filter((item) =>
        !query ||
        [
            item.id,
            item.reference,
            item.customer,
            item.phone,
            item.venue,
            item.packageName,
            item.statusLabel,
            item.paymentStatus,
            item.branch,
        ]
            .join(" ")
            .toLowerCase()
            .includes(query)
    );
    const displayedRecords =
        activeFilter === "all"
            ? searchedRecords
            : searchedRecords.filter((item) => item.status === activeFilter);
    const latestBooking = [...searchedRecords].sort((left, right) =>
        right.date.localeCompare(left.date)
    )[0];
    const topPackages = Array.from(
        searchedRecords.reduce((summary, item) => {
            const name = item.packageName || "Custom Booking";
            summary.set(name, (summary.get(name) || 0) + 1);
            return summary;
        }, new Map<string, number>())
    )
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 6);
    const statusRows: Array<{
        label: string;
        filter: BookingFilter;
        dot: string;
        value: number;
    }> = [
        { label: "Total Bookings", filter: "all", dot: "bg-[#7A45E8]", value: searchedRecords.length },
        { label: "Pending", filter: "pending", dot: "bg-[#FF8A00]", value: searchedRecords.filter((item) => item.status === "pending").length },
        { label: "Confirmed", filter: "confirmed", dot: "bg-[#7A45E8]", value: searchedRecords.filter((item) => item.status === "confirmed").length },
        { label: "Preparing", filter: "preparing", dot: "bg-[#F6A800]", value: searchedRecords.filter((item) => item.status === "preparing").length },
        { label: "Completed", filter: "completed", dot: "bg-[#22B65B]", value: searchedRecords.filter((item) => item.status === "completed").length },
        { label: "Cancelled", filter: "cancelled", dot: "bg-[#EF3E38]", value: searchedRecords.filter((item) => item.status === "cancelled").length },
    ];

    return (
        <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[#E5DDEA] bg-white shadow-sm">
                <div className="border-b border-[#ECE5F0] px-4 py-3.5">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">Booking Report History</h2>
                    <p className="mt-1 text-[11px] text-[#8A7A91]">
                        Review booking clients, schedules, packages, payments, and status.
                    </p>
                </div>

                <table className="w-full table-fixed border-collapse text-[11px]">
                    <colgroup>
                        <col className={showBranchColumn ? "w-[18%]" : "w-[20%]"} />
                        {showBranchColumn ? <col className="w-[12%]" /> : null}
                        <col className={showBranchColumn ? "w-[14%]" : "w-[16%]"} />
                        <col className={showBranchColumn ? "w-[18%]" : "w-[20%]"} />
                        <col className={showBranchColumn ? "w-[15%]" : "w-[17%]"} />
                        <col className={showBranchColumn ? "w-[11%]" : "w-[13%]"} />
                        <col className={showBranchColumn ? "w-[12%]" : "w-[14%]"} />
                    </colgroup>
                    <thead>
                    <tr className="border-b border-[#E8DFED] bg-[#FCFAFD]">
                        {[
                            ["Client", "text-left"],
                            ...(showBranchColumn ? [["Branch", "text-left"]] : []),
                            ["Schedule", "text-left"],
                            ["Package", "text-left"],
                            ["Payment", "text-left"],
                            ["Status", "text-center"],
                            ["Details", "text-right"],
                        ].map(([label, align]) => (
                            <th key={label} className={`px-2 py-3 text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674] ${align}`}>
                                {label}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {displayedRecords.length > 0 ? (
                        displayedRecords.map((item) => {
                            const isExpanded = expandedBookingId === item.id;
                            const payment = getBookingPaymentDetails(item);

                            return (
                                <Fragment key={item.id}>
                                    <tr className={`border-b border-[#EFE8F2] transition-colors ${isExpanded ? "bg-[#F8F2FC]" : "bg-white hover:bg-[#FCFAFF]"}`}>
                                        <td className="px-2 py-3 align-top">
                                            <div className="flex items-start gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => onToggleExpanded(item.id)}
                                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#4E2C66] transition hover:bg-[#EEE4F7] hover:text-[#6D35D1]"
                                                    aria-label={isExpanded ? "Hide booking details" : "Show booking details"}
                                                >
                                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                </button>
                                                <div className="min-w-0">
                                                    <p className="break-words font-semibold text-[#1A1220]">{item.customer}</p>
                                                    <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">{item.phone || item.reference}</p>
                                                </div>
                                            </div>
                                        </td>
                                        {showBranchColumn ? (
                                            <td className="break-words px-2 py-3 align-top text-[#5F5267]">
                                                {item.branch || "—"}
                                            </td>
                                        ) : null}
                                        <td className="px-2 py-3 align-top">
                                            <p className="font-semibold text-[#1A1220]">{formatDate(item.eventDate)}</p>
                                            <p className="mt-0.5 text-[9px] text-[#8C7A95]">{item.scheduleTime || "Time not recorded"}</p>
                                        </td>
                                        <td className="break-words px-2 py-3 align-top">
                                            <p className="font-semibold text-[#1A1220]">{item.packageName}</p>
                                            <p className="mt-0.5 text-[9px] text-[#8C7A95]">{formatPeso(payment.packagePrice)}</p>
                                        </td>
                                        <td className="px-2 py-3 align-top">
                                            <StatusBadge status={payment.paymentStatus} />
                                            <p className="mt-1 text-[9px] text-[#8C7A95]">Paid {formatPeso(payment.amountPaid)}</p>
                                        </td>
                                        <td className="px-2 py-3 text-center align-top">
                                            <StatusBadge status={getBookingStatusLabel(item)} />
                                        </td>
                                        <td className="break-words px-2 py-3 text-right align-top text-[#5F5267]">
                                            {item.venue || "Venue not recorded"}
                                        </td>
                                    </tr>
                                    {isExpanded ? (
                                        <tr className="border-b border-[#E6DDF0]">
                                            <td colSpan={showBranchColumn ? 7 : 6} className="p-0">
                                                <BookingDetailPanel booking={item} />
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })
                    ) : (
                        <tr>
                            <td colSpan={showBranchColumn ? 7 : 6} className="px-4 py-14 text-center text-sm text-[#8A7A91]">
                                No booking records match the selected filters.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </section>

            <aside className="self-start rounded-[14px] border border-[#E5DDEA] bg-white p-3 shadow-sm">
                <h2 className="text-[16px] font-bold text-[#1A1220]">Booking Summary</h2>
                <div className="mt-3 divide-y divide-[#EEE7F2]">
                    {statusRows.map((item) => (
                        <SummaryMetricRow
                            key={item.filter}
                            label={item.label}
                            value={item.value}
                            dot={item.dot}
                            active={activeFilter === item.filter}
                            onClick={() => onFilterChange(item.filter)}
                        />
                    ))}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Latest Booking</h3>
                    {latestBooking ? (
                        <div className="mt-3 rounded-[12px] border border-[#EEE7F2] bg-[#FCFAFD] p-3">
                            <p className="break-words text-[11px] font-bold text-[#1A1220]">{latestBooking.customer}</p>
                            <p className="mt-1 text-[10px] text-[#6A5D6F]">{formatDate(latestBooking.eventDate)}</p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-[#7A6984]">Package</span>
                                <span className="max-w-[120px] truncate font-bold text-[#4E2C66]" title={latestBooking.packageName}>
                                    {latestBooking.packageName}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-3 text-[10px] text-[#8A7A91]">No booking activity recorded.</p>
                    )}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Top Packages</h3>
                    <div className="mt-3">
                        <SummaryBarList items={topPackages} emptyText="No package booking data available." />
                    </div>
                </div>
            </aside>
        </div>
    );
}

function PackagesReportView({
                                records,
                                showBranchColumn,
                            }: {
    records: PackageRecord[];
    showBranchColumn: boolean;
}) {
    const activePackages = records.filter((item) => item.status.toLowerCase() === "active");
    const inactivePackages = records.filter((item) => item.status.toLowerCase() !== "active");
    const totalPackageItems = sumBy(records, (item) => item.itemCount || 0);
    const averagePrice = records.length
        ? sumBy(records, (item) => item.price) / records.length
        : 0;
    const latestPackage = [...records].sort((left, right) =>
        toReportDateValue(right.updatedAt).localeCompare(toReportDateValue(left.updatedAt))
    )[0];
    const categorySummary = Array.from(
        records.reduce((summary, item) => {
            const category = item.category || "Event Package";
            summary.set(category, (summary.get(category) || 0) + 1);
            return summary;
        }, new Map<string, number>())
    )
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value);
    const columnCount = showBranchColumn ? 7 : 6;

    return (
        <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[#E5DDEA] bg-white shadow-sm">
                <div className="border-b border-[#ECE5F0] px-4 py-3.5">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">Packages Report History</h2>
                    <p className="mt-1 text-[11px] text-[#8A7A91]">
                        Review package names, categories, prices, included items, and availability.
                    </p>
                </div>

                <table className="w-full table-fixed border-collapse text-[11px]">
                    <colgroup>
                        <col className={showBranchColumn ? "w-[12%]" : "w-[13%]"} />
                        <col className={showBranchColumn ? "w-[23%]" : "w-[27%]"} />
                        <col className={showBranchColumn ? "w-[14%]" : "w-[16%]"} />
                        {showBranchColumn ? <col className="w-[14%]" /> : null}
                        <col className={showBranchColumn ? "w-[13%]" : "w-[15%]"} />
                        <col className={showBranchColumn ? "w-[10%]" : "w-[12%]"} />
                        <col className={showBranchColumn ? "w-[14%]" : "w-[17%]"} />
                    </colgroup>
                    <thead>
                    <tr className="border-b border-[#E8DFED] bg-[#FCFAFD]">
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Package ID</th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Package Name</th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Category</th>
                        {showBranchColumn ? <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Branch</th> : null}
                        <th className="px-2 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Price</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Items</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Status</th>
                    </tr>
                    </thead>
                    <tbody>
                    {records.length > 0 ? (
                        records.map((item) => (
                            <tr key={item.id} className="border-b border-[#EFE8F2] bg-white transition-colors hover:bg-[#FCFAFF]">
                                <td className="break-words px-2 py-3 align-top font-mono text-[10px] font-semibold text-[#6039A4]">{item.id}</td>
                                <td className="px-2 py-3 align-top">
                                    <p className="break-words font-semibold text-[#1A1220]">{item.name}</p>
                                    <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">{item.description || "No description recorded"}</p>
                                </td>
                                <td className="break-words px-2 py-3 align-top text-[#5F5267]">{item.category || "Event Package"}</td>
                                {showBranchColumn ? <td className="break-words px-2 py-3 align-top text-[#5F5267]">{item.branch}</td> : null}
                                <td className="px-2 py-3 text-right align-top font-bold tabular-nums text-[#1A1220]">{formatPeso(item.price)}</td>
                                <td className="px-2 py-3 text-center align-top font-semibold tabular-nums text-[#1A1220]">{typeof item.itemCount === "number" ? formatNumber(item.itemCount) : "—"}</td>
                                <td className="px-2 py-3 text-center align-top"><StatusBadge status={item.status} /></td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={columnCount} className="px-4 py-14 text-center text-sm text-[#8A7A91]">
                                No packages match the selected filters.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </section>

            <aside className="self-start rounded-[14px] border border-[#E5DDEA] bg-white p-3 shadow-sm">
                <h2 className="text-[16px] font-bold text-[#1A1220]">Packages Summary</h2>
                <div className="mt-3 divide-y divide-[#EEE7F2]">
                    <SummaryMetricRow label="Total Packages" value={records.length} dot="bg-[#7A45E8]" />
                    <SummaryMetricRow label="Active Packages" value={activePackages.length} dot="bg-[#22B65B]" />
                    <SummaryMetricRow label="Inactive Packages" value={inactivePackages.length} dot="bg-[#EF3E38]" />
                    <SummaryMetricRow label="Average Price" value={formatPeso(averagePrice)} dot="bg-[#FF8A00]" />
                    <SummaryMetricRow label="Package Items" value={totalPackageItems} dot="bg-[#2F80ED]" />
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Latest Package</h3>
                    {latestPackage ? (
                        <div className="mt-3 rounded-[12px] border border-[#EEE7F2] bg-[#FCFAFD] p-3">
                            <p className="break-words text-[11px] font-bold text-[#1A1220]">{latestPackage.name}</p>
                            <p className="mt-1 text-[10px] text-[#6A5D6F]">
                                {toReportDateValue(latestPackage.updatedAt) ? formatDate(toReportDateValue(latestPackage.updatedAt)) : "Date not recorded"}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-[#7A6984]">Price</span>
                                <span className="font-bold tabular-nums text-[#12A150]">{formatPeso(latestPackage.price)}</span>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-3 text-[10px] text-[#8A7A91]">No package activity recorded.</p>
                    )}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Package Categories</h3>
                    <div className="mt-3">
                        <SummaryBarList items={categorySummary} emptyText="No package category data available." />
                    </div>
                </div>
            </aside>
        </div>
    );
}

type EmployeeActionsReportViewProps = {
    records: StaffActivity[];
    searchQuery: string;
    activeFilter: StaffModuleFilter;
    onFilterChange: (filter: StaffModuleFilter) => void;
    showBranchColumn: boolean;
};

function EmployeeActionsReportView({
                                       records,
                                       searchQuery,
                                       activeFilter,
                                       onFilterChange,
                                       showBranchColumn,
                                   }: EmployeeActionsReportViewProps) {
    const query = searchQuery.trim().toLowerCase();
    const searchedRecords = records.filter((item) =>
        !query ||
        [
            item.id,
            item.staffName,
            item.role,
            item.action,
            item.module,
            item.reference,
            item.details,
            item.branch,
        ]
            .join(" ")
            .toLowerCase()
            .includes(query)
    );
    const displayedRecords =
        activeFilter === "all"
            ? searchedRecords
            : searchedRecords.filter((item) => item.module === activeFilter);
    const latestAction = [...searchedRecords].sort((left, right) => {
        const dateDifference = right.date.localeCompare(left.date);
        return dateDifference || String(right.time || "").localeCompare(String(left.time || ""));
    })[0];
    const employeeSummary = Array.from(
        searchedRecords.reduce((summary, item) => {
            const employee = item.staffName || "Unknown Employee";
            summary.set(employee, (summary.get(employee) || 0) + 1);
            return summary;
        }, new Map<string, number>())
    )
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 6);
    const moduleRows: Array<{
        label: string;
        filter: StaffModuleFilter;
        dot: string;
        value: number;
    }> = [
        { label: "Total Actions", filter: "all", dot: "bg-[#7A45E8]", value: searchedRecords.length },
        { label: "Bookings", filter: "Bookings", dot: "bg-[#7A45E8]", value: searchedRecords.filter((item) => item.module === "Bookings").length },
        { label: "Packages", filter: "Packages", dot: "bg-[#F6A800]", value: searchedRecords.filter((item) => item.module === "Packages").length },
        { label: "Inventory", filter: "Inventory", dot: "bg-[#FF8A00]", value: searchedRecords.filter((item) => item.module === "Inventory").length },
        { label: "Sales / POS", filter: "Sales / POS", dot: "bg-[#22B65B]", value: searchedRecords.filter((item) => item.module === "Sales / POS").length },
    ];
    const columnCount = showBranchColumn ? 6 : 5;

    return (
        <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[#E5DDEA] bg-white shadow-sm">
                <div className="border-b border-[#ECE5F0] px-4 py-3.5">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">Employee Actions History</h2>
                    <p className="mt-1 text-[11px] text-[#8A7A91]">
                        Review employee actions across Bookings, Inventory, Packages, and Sales / POS.
                    </p>
                </div>

                <table className="w-full table-fixed border-collapse text-[11px]">
                    <colgroup>
                        <col className={showBranchColumn ? "w-[15%]" : "w-[17%]"} />
                        <col className={showBranchColumn ? "w-[18%]" : "w-[20%]"} />
                        <col className={showBranchColumn ? "w-[27%]" : "w-[31%]"} />
                        <col className={showBranchColumn ? "w-[15%]" : "w-[16%]"} />
                        <col className={showBranchColumn ? "w-[15%]" : "w-[16%]"} />
                        {showBranchColumn ? <col className="w-[10%]" /> : null}
                    </colgroup>
                    <thead>
                    <tr className="border-b border-[#E8DFED] bg-[#FCFAFD]">
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Date / Time</th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Employee</th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Action</th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Module</th>
                        <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Reference</th>
                        {showBranchColumn ? <th className="px-2 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-[#685674]">Branch</th> : null}
                    </tr>
                    </thead>
                    <tbody>
                    {displayedRecords.length > 0 ? (
                        displayedRecords.map((item) => (
                            <tr key={item.id} className="border-b border-[#EFE8F2] bg-white transition-colors hover:bg-[#FCFAFF]">
                                <td className="px-2 py-3 align-top">
                                    <p className="font-semibold text-[#1A1220]">{formatDate(item.date)}</p>
                                    <p className="mt-0.5 text-[9px] text-[#8C7A95]">{item.time || "Time not recorded"}</p>
                                </td>
                                <td className="px-2 py-3 align-top">
                                    <p className="break-words font-semibold text-[#1A1220]">{item.staffName}</p>
                                    <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">{item.role}</p>
                                </td>
                                <td className="px-2 py-3 align-top">
                                    <p className="break-words font-semibold text-[#1A1220]">{item.action}</p>
                                    <p className="mt-0.5 break-words text-[9px] text-[#8C7A95]">{item.details || "No additional details recorded."}</p>
                                </td>
                                <td className="px-2 py-3 align-top"><ActivityModuleBadge module={item.module} /></td>
                                <td className="break-words px-2 py-3 align-top font-mono text-[10px] font-semibold text-[#5F4E75]">{item.reference || "—"}</td>
                                {showBranchColumn ? <td className="break-words px-2 py-3 align-top text-[#5F5267]">{item.branch}</td> : null}
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={columnCount} className="px-4 py-14 text-center text-sm text-[#8A7A91]">
                                No employee actions match the selected filters.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </section>

            <aside className="self-start rounded-[14px] border border-[#E5DDEA] bg-white p-3 shadow-sm">
                <h2 className="text-[16px] font-bold text-[#1A1220]">Employee Actions Summary</h2>
                <div className="mt-3 divide-y divide-[#EEE7F2]">
                    {moduleRows.map((item) => (
                        <SummaryMetricRow
                            key={item.filter}
                            label={item.label}
                            value={item.value}
                            dot={item.dot}
                            active={activeFilter === item.filter}
                            onClick={() => onFilterChange(item.filter)}
                        />
                    ))}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Latest Action</h3>
                    {latestAction ? (
                        <div className="mt-3 rounded-[12px] border border-[#EEE7F2] bg-[#FCFAFD] p-3">
                            <p className="break-words text-[11px] font-bold text-[#1A1220]">{latestAction.staffName}</p>
                            <p className="mt-1 break-words text-[10px] text-[#6A5D6F]">{latestAction.action}</p>
                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-[#7A6984]">Module</span>
                                <span className="font-bold text-[#4E2C66]">{latestAction.module}</span>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-3 text-[10px] text-[#8A7A91]">No employee activity recorded.</p>
                    )}
                </div>

                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                    <h3 className="text-[12px] font-bold text-[#211629]">Most Active Employees</h3>
                    <div className="mt-3">
                        <SummaryBarList items={employeeSummary} emptyText="No employee action data available." />
                    </div>
                </div>
            </aside>
        </div>
    );
}

export function ReportsWorkspace({
                                     initialRole,
                                     assignedBranch,
                                     storeName,
                                     viewConfig,
                                 }: ReportsWorkspaceProps) {
    const role = initialRole;
    const isOwner = role === "owner";
    const showBranchFilter = isOwner && viewConfig.showBranchFilter;
    const showBranchColumn = isOwner || viewConfig.showBranchColumn;
    const [branch, setBranch] = useState(() =>
        initialRole === "owner"
            ? ALL_BRANCHES
            : assignedBranch || DEFAULT_BRANCH
    );
    const [startDate, setStartDate] = useState(getMonthStart(getToday()));
    const [endDate, setEndDate] = useState(getToday());
    const [selectedReport, setSelectedReport] = useState<ReportKey | null>("inventory");
    const [searchQuery, setSearchQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
    const [expandedInventoryId, setExpandedInventoryId] = useState<string | null>(null);
    const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");
    const [packageStatusFilter, setPackageStatusFilter] =
        useState<PackageStatusFilter>("all");
    const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
    const [staffModuleFilter, setStaffModuleFilter] =
        useState<StaffModuleFilter>("all");
    const [report, setReport] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [liveInventoryState, setLiveInventoryState] =
        useState<LiveInventoryLoadState>({
            ready: false,
            items: [],
        });
    const [liveBranchOptions, setLiveBranchOptions] = useState<
        LiveBranchOption[]
    >([]);
    const [liveSalesState, setLiveSalesState] =
        useState<LiveSalesLoadState>({
            ready: false,
            items: [],
        });
    const [liveBookingsState, setLiveBookingsState] =
        useState<LiveBookingsLoadState>({
            ready: false,
            items: [],
        });

    const storedAssignedBranchId = getStoredSessionValue([
        "branch_id",
        "stocknbook_branch_id",
        "manager_branch_id",
        "staff_branch_id",
    ]);

    const selectedOwnerBranchId = useMemo(() => {
        if (initialRole !== "owner" || isAllBranches(branch)) {
            return "";
        }

        const normalizedBranch = branch.trim().toLowerCase();

        return (
            liveBranchOptions.find(
                (item) => item.name.trim().toLowerCase() === normalizedBranch
            )?.id || ""
        );
    }, [branch, initialRole, liveBranchOptions]);

    const scopedSalesBranchId =
        initialRole === "owner"
            ? selectedOwnerBranchId
            : storedAssignedBranchId;

    const loadReport = useCallback(async () => {
        const query = new URLSearchParams({
            branch: isAllBranches(branch) ? "All branches" : branch,
            month: startDate.slice(0, 7),
            startDate,
            endDate,
            role,
            assignedBranch,
        });

        if (scopedSalesBranchId) {
            query.set("branch_id", scopedSalesBranchId);
        }

        const token = getStoredSessionValue(["token"]);

        if (!token) {
            setReport(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            const response = await fetch(`/api/reports?${query.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
            });
            const payload = await response.json();

            setReport(response.ok && payload?.success ? payload.data : null);
        } catch (error) {
            console.warn("Reports API loading failed:", error);
            setReport(null);
        } finally {
            setLoading(false);
        }
    }, [
        assignedBranch,
        branch,
        endDate,
        role,
        scopedSalesBranchId,
        startDate,
    ]);

    const loadLiveBranches = useCallback(async () => {
        const token = getStoredSessionValue(["token"]);

        if (!token) {
            setLiveBranchOptions([]);
            return;
        }

        try {
            const response = await fetch("/api/branches", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
            });

            const payload = (await response.json()) as LiveBranchesResponse;

            if (!response.ok || !Array.isArray(payload.branches)) {
                throw new Error(payload.error || "Unable to load branches.");
            }

            const normalizedBranches = payload.branches
                .map((rawValue) => {
                    const raw = asLiveRecord(rawValue);
                    const id = asLiveText(
                        raw.id,
                        raw.branchId,
                        raw.branch_id
                    );
                    const name = asLiveText(
                        raw.branchName,
                        raw.branch_name,
                        raw.name
                    );

                    return id && name ? { id, name } : null;
                })
                .filter(
                    (item): item is LiveBranchOption => Boolean(item)
                )
                .filter(
                    (item, index, items) =>
                        items.findIndex(
                            (candidate) =>
                                candidate.name.trim().toLowerCase() ===
                                item.name.trim().toLowerCase()
                        ) === index
                );

            setLiveBranchOptions(normalizedBranches);
        } catch (error) {
            console.warn("Reports branch loading failed:", error);
            setLiveBranchOptions([]);
        }
    }, []);

    const loadLiveSales = useCallback(async () => {
        const token = getStoredSessionValue(["token"]);

        if (!token) {
            setLiveSalesState({
                ready: false,
                items: [],
            });
            return;
        }

        const storeId = getStoredSessionValue([
            "store_id",
            "stocknbook_store_id",
        ]);
        const request: Record<string, unknown> = {
            action: "get_orders",
        };
        const numericBranchId = Number(scopedSalesBranchId);

        if (Number.isFinite(numericBranchId) && numericBranchId > 0) {
            request.branch_id = numericBranchId;
        }

        if (storeId) {
            request.store_id = Number(storeId);
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

            const payload = (await response.json()) as LiveSalesResponse;

            if (!response.ok || (payload as { success?: boolean }).success === false) {
                throw new Error(payload.error || "Unable to load POS orders.");
            }

            const fallbackBranch =
                initialRole === "owner" && isAllBranches(branch)
                    ? ALL_BRANCHES
                    : branch || assignedBranch || DEFAULT_BRANCH;

            const rawOrders = getLiveCollection(payload, [
                "orders",
                "sales",
                "transactions",
            ]);

            const normalizedOrders = rawOrders
                .map((order, index) =>
                    normalizeLivePosOrder(order, index, fallbackBranch)
                )
                .filter((order) =>
                    isDateInSelectedRange(order.date, startDate, endDate)
                );

            const ownerBranchScopedOrders =
                initialRole === "owner" &&
                !isAllBranches(branch) &&
                !scopedSalesBranchId
                    ? normalizedOrders.filter(
                        (order) =>
                            order.branch.trim().toLowerCase() ===
                            branch.trim().toLowerCase()
                    )
                    : normalizedOrders;

            setLiveSalesState({
                ready: true,
                items: ownerBranchScopedOrders,
            });
        } catch (error) {
            console.warn("Reports POS order loading failed:", error);

            // Keep the report truthful when live orders cannot be loaded.
            // Do not substitute unrelated fallback/sample sales records.
            setLiveSalesState({
                ready: false,
                items: [],
            });
        }
    }, [
        assignedBranch,
        branch,
        endDate,
        initialRole,
        scopedSalesBranchId,
        startDate,
    ]);

    const loadLiveBookings = useCallback(async () => {
        const token = getStoredSessionValue(["token"]);

        if (!token) {
            setLiveBookingsState({
                ready: false,
                items: [],
            });
            return;
        }

        const storeId = getStoredSessionValue([
            "store_id",
            "stocknbook_store_id",
        ]);
        const request: Record<string, unknown> = {
            action: "get_bookings",
            role: initialRole,
        };
        const numericBranchId = Number(scopedSalesBranchId);

        if (Number.isFinite(numericBranchId) && numericBranchId > 0) {
            request.branch_id = numericBranchId;
        }

        if (storeId) {
            request.store_id = Number(storeId);
        }

        try {
            const response = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(request),
                cache: "no-store",
            });

            const payload = (await response.json()) as LiveBookingsResponse;

            if (!response.ok || (payload as { success?: boolean }).success === false) {
                throw new Error(payload.error || "Unable to load bookings.");
            }

            const fallbackBranch =
                initialRole === "owner" && isAllBranches(branch)
                    ? ALL_BRANCHES
                    : branch || assignedBranch || DEFAULT_BRANCH;

            const rawBookings = getLiveCollection(payload, [
                "bookings",
                "records",
            ]);

            const normalizedBookings = rawBookings
                .map((booking, index) =>
                    normalizeLiveBooking(booking, index, fallbackBranch)
                )
                .filter((booking) =>
                    isDateInSelectedRange(booking.date, startDate, endDate)
                );

            const ownerBranchScopedBookings =
                initialRole === "owner" &&
                !isAllBranches(branch) &&
                !scopedSalesBranchId
                    ? normalizedBookings.filter(
                        (booking) =>
                            booking.branch.trim().toLowerCase() ===
                            branch.trim().toLowerCase()
                    )
                    : normalizedBookings;

            setLiveBookingsState({
                ready: true,
                items: ownerBranchScopedBookings,
            });
        } catch (error) {
            console.warn("Reports booking loading failed:", error);

            // Keep booking revenue truthful. Do not substitute unrelated
            // fallback/sample booking records when live data is unavailable.
            setLiveBookingsState({
                ready: false,
                items: [],
            });
        }
    }, [
        assignedBranch,
        branch,
        endDate,
        initialRole,
        scopedSalesBranchId,
        startDate,
    ]);

    const loadLiveInventory = useCallback(async () => {
        const token = getStoredSessionValue(["token"]);

        if (!token) {
            setLiveInventoryState({
                ready: false,
                items: [],
            });
            return;
        }

        const storeId = getStoredSessionValue([
            "store_id",
            "stocknbook_store_id",
        ]);

        const assignedBranchId = getStoredSessionValue([
            "branch_id",
            "stocknbook_branch_id",
            "manager_branch_id",
            "staff_branch_id",
        ]);

        const productRequest: Record<string, unknown> = {
            action: "get_products",
            include_variants: true,
        };

        if (storeId) {
            productRequest.store_id = Number(storeId);
        }

        if (role !== "owner" && assignedBranchId) {
            productRequest.branch_id = Number(assignedBranchId);
        }

        try {
            const response = await fetch("/api/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(productRequest),
                cache: "no-store",
            });

            const payload = (await response.json()) as LiveProductsResponse;

            if (!response.ok || !Array.isArray(payload.products)) {
                throw new Error(payload.error || "Unable to load live inventory.");
            }

            const normalizedInventory = payload.products.map((product, index) =>
                normalizeLiveInventoryProduct(product, index, assignedBranch)
            );

            const scopedInventory =
                role === "owner" &&
                !isAllBranches(branch) &&
                branch.trim()
                    ? normalizedInventory.filter(
                        (item) =>
                            item.branch.trim().toLowerCase() ===
                            branch.trim().toLowerCase()
                    )
                    : normalizedInventory;

            setLiveInventoryState({
                ready: true,
                items: scopedInventory,
            });
        } catch (error) {
            console.warn("Reports live inventory loading failed:", error);

            // Do not show sample stock when the live inventory request fails.
            // An empty list is more truthful than unrelated demo items.
            setLiveInventoryState({
                ready: false,
                items: [],
            });
        }
    }, [assignedBranch, branch, role]);

    const handleRefresh = useCallback(async () => {
        await Promise.all([
            loadReport(),
            loadLiveBranches(),
            loadLiveInventory(),
            loadLiveSales(),
            loadLiveBookings(),
        ]);
    }, [
        loadLiveBookings,
        loadLiveBranches,
        loadLiveInventory,
        loadLiveSales,
        loadReport,
    ]);

    useEffect(() => {
        void loadReport();
        void loadLiveBranches();
        void loadLiveInventory();
        void loadLiveSales();
        void loadLiveBookings();
    }, [
        loadLiveBookings,
        loadLiveBranches,
        loadLiveInventory,
        loadLiveSales,
        loadReport,
    ]);


    const activeBranch = isOwner
        ? branch
        : assignedBranch || report?.access?.assignedBranch || "Assigned Branch";

    const activeStoreName = useMemo(() => {
        const apiStoreName =
            report?.storeName ||
            report?.store_name ||
            report?.businessName ||
            report?.business_name ||
            "";

        return String(apiStoreName || storeName || "Store").trim() || "Store";
    }, [
        report?.businessName,
        report?.business_name,
        report?.storeName,
        report?.store_name,
        storeName,
    ]);

    const branchOptions = useMemo(() => {
        const storedBranchName = getStoredSessionValue([
            "branch_name",
            "stocknbook_branch_name",
            "branchName",
        ]);

        const options = [
            ...liveBranchOptions.map((item) => item.name),
            ...(report?.branchOptions || []),
            assignedBranch,
            storedBranchName,
            "Main Branch",
        ];

        const uniqueBranches = options
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .filter((item) => !isAllBranches(item))
            .filter(
                (item, index, values) =>
                    values.findIndex(
                        (value) => value.toLowerCase() === item.toLowerCase()
                    ) === index
            );

        return [ALL_BRANCHES, ...uniqueBranches];
    }, [assignedBranch, liveBranchOptions, report?.branchOptions]);

    const inventory = useMemo(() => {
        if (liveInventoryState.ready) {
            return liveInventoryState.items;
        }

        return report?.inventoryList ?? [];
    }, [
        liveInventoryState.items,
        liveInventoryState.ready,
        report?.inventoryList,
    ]);

    const restocks = useMemo(
        () => report?.restockHistory ?? [],
        [report?.restockHistory]
    );

    const displayedRestocks = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        if (!query) return restocks;

        return restocks.filter((item) =>
            [
                item.id,
                item.reference,
                item.product,
                item.variantName,
                item.branch,
                item.receivedBy,
                item.notes,
            ]
                .join(" ")
                .toLowerCase()
                .includes(query)
        );
    }, [restocks, searchQuery]);

    const bookings = useMemo(() => {
        if (liveBookingsState.ready) {
            return liveBookingsState.items;
        }

        return (report?.bookingList ?? []).filter((booking) =>
            isDateInSelectedRange(
                toReportDateValue(booking.date),
                startDate,
                endDate
            )
        );
    }, [
        endDate,
        liveBookingsState.items,
        liveBookingsState.ready,
        report?.bookingList,
        startDate,
    ]);

    const orderRevenueRecords = useMemo(
        () =>
            liveSalesState.ready
                ? liveSalesState.items
                : report?.salesList ?? [],
        [liveSalesState.items, liveSalesState.ready, report?.salesList]
    );

    /*
      This is the important split:
      only POS-pattern orders go to POS Sales;
      all booking-linked/non-POS order IDs go to Booking Revenue.
    */
    const sales = useMemo(
        () =>
            orderRevenueRecords.filter(
                (order) => order.revenueSource === "pos"
            ),
        [orderRevenueRecords]
    );


    const packages = useMemo<PackageRecord[]>(() => {
        if (report?.packageList?.length) {
            return report.packageList;
        }

        const packageMap = new Map<string, PackageRecord>();

        bookings.forEach((booking, index) => {
            const key = booking.packageName.trim().toLowerCase();

            if (!key || packageMap.has(key)) return;

            packageMap.set(key, {
                id: `PKG-${String(index + 1).padStart(3, "0")}`,
                name: booking.packageName,
                description: "Package used in booking records.",
                category: "Event Package",
                branch: booking.branch,
                price: booking.amount,
                itemCount: undefined,
                status: "Active",
                updatedAt: booking.date,
                updatedBy: undefined,
            });
        });

        return Array.from(packageMap.values());
    }, [bookings, report?.packageList]);

    const forecasts = useMemo(
        () => report?.forecasting ?? [],
        [report?.forecasting]
    );

    const seasons = useMemo(
        () => report?.seasonalInsights ?? [],
        [report?.seasonalInsights]
    );

    const staffActivities = useMemo(
        () => report?.staffActivities ?? [],
        [report?.staffActivities]
    );

    const bookingStaffActions = useMemo(
        () => staffActivities.filter((item) => item.module === "Bookings").length,
        [staffActivities]
    );

    const packageStaffActions = useMemo(
        () => staffActivities.filter((item) => item.module === "Packages").length,
        [staffActivities]
    );

    const inventoryStaffActions = useMemo(
        () => staffActivities.filter((item) => item.module === "Inventory").length,
        [staffActivities]
    );

    const salesPosStaffActions = useMemo(
        () =>
            staffActivities.filter((item) => item.module === "Sales / POS").length,
        [staffActivities]
    );


    const displayedStaffActivities = useMemo(() => {
        if (staffModuleFilter === "all") return staffActivities;

        return staffActivities.filter(
            (activity) => activity.module === staffModuleFilter
        );
    }, [staffActivities, staffModuleFilter]);

    const staffActionListTitle =
        staffModuleFilter === "all"
            ? "Current Employee Actions"
            : `${staffModuleFilter} Employee Actions`;

    const staffActionListSubtitle =
        staffModuleFilter === "all"
            ? "Track employee actions from Bookings, Inventory, Packages, and Sales / POS."
            : `Showing only employee actions from the ${staffModuleFilter} module.`;

    const lowStock = useMemo(() => {
        if (liveInventoryState.ready) {
            return inventory.filter((item) => item.status === "Low Stock");
        }

        return report?.lowStockItems?.length
            ? report.lowStockItems
            : inventory.filter((item) => item.status === "Low Stock");
    }, [
        inventory,
        liveInventoryState.ready,
        report?.lowStockItems,
    ]);

    const outOfStock = useMemo(() => {
        if (liveInventoryState.ready) {
            return inventory.filter((item) => item.status === "Out of Stock");
        }

        return report?.outOfStockItems?.length
            ? report.outOfStockItems
            : inventory.filter((item) => item.status === "Out of Stock");
    }, [
        inventory,
        liveInventoryState.ready,
        report?.outOfStockItems,
    ]);

    const inStock = useMemo(
        () => inventory.filter((item) => item.status === "In Stock"),
        [inventory]
    );

    const soonToExpire = useMemo(
        () =>
            inventory.filter(
                (item) => getExpirationStatus(item.expiryDate) === "Soon to Expire"
            ),
        [inventory]
    );

    const expiredItems = useMemo(
        () =>
            inventory.filter(
                (item) => getExpirationStatus(item.expiryDate) === "Expired"
            ),
        [inventory]
    );

    const goodExpirationItems = useMemo(
        () =>
            inventory.filter((item) => {
                const status = getExpirationStatus(item.expiryDate);
                return status === "Good" || status === "No Expiry";
            }),
        [inventory]
    );

    const inventoryCategories = useMemo(
        () =>
            Array.from(
                new Set(
                    inventory
                        .map((item) => item.category.trim())
                        .filter(Boolean)
                )
            ).sort((left, right) => left.localeCompare(right)),
        [inventory]
    );


    const displayedInventory = useMemo(() => {
        const normalizedSearch = searchQuery.trim().toLowerCase();

        return inventory.filter((item) => {
            const expirationStatus = getExpirationStatus(item.expiryDate);
            const updatedDate = toReportDateValue(item.lastUpdated);

            const matchesInventoryStatus =
                inventoryFilter === "all" ||
                (inventoryFilter === "in" && item.status === "In Stock") ||
                (inventoryFilter === "low" && item.status === "Low Stock") ||
                (inventoryFilter === "out" && item.status === "Out of Stock") ||
                (inventoryFilter === "soon" &&
                    expirationStatus === "Soon to Expire") ||
                (inventoryFilter === "expired" &&
                    expirationStatus === "Expired");

            const matchesSearch =
                !normalizedSearch ||
                [
                    item.product,
                    item.category,
                    item.branch,
                    ...getInventoryVariants(item).flatMap((variant) => [
                        variant.name,
                        variant.sku,
                    ]),
                ]
                    .join(" ")
                    .toLowerCase()
                    .includes(normalizedSearch);

            const matchesCategory =
                categoryFilter === "all" || item.category === categoryFilter;


            const matchesDate =
                !updatedDate ||
                isDateInSelectedRange(updatedDate, startDate, endDate);

            return (
                matchesInventoryStatus &&
                matchesSearch &&
                matchesCategory &&
                matchesDate
            );
        });
    }, [
        categoryFilter,
        endDate,
        inventory,
        inventoryFilter,
        searchQuery,
        startDate,
    ]);


    const inventoryCategorySummary = useMemo(() => {
        const counts = new Map<string, number>();

        inventory.forEach((item) => {
            const category = item.category || "Uncategorized";
            counts.set(category, (counts.get(category) || 0) + 1);
        });

        return Array.from(counts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => {
                const countDifference = right.count - left.count;
                return countDifference || left.name.localeCompare(right.name);
            });
    }, [inventory]);

    const largestInventoryCategoryCount = Math.max(
        1,
        ...inventoryCategorySummary.map((category) => category.count)
    );

    const inventoryListTitle = "Inventory Report History";
    const inventoryListSubtitle =
        "Review current stock, prices, variants, and expiration status for every item.";

    const displayedBookings = useMemo(() => {
        if (bookingFilter === "all") return bookings;
        return bookings.filter((booking) => booking.status === bookingFilter);
    }, [bookingFilter, bookings]);

    const bookingListTitle =
        bookingFilter === "all"
            ? "All Booking Records"
            : `${bookingFilter.charAt(0).toUpperCase()}${bookingFilter.slice(1)} Booking Records`;

    const bookingListSubtitle =
        bookingFilter === "all"
            ? "Booking ID, reference number, customer, package, event date, and status."
            : `Showing only ${bookingFilter} booking records for the selected period.`;

    const bookingFilters: Array<{
        key: BookingFilter;
        label: string;
        count: number;
        helper: string;
    }> = [
        {
            key: "all",
            label: "ALL BOOKINGS",
            count: bookings.length,
            helper: "Show all booking records",
        },
        {
            key: "pending",
            label: "PENDING",
            count: bookings.filter((booking) => booking.status === "pending").length,
            helper: "Show pending bookings",
        },
        {
            key: "confirmed",
            label: "CONFIRMED",
            count: bookings.filter((booking) => booking.status === "confirmed").length,
            helper: "Show confirmed bookings",
        },
        {
            key: "preparing",
            label: "PREPARING",
            count: bookings.filter((booking) => booking.status === "preparing").length,
            helper: "Show bookings in preparation",
        },
        {
            key: "completed",
            label: "COMPLETED",
            count: bookings.filter((booking) => booking.status === "completed").length,
            helper: "Show completed bookings",
        },
        {
            key: "cancelled",
            label: "CANCELLED",
            count: bookings.filter((booking) => booking.status === "cancelled").length,
            helper: "Show cancelled bookings",
        },
    ];


    const posTransactions = useMemo(
        () =>
            [...sales].sort((a, b) => {
                const dateDifference = b.date.localeCompare(a.date);

                if (dateDifference !== 0) {
                    return dateDifference;
                }

                return (b.reference || b.id).localeCompare(a.reference || a.id);
            }),
        [sales]
    );

    const displayedPosTransactions = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        if (!query) return posTransactions;

        return posTransactions.filter((item) =>
            [
                item.id,
                item.reference,
                item.customer,
                item.product,
                item.itemsText,
                item.statusLabel,
            ]
                .join(" ")
                .toLowerCase()
                .includes(query)
        );
    }, [posTransactions, searchQuery]);

    const displayedPackages = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        return packages.filter((item) => {
            const searchableText = [
                item.id,
                item.name,
                item.description,
                item.category,
                item.branch,
                item.status,
                item.updatedBy,
            ]
                .join(" ")
                .toLowerCase();
            const normalizedStatus = item.status.trim().toLowerCase();
            const matchesSearch = !query || searchableText.includes(query);
            const matchesStatus =
                packageStatusFilter === "all" ||
                (packageStatusFilter === "active" && normalizedStatus === "active") ||
                (packageStatusFilter === "inactive" && normalizedStatus !== "active");

            return matchesSearch && matchesStatus;
        });
    }, [packageStatusFilter, packages, searchQuery]);


    const totalSales = useMemo(() => sumBy(sales, (item) => item.amount), [sales]);



    const currentRange =
        report?.dateRange?.startDate && report?.dateRange?.endDate
            ? formatDateRange(report.dateRange.startDate, report.dateRange.endDate)
            : formatDateRange(startDate, endDate);

    const allowedCards = REPORT_CARDS;


    function getFilteredInventoryExportTable(): ExportTable {
        const headers = [
            "Product Name",
            ...(showBranchColumn ? ["Branch"] : []),
            "Category",
            "Type",
            "Current Stock",
            "Alert Level",
            "Unit Cost",
            "Selling Price",
            "Expiration Date",
            "Status",
        ];

        const rows = displayedInventory.flatMap((item) => {
            const variants = getInventoryVariants(item);
            const parentRow = [
                item.product,
                ...(showBranchColumn ? [item.branch] : []),
                item.category,
                variants.length > 0
                    ? `${variants.length} variant${variants.length === 1 ? "" : "s"}`
                    : "Regular",
                formatNumber(item.stock),
                formatNumber(item.reorderLevel),
                getPriceRange(item, "costPrice"),
                getPriceRange(item, "salesPrice"),
                item.expiryDate
                    ? `${formatDate(item.expiryDate)} (${getExpirationStatus(item.expiryDate)})`
                    : "No expiry",
                item.status,
            ];

            const variantRows = variants.map((variant) => [
                `↳ ${variant.name}`,
                ...(showBranchColumn ? ["—"] : []),
                "—",
                "Variant",
                formatNumber(variant.stock),
                formatNumber(variant.reorderLevel ?? 0),
                typeof variant.costPrice === "number"
                    ? formatPeso(variant.costPrice)
                    : "—",
                typeof variant.salesPrice === "number"
                    ? formatPeso(variant.salesPrice)
                    : "—",
                variant.expiryDate
                    ? `${formatDate(variant.expiryDate)} (${getExpirationStatus(variant.expiryDate)})`
                    : "No expiry",
                getVariantStatus(variant),
            ]);

            return [parentRow, ...variantRows];
        });

        return {
            title: "Filtered Inventory Report",
            headers,
            rows,
        };
    }

    function exportDoc(table: ExportTable) {
        const rows = table.rows
            .map(
                (row) =>
                    `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
            )
            .join("");

        const documentHtml = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: Arial, sans-serif; color: #1A1220; }
            h1 { color: #2B174C; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; }
            th { background: #2B174C; color: white; }
            th, td { border: 1px solid #DED3E8; padding: 8px; text-align: left; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(table.title)}</h1>
          <p>Store: ${escapeHtml(activeStoreName)}${
            showBranchColumn
                ? ` | Branch: ${escapeHtml(activeBranch)}`
                : ""
        } | Date range: ${escapeHtml(currentRange)}</p>
          <table>
            <thead><tr>${table.headers
            .map((header) => `<th>${escapeHtml(header)}</th>`)
            .join("")}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `;

        downloadFile(
            `stocknbook-full-inventory-${startDate}.doc`,
            "application/msword;charset=utf-8",
            documentHtml
        );
    }

    function exportExcel(table: ExportTable) {
        const worksheet = XLSX.utils.aoa_to_sheet([
            [table.title],
            [
                `Store: ${activeStoreName}`,
                ...(showBranchColumn ? [`Branch: ${activeBranch}`] : []),
                `Date range: ${currentRange}`,
            ],
            [],
            table.headers,
            ...table.rows,
        ]);

        worksheet["!cols"] = table.headers.map((header, columnIndex) => {
            const longestValue = Math.max(
                header.length,
                ...table.rows.map((row) => String(row[columnIndex] ?? "").length)
            );

            return { wch: Math.min(Math.max(longestValue + 2, 12), 36) };
        });

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory Report");
        XLSX.writeFile(workbook, `stocknbook-full-inventory-${startDate}.xlsx`);
    }

    function exportPdf(table: ExportTable) {
        const pdf = createTablePdf({
            title: table.title,
            storeName: activeStoreName,
            branch: showBranchColumn ? activeBranch : "",
            dateRange: currentRange,
            headers: table.headers,
            rows: table.rows,
        });

        downloadFile(
            `stocknbook-full-inventory-${startDate}.pdf`,
            "application/pdf",
            pdf
        );
    }

    return (
        <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#FFFDF8] font-sans">
            <div className="px-4 py-5 sm:px-5 lg:px-6">
                <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="text-[27px] font-bold leading-none text-[#1A1220]">
                            Reports
                        </h1>
                        <p className="mt-2 text-sm text-[#7F7188]">
                            View and export business reports and activity history.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleRefresh()}
                            disabled={loading}
                            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1B0D31] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw
                                size={15}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </header>

                <nav
                    aria-label="Report types"
                    className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
                >
                    {allowedCards.map((card) => {
                        const Icon = card.icon;
                        const active = selectedReport === card.key;

                        return (
                            <button
                                key={card.key}
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                    setSelectedReport(card.key);
                                    setSearchQuery("");
                                    setExpandedInventoryId(null);
                                    setExpandedBookingId(null);

                                    if (card.key === "inventory") {
                                        setInventoryFilter("all");
                                        setCategoryFilter("all");
                                    }

                                    if (card.key === "bookings") {
                                        setBookingFilter("all");
                                    }

                                    if (card.key === "packages") {
                                        setPackageStatusFilter("all");
                                    }

                                    if (card.key === "staff") {
                                        setStaffModuleFilter("all");
                                    }
                                }}
                                className={`group flex min-h-[132px] min-w-0 flex-col rounded-[16px] border p-4 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#7C4DFF]/20 ${
                                    active
                                        ? "border-[#9B6CF3] bg-[#FCF9FF] shadow-[0_0_0_2px_rgba(124,77,255,0.12),0_10px_24px_rgba(62,32,100,0.12)]"
                                        : "border-[#E7DFED] bg-white shadow-sm hover:-translate-y-0.5 hover:border-[#C5A9E8] hover:shadow-[0_10px_24px_rgba(62,32,100,0.12)]"
                                }`}
                            >
                                <span className="flex min-w-0 items-start justify-between gap-2">
                                    <span
                                        className={`min-w-0 break-words pr-1 text-[13px] font-bold leading-5 transition-colors ${
                                            active ? "text-[#5727C8]" : "text-[#20152A]"
                                        }`}
                                    >
                                        {card.title}
                                    </span>

                                    <span
                                        className={`flex h-10 shrink-0 items-center justify-end overflow-hidden rounded-full transition-all duration-200 ${card.iconClassName} ${
                                            active
                                                ? "w-[76px]"
                                                : "w-10 group-hover:w-[76px]"
                                        }`}
                                    >
                                        <span
                                            className={`overflow-hidden whitespace-nowrap text-[11px] font-semibold transition-all duration-200 ${
                                                active
                                                    ? "ml-3 max-w-[34px] opacity-100"
                                                    : "ml-0 max-w-0 opacity-0 group-hover:ml-3 group-hover:max-w-[34px] group-hover:opacity-100"
                                            }`}
                                        >
                                            View
                                        </span>
                                        <Icon
                                            size={19}
                                            strokeWidth={2}
                                            className="mx-2.5 shrink-0"
                                        />
                                    </span>
                                </span>

                                <span className="mt-4 block break-words text-[11px] leading-[1.45] text-[#7F7188]">
                                    {card.subtitle}
                                </span>
                            </button>
                        );
                    })}
                </nav>

                <ReportFilterBar
                    selectedReport={selectedReport}
                    searchQuery={searchQuery}
                    onSearchChange={(value) => {
                        setSearchQuery(value);
                    }}
                    startDate={startDate}
                    endDate={endDate}
                    onStartDateChange={(value) => {
                        setStartDate(value);
                    }}
                    onEndDateChange={(value) => {
                        setEndDate(value);
                    }}
                    categoryFilter={categoryFilter}
                    inventoryCategories={inventoryCategories}
                    onCategoryChange={(value) => {
                        setCategoryFilter(value);
                    }}
                    bookingStatusFilter={bookingFilter}
                    onBookingStatusChange={setBookingFilter}
                    packageStatusFilter={packageStatusFilter}
                    onPackageStatusChange={setPackageStatusFilter}
                    staffModuleFilter={staffModuleFilter}
                    onStaffModuleChange={setStaffModuleFilter}
                    showBranchFilter={showBranchFilter}
                    branch={branch}
                    branchOptions={branchOptions}
                    onBranchChange={(value) => {
                        setBranch(value);
                    }}
                    onClear={() => {
                        setSearchQuery("");
                        setCategoryFilter("all");
                        setInventoryFilter("all");
                        setBookingFilter("all");
                        setPackageStatusFilter("all");
                        setStaffModuleFilter("all");
                        setStartDate(getMonthStart(getToday()));
                        setEndDate(getToday());
                        setExpandedInventoryId(null);

                        if (showBranchFilter) {
                            setBranch(ALL_BRANCHES);
                        }
                    }}
                />

                <section className="mt-4">
                    {selectedReport === "inventory" && (
                        <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
                            <section className="min-w-0 self-start overflow-hidden rounded-[14px] border border-[#E5DDEA] bg-white shadow-sm">
                                <div className="border-b border-[#ECE5F0] px-4 py-3.5">
                                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                                        {inventoryListTitle}
                                    </h2>
                                    <p className="mt-1 text-[11px] text-[#8A7A91]">
                                        {inventoryListSubtitle}
                                    </p>
                                </div>

                                <InventoryItemsTable
                                    items={displayedInventory}
                                    showBranchColumn={showBranchColumn}
                                    expandedInventoryId={expandedInventoryId}
                                    onToggleExpanded={(itemId) =>
                                        setExpandedInventoryId((current) =>
                                            current === itemId ? null : itemId
                                        )
                                    }
                                />

                            </section>

                            <aside className="self-start rounded-[14px] border border-[#E5DDEA] bg-white p-3 shadow-sm">
                                <h2 className="text-[16px] font-bold text-[#1A1220]">
                                    Inventory Summary
                                </h2>

                                <div className="mt-3 divide-y divide-[#EEE7F2]">
                                    {[
                                        {
                                            label: "Total Items",
                                            value: inventory.length,
                                            filter: "all" as InventoryFilter,
                                            dot: "bg-[#7A45E8]",
                                        },
                                        {
                                            label: "In Stock",
                                            value: inStock.length,
                                            filter: "in" as InventoryFilter,
                                            dot: "bg-[#22B65B]",
                                        },
                                        {
                                            label: "Low Stock",
                                            value: lowStock.length,
                                            filter: "low" as InventoryFilter,
                                            dot: "bg-[#FF8A00]",
                                        },
                                        {
                                            label: "Out of Stock",
                                            value: outOfStock.length,
                                            filter: "out" as InventoryFilter,
                                            dot: "bg-[#EF3E38]",
                                        },
                                        {
                                            label: "Soon to Expire",
                                            value: soonToExpire.length,
                                            filter: "soon" as InventoryFilter,
                                            dot: "bg-[#F6A800]",
                                        },
                                        {
                                            label: "Expired",
                                            value: expiredItems.length,
                                            filter: "expired" as InventoryFilter,
                                            dot: "bg-[#E32222]",
                                        },
                                    ].map((summary) => (
                                        <button
                                            key={summary.label}
                                            type="button"
                                            onClick={() => setInventoryFilter(summary.filter)}
                                            className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition hover:bg-[#FAF6FF] ${
                                                inventoryFilter ===
                                                summary.filter
                                                    ? "text-[#5C2FC0]"
                                                    : "text-[#392A42]"
                                            }`}
                                        >
                                                <span className="flex items-center gap-2 text-[11px] font-semibold">
                                                    <span
                                                        className={`h-2.5 w-2.5 rounded-full ${summary.dot}`}
                                                    />
                                                    {summary.label}
                                                </span>
                                            <span className="text-[12px] font-bold">
                                                    {formatNumber(summary.value)}
                                                </span>
                                        </button>
                                    ))}
                                </div>

                                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                                    <h3 className="text-[12px] font-bold text-[#211629]">
                                        Stock Status Breakdown
                                    </h3>
                                    <div className="mt-3 flex items-center gap-4">
                                        <div
                                            className="relative h-20 w-20 shrink-0 rounded-full"
                                            style={{
                                                background: `conic-gradient(
                                                        #22B65B 0 ${
                                                    (inStock.length /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }%,
                                                        #FF8A00 ${
                                                    (inStock.length /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }% ${
                                                    ((inStock.length +
                                                            lowStock.length) /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }%,
                                                        #EF3E38 ${
                                                    ((inStock.length +
                                                            lowStock.length) /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }% 100%
                                                    )`,
                                            }}
                                        >
                                            <span className="absolute inset-[14px] rounded-full bg-white" />
                                        </div>

                                        <div className="min-w-0 flex-1 space-y-2">
                                            {[
                                                {
                                                    label: "In Stock",
                                                    count: inStock.length,
                                                    dot: "bg-[#22B65B]",
                                                },
                                                {
                                                    label: "Low Stock",
                                                    count: lowStock.length,
                                                    dot: "bg-[#FF8A00]",
                                                },
                                                {
                                                    label: "Out of Stock",
                                                    count: outOfStock.length,
                                                    dot: "bg-[#EF3E38]",
                                                },
                                            ].map((item) => (
                                                <div
                                                    key={item.label}
                                                    className="flex items-center justify-between gap-2 text-[10px]"
                                                >
                                                        <span className="flex min-w-0 items-center gap-2 text-[#5F5267]">
                                                            <span
                                                                className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`}
                                                            />
                                                            <span className="truncate">
                                                                {item.label}
                                                            </span>
                                                        </span>
                                                    <span className="font-bold text-[#251A2C]">
                                                            {formatNumber(item.count)}
                                                        </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                                    <h3 className="text-[12px] font-bold text-[#211629]">
                                        Expiration Status Breakdown
                                    </h3>
                                    <div className="mt-3 flex items-center gap-4">
                                        <div
                                            className="relative h-20 w-20 shrink-0 rounded-full"
                                            style={{
                                                background: `conic-gradient(
                                                        #22B65B 0 ${
                                                    (goodExpirationItems.length /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }%,
                                                        #F6A800 ${
                                                    (goodExpirationItems.length /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }% ${
                                                    ((goodExpirationItems.length +
                                                            soonToExpire.length) /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }%,
                                                        #E32222 ${
                                                    ((goodExpirationItems.length +
                                                            soonToExpire.length) /
                                                        Math.max(
                                                            inventory.length,
                                                            1
                                                        )) *
                                                    100
                                                }% 100%
                                                    )`,
                                            }}
                                        >
                                            <span className="absolute inset-[14px] rounded-full bg-white" />
                                        </div>

                                        <div className="min-w-0 flex-1 space-y-2">
                                            {[
                                                {
                                                    label: "Good / No Expiry",
                                                    count:
                                                    goodExpirationItems.length,
                                                    dot: "bg-[#22B65B]",
                                                },
                                                {
                                                    label: "Soon to Expire",
                                                    count: soonToExpire.length,
                                                    dot: "bg-[#F6A800]",
                                                },
                                                {
                                                    label: "Expired",
                                                    count: expiredItems.length,
                                                    dot: "bg-[#E32222]",
                                                },
                                            ].map((item) => (
                                                <div
                                                    key={item.label}
                                                    className="flex items-center justify-between gap-2 text-[10px]"
                                                >
                                                        <span className="flex min-w-0 items-center gap-2 text-[#5F5267]">
                                                            <span
                                                                className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`}
                                                            />
                                                            <span className="truncate">
                                                                {item.label}
                                                            </span>
                                                        </span>
                                                    <span className="font-bold text-[#251A2C]">
                                                            {formatNumber(item.count)}
                                                        </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 border-t border-dashed border-[#E4D9EB] pt-4">
                                    <h3 className="text-[12px] font-bold text-[#211629]">
                                        All Categories
                                    </h3>
                                    <div className="mt-3 space-y-2">
                                        {inventoryCategorySummary.length > 0 ? (
                                            inventoryCategorySummary.map(
                                                (category) => (
                                                    <div
                                                        key={category.name}
                                                        className="grid grid-cols-[72px_1fr_auto] items-center gap-1.5 text-[9px]"
                                                    >
                                                            <span className="truncate text-[#5F5267]">
                                                                {category.name}
                                                            </span>
                                                        <span className="h-1.5 overflow-hidden rounded-full bg-[#EFE9F4]">
                                                                <span
                                                                    className="block h-full rounded-full bg-[#7041E5]"
                                                                    style={{
                                                                        width: `${
                                                                            (category.count /
                                                                                largestInventoryCategoryCount) *
                                                                            100
                                                                        }%`,
                                                                    }}
                                                                />
                                                            </span>
                                                        <span className="font-bold text-[#251A2C]">
                                                                {formatNumber(
                                                                    category.count
                                                                )}
                                                            </span>
                                                    </div>
                                                )
                                            )
                                        ) : (
                                            <p className="text-[10px] text-[#8A7A91]">
                                                No category data available.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <InventoryExportMenu
                                    onExportPdf={() =>
                                        exportPdf(getFilteredInventoryExportTable())
                                    }
                                    onExportXlsx={() =>
                                        exportExcel(getFilteredInventoryExportTable())
                                    }
                                    onExportDoc={() =>
                                        exportDoc(getFilteredInventoryExportTable())
                                    }
                                />
                            </aside>
                        </div>
                    )}

                    {selectedReport === "restock" && (
                        <RestockReportView
                            records={displayedRestocks}
                            showBranchColumn={showBranchColumn}
                        />
                    )}

                    {selectedReport === "bookings" && (
                        <BookingReportView
                            records={bookings}
                            searchQuery={searchQuery}
                            activeFilter={bookingFilter}
                            onFilterChange={setBookingFilter}
                            expandedBookingId={expandedBookingId}
                            onToggleExpanded={(bookingId) =>
                                setExpandedBookingId((current) =>
                                    current === bookingId ? null : bookingId
                                )
                            }
                            showBranchColumn={showBranchColumn}
                        />
                    )}

                    {selectedReport === "sales" && (
                        <PosReportView
                            records={displayedPosTransactions}
                            showBranchColumn={showBranchColumn}
                        />
                    )}

                    {selectedReport === "packages" && (
                        <PackagesReportView
                            records={displayedPackages}
                            showBranchColumn={showBranchColumn}
                        />
                    )}

                    {selectedReport === "forecasting" && (
                        <div className="mt-4 space-y-4">
                            <SectionCard
                                title="Forecasting Summary"
                                subtitle="Predicted demand monitoring, recommended restocks, and risk level."
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[850px] table-fixed text-sm">
                                        <thead>
                                        <tr className="border-b border-[#E6DDF0]">
                                            <th className="w-[22%] px-3 py-2 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">Product / Package</th>
                                            <th className="w-[21%] px-3 py-2 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">Current</th>
                                            <th className="w-[20%] px-3 py-2 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">Forecasted</th>
                                            <th className="w-[24%] px-3 py-2 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">Suggested Restock</th>
                                            <th className="w-[13%] px-3 py-2 text-right text-[11px] font-medium tracking-widest text-[#806A8C]">Risk</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {forecasts.map((item) => (
                                            <tr key={item.id} className="border-b border-[#EFE7F4] last:border-0">
                                                <td className="px-3 py-3 font-semibold text-[#1A1220]">{item.item}</td>
                                                <td className="px-3 py-3 text-[#6A5D6F]">{item.currentValue}</td>
                                                <td className="px-3 py-3 font-semibold text-[#1A1220]">{item.forecastedDemand}</td>
                                                <td className="px-3 py-3 text-[#6A5D6F]">{item.suggestedRestock}</td>
                                                <td className="px-3 py-3 text-right">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${riskClass(item.riskLevel)}`}>
                                  {item.riskLevel}
                                </span>
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            </SectionCard>

                            <SectionCard
                                title="Seasonal Demand Analysis"
                                subtitle="Expected trends and recommended preparation by season."
                            >
                                <div className="space-y-2">
                                    {seasons.map((item) => (
                                        <div key={item.period} className="rounded-lg border border-[#EFE7F4] px-3 py-3">
                                            <p className="text-sm font-semibold text-[#1A1220]">{item.period}</p>
                                            <p className="mt-1 text-sm text-[#4E2C66]">{item.trend}</p>
                                            <p className="mt-1 text-xs text-[#7A6A84]">{item.recommendation}</p>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {selectedReport === "staff" && (
                        <EmployeeActionsReportView
                            records={staffActivities}
                            searchQuery={searchQuery}
                            activeFilter={staffModuleFilter}
                            onFilterChange={setStaffModuleFilter}
                            showBranchColumn={showBranchColumn}
                        />
                    )}
                </section>
            </div>
        </div>
    );
}
