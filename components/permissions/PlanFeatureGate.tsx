"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LockKeyhole, ArrowUpRight, RefreshCw } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export type PlanFeature = "analytics" | "forecasting";

type SubscriptionPlan = {
    name?: string | null;
    has_analytics?: boolean;
    has_forecasting?: boolean;
};

type SubscriptionResponse = {
    subscription?: {
        plan?: SubscriptionPlan;
    };
    can_manage_subscription?: boolean;
};

const FEATURE_COPY: Record<PlanFeature, {
    name: string;
    description: string;
}> = {
    analytics: {
        name: "Analytics",
        description: "business analytics, sales trends, and performance insights",
    },
    forecasting: {
        name: "Forecasting",
        description: "demand forecasts, seasonal analysis, and projected demand",
    },
};

function getToken() {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
}

function LockCard({
                      feature,
                      planName,
                      canManageSubscription,
                      onRetry,
                  }: {
    feature: PlanFeature;
    planName: string;
    canManageSubscription: boolean;
    onRetry: () => void;
}) {
    const copy = FEATURE_COPY[feature];

    return (
        <div className="flex min-h-[430px] items-center justify-center px-4 py-8 sm:px-8">
            <div className="w-full max-w-[620px] rounded-[16px] border border-[#E6DDF0]/80 bg-[#FDFAF4]/25 p-8 text-center shadow-[0_12px_40px_rgba(45,27,78,0.06)] backdrop-blur-xl sm:p-10">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1E9FA] text-[#5E32A7]">
                    <LockKeyhole size={28} strokeWidth={1.9} />
                </div>

                <div className="mt-5">
                    <span className="inline-flex items-center rounded-full border border-[#E9DDB8] bg-[#FFF7DF] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8B6B1B]">
                        {planName} plan
                    </span>

                    <h2 className="mt-4 text-[24px] font-bold tracking-[-0.02em] text-[#1A1220]">
                        {copy.name} is not included in your plan
                    </h2>

                    <p className="mx-auto mt-3 max-w-[500px] text-sm leading-6 text-[#7A6A84]">
                        Your current <span className="font-semibold text-[#4A315E]">{planName}</span> plan does not include {copy.description}.
                    </p>

                    <div className="mx-auto mt-6 max-w-[500px] rounded-xl border border-[#E9E0EF] bg-[#FDFAF4] px-5 py-4 text-left">
                        <p className="text-sm font-semibold text-[#2B174C]">Want to use {copy.name}?</p>
                        <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                            {canManageSubscription
                                ? "Upgrade your store plan to unlock this feature."
                                : "Contact your account owner to upgrade the store plan."}
                        </p>
                    </div>

                    <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
                        {canManageSubscription ? (
                            <a
                                href="/subscription"
                                className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                            >
                                View plans
                                <ArrowUpRight size={15} />
                            </a>
                        ) : null}

                        <button
                            type="button"
                            onClick={onRetry}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-5 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#FBF8FF]"
                        >
                            <RefreshCw size={15} />
                            Refresh access
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PlanFeatureGate({
                                            feature,
                                            children,
                                        }: {
    feature: PlanFeature;
    children: ReactNode;
}) {
    const { user, loading: userLoading } = useCurrentUser();
    const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadSubscription = async () => {
        const token = getToken();

        if (!token) {
            setError("Your session has expired. Please sign in again.");
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError("");

            const response = await fetch("/api/subscription-client", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
                cache: "no-store",
            });

            const data = (await response.json()) as SubscriptionResponse & {
                error?: string;
            };

            if (!response.ok) {
                throw new Error(data.error || "Unable to verify your plan access.");
            }

            setSubscription(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to verify your plan access.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadSubscription();
    }, []);

    if (userLoading || loading) {
        return (
            <div className="flex min-h-[430px] items-center justify-center px-6 py-8">
                <div className="flex items-center gap-3 rounded-[14px] border border-[#E6DDF0] bg-white px-5 py-4 text-sm font-semibold text-[#5F4E75] shadow-sm">
                    <RefreshCw size={17} className="animate-spin text-[#5E32A7]" />
                    Checking your {feature} plan access...
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-[430px] items-center justify-center px-6 py-8">
                <div className="w-full max-w-[560px] rounded-[16px] border border-[#F0D5D5] bg-white p-8 text-center shadow-sm">
                    <h2 className="text-lg font-bold text-[#1A1220]">Unable to verify plan access</h2>
                    <p className="mt-2 text-sm leading-6 text-[#7A6A84]">{error}</p>
                    <button
                        type="button"
                        onClick={() => void loadSubscription()}
                        className="mt-5 inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                    >
                        <RefreshCw size={15} />
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    const plan = subscription?.subscription?.plan;
    const planName = String(plan?.name || "Current");
    const enabled = feature === "analytics"
        ? plan?.has_analytics === true
        : plan?.has_forecasting === true;

    if (!plan) {
        return null;
    }

    if (!enabled) {
        return (
            <LockCard
                feature={feature}
                planName={planName}
                canManageSubscription={subscription?.can_manage_subscription === true && user?.role === "owner"}
                onRetry={() => void loadSubscription()}
            />
        );
    }

    return <>{children}</>;
}
