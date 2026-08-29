"use client";

import { useEffect, useMemo, useState } from "react";
import PlatformAdminSidebar from "../dashboard/PlatformAdminSidebar";
import { Archive, Check, Pencil, Plus, RotateCcw, Users2 } from "lucide-react";
import {
    AdminHeader,
    AdminPageShell,
    AdminSection,
    Card,
    GhostButton,
    Modal,
    PrimaryButton,
} from "../_components/AdminUI";

type Plan = {
    id: number;
    name: string;
    price: number;
    max_inventory: number | null;
    max_bookings: number | null;
    max_staff: number | null;
    max_branches: number | null;
    is_archived: boolean;
    active_subscribers: number;
    has_low_stock_alerts: boolean;
    has_analytics: boolean;
    has_forecasting: boolean;
    has_multi_store: boolean;
};

type PlanForm = Omit<Plan, "id" | "active_subscribers" | "is_archived">;

const emptyForm: PlanForm = {
    name: "",
    price: 0,
    max_inventory: null,
    max_bookings: null,
    max_staff: null,
    max_branches: 1,
    has_low_stock_alerts: false,
    has_analytics: false,
    has_forecasting: false,
    has_multi_store: false,
};

function formatPeso(amount: number) {
    return amount === 0
        ? "Free"
        : `₱${amount.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
        })}`;
}

function limitLabel(value: number | null) {
    return value == null ? "Unlimited" : value.toLocaleString("en-PH");
}

function storeLabel(value: number | null) {
    if (value == null) return "Unlimited";
    if (value === 1) return "1";
    return `Up to ${value.toLocaleString("en-PH")}`;
}

function badgeClass(name: string) {
    if (name.toLowerCase().includes("starter")) {
        return "border-[#B7E5C2] bg-[#E6F6EA] text-[#226B36]";
    }
    if (
        name.toLowerCase().includes("business") ||
        name.toLowerCase().includes("growth")
    ) {
        return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
    }
    return "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]";
}

/**
 * Multi-store is derived from the store limit rather than being an
 * independent plan setting. This prevents contradictory configurations such
 * as "Unlimited stores" + "Multi-store disabled".
 */
function deriveMultiStore(maxBranches: number | null) {
    return maxBranches == null || maxBranches > 1;
}

