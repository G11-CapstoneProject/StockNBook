"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

const forecastSample = [
    { month: "Jan", height: "45%" },
    { month: "Feb", height: "58%" },
    { month: "Mar", height: "70%" },
    { month: "Apr", height: "82%" },
    { month: "May", height: "100%" },
];

function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}

function peso(value: number) {
    return `₱${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function normalizeBranch(raw: any): Branch {
    return {
        id: Number(raw.id ?? raw.branch_id ?? raw.branchId),
        branchName:
            raw.branchName ??
            raw.branch_name ??
            raw.name ??
            raw.branch ??
            "Unnamed Branch",
        managerName:
            raw.managerName ??
            raw.manager_name ??
            raw.manager ??
            "",
    };
}

function normalizeBooking(raw: any): Booking {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    return {
        id: Number(raw.id ?? raw.booking_id),
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        branchName: raw.branchName ?? raw.branch_name ?? null,
        branch_name: raw.branch_name ?? raw.branchName ?? null,
        name: raw.name ?? raw.customer_name ?? "Unnamed Client",
        date: raw.date ?? raw.event_date ?? raw.created_at ?? "",
        status: raw.status ?? "Pending Review",
    };
}

function parseOrderItems(itemText?: string) {
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

function normalizeOrder(raw: any): Order {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    return {
        id: raw.id ?? raw.orderId ?? raw.order_id,
        orderId: raw.orderId ?? raw.order_id ?? raw.id,
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        branchName: raw.branchName ?? raw.branch_name ?? null,
        branch_name: raw.branch_name ?? raw.branchName ?? null,
        total: Number(raw.total ?? 0),
        date: raw.date ?? raw.orderDate ?? raw.order_date ?? raw.createdAt ?? raw.created_at ?? "",
        orderDate: raw.orderDate ?? raw.order_date ?? raw.date ?? "",
        createdAt: raw.createdAt ?? raw.created_at ?? "",
        item: raw.item ?? "",
        items: Array.isArray(raw.items) ? raw.items : parseOrderItems(raw.item),
    };
}

function normalizeProduct(raw: any): Product {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    const sellingPrice = Number(
        raw.salesPrice ??
        raw.sales_price ??
        raw.sellingPrice ??
        raw.selling_price ??
        raw.price ??
        0
    );

    const originalPrice = Number(
        raw.originalPrice ??
        raw.original_price ??
        raw.costPrice ??
        raw.cost_price ??
        raw.origPrice ??
        raw.orig_price ??
        0
    );

    return {
        id: Number(raw.id),
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        branchName: raw.branchName ?? raw.branch_name ?? null,
        branch_name: raw.branch_name ?? raw.branchName ?? null,
        name: raw.name ?? "",
        salesPrice: sellingPrice,
        sales_price: sellingPrice,
        sellingPrice: sellingPrice,
        selling_price: sellingPrice,
        price: sellingPrice,
        originalPrice: originalPrice,
        original_price: originalPrice,
        costPrice: originalPrice,
        cost_price: originalPrice,
    };
}

function getBranchNameFromId(branches: Branch[], branchId?: number | null) {
    if (!branchId) return "";
    return branches.find((branch) => Number(branch.id) === Number(branchId))?.branchName || "";
}

function calculateRevenueFromOrders(orders: Order[], products: Product[]) {
    return orders.reduce((orderSum, order) => {
        const orderRevenue = (order.items || []).reduce((itemSum, item) => {
            const product = products.find(
                (product) =>
                    product.name.trim().toLowerCase() ===
                    (item.name || "").trim().toLowerCase()
            );

            const sellingPrice = Number(
                item.salesPrice ??
                item.sales_price ??
                item.sellingPrice ??
                item.selling_price ??
                item.price ??
                product?.salesPrice ??
                product?.sales_price ??
                product?.sellingPrice ??
                product?.selling_price ??
                product?.price ??
                0
            );

            const originalPrice = Number(
                item.originalPrice ??
                item.original_price ??
                item.costPrice ??
                item.cost_price ??
                product?.originalPrice ??
                product?.original_price ??
                product?.costPrice ??
                product?.cost_price ??
                0
            );

            const quantity = Number(item.quantity || 1);

            return itemSum + Math.max(sellingPrice - originalPrice, 0) * quantity;
        }, 0);

        return orderSum + orderRevenue;
    }, 0);
}

export default function OwnerDashboard() {
    const router = useRouter();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [managers, setManagers] = useState<BranchManager[]>([]);

    useEffect(() => {
        async function loadOwnerDashboard() {
            const token = getSavedItem("token");
            const storeId =
                getSavedItem("store_id") ||
                getSavedItem("stocknbook_store_id");

            if (!token) return;

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
                const bookingsRes = await fetch("/api/bookings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_bookings",
                        role: "owner",
                        store_id: storeId ? Number(storeId) : undefined,
                    }),
                });

                const bookingsData = await bookingsRes.json().catch(() => ({}));

                if (bookingsRes.ok && Array.isArray(bookingsData.bookings)) {
                    setBookings(bookingsData.bookings.map(normalizeBooking));
                }
            } catch (error) {
                console.warn("Owner dashboard bookings fetch failed:", error);
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
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_branch_managers",
                        store_id: storeId ? Number(storeId) : undefined,
                    }),
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
        }

        void loadOwnerDashboard();

        window.addEventListener("focus", loadOwnerDashboard);

        return () => {
            window.removeEventListener("focus", loadOwnerDashboard);
        };
    }, []);

    const totalRevenue = calculateRevenueFromOrders(orders, products);

    const activeManagers =
        managers.length > 0
            ? managers.filter((manager) => {
                const status = String(manager.status || "").toLowerCase();
                return status !== "inactive" && status !== "disabled";
            }).length
            : branches.filter((branch) => branch.managerName).length;

    const branchStats = useMemo(() => {
        return branches.map((branch) => {
            const branchBookings = bookings.filter((booking) => {
                const bookingBranchId = booking.branchId ?? booking.branch_id;
                const bookingBranchName = booking.branchName ?? booking.branch_name;

                return (
                    String(bookingBranchId || "") === String(branch.id) ||
                    String(bookingBranchName || "").toLowerCase() ===
                    branch.branchName.toLowerCase()
                );
            });

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
                branchProducts.map((product) => product.name.trim().toLowerCase())
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
                    productNames.has((item.name || "").trim().toLowerCase())
                );
            });

            const revenue = calculateRevenueFromOrders(branchOrders, branchProducts);

            return {
                branch,
                bookings: branchBookings.length,
                orders: branchOrders.length,
                revenue,
            };
        });
    }, [branches, bookings, orders, products]);

    const topRevenueBranch =
        branchStats.length > 0
            ? [...branchStats].sort((a, b) => b.revenue - a.revenue)[0]
            : null;

    const mostBookingsBranch =
        branchStats.length > 0
            ? [...branchStats].sort((a, b) => b.bookings - a.bookings)[0]
            : null;

    const pendingSetupCount = Math.max(
        branches.filter((branch) => !branch.managerName).length,
        0
    );

    const recentBookings = bookings.slice(0, 3);

    return (
        <>
            <div className="flex h-[54px] items-center justify-between border-b border-[#EBE4F0] bg-white px-5">
                <div className="flex items-center gap-3">
                    <h1 className="text-[18px] font-medium text-[#1A1220]">
                        Dashboard
                    </h1>

                    <span className="rounded-[6px] bg-[#FFFBF0] px-3 py-1 text-[11px] font-medium text-[#633806]">
                        All branches
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="rounded-[7px] border border-[#EBE4F0] bg-white px-4 py-1.5 text-[11px] text-[#7A6E88]">
                        {new Date().toLocaleDateString("en-US", {
                            month: "long",
                            year: "numeric",
                        })}
                    </span>

                    <button className="flex h-[32px] w-[32px] items-center justify-center rounded-[7px] border border-[#EBE4F0] bg-white text-[12px] text-[#C9951A]">
                        ●
                    </button>

                    <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#C9951A] text-[12px] font-medium text-white">
                        YS
                    </div>
                </div>
            </div>

            <section className="p-5">
                <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                        <StatCard
                            active
                            title="Total revenue"
                            value={peso(totalRevenue)}
                            note="Across all branches"
                            iconType="hero"
                        />

                        <StatCard
                            title="Total bookings"
                            value={String(bookings.length)}
                            note="Across all branches"
                            iconType="plum"
                        />

                        <StatCard
                            title="Total branches"
                            value={String(branches.length)}
                            note={`${pendingSetupCount} pending setup`}
                            iconType="gold"
                        />

                        <StatCard
                            title="Active managers"
                            value={String(activeManagers)}
                            note="Across active branches"
                            iconType="plum"
                        />
                    </div>

                    <div className="grid grid-cols-5 gap-3">
                        <Card className="col-span-3 min-h-[132px]">
                            <CardHeader
                                title="Branch Summary"
                                action="View branches →"
                                onAction={() => router.push("/branches")}
                            />

                            <div className="space-y-3">
                                <BranchLine
                                    label="Top revenue"
                                    value={topRevenueBranch?.branch.branchName || "No data yet"}
                                    detail={
                                        topRevenueBranch
                                            ? `${peso(topRevenueBranch.revenue)} this month`
                                            : "No sales yet"
                                    }
                                    color="#2D1B4E"
                                />

                                <BranchLine
                                    label="Most bookings"
                                    value={mostBookingsBranch?.branch.branchName || "No data yet"}
                                    detail={
                                        mostBookingsBranch
                                            ? `${mostBookingsBranch.bookings} bookings`
                                            : "No bookings yet"
                                    }
                                    color="#C9951A"
                                />

                                <BranchLine
                                    label="Needs attention"
                                    value={
                                        pendingSetupCount > 0
                                            ? `${pendingSetupCount} branch setup pending`
                                            : "All branches set"
                                    }
                                    detail={
                                        pendingSetupCount > 0
                                            ? "Complete manager setup"
                                            : "No pending setup"
                                    }
                                    color="#F28B73"
                                />
                            </div>
                        </Card>

                        <Card className="col-span-2 min-h-[210px] overflow-hidden">
                            <CardHeader
                                title="Monthly trend"
                                action="View Forecasting →"
                                onAction={() => router.push("/forecasting")}
                            />

                            <div className="flex h-[150px] flex-col justify-between overflow-hidden">
                                <div>
                                    <div className="mb-2 flex h-[82px] items-end gap-2">
                                        {forecastSample.map((item, index) => (
                                            <div
                                                key={item.month}
                                                className={`flex-1 rounded-t-[4px] ${
                                                    index === forecastSample.length - 1
                                                        ? "bg-[#2D1B4E]"
                                                        : "bg-[#E9E1F3]"
                                                }`}
                                                style={{ height: item.height }}
                                            />
                                        ))}
                                    </div>

                                    <div className="flex gap-2">
                                        {forecastSample.map((item, index) => (
                                            <div
                                                key={item.month}
                                                className={`flex-1 text-center text-[9px] font-semibold ${
                                                    index === forecastSample.length - 1
                                                        ? "text-[#2D1B4E]"
                                                        : "text-[#7A6E88]"
                                                }`}
                                            >
                                                {item.month}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-t border-[#F5EEF6] pt-2">
                                    <div className="flex items-end justify-between gap-2">
                                        <div>
                                            <p className="text-[14px] font-semibold leading-none text-[#1A1220]">
                                                ₱185,500
                                            </p>

                                            <p className="mt-1 text-[9.5px] font-medium text-[#27500A]">
                                                ↑ 11% from last month
                                            </p>
                                        </div>

                                        <span className="shrink-0 rounded-full bg-[#FFF8E8] px-2 py-1 text-[9px] font-semibold text-[#8A5A00]">
                                            Sample
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Card className="min-h-[160px]">
                            <CardHeader
                                title="Recent bookings"
                                action="View all →"
                                onAction={() => router.push("/bookings")}
                            />

                            {recentBookings.length === 0 ? (
                                <div className="flex min-h-[96px] items-center justify-center rounded-[9px] bg-[#FDFAF4] px-4 py-4 text-center">
                                    <div>
                                        <p className="text-[11px] font-semibold text-[#1A1220]">
                                            No recent bookings yet.
                                        </p>

                                        <p className="mt-1 text-[10px] leading-4 text-[#7A6E88]">
                                            New bookings will appear here once customers start reserving packages.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {recentBookings.map((booking) => (
                                        <BookingPreview
                                            key={booking.id}
                                            name={booking.name}
                                            branch={
                                                booking.branchName ||
                                                booking.branch_name ||
                                                getBranchNameFromId(
                                                    branches,
                                                    booking.branchId ?? booking.branch_id
                                                ) ||
                                                "Branch"
                                            }
                                            date={booking.date || "No date"}
                                            status={booking.status || "Pending Review"}
                                        />
                                    ))}
                                </div>
                            )}
                        </Card>

                        <Card className="min-h-[160px]">
                            <CardHeader title="Quick Actions" />

                            <div className="space-y-2">
                                <ActionButton
                                    label="+ Add branch"
                                    onClick={() => router.push("/branches/add-branches")}
                                />

                                <ActionButton
                                    label="View branches"
                                    onClick={() => router.push("/branches")}
                                />

                                <ActionButton
                                    label="View branch managers"
                                    onClick={() => router.push("/branch-managers")}
                                />

                                <ActionButton
                                    label="View reports"
                                    onClick={() => router.push("/reports")}
                                />
                            </div>
                        </Card>
                    </div>
                </div>
            </section>
        </>
    );
}

function Card({
                  children,
                  className = "",
              }: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`rounded-[12px] border border-[#EBE4F0] bg-white p-3.5 ${className}`}
        >
            {children}
        </div>
    );
}

