"use client";

import { useEffect, useMemo, useState } from "react";

type BranchFromApi = {
    id: number;
    branch_name: string;
    manager_name?: string;
    manager_status?: string;
};

type BranchRowData = {
    id: number;
    branch: string;
    manager: string;
    activePackages: number;
    inactivePackages: number;
    lastUpdated: string;
    status: string;
};

export default function OwnerPackages() {
    const [search, setSearch] = useState("");
    const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
    const [branches, setBranches] = useState<BranchFromApi[]>([]);
    const [packagesByBranch, setPackagesByBranch] = useState<Record<number, any[]>>({});

    function getToken() {
        return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
    }

    function peso(n: number) {
        return `₱${Number(n || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;
    }

    function formatText(value: string) {
        if (!value) return "";

        return value
            .toLowerCase()
            .split(" ")
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    }

    async function fetchBranches() {
        try {
            const res = await fetch("/api/branches", {
                headers: {
                    Authorization: `Bearer ${getToken()}`,
                },
            });

            const data = await res.json();
            const loadedBranches = data.branches || [];

            setBranches(loadedBranches);

            if (loadedBranches.length > 0) {
                setSelectedBranchId((prev) => prev || loadedBranches[0].id);

                loadedBranches.forEach((branch: BranchFromApi) => {
                    fetchPackagesForBranch(branch.id);
                });
            }
        } catch {
            setBranches([]);
        }
    }

    async function fetchPackagesForBranch(branch_id: number) {
        try {
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({
                    action: "get_packages",
                    branch_id,
                }),
            });

            const data = await res.json();

            setPackagesByBranch((prev) => ({
                ...prev,
                [branch_id]: data.packages || [],
            }));
        } catch {
            setPackagesByBranch((prev) => ({
                ...prev,
                [branch_id]: [],
            }));
        }
    }

    useEffect(() => {
        fetchBranches();
    }, []);

    const branchRows = useMemo(() => {
        return branches.map((branch) => {
            const branchPackages = packagesByBranch[branch.id] || [];
            const activePackages = branchPackages.filter((pkg) => pkg.status === "Active").length;
            const inactivePackages = branchPackages.filter((pkg) => pkg.status === "Inactive").length;

            return {
                id: branch.id,
                branch: branch.branch_name,
                manager: branch.manager_name || "—",
                activePackages,
                inactivePackages,
                lastUpdated: branchPackages.length > 0 ? "Updated" : "—",
                status: branchPackages.length > 0 ? "Ready" : "Needs setup",
            };
        });
    }, [branches, packagesByBranch]);

    const selectedBranch = branchRows.find((branch) => branch.id === selectedBranchId);
    const selectedPackages = selectedBranchId ? packagesByBranch[selectedBranchId] || [] : [];

    const filteredBranches = useMemo(() => {
        const q = search.trim().toLowerCase();

        return branchRows.filter(
            (branch) =>
                branch.branch.toLowerCase().includes(q) ||
                branch.manager.toLowerCase().includes(q) ||
                branch.status.toLowerCase().includes(q)
        );
    }, [search, branchRows]);

    return (
        <>
            <div className="flex h-[54px] items-center justify-between border-b border-[#EBE4F0] bg-white px-5">
                <div className="flex items-center gap-3">
                    <h1 className="text-[18px] font-medium text-[#1A1220]">
                        Packages
                    </h1>

                    <span className="rounded-[6px] bg-[#FFFBF0] px-3 py-1 text-[11px] font-medium text-[#633806]">
                        All branches
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="rounded-[7px] border border-[#EBE4F0] bg-white px-4 py-1.5 text-[11px] text-[#7A6E88]">
                        {new Date().toLocaleDateString("en-US", {
                            month: "long",
                            year: "numeric",
                        })}
                    </span>

                    <button className="flex h-[32px] w-[32px] items-center justify-center rounded-[7px] border border-[#EBE4F0] bg-white text-[12px] text-[#C9951A]">
                        ●
                    </button>

                    <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#C9951A] text-[12px] font-medium text-white">
                        YS
                    </div>
                </div>
            </div>

            <section className="p-5">
                <div className="space-y-3">
                    <div className="flex gap-3">
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search branch, manager, or status..."
                            className="h-[42px] flex-1 rounded-[10px] border border-[#EBE4F0] bg-white px-4 text-[12px] text-[#1A1220] placeholder:text-[#9B8EA8] outline-none transition focus:border-[#2D1B4E]"
                        />

                        <button className="h-[42px] rounded-[10px] border border-[#EBE4F0] bg-white px-4 text-[12px] font-semibold text-[#2D1B4E] transition hover:bg-[#EEE8F8]">
                            All status
                        </button>
                    </div>

                    <div className="grid grid-cols-[1.35fr_0.85fr] gap-3">
                        <Card className="min-h-[345px]">
                            <CardHeader
                                title="Branch Package Overview"
                                action={`${filteredBranches.length} branches`}
                            />

                            <div className="overflow-hidden rounded-[10px] border border-[#F5EEF6]">
                                <div className="grid grid-cols-[1.1fr_0.8fr_0.9fr_0.8fr_0.8fr_0.7fr] border-b border-[#F5EEF6] bg-[#FDFAF4] px-3 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#7A6E88]">
                                    <div>Branch</div>
                                    <div>Manager</div>
                                    <div>Packages</div>
                                    <div>Updated</div>
                                    <div>Status</div>
                                    <div></div>
                                </div>

                                {filteredBranches.map((branch) => (
                                    <BranchRow
                                        key={branch.id}
                                        branch={branch}
                                        selected={branch.id === selectedBranchId}
                                        onSelect={() => setSelectedBranchId(branch.id)}
                                    />
                                ))}
                            </div>
                        </Card>

                        <Card className="min-h-[345px]">
                            <CardHeader
                                title={selectedBranch?.branch || "Branch Packages"}
                                action="Package list"
                            />

                            {selectedPackages.length === 0 ? (
                                <div className="flex min-h-[245px] items-center justify-center rounded-[10px] bg-[#FDFAF4] px-4 text-center">
                                    <div>
                                        <p className="text-[12px] font-semibold text-[#1A1220]">
                                            No packages yet.
                                        </p>

                                        <p className="mt-1 text-[10px] leading-4 text-[#7A6E88]">
                                            This branch needs package setup from the assigned manager.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2.5">
                                    {selectedPackages.map((pkg) => (
                                        <PackagePreview
                                            key={pkg.id}
                                            name={formatText(pkg.name)}
                                            price={peso(pkg.package_price)}
                                            inclusions={
                                                pkg.inclusions && pkg.inclusions.length > 0
                                                    ? pkg.inclusions
                                                        .map(
                                                            (item: any) =>
                                                                `${formatText(item.productName)} × ${item.quantity}`
                                                        )
                                                        .join(", ")
                                                    : formatText(pkg.description || "No inclusions listed.")
                                            }
                                            status={formatText(pkg.status)}
                                        />
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>
                </div>
            </section>
        </>
    );
}

function Card({
                  children,
                  className = "",
              }: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`rounded-[12px] border border-[#EBE4F0] bg-white p-3.5 ${className}`}
        >
            {children}
        </div>
    );
}

function CardHeader({
                        title,
                        action,
                    }: {
    title: string;
    action?: string;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="whitespace-nowrap text-[14px] font-medium leading-none text-[#1A1220]">
                {title}
            </h2>

            {action && (
                <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold leading-none text-[#2D1B4E]">
                    {action}
                </span>
            )}
        </div>
    );
}

function BranchRow({
                       branch,
                       selected,
                       onSelect,
                   }: {
    branch: BranchRowData;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            onClick={onSelect}
            className={`grid w-full grid-cols-[1.1fr_0.8fr_0.9fr_0.8fr_0.8fr_0.7fr] items-center border-b border-[#F5EEF6] px-3 py-3 text-left text-[11px] transition last:border-b-0 ${
                selected ? "bg-[#FDFAF4]" : "bg-white hover:bg-[#FDFAF4]"
            }`}
        >
            <div className="font-semibold text-[#1A1220]">
                {branch.branch}
            </div>

            <div className="text-[#7A6E88]">
                {branch.manager}
            </div>

            <div>
                <p className="font-semibold text-[#2D1B4E]">
                    {branch.activePackages} active
                </p>
                <p className="text-[9px] text-[#7A6E88]">
                    {branch.inactivePackages} inactive
                </p>
            </div>

            <div className="text-[#7A6E88]">
                {branch.lastUpdated}
            </div>

            <div>
                <StatusBadge status={branch.status} />
            </div>

            <div className="text-right text-[10px] font-semibold text-[#2D1B4E]">
                View →
            </div>
        </button>
    );
}

function PackagePreview({
                            name,
                            price,
                            inclusions,
                            status,
                        }: {
    name: string;
    price: string;
    inclusions: string;
    status: string;
}) {
    return (
        <div className="rounded-[10px] border border-[#F5EEF6] bg-[#FDFAF4] px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[12px] font-semibold text-[#1A1220]">
                        {name}
                    </p>

                    <p className="mt-0.5 text-[9.5px] leading-4 text-[#7A6E88]">
                        {inclusions}
                    </p>
                </div>

                <div className="shrink-0 text-right">
                    <p className="text-[12px] font-semibold text-[#2D1B4E]">
                        {price}
                    </p>

                    <StatusBadge status={status} />
                </div>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const ready = status === "Ready" || status === "Active";

    return (
        <span
            className={`inline-flex rounded-[6px] px-2.5 py-1 text-[9.5px] font-semibold ${
                ready
                    ? "bg-[#EAF3DE] text-[#27500A]"
                    : "bg-[#FAEEDA] text-[#633806]"
            }`}
        >
            {status}
        </span>
    );
}

