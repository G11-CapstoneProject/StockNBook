/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import RequirePermission from "@/components/RequirePermission";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Boxes,
  AlertTriangle,
  ArchiveX,
  Store,
} from "lucide-react";

type Product = {
  id: number;
  branchId?: number | null;
  branchName?: string | null;
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

type Branch = {
  id: number;
  branchName: string;
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

type BranchesApiResponse = {
  branches?: any[];
  error?: string;
};

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

const STATUS_STYLE = {
  in: "bg-[#E6F6EA] text-[#226B36]",
  low: "bg-[#FFF4D8] text-[#8A5A00]",
  out: "bg-[#FFE5E5] text-[#9A2424]",
};

function money(n: number) {
  const value = Number(n ?? 0);
  return `₱${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;
}

function getStatus(p: Product) {
  if (p.stock <= 0) return { label: "Out of Stock", style: STATUS_STYLE.out };
  if (p.stock <= p.alertLevel) return { label: "Low Stock", style: STATUS_STYLE.low };
  return { label: "In Stock", style: STATUS_STYLE.in };
}

function normalizeProduct(raw: any): Product {
  return {
    id: Number(raw.id),
    branchId: raw.branchId ?? raw.branch_id ?? null,
    branchName: raw.branchName ?? raw.branch_name ?? null,
    name: raw.name || "",
    category: raw.category || "",
    stock: Number(raw.stock ?? 0),
    alertLevel: Number(raw.alertLevel ?? raw.alert_level ?? 0),
    originalPrice: Number(raw.originalPrice ?? raw.original_price ?? 0),
    salesPrice: Number(raw.salesPrice ?? raw.sales_price ?? 0),
  };
}

function StatCard({
                    icon,
                    label,
                    value,
                  }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
      <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-[#5F4E75]">
          {icon}
          <p className="text-xs font-semibold uppercase tracking-[0.12em]">{label}</p>
        </div>
        <p className="mt-2 font-serif text-2xl font-semibold text-[#1A1220]">{value}</p>
      </div>
  );
}

function BranchListItem({
                          branch,
                          products,
                          selected,
                          onClick,
                        }: {
  branch: Branch;
  products: Product[];
  selected: boolean;
  onClick: () => void;
}) {
  const low = products.filter((p) => p.stock > 0 && p.stock <= p.alertLevel).length;
  const out = products.filter((p) => p.stock <= 0).length;

  return (
      <button
          type="button"
          onClick={onClick}
          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
              selected
                  ? "border-[#2B174C] bg-[#F7F1FF] shadow-sm"
                  : "border-[#E6DDF0] bg-white hover:bg-[#FFFCF7]"
          }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-serif text-base font-semibold text-[#1A1220]">
              {branch.branchName}
            </p>
            <p className="mt-1 text-xs text-[#8A7A91]">
              {products.length} product{products.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="rounded-full bg-[#FFFDF8] px-2 py-1 text-[10px] font-semibold text-[#5F4E75]">
            {products.length}
          </div>
        </div>

        <div className="mt-3 flex gap-2 text-[10px]">
        <span className="rounded-full bg-[#FFFDF8] px-2 py-1 text-[#8A5A00]">
          Low {low}
        </span>
          <span className="rounded-full bg-[#FFFDF8] px-2 py-1 text-[#9A2424]">
          Out {out}
        </span>
        </div>
      </button>
  );
}

function ProductTable({
                        products,
                        isOwner,
                        onEdit,
                        onDelete,
                      }: {
  products: Product[];
  isOwner: boolean;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}) {
  return (
      <div className="w-full overflow-x-auto">
        <table className={`w-full ${isOwner ? "min-w-[760px]" : "min-w-[680px]"} text-xs sm:text-sm`}>
          <thead>
          <tr className="border-b border-[#E6DDF0]">
            <th className="pb-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Product
            </th>
            {isOwner && (
                <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                  Branch
                </th>
            )}
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Category
            </th>
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Stock
            </th>
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Alert
            </th>
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Original
            </th>
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Sales
            </th>
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Status
            </th>
            <th className="pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
              Actions
            </th>
          </tr>
          </thead>

          <tbody>
          {products.map((p) => {
            const s = getStatus(p);

            return (
                <tr key={p.id} className="border-b border-[#EFE7F4] last:border-0">
                  <td className="py-4 pr-3 font-serif font-semibold text-[#1A1220]">{p.name}</td>

                  {isOwner && (
                      <td className="py-4 text-center text-[#6A5D6F]">
                        {p.branchName || "Unassigned"}
                      </td>
                  )}

                  <td className="py-4 text-center text-[#6A5D6F]">{p.category}</td>
                  <td className="py-4 text-center text-[#1A1220]">{p.stock}</td>
                  <td className="py-4 text-center text-[#6A5D6F]">{p.alertLevel}</td>
                  <td className="py-4 text-center text-[#6A5D6F]">{money(p.originalPrice)}</td>
                  <td className="py-4 text-center text-[#1A1220]">{money(p.salesPrice)}</td>

                  <td className="py-4 text-center">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.style}`}>
                    {s.label}
                  </span>
                  </td>

                  <td className="py-4 text-center">
                    <button
                        onClick={() => onEdit(p)}
                        className="mr-3 text-xs font-semibold text-[#2B174C] hover:underline"
                    >
                      Edit
                    </button>
                    <button
                        onClick={() => onDelete(p)}
                        className="text-xs font-semibold text-red-500 hover:underline"
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
  );
}

