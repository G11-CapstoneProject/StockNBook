"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

type ProductApiRaw = {
  id: number | string;
  name: string;
  category: string;
  stock?: number | string;
  alertLevel?: number | string;
  alert_level?: number | string;
  originalPrice?: number | string;
  original_price?: number | string;
  salesPrice?: number | string;
  sales_price?: number | string;
};

type Category = {
  id: number;
  categoryName: string;
  description?: string;
};

type ProductsApiResponse = {
  success?: boolean;
  products?: ProductApiRaw[];
  error?: string;
};

type CategoryApiResponse = {
  success?: boolean;
  categories?: Category[];
  error?: string;
};

type PosOrdersApiResponse = {
  success?: boolean;
  orders?: ApiOrder[];
  error?: string;
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

type ApiOrder = {
  orderId: string;
  customerName: string;
  item?: string;
  total?: number;
  orderDate: string;
  createdAt?: string;
};

const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
    }).format(n);

const mapProduct = (p: ProductApiRaw): Product => ({
  id: Number(p.id),
  name: String(p.name ?? ""),
  category: String(p.category ?? ""),
  stock: Number(p.stock ?? 0),
  alertLevel: Number(p.alertLevel ?? p.alert_level ?? 0),
  originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
  salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
});

const readProducts = (): Product[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem("stocknbook_inventory_products");
    const parsed = raw ? (JSON.parse(raw) as Product[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readOrders = (): Order[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem("stocknbook_orders");
    const parsed = raw ? (JSON.parse(raw) as Order[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readCategories = (): Category[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem("stocknbook_categories");
    const parsed = raw ? (JSON.parse(raw) as Category[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readStoreName = (): string => {
  if (typeof window === "undefined") return "Store Name";
  return (
      localStorage.getItem("store_name") ||
      localStorage.getItem("stocknbook_store_name") ||
      "Store Name"
  );
};

export default function POSPage() {
  const [orders, setOrders] = useState<Order[]>(() => readOrders());
  const [cart, setCart] = useState<CartMap>({});
  const [products, setProducts] = useState<Product[]>(() => readProducts());
  const [manualCategories, setManualCategories] = useState<Category[]>(() => readCategories());
  const [storeName] = useState<string>(() => readStoreName());

  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState<string>("");

  useEffect(() => {
    const loadFromApi = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const [productsRes, categoriesRes] = await Promise.all([
          fetch("/api/products", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: "get_products" }),
          }),
          fetch("/api/categories", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: "get_categories" }),
          }),
        ]);

        const productsData = (await productsRes.json()) as ProductsApiResponse;
        const categoriesData = (await categoriesRes.json()) as CategoryApiResponse;

        if (productsRes.ok && Array.isArray(productsData.products)) {
          const mapped = productsData.products.map(mapProduct);
          setProducts(mapped);
          localStorage.setItem("stocknbook_inventory_products", JSON.stringify(mapped));
        }

        if (categoriesRes.ok && Array.isArray(categoriesData.categories)) {
          setManualCategories(categoriesData.categories);
          localStorage.setItem("stocknbook_categories", JSON.stringify(categoriesData.categories));
        }

        const ordersRes = await fetch("/api/pos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "get_orders" }),
        });

        const ordersData = (await ordersRes.json()) as PosOrdersApiResponse;

        if (ordersRes.ok && Array.isArray(ordersData.orders)) {
          const mapped = ordersData.orders.map((o) => {
            const safeDate =
                o.orderDate && o.orderDate !== "0000-00-00"
                    ? new Date(o.orderDate)
                    : o.createdAt
                        ? new Date(o.createdAt)
                        : new Date();

            return {
              id: o.orderId,
              customer: o.customerName,
              items: o.item
                  ? o.item.split(",").map((s: string) => {
                    const [name, qty] = s.split(" x");
                    return { name: name.trim(), quantity: Number(qty || 0) };
                  })
                  : [],
              total: Number(o.total || 0),
              date: safeDate.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              }),
            };
          });

          setOrders(mapped);
          localStorage.setItem("stocknbook_orders", JSON.stringify(mapped));
        }
      } catch (err) {
        console.warn("POS loadFromApi failed:", err);
      }
    };

    void loadFromApi();
  }, []);

  useEffect(() => {
    const sync = () => {
      setProducts(readProducts());
      setOrders(readOrders());
      setManualCategories(readCategories());
    };

    window.addEventListener("focus", sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const resetOrderDraft = () => {
    setCart({});
    setCategoryFilter("All");
    setSearch("");
    setPayment("");
  };

  const openNewOrder = () => {
    resetOrderDraft();
    setShowReceiptDialog(false);
    setShowOrderDialog(true);
  };

  const handleQty = (id: number, change: number) => {
    setCart((prev) => {
      const current = prev[id] || 0;
      const next = Math.max(0, current + change);
      return { ...prev, [id]: next };
    });
  };

  const setQty = (id: number, qty: number) => {
    const safe = Math.max(0, Math.floor(qty));
    setCart((prev) => ({ ...prev, [id]: safe }));
  };

  const removeItemFromCart = (productId: number) => {
    setCart((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const total = useMemo(() => {
    return Object.entries(cart).reduce((sum, [id, qty]) => {
      const p = products.find((x) => x.id === Number(id));
      return sum + (p ? Number(p.salesPrice || 0) * qty : 0);
    }, 0);
  }, [cart, products]);

  const effectiveTotal = total;

  const categories = useMemo(() => {
    const fromManual = manualCategories
        .map((c) => c.categoryName?.trim() || "")
        .filter(Boolean);

    const fromProducts = products
        .map((p) => (p.category || "").trim())
        .filter(Boolean);

    const unique = Array.from(new Set([...fromManual, ...fromProducts])).sort((a, b) =>
        a.localeCompare(b)
    );

    return ["All", ...unique];
  }, [manualCategories, products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const category = p.category || "Uncategorized";
      const matchesCategory = categoryFilter === "All" || category === categoryFilter;
      const matchesSearch =
          q.length === 0 ||
          p.name.toLowerCase().includes(q) ||
          category.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [products, categoryFilter, search]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
        .map(([id, qty]) => {
          const p = products.find((x) => x.id === Number(id));
          if (!p || qty <= 0) return null;
          return {
            id: p.id,
            name: p.name,
            qty,
            price: Number(p.salesPrice || 0),
            lineTotal: Number(p.salesPrice || 0) * qty,
            stock: p.stock,
          };
        })
        .filter(Boolean) as Array<{
      id: number;
      name: string;
      qty: number;
      price: number;
      lineTotal: number;
      stock: number;
    }>;
  }, [cart, products]);

  const validateStockOrAlert = (): boolean => {
    for (const [idStr, qty] of Object.entries(cart)) {
      const id = Number(idStr);
      const p = products.find((x) => x.id === id);
      if (p && qty > p.stock) {
        alert(`Not enough stock for ${p.name}`);
        return false;
      }
    }
    return true;
  };

  const handleCompleteOrder = () => {
    if (!validateStockOrAlert()) return;
    if (cartItems.length === 0) {
      alert("Please add at least 1 item to the order.");
      return;
    }
    setShowOrderDialog(false);
    setShowReceiptDialog(true);
  };

  const paymentNumber = useMemo(() => {
    const val = Number(payment);
    return Number.isFinite(val) ? val : NaN;
  }, [payment]);

  const change = useMemo(() => {
    if (!Number.isFinite(paymentNumber)) return 0;
    return Math.max(0, paymentNumber - effectiveTotal);
  }, [paymentNumber, effectiveTotal]);

  const handlePlaceOrder = async () => {
    if (!validateStockOrAlert()) return;

    const existingOrders = readOrders();

    if (!Number.isFinite(paymentNumber)) {
      alert("Please enter a valid payment amount.");
      return;
    }

    if (paymentNumber < effectiveTotal) {
      alert("Payment must be equal or greater than the total.");
      return;
    }

    const items: OrderItem[] = cartItems.map((i) => ({
      name: i.name,
      quantity: i.qty,
    }));

    const todayKey = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const todaysCount = existingOrders.filter((o) => o.date === todayKey).length;
    const customerName = `Customer ${todaysCount + 1}`;

    const baseId = `#${Date.now().toString().slice(-4)}`;

    const displayDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const dbDate = new Date().toISOString().slice(0, 10);
    const displayOrderId = baseId;

    const newOrder: Order = {
      id: displayOrderId,
      customer: customerName,
      items,
      total: effectiveTotal,
      date: displayDate,
    };

    const token = localStorage.getItem("token");
    if (!token) {
      alert("No token found. Please log in again.");
      return;
    }

    const itemText =
        newOrder.items.length > 0
            ? newOrder.items.map((i) => `${i.name} x${i.quantity}`).join(", ")
            : "";

    try {
      const orderRes = await fetch("/api/pos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "create_order",
          order_id: displayOrderId,
          customer_name: newOrder.customer,
          item: itemText,
          total: newOrder.total,
          order_date: dbDate,
        }),
      });

      if (!orderRes.ok) {
        const data = await orderRes.json().catch(() => ({} as { error?: string }));
        alert(data?.error || "Failed to save order to database.");
        return;
      }

      for (const ci of cartItems) {
        const product = products.find((p) => p.id === ci.id);
        if (!product) continue;

        const newStock = Math.max(0, Number(product.stock) - Number(ci.qty));

        const updateRes = await fetch("/api/products", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "update_product",
            id: product.id,
            name: product.name,
            category: product.category,
            stock: newStock,
            alertLevel: Number(product.alertLevel || 0),
            originalPrice: Number(product.originalPrice || 0),
            salesPrice: Number(product.salesPrice || 0),
          }),
        });

        if (!updateRes.ok) {
          const data = await updateRes.json().catch(() => ({} as { error?: string }));
          alert(data?.error || `Failed to deduct stock for ${product.name}`);
          return;
        }
      }

      const refreshRes = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "get_products" }),
      });

      const refreshData = (await refreshRes.json().catch(() => ({}))) as ProductsApiResponse;

      if (refreshRes.ok && Array.isArray(refreshData.products)) {
        const mapped = refreshData.products.map(mapProduct);
        setProducts(mapped);
        localStorage.setItem("stocknbook_inventory_products", JSON.stringify(mapped));
      }

      const updatedOrders = [newOrder, ...existingOrders];
      localStorage.setItem("stocknbook_orders", JSON.stringify(updatedOrders));
      setOrders(updatedOrders);

      setShowReceiptDialog(false);
      setShowOrderDialog(false);
      resetOrderDraft();
    } catch (err) {
      console.error(err);
      alert("Failed to place order.");
    }
  };

  const goBackToEditOrder = () => {
    setShowReceiptDialog(false);
    setShowOrderDialog(true);
  };

  const todayKey = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const todayOrders = orders.filter((o) => o.date === todayKey);
  const todayOrdersForSales = todayOrders.filter((o) => Number(o.total || 0) > 0);

  const totalSales = todayOrdersForSales.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const todayProfit = todayOrdersForSales.reduce((sum, order) => {
    const orderProfit = order.items.reduce((itemSum, item) => {
      const product = products.find((p) => p.name === item.name);
      if (!product) return itemSum;
      const unitProfit = Number(product.salesPrice || 0) - Number(product.originalPrice || 0);
      return itemSum + unitProfit * Number(item.quantity || 0);
    }, 0);

    return sum + orderProfit;
  }, 0);

  const customerNumberPreview = todayOrders.length + 1;

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
                <p className="mt-1 text-[9px] uppercase tracking-[0.15em] text-white/60">Store Owner</p>
              </div>
            </div>

            <nav className="mt-3 px-2 pb-4">
              <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">Core</p>

              <div className="space-y-1">
                <Link href="/admin" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Dashboard</Link>
                <Link href="/bookings" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Bookings</Link>
                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Calendar</div>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">Business</p>

              <div className="space-y-1">
                <Link href="/inventory" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Inventory</Link>
                <Link href="/pos" className="block rounded-lg bg-white/20 px-3 py-2 text-xs font-medium">Sales / POS</Link>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">Analytics</p>
              <div className="space-y-1">
                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Forecasting</div>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">System</p>
              <div className="space-y-1">
                <Link href="/booking-link" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Booking Link</Link>
                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Settings</div>
              </div>
            </nav>
          </div>

          <div className="px-2 pb-3">
            <Link href="/" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Logout</Link>
          </div>
        </aside>

        <main className="flex-1 p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#1f2a44]">Point of Sale</h1>
              <p className="mt-1 text-sm text-gray-500">Record orders and manage sales</p>
            </div>

            <button
                onClick={openNewOrder}
                className="rounded-xl bg-linear-to-r from-[#6c63ff] to-[#d786e8] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
            >
              + New Order
            </button>
          </div>

          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Today&apos;s Sales</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1f2a44]">₱{totalSales.toFixed(2)}</h2>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Orders Today</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1f2a44]">{todayOrders.length}</h2>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Today&apos;s Profit</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1f2a44]">{peso(todayProfit)}</h2>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h3 className="text-sm font-semibold text-[#1f2a44]">Recent Orders</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-190 text-sm">
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
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                        No orders yet
                      </td>
                    </tr>
                ) : (
                    orders.map((o) => (
                        <tr key={o.id} className="border-t border-gray-100">
                          <td className="px-5 py-4 text-gray-600">{o.id}</td>
                          <td className="px-5 py-4 text-gray-600">{o.customer}</td>
                          <td className="px-5 py-4 text-gray-600">
                            {Array.isArray(o.items) && o.items.length > 0 ? (
                                <div className="space-y-1">
                                  {o.items.map((item, idx) => (
                                      <div key={`${item.name}-${idx}`} className="leading-5">
                                        {item.name} x{item.quantity}
                                      </div>
                                  ))}
                                </div>
                            ) : (
                                "-"
                            )}
                          </td>
                          <td className="px-5 py-4 font-medium text-gray-700">₱{o.total.toFixed(2)}</td>
                          <td className="px-5 py-4 text-gray-600">{o.date}</td>
                        </tr>
                    ))
                )}
                </tbody>
              </table>
            </div>
          </div>

          {showOrderDialog && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="w-[1300px] h-[800px] max-w-[95vw] max-h-[95vh] rounded-2xl bg-white shadow-2xl overflow-hidden">
                  <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">New Order</h2>
                      <p className="text-sm text-slate-500">Customer {customerNumberPreview}</p>
                    </div>
                    <button
                        onClick={() => setShowOrderDialog(false)}
                        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 h-[calc(100%-73px)]">
                    <div className="lg:col-span-2 border-r border-slate-200 h-full flex flex-col">
                      <div className="px-6 py-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                        <div className="flex flex-col sm:flex-row gap-2 w-full">
                          <select
                              value={categoryFilter}
                              onChange={(e) => setCategoryFilter(e.target.value)}
                              className="w-full sm:w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          >
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                            ))}
                          </select>

                          <input
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              placeholder="Search product..."
                              className="w-full sm:flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>

                        <div className="text-xs text-slate-500">
                          Showing <span className="font-semibold text-slate-700">{filteredProducts.length}</span> product(s)
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto px-6 pb-6">
                        {filteredProducts.length === 0 ? (
                            <p className="py-10 text-center text-sm text-slate-500">No products found</p>
                        ) : (
                            <div className="space-y-2">
                              {filteredProducts.map((p) => {
                                const out = p.stock <= 0;
                                const qty = cart[p.id] || 0;
                                const isMax = qty >= p.stock && p.stock > 0;

                                return (
                                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-900">{p.name}</p>
                                        <p className="text-xs text-slate-600">
                                          {(p.category || "Uncategorized") + " • ₱" + Number(p.salesPrice || 0).toFixed(2)}
                                        </p>
                                        <p className="text-xs">
                                          {out ? (
                                              <span className="font-semibold text-rose-600">Out of Stock</span>
                                          ) : (
                                              <span className="text-slate-600">
                                      Stock <span className="font-semibold">{p.stock}</span>
                                    </span>
                                          )}
                                        </p>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <button
                                            className="h-9 w-9 rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            disabled={qty <= 0}
                                            onClick={() => handleQty(p.id, -1)}
                                        >
                                          –
                                        </button>

                                        <span className="min-w-8 text-center font-semibold text-slate-900">{qty}</span>

                                        <button
                                            disabled={out || isMax}
                                            className="h-9 w-9 rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
                                            onClick={() => handleQty(p.id, 1)}
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                );
                              })}
                            </div>
                        )}
                      </div>
                    </div>

                    <div className="px-6 py-4 h-full flex flex-col">
                      <h3 className="text-sm font-semibold text-slate-900">Order Summary</h3>

                      <div className="mt-3 h-[430px] overflow-y-auto space-y-2 pr-1">
                        {cartItems.length === 0 ? (
                            <p className="py-6 text-sm text-slate-500">No items added yet</p>
                        ) : (
                            cartItems.map((i) => (
                                <div key={i.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-semibold text-slate-900">{i.name}</p>
                                      <p className="text-xs text-slate-600">
                                        {i.qty} x {peso(i.price)}
                                      </p>
                                    </div>

                                    <div className="text-sm font-bold text-slate-900">{peso(i.lineTotal)}</div>
                                  </div>

                                  <div className="mt-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <button
                                          onClick={() => handleQty(i.id, -1)}
                                          className="h-9 w-9 rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                          disabled={i.qty <= 0}
                                          aria-label="Decrease quantity"
                                      >
                                        –
                                      </button>

                                      <input
                                          value={String(i.qty)}
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            if (!Number.isFinite(val)) return;
                                            setQty(i.id, val);
                                          }}
                                          className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-center text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                                          inputMode="numeric"
                                      />

                                      <button
                                          onClick={() => handleQty(i.id, 1)}
                                          className="h-9 w-9 rounded-lg border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
                                          disabled={i.qty >= i.stock}
                                          aria-label="Increase quantity"
                                      >
                                        +
                                      </button>

                                      <span className="text-xs text-slate-500">
                                Stock: <span className="font-semibold">{i.stock}</span>
                              </span>
                                    </div>

                                    <button
                                        onClick={() => removeItemFromCart(i.id)}
                                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                            ))
                        )}
                      </div>

                      <div className="sticky bottom-0 bg-white pt-4 border-t border-slate-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-700">Total</span>
                          <span className="text-lg font-bold text-slate-900">{peso(total)}</span>
                        </div>

                        <div className="mt-4 flex gap-2">
                          <button
                              onClick={resetOrderDraft}
                              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Clear
                          </button>

                          <button
                              onClick={handleCompleteOrder}
                              className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={cartItems.length === 0}
                          >
                            Complete Order
                          </button>
                        </div>

                        <p className="mt-3 text-[11px] text-slate-500">
                          “Complete Order” opens the receipt. Inventory is deducted only after “Place Order”.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          )}

          {showReceiptDialog && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
                  <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Receipt</h2>
                      <p className="text-sm text-slate-500">
                        {storeName} • Customer {customerNumberPreview}
                      </p>
                    </div>
                    <button
                        onClick={() => setShowReceiptDialog(false)}
                        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="px-6 py-5">
                    <div className="space-y-2">
                      {cartItems.map((i) => (
                          <div key={i.id} className="flex justify-between text-sm">
                            <div className="text-slate-700">
                              {i.name} <span className="text-slate-400">x{i.qty}</span>
                            </div>
                            <div className="font-semibold text-slate-900">{peso(i.lineTotal)}</div>
                          </div>
                      ))}
                    </div>

                    <div className="my-4 border-t border-slate-200 pt-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Total</span>
                        <span className="font-bold text-slate-900">{peso(effectiveTotal)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      <div className="lg:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Customer Payment
                        </label>
                        <input
                            value={payment}
                            onChange={(e) => setPayment(e.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">Payment must be ≥ total.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Change</label>
                        <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900">
                          {peso(change)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex gap-2">
                      <button
                          onClick={goBackToEditOrder}
                          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Back (Edit Order)
                      </button>

                      <button
                          onClick={handlePlaceOrder}
                          className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
                      >
                        Place Order
                      </button>
                    </div>

                    <p className="mt-3 text-[11px] text-slate-500">
                      “Place Order” deducts inventory and records the sale.
                    </p>
                  </div>
                </div>
              </div>
          )}
        </main>
      </div>
  );
}
