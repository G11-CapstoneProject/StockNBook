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
  const [products, setProducts] = useState<Product[]>([]);

  // ✅ ADDED bookings state
  const [bookings, setBookings] = useState<any[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setProducts(JSON.parse(saved));

    // ✅ LOAD BOOKINGS
    const storedBookings =
      JSON.parse(localStorage.getItem("partypro_bookings") || "[]");
    setBookings(storedBookings);
  }, []);

  const totalProducts = products.length;

  const lowStockItems = products.filter(
    (p) => p.stock <= p.alertLevel
  ).length;

  // ✅ ADDED total bookings
  const totalBookings = bookings.length;

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
            <div className="rounded-xl px-4 py-3 text-white/90">POS / Sales</div>
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
            <h2 className="mt-2 text-3xl font-bold text-[#172554]">₱0</h2>
          </div>
        </div>

        {/* SALES TREND */}
        <div className="mt-6 grid gap-5 lg:grid-cols-2">

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-[#1f2a44] mb-6">
              Sales Trends (Last 7 Days)
            </h3>

            <div className="flex items-end justify-between h-32 px-2">
              {[20, 35, 25, 40, 30, 50, 45].map((h, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div
                    className="w-4 rounded bg-purple-500"
                    style={{ height: `${h}%` }}
                  ></div>
                  <span className="text-xs text-gray-400">
                    {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* POPULAR ITEMS */}
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-[#1f2a44]">Popular Items</h3>
            <p className="mt-3 text-gray-500">No sales data yet</p>
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
                  <div key={b.id} className="text-sm">
                    📅 {b.date} — {b.name}
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

                      <button className="rounded-lg bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600">
                        Restock
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}