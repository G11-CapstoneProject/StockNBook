"use client";

import * as React from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SuccessToast } from "./_shared";
import {
    AlertTriangle, CalendarClock, ClipboardCheck, ClipboardList, Eye, CalendarDays,
    PackageCheck, PackageSearch, Search, Sparkles, Truck, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useStaffRentalInventory, type StaffRentalAllocation, type StaffRentalAction, type StaffRentalEquipmentSchedule, type StaffRentalEquipmentCalendar } from "@/hooks/useRentalInventory";

const panel = "min-w-0 overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const action = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50";
const primary = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-xs font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50";
const th = "truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
// Match the Manager rental inventory's compact, colored table action buttons.
const viewAction = "inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-[#F1EBFF] px-2.5 py-1.5 text-[11px] font-semibold text-[#5330B6] hover:bg-[#EAE0FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5330B6]";
const scheduleAction = "inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-[#EAF1FF] px-2.5 py-1.5 text-[11px] font-semibold text-[#2D539D] hover:bg-[#DCE8FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D539D]";
const issueAction = "inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-[#FFF0F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#C52C45] hover:bg-[#FFE2E6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C52C45] disabled:cursor-not-allowed disabled:opacity-40";
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function shiftRentalMonth(month: string, offset: number) {
    const [year,number]=month.split("-").map(Number);
    return new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);
}

type TaskType = "prepare" | "release" | "return" | "inspect" | "clean" | "damage";

