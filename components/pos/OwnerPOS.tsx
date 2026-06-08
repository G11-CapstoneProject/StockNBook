"use client";

import { Store } from "lucide-react";
import type { UsePOSReturn } from "@/hooks/usePOS";
import { OrdersTable, POSLayout, StatCard, peso } from "./_shared";

export default function OwnerPOS({ pos }: { pos: UsePOSReturn }) {
    return (
        <POSLayout
            role={pos.role}
            isOwner={pos.isOwner}
            activeBranchName={pos.activeBranchName}
            currentMonth={pos.currentMonth}
            onRefresh={pos.refreshAll}
        >
            <div className="mb-4 grid gap-3 md:grid-cols-3">
                <StatCard label="Total Orders" value={pos.orders.length} />
                <StatCard label="Total Sales" value={peso(pos.totalRevenue)} />
                <StatCard label="Total Revenue" value={peso(pos.totalProfit)} />
            </div>

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

                    {pos.branches.length === 0 ? (
                        <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
                            <p className="text-sm text-[#9B8AAA]">No branches found.</p>
                        </div>
                    ) : (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {pos.branches.map((branch) => {
                                const branchData = pos.getBranchSales(branch);
                                const isSelected =
                                    pos.selectedSalesBranchId === String(branch.id);

                                return (
                                    <button
                                        key={branch.id}
                                        type="button"
                                        onClick={() =>
                                            pos.setSelectedSalesBranchId(String(branch.id))
                                        }
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

                {!pos.selectedBranch || !pos.selectedBranchData ? (
                    <section className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                        <div className="border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-3">
                            <h3 className="font-serif text-base font-semibold text-[#1A1220]">
                                Branch Orders
                            </h3>
                            <p className="text-xs text-[#8A7A91]">
                                Select a branch above to view its order list.
                            </p>
                        </div>

                        <div className="flex min-h-[160px] items-center justify-center bg-white">
                            <p className="text-sm text-[#9B8AAA]">No branch selected yet.</p>
                        </div>
                    </section>
                ) : (
                    <OrdersTable
                        title={`${pos.selectedBranch.branchName} Orders`}
                        subtitle={`${pos.selectedBranchData.orders.length} orders for this branch.`}
                        orders={pos.selectedBranchData.orders}
                        emptyText="No orders found for this branch."
                    />
                )}
            </div>
        </POSLayout>
    );
}