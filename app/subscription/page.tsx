"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    BarChart3,
    Boxes,
    CalendarDays,
    Check,
    CreditCard,
    GitBranch,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
    TrendingUp,
    Users,
    X,
} from "lucide-react";

interface Plan {
    id: number;
    name: string;
    price: number;
    max_inventory: number | null;
    max_bookings: number | null;
    max_staff: number | null;
    max_branches: number | null;
    has_low_stock_alerts: boolean;
    has_analytics: boolean;
    has_forecasting: boolean;
    has_multi_store: boolean;
}

interface SubscriptionResponse {
    role: "owner" | "manager" | "staff";
    can_manage_subscription: boolean;
    subscription: {
        subscription_id: number | null;
        status: string;
        started_at: string | null;
        expires_at: string | null;
        plan: Plan;
        usage: {
            inventory: number;
            bookings: number;
            staff: number;
            branches: number;
        };
        pending_payment: boolean;
        available_plans: Plan[];
    };
}

function formatLimit(value: number | null) {
    return value === null ? "Unlimited" : value.toLocaleString("en-PH");
}

function formatPrice(value: number) {
    return `₱${value.toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    })}`;
}

function featureList(plan: Plan) {
    return [
        {
            label: `${formatLimit(plan.max_inventory)} inventory items`,
            icon: Boxes,
            enabled: true,
        },
        {
            label: `${formatLimit(plan.max_bookings)} bookings`,
            icon: CalendarDays,
            enabled: true,
        },
        {
            label: `${formatLimit(plan.max_staff)} staff accounts`,
            icon: Users,
            enabled: true,
        },
        {
            label: `${formatLimit(plan.max_branches)} branches`,
            icon: GitBranch,
            enabled: true,
        },
        {
            label: "Low-stock alerts",
            icon: Boxes,
            enabled: plan.has_low_stock_alerts,
        },
        {
            label: "Analytics",
            icon: BarChart3,
            enabled: plan.has_analytics,
        },
        {
            label: "Forecasting",
            icon: BarChart3,
            enabled: plan.has_forecasting,
        },
        {
            label: "Multi-store management",
            icon: GitBranch,
            enabled: plan.has_multi_store,
        },
    ];
}

function usagePercent(current: number, limit: number | null) {
    if (limit === null || limit <= 0) return 0;
    return Math.min(100, Math.round((current / limit) * 100));
}

function formatCurrentDashboardDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}

