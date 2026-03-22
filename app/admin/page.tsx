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

const STORAGE_KEY = "partypro_inventory_products";

export default function AdminDashboard() {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState<number | "">("");
  
  useEffect(() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) setProducts(JSON.parse(saved));

  const storedBookings =
    JSON.parse(localStorage.getItem("partypro_bookings") || "[]");
  setBookings(storedBookings);

  const storedOrders =
    JSON.parse(localStorage.getItem("partypro_orders") || "[]");

  console.log("ORDERS:", storedOrders); // 👈 HERE

  setOrders(storedOrders);
}, []);


  const totalProducts = products.length;

  const lowStockItems = products.filter(
    (p) => p.stock <= p.alertLevel
  ).length;

  // ✅ ADDED total bookings
  const totalBookings = bookings.length;

  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  
  // ==========================
// 📊 SALES TRENDS (SAFE VERSION)
// ==========================
const today = new Date();

const last7Days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(today); // ✅ clone today

  d.setDate(today.getDate() - (6 - i)); // always relative to today

  return {
    label: d.toLocaleDateString("en-US", { weekday: "short" }),
    dateStr: d.toISOString().split("T")[0],
  };
});

const salesData = last7Days.map((day) => {
  const total = orders
    .filter((o) => {
      if (!o?.date) return false;

      // 🔥 convert "19/03/2026" → "2026-03-19"
      return o.date === day.dateStr;
    })
    .reduce((sum, o) => sum + (o?.total || 0), 0);

  return {
    label: day.label,
    total,
  };
});

const maxSales = Math.max(...salesData.map((d) => d.total), 1);

const salesHeights = salesData.map((d) =>
  Math.round((d.total / maxSales) * 100)
);


// ==========================
// ⭐ POPULAR ITEMS (SAFE VERSION)
// ==========================
const productCounts: Record<string, number> = {};

orders.forEach((order) => {
  if (!Array.isArray(order.items)) return;

  order.items.forEach((item: any) => {
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
      
      {/* SIDEBAR */}
      <aside className="w-64 bg-gradient-to-b from-[#5f6ee7] to-[#d786e8] text-white flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 border-b border-white/20 px-5 py-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black">
              🎉
            </div>
            <div>
              <h1 className="font-bold">PartyPro</h1>
              <p className="text-sm text-white/80">Admin Dashboard</p>
            </div>
          </div>

          <nav className="mt-4 space-y-2 px-3">
            <Link href="/admin" className="block rounded-xl bg-white/20 px-4 py-3 font-medium">
              Dashboard
            </Link>

            <Link href="/inventory" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">
              Inventory
            </Link>

            <Link href="/bookings" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">
              Bookings
            </Link>

            <div className="rounded-xl px-4 py-3 text-white/90">Calendar</div>
            <Link
              href="/pos"
              className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10"
            >
              POS / Sales
            </Link>
            <div className="rounded-xl px-4 py-3 text-white/90">Forecasting</div>
          </nav>
        </div>

        <Link href="/" className="block border-t border-white/20 px-5 py-5 text-white/90 hover:bg-white/10">
          Exit Admin
        </Link>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-6">

        {/* HEADER */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-[#1f2a44]">
            Dashboard Overview
          </h1>
          <p className="text-gray-500">
            Welcome back! Here's what's happening today.
          </p>
        </div>

        {/* STATS */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

          {/* BOOKINGS */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">Total Bookings</div>
              <div className="bg-purple-100 text-purple-600 p-2 rounded-lg">📅</div>
            </div>
            {/* ✅ NOW DYNAMIC */}
            <h2 className="mt-2 text-3xl font-bold text-[#172554]">
              {totalBookings}
            </h2>
          </div>

          {/* PRODUCTS */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">Total Products</div>
              <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">📦</div>
            </div>
            <h2 className="mt-2 text-3xl font-bold text-[#172554]">
              {totalProducts}
            </h2>
          </div>

          {/* LOW STOCK */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">Low Stock Items</div>
              <div className="bg-red-100 text-red-600 p-2 rounded-lg">⚠️</div>
            </div>
            <h2 className="mt-2 text-3xl font-bold text-[#172554]">
              {lowStockItems}
            </h2>
          </div>

          {/* SALES */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">Total Sales</div>
              <div className="bg-green-100 text-green-600 p-2 rounded-lg">💰</div>
            </div>
            <h2 className="mt-2 text-3xl font-bold text-[#172554]">
              ₱{totalSales.toFixed(2)}
            </h2>
          </div>
        </div>

        {/* SALES TREND */}
        <div className="mt-6 grid gap-5 lg:grid-cols-2">

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-[#1f2a44] mb-6">
              Sales Trends (Last 7 Days)
            </h3>

            <div className="flex items-end justify-between h-40 px-2 border-b">
              {salesHeights.map((h, i) => (
                <div key={i} className="flex flex-col items-center justify-end h-full">
                  
                  {/* BAR */}
                  <div
                    className={`w-6 rounded ${
                      i === 6 ? "bg-purple-700" : "bg-purple-400"
                    }`}
                    style={{ height: `${h}%` }}
                  ></div>

                  {/* LABEL */}
                  <span className="text-xs text-gray-400 mt-2">
                    {salesData[i].label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* POPULAR ITEMS */}
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-[#1f2a44]">Popular Items</h3>
            {popularItems.length === 0 ? (
              <p className="mt-3 text-gray-500">No sales data yet</p>
            ) : (
              <div className="mt-3 space-y-2">
                {popularItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-[#1f2a44] font-medium">
                      {item.name}
                    </span>
                    <span className="text-gray-500">
                      {item.qty} sold
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* LOWER */}
        <div className="mt-6 grid gap-5 lg:grid-cols-2">

          {/* ✅ UPDATED UPCOMING EVENTS */}
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-[#1f2a44]">Upcoming Events</h3>

            {bookings.length === 0 ? (
              <p className="mt-3 text-gray-500">No upcoming events</p>
            ) : (
              <div className="mt-3 space-y-2">
                {bookings.slice(0, 3).map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-2 text-sm text-[#1f2a44] font-medium"
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

          {/* LOW STOCK LIST */}
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-[#1f2a44] mb-4">
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
                        <span className="text-red-500 text-lg">⚠️</span>

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
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">

              {/* HEADER */}
              <div className="flex justify-between mb-4">
                <h2 className="font-semibold text-[#1f2a44]">
                  Restock Product
                </h2>
                <button onClick={() => setShowModal(false)}>✕</button>
              </div>

              {/* PRODUCT INFO */}
              <p className="text-sm text-gray-500 mb-2">Product</p>
              <p className="font-medium text-black mb-4">
                {selectedProduct.name}
              </p>

              {/* STOCK INPUT */}
              <input
                type="number"
                placeholder="Add stock"
                value={restockQty}
                onChange={(e) => {
                  const val = e.target.value;
                  setRestockQty(val === "" ? "" : Number(val));
                }}
                className="w-full p-2 rounded mb-4 text-black border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
              />

              {/* BUTTON */}
              <button
                onClick={() => {
                  if (!selectedProduct || Number(restockQty) <= 0) return;

                  const updated = products.map((prod) =>
                    prod.id === selectedProduct.id
                      ? { ...prod, stock: prod.stock + Number(restockQty) }
                      : prod
                  );

                  // ✅ update UI
                  setProducts(updated);

                  // ✅ update localStorage
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

                  // ✅ reset everything
                  setRestockQty(0);
                  setSelectedProduct(null);
                  setShowModal(false);
                }}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded"
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