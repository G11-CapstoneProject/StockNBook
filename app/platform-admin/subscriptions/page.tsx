"use client";

import { useEffect, useMemo, useState } from "react";
import PlatformAdminSidebar from "../dashboard/PlatformAdminSidebar";
import { CalendarClock, History, ToggleLeft, ToggleRight } from "lucide-react";
import { AdminHeader, AdminPageShell, AdminSection, Card, GhostButton, Modal, PlanBadge, PrimaryButton, SearchInput, SelectFilter, StatusPill } from "../_components/AdminUI";

type SubStatus = "ACTIVE" | "EXPIRING" | "EXPIRED" | "CANCELLED";

type Subscription = {
    subscription_id: number;
    store_id: number;
    store_name: string;
    owner_name: string;
    owner_email: string;
    plan_id: number;
    plan_name: string;
    plan_price: number;
    status: SubStatus;
    auto_renew: boolean;
    started_at: string | null;
    expires_at: string | null;
    history_count: number;
    store_status: string;
};

type HistoryItem = {
    id: number;
    old_plan_name: string;
    new_plan_name: string;
    change_type: string;
    changed_by_name: string;
    created_at: string;
};

const statusTone: Record<SubStatus, "green" | "gold" | "red" | "neutral"> = {
    ACTIVE: "green",
    EXPIRING: "gold",
    EXPIRED: "red",
    CANCELLED: "neutral",
};

