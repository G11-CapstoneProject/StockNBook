"use client";

import { useEffect, useMemo, useState } from "react";
import PlatformAdminSidebar from "../dashboard/PlatformAdminSidebar";
import {
    AdminHeader,
    AdminPageShell,
    AdminSection,
    Card,
    PlanBadge,
    SearchInput,
    SelectFilter,
    StatusPill,
} from "../_components/AdminUI";
import {
    Check,
    ChevronDown,
    ChevronUp,
    CreditCard,
    MoreVertical,
    RefreshCw,
    TrendingUp,
    X,
} from "lucide-react";

type StoreStatus = "ACTIVE" | "EXPIRING" | "EXPIRED" | "CANCELLED";

interface Store {
    id: number;
    store_name: string;
    owner_name: string;
    email: string;
    status: StoreStatus | string;
    signup_date: string | null;
    subscription_id: number | null;
    plan_id: number | null;
    plan_name: string;
    subscription_status: StoreStatus | string;
    started_at: string | null;
    expires_at: string | null;
    auto_renew: boolean;
    lifetime_paid: number;
}

interface Plan {
    id: number;
    name: string;
    price: number;
}

const STATUS_TONE: Record<string, "gold" | "green" | "red"> = {
    ACTIVE: "green",
    EXPIRING: "gold",
    EXPIRED: "red",
    CANCELLED: "red",
};

