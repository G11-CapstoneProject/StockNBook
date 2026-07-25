"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Building2,
    CheckCircle2,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    UserRoundCheck,
    X,
    XCircle,
} from "lucide-react";

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

    // Actual branch operating status returned by the API.
    branch_status?: string;
    status?: string;

    permissions?: Partial<Permissions>;
    staff_count: number;
    revenue: number;
    bookings: number;

    // Supported API field names for branch-level sales totals.
    total_pos_sales?: number | string;
    pos_sales?: number | string;
    pos_revenue?: number | string;
    totalPosSales?: number | string;

    total_booking_sales?: number | string;
    booking_sales?: number | string;
    booking_revenue?: number | string;
    totalBookingSales?: number | string;
};

type BranchStatus = "active" | "inactive";

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

function getBranchStatus(branch: Branch): BranchStatus {
    const branchStatus = String(
        branch.branch_status || branch.status || ""
    )
        .trim()
        .toLowerCase();

    if (branchStatus === "inactive") return "inactive";
    if (branchStatus === "active") return "active";

    // Existing branches without a saved status remain active by default.
    return "active";
}

function formatCurrency(value: number) {
    const amount = Number(value || 0);

    return `₱${(Number.isFinite(amount) ? amount : 0).toLocaleString(
        "en-PH",
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }
    )}`;
}

function getFirstValidNumber(
    ...values: Array<number | string | null | undefined>
) {
    for (const value of values) {
        if (value === null || value === undefined || value === "") continue;

        const numberValue = Number(value);

        if (Number.isFinite(numberValue)) {
            return numberValue;
        }
    }

    return 0;
}

