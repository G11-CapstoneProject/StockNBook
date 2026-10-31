import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export type CartMap = { [key: string]: number };

export type ProductVariant = {
    id: number;
    productId?: number | null;
    name: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
};

export type ProductVariantApiRaw = {
    id?: number | string;
    variantId?: number | string;
    variant_id?: number | string;
    productId?: number | string | null;
    product_id?: number | string | null;

    name?: string | null;
    variantName?: string | null;
    variant_name?: string | null;
    size?: string | null;

    variantValues?: Record<string, string> | string | null;
    variant_values?: Record<string, string> | string | null;
    values?: Record<string, string> | string | null;

    stock?: number | string;
    sellableStock?: number | string;
    alertLevel?: number | string;
    alert_level?: number | string;
    originalPrice?: number | string;
    original_price?: number | string;
    salesPrice?: number | string;
    sales_price?: number | string;
    expirationDate?: string | null;
    expiration_date?: string | null;
    expiryDate?: string | null;
    expiry_date?: string | null;
};

export type Product = {
    id: number;
    branchId?: number | null;
    branchName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
    variants?: ProductVariant[];
};

export type ProductApiRaw = {
    id: number | string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    branchName?: string | null;
    branch_name?: string | null;
    name: string;
    category: string;
    stock?: number | string;
    sellableStock?: number | string;
    alertLevel?: number | string;
    alert_level?: number | string;
    originalPrice?: number | string;
    original_price?: number | string;
    salesPrice?: number | string;
    sales_price?: number | string;
    expirationDate?: string | null;
    expiration_date?: string | null;
    expiryDate?: string | null;
    expiry_date?: string | null;
    variants?: ProductVariantApiRaw[];
};

export type BuyablePOSItem = {
    key: string;
    productId: number;
    variantId?: number | null;
    branchId?: number | null;
    productName: string;
    variantName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    expirationDate?: string | null;
    isVariant: boolean;
};

export type Category = {
    id: number;
    categoryName: string;
    description?: string;
};

export type Branch = {
    id: number;
    branchName: string;
};

export type RawBranch = {
    id?: number | string;
    branch_id?: number | string;
    branchId?: number | string;
    branchName?: string | null;
    branch_name?: string | null;
    name?: string | null;
};

export type ProductsApiResponse = {
    success?: boolean;
    products?: ProductApiRaw[];
    error?: string;
};

export type CategoryApiResponse = {
    success?: boolean;
    categories?: Category[];
    error?: string;
};

export type BranchesApiResponse = {
    branches?: RawBranch[];
    error?: string;
};

export type PosOrdersApiResponse = {
    success?: boolean;
    orders?: ApiOrder[];
    taxType?: string | null;
    taxRegistration?: string | null;
    pagination?: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasPrevious: boolean;
        hasMore: boolean;
    } | null;
    summary?: {
        transactions: number;
        sales: number;
        cost: number;
        profit: number;
        vat?: number; // Manager-only aggregate; financial costs remain Owner-only.
    } | null;
    error?: string;
};

export type OrderItem = {
    name: string;
    quantity: number;
    unitPrice?: number;
    lineTotal?: number;
    costPrice?: number;
};

export type Order = {
    id: string;
    controlNumber?: string | null;
    customer?: string;
    customerType?: string | null;
    customerAddress?: string | null;
    customerContactNumber?: string | null;
    items: OrderItem[];
    total: number;
    date: string;
    /** Full timestamp from orders.created_at, passed through by hooks/usePOS. */
    createdAt?: string | null;
    branchId?: number | null;
    branchName?: string | null;
    paymentMode?: string | null;
    taxType?: string | null;
    taxRegistration?: string | null;
    vatableSales?: number;
    vatAmount?: number;
    customerPayment?: number;
    totalPaid?: number;
    balance?: number;
    changeDue?: number;
    cashierId?: number | null;
    cashierName?: string | null;
    cashierRole?: string | null;

    // Calculated by the POS backend from the exact order_items rows.
    cost?: number;
    profit?: number;
};

