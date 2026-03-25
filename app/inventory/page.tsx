"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  category: string;
  stock: number;
  alertLevel: number;
  originalPrice: number;
  salesPrice: number;
};

const STORAGE_KEY = "stocknbook_inventory_products";

export default function InventoryPage() {
  const [formMode, setFormMode] = useState<"product" | "category">("product");
  const [manualCategories, setManualCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [storeName, setStoreName] = useState("Store Name");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("");
  const [alertLevel, setAlertLevel] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [salesPrice, setSalesPrice] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setProducts(JSON.parse(saved));

    const savedStoreName =
        localStorage.getItem("store_name") ||
        localStorage.getItem("stocknbook_store_name") ||
        "Store Name";

    setStoreName(savedStoreName);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  }, [products, isLoaded]);

  const categories = useMemo(() => {
    const productCats = products.map((p) => p.category.trim());
    return [...new Set([...productCats, ...manualCategories])].filter(Boolean);
  }, [products, manualCategories]);

  const filteredProducts = products.filter(
      (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.category.toLowerCase().includes(search.toLowerCase())
  );

  function resetForm() {
    setName("");
    setCategory("");
    setStock("");
    setAlertLevel("");
    setOriginalPrice("");
    setSalesPrice("");
  }

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();

    if (!name || !category) return;

    const data = {
      name,
      category,
      stock: Number(stock),
      alertLevel: Number(alertLevel),
      originalPrice: Number(originalPrice),
      salesPrice: Number(salesPrice),
    };

    if (editingId) {
      setProducts((prev) =>
          prev.map((p) => (p.id === editingId ? { ...p, ...data } : p))
      );
    } else {
      setProducts((prev) => [...prev, { id: Date.now(), ...data }]);
    }

    resetForm();
    setEditingId(null);
    setShowForm(false);
  }

  function handleDeleteProduct(id: number) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function handleEditProduct(p: Product) {
    setEditingId(p.id);
    setName(p.name);
    setCategory(p.category);
    setStock(String(p.stock));
    setAlertLevel(String(p.alertLevel));
    setOriginalPrice(String(p.originalPrice));
    setSalesPrice(String(p.salesPrice));
    setFormMode("product");
    setShowForm(true);
  }

  function getStatus(p: Product) {
    if (p.stock <= 0) {
      return { label: "Out of Stock", style: "bg-red-100 text-red-600" };
    }
    if (p.stock <= p.alertLevel) {
      return { label: "Low Stock", style: "bg-yellow-100 text-yellow-600" };
    }
    return { label: "In Stock", style: "bg-green-100 text-green-600" };
  }

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
                <div className="rounded-lg bg-white/20 px-3 py-2 text-xs font-medium">
                  Inventory
                </div>

                <Link
                    href="/pos"
                    className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
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
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#1f2a44]">
                Inventory Management
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage your party supplies and products
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                  onClick={() => {
                    resetForm();
                    setFormMode("category");
                    setShowForm(true);
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#1f2a44] hover:bg-gray-50"
              >
                Manage Categories
              </button>

              <button
                  onClick={() => {
                    resetForm();
                    setEditingId(null);
                    setFormMode("product");
                    setShowForm(true);
                  }}
                  className="rounded-xl bg-linear-to-r from-[#8b5cf6] to-[#d946ef] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                + Add Product
              </button>
            </div>
          </div>

          <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#1f2a44]">Categories</h2>
              <span className="text-xs text-gray-400">{categories.length} total</span>
            </div>

            {categories.length === 0 ? (
                <p className="text-sm text-gray-500">No categories yet</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                      <span
                          key={c}
                          className="rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-600"
                      >
                  {c}
                </span>
                  ))}
                </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#1f2a44]">Products</h2>
                <p className="mt-1 text-xs text-gray-400">
                  {filteredProducts.length} item{filteredProducts.length !== 1 ? "s" : ""}
                </p>
              </div>

              <input
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300 md:w-64"
              />
            </div>

            {filteredProducts.length === 0 ? (
                <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-[#fafafa]">
                  <p className="text-sm text-gray-500">No products found</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="text-xs uppercase text-gray-500">
                    <tr className="border-b border-gray-100">
                      <th className="pb-3 text-left font-semibold">Product</th>
                      <th className="pb-3 text-center font-semibold">Category</th>
                      <th className="pb-3 text-center font-semibold">Stock</th>
                      <th className="pb-3 text-center font-semibold">Alert</th>
                      <th className="pb-3 text-center font-semibold">Original</th>
                      <th className="pb-3 text-center font-semibold">Sales</th>
                      <th className="pb-3 text-center font-semibold">Status</th>
                      <th className="pb-3 text-center font-semibold">Actions</th>
                    </tr>
                    </thead>

                    <tbody>
                    {filteredProducts.map((p) => {
                      const s = getStatus(p);

                      return (
                          <tr key={p.id} className="border-b border-gray-100 last:border-0">
                            <td className="py-4 font-medium text-[#1f2a44]">{p.name}</td>
                            <td className="py-4 text-center text-gray-700">{p.category}</td>
                            <td className="py-4 text-center text-gray-700">{p.stock}</td>
                            <td className="py-4 text-center text-gray-700">{p.alertLevel}</td>
                            <td className="py-4 text-center text-gray-700">
                              ₱{p.originalPrice.toFixed(2)}
                            </td>
                            <td className="py-4 text-center text-gray-700">
                              ₱{p.salesPrice.toFixed(2)}
                            </td>
                            <td className="py-4 text-center">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.style}`}>
                            {s.label}
                          </span>
                            </td>
                            <td className="py-4 text-center">
                              <button
                                  onClick={() => handleEditProduct(p)}
                                  className="mr-3 text-sm font-medium text-blue-500 hover:text-blue-600"
                              >
                                Edit
                              </button>
                              <button
                                  onClick={() => handleDeleteProduct(p.id)}
                                  className="text-sm font-medium text-red-500 hover:text-red-600"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>
            )}
          </section>

          {showForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-semibold text-black">
                      {formMode === "category"
                          ? "Manage Categories"
                          : editingId
                              ? "Edit Product"
                              : "Add Product"}
                    </h2>

                    <button
                        onClick={() => setShowForm(false)}
                        className="text-gray-500 hover:text-black"
                    >
                      ✕
                    </button>
                  </div>

                  <form
                      onSubmit={(e) => {
                        if (formMode === "product") handleAddProduct(e);
                        else e.preventDefault();
                      }}
                      className="space-y-3"
                  >
                    {formMode === "category" && (
                        <>
                          <div className="flex gap-2">
                            <input
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="New category"
                                className="w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                  if (!category.trim()) return;
                                  setManualCategories((p) => [...p, category.trim()]);
                                  setCategory("");
                                }}
                                className="rounded-lg bg-purple-500 px-3 text-white hover:bg-purple-600"
                            >
                              Add
                            </button>
                          </div>

                          <div className="max-h-40 space-y-2 overflow-auto">
                            {categories.map((c) => (
                                <div
                                    key={c}
                                    className="flex items-center justify-between rounded-lg bg-gray-100 p-2 text-black"
                                >
                                  <span className="font-medium">{c}</span>

                                  <button
                                      type="button"
                                      className="text-red-500 hover:text-red-700"
                                      onClick={() =>
                                          setManualCategories((p) => p.filter((x) => x !== c))
                                      }
                                  >
                                    Delete
                                  </button>
                                </div>
                            ))}
                          </div>
                        </>
                    )}

                    {formMode === "product" && (
                        <>
                          <input
                              placeholder="Product Name"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                          />

                          <select
                              value={category}
                              onChange={(e) => setCategory(e.target.value)}
                              className="w-full rounded-lg border border-gray-300 p-2 text-black focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                          >
                            <option value="">Select category</option>
                            {categories.map((c) => (
                                <option key={c}>{c}</option>
                            ))}
                          </select>

                          <div className="grid grid-cols-2 gap-2">
                            <input
                                type="number"
                                placeholder="Stock"
                                value={stock}
                                onChange={(e) => setStock(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                            />
                            <input
                                type="number"
                                placeholder="Alert"
                                value={alertLevel}
                                onChange={(e) => setAlertLevel(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <input
                                type="number"
                                placeholder="Original Price"
                                value={originalPrice}
                                onChange={(e) => setOriginalPrice(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                            />
                            <input
                                type="number"
                                placeholder="Sales Price"
                                value={salesPrice}
                                onChange={(e) => setSalesPrice(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                            />
                          </div>

                          <button
                              type="submit"
                              className="w-full rounded-lg bg-linear-to-r from-purple-500 to-pink-500 py-2 text-white transition hover:opacity-90"
                          >
                            Save Product
                          </button>
                        </>
                    )}
                  </form>
                </div>
              </div>
          )}
        </main>
      </div>
  );
}