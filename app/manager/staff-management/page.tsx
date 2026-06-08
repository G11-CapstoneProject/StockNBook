"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AccessMode = "none" | "view" | "full";
type ReportsAccessMode = "none" | "view";

type StaffPermissions = {
    dashboard: boolean;

    pos: boolean;
    pos_access: AccessMode;

    bookings: boolean;
    bookings_access: AccessMode;

    inventory: boolean;
    inventory_access: AccessMode;

    packages: boolean;
    package_access: AccessMode;

    reports: boolean;
    reports_access: ReportsAccessMode;
};

type PendingInvite = {
    id: number | string;
    email: string;
    invitedAt: string;
    expiresAt: string;
    status: "Pending";
    permissions: StaffPermissions;
};

type StaffMember = {
    id: number | string;
    name: string;
    email: string;
    status: "Accepted" | "Inactive";
    permissions: StaffPermissions;
};

const defaultPermissions: StaffPermissions = {
    dashboard: true,

    pos: false,
    pos_access: "none",

    bookings: false,
    bookings_access: "none",

    inventory: false,
    inventory_access: "none",

    packages: false,
    package_access: "none",

    reports: false,
    reports_access: "none",
};

export default function ManagerStaffManagementPage() {
    const router = useRouter();

    const [managerName, setManagerName] = useState("Manager");
    const [storeName, setStoreName] = useState("StockNBook");
    const [branchName, setBranchName] = useState("Assigned branch");

    const [staffName, setStaffName] = useState("");
    const [staffEmail, setStaffEmail] = useState("");
    const [permissions, setPermissions] =
        useState<StaffPermissions>(defaultPermissions);

    const [loading, setLoading] = useState(false);
    const [pageLoading, setPageLoading] = useState(true);

    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [staffList, setStaffList] = useState<StaffMember[]>([]);

    const [inviteLink, setInviteLink] = useState("");

    const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
    const [editPermissions, setEditPermissions] =
        useState<StaffPermissions>(defaultPermissions);
    const [savingEdit, setSavingEdit] = useState(false);

    const getInitials = (name: string) => {
        return (
            name
                ?.split(" ")
                .map((word) => word[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "M"
        );
    };

    const getToken = () => sessionStorage.getItem("token") || "";

    const loadStaff = useCallback(async () => {
        const token = getToken();

        if (!token) {
            router.push("/");
            return;
        }

        try {
            setPageLoading(true);

            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_staff",
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || "Failed to load staff.");
                return;
            }

            const rawStaff = data.staff || data.staff_list || [];
            const rawPending =
                data.pending_invites ||
                data.pendingInvites ||
                data.invites ||
                [];

            setStaffList(rawStaff.map(normalizeStaffMember));
            setPendingInvites(rawPending.map(normalizePendingInvite));
        } catch {
            alert("Something went wrong while loading staff.");
        } finally {
            setPageLoading(false);
        }
    }, [router]);

    useEffect(() => {
        const token = sessionStorage.getItem("token");
        const role = sessionStorage.getItem("role");

        let savedPermissions: Record<string, boolean> = {};

        try {
            savedPermissions = JSON.parse(
                sessionStorage.getItem("permissions") || "{}"
            );
        } catch {
            savedPermissions = {};
        }

        if (!token || role !== "manager") {
            router.push("/");
            return;
        }

        if (!savedPermissions.staff_management) {
            alert("You do not have access to staff management.");
            router.push("/dashboard");
            return;
        }

        setManagerName(sessionStorage.getItem("manager_name") || "Manager");
        setStoreName(sessionStorage.getItem("store_name") || "StockNBook");
        setBranchName(sessionStorage.getItem("branch_name") || "Assigned branch");

        loadStaff();
    }, [router, loadStaff]);

    const updateFeatureAccess = (
        feature: "pos" | "bookings" | "inventory" | "packages",
        value: AccessMode
    ) => {
        const accessKey =
            feature === "packages" ? "package_access" : `${feature}_access`;

        setPermissions((prev) => ({
            ...prev,
            [feature]: value !== "none",
            [accessKey]: value,
        }));
    };

    const updateReportsAccess = (value: ReportsAccessMode) => {
        setPermissions((prev) => ({
            ...prev,
            reports: value !== "none",
            reports_access: value,
        }));
    };

    const updateEditFeatureAccess = (
        feature: "pos" | "bookings" | "inventory" | "packages",
        value: AccessMode
    ) => {
        const accessKey =
            feature === "packages" ? "package_access" : `${feature}_access`;

        setEditPermissions((prev) => ({
            ...prev,
            [feature]: value !== "none",
            [accessKey]: value,
        }));
    };

    const updateEditReportsAccess = (value: ReportsAccessMode) => {
        setEditPermissions((prev) => ({
            ...prev,
            reports: value !== "none",
            reports_access: value,
        }));
    };

    const clearForm = () => {
        setStaffName("");
        setStaffEmail("");
        setPermissions(defaultPermissions);
    };

    const handleSendInvite = async () => {
        if (!staffName.trim() || !staffEmail.trim()) {
            alert("Please enter staff name and email.");
            return;
        }

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "invite_staff",
                    staff_name: staffName.trim(),
                    staff_email: staffEmail.trim(),
                    permissions,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }

            const generatedLink = data.invite_link || data.inviteLink || "";

            setInviteLink(generatedLink);
            setStaffName("");
            setStaffEmail("");
            setPermissions(defaultPermissions);

            await loadStaff();

            alert("Staff invite link created!");
        } catch {
            alert("Something went wrong while creating staff invite.");
        } finally {
            setLoading(false);
        }
    };

    const handleEditStaff = (staff: StaffMember) => {
        setEditingStaff(staff);
        setEditPermissions(normalizePermissions(staff.permissions));
    };

    const handleSaveEdit = async () => {
        if (!editingStaff) return;

        const token = getToken();

        if (!token) {
            router.push("/");
            return;
        }

        setSavingEdit(true);

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "update_staff_permissions",
                    staff_id: editingStaff.id,
                    staff_email: editingStaff.email,
                    permissions: editPermissions,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }
            window.dispatchEvent(new Event("stocknbook-permissions-updated"));

            setEditingStaff(null);
            await loadStaff();

            alert("Staff access updated!");
        } catch {
            alert("Something went wrong while updating staff access.");
        } finally {
            setSavingEdit(false);
        }
    };

    const handleResendInvite = async (email: string) => {
        const token = getToken();

        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "resend_staff_invite",
                    staff_email: email,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }

            await loadStaff();
            alert(`Invite resent to ${email}`);
        } catch {
            alert("Something went wrong while resending invite.");
        }
    };

    return (
        <div
            style={{
                backgroundColor: "#FDFAF4",
                fontFamily: "Georgia, 'Times New Roman', serif",
            }}
            className="flex min-h-screen text-[#1A1220]"
        >
            <RoleSidebar />

            <main className="flex-1 overflow-y-auto">
                <div className="flex h-[58px] items-center justify-between border-b border-[#EBE4F0] bg-white px-[18px]">
                    <div className="flex items-center gap-3">
                        <h1 className="text-[20px] font-medium text-[#1A1220]">
                            Add Staff
                        </h1>

                        <span className="rounded-[7px] bg-[#F2ECFA] px-3 py-1 text-[11px] font-medium text-[#5B447A]">
                            {branchName}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="rounded-[9px] border border-[#EBE4F0] bg-white px-4 py-1.5 text-[12px] text-[#6E5F80]">
                            {new Date().toLocaleDateString("en-US", {
                                month: "long",
                                year: "numeric",
                            })}
                        </div>

                        <div className="h-[34px] w-[34px] rounded-[9px] border border-[#EBE4F0] bg-white" />

                        <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#2D1B4E] text-[13px] font-semibold text-white">
                            {getInitials(managerName)}
                        </div>
                    </div>
                </div>

                <section className="mx-auto max-w-3xl px-[18px] py-[20px]">
                    <div className="rounded-[15px] border border-[#EBE4F0] bg-white p-5">
                        <div className="flex items-start gap-4">
                            <div className="h-[48px] w-[48px] rounded-[14px] bg-[#E8E0F2]" />

                            <div>
                                <h2 className="text-[19px] font-medium text-[#1A1220]">
                                    Add a staff member
                                </h2>

                                <p className="mt-1 text-[12px] text-[#7A6E88]">
                                    They&apos;ll receive an email invite to set up their account.
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-4 md:grid-cols-2">
                            <FormInput
                                label="Full name"
                                placeholder="Pedro Ramos"
                                value={staffName}
                                onChange={setStaffName}
                            />

                            <FormInput
                                label="Email address"
                                placeholder="pedro@example.com"
                                value={staffEmail}
                                onChange={setStaffEmail}
                            />
                        </div>

                        <div className="mt-6">
                            <h3 className="text-[14px] font-semibold text-[#1A1220]">
                                Feature access for this staff member
                            </h3>

                            <p className="mt-1 text-[12px] text-[#7A6E88]">
                                Access applies to {branchName} only.
                            </p>

                            <div className="mt-4 space-y-2">
                                <DashboardAccessRow
                                    checked={permissions.dashboard}
                                    onChange={(checked) =>
                                        setPermissions((prev) => ({
                                            ...prev,
                                            dashboard: checked,
                                        }))
                                    }
                                />

                                <AccessModeRow
                                    label="POS / Sales"
                                    value={permissions.pos_access}
                                    onChange={(value) =>
                                        updateFeatureAccess("pos", value as AccessMode)
                                    }
                                />

                                <AccessModeRow
                                    label="Bookings"
                                    value={permissions.bookings_access}
                                    onChange={(value) =>
                                        updateFeatureAccess("bookings", value as AccessMode)
                                    }
                                />

                                <AccessModeRow
                                    label="Inventory"
                                    value={permissions.inventory_access}
                                    onChange={(value) =>
                                        updateFeatureAccess("inventory", value as AccessMode)
                                    }
                                />

                                <AccessModeRow
                                    label="Packages"
                                    value={permissions.package_access}
                                    onChange={(value) =>
                                        updateFeatureAccess("packages", value as AccessMode)
                                    }
                                />

                                <AccessModeRow
                                    label="Reports"
                                    value={permissions.reports_access}
                                    allowFull={false}
                                    onChange={(value) =>
                                        updateReportsAccess(value as ReportsAccessMode)
                                    }
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                            <button
                                onClick={handleSendInvite}
                                disabled={loading}
                                className="flex-1 rounded-[12px] bg-[#2D1B4E] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                            >
                                {loading ? "Sending..." : "Send invite"}
                            </button>

                            <button
                                onClick={clearForm}
                                type="button"
                                className="flex-1 rounded-[12px] border border-[#E4D9EE] bg-[#FFFDF9] px-5 py-3 text-[14px] font-medium text-[#6E5F80]"
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {inviteLink && (
                        <div className="mt-4 rounded-[15px] border border-[#EBE4F0] bg-white p-5">
                            <h2 className="text-[15px] font-semibold text-[#2D1B4E]">
                                Staff invite link
                            </h2>

                            <p className="mt-1 text-[12px] text-[#7A6E88]">
                                Copy this link and use it to activate the staff account.
                            </p>

                            <div className="mt-3 flex gap-2">
                                <input
                                    readOnly
                                    value={inviteLink}
                                    className="w-full rounded-[10px] border border-[#E4D9EE] bg-[#FFFDFA] px-3 py-2 text-[11px] text-[#7A6E88] outline-none"
                                />

                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(inviteLink);
                                        alert("Staff invite link copied!");
                                    }}
                                    className="rounded-[10px] bg-[#2D1B4E] px-4 py-2 text-[11px] font-semibold text-white"
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="mt-4 rounded-[15px] border border-[#EBE4F0] bg-white p-5">
                        <h2 className="text-[17px] font-medium text-[#1A1220]">
                            Current staff
                        </h2>

                        <div className="mt-4 space-y-2">
                            {pageLoading ? (
                                <EmptyState text="Loading staff..." />
                            ) : staffList.length === 0 ? (
                                <EmptyState text="No accepted staff yet." />
                            ) : (
                                staffList.map((staff) => (
                                    <div
                                        key={staff.id}
                                        className="flex flex-col gap-3 rounded-[12px] border border-[#F0E8F5] bg-[#FFFDFA] px-4 py-3 md:flex-row md:items-center md:justify-between"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-[14px] font-medium text-[#1A1220]">
                                                {staff.name}
                                            </p>

                                            <p className="mt-0.5 truncate text-[12px] text-[#7A6E88]">
                                                {staff.email}
                                            </p>

                                            <p className="mt-1 truncate text-[11px] text-[#7A6E88]">
                                                Access: {formatPermissions(staff.permissions)}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            <StatusBadge label={staff.status} tone="green" />

                                            <button
                                                onClick={() => handleEditStaff(staff)}
                                                className="rounded-[10px] border border-[#E4D9EE] bg-white px-3 py-2 text-[12px] font-medium text-[#2D1B4E]"
                                            >
                                                Edit access
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="mt-4 rounded-[15px] border border-[#EBE4F0] bg-white p-5">
                        <h2 className="text-[17px] font-medium text-[#1A1220]">
                            Pending invites
                        </h2>

                        <div className="mt-4 space-y-2">
                            {pageLoading ? (
                                <EmptyState text="Loading invites..." />
                            ) : pendingInvites.length === 0 ? (
                                <EmptyState text="No pending invites yet." />
                            ) : (
                                pendingInvites.map((invite) => (
                                    <div
                                        key={invite.id}
                                        className="flex flex-col gap-3 rounded-[12px] border border-[#F0E8F5] bg-[#FFFDFA] px-4 py-3 md:flex-row md:items-center md:justify-between"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-[14px] font-medium text-[#1A1220]">
                                                {invite.email}
                                            </p>

                                            <p className="mt-0.5 text-[12px] text-[#7A6E88]">
                                                Invited {invite.invitedAt} · Expires {invite.expiresAt}
                                            </p>

                                            <p className="mt-1 truncate text-[11px] text-[#7A6E88]">
                                                Access: {formatPermissions(invite.permissions)}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            <StatusBadge label={invite.status} tone="gold" />

                                            <button
                                                onClick={() => handleResendInvite(invite.email)}
                                                className="rounded-[10px] border border-[#E4D9EE] bg-white px-3 py-2 text-[12px] font-medium text-[#2D1B4E]"
                                            >
                                                Resend
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </section>
            </main>

            {editingStaff && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
                    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[16px] border border-[#EBE4F0] bg-white p-5 shadow-xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-[19px] font-medium text-[#1A1220]">
                                    Edit staff access
                                </h2>

                                <p className="mt-1 text-[12px] text-[#7A6E88]">
                                    Update permissions for {editingStaff.name}.
                                </p>
                            </div>

                            <button
                                onClick={() => setEditingStaff(null)}
                                className="rounded-[9px] border border-[#EBE4F0] px-3 py-1.5 text-[12px] text-[#6E5F80]"
                            >
                                Close
                            </button>
                        </div>

                        <div className="mt-5 space-y-2">
                            <DashboardAccessRow
                                checked={editPermissions.dashboard}
                                onChange={(checked) =>
                                    setEditPermissions((prev) => ({
                                        ...prev,
                                        dashboard: checked,
                                    }))
                                }
                            />

                            <AccessModeRow
                                label="POS / Sales"
                                value={editPermissions.pos_access}
                                onChange={(value) =>
                                    updateEditFeatureAccess("pos", value as AccessMode)
                                }
                            />

                            <AccessModeRow
                                label="Bookings"
                                value={editPermissions.bookings_access}
                                onChange={(value) =>
                                    updateEditFeatureAccess("bookings", value as AccessMode)
                                }
                            />

                            <AccessModeRow
                                label="Inventory"
                                value={editPermissions.inventory_access}
                                onChange={(value) =>
                                    updateEditFeatureAccess("inventory", value as AccessMode)
                                }
                            />

                            <AccessModeRow
                                label="Packages"
                                value={editPermissions.package_access}
                                onChange={(value) =>
                                    updateEditFeatureAccess("packages", value as AccessMode)
                                }
                            />

                            <AccessModeRow
                                label="Reports"
                                value={editPermissions.reports_access}
                                allowFull={false}
                                onChange={(value) =>
                                    updateEditReportsAccess(value as ReportsAccessMode)
                                }
                            />
                        </div>

                        <div className="mt-5 flex gap-3">
                            <button
                                onClick={() => setEditingStaff(null)}
                                className="flex-1 rounded-[12px] border border-[#E4D9EE] bg-white px-5 py-3 text-[13px] font-medium text-[#2D1B4E]"
                            >
                                Cancel
                            </button>

                            <button
                                onClick={handleSaveEdit}
                                disabled={savingEdit}
                                className="flex-1 rounded-[12px] bg-[#2D1B4E] px-5 py-3 text-[13px] font-semibold text-white disabled:opacity-60"
                            >
                                {savingEdit ? "Saving..." : "Save changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function normalizeStaffMember(item: any): StaffMember {
    return {
        id: item.id || item.staff_id || item.user_id || item.email,
        name: item.name || item.staff_name || item.full_name || "Unnamed staff",
        email: item.email || item.staff_email || "",
        status:
            item.status === "Inactive" || item.status === "inactive"
                ? "Inactive"
                : "Accepted",
        permissions: normalizePermissions(item.permissions),
    };
}

function normalizePendingInvite(item: any): PendingInvite {
    return {
        id: item.id || item.invite_id || item.staff_email || item.email,
        email: item.email || item.staff_email || "",
        invitedAt:
            item.invitedAt ||
            item.invited_at ||
            item.created_at ||
            "Recently",
        expiresAt:
            item.expiresAt ||
            item.expires_at ||
            item.expiration ||
            "Pending",
        status: "Pending",
        permissions: normalizePermissions(item.permissions),
    };
}

function normalizePermissions(raw: any): StaffPermissions {
    let parsed = raw;

    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = {};
        }
    }

    parsed = parsed || {};

    const posAccess = getAccessValue(parsed.pos_access, parsed.pos);
    const bookingsAccess = getAccessValue(parsed.bookings_access, parsed.bookings);
    const inventoryAccess = getAccessValue(
        parsed.inventory_access,
        parsed.inventory
    );
    const packageAccess = getAccessValue(
        parsed.package_access,
        parsed.packages
    );
    const reportsAccess = getReportsAccessValue(
        parsed.reports_access,
        parsed.reports
    );

    return {
        dashboard: Boolean(parsed.dashboard),

        pos: posAccess !== "none",
        pos_access: posAccess,

        bookings: bookingsAccess !== "none",
        bookings_access: bookingsAccess,

        inventory: inventoryAccess !== "none",
        inventory_access: inventoryAccess,

        packages: packageAccess !== "none",
        package_access: packageAccess,

        reports: reportsAccess !== "none",
        reports_access: reportsAccess,
    };
}

function getAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "view" || value === "full" || value === "none") {
        return value;
    }

    if (legacyBoolean === true) return "full";
    return "none";
}

function getReportsAccessValue(
    value: any,
    legacyBoolean: any
): ReportsAccessMode {
    if (value === "view" || value === "none") {
        return value;
    }

    if (legacyBoolean === true) return "view";
    return "none";
}

function FormInput({
                       label,
                       placeholder,
                       value,
                       onChange,
                   }: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <label className="mb-2 block text-[12px] font-medium text-[#1A1220]">
                {label}
            </label>

            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-[12px] border border-[#E4D9EE] bg-[#FFFDFA] px-4 py-3 text-[13px] text-[#1A1220] outline-none placeholder:text-[#9A8CAA] focus:border-[#BDAAD1]"
            />
        </div>
    );
}

function DashboardAccessRow({
                                checked,
                                onChange,
                            }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-[12px] bg-[#FFFDFA] px-4 py-3">
            <span className="text-[14px] text-[#1A1220]">Dashboard</span>

            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative h-[26px] w-[48px] rounded-full transition ${
                    checked ? "bg-[#2D1B4E]" : "bg-[#E7DEEF]"
                }`}
            >
                <span
                    className={`absolute top-[3px] h-[20px] w-[20px] rounded-full bg-white transition ${
                        checked ? "left-[25px]" : "left-[3px]"
                    }`}
                />
            </button>
        </div>
    );
}

function AccessModeRow({
                           label,
                           value,
                           onChange,
                           allowFull = true,
                       }: {
    label: string;
    value: AccessMode | ReportsAccessMode;
    onChange: (value: AccessMode | ReportsAccessMode) => void;
    allowFull?: boolean;
}) {
    return (
        <div className="flex items-center justify-between rounded-[12px] bg-[#FFFDFA] px-4 py-3">
            <span className="text-[14px] text-[#1A1220]">{label}</span>

            <select
                value={value}
                onChange={(e) =>
                    onChange(e.target.value as AccessMode | ReportsAccessMode)
                }
                className="min-w-[128px] rounded-[10px] border border-[#E4D9EE] bg-white px-3 py-2 text-[11px] font-semibold text-[#2D1B4E] outline-none focus:border-[#2D1B4E]"
            >
                <option value="none">No access</option>
                <option value="view">View only</option>
                {allowFull && <option value="full">Full access</option>}
            </select>
        </div>
    );
}

function StatusBadge({
                         label,
                         tone,
                     }: {
    label: string;
    tone: "green" | "gold";
}) {
    const style =
        tone === "green"
            ? "bg-[#EAF3DE] text-[#44670D]"
            : "bg-[#FAEEDA] text-[#8A5B00]";

    return (
        <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${style}`}
        >
            {label}
        </span>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="rounded-[12px] border border-dashed border-[#E9DFF1] bg-[#FFFDFA] px-4 py-5 text-[12px] text-[#7A6E88]">
            {text}
        </div>
    );
}

function formatPermissions(permissions: StaffPermissions) {
    const list: string[] = [];

    if (permissions.dashboard) list.push("Dashboard");
    if (permissions.pos_access !== "none") {
        list.push(`POS / Sales: ${formatAccess(permissions.pos_access)}`);
    }
    if (permissions.bookings_access !== "none") {
        list.push(`Bookings: ${formatAccess(permissions.bookings_access)}`);
    }
    if (permissions.inventory_access !== "none") {
        list.push(`Inventory: ${formatAccess(permissions.inventory_access)}`);
    }
    if (permissions.package_access !== "none") {
        list.push(`Packages: ${formatAccess(permissions.package_access)}`);
    }
    if (permissions.reports_access !== "none") {
        list.push(`Reports: ${formatAccess(permissions.reports_access)}`);
    }

    return list.length > 0 ? list.join(", ") : "No access";
}

function formatAccess(value: AccessMode | ReportsAccessMode) {
    if (value === "none") return "No access";
    if (value === "view") return "View only";
    return "Full access";
}

