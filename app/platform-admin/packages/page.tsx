"use client";

import { useState } from "react";
import PlatformAdminSidebar from "../dashboard/PlatformAdminSidebar";
import { Archive, Pencil, Plus, Users2 } from "lucide-react";
import { AdminHeader, AdminPageShell, AdminSection, Card } from "../_components/AdminUI";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanStatus = "Active" | "Archived";

interface PlanLimits {
    maxInventoryItems: number | "Unlimited";
    maxStaffAccounts: number | "Unlimited";
    maxBranches: number | "Unlimited";
}

interface PlanItem {
    id: string;
    name: string;
    tagline: string;
    price: number; // PHP
    limits: PlanLimits;
    activeSubscribers: number;
    status: PlanStatus;
    badgeStyle: string; // matches PlanBadge tones from the dashboard
    barColor: string;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PLANS: PlanItem[] = [
    {
        id: "p0",
        name: "Starter",
        tagline: "For stores just getting started",
        price: 0,
        limits: { maxInventoryItems: 50, maxStaffAccounts: 1, maxBranches: 1 },
        activeSubscribers: 6,
        status: "Active",
        badgeStyle: "border-[#B7E5C2] bg-[#E6F6EA] text-[#226B36]",
        barColor: "bg-[#3FA85E]",
    },
    {
        id: "p1",
        name: "Business",
        tagline: "For growing rental & supply shops",
        price: 499,
        limits: { maxInventoryItems: 1000, maxStaffAccounts: 5, maxBranches: 2 },
        activeSubscribers: 9,
        status: "Active",
        badgeStyle: "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
        barColor: "bg-[#E6B44C]",
    },
    {
        id: "p2",
        name: "Enterprise",
        tagline: "For multi-branch operations at scale",
        price: 1299,
        limits: { maxInventoryItems: "Unlimited", maxStaffAccounts: "Unlimited", maxBranches: "Unlimited" },
        activeSubscribers: 3,
        status: "Active",
        badgeStyle: "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]",
        barColor: "bg-[#6D35D4]",
    },
    {
        id: "p3",
        name: "Legacy Starter",
        tagline: "Retired plan — grandfathered subscribers only",
        price: 199,
        limits: { maxInventoryItems: 200, maxStaffAccounts: 2, maxBranches: 1 },
        activeSubscribers: 0,
        status: "Archived",
        badgeStyle: "border-[#E6DDF0] bg-[#F1EEF5] text-[#7A6A84]",
        barColor: "bg-[#C9C2D6]",
    },
];

function formatPeso(amount: number) {
    return amount === 0 ? "Free" : `\u20B1${amount.toLocaleString("en-PH")}`;
}

const totalActiveSubscribers = MOCK_PLANS.reduce((sum, p) => sum + p.activeSubscribers, 0);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlansPage() {
    const [plans] = useState<PlanItem[]>(MOCK_PLANS);

    return (
        <div className="flex min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
            <PlatformAdminSidebar onOpenSettings={() => {}} />

            <AdminPageShell>
                <AdminHeader
                    title="Plans"
                    subtitle="What stores can subscribe to, and how each plan is performing"
                    action={
                        <button
                            type="button"
                            className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <Plus size={14} /> New plan
                        </button>
                    }
                />

                <AdminSection>
                    {/* Subscriber mix — informs pricing strategy at a glance */}
                    <Card>
                        <div className="flex items-center gap-3">
                            <Users2 size={16} className="shrink-0 text-[#8A7D92]" />
                            <span className="shrink-0 text-[11px] font-semibold text-[#4B3E55]">Subscriber mix</span>
                            <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[#F3EFE3]">
                                {plans
                                    .filter((p) => p.status === "Active")
                                    .map((p) => (
                                        <div
                                            key={p.id}
                                            style={{ width: `${(p.activeSubscribers / totalActiveSubscribers) * 100}%` }}
                                            className={p.barColor}
                                            title={`${p.name}: ${p.activeSubscribers}`}
                                        />
                                    ))}
                            </div>
                            <span className="shrink-0 text-[11px] text-[#8A7D92]">{totalActiveSubscribers} active total</span>
                        </div>
                    </Card>

                    {/* Plan cards */}
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                        {plans.map((plan) => (
                            <Card key={plan.id} className={plan.status === "Archived" ? "opacity-60" : ""}>
                                <div className="flex flex-col">
                                    <div className="mb-3 flex items-start justify-between">
                                        <span
                                            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${plan.badgeStyle}`}
                                        >
                                            {plan.name}
                                        </span>
                                        {plan.status === "Archived" && (
                                            <span className="text-[9px] uppercase tracking-wide text-[#8A7D92]">Archived</span>
                                        )}
                                    </div>

                                    <p className="mb-4 text-[11px] text-[#7A6A84]">{plan.tagline}</p>

                                    <div className="mb-5">
                                        <span className="text-[26px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                                            {formatPeso(plan.price)}
                                        </span>
                                        {plan.price > 0 && <span className="text-[11px] text-[#8A7D92]"> / month</span>}
                                    </div>

                                    <ul className="mb-6 flex-1 space-y-2 text-[11px] text-[#4B3E55]">
                                        <LimitRow label="Inventory items" value={plan.limits.maxInventoryItems} />
                                        <LimitRow label="Staff accounts" value={plan.limits.maxStaffAccounts} />
                                        <LimitRow label="Branches" value={plan.limits.maxBranches} />
                                    </ul>

                                    <div className="flex items-center justify-between border-t border-[#EEE8F2] pt-4">
                                        <div className="text-[11px] text-[#8A7D92]">
                                            <span className="font-semibold text-[#1A1220]">{plan.activeSubscribers}</span>{" "}
                                            subscriber{plan.activeSubscribers === 1 ? "" : "s"}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                className="rounded-md p-1.5 text-[#7A6A84] hover:bg-[#FAF8FF]"
                                                aria-label={`Edit ${plan.name}`}
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                className="rounded-md p-1.5 text-[#7A6A84] hover:bg-[#FAF8FF]"
                                                aria-label={`Archive ${plan.name}`}
                                            >
                                                <Archive size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </AdminSection>
            </AdminPageShell>
        </div>
    );
}

function LimitRow({ label, value }: { label: string; value: number | "Unlimited" }) {
    return (
        <li className="flex items-center justify-between">
            <span>{label}</span>
            <span className="font-semibold text-[#1A1220]">{value}</span>
        </li>
    );
}