export default function InventoryPage() {
  const [formMode, setFormMode] = useState<"product" | "category">("product");

  const [products, setProducts] = useState<Product[]>([]);
  const [manualCategories, setManualCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  const [storeName, setStoreName] = useState("Store Name");
  const [role, setRole] = useState("");
  const [assignedBranchId, setAssignedBranchId] = useState("");
  const [assignedBranchName, setAssignedBranchName] = useState("");

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("");
  const [alertLevel, setAlertLevel] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [productBranchId, setProductBranchId] = useState("");

  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCategoryValue, setEditCategoryValue] = useState("");

  const [showDeleteProductDialog, setShowDeleteProductDialog] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  const [showConfirmProductSaveDialog, setShowConfirmProductSaveDialog] = useState(false);
  const [pendingProductSave, setPendingProductSave] = useState<PendingProductSave | null>(null);

  const isOwner = role === "owner";
  const isBranchUser = role === "manager" || role === "staff";

  const labelClass = "text-xs font-semibold text-[#5A476A]";
  const fieldClass =
      "w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]";

  async function safeParseResponse<T = unknown>(res: Response): Promise<{ data: T; text: string }> {
    const text = await res.text();

    try {
      return { data: JSON.parse(text) as T, text };
    } catch {
      return {
        data: { error: text || "Non-JSON response from server" } as T,
        text,
      };
    }
  }

  function getTokenOrAlert(): string | null {
    const token = sessionStorage.getItem("token");

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

  function readSessionInfo() {
    const currentRole = (sessionStorage.getItem("role") || "").toLowerCase();

    const currentBranchId =
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id") ||
        "";

    const currentBranchName =
        sessionStorage.getItem("branch_name") ||
        sessionStorage.getItem("stocknbook_branch_name") ||
        "";

    const savedStoreName =
        sessionStorage.getItem("store_name") ||
        sessionStorage.getItem("stocknbook_store_name") ||
        "Store Name";

    setRole(currentRole);
    setAssignedBranchId(currentBranchId);
    setAssignedBranchName(currentBranchName);
    setStoreName(savedStoreName);

    if (currentRole === "manager" || currentRole === "staff") {
      setProductBranchId(currentBranchId);
    }
  }

  function normalizeCat(s: string) {
    return s.trim();
  }

  async function loadProducts() {
    const token = sessionStorage.getItem("token");

    if (!token) {
      setProducts([]);
      return;
    }

    const currentRole = (sessionStorage.getItem("role") || "").toLowerCase();

    const currentBranchId =
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id") ||
        "";

    const payload: Record<string, unknown> = {
      action: "get_products",
    };

    if ((currentRole === "manager" || currentRole === "staff") && currentBranchId) {
      payload.branch_id = Number(currentBranchId);
    }

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const { data } = await safeParseResponse<ProductsApiResponse>(res);

      if (res.ok && Array.isArray(data.products)) {
        setProducts(data.products.map(normalizeProduct));
      } else {
        console.warn("Products fetch failed:", data);
        setProducts([]);
      }
    } catch (err) {
      console.warn("Products fetch failed:", err);
      setProducts([]);
    }
  }

  async function loadCategories() {
    const token = sessionStorage.getItem("token");

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

      const { data } = await safeParseResponse<CategoryApiResponse>(res);

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
  }

  async function loadBranches() {
    const token = sessionStorage.getItem("token");

    if (!token) {
      setBranches([]);
      return;
    }

    try {
      const res = await fetch("/api/branches", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const { data } = await safeParseResponse<BranchesApiResponse>(res);

      if (!res.ok || !Array.isArray(data.branches)) {
        setBranches([]);
        return;
      }

      const mapped = data.branches.map((b: any) => ({
        id: Number(b.id ?? b.branch_id ?? b.branchId),
        branchName: b.branchName ?? b.branch_name ?? b.name ?? "Unnamed Branch",
      }));

      setBranches(mapped.filter((b) => b.id));
    } catch (err) {
      console.warn("Branches fetch failed:", err);
      setBranches([]);
    }
  }

  useEffect(() => {
    readSessionInfo();
    void loadCategories();
    void loadBranches();
    void loadProducts();
  }, []);

  const branchGroups = useMemo(() => {
    const groups: Record<string, Product[]> = {};

    products.forEach((product) => {
      const key = product.branchId ? String(product.branchId) : "unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(product);
    });

    return groups;
  }, [products]);

  const categories = useMemo(() => {
    const productCats = products.map((p) => p.category.trim());
    const manualCats = manualCategories.map((c) => c.categoryName.trim());
    const all = [...new Set([...productCats, ...manualCats])].filter(Boolean);
    return all.sort((a, b) => a.localeCompare(b));
  }, [products, manualCategories]);

  const selectedBranch =
      branches.find((b) => String(b.id) === selectedBranchId) || null;

  const baseProducts = isOwner
      ? branchGroups[selectedBranchId] || []
      : products;

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return baseProducts.filter((p) => {
      const matchesCategory = selectedCategory === "All" ? true : p.category === selectedCategory;

      const matchesSearch =
          q.length === 0
              ? true
              : p.name.toLowerCase().includes(q) ||
              p.category.toLowerCase().includes(q) ||
              (p.branchName || "").toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [baseProducts, selectedCategory, search]);

  const filteredCategoriesForManage = useMemo(() => {
    const q = category.trim().toLowerCase();

    if (!q) return categories;

    return categories.filter((c) => c.toLowerCase().includes(q));
  }, [categories, category]);

  const selectedBranchValue = baseProducts.reduce((sum, p) => sum + p.salesPrice * p.stock, 0);
  const totalProducts = baseProducts.length;
  const lowStock = baseProducts.filter((p) => p.stock > 0 && p.stock <= p.alertLevel).length;
  const outStock = baseProducts.filter((p) => p.stock <= 0).length;

  function resetProductForm() {
    setName("");
    setCategory("");
    setStock("");
    setAlertLevel("");
    setOriginalPrice("");
    setSalesPrice("");
    setProductBranchId(isBranchUser ? assignedBranchId : selectedBranchId || "");
  }

  function resetCategoryForm() {
    setCategory("");
    setEditingCategory(null);
    setEditCategoryValue("");
  }

  function handleSubmitProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!name.trim() || !category.trim()) return;

    const targetBranchId = isBranchUser ? assignedBranchId : productBranchId;

    if (!targetBranchId) {
      alert("❌ Please select a branch for this product.");
      return;
    }

    const branchLabel =
        branches.find((b) => String(b.id) === String(targetBranchId))?.branchName ||
        assignedBranchName ||
        null;

    const after = {
      branchId: Number(targetBranchId),
      branchName: branchLabel,
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

    const branchIdForSave =
        pendingProductSave.mode === "edit"
            ? pendingProductSave.after.branchId
            : pendingProductSave.data.branchId;

    if (!branchIdForSave) {
      alert("❌ Missing branch for product.");
      return;
    }

    const payload =
        pendingProductSave.mode === "edit"
            ? {
              action: "update_product",
              id: pendingProductSave.editingId,
              branch_id: Number(branchIdForSave),
              ...pendingProductSave.after,
            }
            : {
              action: "create_product",
              branch_id: Number(branchIdForSave),
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

      const { data } = await safeParseResponse<ProductsApiResponse>(res);

      if (!res.ok) {
        alert(`❌ ${data?.error || "Failed to save product"}`);
        return;
      }

      await loadProducts();

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
    setProductBranchId(String(p.branchId || assignedBranchId || ""));
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
          ...(productToDelete.branchId ? { branch_id: Number(productToDelete.branchId) } : {}),
        }),
      });

      const { data } = await safeParseResponse<ProductsApiResponse>(res);

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

      const { data } = await safeParseResponse<CategoryApiResponse>(res);

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

      const { data } = await safeParseResponse<CategoryApiResponse>(res);

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

      const { data } = await safeParseResponse<CategoryApiResponse>(res);

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

  function pillClass(isSelected: boolean) {
    return [
      "rounded-full px-4 py-1.5 text-xs transition",
      isSelected
          ? "bg-[#2B174C] text-white font-bold shadow-sm"
          : "border border-[#E6DDF0] bg-white text-[#6A5D6F] font-medium hover:bg-[#F7F1FF]",
    ].join(" ");
  }

  const productSaveTitle = pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";
  const productSaveButton = pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";

  const currentMonth = new Date().toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });

  return (
      <RequirePermission permission="inventory">
        <div
            className="flex min-h-screen text-[#1A1220]"
            style={{
              backgroundColor: "#FDFAF4",
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
        >


          <main className="min-w-0 flex-1 overflow-x-hidden">
            <div className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
              <div className="flex items-center justify-between px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-serif text-[22px] font-semibold text-[#1A1220]">Inventory</h1>
                  <span className="rounded-md bg-[#EFE8F8] px-3 py-1 text-xs font-medium text-[#4E2C66]">
                  {isOwner ? "By Branch" : assignedBranchName || "Assigned Branch"}
                </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-[#E6DDF0] bg-white px-4 py-2 text-xs text-[#6A5D6F] shadow-sm">
                    {currentMonth}
                  </div>

                  <button
                      onClick={() => {
                        void loadProducts();
                        void loadCategories();
                        void loadBranches();
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#5F4E75] shadow-sm hover:bg-[#F7F1FF]"
                      title="Refresh"
                  >
                    <RefreshCw size={15} />
                  </button>

                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2B174C] text-xs font-semibold text-white shadow-sm">
                    {isOwner ? "OW" : role === "staff" ? "ST" : "MG"}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                  <input
                      placeholder={isOwner ? "Search product or category in selected branch..." : "Search products..."}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-3 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                  />
                </div>

                <button
                    onClick={() => {
                      resetCategoryForm();
                      setFormMode("category");
                      setShowForm(true);
                    }}
                    className="rounded-xl border border-[#E6DDF0] bg-white px-5 py-3 text-sm font-semibold text-[#2B174C] shadow-sm hover:bg-[#F7F1FF]"
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
                    className="rounded-xl bg-[#2B174C] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
                >
                  + Add Product
                </button>
              </div>

              {isOwner ? (
                  <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
                    <section className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h2 className="font-serif text-base font-semibold text-[#1A1220]">Branches</h2>
                          <p className="text-xs text-[#9B8AAA]">{branches.length} total</p>
                        </div>
                        <Store size={17} className="text-[#5F4E75]" />
                      </div>

                      <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                        {branches.length === 0 ? (
                            <p className="text-sm text-[#9B8AAA]">No branches found.</p>
                        ) : (
                            branches.map((branch) => (
                                <BranchListItem
                                    key={branch.id}
                                    branch={branch}
                                    products={branchGroups[String(branch.id)] || []}
                                    selected={selectedBranchId === String(branch.id)}
                                    onClick={() => setSelectedBranchId(String(branch.id))}
                                />
                            ))
                        )}
                      </div>
                    </section>

                    <section className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                      <div className="border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-4">
                        <p className="font-serif text-lg font-semibold text-[#1A1220]">
                          {selectedBranch?.branchName || "Select a Branch"}
                        </p>
                        <p className="text-xs text-[#8A7A91]">
                          {selectedBranch
                              ? `${baseProducts.length} products in this branch.`
                              : "Choose a branch from the list to view inventory."}
                        </p>
                      </div>

                      {selectedBranch ? (
                          <>
                            <div className="grid gap-3 border-b border-[#E6DDF0] p-4 md:grid-cols-4">
                              <StatCard icon={<Boxes size={16} />} label="Items" value={totalProducts} />
                              <StatCard icon={<AlertTriangle size={16} />} label="Low Stock" value={lowStock} />
                              <StatCard icon={<ArchiveX size={16} />} label="Out of Stock" value={outStock} />
                              <StatCard icon={<Boxes size={16} />} label="Value" value={money(selectedBranchValue)} />
                            </div>

                            <div className="border-b border-[#E6DDF0] px-4 py-4">
                              <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-[#1A1220]">Categories</h2>
                                <span className="text-xs text-[#9B8AAA]">{categories.length} total</span>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSelectedCategory("All")}
                                    className={pillClass(selectedCategory === "All")}
                                >
                                  All
                                </button>

                                {categories.map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setSelectedCategory(c)}
                                        className={pillClass(selectedCategory === c)}
                                    >
                                      {c}
                                    </button>
                                ))}
                              </div>
                            </div>

                            <div className="p-4">
                              {filteredProducts.length === 0 ? (
                                  <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                                    <p className="text-sm text-[#9B8AAA]">No products found for this branch.</p>
                                  </div>
                              ) : (
                                  <ProductTable
                                      products={filteredProducts}
                                      isOwner={isOwner}
                                      onEdit={handleEditProduct}
                                      onDelete={requestDeleteProduct}
                                  />
                              )}
                            </div>
                          </>
                      ) : (
                          <div className="flex min-h-[420px] items-center justify-center p-4">
                            <p className="text-sm text-[#9B8AAA]">Select a branch to view its inventory.</p>
                          </div>
                      )}
                    </section>
                  </div>
              ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <StatCard icon={<Boxes size={16} />} label="Items" value={totalProducts} />
                      <StatCard icon={<AlertTriangle size={16} />} label="Low Stock" value={lowStock} />
                      <StatCard icon={<ArchiveX size={16} />} label="Out of Stock" value={outStock} />
                      <StatCard icon={<Boxes size={16} />} label="Value" value={money(selectedBranchValue)} />
                    </div>

                    <section className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[#1A1220]">Categories</h2>
                        <span className="text-xs text-[#9B8AAA]">{categories.length} total</span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setSelectedCategory("All")}
                            className={pillClass(selectedCategory === "All")}
                        >
                          All
                        </button>

                        {categories.map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setSelectedCategory(c)}
                                className={pillClass(selectedCategory === c)}
                            >
                              {c}
                            </button>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                      <div className="mb-4">
                        <h2 className="font-serif text-base font-semibold text-[#1A1220]">Products</h2>
                        <p className="text-xs text-[#9B8AAA]">
                          {filteredProducts.length} item{filteredProducts.length !== 1 ? "s" : ""}
                        </p>
                      </div>

                      {filteredProducts.length === 0 ? (
                          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                            <p className="text-sm text-[#9B8AAA]">No products found.</p>
                          </div>
                      ) : (
                          <ProductTable
                              products={filteredProducts}
                              isOwner={false}
                              onEdit={handleEditProduct}
                              onDelete={requestDeleteProduct}
                          />
                      )}
                    </section>
                  </div>
              )}
            </div>
          </main>

          {showForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-serif text-lg font-semibold text-[#1A1220]">
                      {formMode === "category" ? "Manage Categories" : editingId ? "Edit Product" : "Add Product"}
                    </h2>

                    <button onClick={() => setShowForm(false)} className="text-[#9B8AAA] hover:text-[#1A1220]">
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
                            <label className={labelClass}>Category Name</label>
                            <div className="flex gap-2">
                              <input
                                  value={category}
                                  onChange={(e) => setCategory(e.target.value)}
                                  placeholder="Type to search or add new..."
                                  className={fieldClass}
                              />
                              <button
                                  type="button"
                                  onClick={() => void addCategoryNow(category)}
                                  className="rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                              >
                                Add
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className={labelClass}>Existing Categories</p>

                            <div className="max-h-48 space-y-2 overflow-auto">
                              {filteredCategoriesForManage.length === 0 ? (
                                  <p className="text-sm text-[#9B8AAA]">No matching categories.</p>
                              ) : (
                                  filteredCategoriesForManage.map((c) => (
                                      <div
                                          key={c}
                                          className="flex items-center justify-between rounded-xl bg-[#F8F2EA] p-2 text-[#1A1220]"
                                      >
                                        {editingCategory === c ? (
                                            <input
                                                value={editCategoryValue}
                                                onChange={(e) => setEditCategoryValue(e.target.value)}
                                                className="mr-2 flex-1 rounded-lg border border-[#E3D8EA] px-2 py-1 text-sm text-[#1A1220] focus:border-[#2B174C] focus:outline-none"
                                            />
                                        ) : (
                                            <span className="text-sm font-medium">{c}</span>
                                        )}

                                        <div className="flex items-center gap-2">
                                          {editingCategory === c ? (
                                              <>
                                                <button
                                                    type="button"
                                                    onClick={() => void updateCategoryNow(c, editCategoryValue)}
                                                    className="text-xs font-semibold text-green-600 hover:underline"
                                                >
                                                  Save
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelEditCategory}
                                                    className="text-xs font-semibold text-[#6A5D6F] hover:underline"
                                                >
                                                  Cancel
                                                </button>
                                              </>
                                          ) : (
                                              <>
                                                <button
                                                    type="button"
                                                    onClick={() => startEditCategory(c)}
                                                    className="text-xs font-semibold text-[#2B174C] hover:underline"
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void deleteCategoryNow(c)}
                                                    className="text-xs font-semibold text-red-500 hover:underline"
                                                >
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
                          {isOwner && (
                              <div className="space-y-1">
                                <label className={labelClass}>Branch</label>
                                <select
                                    value={productBranchId}
                                    onChange={(e) => setProductBranchId(e.target.value)}
                                    className={fieldClass}
                                >
                                  <option value="">Select branch</option>
                                  {branches.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.branchName}
                                      </option>
                                  ))}
                                </select>
                              </div>
                          )}

                          {isBranchUser && (
                              <div className="rounded-xl bg-[#F7F1FF] px-3 py-2 text-xs font-medium text-[#4E2C66]">
                                Branch: {assignedBranchName || "Assigned Branch"}
                              </div>
                          )}

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

                          <button
                              type="submit"
                              className="w-full rounded-xl bg-[#2B174C] py-3 text-sm font-semibold text-white transition hover:bg-[#1B0D31]"
                          >
                            Save Product
                          </button>
                        </>
                    )}
                  </form>
                </div>
              </div>
          )}

          {showConfirmProductSaveDialog && pendingProductSave && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-serif text-xl font-semibold text-[#1A1220]">{productSaveTitle}</h3>
                      <p className="mt-1 text-sm text-[#6A5D6F]">
                        {pendingProductSave.mode === "edit"
                            ? `Are you sure you want to update ${pendingProductSave.before.name}?`
                            : "Are you sure you want to save this product?"}
                      </p>
                    </div>

                    <button onClick={closeConfirmProductSaveDialog} className="text-[#9B8AAA] hover:text-[#1A1220]">
                      ✕
                    </button>
                  </div>

                  <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] p-3 text-sm text-[#1A1220]">
                    <p className="mb-3 text-sm font-semibold text-[#6A5D6F]">Changes</p>

                    {pendingProductSave.mode === "add" ? (
                        <div className="space-y-1 rounded-lg bg-white p-3">
                          <div><span className="font-semibold">Branch:</span> {pendingProductSave.data.branchName || "—"}</div>
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
                            <p className="mb-2 text-xs font-semibold uppercase text-[#9B8AAA]">Before</p>
                            <div><span className="font-semibold">Branch:</span> {pendingProductSave.before.branchName || "—"}</div>
                            <div><span className="font-semibold">Name:</span> {pendingProductSave.before.name}</div>
                            <div><span className="font-semibold">Category:</span> {pendingProductSave.before.category}</div>
                            <div><span className="font-semibold">Stock:</span> {pendingProductSave.before.stock}</div>
                            <div><span className="font-semibold">Alert:</span> {pendingProductSave.before.alertLevel}</div>
                            <div><span className="font-semibold">Original:</span> {money(pendingProductSave.before.originalPrice)}</div>
                            <div><span className="font-semibold">Sales:</span> {money(pendingProductSave.before.salesPrice)}</div>
                          </div>

                          <div className="rounded-lg bg-white p-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-[#9B8AAA]">After</p>
                            <div><span className="font-semibold">Branch:</span> {pendingProductSave.after.branchName || "—"}</div>
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
                        className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                    >
                      Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmSaveProduct}
                        className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                    >
                      {productSaveButton}
                    </button>
                  </div>
                </div>
              </div>
          )}

          {showDeleteProductDialog && productToDelete && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-serif text-lg font-semibold text-[#1A1220]">Delete Product</h3>
                      <p className="mt-1 text-sm text-[#6A5D6F]">
                        Are you sure you want to delete{" "}
                        <span className="font-semibold">{productToDelete.name}</span>?
                      </p>
                    </div>

                    <button onClick={closeDeleteProductDialog} className="text-[#9B8AAA] hover:text-[#1A1220]">
                      ✕
                    </button>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={closeDeleteProductDialog}
                        className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                    >
                      Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirmDeleteProduct}
                        className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      Delete Product
                    </button>
                  </div>
                </div>
              </div>
          )}
        </div>
      </RequirePermission>
  );
}