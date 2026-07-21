"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lora } from "next/font/google";
import type { ReactNode } from "react";
import {
    useMemo,
    useState,
    useSyncExternalStore,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
    BarChart3,
    Boxes,
    CalendarDays,
    FileText,
    GitBranch,
    LayoutDashboard,
    LineChart,
    LogOut,
    Package,
    Settings,
    ShoppingCart,
    UsersRound,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
});

type Role = "owner" | "manager" | "staff";

type PermissionMap = Record<string, boolean>;

type SidebarItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    exact?: boolean;
};

type StoredSidebarData = {
    role: Role;
    storeName: string;
    branchName: string;
    ownerName: string;
    managerName: string;
    staffName: string;
    permissions: PermissionMap;
};

const defaultSidebarData: StoredSidebarData = {
    role: "owner",
    storeName: "StockNBook",
    branchName: "",
    ownerName: "Owner",
    managerName: "Manager",
    staffName: "Staff",
    permissions: {},
};

const defaultSidebarSnapshot =
    JSON.stringify(defaultSidebarData);

function getSavedItem(key: string) {
    if (typeof window === "undefined") {
        return "";
    }

    return (
        sessionStorage.getItem(key) ||
        localStorage.getItem(key) ||
        ""
    );
}

function normalizeRole(value: unknown): Role {
    const normalizedValue = String(value || "")
        .trim()
        .toLowerCase();

    if (normalizedValue === "manager") {
        return "manager";
    }

    if (normalizedValue === "staff") {
        return "staff";
    }

    return "owner";
}

function normalizePermissions(
    value: unknown,
): PermissionMap {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return {};
    }

    return Object.entries(
        value as Record<string, unknown>,
    ).reduce<PermissionMap>((result, [key, item]) => {
        result[key] =
            item === true ||
            item === 1 ||
            item === "1" ||
            item === "true";

        return result;
    }, {});
}

function getSavedPermissions(): PermissionMap {
    if (typeof window === "undefined") {
        return {};
    }

    const rawPermissions =
        sessionStorage.getItem("permissions") ||
        localStorage.getItem("permissions");

    if (!rawPermissions) {
        return {};
    }

    try {
        return normalizePermissions(
            JSON.parse(rawPermissions),
        );
    } catch {
        return {};
    }
}

function readStoredSidebarData(): StoredSidebarData {
    if (typeof window === "undefined") {
        return defaultSidebarData;
    }

    const role = normalizeRole(
        getSavedItem("role"),
    );

    const storeName =
        getSavedItem("store_name") ||
        "StockNBook";

    return {
        role,
        storeName,

        branchName:
            getSavedItem("branch_name"),

        ownerName:
            getSavedItem("owner_name") ||
            getSavedItem("name") ||
            storeName ||
            "Owner",

        managerName:
            getSavedItem("manager_name") ||
            "Manager",

        staffName:
            getSavedItem("staff_name") ||
            "Staff",

        permissions:
            getSavedPermissions(),
    };
}

function getSidebarStorageSnapshot() {
    return JSON.stringify(
        readStoredSidebarData(),
    );
}

function getServerSidebarStorageSnapshot() {
    return defaultSidebarSnapshot;
}

function subscribeToSidebarStorage(
    callback: () => void,
) {
    if (typeof window === "undefined") {
        return () => undefined;
    }

    window.addEventListener("storage", callback);

    return () => {
        window.removeEventListener(
            "storage",
            callback,
        );
    };
}

function formatPersonName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map(
            (word) =>
                word.charAt(0).toUpperCase() +
                word.slice(1),
        )
        .join(" ");
}

function isCurrentPath(
    pathname: string,
    href: string,
    exact = false,
) {
    if (exact) {
        return pathname === href;
    }

    return (
        pathname === href ||
        pathname.startsWith(`${href}/`)
    );
}