function formatDate(value: string | null) {
    if (!value) return "N/A";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";

    return date.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatExpiration(value: string | null, planName: string) {
    if (!value || planName.trim().toLowerCase() === "starter") {
        return "No expiration";
    }

    return formatDate(value);
}

function formatMoney(value: number) {
    return `₱${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}


export default function UsersPage() {
    const [stores, setStores] = useState<Store[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [query, setQuery] = useState("");
    const [planFilter, setPlanFilter] = useState("All plans");
    const [statusFilter, setStatusFilter] = useState("All statuses");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [openMenu, setOpenMenu] = useState<number | null>(null);
    const [expandedStore, setExpandedStore] = useState<number | null>(null);
    const [storePlanDetails, setStorePlanDetails] = useState<Record<number, any>>({});
    const [actionLoading, setActionLoading] = useState<number | null>(null);

    const API_ENDPOINT = "/api/subscription-admin";

    async function loadStores() {
        setLoading(true);
        setError("");

        try {
            const token =
                sessionStorage.getItem("token") || localStorage.getItem("token") || "";

            const [storesResponse, plansResponse] = await Promise.all([
                fetch(API_ENDPOINT, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "list_stores",
                        search: query,
                        plan: planFilter,
                        status: statusFilter,
                    }),
                    cache: "no-store",
                }),
                fetch(API_ENDPOINT, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ action: "list_plans" }),
                    cache: "no-store",
                }),
            ]);

            const storesBody = await storesResponse.json();
            const plansBody = await plansResponse.json();

            if (!storesResponse.ok) {
                throw new Error(storesBody.message || storesBody.error || "Unable to load stores.");
            }

            setStores(Array.isArray(storesBody.stores) ? storesBody.stores : []);
            setPlans(
                Array.isArray(plansBody.plans)
                    ? plansBody.plans.map((plan: any) => ({
                        id: Number(plan.id),
                        name: String(plan.name || ""),
                        price: Number(plan.price || 0),
                    }))
                    : [],
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to load stores.");
            setStores([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadStores();
        }, 150);

        return () => window.clearTimeout(timer);
    }, [query, planFilter, statusFilter]);

    async function changeStoreSubscription(store: Store, action: "suspend_store" | "reactivate_store") {
        setActionLoading(store.id);
        setOpenMenu(null);

        try {
            const token =
                sessionStorage.getItem("token") || localStorage.getItem("token") || "";

            const reason = window.prompt(
                action === "suspend_store"
                    ? `Reason for suspending ${store.store_name}:`
                    : `Reason for reactivating ${store.store_name}:`,
            );

            if (!reason?.trim()) return;

            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action,
                    store_id: store.id,
                    reason: reason.trim(),
                }),
            });

            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.message || body.error || "Unable to update subscription.");
            }

            await loadStores();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to update subscription.");
        } finally {
            setActionLoading(null);
        }
    }

    const planOptions = useMemo(() => {
        const names = plans.map((plan) => plan.name).filter(Boolean);
        return ["All plans", ...Array.from(new Set(names))];
    }, [plans]);


    async function loadStorePlanDetails(storeId: number) {
        if (storePlanDetails[storeId]) return;

        const token =
            sessionStorage.getItem("token") || localStorage.getItem("token") || "";

        const response = await fetch(API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                action: "get_store_plan_details",
                store_id: storeId,
            }),
            cache: "no-store",
        });

        const body = await response.json();

        if (response.ok) {
            setStorePlanDetails((prev) => ({
                ...prev,
                [storeId]: body,
            }));
        }
    }

    const storeCountLabel = `${stores.length} ${stores.length === 1 ? "store" : "stores"}`;

    return (
        <div className="flex min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
            <PlatformAdminSidebar onOpenSettings={() => {}} />

            <AdminPageShell>
                <AdminHeader
                    title="Users"
                    subtitle="Every store tenant registered on the platform"
                />

                <AdminSection>
                    {error && (
                        <div className="mb-4 rounded-xl border border-[#F0C8C8] bg-[#FFF4F4] px-4 py-3 text-xs font-semibold text-[#A43A3A]">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <SearchInput
                                value={query}
                                onChange={setQuery}
                                placeholder="Search by store, owner, or email..."
                            />
                        </div>

                        <SelectFilter
                            value={planFilter}
                            onChange={setPlanFilter}
                            options={planOptions}
                        />

                        <SelectFilter
                            value={statusFilter}
                            onChange={setStatusFilter}
                            options={["All statuses", "ACTIVE", "EXPIRING", "EXPIRED", "CANCELLED"]}
                        />

                        <div className="ml-auto inline-flex items-center gap-2 text-[11px]">
                            <span className="font-semibold text-[#6D35D4]">{storeCountLabel}</span>
                        </div>
                    </div>

                    <Card className="mt-4 overflow-visible p-0">
                        {loading ? (
                            <div className="px-6 py-14 text-center text-xs text-[#B0A2BE]">
                                Loading stores...
                            </div>
                        ) : stores.length === 0 ? (
                            <div className="px-6 py-14 text-center text-xs text-[#B0A2BE]">
                                No stores match these filters.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[1050px] text-left text-xs">
                                    <thead>
                                    <tr className="border-b border-[#EEE8F2] text-[10px] uppercase tracking-wide text-[#8A7D92]">
                                        <th className="px-5 py-3 font-semibold">Store</th>
                                        <th className="px-5 py-3 font-semibold">Plan</th>
                                        <th className="px-5 py-3 font-semibold">Status</th>
                                        <th className="px-5 py-3 font-semibold">Signed Up</th>
                                        <th className="px-5 py-3 font-semibold">Expires</th>
                                        <th className="px-5 py-3 font-semibold">Lifetime Paid</th>
                                        <th className="px-5 py-3 text-right font-semibold">Actions</th>
                                    </tr>
                                    </thead>

                                    <tbody>
                                    {stores.map((store) => {
                                        const status = String(store.subscription_status || "ACTIVE").toUpperCase();
                                        const tone = STATUS_TONE[status] || "gold";

                                        return (
                                            <>
                                                <tr
                                                    key={store.id}
                                                    className="border-b border-[#F3EFE3] transition last:border-0 hover:bg-[#FAF8FF]"
                                                >
                                                    <td className="px-5 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                aria-label={
                                                                    expandedStore === store.id
                                                                        ? `Collapse plan details for ${store.store_name}`
                                                                        : `Expand plan details for ${store.store_name}`
                                                                }
                                                                aria-expanded={expandedStore === store.id}
                                                                onClick={() => {
                                                                    setExpandedStore(
                                                                        expandedStore === store.id ? null : store.id
                                                                    );
                                                                    void loadStorePlanDetails(store.id);
                                                                }}
                                                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#8A7D92] transition hover:bg-[#F1EBFF] hover:text-[#6D35D4]"
                                                            >
                                                                {expandedStore === store.id ? (
                                                                    <ChevronUp size={16} />
                                                                ) : (
                                                                    <ChevronDown size={16} />
                                                                )}
                                                            </button>
                                                            <div className="min-w-0">
                                                                <p className="truncate text-[13px] font-semibold leading-5 text-[#30243A]">
                                                                    {store.store_name}
                                                                </p>
                                                                <p className="truncate text-[10px] font-medium text-[#806A8C]">
                                                                    {store.owner_name || "Owner"} · {store.email}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    <td className="px-5 py-4">
                                                        <PlanBadge plan={store.plan_name as any} />
                                                    </td>

                                                    <td className="px-5 py-4">
                                                        <StatusPill label={status} tone={tone} />
                                                    </td>

                                                    <td className="px-5 py-4 text-[#4B3E55]">
                                                        {formatDate(store.signup_date)}
                                                    </td>

                                                    <td className="px-5 py-4">
                                                        <div>
                                                            <p className={`font-semibold ${status === "EXPIRED" ? "text-[#C32F2F]" : status === "EXPIRING" ? "text-[#A56607]" : "text-[#4B3E55]"}`}>
                                                                {formatExpiration(store.expires_at, store.plan_name)}
                                                            </p>
                                                            {store.expires_at && store.plan_name.toLowerCase() !== "starter" && (
                                                                <p className="mt-0.5 text-[9px] text-[#8A7D92]">
                                                                    {store.auto_renew ? "Auto-renew enabled" : "Manual renewal"}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </td>

                                                    <td className="px-5 py-4 font-semibold text-[#30243A]">
                                                        {formatMoney(store.lifetime_paid)}
                                                    </td>

                                                    <td className="relative px-5 py-4 text-right">
                                                        <button
                                                            type="button"
                                                            aria-label={`Actions for ${store.store_name}`}
                                                            onClick={() => setOpenMenu(openMenu === store.id ? null : store.id)}
                                                            disabled={actionLoading === store.id}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8A7D92] transition hover:bg-[#F1EBFF] hover:text-[#6D35D4] disabled:opacity-50"
                                                        >
                                                            {actionLoading === store.id ? (
                                                                <RefreshCw size={15} className="animate-spin" />
                                                            ) : (
                                                                <MoreVertical size={16} />
                                                            )}
                                                        </button>

                                                        {openMenu === store.id && (
                                                            <div className="absolute right-5 top-12 z-30 w-44 overflow-hidden rounded-xl border border-[#E6DDF0] bg-white py-1 text-left shadow-[0_12px_30px_rgba(45,27,78,0.14)]">
                                                                {status === "CANCELLED" ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void changeStoreSubscription(store, "reactivate_store")}
                                                                        className="block w-full px-3 py-2.5 text-xs font-semibold text-[#16834A] hover:bg-[#F4FBF7]"
                                                                    >
                                                                        Reactivate subscription
                                                                    </button>
                                                                ) : status === "ACTIVE" || status === "EXPIRING" ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void changeStoreSubscription(store, "suspend_store")}
                                                                        className="block w-full px-3 py-2.5 text-xs font-semibold text-[#C32F2F] hover:bg-[#FFF4F4]"
                                                                    >
                                                                        Suspend subscription
                                                                    </button>
                                                                ) : (
                                                                    <div className="px-3 py-2.5 text-xs text-[#8A7D92]">
                                                                        No action available
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>

                                                {expandedStore === store.id && (
                                                    <tr className="bg-[#FAF8FF]">
                                                        <td colSpan={7} className="px-5 pb-2 pt-8">
                                                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                                <div className="rounded-2xl border border-[#E6DDF0] bg-white p-6">
                                                                    <div className="flex items-start gap-3">
                                                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]">
                                                                            <CreditCard size={18} />
                                                                        </span>
                                                                        <div>
                                                                            <h3 className="text-sm font-bold text-[#30243A]">
                                                                                Current plan features
                                                                            </h3>
                                                                            <p className="mt-0.5 text-[11px] text-[#8A7D92]">
                                                                                What this store can use under{" "}
                                                                                {storePlanDetails[store.id]?.plan_name || store.plan_name}.
                                                                            </p>
                                                                        </div>
                                                                    </div>

                                                                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                                        {(storePlanDetails[store.id]?.features || []).map((feature: any) => (
                                                                            <div
                                                                                key={feature.label}
                                                                                className="flex items-center gap-3 rounded-xl bg-[#F7F4FB] p-4 text-xs font-medium text-[#4B3E55]"
                                                                            >
                                                                                {feature.enabled ? (
                                                                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F4C556] text-[#5A4300]">
                                                                                        <Check size={13} strokeWidth={3} />
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E4DFEA] text-[#9A8FA6]">
                                                                                        <X size={13} strokeWidth={3} />
                                                                                    </span>
                                                                                )}
                                                                                {feature.label}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                <div className="rounded-2xl border border-[#E6DDF0] bg-white p-6">
                                                                    <div className="flex items-start gap-3">
                                                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E6EEFF] text-[#3D5FD1]">
                                                                            <TrendingUp size={18} />
                                                                        </span>
                                                                        <div>
                                                                            <h3 className="text-sm font-bold text-[#30243A]">
                                                                                Usage overview
                                                                            </h3>
                                                                            <p className="mt-0.5 text-[11px] text-[#8A7D92]">
                                                                                Monitor how much of each plan limit this store is using.
                                                                            </p>
                                                                        </div>
                                                                    </div>

                                                                    <div className="mt-5 space-y-5">
                                                                        {(storePlanDetails[store.id]?.usage || []).map((item: any) => {
                                                                            const limitReached = Number(item.percent) >= 100;

                                                                            return (
                                                                                <div key={item.label}>
                                                                                    <div className="flex items-center justify-between text-xs">
                                                                                        <span className="font-medium text-[#4B3E55]">
                                                                                            {item.label}
                                                                                        </span>
                                                                                        <span className="flex items-center gap-2">
                                                                                            {limitReached && (
                                                                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#C32F2F]">
                                                                                                    Limit reached
                                                                                                </span>
                                                                                            )}
                                                                                            <span
                                                                                                className={`font-semibold ${
                                                                                                    limitReached ? "text-[#C32F2F]" : "text-[#4B3E55]"
                                                                                                }`}
                                                                                            >
                                                                                                {item.current}/{item.limit}
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="mt-2 h-2 rounded-full bg-[#EEE8F2]">
                                                                                        <div
                                                                                            className={`h-2 rounded-full ${
                                                                                                limitReached ? "bg-[#D64545]" : "bg-[#6D35D4]"
                                                                                            }`}
                                                                                            style={{ width: `${item.percent}%` }}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        );
                                    })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </AdminSection>
            </AdminPageShell>
        </div>
    );
}