export type ApiOrder = {
    orderId: string;
    controlNumber?: string | null;
    customerName?: string;
    customerType?: string | null;
    customerAddress?: string | null;
    customerContactNumber?: string | null;
    item?: string;
    /** Detailed line items from order_items; preferred over the legacy orders.item summary. */
    orderItems?: Array<{
        name?: string | null;
        quantity?: number | string | null;
        unitPrice?: number | string | null;
        lineTotal?: number | string | null;
        costPrice?: number | string | null;
    }> | null;
    total?: number;

    paymentMode?: string | null;
    taxType?: string | null;
    taxRegistration?: string | null;
    vatableSales?: number | string | null;
    vatAmount?: number | string | null;
    customerPayment?: number | string | null;
    totalPaid?: number | string | null;
    balance?: number | string | null;
    changeDue?: number | string | null;
    cashierId?: number | string | null;
    cashierName?: string | null;
    cashierRole?: string | null;

    totalCost?: number;
    total_cost?: number;
    profit?: number;

    orderDate: string;
    createdAt?: string;

    branchId?: number | string | null;
    branch_id?: number | string | null;

    branchName?: string | null;
    branch_name?: string | null;
    branch?: string | null;
};



export type CartItem = {
    key: string;
    productId: number;
    variantId?: number | null;
    branchId?: number | null;
    productName: string;
    variantName?: string | null;
    name: string;
    qty: number;
    price: number;
    lineTotal: number;
    stock: number;
    category: string;
    originalPrice: number;
    salesPrice: number;
    alertLevel: number;
    expirationDate?: string | null;
    isVariant: boolean;
};

export const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
    }).format(Number(n || 0));

function variantValuesToName(
    value?: Record<string, string> | string | null
): string {
    if (!value) return "";

    let parsed: Record<string, string> = {};

    if (typeof value === "string") {
        try {
            const json = JSON.parse(value);
            parsed = typeof json === "object" && json !== null ? json : {};
        } catch {
            return value.trim();
        }
    } else {
        parsed = value;
    }

    return Object.values(parsed)
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(" / ");
}

export const mapVariant = (
    v: ProductVariantApiRaw,
    productId: number
): ProductVariant => {
    const rawId = v.id ?? v.variantId ?? v.variant_id;

    const variantValuesName = variantValuesToName(
        v.variantValues ?? v.variant_values ?? v.values
    );

    const variantName =
        [
            v.name,
            v.variantName,
            v.variant_name,
            v.size,
            variantValuesName,
        ]
            .map((item) => String(item || "").trim())
            .find(Boolean) || "Variant";

    return {
        id: Number(rawId),
        productId: Number(v.productId ?? v.product_id ?? productId),
        name: variantName,
        stock: Number(v.sellableStock ?? v.stock ?? 0),
        alertLevel: Number(v.alertLevel ?? v.alert_level ?? 0),
        originalPrice: Number(v.originalPrice ?? v.original_price ?? 0),
        salesPrice: Number(v.salesPrice ?? v.sales_price ?? 0),
        expirationDate:
            v.expirationDate ??
            v.expiration_date ??
            v.expiryDate ??
            v.expiry_date ??
            null,
    };
};

export const mapProduct = (p: ProductApiRaw): Product => {
    const rawBranchId = p.branchId ?? p.branch_id ?? null;
    const productId = Number(p.id);

    return {
        id: productId,
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branchName: p.branchName ?? p.branch_name ?? null,
        name: String(p.name ?? ""),
        category: String(p.category ?? ""),
        stock: Number(p.sellableStock ?? p.stock ?? 0),
        alertLevel: Number(p.alertLevel ?? p.alert_level ?? 0),
        originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
        salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
        expirationDate:
            p.expirationDate ??
            p.expiration_date ??
            p.expiryDate ??
            p.expiry_date ??
            null,
        variants: Array.isArray(p.variants)
            ? p.variants
                .map((variant) => mapVariant(variant, productId))
                .filter((variant) => variant.id && variant.name)
            : [],
    };
};

