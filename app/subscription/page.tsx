"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    BarChart3,
    Boxes,
    CalendarDays,
    Check,
    CreditCard,
    Clock3,
    GitBranch,
    LockKeyhole,
    Mail,
    QrCode,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    TrendingUp,
    UploadCloud,
    FileImage,
    Trash2,
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
    // Optional future backend field. The current UI also has a safe fallback
    // for the built-in Starter / Growth / Scale plan names.
    tier_order?: number | null;
}

interface GCashPaymentSettings {
    account_name: string;
    gcash_number: string;
    instruction: string;
    qr_image: string;
    configured: boolean;
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
        effective_plan?: (Plan & { access_status?: string }) | null;
        access_status?: "PAID" | "GRACE" | "STARTER_FALLBACK";
        days_until_expiration?: number | null;
        available_plans: Plan[];
    };
}


const BUILT_IN_PLAN_TIER: Record<string, number> = {
    starter: 1,
    growth: 2,
    scale: 3,
};

type PlanDirection = "current" | "upgrade" | "downgrade";

function getPlanTier(plan: Plan) {
    if (Number.isFinite(Number(plan.tier_order)) && Number(plan.tier_order) > 0) {
        return Number(plan.tier_order);
    }

    return BUILT_IN_PLAN_TIER[String(plan.name || "").trim().toLowerCase()] ?? null;
}

function getPlanDirection(plan: Plan, currentPlan: Plan): PlanDirection {
    if (plan.id === currentPlan.id) return "current";

    const targetTier = getPlanTier(plan);
    const currentTier = getPlanTier(currentPlan);

    if (targetTier !== null && currentTier !== null) {
        return targetTier > currentTier ? "upgrade" : "downgrade";
    }

    // Compatibility fallback for custom plans that do not yet expose tier_order.
    return plan.price > currentPlan.price ? "upgrade" : "downgrade";
}

