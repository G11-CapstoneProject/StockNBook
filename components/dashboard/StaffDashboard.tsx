"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Product = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
};

type Order = {
    total?: number;
    date?: string;
    items?: {
        name?: string;
        quantity?: number;
    }[];
};

type Booking = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string;
    branch_name?: string;
    date: string;
    name: string;
    status?: string;
};

const STORAGE_KEY = "stocknbook_inventory_products";

function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}

function getSavedJson<T>(key: string, fallback: T): T {
    try {
        if (typeof window === "undefined") return fallback;

        const raw =
            sessionStorage.getItem(key) ||
            localStorage.getItem(key) ||
            "";

        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function getSavedPermissions() {
    return getSavedJson<Record<string, boolean | string>>("permissions", {});
}

function getUserValue(user: unknown, key: string) {
    if (!user || typeof user !== "object") return "";
    return String((user as Record<string, unknown>)[key] ?? "");
}

function normalizeBooking(raw: any): Booking {
    return {
        ...raw,
        id: Number(raw.id ?? raw.booking_id),
        branchId: raw.branchId ?? raw.branch_id ?? null,
        branch_id: raw.branch_id ?? raw.branchId ?? null,
        branchName: raw.branchName ?? raw.branch_name ?? "",
        branch_name: raw.branch_name ?? raw.branchName ?? "",
        date: raw.date ?? raw.event_date ?? "",
        name: raw.name ?? raw.customer_name ?? "",
        status: raw.status ?? "Pending Review",
    };
}

export default function StaffDashboard() {
    const { user } = useCurrentUser();

    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [staffName, setStaffName] = useState("Staff");
    const [branchName, setBranchName] = useState("Branch");
    const [permissions, setPermissions] = useState<Record<string, boolean | string>>({});

    useEffect(() => {
        const loadData = async () => {
            const currentBranchName =
                getUserValue(user, "branch_name") ||
                getSavedItem("branch_name") ||
                getSavedItem("stocknbook_branch_name") ||
                "Branch";

            const branchId =
                getUserValue(user, "branch_id") ||
                getSavedItem("branch_id") ||
                getSavedItem("stocknbook_branch_id");

            const storeId =
                getUserValue(user, "store_id") ||
                getSavedItem("store_id") ||
                getSavedItem("stocknbook_store_id");

            setStaffName(
                getUserValue(user, "staff_name") ||
                getUserValue(user, "name") ||
                getSavedItem("staff_name") ||
                getSavedItem("name") ||
                "Staff"
            );

            setBranchName(currentBranchName);

            setPermissions(
                (user && typeof user === "object" && "permissions" in user
                    ? ((user as { permissions?: Record<string, boolean | string> }).permissions || {})
                    : getSavedPermissions())
            );

            const savedProducts = getSavedJson<Product[]>(STORAGE_KEY, []);
            const branchProducts =
                branchId && savedProducts.some((p) => p.branchId || p.branch_id)
                    ? savedProducts.filter((p) => {
                        const productBranchId = p.branchId ?? p.branch_id;
                        return String(productBranchId) === String(branchId);
                    })
                    : savedProducts;

            setProducts(branchProducts);

            const storedOrders = getSavedJson<Order[]>("stocknbook_orders", []);
            setOrders(storedOrders);

            const token = getSavedItem("token");

            if (token && branchId) {
                try {
                    const res = await fetch("/api/bookings", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_bookings",
                            role: "staff",
                            store_id: storeId ? Number(storeId) : undefined,
                            branch_id: Number(branchId),
                        }),
                    });

                    const text = await res.text();
                    const data = text ? JSON.parse(text) : {};

                    if (res.ok) {
                        setBookings((data.bookings || []).map(normalizeBooking));
                    } else {
                        setBookings([]);
                    }
                } catch (error) {
                    console.warn("Staff dashboard bookings fetch failed:", error);
                    setBookings([]);
                }
            } else {
                setBookings([]);
            }
        };

        void loadData();
        window.addEventListener("focus", loadData);

        return () => {
            window.removeEventListener("focus", loadData);
        };
    }, [user]);

    const canAccess = (permission: string) => {
        return permissions[permission] === true;
    };

    const initials = staffName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    const totalSales = orders.length;
    const totalBookings = bookings.length;
    const totalProducts = products.length;
    const lowStockItems = products.filter((p) => p.stock <= p.alertLevel);
    const recentBookings = bookings.slice(0, 3);

    const popularItems = Object.values(
        orders.reduce<Record<string, { name: string; quantity: number }>>(
            (acc, order) => {
                (order.items || []).forEach((item) => {
                    const name = item.name || "Unnamed item";
                    const quantity = item.quantity || 0;

                    if (!acc[name]) {
                        acc[name] = { name, quantity: 0 };
                    }

                    acc[name].quantity += quantity;
                });

                return acc;
            },
            {}
        )
    )
        .filter((item) => item.quantity > 0)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 3);

    const weeklyTrend = useMemo(() => {
        const today = new Date();

        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today);
            d.setDate(today.getDate() - (6 - i));

            return {
                label: d.toLocaleDateString("en-US", { weekday: "short" }),
                dateStr: d.toISOString().split("T")[0],
            };
        });

        const values = days.map((day) => {
            const total = orders
                .filter((order) => order.date === day.dateStr)
                .reduce((sum, order) => sum + (order.total || 0), 0);

            return {
                label: day.label,
                total,
            };
        });

        const hasData = values.some((item) => item.total > 0);

        if (!hasData) {
            return [
                { label: "Mon", total: 25 },
                { label: "Tue", total: 38 },
                { label: "Wed", total: 30 },
                { label: "Thu", total: 45 },
                { label: "Fri", total: 62 },
                { label: "Sat", total: 50 },
                { label: "Sun", total: 34 },
            ];
        }

        return values;
    }, [orders]);

    const maxTrend = Math.max(...weeklyTrend.map((item) => item.total), 1);

    const hasAnyModule =
        canAccess("bookings") ||
        canAccess("inventory") ||
        canAccess("packages") ||
        canAccess("pos") ||
        canAccess("reports");

    return (
        <main className="min-w-0 flex-1 overflow-x-hidden bg-[#FDFAF4] text-[#1A1220]">
            <div className="flex h-[54px] items-center justify-between border-b border-[#EBE4F0] bg-white px-5">
                <div className="flex items-center gap-3">
                    <h1 className="text-[18px] font-medium text-[#1A1220]">
                        Dashboard
                    </h1>

                    <span className="rounded-[6px] bg-[#EEE8F8] px-3 py-1 text-[11px] font-medium text-[#2D1B4E]">
                        {branchName}
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
                        {initials}
                    </div>
                </div>
            </div>

            <section className="p-5">
                <div className="mb-3">
                    <p className="text-[11px] font-medium text-[#7A6E88]">
                        Welcome back
                    </p>
                    <h2 className="mt-0.5 text-[16px] font-semibold text-[#1A1220]">
                        {staffName}
                    </h2>
                </div>

                {!hasAnyModule && (
                    <Card>
                        <h3 className="text-[14px] font-medium text-[#1A1220]">
                            No modules assigned yet
                        </h3>
                        <p className="mt-2 text-[10.5px] leading-4 text-[#7A6E88]">
                            Please contact your manager to update your staff access.
                        </p>
                    </Card>
                )}

                {hasAnyModule && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-4 gap-3">
                            <StatCard
                                active
                                title="Total Sales"
                                value={canAccess("pos") ? String(totalSales) : "—"}
                                note={canAccess("pos") ? "Transactions made" : "No access"}
                                iconType="hero"
                            />

                            <StatCard
                                title="Total Bookings"
                                value={canAccess("bookings") ? String(totalBookings) : "—"}
                                note={canAccess("bookings") ? "Branch bookings only" : "No access"}
                                iconType="plum"
                            />

                            <StatCard
                                title="Total Products"
                                value={canAccess("inventory") ? String(totalProducts) : "—"}
                                note={canAccess("inventory") ? "Branch inventory" : "No access"}
                                iconType="gold"
                            />

                            <StatCard
                                title="Packages"
                                value={canAccess("packages") ? "Available" : "—"}
                                note={canAccess("packages") ? "Package module" : "No access"}
                                iconType="plum"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Card className="min-h-[160px]">
                                <CardHeader title="Popular items" />

                                {canAccess("pos") ? (
                                    popularItems.length === 0 ? (
                                        <EmptyText text="No popular items yet." />
                                    ) : (
                                        <div className="space-y-3">
                                            {popularItems.map((item, index) => (
                                                <SummaryLine
                                                    key={item.name}
                                                    label={item.name}
                                                    value={`${item.quantity} sold`}
                                                    percent={index === 0 ? 85 : index === 1 ? 60 : 40}
                                                    color={index === 0 ? "#2D1B4E" : "#C9951A"}
                                                />
                                            ))}
                                        </div>
                                    )
                                ) : (
                                    <EmptyText text="Popular items are hidden because POS access is not enabled." />
                                )}
                            </Card>

                            <Card className="min-h-[160px]">
                                <CardHeader title="Weekly trend" />

                                {canAccess("pos") ? (
                                    <div className="flex h-[118px] flex-col justify-between">
                                        <div>
                                            <div className="mb-2 flex h-[78px] items-end gap-2">
                                                {weeklyTrend.map((item, index) => {
                                                    const height = Math.max(
                                                        (item.total / maxTrend) * 100,
                                                        22
                                                    );

                                                    const isHighest =
                                                        item.total ===
                                                        Math.max(...weeklyTrend.map((trend) => trend.total));

                                                    return (
                                                        <div
                                                            key={`${item.label}-${index}`}
                                                            className={`flex-1 rounded-t-[4px] ${
                                                                isHighest ? "bg-[#2D1B4E]" : "bg-[#E9E1F3]"
                                                            }`}
                                                            style={{ height: `${height}%` }}
                                                        />
                                                    );
                                                })}
                                            </div>

                                            <div className="flex gap-2">
                                                {weeklyTrend.map((item, index) => (
                                                    <div
                                                        key={`${item.label}-label-${index}`}
                                                        className="flex-1 text-center text-[9px] font-semibold text-[#7A6E88]"
                                                    >
                                                        {item.label.slice(0, 3)}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <EmptyText text="Weekly trend is hidden because POS access is not enabled." />
                                )}
                            </Card>

                            <Card className="min-h-[160px]">
                                <CardHeader
                                    title="Recent bookings"
                                    action="View all →"
                                    href="/bookings"
                                    hideAction={!canAccess("bookings")}
                                />

                                {!canAccess("bookings") ? (
                                    <EmptyText text="Booking access is not enabled for this account." />
                                ) : recentBookings.length === 0 ? (
                                    <EmptyText text="No recent bookings yet." />
                                ) : (
                                    <div className="space-y-2">
                                        {recentBookings.map((booking) => (
                                            <BookingRow
                                                key={booking.id}
                                                name={booking.name}
                                                branch={branchName}
                                                date={booking.date}
                                                status={booking.status || "Pending Review"}
                                                color={booking.status === "Confirmed" ? "#2D1B4E" : "#C9951A"}
                                            />
                                        ))}
                                    </div>
                                )}
                            </Card>

                            <Card className="min-h-[160px]">
                                <CardHeader
                                    title="Inventory alerts"
                                    action="View inventory →"
                                    href="/inventory"
                                    hideAction={!canAccess("inventory")}
                                />

                                {!canAccess("inventory") ? (
                                    <EmptyText text="Inventory access is not enabled for this account." />
                                ) : lowStockItems.length === 0 ? (
                                    <EmptyText text="All items are well stocked." />
                                ) : (
                                    <div className="space-y-2">
                                        {lowStockItems.slice(0, 3).map((product) => (
                                            <InventoryAlert
                                                key={product.id}
                                                name={product.name}
                                                branch={branchName}
                                                quantity={`${product.stock} left`}
                                            />
                                        ))}
                                    </div>
                                )}
                            </Card>
                        </div>
                    </div>
                )}
            </section>
        </main>
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
                        href,
                        hideAction = false,
                    }: {
    title: string;
    action?: string;
    href?: string;
    hideAction?: boolean;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="whitespace-nowrap text-[14px] font-medium leading-none text-[#1A1220]">
                {title}
            </h2>

            {action && href && !hideAction && (
                <a
                    href={href}
                    className="shrink-0 whitespace-nowrap text-[9px] font-semibold leading-none text-[#2D1B4E] hover:underline"
                >
                    {action}
                </a>
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

function SummaryLine({
                         label,
                         value,
                         percent,
                         color,
                     }: {
    label: string;
    value: string;
    percent: number;
    color: string;
}) {
    return (
        <div>
            <div className="mb-1 flex items-center justify-between gap-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#7A6E88]">
                    {label}
                </p>

                <p className="shrink-0 text-right text-[10px] text-[#7A6E88]">
                    {value}
                </p>
            </div>

            <div className="h-1.5 rounded-full bg-[#EDE6F3]">
                <div
                    className="h-1.5 rounded-full"
                    style={{
                        width: `${percent}%`,
                        backgroundColor: color,
                    }}
                />
            </div>
        </div>
    );
}

function BookingRow({
                        name,
                        branch,
                        date,
                        status,
                        color,
                    }: {
    name: string;
    branch: string;
    date: string;
    status: string;
    color: string;
}) {
    const statusClass =
        status === "Confirmed"
            ? "bg-[#EAF6E8] text-[#1F7A35]"
            : status === "Pending Review"
                ? "bg-[#FFF2D8] text-[#9A6500]"
                : "bg-[#FFE5EF] text-[#A53B62]";

    return (
        <div className="flex items-center justify-between border-b border-[#F5EEF6] pb-2 last:border-b-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-2">
                <div
                    className="h-[34px] w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                />

                <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-[#1A1220]">
                        {name}
                    </p>
                    <p className="truncate text-[10px] text-[#7A6E88]">
                        {branch} · {date}
                    </p>
                </div>
            </div>

            <span
                className={`ml-2 shrink-0 rounded-[6px] px-2 py-1 text-[9px] font-medium ${statusClass}`}
            >
                {status}
            </span>
        </div>
    );
}

function InventoryAlert({
                            name,
                            branch,
                            quantity,
                        }: {
    name: string;
    branch: string;
    quantity: string;
}) {
    return (
        <div className="flex items-center justify-between border-b border-[#F5EEF6] pb-2 last:border-b-0 last:pb-0">
            <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-[#1A1220]">
                    {name}
                </p>
                <p className="truncate text-[10px] text-[#B42318]">
                    {branch} · {quantity}
                </p>
            </div>

            <a
                href="/inventory"
                className="ml-2 shrink-0 rounded-[7px] bg-[#EEE8F8] px-2.5 py-1.5 text-[9px] font-semibold text-[#2D1B4E]"
            >
                View
            </a>
        </div>
    );
}

function EmptyText({ text }: { text: string }) {
    return (
        <div className="flex min-h-[96px] items-center justify-center rounded-[9px] bg-[#FDFAF4] px-4 py-4 text-center">
            <p className="text-[10.5px] leading-4 text-[#7A6E88]">{text}</p>
        </div>
    );
}