export default function PlansPage() {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<Plan | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<PlanForm>(emptyForm);

    const totalActiveSubscribers = useMemo(
        () =>
            plans
                .filter((p) => !p.is_archived)
                .reduce((sum, p) => sum + p.active_subscribers, 0),
        [plans]
    );

    const token = () =>
        sessionStorage.getItem("token") || localStorage.getItem("token") || "";

    async function request(
        action: string,
        body: Record<string, unknown> = {}
    ) {
        const res = await fetch("/api/subscription-admin", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token()}`,
            },
            body: JSON.stringify({ action, ...body }),
            cache: "no-store",
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    async function loadPlans() {
        setLoading(true);
        setError("");

        try {
            const data = await request("list_plans");
            setPlans(data.plans || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load plans.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadPlans();
    }, []);

    function openNew() {
        setEditing(null);
        setForm(emptyForm);
        setShowForm(true);
    }

    function openEdit(plan: Plan) {
        setEditing(plan);
        setForm({
            name: plan.name,
            price: plan.price,
            max_inventory: plan.max_inventory,
            max_bookings: plan.max_bookings,
            max_staff: plan.max_staff,
            max_branches: plan.max_branches,
            has_low_stock_alerts: plan.has_low_stock_alerts,
            has_analytics: plan.has_analytics,
            has_forecasting: plan.has_forecasting,
            // Kept in the form type for API compatibility, but the UI no
            // longer edits this independently. It is derived from stores.
            has_multi_store: deriveMultiStore(plan.max_branches),
        });
        setShowForm(true);
    }

    async function savePlan() {
        setSaving(true);
        setError("");

        try {
            const maxBranches = form.max_branches;

            await request(editing ? "update_plan" : "create_plan", {
                ...(editing ? { plan_id: editing.id } : {}),
                ...form,
                // Multi-store is intentionally derived from the store limit.
                has_multi_store: deriveMultiStore(maxBranches),
            });

            setShowForm(false);
            await loadPlans();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save plan.");
        } finally {
            setSaving(false);
        }
    }

    async function toggleArchive(plan: Plan) {
        const action = plan.is_archived ? "restore_plan" : "archive_plan";

        if (
            !window.confirm(
                `${plan.is_archived ? "Restore" : "Archive"} ${plan.name}?`
            )
        ) {
            return;
        }

        try {
            await request(action, { plan_id: plan.id });
            await loadPlans();
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : "Unable to update plan."
            );
        }
    }

    return (
        <div className="flex min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
            <PlatformAdminSidebar onOpenSettings={() => {}} />

            <AdminPageShell>
                <AdminHeader
                    title="Plans"
                    subtitle="Pricing tiers and feature limits stored in the plans table"
                    action={
                        <button
                            type="button"
                            onClick={openNew}
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
                        >
                            <Plus size={14} />
                            New plan
                        </button>
                    }
                />

                <AdminSection>
                    {error && (
                        <div className="mb-3 rounded-xl border border-[#F0B9B9] bg-[#FFF0F0] px-4 py-3 text-xs font-medium text-[#C32F2F]">
                            {error}
                        </div>
                    )}

                    <Card>
                        <div className="flex items-center gap-3">
                            <Users2
                                size={16}
                                className="shrink-0 text-[#8A7D92]"
                            />
                            <span className="shrink-0 text-[11px] font-semibold text-[#4B3E55]">
                                Subscriber mix
                            </span>

                            <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[#F3EFE3]">
                                {plans
                                    .filter(
                                        (p) =>
                                            !p.is_archived &&
                                            totalActiveSubscribers > 0
                                    )
                                    .map((p) => (
                                        <div
                                            key={p.id}
                                            style={{
                                                width: `${
                                                    (p.active_subscribers /
                                                        totalActiveSubscribers) *
                                                    100
                                                }%`,
                                            }}
                                            className="bg-[#6D35D4]"
                                            title={`${p.name}: ${p.active_subscribers}`}
                                        />
                                    ))}
                            </div>

                            <span className="shrink-0 text-[11px] text-[#8A7D92]">
                                {totalActiveSubscribers} active total
                            </span>
                        </div>
                    </Card>

                    {loading ? (
                        <Card>
                            <p className="py-8 text-center text-xs text-[#8A7D92]">
                                Loading plans...
                            </p>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                            {plans.map((plan) => (
                                <Card
                                    key={plan.id}
                                    className={plan.is_archived ? "opacity-60" : ""}
                                >
                                    <div className="flex min-h-[315px] flex-col">
                                        <div className="mb-3 flex items-start justify-between gap-2">
                                            <span
                                                className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${badgeClass(
                                                    plan.name
                                                )}`}
                                            >
                                                {plan.name}
                                            </span>

                                            {plan.is_archived && (
                                                <span className="text-[9px] uppercase tracking-wide text-[#8A7D92]">
                                                    Archived
                                                </span>
                                            )}
                                        </div>

                                        <div className="mb-5">
                                            <span className="text-[26px] font-bold leading-none tracking-[-0.03em]">
                                                {formatPeso(plan.price)}
                                            </span>
                                            {plan.price > 0 && (
                                                <span className="text-[11px] text-[#8A7D92]">
                                                    {" "}/ month
                                                </span>
                                            )}
                                        </div>

                                        <ul className="mb-5 flex-1 space-y-2 text-[11px] text-[#4B3E55]">
                                            <LimitRow
                                                label="Inventory items"
                                                value={plan.max_inventory}
                                            />
                                            <LimitRow
                                                label="Bookings"
                                                value={plan.max_bookings}
                                            />
                                            <LimitRow
                                                label="Staff accounts"
                                                value={plan.max_staff}
                                            />
                                            <StoreRow
                                                value={plan.max_branches}
                                            />
                                        </ul>

                                        <div className="space-y-1.5 border-t border-[#EEE8F2] pt-3 text-[10px] text-[#6D6072]">
                                            <Feature
                                                enabled={plan.has_low_stock_alerts}
                                                label="Low-stock alerts"
                                            />
                                            <Feature
                                                enabled={plan.has_analytics}
                                                label="Analytics"
                                            />
                                            <Feature
                                                enabled={plan.has_forecasting}
                                                label="Forecasting"
                                            />
                                            {deriveMultiStore(
                                                plan.max_branches
                                            ) && (
                                                <Feature
                                                    enabled={true}
                                                    label="Multi-store management"
                                                />
                                            )}
                                        </div>

                                        <div className="mt-4 flex items-center justify-between">
                                            <span className="text-[11px] text-[#8A7D92]">
                                                <strong className="text-[#1A1220]">
                                                    {plan.active_subscribers}
                                                </strong>{" "}
                                                subscriber
                                                {plan.active_subscribers === 1
                                                    ? ""
                                                    : "s"}
                                            </span>

                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => openEdit(plan)}
                                                    className="rounded-md p-1.5 text-[#7A6A84] hover:bg-[#FAF8FF]"
                                                    aria-label={`Edit ${plan.name}`}
                                                >
                                                    <Pencil size={14} />
                                                </button>

                                                <button
                                                    onClick={() =>
                                                        toggleArchive(plan)
                                                    }
                                                    className="rounded-md p-1.5 text-[#7A6A84] hover:bg-[#FAF8FF]"
                                                    aria-label={`${
                                                        plan.is_archived
                                                            ? "Restore"
                                                            : "Archive"
                                                    } ${plan.name}`}
                                                >
                                                    {plan.is_archived ? (
                                                        <RotateCcw size={14} />
                                                    ) : (
                                                        <Archive size={14} />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </AdminSection>
            </AdminPageShell>

            {showForm && (
                <Modal
                    title={editing ? `Edit ${editing.name}` : "New plan"}
                    subtitle="Saved directly to the plans table"
                    onClose={() => setShowForm(false)}
                    maxWidth="max-w-2xl"
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Plan name">
                            <input
                                value={form.name}
                                placeholder="e.g. Growth"
                                aria-label="Plan name"
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        name: e.target.value,
                                    })
                                }
                            />
                        </Field>

                        <Field label="Monthly price (PHP)">
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={form.price}
                                placeholder="e.g. 499"
                                aria-label="Monthly price in PHP"
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        price: Number(e.target.value),
                                    })
                                }
                            />
                        </Field>

                        <LimitField
                            label="Maximum inventory"
                            value={form.max_inventory}
                            onChange={(v) =>
                                setForm({
                                    ...form,
                                    max_inventory: v,
                                })
                            }
                        />

                        <LimitField
                            label="Maximum bookings"
                            value={form.max_bookings}
                            onChange={(v) =>
                                setForm({
                                    ...form,
                                    max_bookings: v,
                                })
                            }
                        />

                        <LimitField
                            label="Maximum staff"
                            value={form.max_staff}
                            onChange={(v) =>
                                setForm({
                                    ...form,
                                    max_staff: v,
                                })
                            }
                        />

                        <LimitField
                            label="Maximum stores"
                            value={form.max_branches}
                            onChange={(v) =>
                                setForm({
                                    ...form,
                                    max_branches: v,
                                    has_multi_store: deriveMultiStore(v),
                                })
                            }
                        />
                    </div>

                    <div className="mt-2 rounded-xl border border-[#E8E0F0] bg-[#FBF9FD] px-4 py-3 text-[11px] leading-5 text-[#6D6072]">
                        <strong className="text-[#4B3E55]">
                            Stores control multi-store access.
                        </strong>{" "}
                        Limited sets the maximum number of stores. Unlimited
                        removes the cap. Multi-store management is automatically
                        included when the plan supports more than one store.
                    </div>

                    {editing && editing.active_subscribers > 0 && (
                        <div className="mt-4 rounded-xl border border-[#F1D79B] bg-[#FFF8E8] px-4 py-3 text-xs leading-5 text-[#8C5C00]">
                            <strong>
                                {editing.name} has {editing.active_subscribers}{" "}
                                active subscriber
                                {editing.active_subscribers === 1 ? "" : "s"}.
                            </strong>{" "}
                            Changes to this plan are saved to the shared plan
                            record and will be reflected anywhere the current
                            plan configuration is read.
                        </div>
                    )}

                    <div className="mt-5">
                        <div className="mb-2 text-xs font-semibold text-[#4B3E55]">
                            Included features
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                            <CheckField
                                label="Low-stock alerts"
                                checked={form.has_low_stock_alerts}
                                onChange={(v) =>
                                    setForm({
                                        ...form,
                                        has_low_stock_alerts: v,
                                    })
                                }
                            />

                            <CheckField
                                label="Analytics"
                                checked={form.has_analytics}
                                onChange={(v) =>
                                    setForm({
                                        ...form,
                                        has_analytics: v,
                                    })
                                }
                            />

                            <CheckField
                                label="Forecasting"
                                checked={form.has_forecasting}
                                onChange={(v) =>
                                    setForm({
                                        ...form,
                                        has_forecasting: v,
                                    })
                                }
                            />

                            <DerivedFeatureField
                                label="Multi-store management"
                                included={deriveMultiStore(
                                    form.max_branches
                                )}
                            />
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-2">
                        <GhostButton onClick={() => setShowForm(false)}>
                            Cancel
                        </GhostButton>

                        <PrimaryButton onClick={savePlan} disabled={saving}>
                            {saving ? (
                                "Saving..."
                            ) : (
                                <>
                                    <Check size={13} /> Save plan
                                </>
                            )}
                        </PrimaryButton>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function LimitRow({
                      label,
                      value,
                  }: {
    label: string;
    value: number | null;
}) {
    return (
        <li className="flex items-center justify-between">
            <span>{label}</span>
            <span className="font-semibold text-[#1A1220]">
                {limitLabel(value)}
            </span>
        </li>
    );
}

