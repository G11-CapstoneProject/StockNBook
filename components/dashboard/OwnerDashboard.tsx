"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    BarChart3,
    CalendarDays,
    Download,
    TriangleAlert,
    Gift,
    RefreshCw,
    Star,
} from "lucide-react";

type Branch = {
    id: number;
    branchName: string;
    managerName?: string;
};

type Booking = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string | null;
    branch_name?: string | null;
    name: string;
    date?: string;
    status?: string;
    packageName?: string;
    eventName?: string;
};

type OrderItem = {
    name?: string;
    quantity?: number;
    salesPrice?: number;
    sales_price?: number;
    sellingPrice?: number;
    selling_price?: number;
    price?: number;
    originalPrice?: number;
    original_price?: number;
    costPrice?: number;
    cost_price?: number;
};

type Order = {
    id?: string;
    orderId?: string;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string | null;
    branch_name?: string | null;
    total?: number;
    date?: string;
    orderDate?: string;
    createdAt?: string;
    item?: string;
    items?: OrderItem[];
};

type Product = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string | null;
    branch_name?: string | null;
    name: string;
    category?: string;
    stock?: number;
    alertLevel?: number;
    salesPrice?: number;
    sales_price?: number;
    sellingPrice?: number;
    selling_price?: number;
    price?: number;
    originalPrice?: number;
    original_price?: number;
    costPrice?: number;
    cost_price?: number;
};

type BranchManager = {
    id?: number;
    managerId?: number;
    branchId?: number;
    branch_id?: number;
    name?: string;
    managerName?: string;
    manager_name?: string;
    status?: string;
};

function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}

function getUserValue(user: unknown, key: string) {
    if (!user || typeof user !== "object") return "";
    return String((user as Record<string, unknown>)[key] ?? "");
}


