"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Building2, RefreshCw, TrendingUp, Package, Gift, Armchair, Download, ShoppingCart, CalendarDays, X, Calculator, Info } from "lucide-react";
import type { ExportContext, ExportTable } from "./_shared";

type PeriodOption = "month" | "quarter" | "year";
type ChartPeriod = "weekly" | "monthly" | "yearly";
type Amount = number | null;
type DailyRow = {date:string;branchId:string;sales:Amount;cost:Amount};
type Branch = {id:string;branchName:string};
type Snapshot = {dateRange:{startDate:string;endDate:string};branches:Branch[];walkDaily:DailyRow[];bookingDaily:DailyRow[];rentalCostMethod:string;topProducts:Record<PeriodOption,OwnerRankRow[]>};
type Rankings = Record<PeriodOption,OwnerRankRow[]>;
const periods:PeriodOption[]=["month","quarter","year"];
const filterClass="h-9 min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#BFA8E2] focus-visible:ring-2 focus-visible:ring-[#F1EBFF]";
const panelClass="min-w-0 rounded-2xl border border-[#E7DFEC] bg-white shadow-sm";
const headerCell="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
const bodyCell="px-3 py-2 text-center text-[11px] text-[#4F3A5A] tabular-nums";
const ownerIconTones = {
    purple: { icon: "bg-[#F3EBFF] text-[#6C3AD6]", surface: "border-[#E6DDF0] bg-[#F8F4FE] text-[#543099]" },
    green: { icon: "bg-[#EAF7F0] text-[#25865B]", surface: "border-[#D7EBDF] bg-[#F0FAF4] text-[#206B49]" },
    amber: { icon: "bg-[#FFF7E9] text-[#B7832E]", surface: "border-[#F3E2C2] bg-[#FFFAF0] text-[#8C601F]" },
    blue: { icon: "bg-[#E8F1FF] text-[#2169CF]", surface: "border-[#D6E5FC] bg-[#F2F7FF] text-[#205AA8]" },
    indigo: { icon: "bg-[#ECEEFF] text-[#4F57C5]" },
    teal: { icon: "bg-[#E5F7F5] text-[#147D77]" },
    rose: { icon: "bg-[#FCECF1] text-[#B74470]" },
    orange: { icon: "bg-[#FFF0E5] text-[#C36A28]" },
    cyan: { icon: "bg-[#E7F5FB] text-[#237C9B]" },
} as const;
type OwnerIconTone = keyof typeof ownerIconTones;
type OwnerKpiTone = "purple" | "green" | "amber" | "blue";
const ownerKpiVisuals = {
    sales: { icon: BarChart3, tone: "purple" },
    profit: { icon: TrendingUp, tone: "green" },
    booking: { icon: CalendarDays, tone: "amber" },
    walk: { icon: ShoppingCart, tone: "blue" },
} as const;
const ownerKpiCardClass = "flex min-h-[108px] min-w-0 w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-[#B6A1D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]";
function getSavedItem(key:string){return typeof window === "undefined" ? "" : sessionStorage.getItem(key)||localStorage.getItem(key)||"";}
function peso(value:Amount){return value===null||!Number.isFinite(value)?"—":value.toLocaleString("en-PH",{style:"currency",currency:"PHP",minimumFractionDigits:2,maximumFractionDigits:2});}
function pesoCompact(value:number){const abs=Math.abs(value),sign=value<0?"−":"";return abs>=1e6?`${sign}₱${+(abs/1e6).toFixed(1)}M`:abs>=1000?`${sign}₱${+(abs/1000).toFixed(1)}K`:`${sign}₱${+abs.toFixed(2)}`;}
function manilaDate(now=new Date()){return now.toLocaleDateString("sv-SE",{timeZone:"Asia/Manila"});}
function formatCurrentDashboardDateTime(now:Date){return now.toLocaleDateString("en-US",{timeZone:"Asia/Manila",month:"long",day:"numeric",year:"numeric"})+" | "+now.toLocaleTimeString("en-US",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit",hour12:true}).toLowerCase();}
function dateOf(key:string){return new Date(`${key}T00:00:00Z`);}
function dateKey(d:Date){return d.toISOString().slice(0,10);}
function dayShift(key:string,days:number){const d=dateOf(key);d.setUTCDate(d.getUTCDate()+days);return dateKey(d);}
function monthShift(key:string,months:number){const d=dateOf(key);return dateKey(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,1)));}
function shortDate(key:string){return dateOf(key).toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"});}
function periodStart(period:PeriodOption,today:string){const d=dateOf(today);return period==="year"?`${today.slice(0,4)}-01-01`:period==="quarter"?dateKey(new Date(Date.UTC(d.getUTCFullYear(),Math.floor(d.getUTCMonth()/3)*3,1))):`${today.slice(0,7)}-01`;}
function periodLabel(period:PeriodOption,today:string){return `${shortDate(periodStart(period,today))} – ${shortDate(today)}`;}
function amount(value:unknown):Amount{if(value==null||value==="")return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function requiredNumber(value:unknown){const n=amount(value);if(n===null)throw new Error("Invalid ranking data returned by the API.");return n;}
function sum(values:Amount[]):Amount{if(values.some(v=>v===null||!Number.isFinite(v)))return null;return values.reduce<number>((a,v)=>a+Math.round(v!*100),0)/100;}
function total(a:Amount,b:Amount){return sum([a,b]);}
function difference(a:Amount,b:Amount){return a===null||b===null?null:(Math.round(a*100)-Math.round(b*100))/100;}
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("Invalid dashboard API response.");return v as Record<string,unknown>;}
function parseDaily(v:unknown):DailyRow[]{if(!Array.isArray(v))throw new Error("Deploy the updated POS Lambda to enable Owner Dashboard reporting.");return v.map(x=>{const r=record(x);const date=String(r.date||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!r.branchId)throw new Error("Invalid branch/date in dashboard response.");return {date,branchId:String(r.branchId),sales:amount(r.sales),cost:amount(r.cost)};});}
function parseRankings(v:unknown,kind:"consumable"|"package"|"rental"):Rankings{const raw=record(v);const parse=(p:PeriodOption)=>{const rows=raw[p];if(!Array.isArray(rows))throw new Error("Ranking data unavailable.");return rows.map(x=>{const r=record(x);return {key:String(r.key||r.name),name:String(r.name||"Unnamed"),secondary:"",count:requiredNumber(kind==="consumable"?r.units:kind==="package"?r.bookings:r.rentals),revenue:requiredNumber(kind==="consumable"?r.sales:r.revenue)};}).sort((a,b)=>b.revenue-a.revenue||a.name.localeCompare(b.name)).slice(0,5);};return {month:parse("month"),quarter:parse("quarter"),year:parse("year")};}
function parseSnapshot(v:unknown):Snapshot{const r=record(v);const range=record(r.dateRange);if(!Array.isArray(r.branches))throw new Error("Branch data unavailable.");return {dateRange:{startDate:String(range.startDate),endDate:String(range.endDate)},branches:r.branches.map(x=>{const b=record(x);return {id:String(b.id),branchName:String(b.branchName||"Unnamed branch")};}),walkDaily:parseDaily(r.walkDaily),bookingDaily:parseDaily(r.bookingDaily).map(row=>r.rentalCostMethod==="manual_unit_cost_per_rental"?row:{...row,cost:null}),rentalCostMethod:String(r.rentalCostMethod||""),topProducts:parseRankings(r.topProducts,"consumable")};}
function summarize(data:Snapshot,start:string,end:string,branchId?:string){const filter=(r:DailyRow)=>r.date>=start&&r.date<=end&&(!branchId||r.branchId===branchId);const w=data.walkDaily.filter(filter),b=data.bookingDaily.filter(filter);const walk=sum(w.map(r=>r.sales)),booking=sum(b.map(r=>r.sales)),cost=sum([...w,...b].map(r=>r.cost)),sales=total(walk,booking);return {walk,booking,sales,cost,profit:difference(sales,cost),estimated:b.length>0};}
type TrendPoint={label:string;start:string;end:string;sales:Amount;booking:Amount;walk:Amount};
function buildTrend(data:Snapshot,period:ChartPeriod):TrendPoint[]{const today=data.dateRange.endDate;const ranges:{start:string;end:string;label:string}[]=[];const add=(start:string,end:string,label:string)=>ranges.push({start,end:end>today?today:end,label});const d=dateOf(today);
    if(period==="weekly"){
        // Rolling one-week interval: today minus seven calendar days through today.
        // Both endpoints are shown, so the chart has eight daily data points.
        for(let i=7;i>=0;i--){
            const date=dayShift(today,-i);
            const label=dateOf(date).toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric"});
            add(date,date,label);
        }
    }
    else if(period==="monthly"){for(let i=11;i>=0;i--){const start=monthShift(today,-i);add(start,dayShift(monthShift(start,1),-1),dateOf(start).toLocaleDateString("en-US",{timeZone:"UTC",month:"short",year:"2-digit"}));}}
    else {for(let i=1;i>=0;i--){const y=d.getUTCFullYear()-i;add(`${y}-01-01`,`${y}-12-31`,String(y));}}
    return ranges.filter(r=>r.start>=data.dateRange.startDate).map(r=>{const v=summarize(data,r.start,r.end);return {...r,sales:v.sales,booking:v.booking,walk:v.walk};});
}
async function request(endpoint:string,body:Record<string,unknown>,signal:AbortSignal){const token=getSavedItem("token");if(!token)throw new Error("Your session has expired. Please sign in again.");const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal,cache:"no-store"});const data=record(await res.json());if(!res.ok||data.success===false)throw new Error(String(data.error||`Request failed (HTTP ${res.status}).`));return data;}

