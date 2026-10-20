"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lora } from "next/font/google";
import type { ReactNode } from "react";
import {
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
    BarChart3,
    Boxes,
    CalendarDays,
    CreditCard,
    FileText,
    GitBranch,
    LayoutDashboard,
    LineChart,
    LockKeyhole,
    Menu,
    X,
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

/*
 * Access is granular, not just on/off. The owner assigns each module
 * one of these three levels when setting up a branch/manager, and the
 * backend stores/returns permissions using these same string values
 * (see permissionAccessLevel in the API). Legacy boolean `true`/`false`
 * values (from older invites) are still accepted for backwards
 * compatibility and treated as "full"/"none".
 */
type AccessLevel = "full" | "view" | "none";

type PermissionMap = Record<string, AccessLevel>;

type SidebarItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    exact?: boolean;
    locked?: boolean;
    lockTitle?: string;
};

type SubscriptionPlanFeatures = {
    name?: string | null;
    has_analytics?: boolean;
    has_forecasting?: boolean;
};

type SubscriptionResponse = {
    subscription?: {
        status?: string | null;
        plan?: SubscriptionPlanFeatures;
        effective_plan?: SubscriptionPlanFeatures | null;
    };
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

function normalizeAccessLevel(
    value: unknown,
): AccessLevel {
    if (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true" ||
        value === "full"
    ) {
        return "full";
    }

    if (
        value === "view" ||
        value === "view_only" ||
        value === "viewOnly" ||
        value === "standard" ||
        value === "confirm_standard"
    ) {
        return "view";
    }

    // Covers false, "none", undefined, null, "", 0, etc.
    return "none";
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

    const raw = value as Record<string, unknown>;
    const result = Object.entries(raw).reduce<PermissionMap>((map, [key, item]) => {
        map[key] = normalizeAccessLevel(item);
        return map;
    }, {});
    // The legacy boolean `bookings` is less specific than the manager-set
    // `bookings_access` level. A Staff `standard` grant must show the menu.
    const bookingsAccess = raw.bookings_access ?? raw.booking_access ?? raw.bookings;
    if (bookingsAccess !== undefined) result.bookings = normalizeAccessLevel(bookingsAccess);
    return result;
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

function subscribeToHydration() {
    return () => undefined;
}

function getClientHydrationSnapshot() {
    return true;
}

function getServerHydrationSnapshot() {
    return false;
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
            title={item.locked ? item.lockTitle : undefined}
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

            <span className="min-w-0 flex-1 truncate">
                {item.label}
            </span>

            {item.locked && (
                <LockKeyhole
                    size={12}
                    strokeWidth={2.2}
                    aria-label={item.lockTitle || `${item.label} is locked by your current plan`}
                    className="ml-auto shrink-0 text-[#E8C15B]"
                />
            )}
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

    /*
     * Keep the server render and the browser's first render identical.
     * After hydration, this becomes true and the sidebar can safely use
     * browser/account-specific values from useCurrentUser and storage.
     */
    const isHydrated = useSyncExternalStore(
        subscribeToHydration,
        getClientHydrationSnapshot,
        getServerHydrationSnapshot,
    );

    const [logoFailed, setLogoFailed] =
        useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // A mobile drawer is navigation only: no subscription/RBAC behavior changes.
    useEffect(() => {
        if (!mobileMenuOpen) return;
        const oldOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMobileMenuOpen(false);
        };
        const desktopLayout = window.matchMedia("(min-width: 1024px)");
        const onDesktopResize = () => {
            if (desktopLayout.matches) setMobileMenuOpen(false);
        };
        window.addEventListener("keydown", onEscape);
        desktopLayout.addEventListener("change", onDesktopResize);
        return () => {
            document.body.style.overflow = oldOverflow;
            window.removeEventListener("keydown", onEscape);
            desktopLayout.removeEventListener("change", onDesktopResize);
        };
    }, [mobileMenuOpen]);

    /*
     * null means the subscription is still being checked (or could not
     * be verified). We only display a lock when the API explicitly says
     * the current plan does not include that feature.
     */
    const [planFeatures, setPlanFeatures] = useState<{
        planName: string;
        analytics: boolean | null;
        forecasting: boolean | null;
    }>({
        planName: "Current",
        analytics: null,
        forecasting: null,
    });

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

    /*
     * IMPORTANT:
     * Do not use useCurrentUser() values until hydration is complete.
     * The server cannot see browser storage/account state, so using those
     * values on the first client render would cause a hydration mismatch.
     */
    const hydratedUser =
        isHydrated ? user : undefined;

    const role = normalizeRole(
        hydratedUser?.role || storedData.role,
    );

    const permissions =
        normalizePermissions(
            hydratedUser?.permissions ||
            storedData.permissions,
        );

    useEffect(() => {
        if (!isHydrated) {
            return;
        }

        let cancelled = false;

        const loadPlanFeatures = async () => {
            const token =
                sessionStorage.getItem("token") ||
                localStorage.getItem("token") ||
                "";

            if (!token) {
                return;
            }

            try {
                const response = await fetch(
                    "/api/subscription-client",
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            Accept: "application/json",
                        },
                        cache: "no-store",
                    },
                );

                const data =
                    (await response.json()) as SubscriptionResponse;

                if (!response.ok || cancelled) {
                    return;
                }

                // Use the server-calculated effective access plan. The
                // subscribed plan is historical after expiration.
                const subscription = data.subscription;
                const expired = String(subscription?.status || "")
                    .toUpperCase() === "EXPIRED";
                const plan = subscription?.effective_plan ??
                    (expired
                        ? {
                            name: "Starter",
                            has_analytics: false,
                            has_forecasting: false,
                        }
                        : subscription?.plan);

                if (!plan) {
                    return;
                }

                setPlanFeatures({
                    planName: String(
                        plan.name || "Current",
                    ),
                    analytics:
                        plan.has_analytics === true,
                    forecasting:
                        plan.has_forecasting === true,
                });
            } catch {
                // The feature pages still enforce access with PlanFeatureGate.
                // Avoid showing a possibly incorrect sidebar lock if this
                // lightweight check fails.
            }
        };

        void loadPlanFeatures();

        const refreshPlanFeatures = () => {
            void loadPlanFeatures();
        };

        window.addEventListener(
            "stocknbook-subscription-updated",
            refreshPlanFeatures,
        );
        // Keep locks in sync when subscription access changes in another tab
        // or when an active paid plan expires while this page remains open.
        window.addEventListener("focus", refreshPlanFeatures);
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                refreshPlanFeatures();
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        const refreshInterval = window.setInterval(() => {
            if (document.visibilityState === "visible") {
                refreshPlanFeatures();
            }
        }, 30_000);

        return () => {
            cancelled = true;
            window.clearInterval(refreshInterval);
            window.removeEventListener("focus", refreshPlanFeatures);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener(
                "stocknbook-subscription-updated",
                refreshPlanFeatures,
            );
        };
    }, [isHydrated]);

    const analyticsLocked =
        planFeatures.analytics === false;

    const forecastingLocked =
        planFeatures.forecasting === false;

    const storeName =
        hydratedUser?.store_name ||
        storedData.storeName ||
        "StockNBook";

    const branchName =
        hydratedUser?.branch_name ||
        storedData.branchName ||
        "";

    const ownerName =
        hydratedUser?.owner_name ||
        storedData.ownerName ||
        storeName ||
        "Owner";

    const managerName =
        hydratedUser?.manager_name ||
        storedData.managerName ||
        "Manager";

    const staffName =
        hydratedUser?.staff_name ||
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

    /*
     * A module is accessible (shows up in navigation) as long as the
     * owner did not set it to "none" — both "full" and "view" grant
     * entry, the page itself is responsible for read-only behavior
     * when the level is "view".
     */
    const getAccessLevel = (
        permission: string,
    ): AccessLevel => {
        if (role === "owner") {
            return "full";
        }

        return permissions[permission] || "none";
    };

    const canAccess = (
        permission: string,
    ) => getAccessLevel(permission) !== "none";

    // Managers receive Analytics and Forecasting by default when no
    // per-manager permission has been configured. Explicit "none" still wins.
    // The effective subscription plan separately controls the lock icon and
    // the feature/API gates continue to enforce paid-plan eligibility.
    const hasExplicitPermission = (permission: string) =>
        Object.prototype.hasOwnProperty.call(permissions, permission);

    const canViewAnalytics =
        role === "owner" ||
        canAccess("analytics") ||
        (role === "manager" && !hasExplicitPermission("analytics"));

    const canViewForecasting =
        role === "owner" ||
        canAccess("forecasting") ||
        (role === "manager" && !hasExplicitPermission("forecasting"));

    const canViewSettings =
        role === "owner" ||
        role === "manager" ||
        role === "staff";

    const handleLogout = () => {
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = "/";
    };

    return (
        <>
            {/* Navigation remains visible on phones without taking up page width. */}
            <header className="fixed inset-x-0 top-0 z-[25] flex h-14 items-center gap-3 border-b border-[#422B64] bg-[#1E1035] px-3 text-white shadow-sm lg:hidden">
                <button
                    type="button"
                    onClick={() => setMobileMenuOpen(true)}
                    aria-label="Open navigation menu"
                    aria-controls="stocknbook-business-navigation"
                    aria-expanded={mobileMenuOpen}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                >
                    <Menu size={21} />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight">Stock<span className="text-[#E2A61A]">N</span>Book</p>
                    <p className="truncate text-[11px] text-white/65">{storeName}</p>
                </div>
            </header>
            {mobileMenuOpen && (
                <button
                    type="button"
                    aria-label="Close navigation menu"
                    className="fixed inset-0 z-[30] bg-[#140B24]/65 lg:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}
            <aside
                id="stocknbook-business-navigation"
                data-stocknbook-sidebar
                aria-label="Business navigation"
                className={`fixed inset-y-0 left-0 z-[35] flex max-h-dvh w-[min(85vw,280px)] shrink-0 flex-col overflow-y-auto bg-[#1E1035] font-sans text-white shadow-[2px_0_12px_rgba(19,8,44,0.10)] transition-transform duration-200 lg:static lg:z-auto lg:min-h-screen lg:max-h-none lg:w-[216px] lg:translate-x-0 lg:overflow-y-visible ${mobileMenuOpen ? "visible translate-x-0" : "invisible -translate-x-full lg:visible"}`}
            >
                <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label="Close navigation"
                    className="absolute right-2 top-5 flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8C15B] lg:hidden"
                >
                    <X size={19} />
                </button>
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
                <nav className="px-2.5 py-3" onClickCapture={() => setMobileMenuOpen(false)}>
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
                                        locked:
                                        analyticsLocked,
                                        lockTitle:
                                            analyticsLocked
                                                ? `${planFeatures.planName} plan does not include Analytics`
                                                : undefined,
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
                                        locked:
                                        forecastingLocked,
                                        lockTitle:
                                            forecastingLocked
                                                ? `${planFeatures.planName} plan does not include Forecasting`
                                                : undefined,
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

                    {/* Every role can view the store's current plan and usage.
                 * Only the owner can manage billing, submit payment proof, or upgrade. */}
                    <SidebarSection label="System">
                        <NavItem
                            pathname={pathname}
                            item={{
                                label: role === "owner" ? "Subscription" : "Plan & Usage",
                                href: "/subscription",
                                icon: CreditCard,
                            }}
                        />

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
        </>
    );
}