function formatCurrentDateTime(value: Date) {
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

export default function BranchesPage() {
    const router = useRouter();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [addBranchName, setAddBranchName] = useState("");
    const [addContactNumber, setAddContactNumber] = useState("");
    const [addAddress, setAddAddress] = useState("");
    const [addBranchStatus, setAddBranchStatus] = useState<
        "active" | "inactive"
    >("active");
    const [addManagerName, setAddManagerName] = useState("");
    const [addManagerEmail, setAddManagerEmail] = useState("");
    const [addPermissions, setAddPermissions] =
        useState<Permissions>(defaultPermissions);
    const [adding, setAdding] = useState(false);

    const [showEditModal, setShowEditModal] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>();
    const [editBranchName, setEditBranchName] = useState("");
    const [editContactNumber, setEditContactNumber] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editBranchStatus, setEditBranchStatus] = useState<
        BranchStatus
    >("active");
    const [editManagerName, setEditManagerName] = useState("");
    const [editManagerEmail, setEditManagerEmail] = useState("");
    const [editPermissions, setEditPermissions] =
        useState<Permissions>(defaultPermissions);
    const [saving, setSaving] = useState(false);

    const loadBranches = useCallback(async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/branches", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });

            const data = await res.json();

            if (!res.ok) {
                setBranches([]);
                setError(data.error || "Unable to load branches.");
                return;
            }

            setBranches(Array.isArray(data.branches) ? data.branches : []);
        } catch {
            setBranches([]);
            setError("Unable to load branches. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        void loadBranches();
    }, [loadBranches]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const filteredBranches = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) return branches;

        return branches.filter((branch) => {
            const searchableValue = [
                branch.branch_name,
                branch.manager_name,
                branch.manager_email,
                branch.contact_number,
                branch.address,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return searchableValue.includes(query);
        });
    }, [branches, search]);

    const summary = useMemo(() => {
        const activeBranches = branches.filter(
            (branch) => getBranchStatus(branch) === "active"
        ).length;

        const inactiveBranches = branches.filter(
            (branch) => getBranchStatus(branch) === "inactive"
        ).length;

        const totalStaff = branches.reduce(
            (total, branch) => total + Number(branch.staff_count || 0),
            0
        );

        return {
            totalBranches: branches.length,
            activeBranches,
            inactiveBranches,
            totalStaff,
        };
    }, [branches]);

    const resetAddForm = () => {
        setAddBranchName("");
        setAddContactNumber("");
        setAddAddress("");
        setAddBranchStatus("active");
        setAddManagerName("");
        setAddManagerEmail("");
        setAddPermissions({ ...defaultPermissions });
    };

    const openAddModal = () => {
        resetAddForm();
        setShowAddModal(true);
    };

    const closeAddModal = () => {
        if (adding) return;

        setShowAddModal(false);
        resetAddForm();
    };

    const handleCreateBranch = async () => {
        if (
            !addBranchName.trim() ||
            !addContactNumber.trim() ||
            !addAddress.trim()
        ) {
            alert(
                "Please complete the branch name, contact number, and address."
            );
            return;
        }

        const hasManagerName = Boolean(addManagerName.trim());
        const hasManagerEmail = Boolean(addManagerEmail.trim());

        if (hasManagerName !== hasManagerEmail) {
            alert(
                "Please complete both the manager name and manager email, or leave both fields empty."
            );
            return;
        }

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setAdding(true);

        try {
            const response = await fetch("/api/onboarding", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branches: [
                        {
                            branch_name: addBranchName.trim(),
                            contact_number: addContactNumber.trim(),
                            address: addAddress.trim(),
                            status: addBranchStatus,
                            branch_status: addBranchStatus,
                            manager_name: addManagerName.trim(),
                            manager_email: addManagerEmail.trim(),
                            permissions: addPermissions,
                        },
                    ],
                    send_invitation_emails: hasManagerEmail,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                alert(
                    data.error ||
                    data.message ||
                    "Unable to create the branch."
                );
                return;
            }

            setShowAddModal(false);
            resetAddForm();
            await loadBranches();
        } catch {
            alert("Something went wrong while creating the branch.");
        } finally {
            setAdding(false);
        }
    };

    const openEditModal = (branch: Branch) => {
        setEditingBranch(branch);
        setEditBranchName(branch.branch_name || "");
        setEditContactNumber(branch.contact_number || "");
        setEditAddress(branch.address || "");
        setEditBranchStatus(getBranchStatus(branch));
        setEditManagerName(branch.manager_name || "");
        setEditManagerEmail(branch.manager_email || "");
        setEditPermissions({
            ...defaultPermissions,
            ...(branch.permissions || {}),
        });
        setShowEditModal(true);
    };

    const closeEditModal = () => {
        if (saving) return;

        setShowEditModal(false);
        setEditingBranch(null);
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
                    branch_name: editBranchName.trim(),
                    contact_number: editContactNumber,
                    address: editAddress,
                    status: editBranchStatus,
                    branch_status: editBranchStatus,
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
            className="flex min-h-screen font-sans text-[#1A1220]"
            style={{ backgroundColor: "#FDFAF4" }}
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-y-auto">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <h1 className="text-[27px] font-bold tracking-[-0.025em] text-[#1A1220]">
                            Branches
                        </h1>

                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime
                                    ? formatCurrentDateTime(currentDateTime)
                                    : "Loading date..."}
                            </span>

                            <button
                                type="button"
                                onClick={() => void loadBranches()}
                                disabled={loading}
                                aria-label="Refresh branches"
                                title="Refresh branches"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <RefreshCw
                                    size={16}
                                    className={loading ? "animate-spin" : ""}
                                />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <section className="space-y-3.5 px-6 py-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <SummaryCard
                            title="Total Branches"
                            value={summary.totalBranches}
                            description="All registered business locations"
                            icon={<Building2 className="h-5 w-5" />}
                            iconClassName="bg-[#F0E8FA] text-[#5B35A5]"
                        />
                        <SummaryCard
                            title="Active Branches"
                            value={summary.activeBranches}
                            description="Branches currently operating"
                            icon={<CheckCircle2 className="h-5 w-5" />}
                            iconClassName="bg-[#EAF7EF] text-[#21844A]"
                        />
                        <SummaryCard
                            title="Inactive Branches"
                            value={summary.inactiveBranches}
                            description="Branches currently inactive"
                            icon={<XCircle className="h-5 w-5" />}
                            iconClassName="bg-[#FFF0F0] text-[#C32F2F]"
                        />
                        <SummaryCard
                            title="Total Staff"
                            value={summary.totalStaff}
                            description="Staff assigned across branches"
                            icon={<UserRoundCheck className="h-5 w-5" />}
                            iconClassName="bg-[#EEF4FF] text-[#3367D6]"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative min-w-[260px] flex-1">
                            <Search
                                size={16}
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />
                            <input
                                value={search}
                                onChange={(event) =>
                                    setSearch(event.target.value)
                                }
                                placeholder="Search branch, manager, address, or contact..."
                                className="h-[48px] w-full rounded-xl border border-[#E6DDF0] bg-white px-4 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />

                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch("")}
                                    aria-label="Clear branch search"
                                    className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#806A8C] transition hover:bg-[#F1E9FF] hover:text-[#2B174C]"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={openAddModal}
                            className="inline-flex h-[48px] shrink-0 items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <Plus size={16} />
                            Add branch
                        </button>
                    </div>

                    {error && (
                        <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2.5 text-sm font-medium text-[#9B1C1C]">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-5 py-14 text-center text-sm text-[#7A6A84] shadow-sm">
                            Loading branches...
                        </div>
                    ) : branches.length === 0 ? (
                        <EmptyBranches
                            title="No branches added yet."
                            detail="Add your first branch to start assigning managers and staff."
                            actionLabel="Add branch"
                            onAction={openAddModal}
                        />
                    ) : filteredBranches.length === 0 ? (
                        <EmptyBranches
                            title="No matching branches found."
                            detail="Try another branch name, manager, address, or contact number."
                            actionLabel="Clear search"
                            onAction={() => setSearch("")}
                        />
                    ) : (
                        <section className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex items-center justify-between gap-3 border-b border-[#E6DDF0] px-4 py-3">
                                <div>
                                    <h2 className="text-[18px] font-bold tracking-[-0.015em] text-[#1A1220]">
                                        Branch Directory
                                    </h2>
                                    <p className="mt-1 text-[13px] text-[#7A6A84]">
                                        View branch performance and assigned manager details.
                                    </p>
                                </div>

                                <span className="text-xs font-medium text-[#806A8C]">
                                    {filteredBranches.length}{" "}
                                    {filteredBranches.length === 1
                                        ? "branch"
                                        : "branches"}
                                </span>
                            </div>

                            <div className="grid gap-3 p-3 xl:grid-cols-2">
                                {filteredBranches.map((branch) => (
                                    <BranchCard
                                        key={branch.id}
                                        branch={branch}
                                        onEdit={() => openEditModal(branch)}
                                        onDelete={() =>
                                            void handleDeleteBranch(branch)
                                        }
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </section>
            </main>

            {showAddModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
                    onMouseDown={closeAddModal}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="add-branch-dialog-title"
                        className="max-h-[78vh] w-full max-w-[1120px] overflow-y-auto rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-6 py-5">
                            <div>
                                <h2
                                    id="add-branch-dialog-title"
                                    className="text-[22px] font-bold tracking-[-0.02em] text-[#1A1220]"
                                >
                                    Add Branch
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-[#7A6A84]">
                                    Add a new business location and optionally
                                    invite a branch manager.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={closeAddModal}
                                disabled={adding}
                                aria-label="Close add branch form"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <X size={17} />
                            </button>
                        </div>

                        <div className="space-y-5 px-6 py-5">
                            <div className="rounded-2xl border border-[#E8DFF0] bg-[#FFFDF8] p-5">
                                <div className="mb-4 flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0E8FA] text-[#5B35A5]">
                                        <Building2 className="h-5 w-5" />
                                    </span>

                                    <div>
                                        <h3 className="font-bold text-[#1A1220]">
                                            Branch information
                                        </h3>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                            Enter the required location details.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput
                                        label="Branch name"
                                        value={addBranchName}
                                        onChange={setAddBranchName}
                                        placeholder="e.g. Main Branch"
                                    />

                                    <TextInput
                                        label="Contact number"
                                        value={addContactNumber}
                                        onChange={setAddContactNumber}
                                        placeholder="09XX XXX XXXX"
                                    />
                                </div>

                                <TextInput
                                    label="Address"
                                    value={addAddress}
                                    onChange={setAddAddress}
                                    placeholder="Complete branch address"
                                />

                                <div className="mt-1">
                                    <p className="mb-2 block text-sm font-medium text-[#1A1220]">
                                        Branch status
                                    </p>

                                    <div
                                        className="grid gap-3 sm:grid-cols-2"
                                        role="radiogroup"
                                        aria-label="Branch status"
                                    >
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={
                                                addBranchStatus === "active"
                                            }
                                            onClick={() =>
                                                setAddBranchStatus("active")
                                            }
                                            className={[
                                                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                                addBranchStatus === "active"
                                                    ? "border-[#55B978] bg-[#EDFBF1] ring-2 ring-[#55B978]/10"
                                                    : "border-[#E6DDF0] bg-white hover:border-[#9ED9B3] hover:bg-[#F7FCF8]",
                                            ].join(" ")}
                                        >
                                            <span
                                                className={[
                                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                    addBranchStatus === "active"
                                                        ? "bg-[#DDF6E6] text-[#168344]"
                                                        : "bg-[#F1F4F2] text-[#6F7D74]",
                                                ].join(" ")}
                                            >
                                                <CheckCircle2 className="h-5 w-5" />
                                            </span>

                                            <span>
                                                <span className="block text-sm font-semibold text-[#1A1220]">
                                                    Active
                                                </span>
                                                <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                    The branch is currently operating.
                                                </span>
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={
                                                addBranchStatus === "inactive"
                                            }
                                            onClick={() =>
                                                setAddBranchStatus("inactive")
                                            }
                                            className={[
                                                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                                addBranchStatus === "inactive"
                                                    ? "border-[#E08A8A] bg-[#FFF2F2] ring-2 ring-[#E08A8A]/10"
                                                    : "border-[#E6DDF0] bg-white hover:border-[#E8B4B4] hover:bg-[#FFF8F8]",
                                            ].join(" ")}
                                        >
                                            <span
                                                className={[
                                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                    addBranchStatus === "inactive"
                                                        ? "bg-[#FFE0E0] text-[#C32F2F]"
                                                        : "bg-[#F5F1F1] text-[#857777]",
                                                ].join(" ")}
                                            >
                                                <XCircle className="h-5 w-5" />
                                            </span>

                                            <span>
                                                <span className="block text-sm font-semibold text-[#1A1220]">
                                                    Inactive
                                                </span>
                                                <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                    The branch is temporarily not operating.
                                                </span>
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[#E8DFF0] bg-white p-5">
                                <div className="mb-4 flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#3367D6]">
                                        <UserRoundCheck className="h-5 w-5" />
                                    </span>

                                    <div>
                                        <h3 className="font-bold text-[#1A1220]">
                                            Branch manager
                                            <span className="ml-2 text-xs font-medium text-[#8A7A94]">
                                                Optional
                                            </span>
                                        </h3>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                            Leave both fields empty when the owner
                                            will manage this branch.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput
                                        label="Manager name"
                                        value={addManagerName}
                                        onChange={setAddManagerName}
                                        placeholder="e.g. Ana Cruz"
                                    />

                                    <TextInput
                                        label="Manager email"
                                        value={addManagerEmail}
                                        onChange={setAddManagerEmail}
                                        placeholder="manager@email.com"
                                        type="email"
                                    />
                                </div>

                                <div className="mt-5 border-t border-[#E6DDF0] pt-5">
                                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#806A8C]">
                                        Manager Permissions
                                    </p>

                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {(
                                            [
                                                ["dashboard", "Dashboard"],
                                                ["bookings", "Bookings"],
                                                ["packages", "Packages"],
                                                [
                                                    "packages_manage",
                                                    "Manage Packages",
                                                ],
                                                ["inventory", "Inventory"],
                                                ["pos", "Sales / POS"],
                                                ["reports", "Reports"],
                                                [
                                                    "staff_management",
                                                    "Staff Management",
                                                ],
                                                [
                                                    "branch_settings",
                                                    "Branch Settings",
                                                ],
                                            ] as Array<
                                                [keyof Permissions, string]
                                            >
                                        ).map(([key, label]) => (
                                            <AccessToggle
                                                key={key}
                                                label={label}
                                                checked={addPermissions[key]}
                                                onChange={(checked) =>
                                                    setAddPermissions(
                                                        (current) => ({
                                                            ...current,
                                                            [key]: checked,
                                                        })
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-[#E6D9BA] bg-[#FFFBF0] px-4 py-3 text-xs leading-5 text-[#6F6043]">
                                A manager invitation email will be sent
                                automatically when a manager name and email are
                                provided.
                            </div>
                        </div>

                        <div className="sticky bottom-0 flex gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4">
                            <button
                                type="button"
                                onClick={closeAddModal}
                                disabled={adding}
                                className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void handleCreateBranch()}
                                disabled={adding}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Plus size={16} />
                                {adding ? "Adding branch..." : "Add branch"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showEditModal && editingBranch && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-[620px] overflow-y-auto rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl">
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-6 py-5">
                            <div>
                                <h2 className="text-[20px] font-bold text-[#1A1220]">
                                    Edit Branch
                                </h2>
                                <p className="mt-1 text-sm text-[#7A6A84]">
                                    Update branch and assigned manager details.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={closeEditModal}
                                disabled={saving}
                                aria-label="Close edit branch form"
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:cursor-not-allowed"
                            >
                                <X size={17} />
                            </button>
                        </div>

                        <div className="space-y-5 px-6 py-5">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <TextInput
                                    label="Branch name"
                                    value={editBranchName}
                                    onChange={setEditBranchName}
                                />
                                <TextInput
                                    label="Contact number"
                                    value={editContactNumber}
                                    onChange={setEditContactNumber}
                                />
                            </div>

                            <TextInput
                                label="Address"
                                value={editAddress}
                                onChange={setEditAddress}
                            />

                            <div className="border-t border-[#E6DDF0] pt-5">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#806A8C]">
                                    Branch Status
                                </p>

                                <div
                                    className="grid gap-3 sm:grid-cols-2"
                                    role="radiogroup"
                                    aria-label="Edit branch status"
                                >
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={
                                            editBranchStatus === "active"
                                        }
                                        onClick={() =>
                                            setEditBranchStatus("active")
                                        }
                                        className={[
                                            "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                            editBranchStatus === "active"
                                                ? "border-[#55B978] bg-[#EDFBF1] ring-2 ring-[#55B978]/10"
                                                : "border-[#E6DDF0] bg-white hover:border-[#9ED9B3] hover:bg-[#F7FCF8]",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                editBranchStatus === "active"
                                                    ? "bg-[#DDF6E6] text-[#168344]"
                                                    : "bg-[#F1F4F2] text-[#6F7D74]",
                                            ].join(" ")}
                                        >
                                            <CheckCircle2 className="h-5 w-5" />
                                        </span>

                                        <span>
                                            <span className="block text-sm font-semibold text-[#1A1220]">
                                                Active
                                            </span>
                                            <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                The branch is currently operating.
                                            </span>
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={
                                            editBranchStatus === "inactive"
                                        }
                                        onClick={() =>
                                            setEditBranchStatus("inactive")
                                        }
                                        className={[
                                            "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                            editBranchStatus === "inactive"
                                                ? "border-[#E08A8A] bg-[#FFF2F2] ring-2 ring-[#E08A8A]/10"
                                                : "border-[#E6DDF0] bg-white hover:border-[#E8B4B4] hover:bg-[#FFF8F8]",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                editBranchStatus === "inactive"
                                                    ? "bg-[#FFE0E0] text-[#C32F2F]"
                                                    : "bg-[#F5F1F1] text-[#857777]",
                                            ].join(" ")}
                                        >
                                            <XCircle className="h-5 w-5" />
                                        </span>

                                        <span>
                                            <span className="block text-sm font-semibold text-[#1A1220]">
                                                Inactive
                                            </span>
                                            <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                The branch is temporarily not operating.
                                            </span>
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <div className="border-t border-[#E6DDF0] pt-5">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#806A8C]">
                                    Manager Details
                                </p>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput
                                        label="Manager name"
                                        value={editManagerName}
                                        onChange={setEditManagerName}
                                    />
                                    <TextInput
                                        label="Manager email"
                                        value={editManagerEmail}
                                        onChange={setEditManagerEmail}
                                    />
                                </div>
                            </div>

                            <div className="border-t border-[#E6DDF0] pt-5">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#806A8C]">
                                    Manager Permissions
                                </p>

                                <div className="grid gap-2 sm:grid-cols-2">
                                    <AccessToggle
                                        label="Dashboard"
                                        checked={editPermissions.dashboard}
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                dashboard: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Bookings"
                                        checked={editPermissions.bookings}
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                bookings: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Packages"
                                        checked={editPermissions.packages}
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                packages: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Manage Packages"
                                        checked={
                                            editPermissions.packages_manage
                                        }
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                packages_manage: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Inventory"
                                        checked={editPermissions.inventory}
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                inventory: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Sales / POS"
                                        checked={editPermissions.pos}
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                pos: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Reports"
                                        checked={editPermissions.reports}
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                reports: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Staff Management"
                                        checked={
                                            editPermissions.staff_management
                                        }
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                staff_management: checked,
                                            }))
                                        }
                                    />
                                    <AccessToggle
                                        label="Branch Settings"
                                        checked={
                                            editPermissions.branch_settings
                                        }
                                        onChange={(checked) =>
                                            setEditPermissions((prev) => ({
                                                ...prev,
                                                branch_settings: checked,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="sticky bottom-0 flex gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4">
                            <button
                                type="button"
                                onClick={closeEditModal}
                                disabled={saving}
                                className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void handleUpdateBranch()}
                                disabled={saving}
                                className="flex-1 rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
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

function SummaryCard({
                         title,
                         value,
                         description,
                         icon,
                         iconClassName,
                     }: {
    title: string;
    value: number;
    description: string;
    icon: React.ReactNode;
    iconClassName: string;
}) {
    return (
        <div className="min-h-[145px] rounded-[18px] border border-[#E6DDF0] bg-white px-4 py-4 shadow-[0_2px_6px_rgba(45,27,78,0.10)]">
            <div className="flex items-start justify-between gap-3">
                <p className="pt-1 text-[15px] font-medium text-[#1A1220]">
                    {title}
                </p>

                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
                >
                    {icon}
                </span>
            </div>

            <p className="mt-4 text-[28px] font-bold leading-none tracking-[-0.02em] text-[#1A1220]">
                {value}
            </p>

            <p className="mt-2 text-[12px] leading-5 text-[#8A7A94]">
                {description}
            </p>
        </div>
    );
}

function BranchCard({
                        branch,
                        onEdit,
                        onDelete,
                    }: {
    branch: Branch;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const status = getBranchStatus(branch);

    const totalPosSales = getFirstValidNumber(
        branch.total_pos_sales,
        branch.pos_sales,
        branch.pos_revenue,
        branch.totalPosSales
    );

    const totalBookingSales = getFirstValidNumber(
        branch.total_booking_sales,
        branch.booking_sales,
        branch.booking_revenue,
        branch.totalBookingSales
    );

    const statusStyles: Record<BranchStatus, string> = {
        active: "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]",
        inactive: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
    };

    const statusText: Record<BranchStatus, string> = {
        active: "Active",
        inactive: "Inactive",
    };

    return (
        <article className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#CDB7E1] hover:shadow-md">
            <div className="flex items-start justify-between gap-3 border-b border-[#E6DDF0] px-4 py-3.5">
                <div className="min-w-0">
                    <h3 className="truncate text-[18px] font-bold text-[#1A1220]">
                        {branch.branch_name}
                    </h3>

                    <p className="mt-1 truncate text-[13px] text-[#7A6A84]">
                        Manager: {branch.manager_name || "Not assigned"}
                    </p>
                </div>

                <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[status]}`}
                >
                    {statusText[status]}
                </span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-[#EEE7F2] px-2 py-3.5">
                <Metric
                    value={formatCurrency(totalPosSales)}
                    label="Total POS Sales"
                />
                <Metric
                    value={formatCurrency(totalBookingSales)}
                    label="Total Booking Sales"
                />
                <Metric
                    value={Number(branch.staff_count || 0)}
                    label="Total Staff"
                />
            </div>

            <div className="space-y-1.5 border-t border-[#E6DDF0] px-4 py-3">
                <p className="truncate text-[13px] text-[#7A6A84]">
                    <span className="mr-2 font-semibold text-[#281246]">
                        Address
                    </span>
                    {branch.address || "No address provided"}
                </p>

                <p className="truncate text-[13px] text-[#7A6A84]">
                    <span className="mr-2 font-semibold text-[#281246]">
                        Contact
                    </span>
                    {branch.contact_number || "No contact number"}
                </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#E6DDF0] px-4 py-3">
                <button
                    type="button"
                    onClick={onEdit}
                    className="inline-flex h-[36px] items-center gap-1.5 rounded-xl border border-[#E6DDF0] bg-white px-3 text-xs font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                >
                    <Pencil size={13} />
                    Edit
                </button>

                <button
                    type="button"
                    onClick={onDelete}
                    className="inline-flex h-[36px] items-center gap-1.5 rounded-xl bg-[#A33E20] px-3 text-xs font-semibold text-white transition hover:bg-[#883117]"
                >
                    <Trash2 size={13} />
                    Delete
                </button>
            </div>
        </article>
    );
}

function Metric({
                    value,
                    label,
                }: {
    value: string | number;
    label: string;
}) {
    return (
        <div className="min-w-0 px-2 text-center">
            <p
                className="truncate text-[17px] font-bold text-[#1A1220]"
                title={String(value)}
            >
                {value}
            </p>
            <p className="mt-1 text-[11px] font-medium leading-4 text-[#7A6A84] sm:text-xs">
                {label}
            </p>
        </div>
    );
}

function EmptyBranches({
                           title,
                           detail,
                           actionLabel,
                           onAction,
                       }: {
    title: string;
    detail: string;
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-5 py-14 text-center shadow-sm">
            <h2 className="text-[16px] font-bold text-[#1A1220]">{title}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-[#7A6A84]">
                {detail}
            </p>

            <button
                type="button"
                onClick={onAction}
                className="mt-5 inline-flex h-[42px] items-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
            >
                {actionLabel}
            </button>
        </div>
    );
}

function TextInput({
                       label,
                       value,
                       onChange,
                       placeholder = "",
                       type = "text",
                   }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <input
                type={type}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
            />
        </div>
    );
}

function AccessToggle({
                          label,
                          checked,
                          onChange,
                      }: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex items-center justify-between rounded-xl border border-[#EEE7F2] bg-[#FFFDF8] px-3 py-2.5 text-sm text-[#1A1220]">
            <span>{label}</span>

            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="h-4 w-4 accent-[#2B174C]"
            />
        </label>
    );
}