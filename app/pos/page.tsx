"use client";

import Link from "next/link";
import { useEffect, useState } from "react"; // ✅ ADDED

export default function POSPage() {
  const [orders, setOrders] = useState<any[]>([]);

  // ✅ ADDED STATES
  const [showModal, setShowModal] = useState(false);
  const [customer, setCustomer] = useState("");
  const [cart, setCart] = useState<{ [key: number]: number }>({});
  const [products, setProducts] = useState<any[]>([]);

  // ✅ LOAD PRODUCTS FROM INVENTORY
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("partypro_inventory_products") || "[]");
    setProducts(stored);
  }, []);

  useEffect(() => {
  const storedOrders = JSON.parse(localStorage.getItem("partypro_orders") || "[]");
  setOrders(storedOrders);
  }, []);

  // ✅ HANDLE QUANTITY
  const handleQty = (id: number, change: number) => {
    setCart((prev) => {
      const current = prev[id] || 0;
      const next = Math.max(0, current + change);
      return { ...prev, [id]: next };
    });
  };

  // ✅ COMPUTE TOTAL
  const total = Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find((x) => x.id === Number(id));
    return sum + (p ? p.salesPrice * qty : 0);
  }, 0);

  const handleSubmit = () => {
  if (!customer) return alert("Enter customer name");

  // ✅ STOCK VALIDATION
  for (const [id, qty] of Object.entries(cart)) {
    const p = products.find((x) => x.id === Number(id));
    if (p && qty > p.stock) {
      alert(`Not enough stock for ${p.name}`);
      return;
    }
  }

  const existingOrders = JSON.parse(localStorage.getItem("partypro_orders") || "[]");

  // ✅ ITEMS
  const items = Object.entries(cart)
    .map(([id, qty]) => {
      const p = products.find((x) => x.id === Number(id));
      return p
        ? {
            name: p.name,
            quantity: qty,
          }
        : null;
    })
    .filter(Boolean);

  // ✅ NEW ORDER
  const newOrder = {
    id: `#${Date.now().toString().slice(-4)}`,
    customer,
    items,
    total,
    date: new Date().toISOString().split("T")[0],
  };

  const updatedOrders = [newOrder, ...existingOrders];
  localStorage.setItem("partypro_orders", JSON.stringify(updatedOrders));
  setOrders(updatedOrders);

  // ✅ UPDATE INVENTORY
  const updatedProducts = products.map((p) => {
    const qty = cart[p.id] || 0;
    return {
      ...p,
      stock: p.stock - qty,
    };
  });

  localStorage.setItem(
    "partypro_inventory_products",
    JSON.stringify(updatedProducts)
  );

  setProducts(updatedProducts);

  // ✅ RESET
  setShowModal(false);
  setCart({});
  setCustomer("");
};

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
            <Link href="/admin" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">Dashboard</Link>
            <Link href="/inventory" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">Inventory</Link>
            <Link href="/bookings" className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">Bookings</Link>
            <div className="rounded-xl px-4 py-3 text-white/90">Calendar</div>
            <Link
              href="/pos"
              className="block rounded-xl bg-white/20 px-4 py-3 font-medium"
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#1f2a44]">Point of Sale</h1>
            <p className="text-gray-500">Record orders and manage sales</p>
          </div>

          {/* ✅ ADDED CLICK */}
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-[#6c63ff] to-[#d786e8] px-5 py-2 text-white font-medium shadow-sm hover:opacity-90"
          >
            + New Order
          </button>
        </div>

        {/* STATS */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Today's Sales</p>
            <h2 className="text-2xl font-bold mt-2 text-[#1f2a44]">
              ₱{orders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}
            </h2>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Orders Today</p>
            <h2 className="text-2xl font-bold mt-2 text-[#1f2a44]">
              {orders.length}
            </h2>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Average Order Value</p>
            <h2 className="text-2xl font-bold mt-2 text-[#1f2a44]">
              ₱
              {orders.length > 0
                ? (orders.reduce((sum, o) => sum + o.total, 0) / orders.length).toFixed(2)
                : "0.00"}
            </h2>
          </div>
        </div>

        {/* TABLE */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold text-[#1f2a44]">Recent Orders</h3>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-6 py-3">ORDER ID</th>
                <th className="text-left px-6 py-3">CUSTOMER</th>
                <th className="text-left px-6 py-3">ITEMS</th>
                <th className="text-left px-6 py-3">TOTAL</th>
                <th className="text-left px-6 py-3">DATE</th>
              </tr>
            </thead>

            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t">
                <td className="px-6 py-4 text-gray-600">{o.id}</td>
                <td className="px-6 py-4 text-gray-600">{o.customer}</td>
                <td className="px-6 py-4 text-gray-600">
                {Array.isArray(o.items)
                  ? o.items.map((item: any) => `${item.name} x${item.quantity}`).join(", ")
                  : o.items}
              </td>
                <td className="px-6 py-4 text-gray-600 font-medium">
                    ₱{o.total.toFixed(2)}
                </td>
                <td className="px-6 py-4 text-gray-600">{o.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ✅ ADDED MODAL */}
        {/* MODAL */}
        {showModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">

              <div className="flex justify-between mb-4">
                <h2 className="font-semibold text-[#1f2a44]">New Order</h2>
                <button onClick={() => setShowModal(false)}>✕</button>
              </div>

              <input
                placeholder="Customer Name"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                className="border border-gray-300 w-full p-2 mb-4 rounded text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
              />

              <div className="max-h-40 overflow-y-auto space-y-2">
                {products.map((p) => (
                  <div key={p.id} className="flex justify-between items-center">
                    <div>
                      <p className="text-black font-medium">{p.name}</p>
                      <p className="text-xs">
                        {p.stock <= 0 ? (
                          <span className="text-red-500 font-medium">Out of Stock</span>
                        ) : (
                          <span className="text-gray-500">
                            ₱{p.salesPrice} • Stock {p.stock}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-100"
                        onClick={() => handleQty(p.id, -1)}
                      >
                        -
                      </button>

                      <span className="text-black font-medium">
                        {cart[p.id] || 0}
                      </span>

                      <button
                        disabled={(cart[p.id] || 0) >= p.stock}
                        className={`px-2 py-1 border rounded ${
                          (cart[p.id] || 0) >= p.stock
                            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                            : "border-gray-300 hover:bg-gray-100"
                        }`}
                        onClick={() => handleQty(p.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-between font-medium text-black">
                <span>Order Total:</span>
                <span>₱{total.toFixed(2)}</span>
              </div>

              <button
                onClick={handleSubmit}
                className="w-full mt-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded"
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