export default function OwnerDashboard(){
    const router=useRouter();
    const [now,setNow]=useState(()=>new Date());
    const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
    const [rankings,setRankings]=useState<{packages:Rankings;rentals:Rankings}|null>(null);
    const [error,setError]=useState("");const [rankError,setRankError]=useState("");
    const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);
    const [chartPeriod,setChartPeriod]=useState<ChartPeriod>("monthly");
    const [branchPeriod,setBranchPeriod]=useState<PeriodOption>("month");
    const [consumablePeriod,setConsumablePeriod]=useState<PeriodOption>("month");
    const [packagePeriod,setPackagePeriod]=useState<PeriodOption>("month");
    const [rentalPeriod,setRentalPeriod]=useState<PeriodOption>("month");
    const [selectedKpi,setSelectedKpi]=useState<OwnerKpiKey|null>(null);
    const [refresh,setRefresh]=useState(0);
    const today=manilaDate(now);
    useEffect(()=>{const t=window.setInterval(()=>setNow(new Date()),30_000);return()=>window.clearInterval(t);},[]);
    useEffect(()=>{let active=true;let pending=false;const controller=new AbortController();
        const load=async()=>{if(pending)return;pending=true;setRefreshing(true);
            const start=`${Number(today.slice(0,4))-1}-01-01`;
            const [financial,ranking]=await Promise.allSettled([
                request("/api/pos",{action:"get_owner_dashboard_summary",dashboard_version:2,date_from:start,date_to:today},controller.signal).then(x=>{const s=parseSnapshot(x.summary);if(s.dateRange.startDate!==start||s.dateRange.endDate!==today)throw new Error("Dashboard reporting dates do not match the request.");return s;}),
                request("/api/bookings",{action:"get_owner_dashboard_financial_summary"},controller.signal).then(x=>({packages:parseRankings(x.topBookingPackages,"package"),rentals:parseRankings(x.topRentedProducts,"rental")}))
            ]);
            if(active){if(financial.status==="fulfilled"){setSnapshot(financial.value);setError("");}else{setSnapshot(null);setError(financial.reason instanceof Error?financial.reason.message:"Sales data unavailable.");}
                if(ranking.status==="fulfilled"){setRankings(ranking.value);setRankError("");}else{setRankings(null);setRankError(ranking.reason instanceof Error?ranking.reason.message:"Booking rankings unavailable.");}
                setLoading(false);setRefreshing(false);}
            pending=false;
        };
        void load();const poll=()=>{if(document.visibilityState==="visible")void load();};const timer=window.setInterval(poll,60_000);document.addEventListener("visibilitychange",poll);
        return()=>{active=false;controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",poll);};
    },[today,refresh]);
    const data=snapshot?.dateRange.endDate===today?snapshot:null;
    const current=data?summarize(data,periodStart("month",today),today):null;
    const trend=useMemo(()=>data?buildTrend(data,chartPeriod):[],[data,chartPeriod]);
    const branches=useMemo(()=>{if(!data)return [];const byId=new Map(data.branches.map(x=>[x.id,x.branchName]));for(const row of [...data.walkDaily,...data.bookingDaily])if(!byId.has(row.branchId))byId.set(row.branchId,`Branch #${row.branchId}`);return [...byId].map(([id,name])=>({id,name,...summarize(data,periodStart(branchPeriod,today),today,id)})).sort((a,b)=>(b.sales??-Infinity)-(a.sales??-Infinity)||a.name.localeCompare(b.name));},[data,branchPeriod,today]);
    const period=periodLabel("month",today);
    const profitNote=current?.profit!=null&&current.profit<0?(current.estimated?"Estimated loss":"Costs exceed sales"):"Sales less cost of sales";
    const profitTitle="Gross Profit";
    const costBasis=(current?.estimated?"Booking costs use current item cost prices, so past profits may change. ":"")+"Walk-in costs use item cost prices recorded at the time of sale. Other expenses and tax adjustments are not included." + (data && data.rentalCostMethod!=="manual_unit_cost_per_rental" ? " Deploy the updated POS Lambda to use the revised rental cost calculation." : "");
    const details:Record<OwnerKpiKey,OwnerKpiDetail>={
        sales:{title:"Total Sales",amount:current?.sales??null,period,formula:"Total Sales = Booking Sales + Walk-In Sales",items:[["Booking Sales",current?.booking??null],["Walk-In Sales",current?.walk??null]],description:"Completed bookings by event date and completed POS orders by order date. Booking sales use the agreed price (or saved package price if absent), excluding separately collected deposits and settlement adjustments."},
        profit:{title:profitTitle,amount:current?.profit??null,period,formula:"Gross Profit = Total Sales − Cost of Sales",items:[["Total Sales",current?.sales??null],["Less: Cost of Sales",current?.cost??null]],description:costBasis},
        booking:{title:"Booking Sales",amount:current?.booking??null,period,formula:"Sum of agreed prices of completed bookings",items:[["Booking Sales",current?.booking??null]],description:"Only completed bookings; filtered by event date. Uses agreed price or the saved package price if absent."},
        walk:{title:"Walk-In Sales",amount:current?.walk??null,period,formula:"Sum of completed walk-in POS order totals",items:[["Walk-In Sales",current?.walk??null]],description:"Only completed walk-in POS orders in the reporting period."}
    };
    const cards:{key:OwnerKpiKey;title:string;value:Amount;note:string;icon:React.ReactNode;tone:OwnerKpiTone}[]=[
        {key:"sales",title:"Total Sales",value:current?.sales??null,note:"Combined booking and walk-in sales",icon:<BarChart3 size={23}/>,tone:"purple"},
        {key:"profit",title:profitTitle,value:current?.profit??null,note:current?.profit==null?"Required cost data unavailable":profitNote,icon:<TrendingUp size={23}/>,tone:"green"},
        {key:"booking",title:"Booking Sales",value:current?.booking??null,note:"Sales from completed bookings",icon:<CalendarDays size={23}/>,tone:"amber"},
        {key:"walk",title:"Walk-In Sales",value:current?.walk??null,note:"Sales from walk-in transactions",icon:<ShoppingCart size={23}/>,tone:"blue"}
    ];
    const rankPanels=[{title:"Top Consumable Products",icon:<Package size={18}/>,tone:"rose" as const,rows:data?.topProducts[consumablePeriod]??null,countLabel:"Units Sold",period:consumablePeriod,change:setConsumablePeriod,file:"owner_top_consumable_products"},{title:"Top Booking Packages",icon:<Gift size={18}/>,tone:"orange" as const,rows:rankings?.packages[packagePeriod]??null,countLabel:"Bookings",period:packagePeriod,change:setPackagePeriod,file:"owner_top_booking_packages"},{title:"Top Rented Products",icon:<Armchair size={18}/>,tone:"cyan" as const,rows:rankings?.rentals[rentalPeriod]??null,countLabel:"Units Rented",period:rentalPeriod,change:setRentalPeriod,file:"owner_top_rented_products"}];
    return <><header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur"><div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"><div><h1 className="text-[25px] font-bold text-[#1A1220]">Owner Dashboard</h1><p className="mt-0.5 text-xs text-[#766983]">Sales and financial overview across all branches.</p></div><div className="flex items-center gap-2.5"><time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{formatCurrentDashboardDateTime(now)}</time><button type="button" disabled={refreshing} onClick={()=>setRefresh(v=>v+1)} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"><RefreshCw size={16} className={refreshing?"animate-spin":""}/>{refreshing?"Refreshing...":"Refresh"}</button></div></div></header>
        <main aria-busy={loading} className="space-y-4 px-5 py-5 font-sans">
            {error&&<div role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{error}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(k=>loading?<div key={k.key} className={`${ownerKpiCardClass} animate-pulse`}><span className="h-12 w-12 shrink-0 rounded-xl bg-[#EEE8F3]"/><span className="min-w-0 flex-1 space-y-2"><span className="block h-3.5 w-24 rounded bg-[#EEE8F3]"/><span className="block h-7 w-28 rounded bg-[#EEE8F3]"/></span></div>:<OwnerFinancialCard key={k.key} title={k.title} value={peso(k.value)} note={k.note} icon={k.icon} iconTone={k.tone} onClick={()=>setSelectedKpi(k.key)}/>)}</div>
            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section className={`${panelClass} flex flex-col p-4`}><OwnerPanelTitle title="Sales Overview Chart" tone="indigo" icon={<BarChart3 size={18}/>} action={<><select aria-label="Sales overview interval" className={filterClass} value={chartPeriod} onChange={e=>setChartPeriod(e.target.value as ChartPeriod)}>{(["monthly","weekly","yearly"] as const).map(p=><option key={p} value={p}>{p[0].toUpperCase()+p.slice(1)}</option>)}</select><OwnerExportButton label="Sales Overview" disabled={!trend.length} onExport={()=>{if(data) downloadOwnerSalesOverview(data,chartPeriod,trend);}}/></>}/><div className="mt-3 flex flex-1 flex-col justify-center"><SalesOverview data={trend} loading={loading}/></div></section>
                <section className={`${panelClass} flex flex-col`}><div className="border-b border-[#E9E1EE] px-4 py-3.5"><OwnerPanelTitle title="Branch Sales Performance" tone="teal" icon={<Building2 size={18}/>} action={<><select aria-label="Branch performance period" className={filterClass} value={branchPeriod} onChange={e=>setBranchPeriod(e.target.value as PeriodOption)}><option value="month">This Month</option><option value="quarter">This Quarter</option><option value="year">This Year</option></select><OwnerExportButton label="Branch Sales Performance" disabled={!branches.length} onExport={()=>downloadOwnerBranchReport(branchPeriod,branches,today)}/></>}/></div>
                    <div className="max-h-[248px] min-h-0 overflow-auto"><table className="w-full min-w-[500px] text-center [&_th]:px-2 [&_td]:px-2"><thead className="sticky top-0 bg-[#FFFCF8]"><tr>{["Branch","Total Sales","Booking Sales","Walk-In Sales","Gross Profit"].map(h=><th key={h} className={headerCell}>{h}</th>)}</tr></thead><tbody>{branches.map(r=><tr key={r.id} className="border-t border-[#E9E1EE] hover:bg-[#FBF8FE]"><td className="px-4 py-2 text-left text-[11px] font-semibold text-[#2B174C]">{r.name}</td><td className={bodyCell}>{peso(r.sales)}</td><td className={bodyCell}>{peso(r.booking)}</td><td className={bodyCell}>{peso(r.walk)}</td><td className={bodyCell}>{peso(r.profit)}</td></tr>)}{!branches.length&&<tr><td colSpan={5} className="px-4 py-8 text-xs text-[#86778F]">{loading?"Loading branches...":data?"No branches found.":"Branch sales unavailable."}</td></tr>}</tbody></table></div></section>
            </div>
            {rankError&&<p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{rankError}</p>}
            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">{rankPanels.map(p=><OwnerRankingPanel key={p.title} title={p.title} icon={p.icon} tone={p.tone} rows={p.rows} countLabel={p.countLabel} period={p.period} onPeriodChange={p.change} onViewAll={()=>router.push("/analytics")} onExport={()=>downloadOwnerRanking(p.file,p.period,p.countLabel,(p.rows??[]).slice(0,5),today)}/>)}</div>
        </main>{selectedKpi&&<OwnerKpiDetailModal kpiKey={selectedKpi} detail={details[selectedKpi]} onClose={()=>setSelectedKpi(null)}/>}</>;
}