function NavItem({
                     item,
                     pathname,
                 }: {
    item: SidebarItem;
    pathname: string;
}) {
    const active = isCurrentPath(
        pathname,
        item.href,
        item.exact,
    );

    const Icon = item.icon;

    return (
        <Link
            href={item.href}
            aria-current={
                active ? "page" : undefined
            }
            className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] font-medium leading-none transition-colors duration-150 ${
                active
                    ? "bg-[#5634BF] text-white shadow-[0_5px_12px_rgba(41,15,104,0.30)] hover:bg-[#633BCE]"
                    : "text-white/70 hover:bg-white/[0.09] hover:text-white"
            }`}
        >
            <Icon
                size={14}
                strokeWidth={
                    active ? 2.2 : 1.85
                }
                className={`shrink-0 transition-colors duration-150 ${
                    active
                        ? "text-[#E8C15B] drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                        : "text-white/65 group-hover:text-[#E8C15B]"
                }`}
            />

            <span className="truncate">
                {item.label}
            </span>
        </Link>
    );
}

function SidebarSection({
                            label,
                            children,
                        }: {
    label: string;
    children: ReactNode;
}) {
    return (
        <section className="mt-3.5">
            <p className="mb-1.5 px-2.5 text-[8px] font-semibold uppercase tracking-[0.19em] text-white/40">
                {label}
            </p>

            <div className="space-y-0.5">
                {children}
            </div>
        </section>
    );
}

export default function RoleSidebar() {
    const { user } = useCurrentUser();
    const pathname = usePathname();

    const [logoFailed, setLogoFailed] =
        useState(false);

    /*
     * This reads the saved sidebar information without
     * calling setState inside useEffect.
     */
    const storedSnapshot =
        useSyncExternalStore(
            subscribeToSidebarStorage,
            getSidebarStorageSnapshot,
            getServerSidebarStorageSnapshot,
        );

    const storedData =
        useMemo<StoredSidebarData>(() => {
            try {
                const parsed = JSON.parse(
                    storedSnapshot,
                ) as Partial<StoredSidebarData>;

                return {
                    role: normalizeRole(
                        parsed.role,
                    ),

                    storeName:
                        parsed.storeName ||
                        "StockNBook",

                    branchName:
                        parsed.branchName || "",

                    ownerName:
                        parsed.ownerName ||
                        "Owner",

                    managerName:
                        parsed.managerName ||
                        "Manager",

                    staffName:
                        parsed.staffName ||
                        "Staff",

                    permissions:
                        normalizePermissions(
                            parsed.permissions,
                        ),
                };
            } catch {
                return defaultSidebarData;
            }
        }, [storedSnapshot]);

    const role = normalizeRole(
        user?.role || storedData.role,
    );

    const permissions =
        normalizePermissions(
            user?.permissions ||
            storedData.permissions,
        );

    const storeName =
        user?.store_name ||
        storedData.storeName ||
        "StockNBook";

    const branchName =
        user?.branch_name ||
        storedData.branchName ||
        "";

    const ownerName =
        user?.owner_name ||
        storedData.ownerName ||
        storeName ||
        "Owner";

    const managerName =
        user?.manager_name ||
        storedData.managerName ||
        "Manager";

    const staffName =
        user?.staff_name ||
        storedData.staffName ||
        "Staff";

    const rawPersonName =
        role === "owner"
            ? ownerName
            : role === "manager"
                ? managerName
                : staffName;

    const personName =
        formatPersonName(rawPersonName);

    const profileBranchName =
        branchName.trim();

    const roleLabel =
        role === "owner"
            ? "Owner"
            : role === "manager"
                ? "Manager"
                : "Staff";

    const canAccess = (
        permission: string,
    ) => {
        if (role === "owner") {
            return true;
        }

        return (
            permissions[permission] === true
        );
    };

    const canViewAnalytics =
        role === "owner" ||
        role === "manager" ||
        role === "staff";

    const canViewForecasting =
        role === "owner" ||
        role === "manager" ||
        role === "staff";

    const canViewSettings =
        role === "owner" ||
        canAccess("branch_settings");

    const handleLogout = () => {
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = "/";
    };

    return (
        <aside className="flex min-h-screen w-[216px] shrink-0 flex-col self-stretch bg-[#1E1035] font-sans text-white shadow-[2px_0_12px_rgba(19,8,44,0.10)]">
            {/* StockNBook logo */}
            <div className="border-b border-white/[0.08] px-4 py-4">
                <Link
                    href="/dashboard"
                    className="flex items-center gap-3 rounded-lg outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                >
                    {logoFailed ? (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#E2A61A] text-[13px] font-extrabold tracking-[-0.08em] text-[#241142]">
                            SN
                        </div>
                    ) : (
                        <Image
                            src="/logo.png"
                            alt="StockNBook logo"
                            width={48}
                            height={48}
                            priority
                            onError={() =>
                                setLogoFailed(true)
                            }
                            className="h-12 w-12 shrink-0 rounded-xl object-contain"
                        />
                    )}

                    <span
                        className={`${lora.className} block min-w-0 truncate text-[18px] font-bold leading-none tracking-[-0.045em]`}
                    >
                        <span className="text-white">
                            Stock
                        </span>

                        <span className="text-[#E2A61A]">
                            N
                        </span>

                        <span className="text-white">
                            Book
                        </span>
                    </span>
                </Link>
            </div>

            {/* Store, user and branch information */}
            <div className="border-b border-white/[0.08] px-4 py-4">
                <div className="min-w-0">
                    <p
                        title={storeName}
                        className="w-full whitespace-normal break-words text-[15px] font-extrabold leading-snug tracking-[-0.02em] text-white [overflow-wrap:anywhere]"
                    >
                        {storeName}
                    </p>

                    <p
                        title={personName}
                        className="mt-1.5 w-full whitespace-normal break-words text-[11px] font-semibold leading-snug text-white [overflow-wrap:anywhere]"
                    >
                        {personName}
                    </p>

                    <span className="mt-1.5 inline-flex rounded-md bg-[#B77D1B] px-2.5 py-0.5 text-[8px] font-semibold leading-none text-white shadow-sm">
                        {roleLabel}
                    </span>

                    {profileBranchName && (
                        <p
                            title={
                                profileBranchName
                            }
                            className="mt-1.5 w-full whitespace-normal break-words text-[9px] font-medium leading-snug text-white/45 [overflow-wrap:anywhere]"
                        >
                            {profileBranchName}
                        </p>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <nav className="px-2.5 py-3">
                <SidebarSection label="Overview">
                    <NavItem
                        pathname={pathname}
                        item={{
                            label: "Dashboard",
                            href: "/dashboard",
                            icon: LayoutDashboard,
                            exact: true,
                        }}
                    />

                    {role === "owner" && (
                        <NavItem
                            pathname={pathname}
                            item={{
                                label: "Branches",
                                href: "/branches",
                                icon: GitBranch,
                            }}
                        />
                    )}
                </SidebarSection>

                {(canAccess("bookings") ||
                    canAccess("inventory") ||
                    canAccess("packages") ||
                    canAccess("pos")) && (
                    <SidebarSection label="Business">
                        {canAccess("bookings") && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Bookings",
                                    href:
                                        "/bookings",
                                    icon:
                                    CalendarDays,
                                }}
                            />
                        )}

                        {canAccess("inventory") && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Inventory",
                                    href:
                                        "/inventory",
                                    icon: Boxes,
                                }}
                            />
                        )}

                        {canAccess("packages") && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Packages",
                                    href:
                                        "/packages",
                                    icon: Package,
                                }}
                            />
                        )}

                        {canAccess("pos") && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Sales / POS",
                                    href: "/pos",
                                    icon:
                                    ShoppingCart,
                                }}
                            />
                        )}
                    </SidebarSection>
                )}

                {(canViewAnalytics ||
                    canViewForecasting ||
                    canAccess("reports")) && (
                    <SidebarSection label="Insight">
                        {canViewAnalytics && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Analytics",
                                    href:
                                        "/analytics",
                                    icon:
                                    BarChart3,
                                }}
                            />
                        )}

                        {canViewForecasting && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Forecasting",
                                    href:
                                        "/dashboard/forecasting",
                                    icon:
                                    LineChart,
                                }}
                            />
                        )}

                        {canAccess("reports") && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Reports",
                                    href:
                                        "/reports",
                                    icon:
                                    FileText,
                                }}
                            />
                        )}
                    </SidebarSection>
                )}

                {(role === "owner" ||
                    (role === "manager" &&
                        canAccess(
                            "staff_management",
                        ))) && (
                    <SidebarSection label="Team">
                        {role === "owner" && (
                            <NavItem
                                pathname={
                                    pathname
                                }
                                item={{
                                    label:
                                        "Branch Managers",
                                    href:
                                        "/branch-managers",
                                    icon:
                                    UsersRound,
                                }}
                            />
                        )}

                        {role === "manager" &&
                            canAccess(
                                "staff_management",
                            ) && (
                                <NavItem
                                    pathname={
                                        pathname
                                    }
                                    item={{
                                        label:
                                            "Staff",
                                        href:
                                            "/manager/staff-management",
                                        icon:
                                        UsersRound,
                                    }}
                                />
                            )}
                    </SidebarSection>
                )}

                {/* Settings and Logout */}
                <SidebarSection label="System">
                    {canViewSettings && (
                        <NavItem
                            pathname={pathname}
                            item={{
                                label: "Settings",
                                href: "/settings",
                                icon: Settings,
                            }}
                        />
                    )}

                    <button
                        type="button"
                        onClick={handleLogout}
                        className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[11px] font-medium leading-none text-white/75 transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                    >
                        <LogOut
                            size={14}
                            strokeWidth={1.85}
                            className="shrink-0 text-white/65 transition-colors group-hover:text-[#E8C15B]"
                        />

                        <span>Logout</span>
                    </button>
                </SidebarSection>
            </nav>
        </aside>
    );
}