function StoreRow({ value }: { value: number | null }) {
    return (
        <li className="flex items-center justify-between">
            <span>Stores</span>
            <span className="font-semibold text-[#1A1220]">
                {storeLabel(value)}
            </span>
        </li>
    );
}

function Feature({
                     enabled,
                     label,
                 }: {
    enabled: boolean;
    label: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <span
                className={`h-1.5 w-1.5 rounded-full ${
                    enabled ? "bg-[#16834A]" : "bg-[#C9C2D6]"
                }`}
            />
            {label}
            <span className="ml-auto">{enabled ? "On" : "Off"}</span>
        </div>
    );
}

function Field({
                   label,
                   children,
               }: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <label className="block text-xs font-semibold text-[#4B3E55]">
            <span className="mb-1.5 block">{label}</span>
            <div className="w-full [&>input]:h-11 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:border-[#DCCFE8] [&>input]:bg-white [&>input]:px-3 [&>input]:text-sm [&>input]:font-medium [&>input]:text-[#1A1220] [&>input]:outline-none [&>input]:transition [&>input]:placeholder:text-[#9C91A6] [&>input]:focus:border-[#6D35D4] [&>input]:focus:ring-4 [&>input]:focus:ring-[#6D35D4]/10 [&>input]:disabled:cursor-not-allowed [&>input]:disabled:bg-[#F6F2FA]">
                {children}
            </div>
        </label>
    );
}

