"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CartMap = { [key: number]: number };

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
  name: string;
  quantity: number;
};

type Order = {
  id: string;
  customer: string;
  items: OrderItem[];
  total: number;
  date: string;
};

export default function POSPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [cart, setCart] = useState<CartMap>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [storeName, setStoreName] = useState("Store Name");

  useEffect(() => {
    const stored = JSON.parse(
        localStorage.getItem("stocknbook_inventory_products") || "[]"
    ) as Product[];
    setProducts(stored);

    const savedStoreName =
        localStorage.getItem("store_name") ||
        localStorage.getItem("stocknbook_store_name") ||
        "Store Name";
    setStoreName(savedStoreName);
  }, []);

  useEffect(() => {
    const storedOrders = JSON.parse(
        localStorage.getItem("stocknbook_orders") || "[]"
    ) as Order[];
    setOrders(storedOrders);
  }, []);

  const handleQty = (id: number, change: number) => {
    setCart((prev) => {
      const current = prev[id] || 0;
      const next = Math.max(0, current + change);
      return { ...prev, [id]: next };
    });
  };

  const total = Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find((x) => x.id === Number(id));
    return sum + (p ? p.salesPrice * qty : 0);
  }, 0);

  const handleSubmit = () => {
    for (const [id, qty] of Object.entries(cart)) {
      const p = products.find((x) => x.id === Number(id));
      if (p && qty > p.stock) {
        alert(`Not enough stock for ${p.name}`);
        return;
      }
    }

    const existingOrders = JSON.parse(
        localStorage.getItem("stocknbook_orders") || "[]"
    ) as Order[];

    const customerNumber = existingOrders.length + 1;
    const customerName = `Customer ${customerNumber}`;

    const items = Object.entries(cart)
        .map(([id, qty]) => {
          const p = products.find((x) => x.id === Number(id));
          return p ? { name: p.name, quantity: qty } : null;
        })
        .filter(Boolean) as OrderItem[];

    const newOrder: Order = {
      id: `#${Date.now().toString().slice(-4)}`,
      customer: customerName,
      items,
      total,
      date: new Date().toLocaleDateString("en-CA"),
    };

    const updatedOrders = [newOrder, ...existingOrders];
    localStorage.setItem("stocknbook_orders", JSON.stringify(updatedOrders));
    setOrders(updatedOrders);

    const updatedProducts = products.map((p) => {
      const qty = cart[p.id] || 0;
      return { ...p, stock: p.stock - qty };
    });

    localStorage.setItem(
        "stocknbook_inventory_products",
        JSON.stringify(updatedProducts)
    );
    setProducts(updatedProducts);

    setShowModal(false);
    setCart({});
  };

  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const averageOrderValue =
      orders.length > 0 ? (totalSales / orders.length).toFixed(2) : "0.00";

  return (
      <div className="flex min-h-screen bg-[#f5f6f8]">
        <aside className="flex min-h-screen w-52 flex-col justify-between bg-linear-to-b from-[#5f6ee7] to-[#d786e8] text-white">
          <div>
            <div className="px-3 pt-3">
              <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <h1 className="text-sm font-bold">StockNBook</h1>
              </div>

              <div className="mt-2 rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <p className="text-xs font-semibold text-white">{storeName}</p>
                <p className="mt-1 text-[9px] uppercase tracking-[0.15em] text-white/60">
                  Store Owner
                </p>
              </div>
            </div>

            <nav className="mt-3 px-2 pb-4">
              <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                Core
              </p>

              <div className="space-y-1">
                <Link
                    href="/admin"
                    className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
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
                    className="block rounded-lg bg-white/20 px-3 py-2 text-xs font-medium"
                >
                  Sales / POS
                </Link>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                Analytics
              </p>

              <div className="space-y-1">
                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Forecasting
                </div>
              </div>

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

          <div className="px-2 pb-3">
            <Link
                href="/"
                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
            >
              Logout
            </Link>
          </div>
        </aside>

        <main className="flex-1 p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#1f2a44]">Point of Sale</h1>
              <p className="mt-1 text-sm text-gray-500">
                Record orders and manage sales
              </p>
            </div>

            <button
                onClick={() => setShowModal(true)}
                className="rounded-xl bg-linear-to-r from-[#6c63ff] to-[#d786e8] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
            >
              + New Order
            </button>
          </div>

          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Today&apos;s Sales</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1f2a44]">
                ₱{totalSales.toFixed(2)}
              </h2>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Orders Today</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1f2a44]">
                {orders.length}
              </h2>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Average Order Value</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1f2a44]">
                ₱{averageOrderValue}
              </h2>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h3 className="text-sm font-semibold text-[#1f2a44]">Recent Orders</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Order ID</th>
                  <th className="px-5 py-3 text-left font-semibold">Customer</th>
                  <th className="px-5 py-3 text-left font-semibold">Items</th>
                  <th className="px-5 py-3 text-left font-semibold">Total</th>
                  <th className="px-5 py-3 text-left font-semibold">Date</th>
                </tr>
                </thead>

                <tbody>
                {orders.length === 0 ? (
                    <tr>
                      <td
                          colSpan={5}
                          className="px-5 py-10 text-center text-sm text-gray-400"
                      >
                        No orders yet
                      </td>
                    </tr>
                ) : (
                    orders.map((o) => (
                        <tr key={o.id} className="border-t border-gray-100">
                          <td className="px-5 py-4 text-gray-600">{o.id}</td>
                          <td className="px-5 py-4 text-gray-600">{o.customer}</td>
                          <td className="px-5 py-4 text-gray-600">
                            {Array.isArray(o.items)
                                ? o.items
                                    .map((item) => `${item.name} x${item.quantity}`)
                                    .join(", ")
                                : ""}
                          </td>
                          <td className="px-5 py-4 font-medium text-gray-700">
                            ₱{o.total.toFixed(2)}
                          </td>
                          <td className="px-5 py-4 text-gray-600">{o.date}</td>
                        </tr>
                    ))
                )}
                </tbody>
              </table>
            </div>
          </div>

          {showModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                  <div className="mb-4 flex justify-between">
                    <div>
                      <h2 className="font-semibold text-[#1f2a44]">New Order</h2>
                      <p className="text-sm text-gray-400">Customer {orders.length + 1}</p>
                    </div>
                    <button
                        onClick={() => setShowModal(false)}
                        className="text-gray-500 hover:text-black"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="max-h-52 space-y-2 overflow-y-auto">
                    {products.length === 0 ? (
                        <p className="py-4 text-center text-sm text-gray-400">
                          No products in inventory
                        </p>
                    ) : (
                        products.map((p) => (
                            <div key={p.id} className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-black">{p.name}</p>
                                <p className="text-xs">
                                  {p.stock <= 0 ? (
                                      <span className="font-medium text-red-500">
                              Out of Stock
                            </span>
                                  ) : (
                                      <span className="text-gray-500">
                              ₱{p.salesPrice} • Stock {p.stock}
                            </span>
                                  )}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100"
                                    onClick={() => handleQty(p.id, -1)}
                                >
                                  -
                                </button>

                                <span className="min-w-[20px] text-center font-medium text-black">
                          {cart[p.id] || 0}
                        </span>

                                <button
                                    disabled={(cart[p.id] || 0) >= p.stock}
                                    className={`rounded border px-2 py-1 ${
                                        (cart[p.id] || 0) >= p.stock
                                            ? "cursor-not-allowed bg-gray-200 text-gray-400"
                                            : "border-gray-300 hover:bg-gray-100"
                                    }`}
                                    onClick={() => handleQty(p.id, 1)}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                        ))
                    )}
                  </div>

                  <div className="mt-4 flex justify-between font-medium text-black">
                    <span>Order Total:</span>
                    <span>₱{total.toFixed(2)}</span>
                  </div>

                  <button
                      onClick={handleSubmit}
                      className="mt-4 w-full rounded-lg bg-linear-to-r from-purple-500 to-pink-500 py-2 text-white hover:opacity-90"
                  >
                    Complete Order
                  </button>
                </div>
              </div>
          )}
        </main>
      </div>
  );
}