function getDowngradeLimitIssues(
    plan: Plan,
    usage: SubscriptionResponse["subscription"]["usage"],
) {
    const checks = [
        { label: "Inventory", current: usage.inventory, limit: plan.max_inventory },
        { label: "Bookings", current: usage.bookings, limit: plan.max_bookings },
        { label: "Staff", current: usage.staff, limit: plan.max_staff },
        { label: "Branches", current: usage.branches, limit: plan.max_branches },
    ];

    return checks.filter(
        (item) => item.limit !== null && item.current > Number(item.limit),
    );
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
            label: `${formatLimit(plan.max_bookings)} new bookings per month`,
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
    const [upgradeStep, setUpgradeStep] = useState<"details" | "otp" | "payment">("details");
    const [referenceNumber, setReferenceNumber] = useState("");
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [otp, setOtp] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otpSending, setOtpSending] = useState(false);
    const [otpSecondsRemaining, setOtpSecondsRemaining] = useState(0);
    const [otpEmailHint, setOtpEmailHint] = useState("");
    const [paymentSettings, setPaymentSettings] = useState<GCashPaymentSettings | null>(null);
    const [paymentSettingsLoading, setPaymentSettingsLoading] = useState(false);
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

    async function loadSubscription(silent = false) {
        if (!silent) {
            setLoading(true);
            setError("");
        }

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
            if (!silent) {
                setError(err instanceof Error ? err.message : "Unable to load subscription.");
            } else {
                console.warn("Subscription background refresh failed:", err);
            }
        } finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => {
        if (userLoading || !user) return;

        if (token) {
            loadSubscription();
        }
    }, [userLoading, user, token]);

    // Keep displayed subscription and legacy store-plan sync up to date when
    // the admin approves a payment or the expiration date changes in MySQL.
    // Silent checks preserve the current dialog and never flash a loading page.
    useEffect(() => {
        if (userLoading || !user || !token) return;
        const refreshIfVisible = () => {
            if (document.visibilityState === "visible") void loadSubscription(true);
        };
        const interval = window.setInterval(refreshIfVisible, 30_000);
        window.addEventListener("focus", refreshIfVisible);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener("focus", refreshIfVisible);
        };
    }, [userLoading, user, token]);

    useEffect(() => {
        if (!otpSent || otpSecondsRemaining <= 0) return;

        const interval = window.setInterval(() => {
            setOtpSecondsRemaining((seconds) => Math.max(0, seconds - 1));
        }, 1000);

        return () => window.clearInterval(interval);
    }, [otpSent, otpSecondsRemaining]);

    function resetPaymentModal() {
        setSelectedPlan(null);
        setUpgradeStep("details");
        setReferenceNumber("");
        setReceiptFile(null);
        setOtp("");
        setOtpSent(false);
        setOtpSending(false);
        setOtpSecondsRemaining(0);
        setOtpEmailHint("");
        setPaymentSettings(null);
        setPaymentSettingsLoading(false);
        setSubmitting(false);
    }

    async function sendPaymentOtp() {
        if (!selectedPlan || otpSending) return;

        setOtpSending(true);
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
                    action: "send_payment_otp",
                    plan_id: selectedPlan.id,
                }),
            });

            // A failed API request may return JSON or a framework-generated error page.
            // Show a useful error inside this dialog instead of silently looking like a refresh.
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(
                    body?.error || body?.message ||
                    `Unable to send the verification code (HTTP ${res.status}). Please try again.`,
                );
            }
            if (!body || !Number(body.expires_in)) {
                throw new Error("The verification service returned an unexpected response. Please try again.");
            }

            setOtpSent(true);
            setUpgradeStep("otp");
            setOtp("");
            setOtpEmailHint(body.email_hint || "your registered email");
            setOtpSecondsRemaining(Number(body.expires_in) || 300);
            setMessage(body.message || "Verification code sent to your email.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to send the verification code.");
        } finally {
            setOtpSending(false);
        }
    }

    async function continueToPayment() {
        const cleanOtp = otp.replace(/\D/g, "");

        if (!/^\d{6}$/.test(cleanOtp)) {
            setError("Enter the complete 6-digit verification code.");
            return;
        }

        if (otpSecondsRemaining <= 0) {
            setError("This verification code has expired. Please resend a new code.");
            return;
        }

        setPaymentSettingsLoading(true);
        setError("");

        try {
            // Fetch the latest platform-admin GCash details only when the owner
            // reaches checkout. This keeps the initial subscription payload small
            // (especially when the QR is stored as a data URL) and ensures the
            // owner sees the admin's most recent payment destination.
            const res = await fetch("/api/subscription-client", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: "get_payment_settings" }),
            });

            const body = await res.json();
            if (!res.ok) {
                throw new Error(body.error || "Unable to load the GCash payment details.");
            }

            const settings = body.payment_settings as GCashPaymentSettings | undefined;
            if (!settings?.configured || !settings.account_name || !settings.gcash_number) {
                throw new Error(
                    "GCash payment details are not configured yet. Please contact the platform administrator.",
                );
            }

            setPaymentSettings(settings);
            setUpgradeStep("payment");
        } catch (err) {
            setPaymentSettings(null);
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load the GCash payment details.",
            );
        } finally {
            setPaymentSettingsLoading(false);
        }
    }

    async function uploadReceiptProof(file: File) {
        const formData = new FormData();
        formData.append("receipt", file);

        const res = await fetch("/api/subscription-receipt", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: formData,
        });

        const body = await res.json();
        if (!res.ok) {
            throw new Error(body.error || "Unable to upload the GCash receipt.");
        }

        return String(body.receipt_url || "");
    }

    async function submitPayment() {
        if (!selectedPlan) return;

        const cleanOtp = otp.replace(/\D/g, "");
        if (!otpSent) {
            setError("Send the verification code before submitting your payment.");
            return;
        }
        if (!/^\d{6}$/.test(cleanOtp)) {
            setError("Enter the complete 6-digit verification code.");
            return;
        }
        if (!paymentSettings?.configured) {
            setError("GCash payment details are unavailable. Reopen checkout and try again.");
            return;
        }
        if (!referenceNumber.trim()) {
            setError("Enter your GCash reference number.");
            return;
        }
        if (!receiptFile) {
            setError("Upload your GCash receipt or payment screenshot.");
            return;
        }

        setSubmitting(true);
        setError("");
        setMessage("");

        try {
            const uploadedReceiptUrl = await uploadReceiptProof(receiptFile);

            const res = await fetch("/api/subscription-client", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "submit_subscription_payment",
                    plan_id: selectedPlan.id,
                    reference_number: referenceNumber.trim(),
                    receipt_url: uploadedReceiptUrl,
                    otp: cleanOtp,
                }),
            });

            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "Unable to submit payment.");

            resetPaymentModal();
            const emailNotice = body.confirmation_email_status === "sent"
                ? " A submission acknowledgment email has been sent to your registered address."
                : " Your payment is recorded, but we could not send the acknowledgment email. Keep your GCash reference number for tracking.";
            setMessage("Your payment proof has been submitted. Please allow up to 24 hours for Platform Admin review; your plan will change only after approval." + emailNotice);
            await loadSubscription();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to submit payment.");
        } finally {
            setSubmitting(false);
        }
    }

    if (userLoading || (loading && !data)) {
        return (
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
                    <ModuleSkeleton variant="subscription" />
                </main>
            </div>
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
    const currentPlan = subscription.plan; // historical paid subscription
    const effectivePlan = subscription.effective_plan || currentPlan;
    const isExpired = subscription.status?.toUpperCase() === "EXPIRED";
    const isExpiring = subscription.status?.toUpperCase() === "EXPIRING";
    const inReviewGrace = subscription.access_status === "GRACE";
    const onStarterFallback = subscription.access_status === "STARTER_FALLBACK" &&
        (isExpired || subscription.status?.toUpperCase() === "CANCELLED");
    const canManage = data.can_manage_subscription;

    const upgradePlans = subscription.available_plans.filter(
        (plan) => getPlanDirection(plan, currentPlan) === "upgrade",
    );

    const usageItems = [
        {
            label: "Inventory",
            current: subscription.usage.inventory,
            limit: effectivePlan.max_inventory,
        },
        {
            label: "Bookings this month",
            current: subscription.usage.bookings,
            limit: effectivePlan.max_bookings,
        },
        {
            label: "Staff",
            current: subscription.usage.staff,
            limit: effectivePlan.max_staff,
        },
        {
            label: "Branches",
            current: subscription.usage.branches,
            limit: effectivePlan.max_branches,
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
                                onClick={() => void loadSubscription()}
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

                    {(isExpired || isExpiring) && Number(currentPlan.price) > 0 && (
                        <div className={`mb-5 rounded-2xl border px-5 py-4 ${isExpired ? "border-[#F0C8C8] bg-[#FFF4F4]" : "border-[#E8D8A7] bg-[#FFF9E8]"}`}>
                            <div className="flex items-start gap-3">
                                <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${isExpired ? "text-[#B53C3C]" : "text-[#A8790C]"}`} />
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold text-[#2D1B4E]">{isExpired ? `${currentPlan.name} subscription expired` : `Your ${currentPlan.name} plan is expiring soon`}</p>
                                    <p className="mt-1 text-sm leading-6 text-[#5D5168]">
                                        {isExpired
                                            ? inReviewGrace
                                                ? "Your payment is awaiting review. Paid access is temporarily available for up to 48 hours after expiration while an eligible payment is reviewed."
                                                : `Your store remains accessible with ${effectivePlan.name} plan limits. Existing inventory, bookings, sales, and customer records are preserved.`
                                            : `Your subscription expires ${subscription.days_until_expiration === 0 ? "today" : `in ${subscription.days_until_expiration ?? 7} day(s)`}. Renew now to avoid losing paid-plan access.`}
                                    </p>
                                    {subscription.expires_at && <p className="mt-1 text-xs font-semibold text-[#7A6E88]">Subscription expiration: {new Date(subscription.expires_at).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}</p>}
                                    {canManage && !subscription.pending_payment && (
                                        <button type="button" onClick={() => { setSelectedPlan(currentPlan); setUpgradeStep("details"); }}
                                                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#2D1B4E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#412563]">
                                            <RefreshCw className="h-4 w-4" /> Renew {currentPlan.name}
                                        </button>
                                    )}
                                    {subscription.pending_payment && <p className="mt-2 text-xs font-semibold text-[#8B6B1B]">Payment proof is pending review. Do not send another payment.</p>}
                                </div>
                            </div>
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
                                            {isExpired ? "Expired" : isExpiring ? "Expiring" : "Active"}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-[#8A7D92]">
                                        {formatPrice(currentPlan.price)} / month
                                    </p>
                                    {onStarterFallback && <p className="mt-2 text-xs font-semibold text-[#B53C3C]">Effective access: {effectivePlan.name}</p>}
                                    {inReviewGrace && <p className="mt-2 text-xs font-semibold text-[#8B6B1B]">Temporary payment-review access</p>}
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
                                    <h2 className={`mt-2 text-[27px] font-bold capitalize tracking-[-0.03em] ${isExpired ? "text-[#B53C3C]" : isExpiring ? "text-[#A8790C]" : "text-[#16854B]"}`}>
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
                                        <p className="mt-1 text-xs text-[#8A7D92]">Effective access: {effectivePlan.name}{inReviewGrace ? " (temporary grace period)" : ""}. Your records remain saved.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-2.5 p-5 sm:grid-cols-2">
                                {featureList(effectivePlan).map((feature) => (
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
                                    {canManage
                                        ? "Compare available tiers, renew expiring plans, or subscribe again after expiration."
                                        : "Compare available plans. Plan changes are managed by the account owner."}
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
                                const direction = getPlanDirection(plan, currentPlan);
                                const isCurrent = direction === "current";
                                const isUpgrade = direction === "upgrade";
                                const isLower = direction === "downgrade";
                                const canRenewThisPlan = isCurrent && (isExpired || isExpiring);
                                const canSelectPaidPlanAfterExpiry = isExpired && isLower && plan.price > 0;
                                const isEffectiveFreePlan = onStarterFallback && plan.id === effectivePlan.id;
                                const canChoose = canManage && !subscription.pending_payment &&
                                    (isUpgrade || canRenewThisPlan || canSelectPaidPlanAfterExpiry);
                                const downgradeIssues = isLower
                                    ? getDowngradeLimitIssues(plan, subscription.usage)
                                    : [];
                                const canFitTargetPlan = downgradeIssues.length === 0;

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
                                                {isExpired ? "Previous paid plan" : "Current plan"}
                                            </span>
                                        )}

                                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9A7A25]">
                                            {isEffectiveFreePlan ? "Current free access" : isCurrent ? (isExpired ? "Expired subscription" : isExpiring ? "Expiring soon" : "Active") : isUpgrade ? "Upgrade option" : "Lower-tier plan"}
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
                                            {isEffectiveFreePlan ? (
                                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FAF7FC] px-4 py-3 text-center text-xs font-semibold text-[#7A6E88]">Starter access is active; your saved records are preserved.</div>
                                            ) : isCurrent && !canRenewThisPlan ? (
                                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FAF7FC] px-4 py-3 text-center text-xs font-semibold text-[#7A6E88]">You are currently using this plan</div>
                                            ) : !canManage ? (
                                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FAF7FC] px-4 py-3 text-center text-xs font-semibold text-[#7A6E88]">
                                                    Managed by the account owner
                                                </div>
                                            ) : isLower && !canSelectPaidPlanAfterExpiry ? (
                                                <div
                                                    className={`rounded-xl border px-4 py-3 text-xs ${
                                                        canFitTargetPlan
                                                            ? "border-[#E8D8A7] bg-[#FFF9E8] text-[#7A5A12]"
                                                            : "border-[#F0C8C8] bg-[#FFF4F4] text-[#A43A3A]"
                                                    }`}
                                                >
                                                    <p className="text-center font-semibold">
                                                        {canFitTargetPlan
                                                            ? `Eligible for downgrade to ${plan.name} at renewal`
                                                            : `Cannot downgrade to ${plan.name} yet`}
                                                    </p>

                                                    {canFitTargetPlan ? (
                                                        <p className="mt-1 text-center text-[10px] font-medium leading-4 opacity-80">
                                                            Your current usage fits this plan. Downgrades should be scheduled for the end of the current subscription period so remaining paid access is preserved.
                                                        </p>
                                                    ) : (
                                                        <div className="mt-2 space-y-1 border-t border-[#F0C8C8] pt-2 text-[10px] font-medium">
                                                            <p>Reduce usage before moving to this plan:</p>
                                                            {downgradeIssues.map((issue) => (
                                                                <div
                                                                    key={issue.label}
                                                                    className="flex items-center justify-between gap-3"
                                                                >
                                                                    <span>{issue.label}</span>
                                                                    <span className="font-semibold">
                                                                        {issue.current.toLocaleString("en-PH")} / {formatLimit(issue.limit)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : subscription.pending_payment ? (
                                                <div className="rounded-xl border border-[#E8D8A7] bg-[#FFF9E8] px-4 py-3 text-center text-xs font-semibold text-[#8B6B1B]">
                                                    Payment awaiting review
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={!canChoose}
                                                    onClick={() => {
                                                        setSelectedPlan(plan);
                                                        setUpgradeStep("details");
                                                    }}
                                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#412563] focus:outline-none focus:ring-4 focus:ring-[#6D35D4]/15 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <CreditCard className="h-4 w-4" />
                                                    {isCurrent ? `Renew ${plan.name}` : isLower ? `Subscribe to ${plan.name}` : `Upgrade to ${plan.name}`}
                                                </button>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>

                    {canManage && upgradePlans.length === 0 && !isExpired && (
                        <div className="mt-5 rounded-xl border border-[#E7DCEB] bg-white px-5 py-4 text-sm text-[#7A6E88] shadow-[0_2px_8px_rgba(45,27,78,0.03)]">
                            You are currently on the highest available plan. Lower-tier plans remain visible for comparison and downgrade planning.
                        </div>
                    )}
                </div>
            </main>

            {selectedPlan && upgradeStep === "details" && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#1A1220]/55 px-4 py-6 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-2xl border border-[#E7DCEB] bg-white p-6 shadow-[0_18px_60px_rgba(26,18,32,0.22)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A7A25]">{selectedPlan.id === currentPlan.id ? "Subscription renewal" : "Subscription upgrade"}</p>
                                <h2 className="mt-2 text-2xl font-bold text-[#1A1220]">{selectedPlan.id === currentPlan.id ? "Renew" : "Upgrade to"} {selectedPlan.name}</h2>
                                <p className="mt-1 text-sm leading-6 text-[#7A6E88]">First verify your account by email before continuing to the GCash payment checkout.</p>
                            </div>
                            <button type="button" onClick={resetPaymentModal} className="rounded-full p-2 text-[#7A6E88] hover:bg-[#F5F0F7]" aria-label="Close subscription upgrade dialog"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-[#E7DCEB] bg-[#FBF9FD] p-4"><span className="text-xs text-[#8A7D92]">Selected plan</span><strong className="mt-1 block text-sm text-[#2D1B4E]">{selectedPlan.name}</strong></div>
                            <div className="rounded-xl border border-[#E7DCEB] bg-[#FBF9FD] p-4"><span className="text-xs text-[#8A7D92]">Amount to pay</span><strong className="mt-1 block text-sm text-[#2D1B4E]">{formatPrice(selectedPlan.price)}</strong></div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-[#E5DCF2] bg-[#FAF7FF] p-5">
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EDE3FF] text-[#6D35D4]"><ShieldCheck className="h-5 w-5" /></div>
                                <div><h3 className="text-sm font-bold text-[#2D1B4E]">Verify your account first</h3><p className="mt-1 text-xs leading-5 text-[#7A6E88]">We will send a 6-digit verification code to the email registered to your owner account.</p></div>
                            </div>
                            <button type="button" disabled={otpSending} onClick={(event) => { event.preventDefault(); void sendPaymentOtp(); }} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#412563] disabled:cursor-not-allowed disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{otpSending ? "Sending verification code..." : "Send verification code"}</button>
                            {error && (
                                <p role="alert" aria-live="assertive" className="mt-3 rounded-xl border border-[#EFBABA] bg-[#FFF3F3] px-3 py-2 text-xs font-medium leading-5 text-[#9B3030]">
                                    {error}
                                </p>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end"><button type="button" onClick={resetPaymentModal} className="rounded-xl border border-[#DCCFE8] bg-white px-5 py-2.5 text-sm font-semibold text-[#4B3E55] hover:bg-[#FAF7FC]">Cancel</button></div>
                    </div>
                </div>
            )}

            {selectedPlan && upgradeStep === "otp" && (
                <div role="dialog" aria-modal="true" aria-labelledby="upgrade-otp-title" className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#160C27]/65 px-4 py-6 backdrop-blur-md">
                    <div className="relative my-auto w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/70 bg-white px-7 pb-7 pt-8 text-center shadow-[0_28px_80px_rgba(22,12,39,0.32)] sm:px-9">
                        <button type="button" onClick={resetPaymentModal} disabled={otpSending} aria-label="Close OTP verification" className="absolute right-4 top-4 rounded-full p-2 text-[#7A6E88] transition hover:bg-[#F3EFF8] hover:text-[#2D1B4E] disabled:cursor-not-allowed disabled:opacity-50"><X className="h-5 w-5" /></button>
                        <div className="relative mx-auto flex h-[86px] w-[86px] items-center justify-center"><div className="absolute inset-0 rounded-full bg-[#EEE5FF]" /><div className="absolute inset-[11px] rounded-full bg-[#DCCBFF]" /><div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#2D1B4E] text-white shadow-lg"><Mail className="h-7 w-7" /></div><Sparkles className="absolute -right-1 top-1 h-4 w-4 text-[#C9951A]" /><Sparkles className="absolute -left-1 bottom-3 h-3.5 w-3.5 text-[#C9951A]" /></div>
                        <h2 id="upgrade-otp-title" className="mt-4 font-serif text-[32px] font-semibold leading-tight text-[#2D1B4E]">Verify your email</h2>
                        <p className="mt-2 text-sm leading-6 text-[#7A6E88]">We&apos;ve sent a 6-digit verification code to</p>
                        <p className="mt-0.5 break-all text-sm font-bold text-[#2D1B4E]">{otpEmailHint || "your registered email"}</p>
                        {message && (
                            <p role="status" className="mt-3 rounded-xl border border-[#D5E8D8] bg-[#F3FAF5] px-3 py-2 text-xs font-medium leading-5 text-[#256B42]">{message}</p>
                        )}
                        {error && (
                            <p role="alert" aria-live="assertive" className="mt-3 rounded-xl border border-[#EFBABA] bg-[#FFF3F3] px-3 py-2 text-xs font-medium leading-5 text-[#9B3030]">{error}</p>
                        )}
                        <div className="mt-6 flex justify-center gap-2 sm:gap-3">
                            {Array.from({ length: 6 }, (_, index) => (
                                <input key={index} id={`upgrade-otp-${index}`} value={otp[index] || ""} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} disabled={otpSending || otpSecondsRemaining <= 0} aria-label={`OTP digit ${index + 1}`} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(-1); const nextOtp = otp.split(""); nextOtp[index] = digit; setOtp(nextOtp.join("").slice(0, 6)); if (digit && index < 5) document.getElementById(`upgrade-otp-${index + 1}`)?.focus(); }} onKeyDown={(event) => { if (event.key === "Backspace") { if (otp[index]) { const nextOtp = otp.split(""); nextOtp[index] = ""; setOtp(nextOtp.join("")); return; } if (index > 0) { document.getElementById(`upgrade-otp-${index - 1}`)?.focus(); const nextOtp = otp.split(""); nextOtp[index - 1] = ""; setOtp(nextOtp.join("")); } } if (event.key === "ArrowLeft" && index > 0) document.getElementById(`upgrade-otp-${index - 1}`)?.focus(); if (event.key === "ArrowRight" && index < 5) document.getElementById(`upgrade-otp-${index + 1}`)?.focus(); }} onPaste={(event) => { event.preventDefault(); const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6); if (!pasted) return; setOtp(pasted); document.getElementById(`upgrade-otp-${Math.max(0, Math.min(pasted.length, 6) - 1)}`)?.focus(); }} onFocus={(event) => event.target.select()} className={["h-14 w-11 rounded-xl border bg-white text-center text-2xl font-bold text-[#2D1B4E] outline-none transition sm:w-12", "focus:border-[#6F45B8] focus:ring-4 focus:ring-[#6F45B8]/15", otp[index] ? "border-[#B99AEF] shadow-sm" : "border-[#DED3EE]", otpSecondsRemaining <= 0 ? "cursor-not-allowed bg-[#F7F4FA] text-[#A79CAF]" : ""].join(" ")} />
                            ))}
                        </div>
                        <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-[#F1E9FF] px-4 py-2 text-sm font-semibold text-[#6F45B8]"><Clock3 className="h-4 w-4" />{otpSecondsRemaining > 0 ? `Code expires in ${String(Math.floor(otpSecondsRemaining / 60)).padStart(2, "0")}:${String(otpSecondsRemaining % 60).padStart(2, "0")}` : "Code expired"}</div>
                        <button type="button" disabled={otpSending || paymentSettingsLoading || otpSecondsRemaining <= 0 || otp.length !== 6} onClick={continueToPayment} className="mt-6 w-full rounded-xl bg-[#3B1768] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(59,23,104,0.22)] transition hover:bg-[#4B2180] disabled:cursor-not-allowed disabled:opacity-50">{paymentSettingsLoading ? "Loading payment details..." : "Continue to payment"}</button>
                        <div className="mt-6 flex items-center gap-3"><div className="h-px flex-1 bg-[#EBE4F0]" /><span className="text-xs text-[#7A6E88]">Didn&apos;t receive the code?</span><div className="h-px flex-1 bg-[#EBE4F0]" /></div>
                        <button type="button" disabled={otpSending || otpSecondsRemaining > 0} onClick={sendPaymentOtp} className="mx-auto mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-[#6F35C5] transition hover:bg-[#F5EFFF] disabled:cursor-not-allowed disabled:text-[#B9AFCA] disabled:hover:bg-transparent"><RefreshCw className={otpSending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{otpSending ? "Sending..." : otpSecondsRemaining <= 0 ? "Resend OTP" : `Resend available in ${String(Math.floor(otpSecondsRemaining / 60)).padStart(2, "0")}:${String(otpSecondsRemaining % 60).padStart(2, "0")}`}</button>
                        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[#FAF8FC] px-4 py-3 text-xs text-[#7A6E88]"><ShieldCheck className="h-4 w-4 shrink-0 text-[#6F45B8]" /><span>For your security, never share this code with anyone.</span></div>
                    </div>
                </div>
            )}

            {selectedPlan && upgradeStep === "payment" && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1A1220]/60 p-3 backdrop-blur-sm sm:p-5">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="gcash-checkout-title"
                        data-checkout-layout="wide-two-column-v2"
                        className="flex max-h-[calc(100dvh-1.5rem)] max-w-[1200px] flex-col overflow-hidden rounded-2xl border border-[#E7DCEB] bg-white shadow-[0_24px_80px_rgba(26,18,32,0.28)] sm:max-h-[calc(100dvh-2.5rem)]"
                        style={{ width: "min(1200px, calc(100vw - 24px))" }}
                    >
                        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#EDE6F1] px-5 py-4 sm:px-7 sm:py-5">
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A7A25]">GCash checkout</p>
                                <h2 id="gcash-checkout-title" className="mt-1 text-xl font-bold text-[#1A1220] sm:text-2xl">Complete your {selectedPlan.name} {selectedPlan.id === currentPlan.id ? "renewal" : "plan request"}</h2>
                                <p className="mt-1 text-xs leading-5 text-[#7A6E88] sm:text-sm">Email verified. Use the GCash details and submit your payment proof for approval.</p>
                            </div>
                            <button type="button" onClick={resetPaymentModal} className="shrink-0 rounded-full p-2 text-[#7A6E88] hover:bg-[#F5F0F7]" aria-label="Close GCash checkout"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7 sm:py-5">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FBF9FD] px-4 py-3">
                                    <span className="text-xs text-[#8A7D92]">Selected plan</span>
                                    <strong className="mt-0.5 block text-base text-[#2D1B4E]">{selectedPlan.name}</strong>
                                </div>
                                <div className="rounded-xl border border-[#E7DCEB] bg-[#FBF9FD] px-4 py-3">
                                    <span className="text-xs text-[#8A7D92]">Exact amount to send</span>
                                    <strong className="mt-0.5 block text-base text-[#2D1B4E]">{formatPrice(selectedPlan.price)}</strong>
                                </div>
                            </div>

                            <div className="mt-4 grid items-start gap-4 lg:grid-cols-2 lg:gap-5">
                                <div className="min-w-0 space-y-3">
                                    <div className="rounded-2xl border border-[#DCCFE8] bg-[#FBF9FD] p-4">
                                        <div className="flex items-center gap-2">
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEE5FF] text-[#6D35D4]"><QrCode className="h-4 w-4" /></span>
                                            <div>
                                                <p className="text-sm font-bold text-[#2D1B4E]">Send payment to</p>
                                                <p className="mt-0.5 text-[11px] text-[#8A7D92]">These details are managed by the platform administrator.</p>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                                            {paymentSettings?.qr_image ? (
                                                <img
                                                    src={paymentSettings.qr_image}
                                                    alt="StockNBook GCash QR code"
                                                    className="h-[112px] w-[112px] shrink-0 rounded-xl border border-[#E6DDF0] bg-white p-2 object-contain"
                                                />
                                            ) : (
                                                <div className="flex h-[112px] w-[112px] shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-[#DCCFE8] bg-white text-center text-[#8A7D92]">
                                                    <QrCode className="h-8 w-8 text-[#6D35D4]" />
                                                    <span className="mt-2 px-2 text-[10px] leading-4">No QR uploaded. Use the GCash number.</span>
                                                </div>
                                            )}

                                            <div className="min-w-0 space-y-3">
                                                <div>
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8A7D92]">Account name</p>
                                                    <p className="mt-1 break-words text-sm font-bold text-[#1A1220]">{paymentSettings?.account_name}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8A7D92]">GCash number</p>
                                                    <p className="mt-1 break-words text-base font-bold tracking-[0.02em] text-[#2D1B4E]">{paymentSettings?.gcash_number}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[#DDEFE5] bg-[#F4FBF7] p-4">
                                        <p className="text-sm font-bold text-[#17643D]">How to pay using GCash</p>
                                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-[1.5] text-[#395C4B]">
                                            <li>Open GCash and choose <strong>Send Money</strong>. Enter the GCash number above, or scan the QR code if one is provided.</li>
                                            <li>Confirm the recipient is <strong>{paymentSettings?.account_name}</strong> and send the exact amount of <strong>{formatPrice(selectedPlan.price)}</strong>.</li>
                                            <li>After payment succeeds, save the <strong>GCash reference number</strong> and a screenshot of the successful transaction.</li>
                                            <li>Enter the reference number and upload the receipt below, then select <strong>Submit payment for review</strong>.</li>
                                            <li>After submitting, please allow <strong>up to 24 hours</strong> for the Platform Admin to review your payment proof. You'll receive an acknowledgment email and a separate email once your plan is approved. Reviews may take longer when additional verification is needed.</li>
                                        </ol>
                                        <p className="mt-2 text-[11px] leading-5 text-[#5E7569]">Your paid subscription becomes active or renews only after Platform Admin approves this payment. Your store is linked to the payment submission.</p>
                                    </div>
                                </div>

                                <div className="min-w-0 rounded-2xl border border-[#E7DCEB] bg-white p-4 sm:p-5">
                                    <h3 className="text-sm font-bold text-[#2D1B4E]">Submit your payment proof</h3>
                                    <p className="mt-1 text-xs leading-5 text-[#7A6E88]">Enter the reference number from GCash and attach the successful payment screenshot.</p>

                                    <label className="mt-4 block text-xs font-semibold text-[#4B3E55]">
                                        GCash reference number
                                        <input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} placeholder="Enter the reference number from GCash" className="mt-2 h-11 w-full rounded-xl border border-[#DCCFE8] bg-white px-3 text-sm font-medium text-[#1A1220] outline-none transition placeholder:text-[#9C91A6] focus:border-[#6D35D4] focus:ring-4 focus:ring-[#6D35D4]/10" />
                                    </label>

                                    <div className="mt-4">
                                        <p className="text-xs font-semibold text-[#4B3E55]">GCash receipt / proof</p>
                                        <input
                                            id="subscription-receipt-upload"
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp"
                                            className="hidden"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0] || null;

                                                if (!file) {
                                                    setReceiptFile(null);
                                                    return;
                                                }

                                                const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
                                                if (!allowedTypes.includes(file.type)) {
                                                    setReceiptFile(null);
                                                    event.target.value = "";
                                                    setError("Upload a PNG, JPG, JPEG, or WEBP image.");
                                                    return;
                                                }

                                                if (file.size > 5 * 1024 * 1024) {
                                                    setReceiptFile(null);
                                                    event.target.value = "";
                                                    setError("The receipt image must be 5 MB or smaller.");
                                                    return;
                                                }

                                                setError("");
                                                setReceiptFile(file);
                                            }}
                                        />

                                        {!receiptFile ? (
                                            <label
                                                htmlFor="subscription-receipt-upload"
                                                className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#DCCFE8] bg-[#FBF9FD] px-4 py-5 text-center transition hover:border-[#9F7ADE] hover:bg-[#F8F3FF]"
                                            >
                                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEE5FF] text-[#6D35D4]">
                                                <UploadCloud className="h-5 w-5" />
                                            </span>
                                                <span className="mt-2 text-sm font-bold text-[#2D1B4E]">Upload GCash receipt</span>
                                                <span className="mt-1 text-[11px] font-normal leading-5 text-[#8A7D92]">Choose a clear screenshot of the completed payment.</span>
                                                <span className="mt-2 rounded-full bg-white px-3 py-1 text-[10px] font-semibold text-[#7A6E88] shadow-sm">PNG, JPG, JPEG or WEBP · Max 5 MB</span>
                                            </label>
                                        ) : (
                                            <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[#DCCFE8] bg-[#FBF9FD] p-4">
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEE5FF] text-[#6D35D4]">
                                                <FileImage className="h-5 w-5" />
                                            </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-bold text-[#2D1B4E]">{receiptFile.name}</p>
                                                    <p className="mt-0.5 text-[11px] text-[#8A7D92]">{(receiptFile.size / 1024 / 1024).toFixed(2)} MB · Ready to upload</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setReceiptFile(null);
                                                        const input = document.getElementById("subscription-receipt-upload") as HTMLInputElement | null;
                                                        if (input) input.value = "";
                                                    }}
                                                    className="rounded-lg p-2 text-[#A14A4A] transition hover:bg-[#FDEEEE]"
                                                    aria-label="Remove selected receipt"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        )}

                                        <p className="mt-1.5 text-[11px] font-normal leading-5 text-[#8A7D92]">Your receipt uploads when you submit for review.</p>
                                    </div>
                                </div>
                            </div>

                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-[#EDE6F1] bg-white px-5 py-3 sm:px-7 sm:py-4">
                            <button type="button" onClick={resetPaymentModal} className="rounded-xl border border-[#DCCFE8] bg-white px-5 py-2.5 text-sm font-semibold text-[#4B3E55] hover:bg-[#FAF7FC]">Cancel</button>
                            <button type="button" disabled={submitting || !paymentSettings?.configured || otp.length !== 6 || !referenceNumber.trim() || !receiptFile} onClick={submitPayment} className="rounded-xl bg-[#2D1B4E] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "Submitting..." : "Submit payment for review"}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
