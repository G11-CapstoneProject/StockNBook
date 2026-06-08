"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Permissions = {
    dashboard: boolean;
    bookings: boolean;
    packages: boolean;
    packages_manage: boolean;
    inventory: boolean;
    pos: boolean;
    reports: boolean;
    staff_management: boolean;
    branch_settings: boolean;
};

type Branch = {
    id: number;
    branch_name: string;
    contact_number?: string;
    address?: string;
    manager_name?: string;
    manager_email?: string;
    manager_status?: string;
    permissions?: Partial<Permissions>;
    staff_count: number;
    revenue: number;
    bookings: number;
};

const defaultPermissions: Permissions = {
    dashboard: true,
    bookings: true,
    packages: true,
    packages_manage: false,
    inventory: true,
    pos: true,
    reports: false,
    staff_management: false,
    branch_settings: false,
};

export default function BranchesPage() {
    const router = useRouter();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);

    const [showEditModal, setShowEditModal] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [editBranchName, setEditBranchName] = useState("");
    const [editContactNumber, setEditContactNumber] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editManagerName, setEditManagerName] = useState("");
    const [editManagerEmail, setEditManagerEmail] = useState("");
    const [editPermissions, setEditPermissions] = useState<Permissions>(defaultPermissions);
    const [saving, setSaving] = useState(false);

    const loadBranches = async () => {
        const token = sessionStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/branches", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                setBranches([]);
                return;
            }
            setBranches(data.branches || []);
        } catch {
            setBranches([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadBranches();
    }, [router]);

    const openEditModal = (branch: Branch) => {
        setEditingBranch(branch);
        setEditBranchName(branch.branch_name || "");
        setEditContactNumber(branch.contact_number || "");
        setEditAddress(branch.address || "");
        setEditManagerName(branch.manager_name || "");
        setEditManagerEmail(branch.manager_email || "");
        setEditPermissions({ ...defaultPermissions, ...(branch.permissions || {}) });
        setShowEditModal(true);
    };

    const handleUpdateBranch = async () => {
        if (!editingBranch) return;
        if (!editBranchName.trim()) {
            alert("Branch name is required.");
            return;
        }
        const token = sessionStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }

        setSaving(true);
        try {
            const res = await fetch("/api/branches", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branch_id: editingBranch.id,
                    branch_name: editBranchName,
                    contact_number: editContactNumber,
                    address: editAddress,
                    manager_name: editManagerName,
                    manager_email: editManagerEmail,
                    permissions: editPermissions,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Failed to update branch.");
                return;
            }
            setShowEditModal(false);
            setEditingBranch(null);
            await loadBranches();
        } catch {
            alert("Something went wrong while updating branch.");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteBranch = async (branch: Branch) => {
        const confirmed = confirm(
            `Delete ${branch.branch_name}? This will also remove its assigned manager and staff records.`
        );
        if (!confirmed) return;

        const token = sessionStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/branches", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ branch_id: branch.id }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Failed to delete branch.");
                return;
            }
            await loadBranches();
        } catch {
            alert("Something went wrong while deleting branch.");
        }
    };

    return (
        <div
            style={{ backgroundColor: "#FDFAF4", fontFamily: "Georgia, 'Times New Roman', serif" }}
            className="flex min-h-screen text-[#1A1220]"
        >
            <RoleSidebar />

            <main className="flex-1 overflow-y-auto">
                <div className="flex h-[64px] items-center justify-between border-b border-[#EBE4F0] bg-white px-[18px]">
                    <div className="flex items-center gap-3">
                        <h1 className="text-[22px] font-medium text-[#1A1220]">Branches</h1>
                        <span className="rounded-[6px] bg-[#FFFBF0] px-3 py-1 text-[11px] font-medium text-[#633806]">All branches</span>
                    </div>
                    <div className="flex items-center gap-3">
            <span className="rounded-[7px] border border-[#EBE4F0] bg-white px-5 py-2 text-[13px] text-[#7A6E88]">
              {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
                        <button className="flex h-[40px] w-[40px] items-center justify-center rounded-[9px] border border-[#EBE4F0] bg-white text-[#C9951A]">●</button>
                        <div className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[#C9951A] text-[14px] font-medium text-white">YS</div>
                    </div>
                </div>

                <section className="px-[18px] py-[22px]">
                    <div className="mb-5 flex justify-end">
                        <button
                            onClick={() => router.push("/branches/add-branches")}
                            className="h-[44px] rounded-[10px] bg-[#2D1B4E] px-8 text-[16px] font-medium text-white transition hover:bg-[#3D2560]"
                        >
                            Add branch
                        </button>
                    </div>

                    {loading ? (
                        <div className="rounded-[14px] border border-[#EBE4F0] bg-white px-5 py-10 text-center text-[14px] text-[#7A6E88]">
                            Loading branches...
                        </div>
                    ) : branches.length === 0 ? (
                        <div className="rounded-[14px] border border-[#EBE4F0] bg-white px-5 py-10 text-center text-[14px] text-[#7A6E88]">
                            No branches added yet.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {branches.map((branch, index) => {
                                const hasManager = Boolean(branch.manager_name);
                                const headerColor =
                                    index % 3 === 0 ? "#2D1B4E" : index % 3 === 1 ? "#C9951A" : "#857792";
                                const statusLabel = hasManager
                                    ? branch.manager_status === "active"
                                        ? "Active"
                                        : "Setup pending"
                                    : "No manager";

                                return (
                                    <div key={branch.id} className="overflow-hidden rounded-[14px] border border-[#EBE4F0] bg-white">
                                        <div style={{ backgroundColor: headerColor }} className="flex min-h-[54px] items-center justify-between px-5 py-3 text-white">
                                            <div>
                                                <h2 className="text-[18px] font-medium">{branch.branch_name}</h2>
                                                <p className="mt-1 text-[12px] text-white/70">
                                                    Manager: {hasManager ? branch.manager_name : "Setup pending"}
                                                </p>
                                            </div>
                                            <span className="rounded-[7px] bg-white/15 px-3 py-1 text-[12px] font-medium text-white">{statusLabel}</span>
                                        </div>

                                        <div className="grid grid-cols-3 px-5 py-5 text-center">
                                            <div>
                                                <p className="text-[21px] font-medium text-[#1A1220]">₱{Number(branch.revenue || 0).toLocaleString()}</p>
                                                <p className="mt-1 text-[13px] text-[#7A6E88]">Revenue</p>
                                            </div>
                                            <div>
                                                <p className="text-[21px] font-medium text-[#1A1220]">{branch.bookings || 0}</p>
                                                <p className="mt-1 text-[13px] text-[#7A6E88]">Bookings</p>
                                            </div>
                                            <div>
                                                <p className="text-[21px] font-medium text-[#1A1220]">{branch.staff_count || 0}</p>
                                                <p className="mt-1 text-[13px] text-[#7A6E88]">Staff</p>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-2 border-t border-[#EBE4F0] px-5 py-3">
                                            <button onClick={() => openEditModal(branch)} className="rounded-[8px] border border-[#EBE4F0] bg-white px-4 py-2 text-[13px] font-medium text-[#2D1B4E] transition hover:bg-[#EEE8F8]">Edit</button>
                                            <button onClick={() => handleDeleteBranch(branch)} className="rounded-[8px] bg-[#993C1D] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90">Delete</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            {showEditModal && editingBranch && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] bg-white p-6 shadow-xl">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-[22px] font-medium text-[#1A1220]">Edit Branch</h2>
                                <p className="mt-1 text-[13px] text-[#7A6E88]">Update branch and assigned manager details.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleUpdateBranch}
                                    disabled={saving}
                                    className="rounded-lg bg-[#2D1B4E] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
                                >
                                    {saving ? "Saving..." : "Save"}
                                </button>

                                <button
                                    onClick={() => {
                                        setShowEditModal(false);
                                        setEditingBranch(null);
                                    }}
                                    className="rounded-full px-3 py-1 text-[18px] text-[#7A6E88] hover:bg-[#FDFAF4]"
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <TextInput label="Branch name" value={editBranchName} onChange={setEditBranchName} />
                            <TextInput label="Contact number" value={editContactNumber} onChange={setEditContactNumber} />
                            <TextInput label="Address" value={editAddress} onChange={setEditAddress} />

                            <div className="border-t border-[#EBE4F0] pt-4">
                                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#7A6E88]">Manager</p>
                                <div className="space-y-4">
                                    <TextInput label="Manager name" value={editManagerName} onChange={setEditManagerName} />
                                    <TextInput label="Manager email" value={editManagerEmail} onChange={setEditManagerEmail} />
                                </div>
                            </div>

                            <div className="mt-6 border-t border-[#EBE4F0] pt-4">
                                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#7A6E88]">Manager permissions</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <AccessToggle label="Dashboard" checked={editPermissions.dashboard} onChange={(checked) => setEditPermissions(prev => ({ ...prev, dashboard: checked }))} />
                                    <AccessToggle label="Bookings" checked={editPermissions.bookings} onChange={(checked) => setEditPermissions(prev => ({ ...prev, bookings: checked }))} />
                                    <AccessToggle label="Packages" checked={editPermissions.packages} onChange={(checked) => setEditPermissions(prev => ({ ...prev, packages: checked }))} />
                                    <AccessToggle
                                        label="Manage Packages"
                                        checked={editPermissions.packages_manage}
                                        onChange={(checked) =>
                                            setEditPermissions(prev => ({ ...prev, packages_manage: checked }))
                                        }
                                    />
                                    <AccessToggle label="Inventory" checked={editPermissions.inventory} onChange={(checked) => setEditPermissions(prev => ({ ...prev, inventory: checked }))} />
                                    <AccessToggle label="Sales / POS" checked={editPermissions.pos} onChange={(checked) => setEditPermissions(prev => ({ ...prev, pos: checked }))} />
                                    <AccessToggle label="Reports" checked={editPermissions.reports} onChange={(checked) => setEditPermissions(prev => ({ ...prev, reports: checked }))} />
                                    <AccessToggle label="Staff Management" checked={editPermissions.staff_management} onChange={(checked) => setEditPermissions(prev => ({ ...prev, staff_management: checked }))} />
                                    <AccessToggle label="Branch Settings" checked={editPermissions.branch_settings} onChange={(checked) => setEditPermissions(prev => ({ ...prev, branch_settings: checked }))} />
                                </div>
                            </div>
                        </div>

                        <div className="sticky bottom-0 mt-7 flex gap-3 border-t border-[#EBE4F0] bg-white pt-4">
                            <button
                                onClick={() => {
                                    setShowEditModal(false);
                                    setEditingBranch(null);
                                }}
                                className="w-full rounded-lg border border-[#EBE4F0] bg-white px-5 py-3 font-medium text-[#2D1B4E]"
                            >
                                Cancel
                            </button>

                            <button
                                onClick={handleUpdateBranch}
                                disabled={saving}
                                className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white disabled:opacity-60"
                            >
                                {saving ? "Saving..." : "Save changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <div>
            <label className="mb-2 block text-[13px] font-medium text-[#1A1220]">{label}</label>
            <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-[#EBE4F0] bg-[#FDFAF4] px-4 py-3 text-sm text-[#1A1220] outline-none placeholder:text-[#7A6E88] focus:border-[#2D1B4E] focus:ring-4 focus:ring-[#2D1B4E]/10" />
        </div>
    );
}

function AccessToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center justify-between rounded-[8px] bg-[#FDFAF4] px-3 py-2 text-[13px] text-[#1A1220]">
            <span>{label}</span>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#2D1B4E]" />
        </label>
    );
}
