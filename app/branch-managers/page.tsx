"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Manager = {
    id?: string | number;
    name: string;
    email?: string;
    branch: string;
    status: string;
};

export default function ManagerDirectoryPage() {
    const router = useRouter();

    const [managers, setManagers] = useState<Manager[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    const loadManagers = async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/branch-managers", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await res.json();

            if (!res.ok) {
                console.warn("Failed to load branch managers:", data);
                setManagers([]);
                return;
            }

            setManagers(data.managers || []);
        } catch (error) {
            console.warn("Branch managers fetch failed:", error);
            setManagers([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadManagers();
    }, [router]);

    const handleDeactivateManager = async (
        managerId: number,
        managerName: string
    ) => {
        const confirmed = confirm(
            `Deactivate ${managerName}? This manager will no longer be able to access the branch account.`
        );

        if (!confirmed) return;

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/branch-managers", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    manager_id: managerId,
                    status: "inactive",
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || "Failed to deactivate manager.");
                return;
            }

            await loadManagers();
        } catch {
            alert("Something went wrong while deactivating manager.");
        }
    };

    const handleReactivateManager = async (
        managerId: number,
        managerName: string
    ) => {
        const confirmed = confirm(
            `Reactivate ${managerName}? This manager will be able to access the branch account again.`
        );

        if (!confirmed) return;

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/branch-managers", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    manager_id: managerId,
                    status: "active",
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || "Failed to reactivate manager.");
                return;
            }

            await loadManagers();
        } catch {
            alert("Something went wrong while reactivating manager.");
        }
    };

    const formatStatus = (status: string) => {
        if (status === "active") return "Active";
        if (status === "inactive") return "Inactive";
        return "Pending";
    };

    const getStatusClass = (status: string) => {
        if (status === "active") {
            return "bg-[#EAF3DE] text-[#27500A]";
        }

        if (status === "inactive") {
            return "bg-[#F3E7E3] text-[#993C1D]";
        }

        return "bg-[#FAEEDA] text-[#633806]";
    };
    const filteredManagers = managers.filter((manager) => {
        const keyword = searchTerm.toLowerCase().trim();

        if (!keyword) return true;

        return (
            manager.name.toLowerCase().includes(keyword) ||
            (manager.email || "").toLowerCase().includes(keyword) ||
            manager.branch.toLowerCase().includes(keyword) ||
            manager.status.toLowerCase().includes(keyword)
        );
    });

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
                            Branch Managers
                        </h1>

                        <span className="rounded-[6px] bg-[#FFFBF0] px-3 py-1 text-[11px] font-medium text-[#633806]">
                            All branches
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="rounded-[7px] border border-[#EBE4F0] bg-white px-5 py-2 text-[13px] text-[#7A6E88]">
                            {new Date().toLocaleDateString("en-US", {
                                month: "long",
                                year: "numeric",
                            })}
                        </span>

                        <button className="flex h-[40px] w-[40px] items-center justify-center rounded-[9px] border border-[#EBE4F0] bg-white text-[#C9951A]">
                            ●
                        </button>

                        <div className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[#C9951A] text-[14px] font-medium text-white">
                            YS
                        </div>
                    </div>
                </div>

                <section className="px-[18px] py-[22px]">
                    <div className="mb-5">
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search by manager name, email, branch, or status..."
                            className="h-[44px] w-full rounded-[10px] border border-[#EBE4F0] bg-white px-4 text-[15px] text-[#1A1220] outline-none placeholder:text-[#7A6E88] focus:border-[#2D1B4E]"
                        />
                    </div>

                    <div className="overflow-hidden rounded-[14px] border border-[#EBE4F0] bg-white">
                        <table className="w-full border-collapse">
                            <thead>
                            <tr className="border-b border-[#EBE4F0]">
                                <th className="px-5 py-4 text-left text-[13px] font-medium uppercase tracking-[0.14em] text-[#7A6E88]">
                                    Manager
                                </th>

                                <th className="px-5 py-4 text-left text-[13px] font-medium uppercase tracking-[0.14em] text-[#7A6E88]">
                                    Branch
                                </th>

                                <th className="px-5 py-4 text-left text-[13px] font-medium uppercase tracking-[0.14em] text-[#7A6E88]">
                                    Status
                                </th>

                                <th className="px-5 py-4 text-right text-[13px] font-medium uppercase tracking-[0.14em] text-[#7A6E88]">
                                    Actions
                                </th>
                            </tr>
                            </thead>

                            <tbody>
                            {loading ? (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-5 py-10 text-center text-[14px] text-[#7A6E88]"
                                    >
                                        Loading branch managers...
                                    </td>
                                </tr>
                            ) : filteredManagers.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-5 py-10 text-center text-[14px] text-[#7A6E88]"
                                    >
                                        No branch managers added yet.
                                    </td>
                                </tr>
                            ) : (
                                filteredManagers.map((manager, index) => {
                                    const status = String(
                                        manager.status || "pending"
                                    ).toLowerCase();

                                    return (
                                        <tr
                                            key={
                                                manager.id ||
                                                `${manager.name}-${index}`
                                            }
                                            className="border-b border-[#F5EEF6] last:border-b-0"
                                        >
                                            <td className="px-5 py-4">
                                                <p className="text-[16px] font-medium text-[#1A1220]">
                                                    {manager.name}
                                                </p>

                                                {manager.email && (
                                                    <p className="mt-1 text-[12px] text-[#7A6E88]">
                                                        {manager.email}
                                                    </p>
                                                )}
                                            </td>

                                            <td className="px-5 py-4 text-[16px] text-[#1A1220]">
                                                {manager.branch}
                                            </td>

                                            <td className="px-5 py-4">
                                                    <span
                                                        className={`rounded-[7px] px-3 py-1 text-[13px] font-medium ${getStatusClass(
                                                            status
                                                        )}`}
                                                    >
                                                        {formatStatus(status)}
                                                    </span>
                                            </td>

                                            <td className="px-5 py-4 text-right">
                                                {status === "inactive" ? (
                                                    <button
                                                        onClick={() =>
                                                            handleReactivateManager(
                                                                Number(manager.id),
                                                                manager.name
                                                            )
                                                        }
                                                        className="rounded-[8px] bg-[#2D1B4E] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
                                                    >
                                                        Reactivate
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() =>
                                                            handleDeactivateManager(
                                                                Number(manager.id),
                                                                manager.name
                                                            )
                                                        }
                                                        className="rounded-[8px] bg-[#993C1D] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
                                                    >
                                                        Deactivate
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    );
}