function LimitField({
                        label,
                        value,
                        onChange,
                    }: {
    label: string;
    value: number | null;
    onChange: (v: number | null) => void;
}) {
    const unlimited = value == null;

    return (
        <Field label={label}>
            <div className="space-y-2">
                <div className="grid grid-cols-2 rounded-xl border border-[#E6DDF0] bg-[#FAF8FC] p-1">
                    <button
                        type="button"
                        onClick={() => onChange(unlimited ? 1 : value)}
                        className={`h-9 rounded-lg text-xs font-semibold transition ${
                            !unlimited
                                ? "bg-white text-[#4B3E55] shadow-sm ring-1 ring-[#DCD1E8]"
                                : "text-[#7A6A84] hover:text-[#4B3E55]"
                        }`}
                    >
                        Limited
                    </button>

                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className={`h-9 rounded-lg text-xs font-semibold transition ${
                            unlimited
                                ? "bg-[#6D35D4] text-white shadow-sm"
                                : "text-[#7A6A84] hover:text-[#4B3E55]"
                        }`}
                    >
                        Unlimited
                    </button>
                </div>

                <div
                    className={`relative rounded-xl border ${
                        unlimited
                            ? "border-[#E6DDF0] bg-[#F6F2FA]"
                            : "border-[#DCCFE8] bg-white"
                    }`}
                >
                    <input
                        disabled={unlimited}
                        type="number"
                        min="1"
                        value={unlimited ? "" : value}
                        placeholder={unlimited ? "No limit" : "Enter maximum"}
                        onChange={(e) =>
                            onChange(
                                e.target.value === ""
                                    ? 1
                                    : Math.max(1, Number(e.target.value))
                            )
                        }
                        className={`h-11 w-full rounded-xl border-0 bg-transparent px-3 text-sm font-medium outline-none placeholder:text-[#9C91A6] focus:ring-2 focus:ring-[#6D35D4]/20 disabled:cursor-not-allowed disabled:text-[#8A7D92]`}
                    />

                    {unlimited && (
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#E9DDFB] px-2 py-0.5 text-[10px] font-bold text-[#6D35D4]">
                            No limit
                        </span>
                    )}
                </div>
            </div>
        </Field>
    );
}

function CheckField({
                        label,
                        checked,
                        onChange,
                    }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#EEE8F2] bg-white px-3 py-2.5 text-xs font-medium transition hover:border-[#DCCFE8] hover:bg-[#FCFAFF]">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="h-4 w-4 accent-[#6D35D4]"
            />
            <span className="flex-1">{label}</span>
            <span
                className={`text-[10px] font-semibold ${
                    checked ? "text-[#16834A]" : "text-[#8A7D92]"
                }`}
            >
                {checked ? "Enabled" : "Disabled"}
            </span>
        </label>
    );
}

function DerivedFeatureField({
                                 label,
                                 included,
                             }: {
    label: string;
    included: boolean;
}) {
    return (
        <div className="flex items-center gap-3 rounded-xl border border-[#EEE8F2] bg-[#FBF9FD] px-3 py-2.5 text-xs font-medium">
            <span
                className={`flex h-4 w-4 items-center justify-center rounded border ${
                    included
                        ? "border-[#6D35D4] bg-[#6D35D4] text-white"
                        : "border-[#D5CDD9] bg-white text-transparent"
                }`}
                aria-hidden="true"
            >
                <Check size={11} strokeWidth={3} />
            </span>

            <span className="flex-1">{label}</span>

            <span
                className={`text-[10px] font-semibold ${
                    included ? "text-[#16834A]" : "text-[#8A7D92]"
                }`}
            >
                {included ? "Included" : "Not available"}
            </span>
        </div>
    );
}
