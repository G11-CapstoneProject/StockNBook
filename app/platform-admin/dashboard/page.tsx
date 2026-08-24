"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PlatformAdminSidebar from "./PlatformAdminSidebar";
import {
    Activity,
    CheckCircle2,
    Clock3,
    DollarSign,
    Eye,
    FileImage,
    Package,
    Pencil,
    PieChart,
    QrCode,
    RefreshCw,
    Sparkles,
    TrendingUp,
    Users,
    X,
} from "lucide-react";

type Plan = "Starter" | "Business" | "Enterprise" | string;
type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED";

type GCashPaymentSettings = {
    accountName: string;
    gcashNumber: string;
    instruction: string;
    qrImage: string;
};

const PAYMENT_SETTINGS_STORAGE_KEY = "stocknbook_platform_gcash_settings";

const defaultGcashPaymentSettings: GCashPaymentSettings = {
    accountName: "StockNBook Admin",
    gcashNumber: "0917 123 4567",
    instruction: "Include your store name",
    qrImage: "/gcash-qr.png",
};

type PaymentRequest = {
    id: string;
    storeName: string;
    ownerName: string;
    ownerEmail: string;
    requestedPlan: Plan;
    amount: number;
    referenceNumber: string;
    paymentDate: string;
    submittedAt: string;
    status: PaymentStatus;
    proofFileName: string;
};

type ExpiringSubscription = {
    storeName: string;
    ownerEmail: string;
    plan: Plan;
    expirationDate: string;
    daysLeft: number;
    initials: string;
};

type ActivityTone = "purple" | "green" | "gold" | "red";

type ActivityItem = {
    id: string;
    title: string;
    detail: string;
    time: string;
    tone: ActivityTone;
    icon: ReactNode;
};

const ACTIVITY_TONE_STYLE: Record<ActivityTone, { bg: string; text: string }> = {
    purple: { bg: "bg-[#F1EBFF]", text: "text-[#6D35D4]" },
    green: { bg: "bg-[#E6F7EE]", text: "text-[#16834A]" },
    gold: { bg: "bg-[#FFF8E8]", text: "text-[#A56607]" },
    red: { bg: "bg-[#FFF0F0]", text: "text-[#C32F2F]" }
};