function SalesOverview({data,loading}:{data:TrendPoint[];loading:boolean}){
    if(!data.length)return <div className="flex min-h-[200px] items-center justify-center text-xs text-[#86778F]">{loading?"Loading sales overview...":"Sales overview unavailable."}</div>;
    const series=[{key:"sales",label:"Total Sales",color:"#6D35D4"},{key:"booking",label:"Booking Sales",color:"#1E6FE8"},{key:"walk",label:"Walk-In Sales",color:"#23834A"}] as const;
    const width=640,height=220,left=58,right=25,top=16,bottom=32;
    const values=data.flatMap(d=>series.map(s=>d[s.key]).filter((v):v is number=>v!==null));
    const rawMax=Math.max(1,...values),rawMin=Math.min(0,...values);const scale=Math.pow(10,Math.floor(Math.log10((rawMax-rawMin)/5)));const step=Math.ceil((rawMax-rawMin)/5/scale)*scale;const max=Math.ceil(rawMax/step)*step,min=Math.floor(rawMin/step)*step;
    const x=(i:number)=>left+(data.length===1?(width-left-right)/2:i*(width-left-right)/(data.length-1));const y=(v:number)=>top+(max-v)/(max-min)*(height-top-bottom);
    const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,i)=>min+i*step);
    return <><svg viewBox={`0 0 ${width} ${height}`} className="block h-auto max-h-[220px] w-full" role="img" aria-label="Total sales, booking sales and walk-in sales over time"><title>Sales Overview</title>{ticks.map(v=><g key={v}><line x1={left} x2={width-right} y1={y(v)} y2={y(v)} stroke="#EEE7F5"/><text x={left-8} y={y(v)+4} textAnchor="end" fontSize="11" fill="#806A8C">{pesoCompact(v)}</text></g>)}{series.map(s=>{let previous=false;const path=data.map((d,i)=>{const v=d[s.key];if(v===null){previous=false;return "";}const item=`${previous?"L":"M"}${x(i)},${y(v)}`;previous=true;return item;}).join(" ");return <g key={s.key}><path d={path} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{data.map((d,i)=>d[s.key]===null?null:<circle key={d.start} cx={x(i)} cy={y(d[s.key]!)} r={3} fill={s.color}><title>{`${shortDate(d.start)} – ${shortDate(d.end)}: ${s.label} ${peso(d[s.key])}`}</title></circle>)}</g>;})}{data.map((d,i)=><text key={d.start} x={x(i)} y={height-12} textAnchor="middle" fontSize="11" fill="#806A8C">{d.label}</text>)}</svg><div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] font-semibold text-[#5F4E75]">{series.map(s=><span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{background:s.color}}/>{s.label}</span>)}</div></>;
}