function CardHeader({
                        title,
                        action,
                        onAction,
                    }: {
    title: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="whitespace-nowrap text-[14px] font-medium leading-none text-[#1A1220]">
                {title}
            </h2>

            {action && (
                <button
                    onClick={onAction}
                    className="shrink-0 whitespace-nowrap text-[8.5px] font-semibold leading-none text-[#2D1B4E] hover:underline"
                >
                    {action}
                </button>
            )}
        </div>
    );
}

function StatCard({
                      title,
                      value,
                      note,
                      iconType,
                      active = false,
                  }: {
    title: string;
    value: string;
    note: string;
    iconType: "hero" | "plum" | "gold";
    active?: boolean;
}) {
    const iconClass =
        iconType === "hero"
            ? "bg-[#5A4674]"
            : iconType === "gold"
                ? "border border-[#E1B13D] bg-[#FFF8E8]"
                : "bg-[#E9E1F3]";

    return (
        <div
            className={`h-[120px] rounded-[10px] border p-2.5 ${
                active
                    ? "border-[#2D1B4E] bg-[#2D1B4E] text-white"
                    : "border-[#EBE4F0] bg-white text-[#1A1220]"
            }`}
        >
            <div className={`mb-2 h-[28px] w-[28px] rounded-[7px] ${iconClass}`} />

            <p
                className={`text-[10px] font-medium leading-[1.15] ${
                    active ? "text-white/75" : "text-[#7A6E88]"
                }`}
            >
                {title}
            </p>

            <p className="mt-1 text-[18px] font-medium leading-none tracking-[-0.01em]">
                {value}
            </p>

            <p
                className={`mt-1.5 text-[10px] font-medium leading-[1.25] ${
                    active ? "text-white/80" : "text-[#27500A]"
                }`}
            >
                {note}
            </p>
        </div>
    );
}

