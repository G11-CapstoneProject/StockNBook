"use client";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
    BarChart3,
    Boxes,
    ClipboardList,
    LayoutDashboard,
    Settings,
    ShieldCheck,
    ShoppingCart,
    Sparkles,
    Store,
    Users,
} from "lucide-react";

type PermissionKey =
    | "dashboard"
    | "bookings"
    | "packages"
    | "inventory"
    | "pos"
    | "reports"
    | "staff_management"
    | "staff_roles"
    | "branch_settings";

type MenuItem = {
    label: string;
    href: string;
    permission: PermissionKey;
    icon: ReactNode;
};

export default function ManagerPage() {
    const router = useRouter();

    const [managerName, setManagerName] = useState("");
    const [storeName, setStoreName] = useState("");
    const [branchName, setBranchName] = useState("");
    const [permissions, setPermissions] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const token = sessionStorage.getItem("token");
        const role = sessionStorage.getItem("role");

        if (!token || role !== "manager") {
            router.push("/");
            return;
        }

        setManagerName(sessionStorage.getItem("manager_name") || "Manager");
        setStoreName(sessionStorage.getItem("store_name") || "StockNBook");
        setBranchName(sessionStorage.getItem("branch_name") || "Assigned branch");

        try {
            setPermissions(JSON.parse(sessionStorage.getItem("permissions") || "{}"));
        } catch {
            setPermissions({});
        }
    }, [router]);

    const menuGroups = useMemo(
        () => [
            {
                title: "Main",
                items: [
                    {
                        label: "Dashboard",
                        href: "/dashboard",
                        permission: "dashboard" as PermissionKey,
                        icon: <LayoutDashboard className="h-5 w-5" />,
                    },
                ],
            },
            {
                title: "Operations",
                items: [
                    {
                        label: "Bookings",
                        href: "/manager/bookings",
                        permission: "bookings" as PermissionKey,
                        icon: <ClipboardList className="h-5 w-5" />,
                    },
                    {
                        label: "Packages",
                        href: "/manager/packages",
                        permission: "packages" as PermissionKey,
                        icon: <Boxes className="h-5 w-5" />,
                    },
                    {
                        label: "Inventory",
                        href: "/manager/inventory",
                        permission: "inventory" as PermissionKey,
                        icon: <Boxes className="h-5 w-5" />,
                    },
                    {
                        label: "Sales / POS",
                        href: "/manager/pos",
                        permission: "pos" as PermissionKey,
                        icon: <ShoppingCart className="h-5 w-5" />,
                    },
                ],
            },
            {
                title: "Team",
                items: [
                    {
                        label: "Staff",
                        href: "/manager/staff-management",
                        permission: "staff_management" as PermissionKey,
                        icon: <Users className="h-5 w-5" />,
                    },
                    {
                        label: "Staff Roles",
                        href: "/manager/staff-roles",
                        permission: "staff_roles" as PermissionKey,
                        icon: <ShieldCheck className="h-5 w-5" />,
                    },
                ],
            },
            {
                title: "Insights",
                items: [
                    {
                        label: "Reports",
                        href: "/manager/reports",
                        permission: "reports" as PermissionKey,
                        icon: <BarChart3 className="h-5 w-5" />,
                    },
                ],
            },
            {
                title: "System",
                items: [
                    {
                        label: "Branch Settings",
                        href: "/manager/settings",
                        permission: "branch_settings" as PermissionKey,
                        icon: <Settings className="h-5 w-5" />,
                    },
                ],
            },
        ],
        []
    );

    const allowedMenuGroups = menuGroups
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => permissions[item.permission]),
        }))
        .filter((group) => group.items.length > 0);

    const allowedMenuItems: MenuItem[] = allowedMenuGroups.flatMap(
        (group) => group.items
    );

    return (
        <div className="flex min-h-screen bg-[#FDFAF4] text-[#1A1220]">


            <main className="flex-1 overflow-y-auto">
                <section className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
                    <div className="overflow-hidden rounded-3xl bg-[#2D1B4E] shadow-sm">
                        <div className="grid gap-6 p-8 text-white md:grid-cols-[1fr_280px]">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-[#F5E8C0]">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Branch operations
                                </div>

                                <h1 className="mt-5 font-serif text-4xl leading-tight md:text-5xl">
                                    Welcome back, {managerName || "Manager"}.
                                </h1>

                                <p className="mt-4 max-w-xl text-sm leading-7 text-white/65">
                                    Manage your assigned branch, monitor daily operations, and open
                                    the modules enabled by the owner.
                                </p>
                            </div>

                            <div className="rounded-2xl bg-white/10 p-5">
                                <Store className="h-8 w-8 text-[#C9951A]" />

                                <p className="mt-4 text-xs uppercase tracking-[0.18em] text-white/45">
                                    Current branch
                                </p>

                                <p className="mt-2 text-2xl font-semibold">
                                    {branchName}
                                </p>

                                <p className="mt-2 text-sm text-white/55">
                                    {storeName}
                                </p>
                            </div>
                        </div>
                    </div>

                    <section className="mt-8 grid gap-5 md:grid-cols-3">
                        <DashboardCard
                            title="Allowed modules"
                            value={String(allowedMenuItems.length)}
                            note="Available to your role"
                        />

                        <DashboardCard
                            title="Today’s bookings"
                            value="0"
                            note="No scheduled events yet"
                        />

                        <DashboardCard
                            title="Branch role"
                            value="Admin"
                            note="Manager access"
                        />
                    </section>

                    <section className="mt-8 rounded-3xl border border-[#EBE4F0] bg-white p-7 shadow-sm">
                        <div>
                            <h2 className="font-serif text-3xl text-[#1A1220]">
                                Quick access
                            </h2>

                            <p className="mt-1 text-sm text-[#7A6E88]">
                                Open the modules available for your branch.
                            </p>
                        </div>

                        <div className="mt-6 space-y-8">
                            {allowedMenuGroups.map((group) => (
                                <div key={group.title}>
                                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#7A6E88]">
                                        {group.title}
                                    </p>

                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                        {group.items.map((item) => (
                                            <button
                                                key={item.href}
                                                onClick={() => router.push(item.href)}
                                                className="group rounded-2xl border border-[#EBE4F0] bg-[#FDFAF4] p-5 text-left transition hover:border-[#2D1B4E]/30 hover:bg-white hover:shadow-sm"
                                            >
                                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EEE8F8] text-[#2D1B4E] transition group-hover:bg-[#2D1B4E] group-hover:text-white">
                                                    {item.icon}
                                                </div>

                                                <p className="mt-4 font-semibold text-[#1A1220]">
                                                    {item.label}
                                                </p>

                                                <p className="mt-1 text-xs leading-5 text-[#7A6E88]">
                                                    Open and manage {item.label.toLowerCase()} for
                                                    this branch.
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </section>
            </main>
        </div>
    );
}

function DashboardCard({
                           title,
                           value,
                           note,
                       }: {
    title: string;
    value: string;
    note: string;
}) {
    return (
        <div className="rounded-3xl border border-[#EBE4F0] bg-white p-6 shadow-sm">
            <p className="text-sm text-[#7A6E88]">{title}</p>
            <p className="mt-3 font-serif text-4xl text-[#2D1B4E]">{value}</p>
            <p className="mt-2 text-xs text-[#7A6E88]">{note}</p>
        </div>
    );
}
