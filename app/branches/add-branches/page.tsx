"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Package } from "lucide-react";

const defaultPermissions = {
    dashboard: true,
    bookings: true,
    packages: true,
    inventory: true,
    pos: true,
    reports: false,
    staff_management: false,
    branch_settings: false,
};

type PermissionKey = keyof typeof defaultPermissions;

type InviteLink = {
    manager_email: string;
    manager_name: string;
    branch_name: string;
    invite_link: string;
};

export default function AddBranchPage() {
    const router = useRouter();

    const [branchName, setBranchName] = useState("");
    const [contactNumber, setContactNumber] = useState("");
    const [address, setAddress] = useState("");
    const [managerName, setManagerName] = useState("");
    const [managerEmail, setManagerEmail] = useState("");
    const [permissions, setPermissions] = useState(defaultPermissions);
    const [loading, setLoading] = useState(false);
    const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);

    const updatePermission = (permission: PermissionKey, value: boolean) => {
        setPermissions((prev) => ({
            ...prev,
            [permission]: value,
        }));
    };

    const handleSave = async () => {
        if (!branchName) {
            alert("Please enter branch name.");
            return;
        }

        if (!managerName || !managerEmail) {
            alert("Please enter manager name and email.");
            return;
        }

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/onboarding", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branches: [
                        {
                            branch_name: branchName,
                            contact_number: contactNumber,
                            address,
                            manager_name: managerName,
                            manager_email: managerEmail,
                            permissions,
                        },
                    ],
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }

            setInviteLinks(data.invite_links || []);
            alert("Branch and manager invitation created!");
        } catch (error) {
            alert("Something went wrong while adding branch.");
        } finally {
            setLoading(false);
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
                <div className="flex h-[64px] items-center justify-between border-b border-[#EBE4F0] bg-white px-[18px]">
                    <div className="flex items-center gap-3">
                        <h1 className="text-[22px] font-medium text-[#1A1220]">
                            Add Branch
                        </h1>

                        <span className="rounded-[6px] bg-[#FFFBF0] px-3 py-1 text-[11px] font-medium text-[#633806]">
                            Owner setup
                        </span>
                    </div>

                    <button
                        onClick={() => router.push("/branches/add-branches")}
                        className="rounded-[9px] border border-[#EBE4F0] bg-white px-5 py-2 text-[13px] font-medium text-[#2D1B4E] hover:bg-[#EEE8F8]"
                    >
                        Back to branches
                    </button>
                </div>

                <section className="mx-auto max-w-3xl px-[18px] py-[22px]">
                    <div className="rounded-[14px] border border-[#EBE4F0] bg-white p-7">
                        <h2 className="text-[22px] font-medium text-[#1A1220]">
                            Branch details
                        </h2>

                        <p className="mt-2 text-[14px] leading-6 text-[#7A6E88]">
                            Add a new branch and invite the assigned branch manager.
                        </p>

                        <div className="mt-7 space-y-5">
                            <TextInput
                                label="Branch name"
                                placeholder="e.g. Main Branch"
                                value={branchName}
                                onChange={setBranchName}
                            />

                            <TextInput
                                label="Branch contact number"
                                placeholder="09XX XXX XXXX"
                                value={contactNumber}
                                onChange={setContactNumber}
                            />

                            <TextInput
                                label="Branch address"
                                placeholder="Full address of this branch"
                                value={address}
                                onChange={setAddress}
                            />
                        </div>

                        <div className="mt-8 border-t border-[#EBE4F0] pt-7">
                            <h2 className="text-[22px] font-medium text-[#1A1220]">
                                Branch manager
                            </h2>

                            <p className="mt-2 text-[14px] leading-6 text-[#7A6E88]">
                                This manager will receive an invite link and will handle this branch.
                            </p>

                            <div className="mt-7 space-y-5">
                                <TextInput
                                    label="Manager name"
                                    placeholder="e.g. Ana Cruz"
                                    value={managerName}
                                    onChange={setManagerName}
                                    icon={<Package className="h-5 w-5 text-[#7A6E88]" />}
                                />

                                <TextInput
                                    label="Manager email"
                                    placeholder="manager@email.com"
                                    type="email"
                                    value={managerEmail}
                                    onChange={setManagerEmail}
                                    icon={<Mail className="h-5 w-5 text-[#7A6E88]" />}
                                />
                            </div>
                        </div>

                        <div className="mt-8 border-t border-[#EBE4F0] pt-7">
                            <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#7A6E88]">
                                Manager feature access
                            </p>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <AccessToggle
                                    label="Dashboard"
                                    checked={permissions.dashboard}
                                    onChange={(checked) => updatePermission("dashboard", checked)}
                                />

                                <AccessToggle
                                    label="Bookings"
                                    checked={permissions.bookings}
                                    onChange={(checked) => updatePermission("bookings", checked)}
                                />

                                <AccessToggle
                                    label="Packages"
                                    checked={permissions.packages}
                                    onChange={(checked) => updatePermission("packages", checked)}
                                />

                                <AccessToggle
                                    label="Inventory"
                                    checked={permissions.inventory}
                                    onChange={(checked) => updatePermission("inventory", checked)}
                                />

                                <AccessToggle
                                    label="Sales / POS"
                                    checked={permissions.pos}
                                    onChange={(checked) => updatePermission("pos", checked)}
                                />

                                <AccessToggle
                                    label="Reports"
                                    checked={permissions.reports}
                                    onChange={(checked) => updatePermission("reports", checked)}
                                />

                                <AccessToggle
                                    label="Staff Management"
                                    checked={permissions.staff_management}
                                    onChange={(checked) =>
                                        updatePermission("staff_management", checked)
                                    }
                                />

                                <AccessToggle
                                    label="Branch Settings"
                                    checked={permissions.branch_settings}
                                    onChange={(checked) =>
                                        updatePermission("branch_settings", checked)
                                    }
                                />
                            </div>
                        </div>

                        <div className="mt-8 flex gap-3">
                            <button
                                onClick={() => router.push("/branches")}
                                className="w-full rounded-lg border border-[#EBE4F0] bg-white px-5 py-3 font-medium text-[#2D1B4E]"
                            >
                                Cancel
                            </button>

                            <button
                                onClick={handleSave}
                                disabled={loading}
                                className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white disabled:opacity-60"
                            >
                                {loading ? "Saving..." : "Add branch"}
                            </button>
                        </div>
                    </div>

                    {inviteLinks.length > 0 && (
                        <div className="mt-6 rounded-[14px] border border-[#EBE4F0] bg-white p-6">
                            <h3 className="font-semibold text-[#2D1B4E]">
                                Manager invitation link
                            </h3>

                            <p className="mt-2 text-[14px] text-[#7A6E88]">
                                Copy this link and use it to activate the manager account.
                            </p>

                            <div className="mt-5 space-y-4">
                                {inviteLinks.map((invite, index) => (
                                    <div
                                        key={index}
                                        className="rounded-xl border border-[#EBE4F0] bg-[#FDFAF4] p-4"
                                    >
                                        <p className="text-sm font-semibold text-[#1A1220]">
                                            {invite.manager_name || "Manager"} — {invite.branch_name}
                                        </p>

                                        <p className="mt-1 text-xs text-[#7A6E88]">
                                            {invite.manager_email}
                                        </p>

                                        <div className="mt-3 flex gap-2">
                                            <input
                                                readOnly
                                                value={invite.invite_link}
                                                className="w-full rounded-lg border border-[#EBE4F0] px-3 py-2 text-xs text-[#7A6E88]"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(invite.invite_link);
                                                    alert("Invite link copied!");
                                                }}
                                                className="rounded-lg bg-[#2D1B4E] px-4 py-2 text-xs font-medium text-white"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button
                                type="button"
                                onClick={() => router.push("/branches")}
                                className="mt-6 w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white"
                            >
                                Go to branches
                            </button>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

function TextInput({
                       label,
                       placeholder,
                       type = "text",
                       value,
                       onChange,
                       icon,
                   }: {
    label: string;
    placeholder: string;
    type?: string;
    value: string;
    onChange: (value: string) => void;
    icon?: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-2 block text-[14px] font-medium text-[#1A1220]">
                {label}
            </label>

            <div className="flex items-center gap-3 rounded-lg border border-[#EBE4F0] bg-[#FDFAF4] px-4 py-3 transition focus-within:border-[#2D1B4E] focus-within:ring-4 focus-within:ring-[#2D1B4E]/10">
                {icon}

                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#7A6E88]"
                />
            </div>
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
        <label className="flex items-center justify-between rounded-xl bg-[#FDFAF4] px-4 py-3 text-sm text-[#1A1220]">
            <span>{label}</span>

            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="h-4 w-4 accent-[#2D1B4E]"
            />
        </label>
    );
}

