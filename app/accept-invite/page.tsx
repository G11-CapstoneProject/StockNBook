"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Lock, Package } from "lucide-react";

function AcceptInviteContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleAcceptInvite = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!token) {
            alert("Missing invitation token.");
            return;
        }

        if (!password || !confirmPassword) {
            alert("Please enter and confirm your password.");
            return;
        }

        if (password !== confirmPassword) {
            alert("Passwords do not match.");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/invite", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "accept_manager_invite",
                    invite_token: token,
                    password,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || "Failed to accept invitation.");
                return;
            }

            alert("Manager account activated successfully!");
            router.push("/");
        } catch (error) {
            alert("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#FDFAF4] px-6 text-[#1A1220]">
            <div className="w-full max-w-md rounded-3xl border border-[#EBE4F0] bg-white p-8 shadow-sm">
                <div className="mb-8 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2D1B4E] text-[#C9951A]">
                        <Package className="h-5 w-5" />
                    </div>
                    <span className="text-lg font-semibold">
                        <span className="text-[#2D1B4E]">Stock</span>NBook
                    </span>
                </div>

                <h1 className="font-serif text-4xl text-[#1A1220]">
                    Accept invitation
                </h1>

                <p className="mt-3 text-sm leading-6 text-[#7A6E88]">
                    Create your password to activate your manager account.
                </p>

                <form onSubmit={handleAcceptInvite} className="mt-8 space-y-5">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Password</span>
                        <div className="flex items-center gap-3 rounded-lg border border-[#EBE4F0] bg-white px-4 py-3">
                            <Lock className="h-5 w-5 text-[#7A6E88]" />
                            <input
                                type="password"
                                placeholder="Create password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-transparent text-sm outline-none"
                            />
                        </div>
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">
                            Confirm password
                        </span>
                        <div className="flex items-center gap-3 rounded-lg border border-[#EBE4F0] bg-white px-4 py-3">
                            <Lock className="h-5 w-5 text-[#7A6E88]" />
                            <input
                                type="password"
                                placeholder="Repeat password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-transparent text-sm outline-none"
                            />
                        </div>
                    </label>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white disabled:opacity-60"
                    >
                        {loading ? "Activating..." : "Activate account"}
                    </button>
                </form>
            </div>
        </main>
    );
}

export default function AcceptInvitePage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <AcceptInviteContent />
        </Suspense>
    );
}