function downloadCsv(
    filename: string,
    headers: string[],
    rows: Array<Array<string | number | null | undefined>>,
) {
    const escapeCell = (value: string | number | null | undefined) => {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
    };

    const csvContent = [headers, ...rows]
        .map((row) => row.map(escapeCell).join(","))
        .join("\n");

    const blob = new Blob(["\uFEFF", csvContent], {
        type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}


function peso(value: number) {
    return `₱${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function formatDashboardDate(value?: string) {
    if (!value) return { dateLabel: "—", timeLabel: "" };

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return {
            dateLabel: value.slice(0, 10),
            timeLabel: value.length > 10 ? value.slice(11, 16) : "",
        };
    }

    return {
        dateLabel: parsed.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }),
        timeLabel: parsed.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        }),
    };
}

function formatCurrentDashboardDateTime(value: Date) {
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

type ApiRecord = Record<string, unknown>;

function toRecord(value: unknown): ApiRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as ApiRecord)
        : {};
}

function firstDefined(record: ApiRecord, keys: string[]) {
    for (const key of keys) {
        const value = record[key];

        if (value !== null && value !== undefined) {
            return value;
        }
    }

    return undefined;
}

function readText(record: ApiRecord, keys: string[], fallback = "") {
    const value = firstDefined(record, keys);

    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);

    return fallback;
}

function readNumber(record: ApiRecord, keys: string[], fallback = 0) {
    const value = firstDefined(record, keys);
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
}

function readNullableNumber(record: ApiRecord, keys: string[]) {
    const value = firstDefined(record, keys);

    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBranch(value: unknown): Branch {
    const raw = toRecord(value);

    return {
        id: readNumber(raw, ["id", "branch_id", "branchId"]),
        branchName: readText(
            raw,
            ["branchName", "branch_name", "name", "branch"],
            "Unnamed Branch",
        ),
        managerName: readText(raw, ["managerName", "manager_name", "manager"]),
    };
}

function normalizeBooking(value: unknown): Booking {
    const raw = toRecord(value);
    const rawBranchId = readNullableNumber(raw, ["branchId", "branch_id"]);

    return {
        id: readNumber(raw, ["id", "booking_id"]),
        branchId: rawBranchId,
        branch_id: rawBranchId,
        branchName: readText(raw, ["branchName", "branch_name"]) || null,
        branch_name: readText(raw, ["branch_name", "branchName"]) || null,
        name: readText(raw, ["name", "customer_name"], "Unnamed Client"),
        date: readText(raw, ["date", "event_date", "created_at"]),
        status: readText(raw, ["status"], "Pending Review"),
        packageName: readText(raw, [
            "packageName",
            "package_name",
            "package",
            "package_title",
            "service_name",
        ]),
        eventName: readText(raw, [
            "eventName",
            "event_name",
            "event",
            "event_type",
        ]),
    };
}

function parseOrderItems(itemText?: string): OrderItem[] {
    if (!itemText) return [];

    return itemText
        .split(",")
        .map((item) => {
            const [name, qty] = item.split(" x");

            return {
                name: name?.trim() || "",
                quantity: Number(qty || 0),
            };
        })
        .filter((item) => item.name);
}

function normalizeOrderItem(value: unknown): OrderItem {
    const raw = toRecord(value);

    return {
        name: readText(raw, ["name", "productName", "product_name"]),
        quantity: readNumber(raw, ["quantity", "qty"]),
        salesPrice: readNumber(raw, ["salesPrice", "sales_price"]),
        sales_price: readNumber(raw, ["sales_price", "salesPrice"]),
        sellingPrice: readNumber(raw, ["sellingPrice", "selling_price"]),
        selling_price: readNumber(raw, ["selling_price", "sellingPrice"]),
        price: readNumber(raw, ["price"]),
        originalPrice: readNumber(raw, ["originalPrice", "original_price"]),
        original_price: readNumber(raw, ["original_price", "originalPrice"]),
        costPrice: readNumber(raw, ["costPrice", "cost_price"]),
        cost_price: readNumber(raw, ["cost_price", "costPrice"]),
    };
}

function normalizeOrder(value: unknown): Order {
    const raw = toRecord(value);
    const rawBranchId = readNullableNumber(raw, ["branchId", "branch_id"]);
    const itemText = readText(raw, ["item"]);
    const rawItems = firstDefined(raw, ["items"]);
    const items = Array.isArray(rawItems)
        ? rawItems.map(normalizeOrderItem).filter((item) => item.name)
        : parseOrderItems(itemText);

    return {
        id: readText(raw, ["id", "orderId", "order_id"]) || undefined,
        orderId: readText(raw, ["orderId", "order_id", "id"]) || undefined,
        branchId: rawBranchId,
        branch_id: rawBranchId,
        branchName: readText(raw, ["branchName", "branch_name"]) || null,
        branch_name: readText(raw, ["branch_name", "branchName"]) || null,
        total: readNumber(raw, ["total"]),
        date: readText(raw, [
            "date",
            "orderDate",
            "order_date",
            "createdAt",
            "created_at",
        ]),
        orderDate: readText(raw, ["orderDate", "order_date", "date"]),
        createdAt: readText(raw, ["createdAt", "created_at"]),
        item: itemText,
        items,
    };
}

function normalizeProduct(value: unknown): Product {
    const raw = toRecord(value);
    const rawBranchId = readNullableNumber(raw, ["branchId", "branch_id"]);

    const sellingPrice = readNumber(raw, [
        "salesPrice",
        "sales_price",
        "sellingPrice",
        "selling_price",
        "price",
    ]);

    const originalPrice = readNumber(raw, [
        "originalPrice",
        "original_price",
        "costPrice",
        "cost_price",
        "origPrice",
        "orig_price",
    ]);

    return {
        id: readNumber(raw, ["id"]),
        branchId: rawBranchId,
        branch_id: rawBranchId,
        branchName: readText(raw, ["branchName", "branch_name"]) || null,
        branch_name: readText(raw, ["branch_name", "branchName"]) || null,
        name: readText(raw, ["name"]),
        category: readText(raw, ["category"]),
        stock: readNumber(raw, ["stock"]),
        alertLevel: readNumber(raw, ["alertLevel", "alert_level"]),
        salesPrice: sellingPrice,
        sales_price: sellingPrice,
        sellingPrice: sellingPrice,
        selling_price: sellingPrice,
        price: sellingPrice,
        originalPrice,
        original_price: originalPrice,
        costPrice: originalPrice,
        cost_price: originalPrice,
    };
}

function getBranchNameFromId(branches: Branch[], branchId?: number | null) {
    if (!branchId) return "";
    return (
        branches.find((branch) => Number(branch.id) === Number(branchId))
            ?.branchName || ""
    );
}

export default function OwnerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [bookingsError, setBookingsError] = useState("");
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [managers, setManagers] = useState<BranchManager[]>([]);
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showStockAlertsModal, setShowStockAlertsModal] = useState(false);
    const [stockAlertFilter, setStockAlertFilter] = useState<
        "all" | "low" | "out"
    >("all");

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentDateTime(new Date());
        }, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const loadOwnerDashboard = useCallback(async () => {
        const token = getSavedItem("token");
        const storeId =
            getSavedItem("store_id") || getSavedItem("stocknbook_store_id");

        if (!token) return;

        setIsRefreshing(true);

        try {
            try {
                const branchesRes = await fetch("/api/branches", {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const branchesData = await branchesRes.json().catch(() => ({}));

                if (branchesRes.ok && Array.isArray(branchesData.branches)) {
                    setBranches(branchesData.branches.map(normalizeBranch));
                }
            } catch (error) {
                console.warn("Owner dashboard branches fetch failed:", error);
            }

            try {
                setBookingsError("");

                const bookingsRes = await fetch("/api/bookings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_dashboard_bookings",
                        role: "owner",
                        store_id: storeId ? Number(storeId) : undefined,
                    }),
                    cache: "no-store",
                });

                const bookingsText = await bookingsRes.text();
                const bookingsData: {
                    bookings?: unknown[];
                    error?: unknown;
                    message?: unknown;
                    details?: unknown;
                } = bookingsText ? JSON.parse(bookingsText) : {};

                if (!bookingsRes.ok) {
                    const message = String(
                        bookingsData.error ||
                        bookingsData.message ||
                        "Unable to load booking data.",
                    );

                    console.error("Owner dashboard bookings request failed:", {
                        status: bookingsRes.status,
                        response: bookingsData,
                    });
                    setBookings([]);
                    setBookingsError(message);
                } else if (Array.isArray(bookingsData.bookings)) {
                    setBookings(bookingsData.bookings.map(normalizeBooking));
                } else {
                    setBookings([]);
                    setBookingsError("Bookings API returned an invalid response.");
                }
            } catch (error) {
                console.error("Owner dashboard bookings fetch failed:", error);
                setBookings([]);
                setBookingsError(
                    error instanceof Error
                        ? error.message
                        : "Unable to load booking data.",
                );
            }

            try {
                const productsRes = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_products",
                    }),
                });

                const productsData = await productsRes.json().catch(() => ({}));

                if (productsRes.ok && Array.isArray(productsData.products)) {
                    setProducts(productsData.products.map(normalizeProduct));
                }
            } catch (error) {
                console.warn("Owner dashboard products fetch failed:", error);
            }

            try {
                const ordersRes = await fetch("/api/pos", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_orders",
                    }),
                });

                const ordersData = await ordersRes.json().catch(() => ({}));

                if (ordersRes.ok && Array.isArray(ordersData.orders)) {
                    setOrders(ordersData.orders.map(normalizeOrder));
                }
            } catch (error) {
                console.warn("Owner dashboard orders fetch failed:", error);
            }

            try {
                const managerRes = await fetch("/api/branch-managers", {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    cache: "no-store",
                });

                const managerData = await managerRes.json().catch(() => ({}));

                if (managerRes.ok && Array.isArray(managerData.managers)) {
                    setManagers(managerData.managers);
                } else if (managerRes.ok && Array.isArray(managerData.branchManagers)) {
                    setManagers(managerData.branchManagers);
                }
            } catch (error) {
                console.warn("Owner dashboard managers fetch failed:", error);
            }
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        // Load the dashboard once when the page opens.
        // After that, data refreshes only when the user presses Refresh.
        void loadOwnerDashboard();
    }, [loadOwnerDashboard]);

    const totalSales = orders.reduce(
        (sum, order) => sum + Number(order.total || 0),
        0,
    );

    const activeManagers =
        managers.length > 0
            ? managers.filter((manager) => {
                const status = String(manager.status || "").toLowerCase();
                return status !== "inactive" && status !== "disabled";
            }).length
            : branches.filter((branch) => branch.managerName).length;

    const branchStats = useMemo(() => {
        return branches.map((branch) => {
            const branchProducts = products.filter((product) => {
                const productBranchId = product.branchId ?? product.branch_id;
                const productBranchName = product.branchName ?? product.branch_name;

                return (
                    String(productBranchId || "") === String(branch.id) ||
                    String(productBranchName || "").toLowerCase() ===
                    branch.branchName.toLowerCase()
                );
            });

            const productNames = new Set(
                branchProducts.map((product) => product.name.trim().toLowerCase()),
            );

            const branchOrders = orders.filter((order) => {
                const orderBranchId = order.branchId ?? order.branch_id;
                const orderBranchName = order.branchName ?? order.branch_name;

                if (orderBranchId) {
                    return String(orderBranchId) === String(branch.id);
                }

                if (orderBranchName) {
                    return (
                        String(orderBranchName).toLowerCase() ===
                        branch.branchName.toLowerCase()
                    );
                }

                return (order.items || []).some((item) =>
                    productNames.has((item.name || "").trim().toLowerCase()),
                );
            });

            return {
                branch,
                revenue: branchOrders.reduce(
                    (sum, order) => sum + Number(order.total || 0),
                    0,
                ),
            };
        });
    }, [branches, orders, products]);

    const topPerformingBranches = useMemo(
        () =>
            [...branchStats]
                .sort((first, second) => second.revenue - first.revenue)
                .slice(0, 3),
        [branchStats],
    );

    const popularItems = useMemo(() => {
        const itemMap = orders.reduce<
            Record<string, { name: string; quantity: number }>
        >((accumulator, order) => {
            (order.items || []).forEach((item) => {
                const name = item.name?.trim() || "Unnamed item";

                if (!accumulator[name]) {
                    accumulator[name] = { name, quantity: 0 };
                }

                accumulator[name].quantity += Number(item.quantity || 0);
            });

            return accumulator;
        }, {});

        return Object.values(itemMap)
            .sort((first, second) => second.quantity - first.quantity)
            .slice(0, 3);
    }, [orders]);

    const mostBookedPackages = useMemo(() => {
        const packageMap = bookings.reduce<
            Record<string, { name: string; quantity: number }>
        >((accumulator, booking) => {
            const packageName = booking.packageName?.trim() || "Package booking";

            if (!accumulator[packageName]) {
                accumulator[packageName] = { name: packageName, quantity: 0 };
            }

            accumulator[packageName].quantity += 1;
            return accumulator;
        }, {});

        return Object.values(packageMap)
            .sort((first, second) => second.quantity - first.quantity)
            .slice(0, 3);
    }, [bookings]);

    const maxBranchRevenue = Math.max(
        ...topPerformingBranches.map((item) => item.revenue),
        1,
    );
    const maxPopularQuantity = Math.max(
        ...popularItems.map((item) => item.quantity),
        1,
    );
    const maxPackageBookings = Math.max(
        ...mostBookedPackages.map((item) => item.quantity),
        1,
    );

    const upcomingBookings = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return [...bookings]
            .filter((booking) => {
                const status = String(booking.status || "").toLowerCase();
                const schedule = new Date(booking.date || "");

                return (
                    !["completed", "cancelled", "canceled"].includes(status) &&
                    !Number.isNaN(schedule.getTime()) &&
                    schedule.getTime() >= today.getTime()
                );
            })
            .sort(
                (first, second) =>
                    new Date(first.date || 0).getTime() -
                    new Date(second.date || 0).getTime(),
            )
            .slice(0, 3);
    }, [bookings]);

    const allInventoryAlerts = useMemo(
        () =>
            products
                .filter(
                    (product) =>
                        Number(product.stock || 0) <= Number(product.alertLevel || 0),
                )
                .sort(
                    (first, second) =>
                        Number(first.stock || 0) - Number(second.stock || 0),
                ),
        [products],
    );

    const inventoryAlerts = allInventoryAlerts.slice(0, 3);
    const lowStockAlertCount = allInventoryAlerts.filter(
        (product) => Number(product.stock || 0) > 0,
    ).length;
    const outOfStockAlertCount = allInventoryAlerts.filter(
        (product) => Number(product.stock || 0) <= 0,
    ).length;
    const visibleStockAlerts = allInventoryAlerts.filter((product) => {
        if (stockAlertFilter === "low") return Number(product.stock || 0) > 0;
        if (stockAlertFilter === "out") return Number(product.stock || 0) <= 0;
        return true;
    });

    // Keep the existing manager loading behavior available without displaying
    // an extra owner-dashboard card that is not present in the reference layout.
    void activeManagers;

    const firstName =
        getUserValue(user, "first_name") || getUserValue(user, "firstName");
    const lastName =
        getUserValue(user, "last_name") || getUserValue(user, "lastName");
    const dashboardUserName =
        getUserValue(user, "full_name") ||
        getUserValue(user, "fullName") ||
        getUserValue(user, "name") ||
        [firstName, lastName].filter(Boolean).join(" ") ||
        getUserValue(user, "username") ||
        getSavedItem("full_name") ||
        getSavedItem("name") ||
        getSavedItem("username") ||
        "User";
    const dashboardStoreName =
        getUserValue(user, "store_name") ||
        getUserValue(user, "storeName") ||
        getUserValue(user, "business_name") ||
        getUserValue(user, "businessName") ||
        getSavedItem("store_name") ||
        getSavedItem("storeName") ||
        getSavedItem("stocknbook_store_name") ||
        getSavedItem("business_name") ||
        "your store";
    const currentMonthLabel = currentDateTime.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                            Welcome to Dashboard, {dashboardUserName}
                        </h1>
                        <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                            Here&apos;s an overview of {dashboardStoreName} business performance for {currentMonthLabel}.
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {formatCurrentDashboardDateTime(currentDateTime)}
                        </span>

                        <button
                            type="button"
                            onClick={() => void loadOwnerDashboard()}
                            disabled={isRefreshing}
                            aria-label="Refresh dashboard details"
                            title="Refresh dashboard details"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw
                                size={16}
                                className={isRefreshing ? "animate-spin" : ""}
                            />
                            {isRefreshing ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-6 py-5 font-sans">
                <div className="mx-auto max-w-none space-y-3.5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <OwnerStatCard
                            title="Total Branches"
                            value={String(branches.length)}
                        />
                        <OwnerStatCard
                            title="Total Sales"
                            value={peso(totalSales)}
                        />
                        <OwnerStatCard
                            title="Total Booking"
                            value={bookingsError ? "Unavailable" : String(bookings.length)}
                        />
                        <OwnerStatCard
                            title="Total Products"
                            value={String(products.length)}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                        <OwnerDashboardCard className="flex flex-col">
                            <OwnerCardHeader
                                title="Top Performing Branches"
                                icon={<BarChart3 size={16} strokeWidth={1.9} />}
                                action="View all"
                                onAction={() => router.push("/analytics")}
                                onDownload={() =>
                                    downloadCsv(
                                        "top-performing-branches.csv",
                                        ["Branch", "Sales"],
                                        topPerformingBranches.map((item) => [
                                            item.branch.branchName,
                                            item.revenue,
                                        ]),
                                    )
                                }
                            />

                            {topPerformingBranches.length === 0 ? (
                                <OwnerEmptyState text="No branch sales data yet." />
                            ) : (
                                <div className="flex-1">
                                    {topPerformingBranches.map((item) => (
                                        <OwnerRankedProgress
                                            key={item.branch.id}
                                            label={item.branch.branchName}
                                            value={peso(item.revenue)}
                                            percent={(item.revenue / maxBranchRevenue) * 100}
                                        />
                                    ))}
                                </div>
                            )}
                        </OwnerDashboardCard>

                        <OwnerDashboardCard className="flex flex-col">
                            <OwnerCardHeader
                                title="Popular Items"
                                icon={<Star size={16} strokeWidth={1.9} fill="currentColor" />}
                                action="View all"
                                onAction={() => router.push("/analytics")}
                                onDownload={() =>
                                    downloadCsv(
                                        "popular-items.csv",
                                        ["Product", "Units Sold"],
                                        popularItems.map((item) => [item.name, item.quantity]),
                                    )
                                }
                            />

                            {popularItems.length === 0 ? (
                                <OwnerEmptyState text="No popular item data yet." />
                            ) : (
                                <div className="flex-1">
                                    {popularItems.map((item) => (
                                        <OwnerRankedProgress
                                            key={item.name}
                                            label={item.name}
                                            value={`${item.quantity} sold`}
                                            percent={(item.quantity / maxPopularQuantity) * 100}
                                        />
                                    ))}
                                </div>
                            )}
                        </OwnerDashboardCard>

                        <OwnerDashboardCard className="flex flex-col">
                            <OwnerCardHeader
                                title="Most Booked Packages"
                                icon={<Gift size={16} strokeWidth={1.9} />}
                                action="View all"
                                onAction={() => router.push("/analytics")}
                                onDownload={() =>
                                    downloadCsv(
                                        "most-booked-packages.csv",
                                        ["Package", "Bookings"],
                                        mostBookedPackages.map((item) => [
                                            item.name,
                                            item.quantity,
                                        ]),
                                    )
                                }
                            />

                            {mostBookedPackages.length === 0 ? (
                                <OwnerEmptyState text={bookingsError || "No package bookings yet."} />
                            ) : (
                                <div className="flex-1">
                                    {mostBookedPackages.map((item) => (
                                        <OwnerRankedProgress
                                            key={item.name}
                                            label={item.name}
                                            value={`${item.quantity} booking${
                                                item.quantity === 1 ? "" : "s"
                                            }`}
                                            percent={(item.quantity / maxPackageBookings) * 100}
                                        />
                                    ))}
                                </div>
                            )}
                        </OwnerDashboardCard>
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <OwnerDashboardCard className="overflow-hidden !rounded-[12px] !p-0 font-sans shadow-[0_6px_18px_rgba(45,27,78,0.06)]">
                            <div className="border-b border-[#F0ECF5]">
                                <OwnerTableCardHeader
                                    title="Upcoming Bookings"
                                    subtitle="Upcoming reservations across all branches"
                                    action="View all"
                                    onAction={() => router.push("/bookings")}
                                    onDownload={() =>
                                        downloadCsv(
                                            "upcoming-bookings.csv",
                                            [
                                                "Customer",
                                                "Event",
                                                "Branch",
                                                "Schedule",
                                                "Package",
                                                "Status",
                                            ],
                                            upcomingBookings.map((booking) => [
                                                booking.name,
                                                booking.eventName || "Booking reservation",
                                                booking.branchName ||
                                                booking.branch_name ||
                                                getBranchNameFromId(
                                                    branches,
                                                    booking.branchId ?? booking.branch_id,
                                                ) ||
                                                "Branch",
                                                booking.date || "",
                                                booking.packageName || "Package booking",
                                                booking.status || "Pending Review",
                                            ]),
                                        )
                                    }
                                    tone="violet"
                                />
                            </div>

                            {upcomingBookings.length === 0 ? (
                                <div className="px-4 py-4">
                                    <OwnerEmptyState text={bookingsError || "No upcoming bookings yet."} />
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-hidden">
                                        <table className="w-full table-fixed border-collapse">
                                            <colgroup>
                                                <col className="w-[31%]" />
                                                <col className="w-[18%]" />
                                                <col className="w-[18%]" />
                                                <col className="w-[20%]" />
                                                <col className="w-[13%]" />
                                            </colgroup>
                                            <thead>
                                            <tr className="border-b border-[#F1EDF5] bg-[#FBFAFD]">
                                                <th className="px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Customer / Event
                                                </th>
                                                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Branch
                                                </th>
                                                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Schedule
                                                </th>
                                                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Package
                                                </th>
                                                <th className="px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Status
                                                </th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {upcomingBookings.map((booking) => (
                                                <OwnerBookingTableRow
                                                    key={booking.id}
                                                    booking={booking}
                                                    branchName={
                                                        booking.branchName ||
                                                        booking.branch_name ||
                                                        getBranchNameFromId(
                                                            branches,
                                                            booking.branchId ?? booking.branch_id,
                                                        ) ||
                                                        "Branch"
                                                    }
                                                />
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </OwnerDashboardCard>

                        <OwnerDashboardCard className="overflow-hidden !rounded-[12px] !p-0 font-sans shadow-[0_6px_18px_rgba(45,27,78,0.06)]">
                            <div className="border-b border-[#F0ECF5]">
                                <OwnerTableCardHeader
                                    title="Inventory Alerts"
                                    subtitle="Products that need attention or restocking"
                                    action="View all"
                                    onAction={() => {
                                        setStockAlertFilter("all");
                                        setShowStockAlertsModal(true);
                                    }}
                                    onDownload={() =>
                                        downloadCsv(
                                            "inventory-alerts.csv",
                                            [
                                                "Product",
                                                "Branch",
                                                "Category",
                                                "Current Stock",
                                                "Alert Level",
                                                "Status",
                                            ],
                                            inventoryAlerts.map((product) => [
                                                product.name,
                                                product.branchName ||
                                                product.branch_name ||
                                                getBranchNameFromId(
                                                    branches,
                                                    product.branchId ?? product.branch_id,
                                                ) ||
                                                "Branch",
                                                product.category || "Uncategorized",
                                                Number(product.stock || 0),
                                                Number(product.alertLevel || 0),
                                                Number(product.stock || 0) <= 0
                                                    ? "Out of Stock"
                                                    : "Low Stock",
                                            ]),
                                        )
                                    }
                                    tone="red"
                                />
                            </div>

                            {inventoryAlerts.length === 0 ? (
                                <div className="px-4 py-4">
                                    <OwnerEmptyState text="All products are well stocked." />
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-hidden">
                                        <table className="w-full table-fixed border-collapse">
                                            <colgroup>
                                                <col className="w-[34%]" />
                                                <col className="w-[23%]" />
                                                <col className="w-[25%]" />
                                                <col className="w-[18%]" />
                                            </colgroup>
                                            <thead>
                                            <tr className="border-b border-[#F1EDF5] bg-[#FBFAFD]">
                                                <th className="px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Product
                                                </th>
                                                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Branch
                                                </th>
                                                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Category
                                                </th>
                                                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                                                    Stock Level
                                                </th>

                                            </tr>
                                            </thead>
                                            <tbody>
                                            {inventoryAlerts.map((product) => (
                                                <OwnerInventoryAlertRow
                                                    key={product.id}
                                                    product={product}
                                                    branchName={
                                                        product.branchName ||
                                                        product.branch_name ||
                                                        getBranchNameFromId(
                                                            branches,
                                                            product.branchId ?? product.branch_id,
                                                        ) ||
                                                        "Branch"
                                                    }
                                                />
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </OwnerDashboardCard>
                    </div>
                </div>
            </section>

            {showStockAlertsModal && (
                <OwnerStockAlertsModal
                    items={visibleStockAlerts}
                    branches={branches}
                    activeFilter={stockAlertFilter}
                    totalCount={allInventoryAlerts.length}
                    lowStockCount={lowStockAlertCount}
                    outOfStockCount={outOfStockAlertCount}
                    onChangeFilter={setStockAlertFilter}
                    onClose={() => setShowStockAlertsModal(false)}
                />
            )}
        </>
    );
}

function OwnerDashboardCard({
                                children,
                                className = "",
                            }: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm ${className}`}
        >
            {children}
        </div>
    );
}

