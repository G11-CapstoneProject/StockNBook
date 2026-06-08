"use client";

import Link from "next/link";
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
    alert_level?: number;
    originalPrice: number;
    original_price?: number;
    salesPrice: number;
    sales_price?: number;
};

type ProductApiRaw = {
    id: number | string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    name: string;
    category?: string;
    stock?: number | string;
    alertLevel?: number | string;
    alert_level?: number | string;
    originalPrice?: number | string;
    original_price?: number | string;
    salesPrice?: number | string;
    sales_price?: number | string;
};

type Order = {
    id?: string;
    orderId?: string;
    branchId?: number | null;
    branch_id?: number | null;
    total?: number;
    date?: string;
    orderDate?: string;
    createdAt?: string;
    item?: string;
    items?: {
        name?: string;
        quantity?: number;
    }[];
};

type OrderApiRaw = {
    id?: string;
    orderId?: string;
    order_id?: string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    total?: number | string;
    date?: string;
    orderDate?: string;
    order_date?: string;
    createdAt?: string;
    created_at?: string;
    item?: string;
    items?: {
        name?: string;
        quantity?: number;
    }[];
};

type Booking = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    date: string;
    name: string;
    status?: string;
};

type BookingApiRaw = {
    id?: number | string;
    booking_id?: number | string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    date?: string;
    event_date?: string;
    name?: string;
    customer_name?: string;
    status?: string;
};

const STORAGE_KEY = "stocknbook_inventory_products";
const ORDERS_KEY = "stocknbook_orders";

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
    try {
        return JSON.parse(
            sessionStorage.getItem("permissions") ||
            localStorage.getItem("permissions") ||
            "{}"
        );
    } catch {
        return {};
    }
}

function getUserValue(user: unknown, key: string) {
    if (!user || typeof user !== "object") return "";
    return String((user as Record<string, unknown>)[key] ?? "");
}

function mapProduct(p: ProductApiRaw): Product {
    const rawBranchId = p.branchId ?? p.branch_id ?? null;

    return {
        id: Number(p.id),
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        name: String(p.name ?? ""),
        category: String(p.category ?? ""),
        stock: Number(p.stock ?? 0),
        alertLevel: Number(p.alertLevel ?? p.alert_level ?? 0),
        alert_level: Number(p.alertLevel ?? p.alert_level ?? 0),
        originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
        original_price: Number(p.originalPrice ?? p.original_price ?? 0),
        salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
        sales_price: Number(p.salesPrice ?? p.sales_price ?? 0),
    };
}

function normalizeBooking(raw: BookingApiRaw): Booking {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    return {
        id: Number(raw.id ?? raw.booking_id),
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        date: raw.date ?? raw.event_date ?? "",
        name: raw.name ?? raw.customer_name ?? "",
        status: raw.status ?? "Pending Review",
    };
}

function parseOrderItems(itemText?: string) {
    if (!itemText) return [];

    return itemText
        .split(",")
        .map((s) => {
            const [name, qty] = s.split(" x");

            return {
                name: name?.trim() || "Unnamed item",
                quantity: Number(qty || 0),
            };
        })
        .filter((item) => item.name);
}

function normalizeOrder(raw: OrderApiRaw): Order {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    return {
        id: raw.id ?? raw.orderId ?? raw.order_id,
        orderId: raw.orderId ?? raw.order_id ?? raw.id,
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        total: Number(raw.total ?? 0),
        date: raw.date ?? raw.orderDate ?? raw.order_date ?? raw.createdAt ?? raw.created_at ?? "",
        orderDate: raw.orderDate ?? raw.order_date ?? raw.date ?? "",
        createdAt: raw.createdAt ?? raw.created_at ?? "",
        item: raw.item ?? "",
        items: Array.isArray(raw.items) ? raw.items : parseOrderItems(raw.item),
    };
}

function filterByBranch<T extends { branchId?: number | null; branch_id?: number | null }>(
    items: T[],
    branchId: string
) {
    if (!branchId) return items;

    const hasBranchIds = items.some((item) => item.branchId || item.branch_id);

    if (!hasBranchIds) return items;

    return items.filter((item) => {
        const itemBranchId = item.branchId ?? item.branch_id;
        return String(itemBranchId) === String(branchId);
    });
}

async function loadBranchStaffCount(token: string, branchId: string, storeId: string) {
    const possibleActions = [
        "get_staff",
        "get_staff_members",
        "get_branch_staff",
        "get_staff_by_branch",
        "get_users",
    ];

    for (const action of possibleActions) {
        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action,
                    store_id: Number(storeId),
                    branch_id: Number(branchId),
                    branchId: Number(branchId),
                }),
            });

            const text = await res.text();
            const data = text ? JSON.parse(text) : {};

            if (!res.ok) continue;

            if (Array.isArray(data.staff)) return data.staff.length;
            if (Array.isArray(data.staffMembers)) return data.staffMembers.length;
            if (Array.isArray(data.users)) return data.users.length;
            if (Array.isArray(data.members)) return data.members.length;
            if (Array.isArray(data.data)) return data.data.length;
        } catch {
            // Try next possible action.
        }
    }

    return 0;
}