function PlanBadge({ plan }: { plan: Plan }) {
    const badgeStyle =
        plan === "Starter"
            ? "border-[#B7E5C2] bg-[#E6F6EA] text-[#226B36]"
            : plan === "Business"
                ? "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
                : "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]";

    return (
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${badgeStyle}`}>
            {plan}
        </span>
    );
}

function TopKpiCard({
                        title,
                        value,
                        trend,
                        icon,
                        iconClass,
                    }: {
    title: string;
    value: string | number;
    trend?: string;
    icon: ReactNode;
    iconClass: string;
}) {
    return (
        <article className="flex min-h-[128px] items-center gap-5 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-5 shadow-sm">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-5 text-[#4B3E55]">{title}</p>
                <p className="mt-2 truncate text-[26px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">{value}</p>
                {trend && (
                    <div className="mt-2 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#E6F7EE] px-2 py-0.5 text-[11px] font-bold text-[#16834A]">
                            <TrendingUp size={12} /> {trend}
                        </span>
                        <span className="text-[11px] text-[#8A7D92]">vs last period</span>
                    </div>
                )}
            </div>
        </article>
    );
}

export default function PlatformAdminDashboardPage() {
    const router = useRouter();
    const [authChecked, setAuthChecked] = useState(false);

    // Dynamic Backend Data States
    const [stats, setStats] = useState({ pending: 0, active: 0, expired: 0, approved: 0 });
    const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
    const [expiringSubscriptions, setExpiringSubscriptions] = useState<ExpiringSubscription[]>([]);
    const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
    const [planDistribution, setPlanDistribution] = useState<any[]>([]);

    const [gcashSettings, setGcashSettings] = useState<GCashPaymentSettings>(defaultGcashPaymentSettings);
    const [gcashSettingsForm, setGcashSettingsForm] = useState<GCashPaymentSettings>(defaultGcashPaymentSettings);
    const [isGcashSettingsOpen, setIsGcashSettingsOpen] = useState(false);

    // Provide your actual API Route here
    const API_ENDPOINT = "/api/subscription-admin";

    useEffect(() => {
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        const role = sessionStorage.getItem("role") || localStorage.getItem("role");

        if (!token || role !== "PLATFORM_ADMIN") {
            router.replace("/");
            return;
        }

        // 1. Verify Auth Token
        fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: "get_current_user" }),
        })
            .then(async (response) => {
                if (!response.ok) throw new Error("Session invalid");
                const data = await response.json();
                if (data.role !== "PLATFORM_ADMIN") throw new Error("Not an admin session");
                setAuthChecked(true);

                // 2. Load Real Backend Dashboard Data
                loadDashboardData(token);
            })
            .catch(() => {
                sessionStorage.clear();
                localStorage.clear();
                router.replace("/");
            });
    }, [router]);

    const loadDashboardData = async (token: string) => {
        try {
            const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

            // Fetch KPI Summary
            const summaryRes = await fetch(API_ENDPOINT, {
                method: "POST", headers, body: JSON.stringify({ action: "get_subscription_summary" })
            });
            const summaryData = await summaryRes.json();
            if (summaryData.summary) {
                setStats({
                    pending: summaryData.summary.pending_verification,
                    active: summaryData.summary.active_subscriptions,
                    expired: summaryData.summary.expired_subscriptions,
                    approved: summaryData.summary.approved_payments
                });
            }

            // Fetch Pending Payments
            const paymentsRes = await fetch(API_ENDPOINT, {
                method: "POST", headers, body: JSON.stringify({ action: "list_payment_submissions", status: "PENDING" })
            });
            const paymentsData = await paymentsRes.json();
            if (paymentsData.payments) {
                setPaymentRequests(paymentsData.payments.map((p: any) => ({
                    id: p.payment_submission_id,
                    storeName: p.store_name_snapshot,
                    ownerName: p.owner_name_snapshot,
                    ownerEmail: p.owner_name_snapshot || "Owner",
                    requestedPlan: p.requested_plan_name_snapshot,
                    amount: Number(p.amount_submitted),
                    referenceNumber: p.reference_number,
                    paymentDate: p.payment_date,
                    submittedAt: p.submitted_at,
                    status: p.status,
                    proofFileName: "Receipt File"
                })));
            }

            // Fetch Subscriptions / Businesses to determine expiring & distribution
            const bizRes = await fetch(API_ENDPOINT, {
                method: "POST", headers, body: JSON.stringify({ action: "list_businesses" })
            });
            const bizData = await bizRes.json();
            if (bizData.businesses) {
                // Renewal Watch
                const expiring = bizData.businesses
                    .filter((b: any) => b.subscription_status === 'ACTIVE' && b.expiration_date)
                    .map((b: any) => {
                        const daysLeft = Math.ceil((new Date(b.expiration_date).getTime() - Date.now()) / (1000 * 3600 * 24));
                        return { ...b, daysLeft };
                    })
                    .filter((b: any) => b.daysLeft <= 7 && b.daysLeft >= 0)
                    .map((b: any) => ({
                        storeName: b.store_name_snapshot,
                        ownerEmail: b.owner_name_snapshot || "Owner",
                        plan: b.plan_name,
                        expirationDate: new Date(b.expiration_date).toLocaleDateString(),
                        daysLeft: b.daysLeft,
                        initials: (b.store_name_snapshot || "ST").substring(0, 2).toUpperCase()
                    }));
                setExpiringSubscriptions(expiring);

                // Plan Distribution Calculator
                const distMap: Record<string, number> = {};
                bizData.businesses.forEach((b: any) => {
                    if (b.subscription_status === 'ACTIVE' && b.plan_name) {
                        distMap[b.plan_name] = (distMap[b.plan_name] || 0) + 1;
                    }
                });
                const planColors: Record<string, {bar: string, track: string}> = {
                    "Starter": { bar: "#16834A", track: "#E6F7EE" },
                    "Business": { bar: "#A56607", track: "#FFF8E8" },
                    "Enterprise": { bar: "#6D35D4", track: "#F1EBFF" }
                };

                setPlanDistribution(Object.entries(distMap).map(([plan, count]) => ({
                    plan, count,
                    barColor: planColors[plan]?.bar || "#2B174C",
                    trackColor: planColors[plan]?.track || "#E9E0EF"
                })));
            }

            // Fetch Audit Logs for Recent Activity
            const auditRes = await fetch(API_ENDPOINT, {
                method: "POST", headers, body: JSON.stringify({ action: "list_audit_logs" })
            });
            const auditData = await auditRes.json();
            if (auditData.audit_logs) {
                setRecentActivity(auditData.audit_logs.map((log: any) => ({
                    id: log.audit_log_id,
                    title: log.action.replace(/_/g, ' '),
                    detail: log.reason || "Action performed by admin",
                    time: new Date(log.created_at).toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', month: 'short', day: 'numeric' }),
                    tone: log.action.includes('APPROVED') ? 'green' : (log.action.includes('REJECTED') ? 'red' : 'purple'),
                    icon: <Activity size={15} />
                })));
            }
        } catch (error) {
            console.error("Dashboard fetch error:", error);
        }
    };

    useEffect(() => {
        try {
            const savedSettings = window.localStorage.getItem(PAYMENT_SETTINGS_STORAGE_KEY);
            if (!savedSettings) return;
            const parsedSettings = JSON.parse(savedSettings) as Partial<GCashPaymentSettings>;
            const resolvedSettings = { ...defaultGcashPaymentSettings, ...parsedSettings };
            setGcashSettings(resolvedSettings);
            setGcashSettingsForm(resolvedSettings);
        } catch {}
    }, []);

    function openGcashSettings() {
        setGcashSettingsForm(gcashSettings);
        setIsGcashSettingsOpen(true);
    }

    function closeGcashSettings() {
        setGcashSettingsForm(gcashSettings);
        setIsGcashSettingsOpen(false);
    }

    function handleGcashQrUpload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file || !file.type.startsWith("image/")) return;

        const fileReader = new FileReader();
        fileReader.onload = () => {
            const uploadedImage = String(fileReader.result || "");
            if (!uploadedImage) return;
            setGcashSettingsForm((current) => ({ ...current, qrImage: uploadedImage }));
        };
        fileReader.readAsDataURL(file);
    }

    function saveGcashSettings() {
        const savedSettings: GCashPaymentSettings = {
            accountName: gcashSettingsForm.accountName.trim() || defaultGcashPaymentSettings.accountName,
            gcashNumber: gcashSettingsForm.gcashNumber.trim() || defaultGcashPaymentSettings.gcashNumber,
            instruction: gcashSettingsForm.instruction.trim() || defaultGcashPaymentSettings.instruction,
            qrImage: gcashSettingsForm.qrImage || defaultGcashPaymentSettings.qrImage,
        };
        setGcashSettings(savedSettings);
        setGcashSettingsForm(savedSettings);
        try { window.localStorage.setItem(PAYMENT_SETTINGS_STORAGE_KEY, JSON.stringify(savedSettings)); } catch {}
        setIsGcashSettingsOpen(false);
    }

    if (!authChecked) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#FFFDF8] font-sans text-sm text-[#7A6A84]">
                Checking admin session…
            </div>
        );
    }

    const totalPlanCount = planDistribution.reduce((acc, curr) => acc + curr.count, 0);

    return (
        <div className="flex min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
            <PlatformAdminSidebar onOpenSettings={openGcashSettings} />

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                    <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <div className="min-w-0">
                            <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                Admin Dashboard
                            </h1>
                            <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                                Overview of your SaaS platform
                            </p>
                        </div>
                    </div>
                </header>

                <section className="flex-1 overflow-y-auto px-6 py-5 font-sans">
                    <div className="mx-auto max-w-none space-y-3.5">

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <TopKpiCard
                                title="Active Subscriptions"
                                value={stats.active}
                                icon={<Package size={22} />}
                                iconClass="bg-[#E6F7EE] text-[#16834A]"
                            />
                            <TopKpiCard
                                title="Approved Payments"
                                value={stats.approved}
                                icon={<CheckCircle2 size={22} />}
                                iconClass="bg-[#FFF8E8] text-[#A56607]"
                            />
                            <TopKpiCard
                                title="Expired Subscriptions"
                                value={stats.expired}
                                icon={<RefreshCw size={22} />}
                                iconClass="bg-[#F1EBFF] text-[#6D35D4]"
                            />
                            <TopKpiCard
                                title="Pending Verifications"
                                value={stats.pending}
                                icon={<Clock3 size={22} />}
                                iconClass="bg-[#FFF0F0] text-[#C32F2F]"
                            />
                        </div>

                        <div className="grid gap-3.5 lg:grid-cols-2">
                            <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between gap-3 border-b border-[#EEE8F2] pb-4">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">Payment Verification</h2>
                                        <p className="mt-0.5 truncate text-[9px] leading-5 text-[#8A7D92]">Verify GCash proof for new plan approvals</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => router.push('/platform-admin/payments')}
                                        className="shrink-0 rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4] transition hover:bg-[#F3EEFF]"
                                    >
                                        View all
                                    </button>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {paymentRequests.length === 0 && <p className="text-xs text-center text-[#8A7D92] py-4">No pending payments.</p>}
                                    {paymentRequests.slice(0, 4).map((item) => (
                                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] p-3 transition hover:bg-[#FAF8FF]">
                                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F1EBFF] text-xs font-bold text-[#6D35D4]">
                                                {(item.storeName || "ST").substring(0, 2).toUpperCase()}
                                            </span>
                                                <div className="min-w-0">
                                                    <p className="truncate text-[13px] font-semibold leading-5 text-[#30243A]">{item.storeName}</p>
                                                    <p className="truncate text-[10px] font-medium text-[#806A8C]">{item.ownerEmail}</p>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-3">
                                                <PlanBadge plan={item.requestedPlan} />
                                                <button
                                                    type="button"
                                                    onClick={() => router.push('/platform-admin/payments')}
                                                    className="inline-flex items-center gap-1 rounded-xl bg-[#2B174C] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                                >
                                                    <Eye size={13} /> Review
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between gap-3 border-b border-[#EEE8F2] pb-4">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">Renewal Watch</h2>
                                        <p className="mt-0.5 truncate text-[9px] leading-5 text-[#8A7D92]">Stores expiring within the next 7 days</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => router.push('/platform-admin/subscriptions')}
                                        className="shrink-0 rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4] transition hover:bg-[#F3EEFF]"
                                    >
                                        View all
                                    </button>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {expiringSubscriptions.length === 0 && <p className="text-xs text-center text-[#8A7D92] py-4">No subscriptions expiring soon.</p>}
                                    {expiringSubscriptions.map((sub, i) => (
                                        <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] p-3 transition hover:bg-[#FAF8FF]">
                                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF8E8] text-xs font-bold text-[#A56607]">
                                                {sub.initials}
                                            </span>
                                                <div className="min-w-0">
                                                    <p className="truncate text-[13px] font-semibold leading-5 text-[#30243A]">{sub.storeName}</p>
                                                    <p className="truncate text-[10px] font-medium text-[#806A8C]">Expires {sub.expirationDate}</p>
                                                </div>
                                            </div>
                                            <span className="shrink-0 rounded-full bg-[#FFF0F0] px-2.5 py-1 text-[10px] font-bold text-[#C32F2F]">
                                            {sub.daysLeft}d left
                                        </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-3.5 lg:grid-cols-2">
                            <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between gap-3 border-b border-[#EEE8F2] pb-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                                            <PieChart size={18} />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">Plan Distribution</h2>
                                            <p className="mt-0.5 truncate text-[9px] leading-5 text-[#8A7D92]">Breakdown of active plans</p>
                                        </div>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-[#FAF8FF] px-3 py-1 text-[10px] font-bold text-[#6D35D4]">
                                        {totalPlanCount} total
                                    </span>
                                </div>

                                <div className="mt-5 space-y-4">
                                    {planDistribution.map((row) => {
                                        const percent = totalPlanCount > 0 ? Math.round((row.count / totalPlanCount) * 100) : 0;
                                        return (
                                            <div key={row.plan}>
                                                <div className="flex items-center justify-between text-[12px]">
                                                    <span className="font-semibold text-[#30243A]">{row.plan}</span>
                                                    <span className="font-bold text-[#1A1220]">
                                                        {row.count} <span className="font-medium text-[#8A7D92]">({percent}%)</span>
                                                    </span>
                                                </div>
                                                <div
                                                    className="mt-1.5 h-2.5 w-full rounded-full"
                                                    style={{ backgroundColor: row.trackColor }}
                                                >
                                                    <div
                                                        className="h-2.5 rounded-full transition-all"
                                                        style={{ width: `${percent}%`, backgroundColor: row.barColor }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between gap-3 border-b border-[#EEE8F2] pb-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E6F7EE] text-[#16834A]">
                                            <Activity size={18} />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">Recent Activity</h2>
                                            <p className="mt-0.5 truncate text-[9px] leading-5 text-[#8A7D92]">Latest actions across the platform</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {recentActivity.slice(0, 5).map((item, index) => (
                                        <div key={item.id} className="relative flex gap-3">
                                            <div className="flex flex-col items-center">
                                                <span
                                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ACTIVITY_TONE_STYLE[item.tone].bg} ${ACTIVITY_TONE_STYLE[item.tone].text}`}
                                                >
                                                    {item.icon}
                                                </span>
                                                {index < Math.min(recentActivity.length, 5) - 1 && (
                                                    <span className="mt-1 w-px flex-1 bg-[#EEE8F2]" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1 pb-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="truncate text-[13px] font-semibold leading-5 text-[#30243A]">{item.title}</p>
                                                    <span className="shrink-0 whitespace-nowrap text-[10px] font-medium text-[#8A7D92]">{item.time}</span>
                                                </div>
                                                <p className="truncate text-[11px] text-[#8A7D92]">{item.detail}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between border-b border-[#EEE8F2] pb-4">
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                                    <QrCode size={22} />
                                </span>
                                    <div className="min-w-0">
                                        <h3 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">GCash Platform Payment Settings</h3>
                                        <p className="mt-0.5 truncate text-[9px] leading-5 text-[#8A7D92]">Manage payment QR and instructions shown to store owners</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={openGcashSettings}
                                    className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                >
                                    <Pencil size={14} /> Edit GCash Settings
                                </button>
                            </div>

                            <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
                                <img
                                    src={gcashSettings.qrImage}
                                    alt="GCash QR Code"
                                    className="h-28 w-28 rounded-xl border border-[#E6DDF0] bg-[#FAF8FF] p-2 object-contain"
                                />
                                <div className="space-y-2 text-xs">
                                    <p><span className="font-semibold text-[#8A7D92]">Account Name:</span> <strong className="text-[#1A1220]">{gcashSettings.accountName}</strong></p>
                                    <p><span className="font-semibold text-[#8A7D92]">GCash Number:</span> <strong className="text-[#1A1220]">{gcashSettings.gcashNumber}</strong></p>
                                    <p><span className="font-semibold text-[#8A7D92]">Instructions:</span> <strong className="text-[#1A1220]">{gcashSettings.instruction}</strong></p>
                                </div>
                            </div>
                        </div>

                    </div>
                </section>
            </div>

            {isGcashSettingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-[18px] border border-[#E6DDF0] bg-white p-6 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-[#EEE8F2] pb-4">
                            <h3 className="text-lg font-bold text-[#1A1220]">Edit GCash Details</h3>
                            <button type="button" onClick={closeGcashSettings} className="text-[#806A8C] hover:text-[#1A1220]">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="mt-4 space-y-4 text-xs">
                            <div className="flex items-center gap-4">
                                <img src={gcashSettingsForm.qrImage} alt="Preview" className="h-20 w-20 rounded-lg border border-[#E6DDF0] p-1 object-contain" />
                                <label className="cursor-pointer rounded-xl border border-[#E6DDF0] bg-[#FAF8FF] px-3.5 py-2 text-xs font-semibold text-[#6D35D4] transition hover:bg-[#F1EBFF]">
                                    Upload New QR
                                    <input type="file" accept="image/*" onChange={handleGcashQrUpload} className="hidden" />
                                </label>
                            </div>

                            <label className="block space-y-1">
                                <span className="font-semibold text-[#1A1220]">Account Name</span>
                                <input
                                    value={gcashSettingsForm.accountName}
                                    onChange={(e) => setGcashSettingsForm((c) => ({ ...c, accountName: e.target.value }))}
                                    className="w-full rounded-xl border border-[#E6DDF0] p-2.5 outline-none transition focus:border-[#2B174C]"
                                />
                            </label>

                            <label className="block space-y-1">
                                <span className="font-semibold text-[#1A1220]">GCash Number</span>
                                <input
                                    value={gcashSettingsForm.gcashNumber}
                                    onChange={(e) => setGcashSettingsForm((c) => ({ ...c, gcashNumber: e.target.value }))}
                                    className="w-full rounded-xl border border-[#E6DDF0] p-2.5 outline-none transition focus:border-[#2B174C]"
                                />
                            </label>

                            <label className="block space-y-1">
                                <span className="font-semibold text-[#1A1220]">Instruction</span>
                                <input
                                    value={gcashSettingsForm.instruction}
                                    onChange={(e) => setGcashSettingsForm((c) => ({ ...c, instruction: e.target.value }))}
                                    className="w-full rounded-xl border border-[#E6DDF0] p-2.5 outline-none transition focus:border-[#2B174C]"
                                />
                            </label>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button type="button" onClick={closeGcashSettings} className="rounded-xl border border-[#E6DDF0] px-4 py-2 text-xs font-semibold text-[#7A6A84] hover:bg-[#FAF8FF]">
                                Cancel
                            </button>
                            <button type="button" onClick={saveGcashSettings} className="rounded-xl bg-[#2B174C] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1B0D31]">
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}