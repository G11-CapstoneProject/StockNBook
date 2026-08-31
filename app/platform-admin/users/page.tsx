"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import PlatformAdminSidebar from "../dashboard/PlatformAdminSidebar";
import { Ban, MoreVertical, RotateCcw, Users as UsersIcon } from "lucide-react";
import { AdminHeader, AdminPageShell, AdminSection, AvatarBadge, Card, SearchInput, SelectFilter, StatusPill } from "../_components/AdminUI";

type Store = {
    id: number;
    store_name: string;
    owner_name: string;
    email: string;
    status: "ACTIVE" | "PENDING" | "EXPIRED" | "SUSPENDED";
    last_active_at: string | null;
    signup_date: string | null;
    plan_name: string;
    subscription_status: string;
    expires_at: string | null;
    lifetime_paid: number;
    inventory_item_count: number;
};

const statusTone: Record<Store["status"], "green" | "purple" | "red"> = {
    ACTIVE: "green",
    PENDING: "purple",
    EXPIRED: "red",
    SUSPENDED: "red",
};

function formatDate(value: string | null) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function formatLastActive(value: string | null) {
    if (!value) return "Never";

    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "Never";

    const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

    if (diffSeconds < 60) return "Just now";

    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

    return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function formatPeso(value: number) {
    return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

export default function UsersPage() {
    const [stores, setStores] = useState<Store[]>([]);
    const [plans, setPlans] = useState<string[]>([]);
    const [query, setQuery] = useState("");
    const [planFilter, setPlanFilter] = useState("All plans");
    const [statusFilter, setStatusFilter] = useState("All statuses");
    const [openMenuId, setOpenMenuId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

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

    async function loadStores() {
        setLoading(true);
        setError("");
        try {
            const [storeData, planData] = await Promise.all([
                request("list_stores", { search: query, plan: planFilter, status: statusFilter }),
                request("list_plans"),
            ]);
            const rows = storeData.stores || [];
            setStores(rows);
            setPlans((planData.plans || []).map((p: { name: string }) => p.name));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load stores.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => { loadStores(); }, 150);
        return () => window.clearTimeout(timer);
    }, [query, planFilter, statusFilter]);

    const filtered = useMemo(() => stores, [stores]);

    async function changeStatus(store: Store) {
        const suspended = store.status === "SUSPENDED";
        const reason = window.prompt(suspended ? "Reason for reactivating this store:" : "Reason for suspending this store:");
        if (!reason?.trim()) return;
        try {
            await request(suspended ? "reactivate_store" : "suspend_store", { store_id: store.id, reason: reason.trim() });
            setOpenMenuId(null);
            await loadStores();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to change store status.");
        }
    }

    return (
        <div className="flex min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
            <PlatformAdminSidebar onOpenSettings={() => {}} />
            <AdminPageShell>
                <AdminHeader title="Users" subtitle="Every store tenant registered on the platform" />
                <AdminSection>
                    {error && <div className="mb-3 rounded-xl border border-[#F0B9B9] bg-[#FFF0F0] px-4 py-3 text-xs font-medium text-[#C32F2F]">{error}</div>}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-55 flex-1"><SearchInput value={query} onChange={setQuery} placeholder="Search by store, owner, or email..." /></div>
                        <SelectFilter value={planFilter} onChange={setPlanFilter} options={["All plans", ...plans]} />
                        <SelectFilter value={statusFilter} onChange={setStatusFilter} options={["All statuses", "Active", "Pending", "Expired", "Suspended"]} />
                        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[#8A7D92]"><UsersIcon size={13} /><span className="font-semibold text-[#1A1220]">{filtered.length}</span> stores</div>
                    </div>

                    <Card className="overflow-hidden p-0">
                        {loading ? <div className="px-6 py-12 text-center text-xs text-[#8A7D92]">Loading stores...</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs">
                            <thead><tr className="border-b border-[#EEE8F2] text-[10px] uppercase tracking-wide text-[#8A7D92]"><th className="px-5 py-3 font-semibold">Store</th><th className="px-5 py-3 font-semibold">Plan</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Signed up</th><th className="px-5 py-3 font-semibold">Last active</th><th className="px-5 py-3 font-semibold">Inventory</th><th className="px-5 py-3 font-semibold">Lifetime paid</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead>
                            <tbody>{filtered.map((u) => <tr key={u.id} className="border-b border-[#F3EFE3] last:border-0 hover:bg-[#FAF8FF]"><td className="px-5 py-4"><div className="flex items-center gap-3"><AvatarBadge initials={(u.store_name || "ST").slice(0, 2).toUpperCase()} bg="bg-[#F1EBFF]" text="text-[#6D35D4]" /><div><p className="text-[13px] font-semibold text-[#30243A]">{u.store_name}</p><p className="text-[10px] text-[#806A8C]">{u.owner_name} · {u.email}</p></div></div></td><td className="px-5 py-4"><span className="rounded-md border border-[#D8C5F3] bg-[#F1EBFF] px-2 py-0.5 text-[10px] font-bold text-[#6D35D4]">{u.plan_name}</span></td><td className="px-5 py-4"><StatusPill label={u.status} tone={statusTone[u.status]} /></td><td className="px-5 py-4 text-[#4B3E55]">{formatDate(u.signup_date)}</td><td className="px-5 py-4 text-[#4B3E55]">{formatLastActive(u.last_active_at)}</td><td className="px-5 py-4 text-[#4B3E55]">{u.inventory_item_count.toLocaleString("en-PH")} items</td><td className="px-5 py-4 font-semibold text-[#1A1220]">{formatPeso(u.lifetime_paid)}</td><td className="relative px-5 py-4 text-right"><button onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)} className="rounded-md p-1.5 hover:bg-[#F3EEFF]" aria-label={`Actions for ${u.store_name}`}><MoreVertical className="h-4 w-4 text-[#8A7D92]" /></button>{openMenuId === u.id && <div className="absolute right-5 top-11 z-10 w-52 rounded-xl border border-[#E6DDF0] bg-white py-1 text-left shadow-2xl"><MenuAction icon={u.status === "SUSPENDED" ? <RotateCcw size={14} /> : <Ban size={14} />} label={u.status === "SUSPENDED" ? "Reactivate store" : "Suspend store"} danger={u.status !== "SUSPENDED"} onClick={() => changeStatus(u)} /></div>}</td></tr>)}</tbody>
                        </table></div>}
                        {!loading && filtered.length === 0 && <div className="px-6 py-12 text-center text-xs text-[#B0A2BE]">No stores match these filters.</div>}
                    </Card>
                </AdminSection>
            </AdminPageShell>
        </div>
    );
}

function MenuAction({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick: () => void }) {
    return <button onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-[#F3EFE3] ${danger ? "text-[#C32F2F]" : "text-[#1A1220]"}`}>{icon}{label}</button>;
}
