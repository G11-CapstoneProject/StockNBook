/* eslint-disable @typescript-eslint/no-explicit-any */
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

type Category = {
  id: number;
  categoryName: string;
  description?: string;
};

type ApiError = { error?: string };
type CategoryApiResponse = {
  success?: boolean;
  category?: Category;
  categories?: Category[];
  id?: number;
  categoryName?: string;
  error?: string;
};

type ProductsApiResponse = {
  success?: boolean;
  product?: Product;
  products?: Product[];
  error?: string;
};

const STORAGE_KEY = "stocknbook_inventory_products";

type PendingProductSave =
    | {
  mode: "add";
  data: Omit<Product, "id">;
}
    | {
  mode: "edit";
  editingId: number;
  before: Product;
  after: Omit<Product, "id">;
};

export default function InventoryPage() {
  const [formMode, setFormMode] = useState<"product" | "category">("product");

  const [products, setProducts] = useState<Product[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Product[]) : [];
  });

  const [manualCategories, setManualCategories] = useState<Category[]>([]);
  const [storeName, setStoreName] = useState("Store Name");

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // product form fields
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("");
  const [alertLevel, setAlertLevel] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [salesPrice, setSalesPrice] = useState("");

  // category edit state
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCategoryValue, setEditCategoryValue] = useState("");

  // Product delete dialog only (used in UI)
  const [showDeleteProductDialog, setShowDeleteProductDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // Product confirm save dialog only (used in UI)
  const [showConfirmProductSaveDialog, setShowConfirmProductSaveDialog] = useState(false);
  const [pendingProductSave, setPendingProductSave] = useState<PendingProductSave | null>(null);

  const labelClass = "text-xs font-semibold text-gray-600";
  const fieldClass =
      "w-full rounded-lg border border-gray-300 p-2 text-black placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  }, [products]);

  async function safeParseResponse<T = unknown>(res: Response): Promise<{ data: T; text: string }> {
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as T, text };
    } catch {
      return { data: ({ error: text || "Non-JSON response from server" } as unknown) as T, text };
    }
  }

  function getTokenOrAlert(): string | null {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("❌ Missing login token. Please login again.");
      return null;
    }
    return token;
  }

  function getApiErrorMessage(data: unknown, fallback: string): string {
    if (typeof data === "object" && data !== null && "error" in data) {
      const err = (data as ApiError).error;
      if (typeof err === "string" && err.trim()) return err;
    }
    return fallback;
  }

  // Load categories from DB
  useEffect(() => {
    const loadCategories = async () => {
      const token = localStorage.getItem("token");
      const savedStoreName =
          localStorage.getItem("store_name") ||
          localStorage.getItem("stocknbook_store_name") ||
          "Store Name";
      setStoreName(savedStoreName);

      if (!token) {
        setManualCategories([]);
        return;
      }

      try {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "get_categories" }),
        });

        const { data, text } = await safeParseResponse<CategoryApiResponse>(res);
        console.log("CATEGORIES PAGE RAW:", res.status, text);

        if (!res.ok) {
          console.warn("Categories fetch failed:", getApiErrorMessage(data, "Failed to fetch categories"));
          setManualCategories([]);
          return;
        }

        setManualCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch (err) {
        console.warn("Categories fetch failed:", err);
        setManualCategories([]);
      }
    };

    void loadCategories();
  }, []);

  // Load products from DB
  useEffect(() => {
    const loadProducts = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setProducts([]);
        return;
      }

      try {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "get_products" }),
        });

        const text = await res.text();
        const data = JSON.parse(text) as ProductsApiResponse;

        if (res.ok && Array.isArray(data.products)) {
          const mapped: Product[] = data.products.map((p: any) => ({
            ...p,
            originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
            salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
          }));

          setProducts(mapped);
        } else {
          console.warn("Products fetch failed:", data);
          setProducts([]);
        }
      } catch (err) {
        console.warn("Products fetch failed:", err);
        setProducts([]);
      }
    };

    void loadProducts();
  }, []);

  const categories = useMemo(() => {
    const productCats = products.map((p) => p.category.trim());
    const manualCats = manualCategories.map((c) => c.categoryName.trim());
    const all = [...new Set([...productCats, ...manualCats])].filter(Boolean);
    return all.sort((a, b) => a.localeCompare(b));
  }, [products, manualCategories]);

  const filteredCategoriesForManage = useMemo(() => {
    const q = category.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.toLowerCase().includes(q));
  }, [categories, category]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCategory = selectedCategory === "All" ? true : p.category === selectedCategory;
      const matchesSearch =
          q.length === 0 ? true : p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, search]);

  function resetProductForm() {
    setName("");
    setCategory("");
    setStock("");
    setAlertLevel("");
    setOriginalPrice("");
    setSalesPrice("");
  }

  function resetCategoryForm() {
    setCategory("");
    setEditingCategory(null);
    setEditCategoryValue("");
  }

  function normalizeCat(s: string) {
    return s.trim();
  }

  function getStatus(p: Product) {
    if (p.stock <= 0) return { label: "Out of Stock", style: "bg-red-100 text-red-600" };
    if (p.stock <= p.alertLevel) return { label: "Low Stock", style: "bg-yellow-100 text-yellow-600" };
    return { label: "In Stock", style: "bg-green-100 text-green-600" };
  }

  function money(n: number) {
    const value = Number(n ?? 0);
    return `₱${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
  }

  function handleSubmitProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !category.trim()) return;

    const after = {
      name: name.trim(),
      category: category.trim(),
      stock: Number(stock),
      alertLevel: Number(alertLevel),
      originalPrice: Number(originalPrice),
      salesPrice: Number(salesPrice),
    };

    if (editingId) {
      const before = products.find((p) => p.id === editingId);
      if (!before) return;
      setPendingProductSave({ mode: "edit", editingId, before, after });
    } else {
      setPendingProductSave({ mode: "add", data: after });
    }

    setShowConfirmProductSaveDialog(true);
  }

  async function confirmSaveProduct() {
    if (!pendingProductSave) return;

    const token = getTokenOrAlert();
    if (!token) return;

    const payload =
        pendingProductSave.mode === "edit"
            ? {
              action: "update_product",
              id: pendingProductSave.editingId,
              ...pendingProductSave.after,
            }
            : {
              action: "create_product",
              ...pendingProductSave.data,
            };

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      const data = JSON.parse(text) as ProductsApiResponse;

      if (!res.ok) {
        alert(`❌ ${data?.error || "Failed to save product"}`);
        return;
      }

      // Refresh products after save
      const refreshed = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "get_products" }),
      });

      const refreshedText = await refreshed.text();
      const refreshedData = JSON.parse(refreshedText) as ProductsApiResponse;

      setProducts(
          Array.isArray(refreshedData.products)
              ? refreshedData.products.map((p: any) => ({
                ...p,
                originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
                salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
              }))
              : []
      );
      setSelectedCategory(
          pendingProductSave.mode === "edit"
              ? pendingProductSave.after.category
              : pendingProductSave.data.category
      );

      setPendingProductSave(null);
      setShowConfirmProductSaveDialog(false);
      resetProductForm();
      setEditingId(null);
      setShowForm(false);
    } catch (err) {
      console.error("Product save failed:", err);
      alert("❌ Failed to save product");
    }
  }

  function closeConfirmProductSaveDialog() {
    setPendingProductSave(null);
    setShowConfirmProductSaveDialog(false);
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

  function requestDeleteProduct(p: Product) {
    setProductToDelete(p);
    setShowDeleteProductDialog(true);
  }

  async function confirmDeleteProduct() {
    if (!productToDelete) return;

    const token = getTokenOrAlert();
    if (!token) return;

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "delete_product",
          id: productToDelete.id,
        }),
      });

      const text = await res.text();
      const data = JSON.parse(text) as ProductsApiResponse;

      if (!res.ok) {
        alert(`❌ ${data?.error || "Failed to delete product"}`);
        return;
      }

      setProducts((prev) => prev.filter((p) => p.id !== productToDelete.id));
      setShowDeleteProductDialog(false);
      setProductToDelete(null);
    } catch (err) {
      console.error("Delete product failed:", err);
      alert("❌ Failed to delete product");
    }
  }

  function closeDeleteProductDialog() {
    setShowDeleteProductDialog(false);
    setProductToDelete(null);
  }

  async function addCategoryNow(nextValue: string) {
    const token = getTokenOrAlert();
    if (!token) return;

    const next = normalizeCat(nextValue);
    if (!next) return;

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "create_category",
          categoryName: next,
          description: "",
        }),
      });

      const text = await res.text();
      console.log("CREATE CATEGORY RAW:", res.status, text);

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Invalid server response" };
      }

      if (!res.ok) {
        alert(`❌ ${data?.error || "Failed to save category"}`);
        return;
      }

      const created = data.category ?? {
        id: data.id ?? Date.now(),
        categoryName: data.categoryName ?? next,
        description: "",
      };

      setManualCategories((prev) => {
        const exists = prev.some(
            (c) => c.categoryName.trim().toLowerCase() === created.categoryName.trim().toLowerCase()
        );
        if (exists) return prev;
        return [...prev, created];
      });

      setSelectedCategory(created.categoryName);
      setCategory("");
    } catch (error) {
      console.error("Category create failed:", error);
      alert("❌ Failed to save category");
    }
  }

  async function updateCategoryNow(oldCat: string, nextValue: string) {
    const token = getTokenOrAlert();
    if (!token) return;

    const next = normalizeCat(nextValue);
    if (!next) return;

    const target = manualCategories.find((c) => c.categoryName === oldCat);
    if (!target) {
      alert("❌ Category ID not found");
      return;
    }

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "update_category",
          category_id: target.id,
          categoryName: next,
          description: "",
        }),
      });

      const text = await res.text();
      console.log("UPDATE CATEGORY RAW:", res.status, text);

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Invalid server response" };
      }

      if (!res.ok) {
        alert(`❌ ${data?.error || "Failed to update category"}`);
        return;
      }

      setManualCategories((prev) =>
          prev.map((c) => (c.id === target.id ? { ...c, categoryName: next } : c))
      );
      setProducts((prev) => prev.map((p) => (p.category === oldCat ? { ...p, category: next } : p)));

      if (selectedCategory === oldCat) setSelectedCategory(next);
      setEditingCategory(null);
      setEditCategoryValue("");
    } catch (error) {
      console.error("Category update failed:", error);
      alert("❌ Failed to update category");
    }
  }

  async function deleteCategoryNow(cat: string) {
    const stillHasProducts = products.some((p) => p.category === cat);
    if (stillHasProducts) {
      alert("❌ Cannot delete category with products.");
      return;
    }

    const token = getTokenOrAlert();
    if (!token) return;

    const target = manualCategories.find((c) => c.categoryName === cat);
    if (!target) {
      alert("❌ Category ID not found");
      return;
    }

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "delete_category",
          category_id: target.id,
        }),
      });

      const text = await res.text();
      console.log("DELETE CATEGORY RAW:", res.status, text);

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Invalid server response" };
      }

      if (!res.ok) {
        alert(`❌ ${data?.error || "Failed to delete category"}`);
        return;
      }

      setManualCategories((prev) => prev.filter((x) => x.id !== target.id));
      if (selectedCategory === cat) setSelectedCategory("All");
    } catch (error) {
      console.error("Delete category failed:", error);
      alert("❌ Failed to delete category");
    }
  }

  function startEditCategory(cat: string) {
    setEditingCategory(cat);
    setEditCategoryValue(cat);
  }

  function cancelEditCategory() {
    setEditingCategory(null);
    setEditCategoryValue("");
  }

  function categoryBtnClass(isSelected: boolean) {
    return [
      "rounded-full px-4 py-1.5 text-xs transition",
      isSelected
          ? "bg-purple-600 text-white font-bold ring-2 ring-purple-300 ring-offset-2"
          : "bg-purple-100 text-purple-700 font-medium hover:bg-purple-200",
    ].join(" ");
  }

  function allBtnClass(isSelected: boolean) {
    return [
      "rounded-full px-4 py-1.5 text-xs transition",
      isSelected
          ? "bg-purple-600 text-white font-bold ring-2 ring-purple-300 ring-offset-2"
          : "bg-gray-100 text-gray-700 font-medium hover:bg-gray-200",
    ].join(" ");
  }

  const productsTitle = selectedCategory === "All" ? "All Products" : `${selectedCategory} Products`;
  const productSaveTitle = pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";
  const productSaveButton = pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";

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
                <Link href="/admin" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Dashboard
                </Link>

                <Link href="/bookings" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Bookings
                </Link>

                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Calendar</div>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">Business</p>

              <div className="space-y-1">
                <div className="rounded-lg bg-white/20 px-3 py-2 text-xs font-medium">Inventory</div>

                <Link href="/pos" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Sales / POS
                </Link>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">Analytics</p>

              <div className="space-y-1">
                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Forecasting</div>
              </div>

              <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">System</p>

              <div className="space-y-1">
                <Link href="/booking-link" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                  Booking Link
                </Link>

                <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">Settings</div>
              </div>
            </nav>
          </div>

          <div className="px-2 pb-3">
            <Link href="/" className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
              Logout
            </Link>
          </div>
        </aside>

        <main className="flex-1 p-5">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#1f2a44]">Inventory Management</h1>
              <p className="mt-1 text-sm text-gray-500">Manage your party supplies and products</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                  onClick={() => {
                    resetCategoryForm();
                    setFormMode("category");
                    setShowForm(true);
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#1f2a44] hover:bg-gray-50"
              >
                Manage Categories
              </button>

              <button
                  onClick={() => {
                    resetProductForm();
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

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setSelectedCategory("All")} className={allBtnClass(selectedCategory === "All")}>
                All
              </button>

              {categories.length === 0 ? (
                  <span className="text-sm text-gray-500">No categories yet</span>
              ) : (
                  categories.map((c) => (
                      <button key={c} type="button" onClick={() => setSelectedCategory(c)} className={categoryBtnClass(selectedCategory === c)}>
                        {c}
                      </button>
                  ))
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#1f2a44]">{productsTitle}</h2>
                <p className="mt-1 text-xs text-gray-400">
                  {filteredProducts.length} item{filteredProducts.length !== 1 ? "s" : ""}
                </p>
              </div>

              <div className="w-full md:w-64">
                <label className={labelClass}>Search Product</label>
                <input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className={fieldClass} />
              </div>
            </div>

            {filteredProducts.length === 0 ? (
                <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-[#fafafa]">
                  <p className="text-sm text-gray-500">No products found.</p>
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
                            <td className="py-4 text-center text-gray-700">{money(p.originalPrice)}</td>
                            <td className="py-4 text-center text-gray-700">{money(p.salesPrice)}</td>
                            <td className="py-4 text-center">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.style}`}>{s.label}</span>
                            </td>
                            <td className="py-4 text-center">
                              <button onClick={() => handleEditProduct(p)} className="mr-3 text-sm font-medium text-blue-500 hover:text-blue-600">
                                Edit
                              </button>
                              <button onClick={() => requestDeleteProduct(p)} className="text-sm font-medium text-red-500 hover:text-red-600">
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
                      {formMode === "category" ? "Manage Categories" : editingId ? "Edit Product" : "Add Product"}
                    </h2>

                    <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-black">
                      ✕
                    </button>
                  </div>

                  <form
                      onSubmit={(e) => {
                        if (formMode === "product") handleSubmitProduct(e);
                        else e.preventDefault();
                      }}
                      className="space-y-3"
                  >
                    {formMode === "category" && (
                        <>
                          <div className="space-y-1">
                            <label className={labelClass}>Category Name (Search)</label>
                            <div className="flex gap-2">
                              <input
                                  value={category}
                                  onChange={(e) => setCategory(e.target.value)}
                                  placeholder="Type to search categories or add new..."
                                  className={fieldClass}
                              />
                              <button type="button" onClick={() => void addCategoryNow(category)} className="rounded-lg bg-purple-500 px-3 text-white hover:bg-purple-600">
                                Add
                              </button>
                            </div>
                            <p className="text-[11px] text-gray-500">Tip: typing here will filter the list below. Clear the box to show all categories.</p>
                          </div>

                          <div className="space-y-2">
                            <p className={labelClass}>Existing Categories</p>

                            <div className="max-h-40 space-y-2 overflow-auto">
                              {filteredCategoriesForManage.length === 0 ? (
                                  <p className="text-sm text-gray-500">No matching categories.</p>
                              ) : (
                                  filteredCategoriesForManage.map((c) => (
                                      <div key={c} className="flex items-center justify-between rounded-lg bg-gray-100 p-2 text-black">
                                        {editingCategory === c ? (
                                            <input
                                                value={editCategoryValue}
                                                onChange={(e) => setEditCategoryValue(e.target.value)}
                                                className="mr-2 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm text-black focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                                            />
                                        ) : (
                                            <span className="font-medium">{c}</span>
                                        )}

                                        <div className="flex items-center gap-2">
                                          {editingCategory === c ? (
                                              <>
                                                <button type="button" onClick={() => void updateCategoryNow(c, editCategoryValue)} className="text-sm font-semibold text-green-600 hover:text-green-700">
                                                  Save
                                                </button>
                                                <button type="button" onClick={cancelEditCategory} className="text-sm font-semibold text-gray-500 hover:text-gray-700">
                                                  Cancel
                                                </button>
                                              </>
                                          ) : (
                                              <>
                                                <button type="button" onClick={() => startEditCategory(c)} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                                                  Edit
                                                </button>
                                                <button type="button" onClick={() => void deleteCategoryNow(c)} className="text-sm font-semibold text-red-500 hover:text-red-700">
                                                  Delete
                                                </button>
                                              </>
                                          )}
                                        </div>
                                      </div>
                                  ))
                              )}
                            </div>
                          </div>
                        </>
                    )}

                    {formMode === "product" && (
                        <>
                          <div className="space-y-1">
                            <label className={labelClass}>Product Name</label>
                            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
                          </div>

                          <div className="space-y-1">
                            <label className={labelClass}>Category</label>
                            <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass}>
                              <option value="">Select category</option>
                              {categories.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className={labelClass}>Stock</label>
                              <input type="number" value={stock} onChange={(e) => setStock(e.target.value)} className={fieldClass} />
                            </div>

                            <div className="space-y-1">
                              <label className={labelClass}>Alert Level</label>
                              <input type="number" value={alertLevel} onChange={(e) => setAlertLevel(e.target.value)} className={fieldClass} />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className={labelClass}>Original Price</label>
                              <input type="number" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} className={fieldClass} />
                            </div>

                            <div className="space-y-1">
                              <label className={labelClass}>Sales Price</label>
                              <input type="number" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} className={fieldClass} />
                            </div>
                          </div>

                          <button type="submit" className="w-full rounded-lg bg-linear-to-r from-purple-500 to-pink-500 py-2 text-white transition hover:opacity-90">
                            Save Product
                          </button>
                        </>
                    )}
                  </form>
                </div>
              </div>
          )}

          {showConfirmProductSaveDialog && pendingProductSave && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-bold text-black">{productSaveTitle}</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        {pendingProductSave.mode === "edit"
                            ? `Are you sure you want to update ${pendingProductSave.before.name}?`
                            : "Are you sure you want to save this product?"}
                      </p>
                    </div>

                    <button onClick={closeConfirmProductSaveDialog} className="text-gray-500 hover:text-black">
                      ✕
                    </button>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                    <p className="mb-3 text-base font-semibold text-gray-700">Changes</p>

                    {pendingProductSave.mode === "add" ? (
                        <div className="rounded-lg bg-white p-3 space-y-1">
                          <div><span className="font-semibold">Name:</span> {pendingProductSave.data.name}</div>
                          <div><span className="font-semibold">Category:</span> {pendingProductSave.data.category}</div>
                          <div><span className="font-semibold">Stock:</span> {pendingProductSave.data.stock}</div>
                          <div><span className="font-semibold">Alert:</span> {pendingProductSave.data.alertLevel}</div>
                          <div><span className="font-semibold">Original:</span> {money(pendingProductSave.data.originalPrice)}</div>
                          <div><span className="font-semibold">Sales:</span> {money(pendingProductSave.data.salesPrice)}</div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="rounded-lg bg-white p-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Before</p>
                            <div><span className="font-semibold">Name:</span> {pendingProductSave.before.name}</div>
                            <div><span className="font-semibold">Category:</span> {pendingProductSave.before.category}</div>
                            <div><span className="font-semibold">Stock:</span> {pendingProductSave.before.stock}</div>
                            <div><span className="font-semibold">Alert:</span> {pendingProductSave.before.alertLevel}</div>
                            <div><span className="font-semibold">Original:</span> {money(pendingProductSave.before.originalPrice)}</div>
                            <div><span className="font-semibold">Sales:</span> {money(pendingProductSave.before.salesPrice)}</div>
                          </div>

                          <div className="rounded-lg bg-white p-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">After</p>
                            <div><span className="font-semibold">Name:</span> {pendingProductSave.after.name}</div>
                            <div><span className="font-semibold">Category:</span> {pendingProductSave.after.category}</div>
                            <div><span className="font-semibold">Stock:</span> {pendingProductSave.after.stock}</div>
                            <div><span className="font-semibold">Alert:</span> {pendingProductSave.after.alertLevel}</div>
                            <div><span className="font-semibold">Original:</span> {money(pendingProductSave.after.originalPrice)}</div>
                            <div><span className="font-semibold">Sales:</span> {money(pendingProductSave.after.salesPrice)}</div>
                          </div>
                        </div>
                    )}
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={closeConfirmProductSaveDialog}
                        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmSaveProduct}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      {productSaveButton}
                    </button>
                  </div>
                </div>
              </div>
          )}

          {showDeleteProductDialog && productToDelete && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-black">Delete Product</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Are you sure you want to delete <span className="font-semibold">{productToDelete.name}</span>?
                      </p>
                    </div>
                    <button onClick={closeDeleteProductDialog} className="text-gray-500 hover:text-black">
                      ✕
                    </button>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={closeDeleteProductDialog}
                        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button type="button" onClick={confirmDeleteProduct} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                      Delete Product
                    </button>
                  </div>
                </div>
              </div>
          )}
        </main>
      </div>
  );
}