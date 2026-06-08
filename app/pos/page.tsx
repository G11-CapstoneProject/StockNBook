"use client";

<<<<<<< HEAD
import RequirePermission from "@/components/RequirePermission";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  ShoppingCart,
  Plus,
  Minus,
  Store,
} from "lucide-react";

type CartMap = { [key: number]: number };

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

type ProductApiRaw = {
  id: number | string;
  branchId?: number | string | null;
  branch_id?: number | string | null;
  branchName?: string | null;
  branch_name?: string | null;
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

type Branch = {
  id: number;
  branchName: string;
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

type BranchesApiResponse = {
  branches?: any[];
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
    }).format(Number(n || 0));

const mapProduct = (p: ProductApiRaw): Product => {
  const rawBranchId = p.branchId ?? p.branch_id ?? null;

  return {
    id: Number(p.id),
    branchId: rawBranchId ? Number(rawBranchId) : null,
    branchName: p.branchName ?? p.branch_name ?? null,
    name: String(p.name ?? ""),
    category: String(p.category ?? ""),
    stock: Number(p.stock ?? 0),
    alertLevel: Number(p.alertLevel ?? p.alert_level ?? 0),
    originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
    salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
  };
};

const readProducts = (): Product[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = sessionStorage.getItem("stocknbook_inventory_products");
    const parsed = raw ? (JSON.parse(raw) as Product[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readOrders = (): Order[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = sessionStorage.getItem("stocknbook_orders");
    const parsed = raw ? (JSON.parse(raw) as Order[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readCategories = (): Category[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw = sessionStorage.getItem("stocknbook_categories");
    const parsed = raw ? (JSON.parse(raw) as Category[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readRole = (): string => {
  if (typeof window === "undefined") return "";
  return (sessionStorage.getItem("role") || "").toLowerCase();
};

const readBranchId = (): string => {
  if (typeof window === "undefined") return "";
  return (
      sessionStorage.getItem("branch_id") ||
      sessionStorage.getItem("stocknbook_branch_id") ||
      ""
  );
};

const readBranchName = (): string => {
  if (typeof window === "undefined") return "";
  return (
      sessionStorage.getItem("branch_name") ||
      sessionStorage.getItem("stocknbook_branch_name") ||
      ""
  );
};

function StatCard({
                    label,
                    value,
                  }: {
  label: string;
  value: string | number;
}) {
  return (
      <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-medium tracking-[0.08em] text-[#9B8AAA]">
          {label}
        </p>
        <p className="mt-1 font-serif text-xl font-semibold text-[#1A1220]">
          {value}
        </p>
      </div>
  );
}
=======
import RequirePermission from "@/components/permissions/RequirePermission";
import OwnerPOS from "@/components/pos/OwnerPOS";
import ManagerPOS from "@/components/pos/ManagerPOS";
import StaffPOS from "@/components/pos/StaffPOS";
import { usePOS } from "@/hooks/usePOS";
>>>>>>> main

export default function POSPage() {
  const pos = usePOS();

  return (
      <RequirePermission permission="pos">
<<<<<<< HEAD
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
                  <h1 className="font-serif text-[22px] font-semibold text-[#1A1220]">
                    POS / Sales
                  </h1>

                  <span className="rounded-md bg-[#EFE8F8] px-3 py-1 text-xs font-medium text-[#4E2C66]">
                  {isOwner
                      ? "Sales Overview"
                      : activeBranchName || "Assigned Branch"}
                </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-[#E6DDF0] bg-white px-4 py-2 text-xs text-[#6A5D6F] shadow-sm">
                    {currentMonth}
                  </div>

                  <button
                      onClick={() => {
                        void loadData();
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
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                {isOwner ? (
                    <>
                      <StatCard label="Total Orders" value={orders.length} />
                      <StatCard label="Total Sales" value={peso(totalRevenue)} />
                      <StatCard label="Total Revenue" value={peso(totalProfit)} />
                    </>
                ) : (
                    <>
                      <StatCard label="Today's Sales" value={peso(todayRevenue)} />
                      <StatCard label="Orders Today" value={todayOrders.length} />
                      <StatCard label="Today's Profit" value={peso(todayProfit)} />
                    </>
                )}
              </div>

              {isOwner ? (
                  <div className="space-y-4">
                    <section className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center gap-2">
                        <Store size={16} className="text-[#5F4E75]" />
                        <div>
                          <h2 className="font-serif text-base font-semibold text-[#1A1220]">
                            Sales by Branch
                          </h2>
                          <p className="text-xs text-[#8A7A91]">
                            Tap a branch to view its orders.
                          </p>
                        </div>
                      </div>

                      {branches.length === 0 ? (
                          <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                            <p className="text-sm text-[#9B8AAA]">No branches found.</p>
                          </div>
                      ) : (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {branches.map((branch) => {
                              const branchData = getBranchSales(branch);
                              const isSelected =
                                  selectedSalesBranchId === String(branch.id);

                              return (
                                  <button
                                      key={branch.id}
                                      type="button"
                                      onClick={() => setSelectedSalesBranchId(String(branch.id))}
                                      className={`rounded-[14px] border p-3 text-left transition ${
                                          isSelected
                                              ? "border-[#2B174C] bg-[#F7F1FF] shadow-sm"
                                              : "border-[#E6DDF0] bg-[#FFFCF7] hover:border-[#BFAED4]"
                                      }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="truncate font-serif text-sm font-semibold text-[#1A1220]">
                                        {branch.branchName}
                                      </p>

                                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#6A5D6F]">
                                {branchData.orders.length}
                              </span>
                                    </div>

                                    <div className="mt-3">
                                      <p className="text-[10px] font-medium tracking-[0.08em] text-[#9B8AAA]">
                                        Sales
                                      </p>
                                      <p className="font-serif text-lg font-semibold text-[#1A1220]">
                                        {peso(branchData.sales)}
                                      </p>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                      <div className="rounded-lg bg-white px-2 py-2">
                                        <p className="text-[10px] text-[#9B8AAA]">Orders</p>
                                        <p className="text-sm font-semibold text-[#1A1220]">
                                          {branchData.orders.length}
                                        </p>
                                      </div>

                                      <div className="rounded-lg bg-white px-2 py-2">
                                        <p className="text-[10px] text-[#9B8AAA]">Revenue</p>
                                        <p className="text-sm font-semibold text-[#1A1220]">
                                          {peso(branchData.profit)}
                                        </p>
                                      </div>
                                    </div>
                                  </button>
                              );
                            })}
                          </div>
                      )}
                    </section>

                    <section className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                      <div className="border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-3">
                        <h3 className="font-serif text-base font-semibold text-[#1A1220]">
                          {selectedBranch
                              ? `${selectedBranch.branchName} Orders`
                              : "Branch Orders"}
                        </h3>
                        <p className="text-xs text-[#8A7A91]">
                          {selectedBranchData
                              ? `${selectedBranchData.orders.length} orders for this branch.`
                              : "Select a branch above to view its order list."}
                        </p>
                      </div>

                      {!selectedBranch || !selectedBranchData ? (
                          <div className="flex min-h-[160px] items-center justify-center bg-white">
                            <p className="text-sm text-[#9B8AAA]">
                              No branch selected yet.
                            </p>
                          </div>
                      ) : selectedBranchData.orders.length === 0 ? (
                          <div className="flex min-h-[160px] items-center justify-center bg-white">
                            <p className="text-sm text-[#9B8AAA]">
                              No orders found for this branch.
                            </p>
                          </div>
                      ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-sm">
                              <thead>
                              <tr className="border-b border-[#E6DDF0]">
                                <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                                  Order ID
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                                  Customer
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                                  Items
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                                  Total
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                                  Date
                                </th>
                              </tr>
                              </thead>

                              <tbody>
                              {selectedBranchData.orders.map((o) => (
                                  <tr
                                      key={o.id}
                                      className="border-b border-[#EFE7F4] last:border-0"
                                  >
                                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-[#5F4E75]">
                                      {o.id}
                                    </td>
                                    <td className="px-4 py-3 text-[#1A1220]">
                                      {o.customer || "Customer"}
                                    </td>
                                    <td className="px-4 py-3 text-[#6A5D6F]">
                                      {Array.isArray(o.items) && o.items.length > 0 ? (
                                          <div className="space-y-1">
                                            {o.items.map((item, idx) => (
                                                <div key={`${item.name}-${idx}`}>
                                                  {item.name} x{item.quantity}
                                                </div>
                                            ))}
                                          </div>
                                      ) : (
                                          "—"
                                      )}
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-[#1A1220]">
                                      {peso(o.total)}
                                    </td>
                                    <td className="px-4 py-3 text-[#6A5D6F]">
                                      {o.date}
                                    </td>
                                  </tr>
                              ))}
                              </tbody>
                            </table>
                          </div>
                      )}
                    </section>
                  </div>
              ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                      <section className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                          <div className="relative flex-1">
                            <Search
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search items..."
                                className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-3 pl-10 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                            />
                          </div>

                          <select
                              value={categoryFilter}
                              onChange={(e) => setCategoryFilter(e.target.value)}
                              className="rounded-xl border border-[#E3D8EA] bg-white px-4 py-3 text-sm text-[#1A1220] outline-none focus:border-[#2B174C]"
                          >
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                            ))}
                          </select>
                        </div>

                        {filteredProducts.length === 0 ? (
                            <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                              <p className="text-sm text-[#9B8AAA]">
                                No products found.
                              </p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-xl border border-[#E6DDF0] bg-white">
                              <div className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.7fr_0.8fr] border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-3 text-[11px] font-semibold tracking-[0.12em] text-[#806A8C]">
                                <div>Product</div>
                                <div>Category</div>
                                <div className="text-center">Stock</div>
                                <div className="text-right">Price</div>
                                <div className="text-center">Qty</div>
                              </div>

                              <div className="max-h-[520px] overflow-y-auto">
                                {filteredProducts.map((p) => {
                                  const qty = cart[p.id] || 0;
                                  const out = p.stock <= 0;
                                  const isMax = qty >= p.stock && p.stock > 0;

                                  return (
                                      <div
                                          key={p.id}
                                          className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.7fr_0.8fr] items-center border-b border-[#EFE7F4] px-4 py-3 last:border-0 hover:bg-[#FFFCF7]"
                                      >
                                        <div className="min-w-0">
                                          <p className="truncate font-serif text-sm font-semibold text-[#1A1220]">
                                            {p.name}
                                          </p>

                                          {out ? (
                                              <p className="mt-0.5 text-[11px] font-semibold text-red-500">
                                                Out of stock
                                              </p>
                                          ) : p.stock <= p.alertLevel ? (
                                              <p className="mt-0.5 text-[11px] font-semibold text-[#8A5A00]">
                                                Low stock
                                              </p>
                                          ) : (
                                              <p className="mt-0.5 text-[11px] text-[#9B8AAA]">
                                                Available
                                              </p>
                                          )}
                                        </div>

                                        <div className="truncate text-xs text-[#6A5D6F]">
                                          {p.category || "Uncategorized"}
                                        </div>

                                        <div className="text-center text-xs font-semibold text-[#1A1220]">
                                          {p.stock}
                                        </div>

                                        <div className="text-right font-serif text-sm font-semibold text-[#1A1220]">
                                          {peso(Number(p.salesPrice || 0))}
                                        </div>

                                        <div className="flex items-center justify-center gap-2">
                                          <button
                                              onClick={() => handleQty(p.id, -1)}
                                              disabled={qty <= 0}
                                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            <Minus size={12} />
                                          </button>

                                          <span className="min-w-6 text-center font-serif text-sm font-semibold text-[#1A1220]">
                                    {qty}
                                  </span>

                                          <button
                                              onClick={() => handleQty(p.id, 1)}
                                              disabled={out || isMax}
                                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            <Plus size={12} />
                                          </button>
                                        </div>
                                      </div>
                                  );
                                })}
                              </div>
                            </div>
                        )}
                      </section>

                      <aside className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm xl:sticky xl:top-24 xl:self-start">
                        <div className="mb-3 flex items-center justify-between border-b border-[#E6DDF0] pb-3">
                          <div className="flex items-center gap-2">
                            <ShoppingCart size={16} className="text-[#5F4E75]" />
                            <h2 className="font-serif text-base font-semibold text-[#1A1220]">
                              Current Order
                            </h2>
                          </div>

                          {cartItems.length > 0 && (
                              <button
                                  onClick={resetOrderDraft}
                                  className="text-xs font-semibold text-red-500 hover:underline"
                              >
                                Clear
                              </button>
                          )}
                        </div>

                        <div className="max-h-[260px] space-y-3 overflow-y-auto pr-1">
                          {cartItems.length === 0 ? (
                              <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                                <p className="text-sm text-[#9B8AAA]">
                                  No items added yet.
                                </p>
                              </div>
                          ) : (
                              cartItems.map((i) => (
                                  <div
                                      key={i.id}
                                      className="rounded-xl border border-[#EFE7F4] bg-[#FFFCF7] p-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-[#1A1220]">
                                          {i.name}
                                        </p>
                                        <p className="text-xs text-[#8A7A91]">
                                          {i.qty} × {peso(i.price)}
                                        </p>
                                      </div>

                                      <p className="text-sm font-semibold text-[#1A1220]">
                                        {peso(i.lineTotal)}
                                      </p>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleQty(i.id, -1)}
                                            disabled={i.qty <= 0}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] disabled:opacity-40"
                                        >
                                          <Minus size={12} />
                                        </button>

                                        <input
                                            value={String(i.qty)}
                                            onChange={(e) => {
                                              const val = Number(e.target.value);
                                              if (!Number.isFinite(val)) return;
                                              setQty(i.id, val);
                                            }}
                                            className="h-7 w-12 rounded-lg border border-[#E6DDF0] bg-white text-center text-xs font-semibold text-[#1A1220] outline-none focus:border-[#2B174C]"
                                            inputMode="numeric"
                                        />

                                        <button
                                            onClick={() => handleQty(i.id, 1)}
                                            disabled={i.qty >= i.stock}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] disabled:opacity-40"
                                        >
                                          <Plus size={12} />
                                        </button>
                                      </div>

                                      <button
                                          onClick={() => removeItemFromCart(i.id)}
                                          className="text-xs font-semibold text-red-500 hover:underline"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                              ))
                          )}
                        </div>

                        <div className="mt-4 border-t border-[#E6DDF0] pt-4">
                          <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#6A5D6F]">
                          Total
                        </span>
                            <span className="font-serif text-xl font-semibold text-[#1A1220]">
                          {peso(total)}
                        </span>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="mb-1 block text-xs font-semibold text-[#5A476A]">
                                Customer Payment
                              </label>
                              <input
                                  value={payment}
                                  onChange={(e) => setPayment(e.target.value)}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  className="w-full rounded-xl border border-[#E3D8EA] px-3 py-2 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none"
                              />
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-[#E3D8EA] bg-[#FFFCF7] px-3 py-2">
                          <span className="text-xs font-semibold text-[#5A476A]">
                            Change
                          </span>
                              <span className="text-sm font-semibold text-[#1A1220]">
                            {peso(change)}
                          </span>
                            </div>

                            <button
                                onClick={handlePlaceOrder}
                                disabled={cartItems.length === 0}
                                className="w-full rounded-xl bg-[#2B174C] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Place Order
                            </button>
                          </div>
                        </div>
                      </aside>
                    </div>

                    <section className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                      <div className="border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-3">
                        <h3 className="font-serif text-base font-semibold text-[#1A1220]">
                          Recent Orders
                        </h3>
                        <p className="text-xs text-[#8A7A91]">
                          {orders.length} recorded orders
                        </p>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead>
                          <tr className="border-b border-[#E6DDF0]">
                            <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                              Order ID
                            </th>
                            <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                              Customer
                            </th>
                            <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                              Items
                            </th>
                            <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                              Total
                            </th>
                            <th className="px-4 py-3 text-left text-[11px] font-medium tracking-[0.1em] text-[#806A8C]">
                              Date
                            </th>
                          </tr>
                          </thead>

                          <tbody>
                          {orders.length === 0 ? (
                              <tr>
                                <td
                                    colSpan={5}
                                    className="px-4 py-10 text-center text-sm text-[#9B8AAA]"
                                >
                                  No orders yet.
                                </td>
                              </tr>
                          ) : (
                              orders.map((o) => (
                                  <tr
                                      key={o.id}
                                      className="border-b border-[#EFE7F4] last:border-0"
                                  >
                                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-[#5F4E75]">
                                      {o.id}
                                    </td>
                                    <td className="px-4 py-3 text-[#1A1220]">
                                      {o.customer || "Customer"}
                                    </td>
                                    <td className="px-4 py-3 text-[#6A5D6F]">
                                      {Array.isArray(o.items) && o.items.length > 0 ? (
                                          <div className="space-y-1">
                                            {o.items.map((item, idx) => (
                                                <div key={`${item.name}-${idx}`}>
                                                  {item.name} x{item.quantity}
                                                </div>
                                            ))}
                                          </div>
                                      ) : (
                                          "—"
                                      )}
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-[#1A1220]">
                                      {peso(o.total)}
                                    </td>
                                    <td className="px-4 py-3 text-[#6A5D6F]">
                                      {o.date}
                                    </td>
                                  </tr>
                              ))
                          )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
              )}
            </div>
          </main>
        </div>
=======
        {pos.isOwner ? (
            <OwnerPOS pos={pos} />
        ) : pos.role === "manager" ? (
            <ManagerPOS pos={pos} />
        ) : (
            <StaffPOS pos={pos} />
        )}
>>>>>>> main
      </RequirePermission>
  );
}