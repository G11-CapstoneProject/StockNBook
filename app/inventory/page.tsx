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

const STORAGE_KEY = "partypro_inventory_products";

export default function InventoryPage() {
  const [formMode, setFormMode] = useState<"product" | "category">("product");
  const [manualCategories, setManualCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("");
  const [alertLevel, setAlertLevel] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [salesPrice, setSalesPrice] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setProducts(JSON.parse(saved));
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
    if (p.stock <= 0)
      return { label: "Out of Stock", style: "bg-red-100 text-red-600" };
    if (p.stock <= p.alertLevel)
      return { label: "Low Stock", style: "bg-yellow-100 text-yellow-600" };
    return { label: "In Stock", style: "bg-green-100 text-green-600" };
  }

  return (
    <div className="flex min-h-screen bg-[#f5f6f8]">
      
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
            <Link
                href="/admin"
                className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10"
                >
                Dashboard
                </Link>

            <div className="rounded-xl bg-white/20 px-4 py-3 font-medium">
              Inventory
            </div>

            <Link
                href="/bookings"
                className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10"
                >
                Bookings
                </Link>

            <div className="rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">
              Calendar
            </div>

          <Link
            href="/pos"
            className="block rounded-xl px-4 py-3 text-white/90 hover:bg-white/10"
          >
            POS / Sales
          </Link>

            <div className="rounded-xl px-4 py-3 text-white/90 hover:bg-white/10">
              Forecasting
            </div>
          </nav>
        </div>

        <div className="border-t border-white/20 px-5 py-5 text-white/90">
          Exit Admin
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-6">

        {/* HEADER */}
        <div className="mb-6 flex justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#1f2a44]">
              Inventory Management
            </h1>
            <p className="text-black/70">
              Manage your party supplies and products
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                resetForm();
                setFormMode("category");
                setShowForm(true);
              }}
              className="rounded-xl border bg-white text-[#1f2a44] px-5 py-3"
            >
              Manage Categories
            </button>

            <button
              onClick={() => {
                resetForm();
                setFormMode("product");
                setShowForm(true);
              }}
              className="rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] px-5 py-3 text-white"
            >
              + Add Product
            </button>
          </div>
        </div>

        {/* CATEGORIES */}
        <section className="mb-6 rounded-2xl bg-white p-6">
          <h2 className="mb-3 font-semibold text-[#1f2a44]">
            Categories
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span
                key={c}
                className="bg-purple-100 text-purple-600 px-3 py-1 rounded-full text-sm"
              >
                {c}
              </span>
            ))}
          </div>
        </section>

        {/* PRODUCTS TABLE */}
        <section className="rounded-2xl bg-white p-6">
          <div className="flex justify-between mb-4">
            <h2 className="font-semibold text-[#1f2a44]">
              Products
            </h2>

            <input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-300 px-3 py-2 rounded-lg text-sm text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
            />
          </div>

          <table className="w-full text-sm">
            <thead className="text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left">Product</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Alert</th>
                <th>Original</th>
                <th>Sales</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredProducts.map((p) => {
                const s = getStatus(p);
                return (
                    <tr key={p.id} className="border-t">
                    <td className="py-3 text-[#1f2a44] font-medium">{p.name}</td>
                    <td className="text-center text-gray-700">{p.category}</td>
                    <td className="text-center text-gray-700">{p.stock}</td>
                    <td className="text-center text-gray-700">{p.alertLevel}</td>
                    <td className="text-center text-gray-700">₱{p.originalPrice.toFixed(2)}</td>
                    <td className="text-center text-gray-700">₱{p.salesPrice.toFixed(2)}</td>
                    <td className="text-center">
                      <span className={`px-2 py-1 rounded-full text-xs ${s.style}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => handleEditProduct(p)}
                        className="text-blue-500 mr-2"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(p.id)}
                        className="text-red-500"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* MODAL */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">

              <div className="flex justify-between mb-4">
                <h2 className="font-semibold text-black">
                  {formMode === "category"
                    ? "Manage Categories"
                    : editingId
                    ? "Edit Product"
                    : "Add Product"}
                </h2>

                <button onClick={() => setShowForm(false)}>✕</button>
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
                        className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!category.trim()) return;
                          setManualCategories((p) => [...p, category.trim()]);
                          setCategory("");
                        }}
                        className="bg-purple-500 text-white px-3 rounded"
                      >
                        Add
                      </button>
                    </div>

                    <div className="space-y-2 max-h-40 overflow-auto">
                      {categories.map((c) => (
                        <div
                          key={c}
                          className="flex justify-between items-center bg-gray-300 text-black p-2 rounded-lg"
                        >
                          <span className="font-medium">{c}</span>

                          <button
                            className="text-red-500 hover:text-red-700"
                            onClick={() =>
                              setManualCategories((p) =>
                                p.filter((x) => x !== c)
                              )
                            }
                          >
                            🗑
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
                      className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                    />

                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
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
                        className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                      />
                      <input
                        type="number"
                        placeholder="Alert"
                        value={alertLevel}
                        onChange={(e) => setAlertLevel(e.target.value)}
                        className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        placeholder="Original Price"
                        value={originalPrice}
                        onChange={(e) => setOriginalPrice(e.target.value)}
                        className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                      />
                      <input
                        type="number"
                        placeholder="Sales Price"
                        value={salesPrice}
                        onChange={(e) => setSalesPrice(e.target.value)}
                        className="border border-gray-300 p-2 rounded w-full text-black placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded-lg hover:opacity-90 transition"
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