function OwnerStatCard({
                           title,
                           value,
                       }: {
    title: string;
    value: string;
}) {
    return (
        <div className="flex min-h-[96px] flex-col justify-center rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-4 shadow-sm">
            <p className="text-sm font-medium text-[#281246]">{title}</p>
            <p className="mt-2 text-[24px] font-bold leading-none tracking-[-0.02em] text-[#1A1220]">
                {value}
            </p>
        </div>
    );
}

function OwnerCardHeader({
                             title,
                             icon,
                             action,
                             onAction,
                             onDownload,
                         }: {
    title: string;
    icon?: React.ReactNode;
    action?: string;
    onAction?: () => void;
    onDownload?: () => void;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-[#6D35D4]">
                {icon && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            {icon}
          </span>
                )}
                <h2 className="min-w-0 truncate text-[14px] font-bold text-[#24152F]">
                    {title}
                </h2>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {onDownload && (
                    <button
                        type="button"
                        onClick={onDownload}
                        aria-label={`Download ${title}`}
                        title={`Download ${title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                    >
                        <Download size={14} strokeWidth={2} />
                    </button>
                )}

                {action && onAction && (
                    <button
                        type="button"
                        onClick={onAction}
                        className="inline-flex h-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-3 text-[11px] font-semibold text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                    >
                        {action}
                    </button>
                )}
            </div>
        </div>
    );
}

function OwnerTableCardHeader({
                                  title,
                                  subtitle,
                                  action,
                                  onAction,
                                  onDownload,
                                  tone,
                              }: {
    title: string;
    subtitle: string;
    action: string;
    onAction: () => void;
    onDownload?: () => void;
    tone: "violet" | "red";
}) {
    const isAlert = tone === "red";

    return (
        <div className="flex min-h-[64px] items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2">
        <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center ${
                isAlert ? "text-[#EF4444]" : "text-[#6D35D4]"
            }`}
        >
          {isAlert ? (
              <TriangleAlert size={16} strokeWidth={2} />
          ) : (
              <CalendarDays size={16} strokeWidth={2} />
          )}
        </span>

                <div className="min-w-0">
                    <h2 className="truncate text-[14px] font-bold text-[#24152F]">
                        {title}
                    </h2>
                    <p className="truncate text-[10px] leading-4 text-[#8A7D92]">
                        {subtitle}
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {onDownload && (
                    <button
                        type="button"
                        onClick={onDownload}
                        aria-label={`Download ${title}`}
                        title={`Download ${title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                    >
                        <Download size={14} strokeWidth={2} />
                    </button>
                )}

                <button
                    type="button"
                    onClick={onAction}
                    className="inline-flex h-7 items-center justify-center whitespace-nowrap rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-3 text-[11px] font-semibold text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                >
                    {action}
                </button>
            </div>
        </div>
    );
}
function OwnerRankedProgress({
                                 label,
                                 value,
                                 percent,
                             }: {
    label: string;
    value: string;
    percent: number;
}) {
    return (
        <div className="border-b border-[#F0EBF5] py-3 first:pt-1 last:border-b-0 last:pb-1">
            <div className="mb-2 flex items-center justify-between gap-3">
                <p
                    title={label}
                    className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#30243A]"
                >
                    {label}
                </p>
                <p className="shrink-0 text-[11px] font-semibold text-[#7C3AED]">
                    {value}
                </p>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-[#ECE8F2]">
                <div
                    className="h-full rounded-full bg-[#7C3AED] transition-[width] duration-300"
                    style={{
                        width: `${Math.max(Math.min(percent, 100), 7)}%`,
                    }}
                />
            </div>
        </div>
    );
}


function OwnerBookingTableRow({
                                  booking,
                                  branchName,
                              }: {
    booking: Booking;
    branchName: string;
}) {
    const parsedDate = new Date(booking.date || "");
    const hasValidDate = !Number.isNaN(parsedDate.getTime());
    const monthLabel = hasValidDate
        ? parsedDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()
        : "—";
    const dayLabel = hasValidDate ? String(parsedDate.getDate()) : "—";
    const dateLabel = hasValidDate
        ? parsedDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        })
        : "—";
    const timeLabel = hasValidDate
        ? parsedDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        })
        : "";

    const status = booking.status || "Pending Review";
    const normalizedStatus = status.trim().toLowerCase();

    const statusClass =
        normalizedStatus === "completed"
            ? "text-[#16A34A]"
            : normalizedStatus === "confirmed"
                ? "text-[#2563EB]"
                : normalizedStatus === "preparing"
                    ? "text-[#7C3AED]"
                    : normalizedStatus === "cancelled" || normalizedStatus === "canceled"
                        ? "text-[#DC2626]"
                        : "text-[#B7791F]";

    return (
        <tr className="h-[58px] border-b border-[#F3EFF6] transition hover:bg-[#FCFAFF] last:border-b-0">
            <td className="px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-[#E8E0F0] bg-[#FBF9FE] leading-none">
            <span className="text-[8px] font-bold text-[#7C3AED]">
              {monthLabel}
            </span>
                        <span className="mt-0.5 text-[12px] font-bold text-[#342047]">
              {dayLabel}
            </span>
                    </div>

                    <p
                        title={booking.name}
                        className="min-w-0 truncate text-[12px] font-medium text-[#30243A]"
                    >
                        {booking.name}
                    </p>
                </div>
            </td>

            <td className="px-2 py-2">
                <p
                    title={branchName}
                    className="truncate text-[11px] font-semibold text-[#7C3AED]"
                >
                    {branchName}
                </p>
            </td>

            <td className="px-2 py-2">
                <p className="truncate text-[12px] font-medium text-[#30243A]">
                    {dateLabel}
                </p>
                {timeLabel && (
                    <p className="mt-0.5 text-[10px] text-[#7A6A84]">{timeLabel}</p>
                )}
            </td>

            <td className="px-2 py-2">
                <p
                    title={booking.packageName || "Package booking"}
                    className="truncate text-[12px] font-medium text-[#30243A]"
                >
                    {booking.packageName || "Package booking"}
                </p>
            </td>

            <td className="px-2.5 py-2">
        <span
            className={`block max-w-full truncate text-[11px] font-semibold capitalize ${statusClass}`}
        >
          {normalizedStatus === "pending review" ? "Pending" : status}
        </span>
            </td>
        </tr>
    );
}

function OwnerInventoryAlertRow({
                                    product,
                                    branchName,
                                }: {
    product: Product;
    branchName: string;
}) {
    const unitsLeft = Number(product.stock || 0);
    const isOutOfStock = unitsLeft <= 0;

    return (
        <tr className="h-[58px] border-b border-[#F3EFF6] transition hover:bg-[#FFFCFC] last:border-b-0">
            <td className="px-2.5 py-2">
                <p
                    title={product.name}
                    className="truncate text-[12px] font-medium text-[#30243A]"
                >
                    {product.name}
                </p>
                <p
                    className={`mt-0.5 text-[10px] font-semibold ${
                        isOutOfStock ? "text-[#DC2626]" : "text-[#B45309]"
                    }`}
                >
                    {isOutOfStock ? "Out of stock" : "Low stock"}
                </p>
            </td>

            <td className="px-2 py-2">
                <p
                    title={branchName}
                    className="truncate text-[11px] font-semibold text-[#7C3AED]"
                >
                    {branchName}
                </p>
            </td>

            <td className="px-2 py-2">
                <p
                    title={product.category || "Uncategorized"}
                    className="truncate text-[11px] font-medium text-[#5F4E75]"
                >
                    {product.category || "Uncategorized"}
                </p>
            </td>

            <td className="px-2 py-2">
        <span
            className={`whitespace-nowrap text-[11px] font-semibold ${
                isOutOfStock ? "text-[#DC2626]" : "text-[#B7791F]"
            }`}
        >
          {unitsLeft} left
        </span>
            </td>

        </tr>
    );
}

function OwnerEmptyState({ text }: { text: string }) {
    return (
        <div className="flex min-h-[150px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FCFBFE] px-5 text-center">
            <p className="text-sm text-[#7A6A84]">{text}</p>
        </div>
    );
}


function OwnerStockAlertsModal({
                                   items,
                                   branches,
                                   activeFilter,
                                   totalCount,
                                   lowStockCount,
                                   outOfStockCount,
                                   onChangeFilter,
                                   onClose,
                               }: {
    items: Product[];
    branches: Branch[];
    activeFilter: "all" | "low" | "out";
    totalCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    onChangeFilter: (filter: "all" | "low" | "out") => void;
    onClose: () => void;
}) {
    const filterClass = (active: boolean, tone: "all" | "low" | "out") => {
        if (active && tone === "all") {
            return "border-[#2B174C] bg-[#2B174C] text-white";
        }

        if (active && tone === "low") {
            return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
        }

        if (active && tone === "out") {
            return "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]";
        }

        return "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#FAF8FF]";
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 font-sans text-[#1A1220] backdrop-blur-[2px] [&_*]:font-sans">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="owner-stock-alerts-title"
                className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[#E9E0EF] px-6 py-5">
                    <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFF4D8] text-[#B7791F]">
              <TriangleAlert size={21} strokeWidth={2} />
            </span>

                        <div className="min-w-0">
                            <h2
                                id="owner-stock-alerts-title"
                                className="!text-[20px] !font-bold !leading-6 text-[#1A1220]"
                            >
                                Stock Alerts
                            </h2>
                            <p className="mt-1 !text-sm !font-normal !leading-5 text-[#7A6A84]">
                                Low-stock and out-of-stock items for the current inventory view.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close stock alerts"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl !text-[22px] !font-normal !leading-none text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C]"
                    >
                        ×
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E0EF] px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onChangeFilter("all")}
                            className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterClass(
                                activeFilter === "all",
                                "all",
                            )}`}
                        >
                            All ({totalCount})
                        </button>

                        <button
                            type="button"
                            onClick={() => onChangeFilter("low")}
                            className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterClass(
                                activeFilter === "low",
                                "low",
                            )}`}
                        >
                            Low Stock ({lowStockCount})
                        </button>

                        <button
                            type="button"
                            onClick={() => onChangeFilter("out")}
                            className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterClass(
                                activeFilter === "out",
                                "out",
                            )}`}
                        >
                            Out of Stock ({outOfStockCount})
                        </button>
                    </div>

                    <span className="!text-xs !font-semibold text-[#806A8C]">
            View only
          </span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[820px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                        <tr className="border-b border-[#E9E0EF]">
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Product
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Branch
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Variant
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Current Stock
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Alert Level
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Status
                            </th>
                        </tr>
                        </thead>

                        <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={6}
                                    className="px-5 py-14 text-center text-sm text-[#7A6A84]"
                                >
                                    No stock alerts found for this filter.
                                </td>
                            </tr>
                        ) : (
                            items.map((product) => {
                                const stock = Number(product.stock || 0);
                                const isOut = stock <= 0;
                                const branchName =
                                    product.branchName ||
                                    product.branch_name ||
                                    getBranchNameFromId(
                                        branches,
                                        product.branchId ?? product.branch_id,
                                    ) ||
                                    "Branch";

                                return (
                                    <tr
                                        key={product.id}
                                        className="border-b border-[#EEE7F2] transition hover:bg-[#FFFCF7] last:border-b-0"
                                    >
                                        <td className="px-5 py-3.5">
                                            <p className="!text-sm !font-semibold !leading-5 text-[#1A1220]">
                                                {product.name}
                                            </p>
                                            <p
                                                className={`mt-0.5 !text-xs !font-medium !leading-4 ${
                                                    isOut ? "text-[#D92D20]" : "text-[#A56607]"
                                                }`}
                                            >
                                                {isOut ? "Out of Stock" : "Low Stock"}
                                            </p>
                                        </td>

                                        <td className="px-5 py-3.5 !text-sm !font-normal !leading-5 text-[#665875]">
                                            {branchName}
                                        </td>
                                        <td className="px-5 py-3.5 !text-sm !font-normal !leading-5 text-[#806A8C]">
                                            —
                                        </td>
                                        <td
                                            className={`px-5 py-3.5 !text-sm !font-semibold !leading-5 ${
                                                isOut ? "text-[#D92D20]" : "text-[#A56607]"
                                            }`}
                                        >
                                            {stock}
                                        </td>
                                        <td className="px-5 py-3.5 !text-sm !font-normal !leading-5 text-[#665875]">
                                            {Number(product.alertLevel || 0)}
                                        </td>
                                        <td className="px-5 py-3.5">
                        <span
                            className={`inline-flex rounded-full border px-3 py-1 !text-xs !font-semibold !leading-4 ${
                                isOut
                                    ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
                                    : "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
                            }`}
                        >
                          {isOut ? "Out of Stock" : "Low Stock"}
                        </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-[#E9E0EF] bg-[#FFFCF7] px-6 py-3 text-xs leading-5 text-[#7A6A84]">
                    Owner accounts can review stock alerts here. Restocking and inventory
                    changes are managed by authorized branch users.
                </div>
            </div>
        </div>
    );
}