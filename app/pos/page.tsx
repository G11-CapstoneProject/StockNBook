"use client";

import RequirePermission from "@/components/permissions/RequirePermission";
import OwnerPOS from "@/components/pos/OwnerPOS";
import ManagerPOS from "@/components/pos/ManagerPOS";
import StaffPOS from "@/components/pos/StaffPOS";
import { usePOS } from "@/hooks/usePOS";

export default function POSPage() {
  const pos = usePOS();

  return (
      <RequirePermission permission="pos">
        {pos.isOwner ? (
            <OwnerPOS pos={pos} />
        ) : pos.role === "manager" ? (
            <ManagerPOS pos={pos} />
        ) : (
            <StaffPOS pos={pos} />
        )}
      </RequirePermission>
  );
}