export const productToBuyableItems = (product: Product): BuyablePOSItem[] => {
    const hasVariants =
        Array.isArray(product.variants) && product.variants.length > 0;

    if (hasVariants) {
        return product.variants!.map((variant) => ({
            key: `${product.id}-${variant.id}`,
            productId: product.id,
            variantId: variant.id,
            branchId: product.branchId,
            productName: product.name,
            variantName: variant.name,
            name: `${product.name}/${variant.name}`,
            category: product.category,
            stock: Number(variant.stock || 0),
            alertLevel: Number(variant.alertLevel || 0),
            originalPrice: Number(variant.originalPrice || 0),
            salesPrice: Number(variant.salesPrice || 0),
            expirationDate: variant.expirationDate || null,
            isVariant: true,
        }));
    }

    return [
        {
            key: String(product.id),
            productId: product.id,
            variantId: null,
            branchId: product.branchId,
            productName: product.name,
            variantName: null,
            name: product.name,
            category: product.category,
            stock: Number(product.stock || 0),
            alertLevel: Number(product.alertLevel || 0),
            originalPrice: Number(product.originalPrice || 0),
            salesPrice: Number(product.salesPrice || 0),
            expirationDate: product.expirationDate || null,
            isVariant: false,
        },
    ];
};

export const readProducts = (): Product[] => {
    try {
        if (typeof window === "undefined") return [];
        const raw = sessionStorage.getItem("stocknbook_inventory_products");
        const parsed = raw ? (JSON.parse(raw) as Product[]) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const readOrders = (): Order[] => {
    try {
        if (typeof window === "undefined") return [];
        const raw = sessionStorage.getItem("stocknbook_orders");
        const parsed = raw ? (JSON.parse(raw) as Order[]) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const readCategories = (): Category[] => {
    try {
        if (typeof window === "undefined") return [];
        const raw = sessionStorage.getItem("stocknbook_categories");
        const parsed = raw ? (JSON.parse(raw) as Category[]) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const readRole = (): string => {
    if (typeof window === "undefined") return "";
    return (sessionStorage.getItem("role") || "").toLowerCase();
};

export const readBranchId = (): string => {
    if (typeof window === "undefined") return "";
    return (
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id") ||
        ""
    );
};

export const readBranchName = (): string => {
    if (typeof window === "undefined") return "";
    return (
        sessionStorage.getItem("branch_name") ||
        sessionStorage.getItem("stocknbook_branch_name") ||
        ""
    );
};

export function StatCard({
                             label,
                             value,
                             helper,
                             icon,
                             iconClassName = "bg-[#F0E9FF] text-[#5A35A5]",
                             valueClassName = "text-[#1A1220]",
                         }: {
    label: string;
    value: string | number;
    helper: string;
    icon: ReactNode;
    iconClassName?: string;
    valueClassName?: string;
}) {
    return (
        <section className="flex min-h-[128px] items-center gap-4 rounded-[18px] border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClassName}`}>
                {icon}
            </span>
            <div className="min-w-0">
                <h2 className="text-[14px] font-medium text-[#2B174C]">{label}</h2>
                <p className={`mt-0.5 break-words text-[26px] font-bold leading-tight ${valueClassName}`}>{value}</p>
                <p className="mt-1 text-xs text-[#806A8C]">{helper}</p>
            </div>
        </section>
    );
}

/** The POS timestamp is saved in orders.created_at. Display clock time only for Today's Orders. */
export function formatPOSOrderTime(order: Pick<Order, "createdAt" | "date">): string {
    const raw = String(order.createdAt || "").trim();
    // Previous APIs can return ISO UTC times with Z or an explicit offset.
    if (raw && /(?:Z|[+-]\d\d:?\d\d)$/.test(raw)) {
        const timestamp = new Date(raw);
        if (!Number.isNaN(timestamp.getTime())) {
            return timestamp.toLocaleTimeString("en-PH", {
                timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true,
            });
        }
    }
    // Our current POS Lambda returns MySQL clock time as YYYY-MM-DD HH:mm:ss.
    const local = raw.match(/[T\s](\d{1,2}):(\d{2})/);
    if (local) {
        const hour24 = Number(local[1]);
        if (hour24 >= 0 && hour24 <= 23) {
            return `${hour24 % 12 || 12}:${local[2]} ${hour24 >= 12 ? "PM" : "AM"}`;
        }
    }
    // Support existing hook mappings that retain a complete datetime in date.
    const fallback = String(order.date || "");
    const clock = fallback.match(/[T\s](\d{1,2}):(\d{2})/);
    if (clock) {
        const hour24 = Number(clock[1]);
        if (hour24 >= 0 && hour24 <= 23) {
            return `${hour24 % 12 || 12}:${clock[2]} ${hour24 >= 12 ? "PM" : "AM"}`;
        }
    }
    return "—"; // Never invent a time if hooks/usePOS did not pass createdAt.
}

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

export function POSLayout({
                              role,
                              isOwner,
                              activeBranchName,
                              onRefresh,
                              children,
                          }: {
    role: string;
    isOwner: boolean;
    activeBranchName: string;
    onRefresh: () => void | Promise<void>;
    children: ReactNode;
}) {
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();

        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);
    return (
        <div
            className="flex min-h-screen font-sans text-[#1A1220]"
            style={{ backgroundColor: "#FDFAF4" }}
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-x-hidden font-sans">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex items-center justify-between px-6 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                {role === "owner" ? "Sales History & Audit" : role === "manager" ? "Branch Sales" : "POS Register"}
                            </h1>

                            <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">
                                {isOwner
                                    ? "Sales Overview"
                                    : activeBranchName || "Assigned Branch"}
                            </span>
                        </div>

                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime
                                    ? formatCurrentDateTime(currentDateTime)
                                    : "Loading date..."}
                            </span>

                            <button
                                onClick={() => void onRefresh()}
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                title="Refresh"
                                type="button"
                            >
                                <RefreshCw size={14} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <div className="px-6 py-4">{children}</div>
            </main>
        </div>
    );
}

/** Show a customer classification, never a personal name. Legacy POS records may have NULL customer_type. */
export function formatPOSCustomerType(order: Pick<Order, "id" | "customer" | "customerType">): string {
    const explicitType = String(order.customerType || "").trim().toUpperCase();
    if (explicitType === "WALK_IN" || explicitType === "WALK-IN" || explicitType === "WALKIN") return "Walk-in";
    if (explicitType === "BOOKING") return "Booking";
    if (explicitType) return explicitType.replace(/_/g, " ");

    // Older POS records were created before customer_type was populated.
    const orderId = String(order.id || "").toUpperCase();
    const customer = String(order.customer || "").trim().toLowerCase();
    if (orderId.includes("-POS-") && ["walk-in", "walk-in customer"].includes(customer)) return "Walk-in";
    return "Unclassified";
}

export function OrdersTable({
                                title,
                                subtitle,
                                orders,
                                emptyText = "No orders yet.",
                                showBranch = false,
                                showCustomerType = false,
                                showPayment = false,
                                showTimeOnly = false,
                                getBranchName,
                                containerClassName = "",
                                scrollAreaClassName = "",
                                stickyHeader = false,
                                allowHorizontalScroll = true,
                                renderActions,
                            }: {
    title: string;
    subtitle: string;
    orders: Order[];
    emptyText?: string;
    showBranch?: boolean;
    showCustomerType?: boolean;
    showPayment?: boolean;
    showTimeOnly?: boolean;
    getBranchName?: (order: Order) => string;
    containerClassName?: string;
    scrollAreaClassName?: string;
    stickyHeader?: boolean;
    allowHorizontalScroll?: boolean;
    renderActions?: (order: Order) => ReactNode;
}) {
    return (
        <section
            className={`overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm ${containerClassName}`}
        >
            <div className="border-b border-[#E6DDF0] bg-white px-3 py-3">
                <h3 className="text-[16px] font-bold text-[#1A1220]">
                    {title}
                </h3>

                <p className="mt-0.5 text-xs text-[#7A6A84]">
                    {subtitle}
                </p>
            </div>

            <div
                className={`w-full ${
                    allowHorizontalScroll ? "overflow-x-auto" : "overflow-x-hidden"
                } ${scrollAreaClassName}`}
            >
                <table
                    className={`w-full table-fixed text-sm ${
                        showBranch || showCustomerType || showPayment ? "min-w-[960px]" : ""
                    }`}
                >
                    {showBranch && (
                        <colgroup>
                            <col className="w-[21%]" />
                            <col className="w-[16%]" />
                            <col className="w-[33%]" />
                            <col className="w-[14%]" />
                            <col className="w-[16%]" />
                        </colgroup>
                    )}

                    <thead className={stickyHeader ? "sticky top-0 z-10 bg-white" : ""}>
                    <tr className="border-b border-[#E6DDF0]">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Order ID
                        </th>

                        {showBranch && (
                            <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                Branch
                            </th>
                        )}

                        {showCustomerType && (
                            <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">Customer Type</th>
                        )}

                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Items
                        </th>

                        {showPayment && (
                            <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">Payment</th>
                        )}

                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Total
                        </th>

                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            {showTimeOnly ? "Time" : "Date"}
                        </th>

                        {renderActions && (
                            <th className="px-4 py-3 text-center text-xs font-semibold text-[#806A8C]">
                                Actions
                            </th>
                        )}
                    </tr>
                    </thead>

                    <tbody>
                    {orders.length === 0 ? (
                        <tr>
                            <td
                                colSpan={(showBranch ? 5 : 4) + (showCustomerType ? 1 : 0) + (showPayment ? 1 : 0) + (renderActions ? 1 : 0)}
                                className="px-4 py-10 text-center text-sm text-[#9B8AAA]"
                            >
                                {emptyText}
                            </td>
                        </tr>
                    ) : (
                        orders.map((order) => (
                            <tr
                                key={order.id}
                                className="border-b border-[#EFE7F4] last:border-0 hover:bg-[#FFFCF7]"
                            >
                                <td className="truncate px-4 py-3 text-xs font-semibold text-[#5F4E75]">
                                    {order.id}
                                </td>

                                {showBranch && (
                                    <td className="truncate px-4 py-3 text-sm text-[#7A6A84]">
                                        {getBranchName?.(order) ||
                                            order.branchName ||
                                            "—"}
                                    </td>
                                )}

                                {showCustomerType && (
                                    <td className="truncate px-4 py-3 text-sm text-[#5F4E75]">
                                        {formatPOSCustomerType(order)}
                                    </td>
                                )}

                                <td className="px-4 py-3 text-sm text-[#7A6A84]">
                                    {Array.isArray(order.items) &&
                                    order.items.length > 0 ? (
                                        <div className="space-y-1">
                                            {order.items.map((item, index) => (
                                                <div
                                                    key={`${item.name}-${index}`}
                                                    className="truncate"
                                                >
                                                    {item.name} × {item.quantity}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        "—"
                                    )}
                                </td>

                                {showPayment && (
                                    <td className="truncate px-4 py-3 text-sm text-[#5F4E75]">
                                        {({ CASH: "Cash", GCASH: "GCash", BANK_TRANSFER: "Bank Transfer",  } as Record<string, string>)[String(order.paymentMode || "CASH").toUpperCase()] || "—"}
                                    </td>
                                )}

                                <td className="truncate px-4 py-3 text-sm font-bold text-[#1A1220]">
                                    {peso(order.total)}
                                </td>

                                <td className="truncate px-4 py-3 text-sm text-[#7A6A84]">
                                    {showTimeOnly ? formatPOSOrderTime(order) : order.date}
                                </td>

                                {renderActions && (
                                    <td className="px-4 py-3 text-center">
                                        {renderActions(order)}
                                    </td>
                                )}
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}