type OwnerCsvCell = string | number | null | undefined;
type OwnerKpiKey = "sales" | "profit" | "booking" | "walk";
type OwnerKpiDetail = {
    title: string;
    amount: number | null;
    period: string;
    formula: string;
    items: [string, number | null][];
    description: string;
};
/** Format report values without turning unavailable financial data into zero. */
function reportMoney(value: Amount) {
    return value === null || !Number.isFinite(value) ? "Unavailable" : value.toLocaleString("en-PH", {minimumFractionDigits:2,maximumFractionDigits:2});
}
function reportCount(value: number) {
    return value.toLocaleString("en-PH", {maximumFractionDigits: 0});
}
/** Sunday through Saturday; the current week ends at the snapshot date. */
function buildWeeklyReport(data: Snapshot): TrendPoint[] {
    const today = data.dateRange.endDate;
    const currentSunday = dayShift(today, -dateOf(today).getUTCDay());
    const previousSunday = dayShift(currentSunday, -7);
    return [previousSunday, currentSunday].flatMap(weekStart => {
        const start = weekStart < data.dateRange.startDate ? data.dateRange.startDate : weekStart;
        const saturday = dayShift(weekStart, 6);
        const end = saturday > today ? today : saturday;
        if (start > end) return [];
        const v = summarize(data, start, end);
        return [{start,end,label:`${shortDate(start)} - ${shortDate(end)}`,sales:v.sales,booking:v.booking,walk:v.walk}];
    });
}
function salesReportTable(data: Snapshot, period: ChartPeriod, trend: TrendPoint[]) {
    const points = period === "weekly" ? buildWeeklyReport(data) : trend;
    const ordered = period === "yearly" ? [...points].reverse() : points;
    const label = (r: TrendPoint) => period === "monthly"
        ? dateOf(r.start).toLocaleDateString("en-US", {timeZone:"UTC",month:"long"})
        : period === "yearly" ? r.start.slice(0,4) : `${shortDate(r.start)} - ${shortDate(r.end)}`;
    const totalRow = ["Total",reportMoney(sum(points.map(r=>r.sales))),reportMoney(sum(points.map(r=>r.booking))),reportMoney(sum(points.map(r=>r.walk)))];
    return {
        headers:[period === "monthly" ? "Months" : period === "weekly" ? "Weeks" : "Year", "Total Sales PHP", "Booking Sales PHP", "Walk-In Sales PHP"],
        rows:ordered.map(r=>[label(r),reportMoney(r.sales),reportMoney(r.booking),reportMoney(r.walk)]),
        totalRow,
        dateRange:points.length ? `${shortDate(points[0].start)} - ${shortDate(points[points.length-1].end)}` : "Unavailable",
    };
}
function downloadOwnerSalesOverview(data: Snapshot, period: ChartPeriod, trend: TrendPoint[]) {
    const report = salesReportTable(data,period,trend);
    if(report.rows.length) downloadOwnerReport(`owner_sales_overview_${period}.pdf`,report.headers,report.rows,report.dateRange,report.totalRow);
}
type BranchReportRow = {name:string;sales:Amount;booking:Amount;walk:Amount;profit:Amount};
function branchReportTable(branches: BranchReportRow[]) {
    return {
        headers:["Branch","Total Sales","Booking Sales","Walk-In Sales","Gross Profit"],
        rows:branches.map(r=>[r.name,reportMoney(r.sales),reportMoney(r.booking),reportMoney(r.walk),reportMoney(r.profit)]),
        totalRow:["Total",reportMoney(sum(branches.map(r=>r.sales))),reportMoney(sum(branches.map(r=>r.booking))),reportMoney(sum(branches.map(r=>r.walk))),reportMoney(sum(branches.map(r=>r.profit)))],
    };
}
function downloadOwnerBranchReport(period: PeriodOption, branches: BranchReportRow[], today: string) {
    if(!branches.length) return;
    const report = branchReportTable(branches);
    downloadOwnerReport(`owner_branch_sales_${period}.pdf`,report.headers,report.rows,periodLabel(period,today),report.totalRow);
}
function rankingReportTable(countLabel: string, rows: OwnerRankRow[]) {
    return {
        headers:["Rank",countLabel==="Bookings"?"Package":"Product",countLabel,"Revenue"],
        rows:rows.map((r,i)=>[String(i+1),r.name,reportCount(r.count),reportMoney(r.revenue)]),
        totalRow:["", "Total", reportCount(rows.reduce((n,r)=>n+r.count,0)),reportMoney(sum(rows.map(r=>r.revenue)))],
    };
}
function downloadOwnerRanking(file: string, period: PeriodOption, countLabel: string, rows: OwnerRankRow[], today: string) {
    if(!rows.length) return;
    const report = rankingReportTable(countLabel,rows);
    downloadOwnerReport(`${file}_${period}.pdf`,report.headers,report.rows,periodLabel(period,today),report.totalRow);
}
/** Owner-only PDF formatting; Manager and Staff exports are unchanged. */
function downloadOwnerReport(filename: string, headers: string[], rows: OwnerCsvCell[][], dateRange: string, totalRow: OwnerCsvCell[]) {
    const reportName = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
    const table: ExportTable = {
        title: reportName,
        headers,
        rows: rows.map(row => row.map(cell => String(cell ?? "Unavailable"))),
    };
    const context: ExportContext = {
        storeName: getSavedItem("store_name") || getSavedItem("stocknbook_store_name") || "StockNBook",
        branch: "All Branches",
        dateRange,
    };
    const prefix = filename.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    void import("./_shared").then(module => {
        return module.exportTableAsPdf(table, context, prefix, {centerColumns:true,totalRow:totalRow.map(cell=>String(cell ?? "Unavailable")),currencyNote:true});
    }).catch(error => console.error("Owner PDF export failed:", error));
}
function OwnerExportButton({label,onExport,disabled=false}:{label:string;onExport:()=>void;disabled?:boolean}) {
    return <button type="button" aria-label={`Download ${label} PDF`}
                   title={disabled ? "Verified data unavailable" : `Download ${label} PDF`}
                   disabled={disabled} onClick={onExport}
                   className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E3D8EA] bg-white text-[#5A35A5] transition hover:bg-[#F5F0FF] disabled:cursor-not-allowed disabled:opacity-40">
        <Download size={16} aria-hidden="true" />
    </button>;
}