export default function ManagerDashboard() {
    const { user } = useCurrentUser();

    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [branchName, setBranchName] = useState("Branch");
    const [permissions, setPermissions] = useState<Record<string, boolean>>({});
    const [activeStaffCount, setActiveStaffCount] = useState(0);

    const [showModal, setShowModal] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [restockQty, setRestockQty] = useState<number | "">("");

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

            const token = getSavedItem("token");

            setBranchName(currentBranchName);

            setPermissions(
                user && typeof user === "object" && "permissions" in user
                    ? ((user as { permissions?: Record<string, boolean> }).permissions || {})
                    : getSavedPermissions()
            );

            const savedProducts = getSavedJson<Product[]>(STORAGE_KEY, []);
            setProducts(filterByBranch(savedProducts, branchId));

            const savedOrders = getSavedJson<Order[]>(ORDERS_KEY, []);
            setOrders(filterByBranch(savedOrders, branchId));

            if (!token || !branchId) {
                setBookings([]);
                setActiveStaffCount(0);
                return;
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
                        branch_id: Number(branchId),
                    }),
                });

                const productsText = await productsRes.text();
                const productsData = productsText ? JSON.parse(productsText) : {};

                if (productsRes.ok && Array.isArray(productsData.products)) {
                    const scopedProducts = productsData.products.map(mapProduct);
                    setProducts(scopedProducts);
                    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(scopedProducts));
                }
            } catch (error) {
                console.warn("Manager dashboard products fetch failed:", error);
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
                        branch_id: Number(branchId),
                    }),
                });

                const ordersText = await ordersRes.text();
                const ordersData: { orders?: OrderApiRaw[] } = ordersText
                    ? JSON.parse(ordersText)
                    : {};

                if (ordersRes.ok && Array.isArray(ordersData.orders)) {
                    const normalizedOrders: Order[] = ordersData.orders.map(normalizeOrder);

                    const currentBranchProducts: Product[] = products.length
                        ? products
                        : getSavedJson<Product[]>(STORAGE_KEY, []);

                    const branchProductNames = new Set(
                        currentBranchProducts
                            .filter((product: Product) => {
                                const productBranchId = product.branchId ?? product.branch_id;
                                return !productBranchId || String(productBranchId) === String(branchId);
                            })
                            .map((product: Product) => product.name.trim().toLowerCase())
                    );

                    const hasOrderBranchIds = normalizedOrders.some((order: Order) => {
                        return Boolean(order.branchId ?? order.branch_id);
                    });

                    const scopedOrders = hasOrderBranchIds
                        ? normalizedOrders.filter((order: Order) => {
                            const orderBranchId = order.branchId ?? order.branch_id;
                            return String(orderBranchId) === String(branchId);
                        })
                        : normalizedOrders.filter((order: Order) => {
                            return (order.items || []).some((item) =>
                                branchProductNames.has((item.name || "").trim().toLowerCase())
                            );
                        });

                    setOrders(scopedOrders);
                    sessionStorage.setItem(ORDERS_KEY, JSON.stringify(scopedOrders));
                }
            } catch (error) {
                console.warn("Manager dashboard orders fetch failed:", error);
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
                        role: "manager",
                        store_id: storeId ? Number(storeId) : undefined,
                        branch_id: Number(branchId),
                    }),
                });

                const bookingsText = await bookingsRes.text();
                const bookingsData = bookingsText ? JSON.parse(bookingsText) : {};

                if (bookingsRes.ok && Array.isArray(bookingsData.bookings)) {
                    setBookings(bookingsData.bookings.map(normalizeBooking));
                } else {
                    setBookings([]);
                }
            } catch (error) {
                console.warn("Manager dashboard bookings fetch failed:", error);
                setBookings([]);
            }

            if (storeId) {
                const staffCount = await loadBranchStaffCount(
                    token,
                    String(branchId),
                    String(storeId)
                );

                setActiveStaffCount(staffCount);
            } else {
                setActiveStaffCount(0);
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

    const initials = branchName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    const totalSales = orders.reduce(
        (sum, order) => sum + Number(order.total || 0),
        0
    );

    const totalRevenue = orders.reduce((orderSum, order) => {
        const orderRevenue = (order.items || []).reduce((itemSum, item) => {
            const product = products.find(
                (product) =>
                    product.name.trim().toLowerCase() ===
                    (item.name || "").trim().toLowerCase()
            );

            const sellingPrice = Number(
                product?.salesPrice ??
                product?.sales_price ??
                0
            );

            const originalPrice = Number(
                product?.originalPrice ??
                product?.original_price ??
                0
            );

            const quantity = Number(item.quantity || 1);

            return itemSum + Math.max(sellingPrice - originalPrice, 0) * quantity;
        }, 0);

        return orderSum + orderRevenue;
    }, 0);

    const totalBookings = bookings.length;
    const totalProducts = products.length;
    const lowStockItems = products.filter((p) => p.stock <= p.alertLevel);
    const recentBookings = bookings.slice(0, 3);

    const popularItems = Object.values(
        orders.reduce<Record<string, { name: string; quantity: number }>>((acc, order) => {
            (order.items || []).forEach((item) => {
                const name = item.name || "Unnamed item";
                const quantity = item.quantity || 0;

                if (!acc[name]) {
                    acc[name] = { name, quantity: 0 };
                }

                acc[name].quantity += quantity;
            });

            return acc;
        }, {})
    )
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
                .filter((order) => {
                    const orderDate =
                        order.date?.slice(0, 10) ||
                        order.orderDate?.slice(0, 10) ||
                        order.createdAt?.slice(0, 10) ||
                        "";

                    return orderDate === day.dateStr;
                })
                .reduce((sum, order) => sum + (order.total || 0), 0);

            return {
                label: day.label,
                total,
            };
        });

        const hasData = values.some((item) => item.total > 0);

        if (!hasData) {
            return [
                { label: "Mon", total: 35 },
                { label: "Tue", total: 52 },
                { label: "Wed", total: 44 },
                { label: "Thu", total: 58 },
                { label: "Fri", total: 86 },
                { label: "Sat", total: 50 },
                { label: "Sun", total: 38 },
            ];
        }

        return values;
    }, [orders]);

    const maxTrend = Math.max(...weeklyTrend.map((item) => item.total), 1);

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
                <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                        <StatCard
                            active
                            title="Total Sales"
                            value={canAccess("pos") ? `₱${totalSales.toLocaleString("en-PH")}` : "—"}
                            note={canAccess("pos") ? `₱${totalRevenue.toLocaleString("en-PH")} revenue` : "No access"}
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
                            note={canAccess("inventory") ? "Branch inventory only" : "No access"}
                            iconType="gold"
                        />

                        <StatCard
                            title="Active Staff"
                            value={canAccess("staff_management") ? String(activeStaffCount) : "—"}
                            note={
                                canAccess("staff_management")
                                    ? "Branch staff members"
                                    : "No access"
                            }
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
                                <EmptyText text="Weekly sales trend is hidden because POS access is not enabled." />
                            )}
                        </Card>

                        <Card className="min-h-[160px]">
                            <CardHeader title="Recent bookings" action="View all →" href="/bookings" />

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
                                            onRestock={() => {
                                                setSelectedProduct(product);
                                                setShowModal(true);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>
                </div>
            </section>

            {showModal && selectedProduct && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-[14px] bg-white p-5 shadow-xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-[16px] font-semibold text-[#1A1220]">
                                Restock Product
                            </h2>

                            <button
                                onClick={() => setShowModal(false)}
                                className="rounded-[7px] px-2 py-1 text-[#7A6E88] hover:bg-[#EEE8F8]"
                            >
                                ✕
                            </button>
                        </div>

                        <p className="mb-2 text-[11px] text-[#7A6E88]">Product</p>
                        <p className="mb-4 text-[13px] font-semibold text-[#1A1220]">
                            {selectedProduct.name}
                        </p>

                        <input
                            type="number"
                            placeholder="Add stock"
                            value={restockQty}
                            onChange={(e) => {
                                const val = e.target.value;
                                setRestockQty(val === "" ? "" : Number(val));
                            }}
                            className="mb-4 w-full rounded-[9px] border border-[#EBE4F0] bg-white p-3 text-[12px] text-[#1A1220] outline-none focus:border-[#2D1B4E] focus:ring-4 focus:ring-[#2D1B4E]/10"
                        />

                        <button
                            onClick={() => {
                                if (!selectedProduct || Number(restockQty) <= 0) return;

                                const updated = products.map((product) =>
                                    product.id === selectedProduct.id
                                        ? { ...product, stock: product.stock + Number(restockQty) }
                                        : product
                                );

                                setProducts(updated);
                                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                                localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                                setRestockQty("");
                                setSelectedProduct(null);
                                setShowModal(false);
                            }}
                            className="w-full rounded-[9px] bg-[#2D1B4E] py-2.5 text-[12px] font-semibold text-white hover:bg-[#3A2854]"
                        >
                            Save Restock
                        </button>
                    </div>
                </div>
            )}
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
                    }: {
    title: string;
    action?: string;
    href?: string;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="whitespace-nowrap text-[14px] font-medium leading-none text-[#1A1220]">
                {title}
            </h2>

            {action && href && (
                <Link
                    href={href}
                    className="shrink-0 whitespace-nowrap text-[9px] font-semibold leading-none text-[#2D1B4E] hover:underline"
                >
                    {action}
                </Link>
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
                <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#7A6E88]">
                        {label}
                    </p>
                </div>

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
                            onRestock,
                        }: {
    name: string;
    branch: string;
    quantity: string;
    onRestock?: () => void;
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

            <button
                onClick={onRestock}
                className="ml-2 shrink-0 rounded-[7px] bg-[#EEE8F8] px-2.5 py-1.5 text-[9px] font-semibold text-[#2D1B4E]"
            >
                Restock
            </button>
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

