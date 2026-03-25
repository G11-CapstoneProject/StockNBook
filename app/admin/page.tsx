"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Product = {
    id: number;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
};

type OrderItem = {
    name?: string;
    quantity?: number;
};

type Order = {
    total?: number;
    date?: string;
    items?: OrderItem[];
};

type Booking = {
    id: number;
    date: string;
    name: string;
};

const STORAGE_KEY = "stocknbook_inventory_products";
const hour = new Date().getHours();

const greeting =
    hour < 12
        ? "Good Morning"
        : hour < 18
            ? "Good Afternoon"
            : "Good Evening";

export default function AdminDashboard() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [restockQty, setRestockQty] = useState<number | "">("");
    const [storeName, setStoreName] = useState("Store Owner");

    useEffect(() => {
        const loadData  = async () => {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) setProducts(JSON.parse(saved) as Product[]);

            const token = localStorage.getItem("token");

            if (token) {
                try {
                    const res = await fetch("/api/bookings", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_bookings",
                        }),
                    });

                    const text = await res.text();
                    console.log("ADMIN DASHBOARD BOOKINGS RAW:", res.status, text);

                    const data = JSON.parse(text);

                    if (res.ok) {
                        setBookings(data.bookings || []);
                    } else {
                        setBookings([]);
                    }
                } catch (error) {
                    console.warn("Dashboard bookings fetch failed:", error);
                    setBookings([]);
                }
            } else {
                setBookings([]);
            }

            const storedOrders = JSON.parse(
                localStorage.getItem("stocknbook_orders") || "[]"
            ) as Order[];
            setOrders(storedOrders);

            const savedStoreName =
                localStorage.getItem("store_name") ||
                localStorage.getItem("stocknbook_store_name") ||
                localStorage.getItem("owner_name");

            if (savedStoreName) {
                setStoreName(savedStoreName);
            }
        };

        loadData();

        window.addEventListener("focus", loadData);

        return () => {
            window.removeEventListener("focus", loadData);
        };
    }, []);

    const totalProducts = products.length;
    const lowStockItems = products.filter((p) => p.stock <= p.alertLevel).length;
    const totalBookings = bookings.length;
    const totalSales = orders.reduce((sum, o) => sum + (o.total || 0), 0);

    const today = new Date();

    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (6 - i));

        return {
            label: d.toLocaleDateString("en-US", { weekday: "short" }),
            dateStr: d.toISOString().split("T")[0],
        };
    });

    const salesData = last7Days.map((day) => {
        const total = orders
            .filter((o) => {
                if (!o?.date) return false;
                return o.date === day.dateStr;
            })
            .reduce((sum, o) => sum + (o.total || 0), 0);

        return {
            label: day.label,
            total,
        };
    });

    const maxSales = Math.max(...salesData.map((d) => d.total), 1);

    const salesHeights = salesData.map((d) =>
        Math.round((d.total / maxSales) * 100)
    );

    const productCounts: Record<string, number> = {};

    orders.forEach((order) => {
        if (!Array.isArray(order.items)) return;

        order.items.forEach((item) => {
            if (!item?.name) return;

            if (!productCounts[item.name]) {
                productCounts[item.name] = 0;
            }

            productCounts[item.name] += item.quantity || 0;
        });
    });

    const popularItems = Object.entries(productCounts)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    return (
        <div className="min-h-screen flex bg-[#f5f6f8]">
            <aside className="flex min-h-screen w-52 flex-col justify-between bg-linear-to-b from-[#5f6ee7] to-[#d786e8] text-white">
                <div>
                    {/* Brand */}
                    <div className="px-3 pt-3">
                        <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                            <h1 className="text-sm font-bold">StockNBook</h1>
                        </div>

                        {/* Store Owner */}
                        <div className="mt-2 rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                            <p className="text-xs font-semibold text-white">
                                {storeName}
                            </p>
                            <p className="mt-1 text-[9px] uppercase tracking-[0.15em] text-white/60">
                                Store Owner
                            </p>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="mt-3 px-2 pb-4">
                        {/* Core */}
                        <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            Core
                        </p>

                        <div className="space-y-1">
                            <Link
                                href="/admin"
                                className="block rounded-lg bg-white/20 px-3 py-2 text-xs font-medium"
                            >
                                Dashboard
                            </Link>

                            <Link
                                href="/bookings"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Bookings
                            </Link>

                            <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                                Calendar
                            </div>
                        </div>

                        {/* Business */}
                        <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            Business
                        </p>

                        <div className="space-y-1">
                            <Link
                                href="/inventory"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Inventory
                            </Link>

                            <Link
                                href="/pos"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Sales / POS
                            </Link>
                        </div>

                        {/* Analytics */}
                        <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            Analytics
                        </p>

                        <div className="space-y-1">
                            <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                                Forecasting
                            </div>
                        </div>

                        {/* System */}
                        <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            System
                        </p>

                        <div className="space-y-1">
                            <Link
                                href="/booking-link"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Booking Link
                            </Link>

                            <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                                Settings
                            </div>
                        </div>
                    </nav>
                </div>

                {/* Logout */}
                <div className="px-2 pb-3">
                    <Link
                        href="/"
                        className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                    >
                        Logout
                    </Link>
                </div>
            </aside>

            <main className="flex-1 p-6">
                <div className="mb-6">
                    <p className="text-xl font-semibold text-[#1f2a44]">Dashboard</p>
                    <p className="text-sm font-medium text-black">
                        {new Date().toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                        })}
                    </p>
                </div>

                <div className="relative mb-6 overflow-hidden rounded-2xl bg-linear-to-r from-[#5f6ee7] to-[#a855f7] p-6 text-white shadow-sm">

                    {/* GLOW EFFECT */}
                    <div className="absolute right-0 top-0 h-40 w-40 translate-x-1/3 -translate-y-1/3 rounded-full bg-white/20 blur-2xl" />
                    <div className="absolute bottom-0 right-10 h-32 w-32 rounded-full bg-pink-300/20 blur-2xl" />

                    <div className="relative flex items-center justify-between">

                        {/* LEFT */}
                        <div>
                            <p className="mb-1 text-xs text-white/80">Welcome back 👋</p>

                            <h2 className="text-2xl font-bold">
                                {greeting}{storeName ? `, ${storeName}!` : "!"}
                            </h2>

                            <p className="mt-1 text-sm text-white/80">
                                You have {totalBookings} bookings today. Revenue is up this week.
                            </p>
                        </div>

                        {/* RIGHT */}
                        <Link
                            href="/bookings"
                            className="rounded-xl bg-white/20 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/30"
                        >
                            View Today’s Bookings
                        </Link>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500">Total Bookings</div>
                            <div className="rounded-lg bg-purple-100 p-2 text-purple-600">📅</div>
                        </div>
                        <h2 className="mt-2 text-3xl font-bold text-[#172554]">
                            {totalBookings}
                        </h2>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500">Total Products</div>
                            <div className="rounded-lg bg-blue-100 p-2 text-blue-600">📦</div>
                        </div>
                        <h2 className="mt-2 text-3xl font-bold text-[#172554]">
                            {totalProducts}
                        </h2>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500">Low Stock Items</div>
                            <div className="rounded-lg bg-red-100 p-2 text-red-600">⚠️</div>
                        </div>
                        <h2 className="mt-2 text-3xl font-bold text-[#172554]">
                            {lowStockItems}
                        </h2>
                    </div>

                    <div className="rounded-2xl bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500">Total Sales</div>
                            <div className="rounded-lg bg-green-100 p-2 text-green-600">💰</div>
                        </div>
                        <h2 className="mt-2 text-3xl font-bold text-[#172554]">
                            ₱{totalSales.toFixed(2)}
                        </h2>
                    </div>
                </div>

                <div className="mt-6 grid gap-5 lg:grid-cols-2">
                    <div className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="mb-6 font-semibold text-[#1f2a44]">
                            Sales Trends (Last 7 Days)
                        </h3>

                        <div className="flex h-40 items-end justify-between border-b px-2">
                            {salesHeights.map((h, i) => (
                                <div
                                    key={i}
                                    className="flex h-full flex-col items-center justify-end"
                                >
                                    <div
                                        className={`w-6 rounded ${
                                            i === 6 ? "bg-purple-700" : "bg-purple-400"
                                        }`}
                                        style={{ height: `${h}%` }}
                                    />
                                    <span className="mt-2 text-xs text-gray-400">
                    {salesData[i].label}
                  </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="font-semibold text-[#1f2a44]">Popular Items</h3>
                        {popularItems.length === 0 ? (
                            <p className="mt-3 text-gray-500">No sales data yet</p>
                        ) : (
                            <div className="mt-3 space-y-2">
                                {popularItems.map((item, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                    <span className="font-medium text-[#1f2a44]">
                      {item.name}
                    </span>
                                        <span className="text-gray-500">{item.qty} sold</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 grid gap-5 lg:grid-cols-2">
                    <div className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="font-semibold text-[#1f2a44]">Upcoming Events</h3>

                        {bookings.length === 0 ? (
                            <p className="mt-3 text-gray-500">No upcoming events</p>
                        ) : (
                            <div className="mt-3 space-y-2">
                                {bookings.slice(0, 3).map((b) => (
                                    <div
                                        key={b.id}
                                        className="flex items-center gap-2 text-sm font-medium text-[#1f2a44]"
                                    >
                                        <span className="text-purple-500">📅</span>
                                        <span>{b.date}</span>
                                        <span className="text-gray-400">—</span>
                                        <span className="font-semibold">{b.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="mb-4 font-semibold text-[#1f2a44]">
                            Low Stock Alerts
                        </h3>

                        {products.filter((p) => p.stock <= p.alertLevel).length === 0 ? (
                            <p className="text-gray-500">All items are well stocked</p>
                        ) : (
                            <div className="space-y-3">
                                {products
                                    .filter((p) => p.stock <= p.alertLevel)
                                    .map((p) => (
                                        <div
                                            key={p.id}
                                            className="flex items-center justify-between rounded-xl bg-red-50 px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-lg text-red-500">⚠️</span>

                                                <div>
                                                    <p className="text-sm font-medium text-[#1f2a44]">
                                                        {p.name}
                                                    </p>
                                                    <p className="text-xs text-red-500">
                                                        Only {p.stock} left (Alert: {p.alertLevel})
                                                    </p>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => {
                                                    setSelectedProduct(p);
                                                    setShowModal(true);
                                                }}
                                                className="rounded-lg bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
                                            >
                                                Restock
                                            </button>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>

                {showModal && selectedProduct && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                            <div className="mb-4 flex justify-between">
                                <h2 className="font-semibold text-[#1f2a44]">
                                    Restock Product
                                </h2>
                                <button onClick={() => setShowModal(false)}>✕</button>
                            </div>

                            <p className="mb-2 text-sm text-gray-500">Product</p>
                            <p className="mb-4 font-medium text-black">
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
                                className="mb-4 w-full rounded border border-gray-300 p-2 text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-400"
                            />

                            <button
                                onClick={() => {
                                    if (!selectedProduct || Number(restockQty) <= 0) return;

                                    const updated = products.map((prod) =>
                                        prod.id === selectedProduct.id
                                            ? { ...prod, stock: prod.stock + Number(restockQty) }
                                            : prod
                                    );

                                    setProducts(updated);
                                    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                                    setRestockQty(0);
                                    setSelectedProduct(null);
                                    setShowModal(false);
                                }}
                                className="w-full rounded bg-linear-to-r from-purple-500 to-pink-500 py-2 text-white"
                            >
                                Save Restock
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}