function OwnerPanelTitle({title,icon,tone,action}:{title:string;icon:React.ReactNode;tone:OwnerIconTone;action?:React.ReactNode}) {
    return <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${ownerIconTones[tone].icon}`} aria-hidden="true">{icon}</span>
            <div className="min-w-0"><h3 className="truncate text-[15px] font-bold text-[#1A1220]" title={title}>{title}</h3></div>
        </div>{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>;
}
function OwnerFinancialCard({title,value,note,icon,iconTone,onClick}:{title:string;value:string;note:string;icon:React.ReactNode;iconTone:OwnerKpiTone;onClick:()=>void}) {
    return (
        <button type="button" onClick={onClick} aria-label={`View how ${title} is calculated`} aria-haspopup="dialog"
                title={`View ${title} breakdown`} className={ownerKpiCardClass}>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${ownerIconTones[iconTone].icon}`} aria-hidden="true">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{title}</span>
                <span className={`mt-1 block break-words text-[24px] font-bold leading-none tabular-nums ${value.startsWith("-")||value.startsWith("−")?"text-[#B42318]":"text-[#25153D]"}`}>{value}</span>
                <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{note}</span>
            </span>
        </button>
    );
}
function OwnerKpiDetailModal({kpiKey,detail,onClose}:{kpiKey:OwnerKpiKey;detail:OwnerKpiDetail;onClose:()=>void}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const visual = ownerKpiVisuals[kpiKey];
    const Icon = visual.icon;
    const tone = ownerIconTones[visual.tone];
    const amountText = (amount:number|null) => amount === null ? "Unavailable" : amount < 0 ? `−${peso(Math.abs(amount))}` : peso(amount);
    const isLoss = kpiKey === "profit" && detail.amount !== null && detail.amount < 0;
    const resultLabel = isLoss ? "Gross Loss" : detail.title;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const trigger = document.activeElement;
        if (!dialog.open) dialog.showModal();
        return () => {
            if (dialog.open) dialog.close();
            if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({preventScroll:true});
        };
    }, []);

    return (
        <dialog ref={dialogRef} aria-labelledby="owner-kpi-detail-title"
                aria-describedby="owner-kpi-detail-period"
                onCancel={event=>{event.preventDefault();onClose();}}
                onClick={event=>{if(event.target===event.currentTarget)onClose();}}
                className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[540px] overflow-y-auto rounded-[20px] border border-[#E6DDF0] bg-white p-0 text-[#25153D] shadow-2xl backdrop:bg-[#170B29]/55 backdrop:backdrop-blur-[2px]">
            <div className="font-sans">
                <header className="flex items-center gap-3 border-b border-[#EEE7F5] px-5 py-4 sm:px-6">
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone.icon}`} aria-hidden="true"><Icon size={23}/></span>
                    <div className="min-w-0 flex-1">
                        <h2 id="owner-kpi-detail-title" className="text-[18px] font-bold leading-tight text-[#25153D]">{detail.title}</h2>
                        <p className="mt-1 text-[11px] text-[#806A8C]">Calculation breakdown</p>
                    </div>
                    <button type="button" aria-label="Close calculation" onClick={onClose}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] transition hover:bg-[#F6F0FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]"><X size={18}/></button>
                </header>
                <div className="space-y-4 px-5 py-5 sm:px-6">
                    <div className={`rounded-2xl border px-4 py-4 ${tone.surface}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide">{resultLabel}</p>
                            <span className="flex items-center gap-1.5 rounded-lg bg-white/75 px-2 py-1 text-[10px] font-medium"><CalendarDays size={13} aria-hidden="true"/><span id="owner-kpi-detail-period">{detail.period}</span></span>
                        </div>
                        <p className={`mt-2 break-words text-[30px] font-bold leading-tight tracking-tight tabular-nums ${isLoss?"text-[#B42318]":"text-[#25153D]"}`}>{amountText(detail.amount)}</p>
                        <p className="mt-1 text-[11px] text-[#806A8C]">All branches · Month to date</p>
                    </div>
                    <section aria-label="Formula" className="rounded-xl border border-[#E9E1EE] bg-[#FAF8FC] px-4 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#806A8C]"><Calculator size={15} aria-hidden="true"/>Formula</div>
                        <p className="mt-2 break-words text-[13px] font-semibold leading-5 text-[#392648]">{detail.formula}</p>
                    </section>
                    <section aria-label="Calculation details" className="overflow-hidden rounded-xl border border-[#E6DDF0]">
                        <div className="flex justify-between gap-2 bg-[#FFFCF8] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]"><span>Breakdown</span><span>Amount</span></div>
                        <dl className="divide-y divide-[#F1ECF4]">
                            {detail.items.map(([name,amount])=>(
                                <div key={name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-[12px]">
                                    <dt className="min-w-0 flex-1 text-[#5F4E75]">{name}</dt>
                                    <dd className="break-words text-right font-semibold tabular-nums text-[#25153D]">{amountText(amount)}</dd>
                                </div>
                            ))}
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#F8F5FC] px-4 py-3">
                                <dt className="text-[12px] font-bold text-[#25153D]">{isLoss?"Gross Loss":"Total"}</dt>
                                <dd className={`break-words text-right text-[17px] font-bold tabular-nums ${isLoss?"text-[#B42318]":"text-[#25153D]"}`}>{amountText(detail.amount)}</dd>
                            </div>
                        </dl>
                    </section>
                    <div className="flex items-start gap-2 rounded-xl bg-[#FAF8FC] px-3 py-3">
                        <Info size={15} className="mt-0.5 shrink-0 text-[#806A8C]" aria-hidden="true"/>
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-[#5F4E75]">How this is calculated</p>
                            <p className="mt-1 text-[11px] leading-[1.6] text-[#6C5E76]">{detail.description}</p>
                        </div>
                    </div>
                </div>
                <footer className="flex justify-end border-t border-[#EEE7F5] px-5 py-3 sm:px-6">
                    <button type="button" onClick={onClose} className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#1B0D31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]">Close</button>
                </footer>
            </div>
        </dialog>
    );
}
function OwnerTableEmpty({connected,empty}:{connected:boolean;empty:string}) {
    return <div className="flex min-h-[150px] items-center justify-center px-4 text-center text-[11px] text-[#86778F]">{connected?empty:"Ranking data unavailable. Refresh to try again."}</div>;
}
type OwnerRankRow = {key:string;name:string;secondary:string;count:number;revenue:number};
function OwnerRankingPanel({title,icon,tone,rows,countLabel,period,onPeriodChange,onViewAll,onExport}:{title:string;icon:React.ReactNode;tone:OwnerIconTone;rows:OwnerRankRow[]|null;countLabel:string;period:PeriodOption;onPeriodChange:(v:PeriodOption)=>void;onViewAll:()=>void;onExport:()=>void}) {
    return <div className="flex min-h-[250px] min-w-0 flex-col overflow-visible rounded-2xl border border-[#E7DFEC] bg-white shadow-sm">
        <div className="flex min-h-[56px] min-w-0 flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
            <div className="flex min-w-0 flex-1 basis-[150px] items-center gap-2.5">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${ownerIconTones[tone].icon}`} aria-hidden="true">{icon}</span>
                <h3 className="min-w-0 whitespace-normal break-words text-[15px] font-bold leading-5 text-[#1A1220]">{title}</h3>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
                <select aria-label={`${title} period`} value={period} onChange={e=>onPeriodChange(e.target.value as PeriodOption)} className={filterClass}><option value="month">This Month</option><option value="quarter">This Quarter</option><option value="year">This Year</option></select>
                <OwnerExportButton label={title} onExport={onExport} disabled={!rows || rows.length===0}/>
            </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto">{rows === null?<OwnerTableEmpty connected={false} empty=""/>:rows.length===0?<OwnerTableEmpty connected={true} empty="No revenue recorded for this period."/>:<table className="w-full text-left text-[11px]"><thead className="bg-[#FFFCF7] uppercase text-[10px] text-[#806A8C]"><tr><th className="px-3 py-2">#</th><th className="px-2 py-2">{countLabel==="Bookings"?"Package":"Product"}</th><th className="px-2 py-2 text-right">{countLabel}</th><th className="px-3 py-2 text-right">Revenue</th></tr></thead><tbody>{rows.slice(0,5).map((r,i)=><tr key={r.key} className="border-t border-[#F1ECF4]"><td className="px-3 py-2 text-[#5A476A]">{i+1}</td><td className="max-w-[185px] px-2 py-2"><span className="block truncate font-semibold text-[#392648]" title={r.name}>{r.name}</span></td><td className="px-2 py-2 text-right">{r.count.toLocaleString("en-PH")}</td><td className="whitespace-nowrap px-3 py-2 text-right font-bold">{peso(r.revenue)}</td></tr>)}</tbody></table>}</div>
        <button type="button" onClick={onViewAll} className="border-t border-[#F1ECF4] px-4 py-2 text-right text-[11px] font-semibold text-[#6D35D4] hover:bg-[#FAF7FE]">View full report</button>
    </div>;
}