function BranchLine({
                        label,
                        value,
                        detail,
                        color,
                    }: {
    label: string;
    value: string;
    detail: string;
    color: string;
}) {
    return (
        <div>
            <div className="mb-1 flex items-center justify-between gap-3">
                <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#7A6E88]">
                        {label}
                    </p>

                    <p className="mt-0.5 text-[11.5px] font-semibold text-[#1A1220]">
                        {value}
                    </p>
                </div>

                <p className="shrink-0 text-right text-[10px] text-[#7A6E88]">
                    {detail}
                </p>
            </div>

            <div className="h-1.5 rounded-full bg-[#EDE6F3]">
                <div
                    className="h-1.5 rounded-full"
                    style={{
                        width:
                            label === "Top revenue"
                                ? "75%"
                                : label === "Most bookings"
                                    ? "65%"
                                    : "35%",
                        backgroundColor: color,
                    }}
                />
            </div>
        </div>
    );
}

function BookingPreview({
                            name,
                            branch,
                            date,
                            status,
                        }: {
    name: string;
    branch: string;
    date: string;
    status: string;
}) {
    const statusClass =
        status === "Confirmed"
            ? "bg-[#EAF6E8] text-[#1F7A35]"
            : status === "Preparing"
                ? "bg-[#EFE7FF] text-[#4E2C85]"
                : "bg-[#FFF2D8] text-[#9A6500]";

    return (
        <div className="flex items-center justify-between border-b border-[#F5EEF6] pb-2 last:border-b-0 last:pb-0">
            <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-[#1A1220]">
                    {name}
                </p>
                <p className="truncate text-[10px] text-[#7A6E88]">
                    {branch} · {date}
                </p>
            </div>

            <span
                className={`ml-2 shrink-0 rounded-[6px] px-2 py-1 text-[9px] font-medium ${statusClass}`}
            >
                {status}
            </span>
        </div>
    );
}

function ActionButton({
                          label,
                          onClick,
                      }: {
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className="w-full rounded-[8px] border border-[#EBE4F0] bg-[#FDFAF4] px-3 py-2 text-left text-[10.5px] font-semibold leading-4 text-[#2D1B4E] transition hover:bg-[#EEE8F8]"
        >
            {label}
        </button>
    );
}