function formatDate(value: string | null) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(value: string | null) {
    if (!value) return null;
    return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

export default function SubscriptionsPage() {
    const [subs, setSubs] = useState<Subscription[]>([]);
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("All statuses");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [historyFor, setHistoryFor] = useState<Subscription | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [extensionFor, setExtensionFor] = useState<Subscription | null>(null);
    const [extensionDays, setExtensionDays] = useState(7);
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    const token = () => sessionStorage.getItem("token") || localStorage.getItem("token") || "";

    async function request(action: string, body: Record<string, unknown> = {}) {
        const res = await fetch("/api/subscription-admin", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
            body: JSON.stringify({ action, ...body }),
            cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Request failed.");
        return data;
    }

    async function loadSubscriptions() {
        setLoading(true);
        setError("");
        try {
            const data = await request("list_subscriptions", { status: statusFilter === "All statuses" ? "ALL" : statusFilter.toUpperCase(), search: query });
            setSubs(data.subscriptions || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load subscriptions.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => { loadSubscriptions(); }, 150);
        return () => window.clearTimeout(timer);
    }, [query, statusFilter]);

    async function openHistory(sub: Subscription) {
        setHistoryFor(sub);
        try {
            const data = await request("get_subscription_history", { subscription_id: sub.subscription_id });
            setHistory(data.history || []);
        } catch (e) {
            setHistory([]);
            setError(e instanceof Error ? e.message : "Unable to load history.");
        }
    }

    async function extend() {
        if (!extensionFor || !reason.trim()) return;
        setSaving(true);
        try {
            await request("extend_subscription", { subscription_id: extensionFor.subscription_id, extension_days: extensionDays, reason: reason.trim() });
            setExtensionFor(null);
            setReason("");
            await loadSubscriptions();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to extend subscription.");
        } finally {
            setSaving(false);
        }
    }

    const visible = useMemo(() => subs, [subs]);

    return (
        <div className="flex min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
            <PlatformAdminSidebar onOpenSettings={() => {}} />
            <AdminPageShell>
                <AdminHeader title="Subscriptions" subtitle="Live subscription lifecycle data from the subscriptions table" />
                <AdminSection>
                    {error && <div className="mb-3 rounded-xl border border-[#F0B9B9] bg-[#FFF0F0] px-4 py-3 text-xs font-medium text-[#C32F2F]">{error}</div>}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-55 flex-1"><SearchInput value={query} onChange={setQuery} placeholder="Search by store, owner, or email..." /></div>
                        <SelectFilter value={statusFilter} onChange={setStatusFilter} options={["All statuses", "ACTIVE", "EXPIRING", "EXPIRED", "CANCELLED"]} />
                    </div>

                    <Card className="overflow-hidden p-0">
                        {loading ? <div className="px-6 py-12 text-center text-xs text-[#8A7D92]">Loading subscriptions...</div> : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[980px] text-left text-xs">
                                    <thead><tr className="border-b border-[#EEE8F2] text-[10px] uppercase tracking-wide text-[#8A7D92]">
                                        <th className="px-5 py-3 font-semibold">Store</th><th className="px-5 py-3 font-semibold">Plan</th><th className="px-5 py-3 font-semibold">Started</th><th className="px-5 py-3 font-semibold">Expires</th><th className="px-5 py-3 font-semibold">Auto-renew</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Actions</th>
                                    </tr></thead>
                                    <tbody>
                                    {visible.map((s) => {
                                        const days = daysUntil(s.expires_at);
                                        return <tr key={s.subscription_id} className="border-b border-[#F3EFE3] last:border-0 hover:bg-[#FAF8FF]">
                                            <td className="px-5 py-4"><p className="text-[13px] font-semibold text-[#30243A]">{s.store_name}</p><p className="text-[10px] text-[#806A8C]">{s.owner_name} · {s.owner_email}</p></td>
                                            <td className="px-5 py-4"><PlanBadge plan={s.plan_name as "Starter" | "Business" | "Enterprise"} /><div className="mt-1 text-[10px] text-[#8A7D92]">₱{s.plan_price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}/month</div></td>
                                            <td className="px-5 py-4 text-[#4B3E55]">{formatDate(s.started_at)}</td>
                                            <td className="px-5 py-4"><div className="text-[#4B3E55]">{formatDate(s.expires_at)}</div>{days !== null && s.status !== "CANCELLED" && <div className={`text-[9px] font-semibold ${days <= 7 ? "text-[#C32F2F]" : "text-[#8A7D92]"}`}>{days >= 0 ? `${days}d left` : `${Math.abs(days)}d overdue`}</div>}</td>
                                            <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${s.auto_renew ? "text-[#16834A]" : "text-[#B0A2BE]"}`}>{s.auto_renew ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}{s.auto_renew ? "On" : "Off"}</span></td>
                                            <td className="px-5 py-4"><StatusPill label={s.status} tone={statusTone[s.status]} /></td>
                                            <td className="px-5 py-4 text-right"><div className="inline-flex gap-2"><button onClick={() => openHistory(s)} className="inline-flex items-center gap-1 rounded-lg border border-[#E6DDF0] px-2.5 py-1.5 text-[10px] font-semibold text-[#6D35D4]"><History size={12} /> {s.history_count} history</button>{s.status !== "CANCELLED" && <button onClick={() => { setExtensionFor(s); setExtensionDays(7); setReason(""); }} className="inline-flex items-center gap-1 rounded-lg bg-[#2B174C] px-2.5 py-1.5 text-[10px] font-semibold text-white"><CalendarClock size={12} /> Extend</button>}</div></td>
                                        </tr>;
                                    })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {!loading && visible.length === 0 && <div className="px-6 py-12 text-center text-xs text-[#B0A2BE]">No subscriptions match these filters.</div>}
                    </Card>
                </AdminSection>
            </AdminPageShell>

            {historyFor && <Modal title={historyFor.store_name} subtitle="Subscription plan history" onClose={() => setHistoryFor(null)}>
                <div className="space-y-3">{history.length === 0 ? <p className="text-xs text-[#8A7D92]">No history records yet.</p> : history.map((h) => <div key={h.id} className="flex items-start gap-3 rounded-xl border border-[#EEE8F2] p-3 text-xs"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6D35D4]" /><div className="min-w-0 flex-1"><p className="font-semibold text-[#1A1220]">{h.old_plan_name} → {h.new_plan_name}</p><p className="mt-1 text-[10px] text-[#8A7D92]">{h.change_type} · {h.changed_by_name} · {formatDate(h.created_at)}</p></div></div>)}</div>
                <div className="mt-5"><GhostButton onClick={() => setHistoryFor(null)}>Close</GhostButton></div>
            </Modal>}

            {extensionFor && <Modal title="Extend subscription" subtitle={extensionFor.store_name} onClose={() => setExtensionFor(null)}>
                <div className="space-y-4"><label className="block text-xs font-semibold text-[#4B3E55]">Extension days<input className="mt-1 w-full rounded-lg border border-[#E6DDF0] px-3 py-2 text-xs" type="number" min="1" max="365" value={extensionDays} onChange={(e) => setExtensionDays(Number(e.target.value))} /></label><label className="block text-xs font-semibold text-[#4B3E55]">Reason<textarea className="mt-1 min-h-24 w-full rounded-lg border border-[#E6DDF0] px-3 py-2 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the subscription being extended?" /></label><div className="flex justify-end gap-2"><GhostButton onClick={() => setExtensionFor(null)}>Cancel</GhostButton><PrimaryButton disabled={saving || !reason.trim()} onClick={extend}>{saving ? "Saving..." : "Confirm extension"}</PrimaryButton></div></div>
            </Modal>}
        </div>
    );
}
