"use client";

import type { UsePOSReturn } from "@/hooks/usePOS";
import { BranchPOSView } from "./ManagerPOS";

export default function StaffPOS({ pos }: { pos: UsePOSReturn }) {
    return <BranchPOSView pos={pos} />;
}