export default function SubscriptionPage() {
    const { user, loading: userLoading } = useCurrentUser();
    const [data, setData] = useState<SubscriptionResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
    const [referenceNumber, setReferenceNumber] = useState("");
    const [receiptUrl, setReceiptUrl] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const interval = window.setInterval(updateDateTime, 60_000);

        return () => window.clearInterval(interval);
    }, []);

    const token = useMemo(() => {
        if (typeof window === "undefined") return "";
        return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
    }, [user]);

    async function loadSubscription() {
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/subscription-client", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
            });

            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "Unable to load subscription.");

            setData(body);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to load subscription.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (userLoading || !user) return;

        if (token) {
            loadSubscription();
        }
    }, [userLoading, user, token]);

    async function submitPayment() {
        if (!selectedPlan) return;

        setSubmitting(true);
        setError("");
        setMessage("");

        try {
            const res = await fetch("/api/subscription-client", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    plan_id: selectedPlan.id,
                    reference_number: referenceNumber.trim(),
                    receipt_url: receiptUrl.trim(),
                }),
            });

            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "Unable to submit payment.");

            setSelectedPlan(null);
            setReferenceNumber("");
            setReceiptUrl("");
            setMessage("Your payment proof has been submitted. The platform admin will review it before your plan changes.");
            await loadSubscription();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to submit payment.");
        } finally {
            setSubmitting(false);
        }
    }

    if (userLoading || loading) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[#FDFAF4] text-[#1A1220]">
                <p className="text-sm text-[#7A6E88]">Loading subscription...</p>
            </main>
        );
    }

    if (!user || !data) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[#FDFAF4] px-6 text-center">
                <div>
                    <h1 className="text-xl font-bold text-[#1A1220]">Subscription unavailable</h1>
                    <p className="mt-2 text-sm text-[#7A6E88]">{error || "Please sign in again."}</p>
                </div>
            </main>
        );
    }

    const subscription = data.subscription;
    const currentPlan = subscription.plan;
    const canManage = data.can_manage_subscription;
    const currentPrice = currentPlan.price;

    const upgradePlans = subscription.available_plans.filter(
        (plan) => plan.price > currentPrice,
    );

    const usageItems = [
        {
            label: "Inventory",
            current: subscription.usage.inventory,
            limit: currentPlan.max_inventory,
        },
        {
            label: "Bookings",
            current: subscription.usage.bookings,
            limit: currentPlan.max_bookings,
        },
        {
            label: "Staff",
            current: subscription.usage.staff,
            limit: currentPlan.max_staff,
        },
        {
            label: "Branches",
            current: subscription.usage.branches,
            limit: currentPlan.max_branches,
        },
    ];

    const limitWarnings = usageItems
        .map((item) => ({ ...item, percent: usagePercent(item.current, item.limit) }))
        .filter((item) => item.limit !== null && item.percent >= 80);

    return (
        <div
            style={{
                backgroundColor: "#FDFAF4",
                fontFamily: "Georgia, 'Times New Roman', serif",
            }}
            className="flex min-h-screen overflow-x-hidden text-[#1A1220]"
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden font-sans">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                    <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <div className="min-w-0">
                            <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                Subscription
                            </h1>
                            <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                                {canManage
                                    ? "Manage your plan, limits, usage, and billing."
                                    : "View your store's current plan, features, limits, and usage."}
                            </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {formatCurrentDashboardDateTime(currentDateTime)}
                            </span>

                            <button
                                type="button"
                                onClick={loadSubscription}
                                disabled={loading}
                                aria-label="Refresh subscription details"
                                title="Refresh subscription details"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <RefreshCw
                                    size={16}
                                    className={loading ? "animate-spin" : ""}
                                />
                                {loading ? "Refreshing..." : "Refresh"}
                            </button>
                        </div>
                    </div>
                </header>

                <div className="mx-auto max-w-[1440px] px-6 py-5 lg:px-6">
                    {message && (
                        <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#B9E5C7] bg-[#F2FBF5] px-4 py-3 text-sm font-medium leading-5 text-[#1F7A3F] shadow-[0_2px_8px_rgba(45,27,78,0.03)]">
                            {message}
                        </div>
                    )}

                    {error && (
                        <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#F0C8C8] bg-[#FFF4F4] px-4 py-3 text-sm font-medium leading-5 text-[#A43A3A] shadow-[0_2px_8px_rgba(45,27,78,0.03)]">
                            {error}
                        </div>
                    )}

                    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-2xl border border-[#E6DDE8] bg-white px-5 py-5 shadow-[0_3px_10px_rgba(45,27,78,0.055)] transition-shadow hover:shadow-[0_5px_16px_rgba(45,27,78,0.07)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#7A6E88]">Current Plan</p>
                                    <div className="mt-2 flex items-baseline gap-2">
                                        <h2 className="text-[26px] font-bold tracking-[-0.025em] text-[#1A1220]">{currentPlan.name}</h2>
                                        <span className="rounded-full bg-[#F4E9C6] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#8B6B1B]">
                                            Active
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-[#8A7D92]">
                                        {formatPrice(currentPlan.price)} / month
                                    </p>
                                </div>
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F3ECFF] text-[#6D35D4] ring-1 ring-[#E9DDF9]">
                                    <CreditCard className="h-5 w-5" />
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[#E6DDE8] bg-white px-5 py-5 shadow-[0_3px_10px_rgba(45,27,78,0.055)] transition-shadow hover:shadow-[0_5px_16px_rgba(45,27,78,0.07)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#7A6E88]">Subscription Status</p>
                                    <h2 className="mt-2 text-[27px] font-bold capitalize tracking-[-0.03em] text-[#16854B]">
                                        {subscription.status || "Active"}
                                    </h2>
                                    <p className="mt-1 text-xs text-[#8A7D92]">
                                        {subscription.pending_payment ? "Payment is awaiting platform admin review." : canManage ? "You control billing for this store." : "Billing is controlled by the account owner."}
                                    </p>
                                </div>
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EAF8F0] text-[#16854B] ring-1 ring-[#D8F0E2]">
                                    <ShieldCheck className="h-5 w-5" />
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[#E6DDE8] bg-white px-5 py-5 shadow-[0_3px_10px_rgba(45,27,78,0.055)] transition-shadow hover:shadow-[0_5px_16px_rgba(45,27,78,0.07)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#7A6E88]">Plan Access</p>
                                    <h2 className="mt-2 text-[26px] font-bold tracking-[-0.025em] text-[#2D1B4E]">
                                        {canManage ? "Owner managed" : "View only"}
                                    </h2>
                                    <p className="mt-1 text-xs text-[#8A7D92]">
                                        {canManage ? "Upgrade requests require payment proof and admin approval." : "Ask the owner to change the subscription."}
                                    </p>
                                </div>
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F3ECFF] text-[#6D35D4] ring-1 ring-[#E9DDF9]">
                                    {canManage ? <TrendingUp className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
                                </div>
                            </div>
                        </div>
                    </section>

                    {!canManage && (
                        <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#E7DCEB] bg-white px-4 py-3 text-xs font-semibold text-[#5D5168] shadow-[0_2px_8px_rgba(45,27,78,0.035)]">
                            <LockKeyhole className="h-4 w-4 shrink-0 text-[#6D35D4]" />
                            Subscription changes are available only to the account owner.
                        </div>
                    )}

                    {limitWarnings.length > 0 && (
                        <div className="mt-3 flex items-start gap-3 rounded-xl border border-[#E8D8A7] bg-[#FFF9E8] px-4 py-3 text-xs font-semibold leading-5 text-[#7A5A12] shadow-[0_2px_8px_rgba(45,27,78,0.035)]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B7791F]" />
                            <div>
                                <p>
                                    {limitWarnings.some((item) => item.percent >= 100)
                                        ? "One or more plan limits have been reached."
                                        : "One or more plan limits are close to being reached."}
                                </p>
                                <p className="mt-0.5 font-medium text-[#8A6A20]">
                                    {limitWarnings.map((item) => `${item.label}: ${item.current} / ${formatLimit(item.limit)}`).join(" • ")}
                                    {canManage
                                        ? " You can review available plans below if more capacity is needed."
                                        : " Contact the account owner if the store needs a higher plan."}
                                </p>
                            </div>
                        </div>
                    )}

                    <section className="mt-3.5 grid gap-3.5 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="rounded-2xl border border-[#E6DDE8] bg-white shadow-[0_3px_10px_rgba(45,27,78,0.055)]">
                            <div className="border-b border-[#EEE7EF] px-5 py-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F3ECFF] text-[#6D35D4]">
                                        <CreditCard className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h2 className="text-base font-bold tracking-[-0.02em] text-[#1A1220]">Current plan features</h2>
                                        <p className="mt-1 text-xs text-[#8A7D92]">What your store can use under {currentPlan.name}.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-2.5 p-5 sm:grid-cols-2">
                                {featureList(currentPlan).map((feature) => (
                                    <div
                                        key={feature.label}
                                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm ${
                                            feature.enabled
                                                ? "border-[#E7DCEB] bg-[#FCFAFE] text-[#3C3046]"
                                                : "border-[#EFE9F1] bg-[#FAF8FB] text-[#A49AA9]"
                                        }`}
                                    >
                                        {feature.enabled ? (
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F4E9C6] text-[#A8790C]">
                                                <Check className="h-3.5 w-3.5" />
                                            </span>
                                        ) : (
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F0EBF2]">
                                                <X className="h-3.5 w-3.5" />
                                            </span>
                                        )}
                                        <span>{feature.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[#E6DDE8] bg-white shadow-[0_3px_10px_rgba(45,27,78,0.055)]">
                            <div className="border-b border-[#EEE7EF] px-5 py-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FF] text-[#3566D4]">
                                        <TrendingUp className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h2 className="text-base font-bold tracking-[-0.02em] text-[#1A1220]">Usage overview</h2>
                                        <p className="mt-1 text-xs text-[#8A7D92]">Monitor how much of each plan limit your store is using.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-5 p-5">
                                {usageItems.map((item) => {
                                    const percent = usagePercent(item.current, item.limit);
                                    const reached = item.limit !== null && percent >= 100;
                                    const nearLimit = item.limit !== null && percent >= 80 && percent < 100;
                                    const barClass = reached
                                        ? "bg-[#C53D3D] shadow-[0_0_8px_rgba(197,61,61,0.22)]"
                                        : nearLimit
                                            ? "bg-[#C28A18] shadow-[0_0_8px_rgba(194,138,24,0.22)]"
                                            : "bg-[#6D35D4] shadow-[0_0_8px_rgba(109,53,212,0.22)]";
                                    const statusText = reached
                                        ? "Limit reached"
                                        : nearLimit
                                            ? "Near limit"
                                            : item.limit === null
                                                ? "Unlimited"
                                                : `${percent}% used`;

                                    return (
                                        <div key={item.label}>
                                            <div className="flex items-center justify-between gap-3 text-xs">
                                                <span className="font-semibold text-[#4B3E55]">{item.label}</span>
                                                <div className="flex items-center gap-2 text-right">
                                                    <span className={reached ? "font-semibold text-[#C53D3D]" : nearLimit ? "font-semibold text-[#A87510]" : "font-medium text-[#8A7D92]"}>
                                                        {statusText}
                                                    </span>
                                                    <span className="font-medium text-[#8A7D92]">
                                                        {item.current.toLocaleString("en-PH")} / {formatLimit(item.limit)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#EEE8F2] ring-1 ring-inset ring-[#E6DDE8]">
                                                <div
                                                    className={`h-full rounded-full transition-all ${barClass}`}
                                                    style={{
                                                        width: `${item.limit === null ? 12 : Math.max(percent, item.current > 0 ? 4 : 0)}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    <section className="mt-6">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1A1220]">Available plans</h2>
                                <p className="mt-1 text-xs text-[#8A7D92]">
                                    {canManage ? "Upgrade your store when you need higher limits or more features." : "Compare available plans. Plan changes are managed by the account owner."}
                                </p>
                            </div>
                            {subscription.pending_payment && (
                                <span className="inline-flex w-fit items-center rounded-full bg-[#FFF5D9] px-3 py-1.5 text-[10px] font-semibold text-[#8B6B1B]">
                                    Payment awaiting review
                                </span>
                            )}
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {subscription.available_plans.map((plan) => {
                                const isCurrent = plan.id === currentPlan.id;
                                const canChoose = canManage && plan.price > currentPrice && !subscription.pending_payment;
                                const isLower = plan.price < currentPrice;

                                return (
                                    <article
                                        key={plan.id}
                                        className={`relative rounded-2xl border bg-white p-5 shadow-[0_3px_10px_rgba(45,27,78,0.055)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(45,27,78,0.08)] ${
                                            isCurrent
                                                ? "border-[#6D35D4] ring-2 ring-[#6D35D4]/10"
                                                : "border-[#E6DDE8]"
                                        }`}
                                    >
                                        {isCurrent && (
                                            <span className="absolute right-4 top-4 rounded-full bg-[#F3ECFF] px-2.5 py-1 text-[10px] font-semibold text-[#6D35D4]">
                                                Current plan
                                            </span>
                                        )}

                                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9A7A25]">
                                            {isCurrent ? "Active" : plan.price > currentPrice ? "Upgrade option" : "Available"}
                                        </p>
                                        <h3 className="mt-2 text-[21px] font-bold tracking-[-0.02em] text-[#1A1220]">{plan.name}</h3>
                                        <p className="mt-1 text-[25px] font-bold tracking-[-0.025em] text-[#2D1B4E]">
                                            {formatPrice(plan.price)}
                                            <span className="ml-1 text-xs font-medium text-[#8A7D92]">/month</span>
                                        </p>

                                        <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
                                            <div className="rounded-lg bg-[#FBF9FD] px-3 py-2">
                                                <span className="block text-[#8A7D92]">Inventory</span>
                                                <strong className="mt-0.5 block text-[#3C3046]">{formatLimit(plan.max_inventory)}</strong>
                                            </div>
                                            <div className="rounded-lg bg-[#FBF9FD] px-3 py-2">
                                                <span className="block text-[#8A7D92]">Bookings</span>
                                                <strong className="mt-0.5 block text-[#3C3046]">{formatLimit(plan.max_bookings)}</strong>
                                            </div>
                                            <div className="rounded-lg bg-[#FBF9FD] px-3 py-2">
                                                <span className="block text-[#8A7D92]">Staff</span>
                                                <strong className="mt-0.5 block text-[#3C3046]">{formatLimit(plan.max_staff)}</strong>
                                            </div>
                                            <div className="rounded-lg bg-[#FBF9FD] px-3 py-2">
                                                <span className="block text-[#8A7D92]">Branches</span>
                                                <strong className="mt-0.5 block text-[#3C3046]">{formatLimit(plan.max_branches)}</strong>
                                            </div>
                                        </div>

                                        <div className="mt-4 space-y-2">
                                            {featureList(plan).slice(4).map((feature) => (
                                                <div key={feature.label} className="flex items-center justify-between text-xs">
                                                    <span className="text-[#5D5168]">{feature.label}</span>
                                                    <span className={feature.enabled ? "font-semibold text-[#16854B]" : "text-[#A49AA9]"}>
                                                        {feature.enabled ? "Included" : "Not included"}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-5">
                                            {isCurrent ? (
                                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FAF7FC] px-4 py-3 text-center text-xs font-semibold text-[#7A6E88]">
                                                    You are currently using this plan
                                                </div>
                                            ) : !canManage ? (
                                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FAF7FC] px-4 py-3 text-center text-xs font-semibold text-[#7A6E88]">
                                                    Managed by the account owner
                                                </div>
                                            ) : isLower ? (
                                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FAF7FC] px-4 py-3 text-center text-xs font-semibold text-[#7A6E88]">
                                                    Downgrade is not available here
                                                </div>
                                            ) : subscription.pending_payment ? (
                                                <div className="rounded-xl border border-[#E8D8A7] bg-[#FFF9E8] px-4 py-3 text-center text-xs font-semibold text-[#8B6B1B]">
                                                    Payment awaiting review
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={!canChoose}
                                                    onClick={() => setSelectedPlan(plan)}
                                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#412563] focus:outline-none focus:ring-4 focus:ring-[#6D35D4]/15 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <CreditCard className="h-4 w-4" />
                                                    Upgrade to {plan.name}
                                                </button>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>

                    {canManage && upgradePlans.length === 0 && (
                        <div className="mt-5 rounded-xl border border-[#E7DCEB] bg-white px-5 py-4 text-sm text-[#7A6E88] shadow-[0_2px_8px_rgba(45,27,78,0.03)]">
                            You are already on the highest priced active plan. Contact the platform administrator if you need a custom plan.
                        </div>
                    )}
                </div>
            </main>

            {selectedPlan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1220]/55 px-4 py-6 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-2xl border border-[#E7DCEB] bg-white p-6 shadow-[0_18px_60px_rgba(26,18,32,0.22)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A7A25]">Payment proof</p>
                                <h2 className="mt-2 text-2xl font-bold text-[#1A1220]">Upgrade to {selectedPlan.name}</h2>
                                <p className="mt-1 text-sm leading-6 text-[#7A6E88]">
                                    Pay {formatPrice(selectedPlan.price)} for one month, then submit your GCash reference and receipt link for platform admin review.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedPlan(null)}
                                className="rounded-full p-2 text-[#7A6E88] hover:bg-[#F5F0F7]"
                                aria-label="Close payment dialog"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-[#E7DCEB] bg-[#FBF9FD] p-4">
                                <span className="text-xs text-[#8A7D92]">Selected plan</span>
                                <strong className="mt-1 block text-sm text-[#2D1B4E]">{selectedPlan.name}</strong>
                            </div>
                            <div className="rounded-xl border border-[#E7DCEB] bg-[#FBF9FD] p-4">
                                <span className="text-xs text-[#8A7D92]">Amount to pay</span>
                                <strong className="mt-1 block text-sm text-[#2D1B4E]">{formatPrice(selectedPlan.price)}</strong>
                            </div>
                        </div>

                        <label className="mt-5 block text-xs font-semibold text-[#4B3E55]">
                            GCash reference number
                            <input
                                value={referenceNumber}
                                onChange={(event) => setReferenceNumber(event.target.value)}
                                placeholder="Enter the reference number from GCash"
                                className="mt-2 h-11 w-full rounded-xl border border-[#DCCFE8] bg-white px-3 text-sm font-medium text-[#1A1220] outline-none transition placeholder:text-[#9C91A6] focus:border-[#6D35D4] focus:ring-4 focus:ring-[#6D35D4]/10"
                            />
                        </label>

                        <label className="mt-4 block text-xs font-semibold text-[#4B3E55]">
                            Receipt / proof link
                            <input
                                value={receiptUrl}
                                onChange={(event) => setReceiptUrl(event.target.value)}
                                placeholder="Paste the uploaded receipt link"
                                className="mt-2 h-11 w-full rounded-xl border border-[#DCCFE8] bg-white px-3 text-sm font-medium text-[#1A1220] outline-none transition placeholder:text-[#9C91A6] focus:border-[#6D35D4] focus:ring-4 focus:ring-[#6D35D4]/10"
                            />
                            <span className="mt-1.5 block text-[11px] font-normal leading-5 text-[#8A7D92]">
                                Your current project does not include a file-storage service, so this field accepts the receipt URL used by the admin payment-review screen.
                            </span>
                        </label>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setSelectedPlan(null)}
                                className="rounded-xl border border-[#DCCFE8] bg-white px-5 py-2.5 text-sm font-semibold text-[#4B3E55] hover:bg-[#FAF7FC]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={submitting || !referenceNumber.trim()}
                                onClick={submitPayment}
                                className="rounded-xl bg-[#2D1B4E] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? "Submitting..." : "Submit for review"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