// Customer information is read from the existing branch-scoped rental workspace.
// Older API responses remain compatible, but cannot show a customer name/type.
type BookingQueueAllocation = StaffRentalAllocation & {
    clientName?: string | null;
    bookingType?: string | null;
    packageName?: string | null;
    eventDate?: string | null;
    eventTime?: string | null;
    depositRequired?: number | null;
    depositCollected?: number | null;
    bookingStatus?: string | null;
};
type BookingQueueItem = { item: StaffRentalAllocation; type: TaskType | null };
type BookingQueueGroup = {
    reference: string;
    clientName: string;
    bookingType: string;
    packageName: string;
    bookingStatus: string;
    scheduleDate: string;
    returnDate: string;
    eventTime: string;
    tasks: BookingQueueItem[];
};
const taskLabel: Record<TaskType, string> = {
    prepare: "Mark Prepared", release: "Release", return: "Receive Return",
    inspect: "Finalize Recorded Return", clean: "Mark Cleaned", damage: "Damage Reported",
};
// Keep operational state separate from the action the Staff will perform next.
const taskStatusLabel: Partial<Record<TaskType, string>> = {
    prepare: "Needs Preparation", release: "Prepared", return: "Out on Rental", inspect: "Previous Return Pending",
};
// These are transaction stages, not editable equipment statuses. Only the next valid
// operation is shown; the backend validates every transition and stock quantity.
const workflowStages = ["Prepare", "Release", "Receive Return", "Equipment care if needed"] as const;
const stageForTask: Record<Exclude<TaskType, "damage">, number> = {
    prepare: 0, release: 1, return: 2, inspect: 2, clean: 3,
};
const taskHelp: Record<TaskType, string> = {
    prepare: "Confirm equipment has been checked and gathered for this booking. This does not mark it as rented out.",
    release: "Confirm physical handover to the customer. Only then will Out on Rental increase.",
    return: "Record missing or damaged units; verify routine care, or defer condition checking until later.",
    inspect: "One-time closeout of a previously recorded return; reuses the original damaged quantity and notes without entering them again.",
    clean: "Finish the cleaning task from the equipment View details. Cleaned units return to Available; damaged units stay on hold.",
    damage: "Damaged equipment remains on hold until Staff confirms the repair and safety check.",
};
const taskToAction: Partial<Record<TaskType, StaffRentalAction>> = {
    prepare: "prepare_rental_allocation", release: "release_rental_allocation",
    return: "return_rental_allocation", inspect: "inspect_rental_allocation", clean: "clean_rental_allocation",
};
function taskType(a: StaffRentalAllocation): TaskType | null {
    if (a.status === "reserved") return a.preparedAt ? "release" : "prepare";
    if (a.status === "checked_out") return "return";
    if (a.status === "returned") {
        if (a.inspectionStatus === "pending") return "inspect";
        if (a.inspectionStatus === "cleaning") return "clean";
        if (a.inspectionStatus === "damaged") return "damage";
    }
    return null;
}
function manilaDate(date: Date = new Date()) {
    const bits = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Manila",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(date);
    const get = (type: string) => bits.find(x=>x.type===type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}
// Prioritize today's scheduled bookings, then the most recent past dates, and
// finally upcoming dates (nearest first). Keep date strings in YYYY-MM-DD form.
function compareQueueEventDates(first: string, second: string, today: string): number {
    const bucket = (date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 3 :
        date === today ? 0 : date < today ? 1 : 2;
    const difference = bucket(first) - bucket(second);
    if (difference) return difference;
    if (bucket(first) === 1) return second.localeCompare(first);
    return first.localeCompare(second);
}

function queueScheduleDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
    return new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
    });
}
function queueBookingType(raw: string) {
    const label = raw.trim();
    if (!label) return "Booking type unavailable";
    if (label.toLowerCase().includes("custom")) return "Custom Inventory Booking";
    if (label.toLowerCase().includes("package")) return "Package Booking";
    return label;
}
// The queue displays the booking lifecycle status, not the equipment allocation status.
// Match the labels and badge colors used in Manager Bookings; no workflow changes.
function queueBookingStatus(value?: string | null) {
    const raw=String(value||"").trim();
    switch(raw.toLowerCase()) {
        case "pending": case "pending review": return "Pending Review";
        case "approved": case "awaiting down payment": case "waiting down payment":
        case "awaiting payment": case "down payment required": return "Approved";
        case "confirmed": return "Confirmed";
        case "preparing": return "Preparing";
        case "released": return "Released";
        case "return inspection": return "Return Inspection";
        case "pending settlement": return "Pending Settlement";
        case "completed": return "Completed";
        case "cancelled": case "canceled": return "Cancelled";
        default: return raw || "—";
    }
}
const queueBookingStatusStyles: Record<string,string> = {
    "Pending Review": "text-[#A56607]",
    "Approved": "text-[#A56607]",
    "Confirmed": "text-[#1D4ED8]",
    "Preparing": "text-[#4E2C66]",
    "Released": "text-[#1D4ED8]",
    "Return Inspection": "text-[#A56607]",
    "Pending Settlement": "text-[#A56607]",
    "Completed": "text-[#138342]",
    "Cancelled": "text-[#C32F2F]",
};
// Match the existing local timestamp display when checking whether a movement happened today.
function rentalActivityManilaDate(value: string): string {
    const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "+08:00");
    return Number.isNaN(parsed.getTime()) ? "" : manilaDate(parsed);
}
// Use the same two-line PH date/time display and movement labels as Manager rental activity.
function dateTime(s?: string | null): {date: string; time: string} {
    if (!s) return {date: "—", time: ""};
    const parsed = new Date(s.includes("T") ? s : s.replace(" ", "T") + "+08:00");
    if (Number.isNaN(parsed.getTime())) return {date: s, time: ""};
    return {
        date: parsed.toLocaleDateString("en-PH", {timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric"}),
        time: parsed.toLocaleTimeString("en-PH", {timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit"}),
    };
}
const staffActivityLabels: Record<string, string> = {
    received: "Stock Received", rented_out: "Rented Out", returned: "Returned",
    maintenance_started: "Maintenance", maintenance_completed: "Repair Completed",
    missing_reported: "Missing", missing_resolved: "Found", missing_replaced: "Replaced",
    adjustment: "Stock Adjustment", prepared: "Prepared", inspected: "Inspected",
    cleaned: "Cleaned", damage_reported: "Damage Reported",
};
// Prepared/inspected/damage-reported events document work, not physical stock changes.
const staffPositiveMovements = new Set(["received", "returned", "maintenance_completed", "missing_resolved", "missing_replaced", "cleaned"]);
const staffNegativeMovements = new Set(["rented_out", "maintenance_started", "missing_reported"]);
function Header({ icon, title, subtitle, right }: {icon:React.ReactNode;title:string;subtitle:string;right?:React.ReactNode}) {
    return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]">{icon}</span>
            <div><h3 className="text-[15px] font-bold text-[#21132E]">{title}</h3><p className="text-[11px] text-[#86778F]">{subtitle}</p></div></div>{right}
    </div>;
}
function Empty({children}:{children:React.ReactNode}) {
    return <div className="flex min-h-28 flex-col items-center justify-center gap-2 p-5 text-center text-xs text-[#806A8C]"><PackageSearch size={22}/>{children}</div>;
}
export default function StaffRentalInventory({branchName}:{branchName:string}) {
    const rental=useStaffRentalInventory();
    const {user}=useCurrentUser();
    const inventoryPermission=user?.permissions?.inventory_access ?? user?.permissions?.inventory;
    // UI-only courtesy: the Rental Lambda separately enforces current DB grants.
    const canOperate=inventoryPermission===true || inventoryPermission==="true" || inventoryPermission==="full";
    const [search,setSearch]=React.useState("");
    const [taskFilter,setTaskFilter]=React.useState<"all" | "prepare" | "release" | "return" | "inspect">("all");
    const [selectedQueueReference,setSelectedQueueReference]=React.useState<string|null>(null);
    const [bookingOperation,setBookingOperation]=React.useState<"release"|"return"|null>(null);
    const [bookingReturnMissing,setBookingReturnMissing]=React.useState<Record<number,string>>({});
    const [bookingReturnDamaged,setBookingReturnDamaged]=React.useState<Record<number,string>>({});
    const [returnConditionChecked,setReturnConditionChecked]=React.useState(false);
    const [bookingOperationNotes,setBookingOperationNotes]=React.useState("");
    const [bookingOperationError,setBookingOperationError]=React.useState("");
    const [careFilter,setCareFilter]=React.useState<"all"|"inspection"|"cleaning"|"routine"|"repairs"|"missing">("all");
    const [rentalProductFilter,setRentalProductFilter]=React.useState("all");
    const [selected,setSelected]=React.useState<StaffRentalAllocation|null>(null);
    const [viewEquipment,setViewEquipment]=React.useState<number|null>(null);
    const [scheduleEquipmentId,setScheduleEquipmentId]=React.useState<number|null>(null);
    const [scheduleDate,setScheduleDate]=React.useState(manilaDate);
    const [scheduleMonth,setScheduleMonth]=React.useState(()=>manilaDate().slice(0,7));
    const [calendar,setCalendar]=React.useState<StaffRentalEquipmentCalendar|null>(null);
    const [calendarLoading,setCalendarLoading]=React.useState(false);
    const [calendarError,setCalendarError]=React.useState("");
    const [schedule,setSchedule]=React.useState<StaffRentalEquipmentSchedule|null>(null);
    const [scheduleError,setScheduleError]=React.useState("");
    const [scheduleLoading,setScheduleLoading]=React.useState(false);
    const [returnMissing,setReturnMissing]=React.useState("0");
    const [notes,setNotes]=React.useState("");
    const [submitError,setSubmitError]=React.useState("");
    const [notice,setNotice]=React.useState("");
    const closeStaffRentalToast = React.useCallback(() => setNotice(""), []);
    const [confirmRecordedReturn,setConfirmRecordedReturn]=React.useState<StaffRentalAllocation|null>(null);
    const [stockTask,setStockTask]=React.useState<
        {kind:"issue";id:number;label:string;max:number;bookingReference?:string} |
        {kind:"complete";id:number;label:string;max:number} |
        {kind:"replace";id:number;label:string;max:number} |
        {kind:"routine";id:number;label:string;max:number} | null>(null);
    const [stockQuantity,setStockQuantity]=React.useState("");
    const [stockNotes,setStockNotes]=React.useState("");
    const [stockSafetyChecked,setStockSafetyChecked]=React.useState(false);
    const [issueType,setIssueType]=React.useState<"routine"|"damage"|"missing">("damage");
    const today=manilaDate();
    const todayRentalActivity=rental.activity.filter(event=>rentalActivityManilaDate(event.occurredAt)===today);
    const equipmentById=React.useMemo(()=>new Map(rental.equipment.map(e=>[e.id,e])),[rental.equipment]);
    const allTasks=React.useMemo(()=>rental.allocations.map(a=>({item:a,type:taskType(a)})).filter(x=>x.type!==null),[rental.allocations]);
    const inspectionTasks=allTasks.filter(x=>x.type==="inspect");
    const inspection=inspectionTasks.length;
    const inspectionUnits=inspectionTasks.reduce((sum,x)=>sum+(x.item.returnedReceivedUnits??x.item.quantity),0);
    // Earlier returns awaiting their one-time condition check also hold stock.
    // Show the SAME pending allocation in Equipment Care (not a duplicate task
    // or new maintenance record) so every genuine hold has a visible action.
    const careTasks=React.useMemo(()=>[
        ...rental.allocations.filter(a=>taskType(a)==="inspect").map(a=>({
            key:`inspection-${a.allocationId}`,
            kind:"inspection" as const,
            equipmentId:a.equipmentId,
            equipmentName:a.equipmentName,
            units:a.returnedReceivedUnits??a.quantity,
            reference:a.bookingReference,
            allocation:a,
        })),
        ...rental.allocations.filter(a=>taskType(a)==="clean").map(a=>({
            key:`booking-${a.allocationId}`,
            kind:"cleaning" as const,
            equipmentId:a.equipmentId,
            equipmentName:a.equipmentName,
            units:a.cleaningUnits>0?a.cleaningUnits:a.quantity,
            reference:a.bookingReference,
            allocation:a,
        })),
        ...rental.maintenanceTasks.map(t=>({
            key:`maintenance-${t.id}`,
            kind:t.conditionStatus==="Routine"?"routine" as const:"repairs" as const,
            equipmentId:t.equipmentId,
            equipmentName:t.equipmentName,
            units:t.units,
            reference:`MNT-${String(t.id).padStart(6,"0")}`,
            maintenance:t,
        })),
    ],[rental.allocations,rental.maintenanceTasks]);
    // Explain holds without counting damage twice: damaged inspection units are
    // represented by rental_maintenance_records. A residual means another hold
    // exists or the capped workspace did not return every underlying record.
    const holdBreakdown=React.useMemo(()=>{
        const breakdown=new Map<number,{inspection:number;cleaning:number;routine:number;repairs:number}>();
        const get=(id:number)=>{
            if(!breakdown.has(id))breakdown.set(id,{inspection:0,cleaning:0,routine:0,repairs:0});
            return breakdown.get(id)!;
        };
        for(const a of rental.allocations){
            if(a.status!=="returned")continue;
            if(a.inspectionStatus==="pending")get(a.equipmentId).inspection+=a.returnedReceivedUnits??a.quantity;
            else if(a.inspectionStatus==="cleaning")get(a.equipmentId).cleaning+=a.cleaningUnits;
        }
        for(const task of rental.maintenanceTasks){
            if(task.conditionStatus==="Routine")get(task.equipmentId).routine+=task.units;
            else get(task.equipmentId).repairs+=task.units;
        }
        return breakdown;
    },[rental.allocations,rental.maintenanceTasks]);
    const openSchedule=(equipmentId:number)=>{
        setScheduleDate(today);setScheduleMonth(today.slice(0,7));setSchedule(null);setScheduleError("");
        setCalendar(null);setCalendarError("");setScheduleEquipmentId(equipmentId);
    };
    const navigateScheduleMonth=(offset:number)=>{
        const next=shiftRentalMonth(scheduleMonth,offset);
        if(next<today.slice(0,7))return;
        setScheduleMonth(next);
        setScheduleDate(next===today.slice(0,7)?today:`${next}-01`);
    };
    const calendarCells=React.useMemo(()=>{
        const [year,number]=scheduleMonth.split("-").map(Number);
        const firstWeekday=new Date(Date.UTC(year,number-1,1)).getUTCDay();
        const days=new Date(Date.UTC(year,number,0)).getUTCDate();
        const slots=Math.ceil((firstWeekday+days)/7)*7;
        return Array.from({length:slots},(_,index)=>{
            const day=index-firstWeekday+1;
            return day>=1&&day<=days?`${scheduleMonth}-${String(day).padStart(2,"0")}`:null;
        });
    },[scheduleMonth]);
    const calendarMarked=React.useMemo(()=>new Map((calendar?.days||[]).map(day=>[day.date,day])),[calendar]);
    React.useEffect(()=>{
        if(scheduleEquipmentId===null)return;
        const abort=new AbortController();
        setScheduleLoading(true);setSchedule(null);setScheduleError("");
        void rental.getEquipmentSchedule(scheduleEquipmentId,scheduleDate,abort.signal).then(data=>{
            if(!abort.signal.aborted)setSchedule(data);
        }).catch(error=>{
            if(!abort.signal.aborted)setScheduleError(error instanceof Error?error.message:"Unable to load equipment schedule.");
        }).finally(()=>{if(!abort.signal.aborted)setScheduleLoading(false);});
        return ()=>abort.abort();
    },[scheduleEquipmentId,scheduleDate,rental.getEquipmentSchedule]);
    React.useEffect(()=>{
        if(scheduleEquipmentId===null)return;
        const abort=new AbortController();
        setCalendar(null);setCalendarError("");setCalendarLoading(true);
        void rental.getEquipmentCalendar(scheduleEquipmentId,scheduleMonth,abort.signal).then(data=>{
            if(!abort.signal.aborted)setCalendar(data);
        }).catch(error=>{
            if(!abort.signal.aborted)setCalendarError(error instanceof Error?error.message:"Unable to load calendar dates.");
        }).finally(()=>{if(!abort.signal.aborted)setCalendarLoading(false);});
        return ()=>abort.abort();
    },[scheduleEquipmentId,scheduleMonth,rental.getEquipmentCalendar]);
    // Count the Equipment Care rows (like Previous Returns); units are shown in the caption.
    const cleaningTasks=careTasks.filter(t=>t.kind==="cleaning");
    const cleaning=cleaningTasks.length;
    const cleaningUnits=cleaningTasks.reduce((sum,t)=>sum+t.units,0);
    // Missing rows are report-scoped so replacement cannot accidentally change
    // a different booking's unresolved equipment or its customer claim.
    const missingCareTasks=rental.missingReports.map(report=>({
        key:`missing-report-${report.id}`,kind:"missing" as const,
        equipmentId:report.equipmentId,equipmentName:report.equipmentName,units:report.remainingUnits,
        reference:report.bookingReference||`MISS-${String(report.id).padStart(6,"0")}`,
        report,
    }));
    const visibleCareTasks=[...careTasks,...missingCareTasks].filter(task=>
        careFilter==="all"||task.kind===careFilter);

    const bookingTasks=allTasks.filter(x=>x.type!=="clean"&&x.type!=="damage");
    // Show ONE row per booking. Keep every equipment line's existing workflow action
    // in the selected booking checklist; no mutation or allocation logic changes.
    const bookingGroups=React.useMemo(()=>{
        const groups=new Map<string,BookingQueueGroup>();
        bookingTasks.forEach(task=>{
            const item=task.item as BookingQueueAllocation;
            const reference=item.bookingReference;
            let group=groups.get(reference);
            if(!group){
                group={reference,clientName:item.clientName?.trim()||"Customer name unavailable",
                    bookingType:queueBookingType(item.bookingType||""),
                    packageName:item.packageName?.trim()||"",
                    bookingStatus:item.bookingStatus?.trim()||"",
                    scheduleDate:item.eventDate||item.startDate,
                    returnDate:item.endDate,eventTime:item.eventTime?.trim()||"",tasks:[]};
                groups.set(reference,group);
            }
            group.tasks.push(task);
        });
        return Array.from(groups.values()).sort((left,right)=>
            compareQueueEventDates(left.scheduleDate,right.scheduleDate,today) || left.reference.localeCompare(right.reference));
    },[bookingTasks,today]);
    // Release and return are booking-wide, so these KPIs count the same booking rows as the queue.
    // Ready = every equipment line prepared and the rental start date reached.
    const readyBookings=bookingGroups.filter(group=>group.tasks.length>0&&
        group.tasks.every(x=>x.type==="release"&&x.item.startDate<=today));
    const ready=readyBookings.length;
    const readyUnits=readyBookings.reduce((sum,group)=>sum+group.tasks.reduce((s,x)=>s+x.item.quantity,0),0);
    const dueReturnTasks=(group:BookingQueueGroup)=>group.tasks.filter(x=>x.type==="return"&&x.item.endDate<=today);
    const returnBookings=bookingGroups.filter(group=>dueReturnTasks(group).length>0);
    const forReturn=returnBookings.length;
    const returnUnits=returnBookings.reduce((sum,group)=>sum+dueReturnTasks(group).reduce((s,x)=>s+x.item.quantity,0),0);
    // Filter booking rows by their matching individual task; the selected checklist
    // still shows ALL currently actionable equipment for that booking.
    const queueQuery=search.trim().toLowerCase();
    const visibleBookingGroups=bookingGroups.filter(group=>{
        const text=[group.reference,group.clientName,group.bookingType,group.packageName,
            ...group.tasks.flatMap(x=>[x.item.equipmentName,x.item.equipmentNumber])].join(" ").toLowerCase();
        return text.includes(queueQuery)&&group.tasks.some(x=>taskFilter==="all"||taskFilter===x.type);
    });
    const selectedQueueBooking=visibleBookingGroups.find(group=>group.reference===selectedQueueReference)||null;
    const selectedQueuePayment=selectedQueueBooking?.tasks[0]?.item as BookingQueueAllocation | undefined;
    const selectedQueuePaid=!!selectedQueuePayment&&Number.isFinite(selectedQueuePayment.bookingTotal)
        &&Number.isFinite(selectedQueuePayment.amountPaid)&&Number.isFinite(selectedQueuePayment.bookingBalance)
        &&selectedQueuePayment.bookingTotal>0&&selectedQueuePayment.amountPaid+0.005>=selectedQueuePayment.bookingTotal
        &&selectedQueuePayment.bookingBalance<=0.005;
    // Missing financial terms fail closed: do not enable handover using only booking payments.
    const selectedQueueDepositSettled=!!selectedQueuePayment &&
        selectedQueuePayment.depositRequired != null && selectedQueuePayment.depositCollected != null &&
        Number.isFinite(Number(selectedQueuePayment.depositRequired)) &&
        Number.isFinite(Number(selectedQueuePayment.depositCollected)) &&
        Number(selectedQueuePayment.depositRequired)>=0 && Number(selectedQueuePayment.depositCollected)>=0 &&
        Number(selectedQueuePayment.depositCollected)+0.005>=Number(selectedQueuePayment.depositRequired);
    React.useEffect(()=>{
        if(!selectedQueueReference)return;
        const onKeyDown=(event:KeyboardEvent)=>{
            if(event.key==="Escape"&&!selected&&!stockTask&&!bookingOperation&&!rental.saving)setSelectedQueueReference(null);
        };
        window.addEventListener("keydown",onKeyDown);
        return ()=>window.removeEventListener("keydown",onKeyDown);
    },[selectedQueueReference,selected,stockTask,bookingOperation,rental.saving]);
    const queueAllReserved=!!selectedQueueBooking&&selectedQueueBooking.tasks.length>0&&
        selectedQueueBooking.tasks.every(x=>x.type==="prepare"||x.type==="release");
    const queueAllPrepared=queueAllReserved&&selectedQueueBooking!.tasks.every(x=>x.type==="release");
    const queueAllOut=!!selectedQueueBooking&&selectedQueueBooking.tasks.length>0&&
        selectedQueueBooking.tasks.every(x=>x.type==="return");
    const queueReleaseDateValid=!!selectedQueueBooking&&selectedQueueBooking.tasks.every(x=>x.item.startDate<=today);
    const queueReleaseReady=queueAllPrepared&&selectedQueuePaid&&selectedQueueDepositSettled&&queueReleaseDateValid&&canOperate&&!rental.saving;
    const startBookingOperation=(kind:"release"|"return")=>{
        if(!selectedQueueBooking)return;
        setBookingOperation(kind);setBookingOperationError("");setBookingOperationNotes("");
        setBookingReturnMissing(Object.fromEntries(selectedQueueBooking.tasks.map(x=>[x.item.allocationId,"0"])));
        setBookingReturnDamaged(Object.fromEntries(selectedQueueBooking.tasks.map(x=>[x.item.allocationId,"0"])));
        setReturnConditionChecked(false);
    };
    const performBookingOperation=async()=>{
        if(!selectedQueueBooking||!bookingOperation||rental.saving)return;
        setBookingOperationError("");
        try {
            if(bookingOperation==="release") {
                if(!queueReleaseReady)throw new Error("All items must be prepared, the booking balance and security deposit settled, and the scheduled release date reached.");
                await rental.actBooking({action:"release_rental_booking",bookingReference:selectedQueueBooking.reference});
                setNotice(`All rental equipment released for ${selectedQueueBooking.reference}.`);
            } else {
                if(!queueAllOut||!canOperate)throw new Error("The booking must be fully out on rental before receiving all items.");
                const returns=selectedQueueBooking.tasks.map(x=>({
                    allocationId:x.item.allocationId,
                    missingUnits:Number(bookingReturnMissing[x.item.allocationId]??""),
                    // Confirmed immediately when Staff finishes the condition check; otherwise deferred.
                    damagedUnitsObserved:Number(bookingReturnDamaged[x.item.allocationId]??"")
                }));
                if(returns.some((line,i)=>{
                    const missingRaw=bookingReturnMissing[line.allocationId];
                    const damagedRaw=bookingReturnDamaged[line.allocationId];
                    return missingRaw==null||missingRaw.trim()===""||damagedRaw==null||damagedRaw.trim()===""||
                        !Number.isSafeInteger(line.missingUnits)||!Number.isSafeInteger(line.damagedUnitsObserved)||
                        line.missingUnits<0||line.damagedUnitsObserved<0||
                        line.missingUnits+line.damagedUnitsObserved>selectedQueueBooking.tasks[i].item.quantity;
                }))throw new Error("Enter valid missing and observed damaged quantities; together they cannot exceed the booked quantity.");
                if(returns.some(x=>x.missingUnits>0||x.damagedUnitsObserved>0)&&bookingOperationNotes.trim().length<5)
                    throw new Error("Describe missing or damaged equipment (at least five characters).");
                if(!returnConditionChecked)
                    throw new Error("Confirm you checked the returned units and completed necessary routine care before recording the return.");
                await rental.actBooking({action:"return_rental_booking",bookingReference:selectedQueueBooking.reference,
                    returns,notes:bookingOperationNotes.trim(),conditionChecked:true,inspectionDeferred:false});
                setNotice(`Rental return and condition check recorded for ${selectedQueueBooking.reference}. Damaged units are on hold until Staff verifies repair and safe reuse.`);
            }
            setBookingOperation(null);setBookingOperationNotes("");
        } catch(error) {
            setBookingOperationError(error instanceof Error?error.message:"Unable to process this booking.");
        }
    };
    const rentalProductNames=[...new Set(rental.equipment.map(e=>e.name))].sort();
    const visibleEquipment=rental.equipment.filter(e=>[e.name,e.category,e.equipmentNumber,...(e.unitNumbers||[])].join(" ").toLowerCase().includes(search.trim().toLowerCase())&&(rentalProductFilter==="all"||e.name===rentalProductFilter));
    const selectedEquipment=rental.equipment.find(e=>e.id===viewEquipment);
    const openRentalAction=(item:StaffRentalAllocation)=>{
        if(taskType(item)==="release"||taskType(item)==="return")return;
        setSelected(item);setSubmitError("");setReturnMissing("0");
        setNotes("");
    };
    // Compatibility for returns already awaiting the former second inspection.
    // The original Staff report is retained; a one-time confirmation releases
    // only non-damaged units and creates at most one Manager damage case.
    const finalizeRecordedReturn=async(item:StaffRentalAllocation)=>{
        if(!canOperate||rental.saving||taskType(item)!=="inspect")return;
        setConfirmRecordedReturn(null);
        setSubmitError("");setNotice("");
        try{
            await rental.act("inspect_rental_allocation",item.allocationId,{useRecordedReturn:true});
            setNotice(`Previous return finalized for ${item.bookingReference}. Existing damage notes were retained.`);
        }catch(error){setNotice("");setSubmitError(error instanceof Error?error.message:"Unable to finalize the previous return.");}
    };
    const reportIssueBeforeRelease=(allocation:StaffRentalAllocation)=>{
        if(!canOperate)return;
        const equipment=equipmentById.get(allocation.equipmentId);
        if(!equipment){setSubmitError("Equipment could not be loaded. Refresh and try again.");return;}
        const physicallyAvailable=Math.max(0,equipment.totalUnits-equipment.rentedOutUnits-
            equipment.maintenanceUnits-equipment.missingUnits);
        if(physicallyAvailable<1){
            setSubmitError("No physically available units can be flagged. Ask the Manager to resolve the shortage.");
            return;
        }
        setSelected(null);
        startStockTask({kind:"issue",id:equipment.id,label:equipment.name,max:physicallyAvailable,
            bookingReference:allocation.bookingReference});
    };
    const perform=async()=>{
        if(!canOperate) {setSubmitError("Full Inventory access is required for rental operations.");return;}
        if(!selected)return;
        const kind=taskType(selected);
        const apiAction=kind&&taskToAction[kind];
        if(!apiAction)return;
        if(kind==="release"||kind==="return"){
            setSubmitError("Use the booking-level Release Booking / Receive Booking Return action.");return;
        }
        setSubmitError("");setNotice("");
        try {
            // Previously returned equipment is finalized using the recorded return,
            // not by re-entering damaged counts or notes in a second dialog.
            if(kind==="inspect")throw new Error("Use Finalize Recorded Return in the booking checklist.");
            await rental.act(apiAction,selected.allocationId,{notes:notes.trim()});
            setNotice(`${taskLabel[kind]} recorded for ${selected.bookingReference}.`);
            setSelected(null);setNotes("");
        } catch(error) {setSubmitError(error instanceof Error?error.message:"Unable to save rental action.");}
    };
    const startStockTask=(task:NonNullable<typeof stockTask>)=>{
        if(!canOperate)return;
        setStockTask(task);setStockQuantity("1");setStockNotes("");setStockSafetyChecked(false);setIssueType("damage");setSubmitError("");
    };
    const performStock=async()=>{
        if(!canOperate){setSubmitError("Full Inventory access is required for equipment condition tasks.");return;}
        if(!stockTask)return;
        const quantity=Number(stockQuantity);
        if(!Number.isSafeInteger(quantity)||quantity<1||quantity>stockTask.max){
            setSubmitError(`Enter 1–${stockTask.max} units.`);return;
        }
        if(stockNotes.trim().length<(stockTask.kind==="complete"||stockTask.kind==="replace"?10:5)){
            setSubmitError("Enter repair or replacement details (at least 10 characters).");return;
        }
        if((stockTask.kind==="complete"||stockTask.kind==="replace")&&!stockSafetyChecked){
            setSubmitError("Confirm the physical inspection and safe condition of every usable unit.");return;
        }
        setSubmitError("");setNotice("");
        try {
            if(stockTask.kind==="issue")await rental.actStock({action:"staff_report_equipment_issue",equipmentId:stockTask.id,quantity,
                reason:stockTask.bookingReference?`Booking ${stockTask.bookingReference}: ${stockNotes.trim()}`:stockNotes.trim(),issueType});
            else if(stockTask.kind==="routine")await rental.actStock({action:"staff_complete_routine_maintenance",maintenanceId:stockTask.id,quantity,notes:stockNotes.trim()});
            else if(stockTask.kind==="replace")await rental.actStock({action:"staff_mark_missing_replaced",reportId:stockTask.id,quantity,notes:stockNotes.trim(),conditionChecked:true,replacementNotPreviouslyReceived:true});
            else await rental.actStock({action:"staff_mark_repaired_ready",maintenanceId:stockTask.id,quantity,notes:stockNotes.trim(),safetyChecked:true});
            setNotice(stockTask.kind==="issue"?(issueType==="routine"?"Routine-care task created. Staff can complete it without Manager approval.":
                    "Equipment flagged unavailable. The booking remains pending preparation; available stock will be rechecked on release."):
                stockTask.kind==="routine"?"Routine care completed. The units are now available again.":
                    stockTask.kind==="replace"?`${quantity} missing unit(s) replaced and verified ready. The unresolved missing count was reduced; customer charges and deposit settlement are unchanged.`:
                        "Verified repaired units returned to Available. Customer settlement is unchanged.");
            setStockTask(null);
        } catch(error){setSubmitError(error instanceof Error?error.message:"Unable to save rental operation.");}
    };
    return <div className="space-y-4" aria-label="Staff Rental Inventory">
        {!canOperate&&<p role="status" className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-xs text-[#5330B6]">View-only Inventory access: equipment activity is visible, but receiving, rental handover, returns, and condition changes require Full access.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            {title:"Ready for Release",num:ready,caption:`${readyUnits} units prepared for handover`,icon:<Truck size={19}/>},
            {title:"For Return Today / Overdue",num:forReturn,caption:`${returnUnits} units due back`,icon:<CalendarClock size={19}/>},
            {title:"Previous Returns To Finalize",num:inspection,caption:`${inspectionUnits} previously returned units on hold`,icon:<ClipboardCheck size={19}/>},
            {title:"Needs Cleaning",num:cleaning,caption:`${cleaningUnits} units held until cleaning is recorded`,icon:<Sparkles size={19}/>},
        ].map(c=>(
            <div key={c.title} aria-busy={rental.loading} className="flex min-h-[146px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm">
                {rental.loading ? <>
                    <span className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-[#EEE8F3]" aria-hidden="true"/>
                    <span className="min-w-0 flex-1 space-y-2.5" role="status" aria-label={`Loading ${c.title}`}>
                        <span className="block h-3.5 w-32 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                        <span className="block h-7 w-24 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                        <span className="block h-2.5 w-40 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                    </span>
                </> : <>
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#F1EBFF] text-[#5A35A5]" aria-hidden="true">{c.icon}</span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{c.title}</span>
                        <span className="mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1A1220] tabular-nums">{rental.connected ? c.num.toLocaleString("en-PH") : "—"}</span>
                        <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{rental.connected ? c.caption : "Rental data unavailable"}</span>
                    </span>
                </>}
            </div>
        ))}</div>
        <section className={`${panel} flex h-[340px] min-h-0 flex-col`}>
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="shrink-0 rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]"><ClipboardList size={18}/></span>
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-bold text-[#21132E]">Rental Operations Queue</h3>
                        <p className="text-[11px] leading-4 text-[#86778F]">Review a booking, prepare each item, then release or receive the complete order</p>
                    </div>
                </div>
                <select aria-label="Filter rental tasks" value={taskFilter}
                        onChange={e=>setTaskFilter(e.target.value as typeof taskFilter)}
                        className="h-9 w-[104px] shrink-0 rounded-xl border border-[#E6DDF0] bg-white px-2 text-[11px] font-semibold text-[#2B174C] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:border-[#E6DDF0]">
                    <option value="all">All Tasks</option>
                    <option value="prepare">Prepare</option>
                    <option value="release">Release</option>
                    <option value="return">Returns</option>
                    <option value="inspect">Previous Returns</option>
                </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" role="region" aria-label="Rental operations bookings" tabIndex={0}>
                <table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                    <colgroup><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/></colgroup>
                    <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>{["Client / Booking Ref","Schedule","Booking Type","Status","Action"].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead>
                    <tbody>{visibleBookingGroups.slice(0,50).map(group=>{
                        const active=selectedQueueReference===group.reference;
                        const open=()=>setSelectedQueueReference(group.reference);
                        return <tr key={group.reference} tabIndex={0} aria-selected={active}
                                   onClick={open} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();open();}}}
                                   className={`cursor-pointer border-t border-[#F0EAF4] text-[#2B174C] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] ${active?"":"hover:bg-[#FCF9FF]"}`}>
                            <td className={`py-2 text-left align-middle ${active?"border-l-4 border-[#6F3FD3] px-3":"px-4"}`}>
                                <span className="block break-words font-semibold">{group.clientName}</span>
                                <span className="mt-1 block break-all text-[10px] text-[#806A8C]">{group.reference}</span>
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                                <span className="block font-medium">{queueScheduleDate(group.scheduleDate)}</span>
                                {group.eventTime&&<span className="mt-1 block text-[10px] text-[#806A8C]">{group.eventTime}</span>}
                                {group.returnDate!==group.scheduleDate&&<span className="mt-1 block text-[10px] text-[#806A8C]">Return: {queueScheduleDate(group.returnDate)}</span>}
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                                <span className="block break-words font-medium">{group.bookingType}</span>
                                <span className="mt-1 block text-[10px] text-[#806A8C]">{group.tasks.length} equipment {group.tasks.length===1?"line":"lines"}</span>
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                                    <span className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 break-words ${queueBookingStatusStyles[queueBookingStatus(group.bookingStatus)]||"text-[#2B174C]"}`}>
                                        {queueBookingStatus(group.bookingStatus)}
                                    </span>
                            </td>
                            <td className="px-2 py-2 align-middle text-center">
                                <button type="button" aria-haspopup="dialog"
                                        onClick={e=>{e.stopPropagation();open();}}
                                        className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] cursor-pointer">
                                    View Items
                                </button>
                            </td>
                        </tr>;
                    })}</tbody>
                </table>
                {rental.connected&&visibleBookingGroups.length===0&&<Empty>No matching booking tasks. Select All Tasks, or confirm a booking with rental equipment.</Empty>}
                {visibleBookingGroups.length>50&&<p className="border-t border-[#F0EAF4] px-3 py-2 text-[11px] text-[#806A8C]">Showing the first 50 bookings. Use the search or filters to find another booking.</p>}
            </div>
        </section>
        {rental.error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Rental operations unavailable: {rental.error} <button type="button" className="underline" onClick={()=>void rental.refresh(true)}>Retry</button></p>}
        <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-2">
            {/* Reinstated using the original purple/white table design; operations reuse existing rental actions. */}
            <section className={`${panel} flex h-[340px] min-h-0 flex-col`} aria-label="Equipment Care and Maintenance">
                <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="shrink-0 rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]"><ClipboardCheck size={18}/></span>
                        <div className="min-w-0">
                            <h3 className="text-[15px] font-bold text-[#21132E]">Equipment Care &amp; Maintenance</h3>
                            <p className="text-[11px] leading-4 text-[#86778F]">Finalize older return inspections, repair equipment, and track missing items.</p>
                        </div>
                    </div>
                    <select aria-label="Filter equipment care tasks" value={careFilter}
                            onChange={e=>setCareFilter(e.target.value as typeof careFilter)}
                            className="h-9 w-[118px] shrink-0 cursor-pointer rounded-xl border border-[#E6DDF0] bg-white px-2 text-[11px] font-semibold text-[#2B174C] outline-none focus:border-[#D2BCEC]">
                        <option value="all">All Tasks</option>
                        <option value="inspection">Inspections</option>
                        <option value="cleaning">Cleaning</option>
                        <option value="routine">Routine Care</option>
                        <option value="repairs">Repairs</option>
                        <option value="missing">Missing</option>
                    </select>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" role="region" aria-label="Equipment care and maintenance tasks" tabIndex={0}>
                    <table className="w-full min-w-0 table-fixed text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <colgroup><col className="w-[24%]"/><col className="w-[31%]"/><col className="w-[9%]"/><col className="w-[17%]"/><col className="w-[19%]"/></colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>
                            {['Equipment','Work Item / Reference','Units','Status','Action'].map(h=><th key={h} className={th}>{h}</th>)}
                        </tr></thead>
                        <tbody>{visibleCareTasks.map(task=><tr key={task.key} className="border-t border-[#F0EAF4] text-[#2B174C]">
                            <td className="py-2 align-middle font-medium px-4 text-left">{task.equipmentName}</td>
                            <td className="px-2 py-2 align-middle">
                                <div className="font-medium">{task.kind==="inspection"?'Finalize previous return inspection':
                                    task.kind==="cleaning"?'Clean returned equipment':
                                        task.kind==="routine"?'Routine cleaning / upkeep':
                                            task.kind==="repairs"?'Repair / safety review':'Missing equipment investigation'}</div>
                                <div className="mx-auto mt-1 max-w-[220px] break-all text-[10px] text-[#86778F]">{task.reference}</div>
                                {task.kind==="inspection"&&task.allocation.inspectionNotes&&
                                    <p title={task.allocation.inspectionNotes} className="mt-1 line-clamp-2 break-words text-[10px] text-[#806A8C]">{task.allocation.inspectionNotes}</p>}
                                {(task.kind==="routine"||task.kind==="repairs")&&task.maintenance.reason&&
                                    <p title={task.maintenance.reason} className="mt-1 line-clamp-2 break-words text-[10px] text-[#806A8C]">{task.maintenance.reason}</p>}
                                {task.kind==="missing"&&task.report.reason&&
                                    <p title={task.report.reason} className="mt-1 line-clamp-2 break-words text-[10px] text-[#806A8C]">{task.report.reason}</p>}
                            </td>
                            <td className="px-2 py-2 text-center align-middle font-semibold tabular-nums">{task.units}</td>
                            <td className="px-2 py-2 text-center align-middle">
                                {task.kind==="inspection"?<span className="break-words text-[10px] font-semibold text-[#C27416]">Pending Inspection</span>:
                                    task.kind==="cleaning"?<span className="break-words text-[10px] font-semibold text-[#C27416]">Needs Cleaning</span>:
                                        task.kind==="routine"?<span className="break-words text-[10px] font-semibold text-[#5330B6]">Routine Care</span>:
                                            task.kind==="missing"?<span className="break-words text-[10px] font-semibold text-[#A43D48]">Missing</span>:
                                                <span className="break-words text-[10px] font-semibold text-[#A43D48]">Damaged</span>}
                            </td>
                            <td className="px-2 py-2 align-middle text-center">
                                {task.kind==="inspection"?
                                    <button type="button" className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOperate||rental.saving}
                                            onClick={()=>setConfirmRecordedReturn(task.allocation)}>Finalize Return</button>:
                                    task.kind==="cleaning"?
                                        <button type="button" className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOperate||rental.saving}
                                                onClick={()=>openRentalAction(task.allocation)}>Mark Cleaned</button>:
                                        task.kind==="routine"?
                                            <button type="button" className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOperate||rental.saving||task.units<1}
                                                    onClick={()=>startStockTask({kind:'routine',id:task.maintenance.id,label:task.equipmentName,max:task.units})}>Mark Care Done</button>:
                                            task.kind==="missing"?
                                                <button type="button" className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOperate||rental.saving||task.units<1}
                                                        onClick={()=>startStockTask({kind:'replace',id:task.report.id,label:task.equipmentName,max:task.units})}>Mark Replaced</button>:
                                                <button type="button" className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOperate||rental.saving||task.units<1}
                                                        onClick={()=>startStockTask({kind:'complete',id:task.maintenance.id,label:task.equipmentName,max:task.units})}>Mark Repaired</button>}
                            </td>
                        </tr>)}</tbody>
                    </table>
                    {rental.connected&&visibleCareTasks.length===0&&<Empty>{careFilter==='all'?
                        'No pending inspections, care, repair, or missing-equipment tasks.':'No matching equipment care tasks.'}</Empty>}
                </div>
            </section>
            <section className="flex h-[340px] min-h-0 flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm">
                <div className="flex items-start gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                        <CalendarClock size={18}/>
                    </span>
                    <div>
                        <h2 className="text-[15px] font-bold text-[#21132E]">Today's Rental Stock Activity</h2>
                        <p className="mt-0.5 text-[11px] text-[#86778F]">Equipment receipts, rental movements, and repairs recorded today.</p>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" role="region" aria-label="Today's rental stock activity" tabIndex={0}>
                    <table className="w-full min-w-0 table-fixed text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <colgroup><col className="w-[16%]"/><col className="w-[30%]"/><col className="w-[18%]"/><col className="w-[9%]"/><col className="w-[27%]"/></colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase text-[#806A8C]">
                        <tr className="border-b border-[#E9E1EE]">
                            <th className="truncate px-2 py-2 font-semibold text-center text-[10px] uppercase tracking-normal text-[#806A8C]">Date &amp; Time</th>
                            <th className="truncate px-2 py-2 font-semibold text-center text-[10px] uppercase tracking-normal text-[#806A8C]">Equipment</th>
                            <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Activity</th>
                            <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Qty</th>
                            <th className="truncate px-2 py-2 font-semibold text-center text-[10px] uppercase tracking-normal text-[#806A8C]">Reference No.</th>
                        </tr>
                        </thead>
                        <tbody>
                        {todayRentalActivity.map(event => {
                            const when = dateTime(event.occurredAt);
                            const positive = staffPositiveMovements.has(event.type);
                            const negative = staffNegativeMovements.has(event.type);
                            const label = staffActivityLabels[event.type] || event.type.replaceAll("_", " ");
                            return <tr key={event.id} className="border-b border-[#EFE8F2] last:border-0">
                                <td className="whitespace-nowrap py-2 text-[#5F4E75] px-4 text-left">
                                    {when.date}
                                    {when.time && <div className="mt-0.5 text-[10px] text-[#8A7D90]">{when.time}</div>}
                                </td>
                                <td className="px-2 py-2 font-semibold text-[#2B174C]">{event.equipmentName}</td>
                                <td className={`px-2 py-2 text-center font-medium ${positive ? "text-[#23834A]" : negative ? "text-[#D92C3F]" : "text-[#5F4E75]"}`}>{label}</td>
                                <td className={`px-2 py-2 text-center font-semibold ${positive ? "text-[#23834A]" : negative ? "text-[#D92C3F]" : "text-[#4F3A5A]"}`}>
                                    {positive ? "+" : negative ? "−" : ""}{Math.abs(event.quantity)}
                                </td>
                                <td className="break-all px-2 py-2 text-[#5F4E75]">{event.referenceNumber || "—"}</td>
                            </tr>;
                        })}
                        </tbody>
                    </table>
                    {rental.connected && todayRentalActivity.length === 0 && <Empty>No rental stock movements recorded today.</Empty>}
                </div>
            </section>
        </div>
        <section className={panel}><Header icon={<PackageCheck size={18}/>} title="Branch Rental Equipment List" subtitle={`Daily rental availability · ${branchName}`}
                                           right={<select className={action} aria-label="Filter rental product" value={rentalProductFilter} onChange={e=>setRentalProductFilter(e.target.value)}><option value="all">All Rental Products</option>{rentalProductNames.map(name=><option key={name} value={name}>{name}</option>)}</select>}/>
            <div className="border-b border-[#E9E1EE] px-4 py-3">
                <div className="w-full">
                    <label className="relative min-w-0"><span className="sr-only">Search rental equipment or booking</span>
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                        <input className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]" placeholder="Search equipment or booking..." value={search} onChange={e=>setSearch(e.target.value)}/>
                    </label>
                </div>
            </div>
            <div className="max-h-[360px] w-full overflow-y-auto overflow-x-hidden overscroll-contain border-t border-[#E9E1EE]" role="region" aria-label="Branch rental equipment list" tabIndex={0}>
                <table className="w-full min-w-0 table-fixed text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                    <colgroup><col className="w-[10%]"/><col className="w-[20%]"/><col className="w-[8%]"/><col className="w-[9%]"/><col className="w-[8%]"/><col className="w-[7.5%]"/><col className="w-[10%]"/><col className="w-[27.5%]"/></colgroup>
                    <thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase tracking-wide text-[#806A8C]">
                    <tr className="border-b border-[#E9E1EE]">
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Equipment No.</th>
                        <th className="truncate px-2 py-2 font-semibold text-center text-[10px] uppercase tracking-normal text-[#806A8C]">Rental Product</th>
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Total Units</th>
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Available Today</th>
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Rented Out</th>
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">On Hold</th>
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Availability</th>
                        <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Action</th>
                    </tr>
                    </thead>
                    <tbody>{visibleEquipment.map(e=>{
                        const readyNow=Math.max(0,e.totalUnits-e.rentedOutUnits-e.maintenanceUnits-e.missingUnits);
                        const maximumUsable=Math.max(0,e.totalUnits-e.maintenanceUnits-e.missingUnits);
                        const availability=e.bookableToday<=0?(maximumUsable>0?'Fully Booked':'Unavailable'):e.alertLevel>0&&e.bookableToday<=e.alertLevel?'Low Availability':e.bookableToday===e.totalUnits&&e.maintenanceUnits===0&&e.missingUnits===0?'Fully Available':'Available';
                        const availabilityColor=availability==='Fully Available'||availability==='Available'?'text-[#23834A]':availability==='Low Availability'?'text-[#A66A00]':'text-[#D92C3F]';
                        return <tr key={e.id} className="h-12 border-b border-[#EFE8F2] text-[#2B174C] last:border-0 hover:bg-[#FFFCF8]">
                            <td className="break-all py-2 px-4 text-left font-mono text-[9px] font-semibold text-[#5F4E75] xl:text-[10px]">{e.equipmentNumber||'—'}</td>
                            <td className="px-2 py-2 font-semibold">{e.name}</td>
                            <td className="px-2 py-2 text-center font-semibold">{e.totalUnits}</td>
                            <td className="px-2 py-2 text-center font-semibold" title="Available today after overlapping confirmed reservations, not just physically ready units">{e.bookableToday}</td>
                            <td className="px-2 py-2 text-center">{e.rentedOutUnits}</td>
                            <td className="px-2 py-2 text-center" title={`On Hold: ${holdBreakdown.get(e.id)?.inspection??0} inspection, ${holdBreakdown.get(e.id)?.cleaning??0} cleaning, ${holdBreakdown.get(e.id)?.routine??0} routine care, ${holdBreakdown.get(e.id)?.repairs??0} repair. Outstanding missing units: ${e.missingUnits}.`}>
                                <span>{e.maintenanceUnits}</span>
                                {e.missingUnits > 0 && <span className="mt-1 block whitespace-nowrap text-[10px] font-semibold text-[#B45309]">Missing: {e.missingUnits}</span>}
                            </td>
                            <td className="px-2 py-2 text-center"><span className={`inline-block text-[10px] font-semibold ${availabilityColor}`}>{availability}</span></td>
                            <td className="px-2 py-2 text-center"><div className="flex flex-wrap items-center justify-center gap-1.5">
                                <button type="button" className={viewAction} onClick={()=>setViewEquipment(e.id)}><Eye size={13}/> View</button>
                                <button type="button" className={scheduleAction} onClick={()=>openSchedule(e.id)}><CalendarDays size={13}/> View Schedule</button>
                                <button type="button" className={issueAction} disabled={!canOperate||readyNow<=0}
                                        onClick={()=>startStockTask({kind:'issue',id:e.id,label:e.name,max:readyNow})}><AlertTriangle size={13}/> Report Issue</button>
                            </div></td>
                        </tr>;
                    })}</tbody>
                </table>
                {rental.connected&&visibleEquipment.length===0&&<Empty>No rental equipment found in this branch.</Empty>}
            </div>
        </section>
        {/* Only the queue presentation changes: equipment actions still use their existing confirmation dialogs and API. */}
        {selectedQueueBooking && <div role="presentation" className="fixed inset-0 z-[80] flex items-center justify-center bg-[#21132E]/55 p-4"
                                      onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving)setSelectedQueueReference(null);}}>
            <section role="dialog" aria-modal="true" aria-labelledby="staff-rental-queue-dialog-title"
                     className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-xl">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-5 py-4">
                    <div className="min-w-0">
                        <h3 id="staff-rental-queue-dialog-title" className="text-lg font-bold text-[#21132E]">Equipment for this Booking</h3>
                        <p className="mt-1 break-all text-xs text-[#806A8C]">{selectedQueueBooking.reference}</p>
                    </div>
                    <button type="button" aria-label="Close equipment checklist" className={`${action} h-9 px-3`}
                            onClick={()=>setSelectedQueueReference(null)}><X size={16}/> Close</button>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">Client</p>
                                <p className="mt-1 break-words text-sm font-semibold text-[#21132E]">{selectedQueueBooking.clientName}</p></div>
                            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">Schedule</p>
                                <p className="mt-1 text-sm font-semibold text-[#21132E]">{queueScheduleDate(selectedQueueBooking.scheduleDate)}{selectedQueueBooking.eventTime?` · ${selectedQueueBooking.eventTime}`:""}</p>
                                {selectedQueueBooking.returnDate!==selectedQueueBooking.scheduleDate&&
                                    <p className="mt-1 text-xs text-[#806A8C]">Return: {queueScheduleDate(selectedQueueBooking.returnDate)}</p>}</div>
                            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">Booking Type</p>
                                <p className="mt-1 text-sm font-semibold text-[#21132E]">{selectedQueueBooking.bookingType}</p>
                                {selectedQueueBooking.packageName&&<p className="mt-1 text-xs text-[#806A8C]">{selectedQueueBooking.packageName}</p>}</div>
                        </div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-[#E6DDF0]">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3">
                            <div>
                                <h4 className="text-sm font-bold text-[#21132E]">Rental Equipment Checklist</h4>
                                <p className="mt-1 text-[11px] text-[#806A8C]">{selectedQueueBooking.tasks.length} equipment {selectedQueueBooking.tasks.length===1?"line":"lines"} · {selectedQueueBooking.tasks.reduce((sum,x)=>sum+x.item.quantity,0)} booked units</p>
                                <p className="mt-1 text-[11px] text-[#806A8C]">{selectedQueueBooking.tasks.filter(x=>x.type!=="prepare").length} of {selectedQueueBooking.tasks.length} equipment lines prepared or further along</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${selectedQueuePaid && selectedQueueDepositSettled ? "bg-[#E5F7ED] text-[#218246]" : "bg-[#FFF3D8] text-[#986408]"}`}>
                                {!selectedQueuePaid ? (selectedQueuePayment && Number.isFinite(selectedQueuePayment.bookingBalance) ? "Booking Balance Pending" : "Payment Unavailable")
                                    : !selectedQueueDepositSettled ? "Security Deposit Pending" : "Fully Settled"}
                            </span>
                        </div>
                        <div className="max-h-[320px] min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain">
                            <table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                                <colgroup><col className="w-[39%]"/><col className="w-[11%]"/><col className="w-[23%]"/><col className="w-[27%]"/></colgroup>
                                <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>{["Equipment","Qty","Status","Action"].map(h=><th key={h} className={th}>{h}</th>)}</tr></thead>
                                <tbody>{selectedQueueBooking.tasks.map(({item,type})=>{
                                    const perItemAction=type==="prepare"||type==="inspect";
                                    const nextLabel=type==="release"?"Ready for booking release":
                                        type==="return"?"Include in booking return":taskLabel[type||"prepare"];
                                    return <tr key={item.allocationId} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                        <td className="break-words py-2 font-medium px-4 text-left">{item.equipmentName}</td>
                                        <td className="px-2 py-2 text-center font-semibold tabular-nums">{item.quantity}</td>
                                        <td className={`px-2 py-2 text-center text-[10px] font-semibold ${type==="release"?"text-[#23834A]":type==="return"?"text-[#1D4ED8]":type==="damage"?"text-[#D92C3F]":"text-[#A56607]"}`}>{taskStatusLabel[type||"prepare"]||taskLabel[type||"prepare"]}</td>
                                        <td className="px-2 py-2 text-center">
                                            {perItemAction?<button type="button" className={`${action} h-auto min-h-9 w-full break-words px-2 py-1.5 text-[11px]`}
                                                                   disabled={!canOperate||rental.saving} title={taskHelp[type||"prepare"]}
                                                                   onClick={()=>type==="inspect"?setConfirmRecordedReturn(item):openRentalAction(item)}>{taskLabel[type||"prepare"]}</button>:
                                                <span className="text-[11px] text-[#806A8C]">{nextLabel}</span>}
                                        </td>
                                    </tr>;
                                })}</tbody>
                            </table>
                        </div>
                        {submitError&&<p role="alert" className="border-t border-[#F0EAF4] bg-red-50 px-4 py-2 text-xs text-red-700">{submitError}</p>}
                        {queueAllReserved&&<div className="space-y-2 border-t border-[#F0EAF4] px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-[#2B174C]">Release the complete booking</p>
                                    <p className="mt-1 text-[11px] text-[#806A8C]">All equipment must be prepared; the booking balance and any agreed security deposit must be fully paid, and the release date must be reached.</p>
                                </div>
                                <button type="button" className={`${primary} disabled:cursor-not-allowed disabled:opacity-40`}
                                        disabled={!queueReleaseReady} onClick={()=>startBookingOperation("release")}>Release Booking</button>
                            </div>
                            {!queueAllPrepared&&<p className="text-[11px] text-[#986408]">Prepare every equipment line before releasing the booking.</p>}
                            {queueAllPrepared&&!selectedQueuePaid&&<p className="text-[11px] text-[#986408]">Full payment has not been recorded; Release Booking remains disabled.</p>}
                            {queueAllPrepared&&selectedQueuePaid&&!selectedQueueDepositSettled&&<p className="text-[11px] text-[#986408]">The agreed refundable security deposit is unpaid or cannot be verified; release remains disabled.</p>}
                            {queueAllPrepared&&selectedQueuePaid&&selectedQueueDepositSettled&&!queueReleaseDateValid&&<p className="text-[11px] text-[#986408]">Release is available on or after the scheduled rental start date.</p>}
                        </div>}
                        {queueAllOut&&<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EAF4] px-4 py-3">
                            <p className="text-xs text-[#5A476A]">Receive all booked equipment in one return transaction, with missing quantities recorded separately.</p>
                            <button type="button" className={primary} disabled={!canOperate||rental.saving}
                                    onClick={()=>startBookingOperation("return")}>Receive Booking Return</button>
                        </div>}
                        {!queueAllReserved&&!queueAllOut&&selectedQueueBooking.tasks.some(x=>x.type==="return")&&
                            <p className="border-t border-[#F0EAF4] px-4 py-3 text-[11px] text-[#986408]">This booking has mixed rental stages from an older partial handover. Ask the Manager to reconcile it before a booking-wide return.</p>}
                    </div>
                    <p className="px-4 py-2 text-[11px] text-[#806A8C]">Prepare and release equipment by booking. On return, Staff records missing/damaged units and confirms the condition check once. Only damaged units remain on hold until Staff verifies their repair. Older returns have a one-time closeout action.</p>
                </div>
                <div className="flex justify-end border-t border-[#E9E1EE] px-5 py-3">
                    <button type="button" className={`${action} h-9 px-4`} onClick={()=>setSelectedQueueReference(null)}>Close</button>
                </div>
            </section>
        </div>}
        {bookingOperation&&selectedQueueBooking&&<div role="presentation" className="fixed inset-0 z-[95] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4"
                                                      onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving)setBookingOperation(null);}}>
            <section role="alertdialog" aria-modal="true" aria-label={bookingOperation==="release"?"Confirm complete booking release":"Receive complete booking return"}
                     className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                    <div><h3 className="text-lg font-bold text-[#21132E]">{bookingOperation==="release"?"Release Booking":"Receive Booking Return"}</h3>
                        <p className="mt-1 break-all text-xs text-[#806A8C]">{selectedQueueBooking.reference}</p></div>
                    <button type="button" className={action} disabled={rental.saving} onClick={()=>setBookingOperation(null)}><X size={16}/> Close</button>
                </div>
                {bookingOperation==="release"?<div className="rounded-xl bg-[#F7F3FC] p-3 text-xs text-[#5A476A]">
                    Confirm the complete physical handover of <strong>{selectedQueueBooking.tasks.reduce((sum,x)=>sum+x.item.quantity,0)} units</strong> across {selectedQueueBooking.tasks.length} equipment lines. All must be ready and the booking fully paid. This updates each rental allocation together.
                </div>:<>
                    <p className="text-xs text-[#5A476A]">Record only missing or damaged quantities. Zero means no issue was reported. Staff checks the returned units and completes necessary routine care before confirming this return. Customer charges always require Manager review.</p>
                    <div className="space-y-2">{selectedQueueBooking.tasks.map(({item})=>{
                        const missing=Number(bookingReturnMissing[item.allocationId]??"0");
                        const observedDamage=Number(bookingReturnDamaged[item.allocationId]??"0");
                        const received=Number.isSafeInteger(missing)&&missing>=0?Math.max(0,item.quantity-missing):null;
                        return <div key={item.allocationId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] p-3 text-xs">
                            <span className="min-w-[155px] flex-1"><strong className="block text-[#2B174C]">{item.equipmentName}</strong>
                                <span className="mt-1 block text-[#806A8C]">Booked: {item.quantity} units · Returned: {received??"—"}</span></span>
                            <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 font-semibold text-[#5A476A]">Missing
                                    <input type="number" min="0" max={item.quantity} step="1" required value={bookingReturnMissing[item.allocationId]??"0"}
                                           onChange={e=>setBookingReturnMissing(prev=>({...prev,[item.allocationId]:e.target.value}))}
                                           disabled={rental.saving} className="w-16 rounded-lg border border-[#E6DDF0] p-2 text-sm"/></label>
                                <label className="flex items-center gap-2 font-semibold text-[#5A476A]">Damaged
                                    <input type="number" min="0" max={received??item.quantity} step="1" required value={bookingReturnDamaged[item.allocationId]??"0"}
                                           onChange={e=>setBookingReturnDamaged(prev=>({...prev,[item.allocationId]:e.target.value}))}
                                           disabled={rental.saving} className="w-16 rounded-lg border border-[#E6DDF0] p-2 text-sm"/></label>
                            </div>
                            {Number.isSafeInteger(missing)&&Number.isSafeInteger(observedDamage)&&missing+observedDamage>item.quantity&&
                                <p role="alert" className="w-full text-red-700">Missing + damaged cannot exceed {item.quantity} units.</p>}
                        </div>;
                    })}</div>
                    <label className="block text-xs font-semibold text-[#2B174C]">Return notes (required if anything is missing or visibly damaged)
                        <textarea rows={3} maxLength={400} value={bookingOperationNotes} onChange={e=>setBookingOperationNotes(e.target.value)}
                                  disabled={rental.saving} className="mt-2 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm" placeholder="Describe missing units, visible damage or return details..."/></label>
                    <div className="space-y-2 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs text-[#4F3A5A]">
                        <label className="flex items-start gap-2"><input type="checkbox" checked={returnConditionChecked}
                                                                         onChange={e=>setReturnConditionChecked(e.target.checked)} disabled={rental.saving} className="mt-0.5"/>
                            <span><strong>I checked the returned items and completed necessary routine care for all units not reported damaged.</strong> Other returned units can now be rented again. Only damaged units remain On Hold.</span></label>
                    </div>
                    <p className="text-[11px] text-[#806A8C]">Missing items go to Manager investigation. Confirmed damage creates a Manager maintenance case, but customer billing still requires a separate Manager decision. No second inspection is needed when the condition check is completed here.</p>
                </>}
                {bookingOperationError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{bookingOperationError}</p>}
                <div className="flex justify-end gap-2 border-t border-[#E9E1EE] pt-3">
                    <button type="button" className={action} disabled={rental.saving} onClick={()=>setBookingOperation(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={rental.saving} onClick={()=>void performBookingOperation()}>
                        {rental.saving?"Saving...":bookingOperation==="release"?"Confirm Full Release":"Confirm Complete Return"}</button>
                </div>
            </section>
        </div>}
        {scheduleEquipmentId!==null&&<div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4"
                                          onMouseDown={e=>{if(e.target===e.currentTarget)setScheduleEquipmentId(null);}}>
            <section role="dialog" aria-modal="true" aria-label="Rental equipment booking schedule"
                     className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                    <div><h3 className="text-lg font-bold text-[#21132E]">View Equipment Schedule</h3>
                        <p className="text-xs text-[#86778F]">{equipmentById.get(scheduleEquipmentId)?.name||"Rental equipment"} · {branchName}</p></div>
                    <button type="button" aria-label="Close schedule" onClick={()=>setScheduleEquipmentId(null)}><X size={19}/></button>
                </div>
                <div className="rounded-xl border border-[#E6DDF0] p-3 sm:p-4" aria-label="Booking calendar">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <button type="button" className={`${action} h-9 w-9 p-0`} aria-label="Previous month"
                                disabled={scheduleMonth<=today.slice(0,7)} onClick={()=>navigateScheduleMonth(-1)}><ChevronLeft size={17}/></button>
                        <h4 className="text-sm font-bold text-[#2B174C]">{new Date(`${scheduleMonth}-01T12:00:00+08:00`).toLocaleDateString("en-PH",{month:"long",year:"numeric",timeZone:"Asia/Manila"})}</h4>
                        <button type="button" className={`${action} h-9 w-9 p-0`} aria-label="Next month"
                                onClick={()=>navigateScheduleMonth(1)}><ChevronRight size={17}/></button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                        {weekDays.map(day=><span key={day} className="py-1 font-semibold text-[#806A8C]">{day}</span>)}
                        {calendarCells.map((date,index)=>{
                            if(!date)return <span key={`empty-${index}`} aria-hidden="true"/>;
                            const marked=calendar?.month===scheduleMonth?calendarMarked.get(date):undefined;
                            const isSelected=scheduleDate===date;
                            const isPast=date<today;
                            return <button type="button" key={date} disabled={isPast} onClick={()=>setScheduleDate(date)}
                                           aria-label={`${queueScheduleDate(date)}${marked?`, ${marked.allocationCount} booked allocation(s)`:""}`}
                                           aria-pressed={isSelected} title={marked?`${marked.allocationCount} booking allocation(s) · ${marked.bookedUnits} units`:"No confirmed allocation"}
                                           className={`flex min-h-11 flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5330B6] ${isSelected
                                               ?"border-[#2B174C] bg-[#2B174C] text-white"
                                               :marked?"border-[#CEB9F3] bg-[#F1EBFF] text-[#5330B6] hover:bg-[#E5D9FF]"
                                                   :"border-transparent text-[#2B174C] hover:bg-[#F7F1FF]"} ${isPast?"cursor-not-allowed opacity-30":""}`}>
                                {Number(date.slice(-2))}
                                <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 rounded-full ${marked?(isSelected?"bg-white":"bg-[#7240CA]"):"bg-transparent"}`}/>
                            </button>;
                        })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#806A8C]">
                        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#7240CA]"/> Confirmed rental allocation</span>
                        <span>Click a date to view booking details below.</span>
                    </div>
                    {calendarLoading&&<p role="status" className="mt-2 text-xs text-[#806A8C]">Loading marked dates...</p>}
                    {calendarError&&<p role="alert" className="mt-2 text-xs text-red-700">{calendarError}</p>}
                </div>
                {scheduleLoading&&<p role="status" className="text-sm text-[#86778F]">Loading booking details for the selected day...</p>}
                {scheduleError&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{scheduleError}</p>}
                {schedule&&!scheduleLoading&&<>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {[
                            {title:"Total Owned",value:schedule.totalUnits},
                            {title:"Physically Available Now",value:schedule.physicallyAvailableNow},
                            {title:"Reserved / Out on Date",value:schedule.bookedUnits},
                            {title:"Available on Date (est.)",value:schedule.availableOnDate},
                            {title:"On Hold Now",value:schedule.maintenanceUnits},
                            {title:"Missing",value:schedule.missingUnits},
                        ].map(c=><div key={c.title} className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3">
                            <p className="text-[10px] text-[#806A8C]">{c.title}</p><p className="mt-1 text-lg font-bold text-[#2B174C]">{c.value}</p>
                        </div>)}
                    </div>
                    <p className="text-xs text-[#86778F]">Date estimate = total owned − current holds − missing − overlapping confirmed allocations. Current and future quantities may change after returns or new bookings. Overdue checked-out equipment stays blocked for future bookings until physically returned. A confirmed booking does not mean equipment is physically checked out.</p>
                    <div className="rounded-xl border border-[#E6DDF0]">
                        <div className="border-b border-[#E6DDF0] px-3 py-2 text-xs font-semibold">Booking details · {queueScheduleDate(schedule.date)} ({schedule.allocationCount} allocations)</div>
                        {schedule.allocationCount>schedule.bookings.length&&<p className="px-3 pt-2 text-xs text-amber-800">Showing the first {schedule.bookings.length} bookings; availability includes all {schedule.allocationCount} allocations.</p>}
                        <div className="max-h-48 overflow-y-auto">
                            {schedule.bookings.length===0?<p className="p-3 text-xs text-[#86778F]">No confirmed allocations cover this date.</p>:
                                schedule.bookings.map(b=><div key={b.allocationId} className="flex items-start justify-between gap-2 border-b border-[#F0EAF4] p-3 text-xs">
                                    <div><p className="break-all font-semibold text-[#2B174C]">{b.bookingReference}</p>
                                        <p className="mt-1 text-[#86778F]">{b.startDate} – {b.endDate} · {b.status==="checked_out"?"Out on Rental":"Reserved"}</p></div>
                                    <strong>{b.quantity} units</strong>
                                </div>)}
                        </div>
                    </div>
                    <p className="text-xs text-[#806A8C]">Only operational booking references, dates, quantities and rental statuses are shown. Staff completes handovers and returns through the Rental Operations Queue.</p>
                </>}
                <div className="flex justify-end"><button type="button" className={action} onClick={()=>setScheduleEquipmentId(null)}>Close</button></div>
            </section>
        </div>}
        {stockTask&&<div role="presentation" className="fixed inset-0 z-[105] flex items-center justify-center bg-[#21132E]/50 p-4">
            <section role="dialog" aria-modal="true" aria-label="Physical rental equipment task" className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-[#21132E]">
                    {stockTask.kind==="issue"?"Report Equipment Issue":
                        stockTask.kind==="routine"?"Complete Routine Care":stockTask.kind==="replace"?"Mark Missing Equipment Replaced":"Mark Repaired & Ready"}
                </h3><button type="button" disabled={rental.saving} onClick={()=>setStockTask(null)} aria-label="Close"><X size={19}/></button></div>
                <p className="text-sm text-[#5A476A]">{stockTask.label}</p>
                {stockTask.kind==="issue"&&stockTask.bookingReference&&<p className="rounded-lg bg-[#F7F1FF] p-2 text-xs text-[#56378B]">Found while preparing booking <strong>{stockTask.bookingReference}</strong>. The issue is recorded against available equipment; the booking&apos;s allocated quantity is not silently changed.</p>}
                <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Quantity (maximum {stockTask.max})
                    <input type="number" min={1} max={stockTask.max} step={1} value={stockQuantity} onChange={e=>setStockQuantity(e.target.value)}
                           className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                {stockTask.kind==="issue"&&<label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Issue type
                    <select value={issueType} onChange={e=>setIssueType(e.target.value as typeof issueType)} className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm">
                        <option value="damage">Damaged / Needs Inspection</option><option value="missing">Missing Equipment</option>
                        <option value="routine">Routine Cleaning / Minor Upkeep (no safety issue)</option>
                    </select></label>}
                <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">
                    {stockTask.kind==="issue"?"What happened? (required)":stockTask.kind==="routine"?"Completed routine work":stockTask.kind==="replace"?"Replacement source and condition":"Repair work and safety inspection"}
                    <textarea rows={3} maxLength={500} value={stockNotes} onChange={e=>setStockNotes(e.target.value)}
                              className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm" placeholder="Describe what was found or repaired..."/></label>
                {(stockTask.kind==="complete"||stockTask.kind==="replace")&&<label className="flex items-start gap-2 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs text-[#5A476A]">
                    <input type="checkbox" checked={stockSafetyChecked} onChange={e=>setStockSafetyChecked(e.target.checked)} className="mt-0.5"/>
                    <span>{stockTask.kind==="complete"?"I physically verified that these units were repaired, inspected and are safe to rent again.":"I physically received and inspected the replacement units, verified they are safe to rent, and confirm these units have NOT already been added through Restock or another stock receipt."}</span>
                </label>}
                <p className="text-xs text-[#86778F]">{stockTask.kind==="issue"?(issueType==="routine"?
                        "Routine is for cleaning and non-safety upkeep only. Broken, unstable, electrical, or unsafe equipment must be reported as Damaged. Units remain on hold until Staff marks routine care complete.":
                        "Damaged or missing units become unavailable immediately. Staff verifies repairs and physical replacements; Manager controls permanent write-offs and customer charges."):
                    stockTask.kind==="routine"?"Routine care returns verified units to Available.":stockTask.kind==="replace"?
                        "Mark Replaced only after new, safe replacement units arrive. Do not use this action for units already counted through Restock. It resolves the missing count without adding extra total units; booking charges are unchanged.":
                        "Verified repaired units return directly to Available without Manager approval. Customer charges remain separate."}</p>
                {submitError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                <div className="flex justify-end gap-2"><button type="button" className={action} onClick={()=>setStockTask(null)} disabled={rental.saving}>Cancel</button>
                    <button type="button" className={primary} onClick={()=>void performStock()} disabled={rental.saving}>{rental.saving?"Saving...":stockTask.kind==="issue"?"Submit Issue Report":"Confirm"}</button></div>
            </section>
        </div>}
        <SuccessToast toast={notice ? {title:"Rental task completed",message:notice} : null} onClose={closeStaffRentalToast} />
        {confirmRecordedReturn && <div role="presentation" className="fixed inset-0 z-[160] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4">
            <section role="alertdialog" aria-modal="true" aria-label="Confirm recorded rental return" className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">Finalize Recorded Return</h3>
                <p className="text-sm text-[#6A5D6F]">Finish the previously recorded return for <strong>{confirmRecordedReturn.equipmentName}</strong>?</p>
                <div className="rounded-xl bg-[#F7F1FF] p-3 text-xs text-[#5330B6]">
                    <p>Physically returned: <strong>{confirmRecordedReturn.returnedReceivedUnits ?? confirmRecordedReturn.quantity}</strong></p>
                    <p>Recorded damaged: <strong>{Math.max(0, Number(confirmRecordedReturn.damagedUnits || 0))}</strong></p>
                </div>
                <p className="text-xs leading-5 text-[#6A5D6F]">Confirm you checked these units, the damage record is accurate, and routine care is complete for the other returned units. A Manager reviews damaged units; no customer charge is created automatically.</p>
                <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={action} disabled={rental.saving} onClick={()=>setConfirmRecordedReturn(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={rental.saving||!canOperate} onClick={()=>void finalizeRecordedReturn(confirmRecordedReturn)}>{rental.saving?"Saving...":"Confirm Return"}</button>
                </div>
            </section>
        </div>}
        {(selected||selectedEquipment)&&<div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#21132E]/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving){setSelected(null);setViewEquipment(null);}}}>
            <section role="dialog" aria-modal="true" aria-label="Rental operation review" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-[#21132E]">{selected?taskLabel[taskType(selected)||"prepare"]:selectedEquipment?.name}</h3><button aria-label="Close dialog" disabled={rental.saving} onClick={()=>{setSelected(null);setViewEquipment(null);}}><X size={19}/></button></div>
                {selected?<div className="mt-4 space-y-3 text-sm"><p className="font-semibold">{selected.equipmentName} · {selected.quantity} booked units</p><p>Confirmed booking: <strong>{selected.bookingReference}</strong></p><p>Rental period: {selected.startDate} – {selected.endDate}</p>
                    <p className="rounded-lg bg-[#F7F1FF] px-3 py-2 text-xs text-[#4D2B85]">Units for this action: <strong>{taskType(selected)==="inspect"?selected.returnedReceivedUnits:taskType(selected)==="clean"?selected.cleaningUnits:taskType(selected)==="damage"?selected.damagedUnits:selected.quantity}</strong></p>
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3">
                        <p className="text-[11px] font-semibold text-[#2B174C]">Booking equipment workflow</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {workflowStages.map((stage,index)=><span key={stage} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${taskType(selected)!=="damage"&&stageForTask[taskType(selected) as Exclude<TaskType,"damage">]===index
                                ?"bg-[#4D2B85] text-white":"bg-white text-[#86778F]"}`}>{stage}</span>)}
                        </div>
                        <p className="mt-2 text-xs text-[#6F5B7E]">{taskHelp[taskType(selected)||"prepare"]}</p>
                    </div>
                    {(taskType(selected)==="prepare"||taskType(selected)==="release")&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                        <p className="font-semibold">Found broken, dirty, or missing equipment before handover?</p>
                        <p className="mt-1">Report the affected available units first. They become unavailable or flagged missing, and this booking stays in its current stage. Stock is checked again before preparation and release. Obtain safe replacements if needed.</p>
                        <button type="button" className={`${action} mt-2`} disabled={!canOperate||rental.saving}
                                onClick={()=>reportIssueBeforeRelease(selected)}><AlertTriangle size={14}/> Report Equipment Issue</button>
                    </div>}
                    {taskType(selected)==="return"&&<div className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs">
                        <p>Use Receive Booking Return to record missing/damaged units and finish the return condition check for the complete booking.</p>
                        <label className="block font-semibold">Missing units on return (0–{selected.quantity})
                            <input type="number" min={0} max={selected.quantity} step={1} value={returnMissing}
                                   onChange={e=>setReturnMissing(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm"/>
                        </label><p>Staff can record physically received replacement units in Equipment Care & Maintenance. Permanent write-offs and customer charges remain Manager-controlled. Damaged units stay on hold until Staff verifies repairs.</p>
                    </div>}
                    {taskType(selected)==="damage"&&<div className="rounded-lg bg-amber-50 p-3 text-xs"><AlertTriangle size={16} className="inline"/> Damaged units remain on hold until Staff records a verified repair and safety check.</div>}
                    {taskType(selected)!=="damage"&&<label className="block text-xs font-semibold">Notes
                        {taskType(selected)==="return"&&Number(returnMissing)>0?" (required for missing units)":" (optional)"}
                        <textarea className="mt-1 w-full rounded-xl border p-3 text-sm" maxLength={400} rows={3}
                                  value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Condition, missing accessories, handover notes..."/></label>}
                    {submitError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                    <div className="flex justify-end gap-2"><button className={action} disabled={rental.saving} onClick={()=>setSelected(null)}>Cancel</button>{taskType(selected)!=="damage"&&<button className={primary} disabled={rental.saving} onClick={()=>void perform()}>{rental.saving?"Saving...":taskType(selected)==="prepare"?"Confirm Preparation":"Confirm "+taskLabel[taskType(selected)||"prepare"]}</button>}</div>
                </div>:selectedEquipment&&<div className="mt-4 space-y-3 text-sm">
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs">
                        <p className="font-semibold text-[#2B174C]">Equipment No.: {selectedEquipment.equipmentNumber}</p>
                        <p className="mt-2">Last stock received: <strong>{selectedEquipment.lastStockReceivedDate ? queueScheduleDate(selectedEquipment.lastStockReceivedDate) : "No stock receipt recorded"}</strong></p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {[{label:"Total Units",count:selectedEquipment.totalUnits},
                                {label:"Out",count:selectedEquipment.rentedOutUnits},
                                {label:"On Hold",count:selectedEquipment.maintenanceUnits},
                                {label:"Missing",count:selectedEquipment.missingUnits}].map(item=><div key={item.label} className="rounded-lg border border-[#E6DDF0] bg-white p-2">
                                <p className="text-[10px] text-[#806A8C]">{item.label}</p><p className="mt-1 text-base font-bold">{item.count}</p>
                            </div>)}
                        </div>
                    </div>
                    {(selectedEquipment.unitNumbers?.length||0)>0&&<div className="rounded-xl border border-[#E6DDF0] p-3"><p className="text-xs font-semibold text-[#2B174C]">Individual Equipment Nos. ({selectedEquipment.unitNumbers!.length} units):</p><div className="mt-1 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{selectedEquipment.unitNumbers!.map(number=><span key={number} className="rounded-md border border-[#E6DDF0] bg-[#FBF8FF] px-2 py-0.5 text-[11px] font-semibold text-[#4E2C66]">{number}</span>)}</div></div>}
                    {(()=>{
                        const h=holdBreakdown.get(selectedEquipment.id)||{inspection:0,cleaning:0,routine:0,repairs:0};
                        const known=h.inspection+h.cleaning+h.routine+h.repairs;
                        const other=Math.max(0,selectedEquipment.maintenanceUnits-known);
                        return <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs">
                            <p className="font-semibold">Why units are On Hold</p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <span>Pending inspection: <strong>{h.inspection}</strong></span>
                                <span>Needs cleaning: <strong>{h.cleaning}</strong></span>
                                <span>Routine care: <strong>{h.routine}</strong></span>
                                <span>Repair / safety review: <strong>{h.repairs}</strong></span>
                                {other>0&&<span className="col-span-2">Other holds / older records: <strong>{other}</strong></span>}
                            </div>
                            {known>selectedEquipment.maintenanceUnits&&<p role="alert" className="mt-2 text-red-700">Hold task quantities exceed the equipment hold total. Ask the Manager to reconcile records.</p>}
                            <p className="mt-2 text-[#86778F]">Known tasks from the current workspace. Previous returns may need a one-time confirmation; new returns have their condition check completed when received.</p>
                        </div>;
                    })()}
                    {careTasks.filter(task=>task.equipmentId===selectedEquipment.id).length>0&&
                        <div className="space-y-2 rounded-xl border border-[#E6DDF0] p-3 text-xs">
                            <p className="font-semibold text-[#2B174C]">Outstanding stock care</p>
                            {careTasks.filter(task=>task.equipmentId===selectedEquipment.id).map(task=><div key={task.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F0EAF4] pt-2">
                                <span className="min-w-0 flex-1 text-[#5A476A]">{task.kind==="inspection"?"Previous return pending inspection":task.kind==="cleaning"?"Clean returned equipment":task.kind==="routine"?"Routine care":"Repair / safety review"} · {task.units} unit(s)</span>
                                {task.kind==="inspection"?
                                    <button type="button" disabled={!canOperate||rental.saving} className={action}
                                            onClick={()=>{setViewEquipment(null);setConfirmRecordedReturn(task.allocation);}}>Finalize Return</button>:
                                    task.kind==="cleaning"?
                                        <button type="button" disabled={!canOperate||rental.saving} className={action}
                                                onClick={()=>{setViewEquipment(null);openRentalAction(task.allocation);}}>Mark Cleaned</button>:
                                        task.kind==="routine"?
                                            <button type="button" disabled={!canOperate||rental.saving} className={action}
                                                    onClick={()=>{setViewEquipment(null);startStockTask({kind:"routine",id:task.maintenance.id,label:task.equipmentName,max:task.units});}}>Mark Care Done</button>:
                                            <button type="button" disabled={!canOperate||rental.saving} className={action}
                                                    onClick={()=>{setViewEquipment(null);startStockTask({kind:"complete",id:task.maintenance.id,label:task.equipmentName,max:task.units});}}>Mark Repaired</button>}
                            </div>)}
                        </div>}
                    <p className="text-xs font-semibold text-[#5A476A]">Stock check: {selectedEquipment.totalUnits} owned = {Math.max(0,selectedEquipment.totalUnits-selectedEquipment.rentedOutUnits-selectedEquipment.maintenanceUnits-selectedEquipment.missingUnits)} available + {selectedEquipment.rentedOutUnits} out + {selectedEquipment.maintenanceUnits} held + {selectedEquipment.missingUnits} missing.</p><p className="rounded-lg bg-[#F7F3FC] p-3 text-xs">Product catalog and rental pricing are managed by the Manager.</p></div>}
            </section>
        </div>}
    </div>;
}