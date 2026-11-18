"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Building2, RefreshCw, TrendingUp, Package, Gift, Armchair, Download, ShoppingCart, CalendarDays } from "lucide-react";
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
    const profitNote=current?.profit!=null&&current.profit<0?(current.estimated?"Estimated loss: costs exceed sales":"Loss: costs exceed sales"):(current?.estimated?"Based on current booking costs":"Sales less cost of sales");
    const profitTitle="Gross Profit";
    const costBasis=(current?.estimated?"Booking costs use the Manager’s current Cost Price, so past profits may change. ":"Walk-in costs use saved sale prices for costs. ")+"Other expenses and tax adjustments are not included." + (data && data.rentalCostMethod!=="manual_unit_cost_per_rental" ? " Deploy the updated POS Lambda to use the revised rental cost calculation." : "");
    const details:Record<OwnerKpiKey,OwnerKpiDetail>={
        sales:{title:"Total Sales",amount:current?.sales??null,period,formula:"Total Sales = Booking Sales + Walk-In Sales",items:[["Booking Sales",current?.booking??null],["Walk-In Sales",current?.walk??null]],description:"Completed bookings by event date and completed POS orders by order date. Booking sales use the agreed price (or saved package price if absent), excluding separately collected deposits and settlement adjustments."},
        profit:{title:profitTitle,amount:current?.profit??null,period,formula:"Gross Profit = Total Sales − Cost of Sales",items:[["Total Sales",current?.sales??null],["Less: Cost of Sales",current?.cost??null]],description:costBasis},
        booking:{title:"Booking Sales",amount:current?.booking??null,period,formula:"Sum of agreed prices of completed bookings",items:[["Booking Sales",current?.booking??null]],description:"Only completed bookings; filtered by event date. Uses agreed price or the saved package price if absent."},
        walk:{title:"Walk-In Sales",amount:current?.walk??null,period,formula:"Sum of completed walk-in POS order totals",items:[["Walk-In Sales",current?.walk??null]],description:"Only completed walk-in POS orders in the reporting period."}
    };
    const cards:{key:OwnerKpiKey;title:string;value:Amount;note:string;icon:React.ReactNode;tone:"purple"|"green"|"blue"}[]=[
        {key:"sales",title:"Total Sales",value:current?.sales??null,note:period,icon:<BarChart3 size={24}/>,tone:"purple"},
        {key:"profit",title:profitTitle,value:current?.profit??null,note:current?.profit==null?"Required cost data unavailable":profitNote,icon:<TrendingUp size={24}/>,tone:"green"},
        {key:"booking",title:"Booking Sales",value:current?.booking??null,note:period,icon:<CalendarDays size={24}/>,tone:"purple"},
        {key:"walk",title:"Walk-In Sales",value:current?.walk??null,note:period,icon:<ShoppingCart size={24}/>,tone:"blue"}
    ];
    const chartRange=trend.length?`${shortDate(trend[0].start)} – ${shortDate(trend[trend.length-1].end)}`:"Unavailable";
    const rankPanels=[{title:"Top Consumable Products",icon:<Package size={18}/>,rows:data?.topProducts[consumablePeriod]??null,countLabel:"Units Sold",period:consumablePeriod,change:setConsumablePeriod,file:"owner_top_consumable_products"},{title:"Top Booking Packages",icon:<Gift size={18}/>,rows:rankings?.packages[packagePeriod]??null,countLabel:"Bookings",period:packagePeriod,change:setPackagePeriod,file:"owner_top_booking_packages"},{title:"Top Rented Products",icon:<Armchair size={18}/>,rows:rankings?.rentals[rentalPeriod]??null,countLabel:"Units Rented",period:rentalPeriod,change:setRentalPeriod,file:"owner_top_rented_products"}];
    return <><header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur"><div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"><div><h1 className="text-[25px] font-bold text-[#1A1220]">Owner Dashboard</h1><p className="mt-0.5 text-xs text-[#766983]">Sales and financial overview across all branches.</p></div><div className="flex items-center gap-2.5"><time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{formatCurrentDashboardDateTime(now)}</time><button type="button" disabled={refreshing} onClick={()=>setRefresh(v=>v+1)} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"><RefreshCw size={16} className={refreshing?"animate-spin":""}/>{refreshing?"Refreshing...":"Refresh"}</button></div></div></header>
        <main aria-busy={loading} className="space-y-4 px-5 py-5 font-sans">
            {error&&<div role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{error}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(k=>loading?<div key={k.key} className="flex min-h-[146px] items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm animate-pulse"><span className="h-14 w-14 shrink-0 rounded-full bg-[#EEE8F3]"/><span className="flex-1 space-y-3"><span className="block h-3.5 w-24 rounded bg-[#EEE8F3]"/><span className="block h-7 w-28 rounded bg-[#EEE8F3]"/></span></div>:<OwnerFinancialCard key={k.key} title={k.title} value={peso(k.value)} note={k.note} icon={k.icon} iconTone={k.tone} onClick={()=>setSelectedKpi(k.key)}/>)}</div>
            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section className={`${panelClass} flex flex-col p-4`}><OwnerPanelTitle title="Sales Overview Chart" subtitle={chartRange} icon={<BarChart3 size={18}/>} action={<><select aria-label="Sales overview interval" className={filterClass} value={chartPeriod} onChange={e=>setChartPeriod(e.target.value as ChartPeriod)}>{(["monthly","weekly","yearly"] as const).map(p=><option key={p} value={p}>{p[0].toUpperCase()+p.slice(1)}</option>)}</select><OwnerExportButton label="Sales Overview" disabled={!trend.length} onExport={()=>downloadOwnerReport("owner_sales_overview_"+chartPeriod+".csv",["From","To","Total Sales PHP","Booking Sales PHP","Walk-In Sales PHP"],trend.map(r=>[r.start,r.end,r.sales,r.booking,r.walk]),chartRange)}/></>}/><div className="mt-3 flex flex-1 flex-col justify-center"><SalesOverview data={trend} loading={loading}/></div></section>
                <section className={`${panelClass} flex flex-col`}><div className="border-b border-[#E9E1EE] px-4 py-3.5"><OwnerPanelTitle title="Branch Sales Performance" subtitle={periodLabel(branchPeriod,today)} icon={<Building2 size={18}/>} action={<><select aria-label="Branch performance period" className={filterClass} value={branchPeriod} onChange={e=>setBranchPeriod(e.target.value as PeriodOption)}><option value="month">This Month</option><option value="quarter">This Quarter</option><option value="year">This Year</option></select><OwnerExportButton label="Branch Sales Performance" disabled={!branches.length} onExport={()=>downloadOwnerReport("owner_branch_sales_"+branchPeriod+".csv",["Branch","Total Sales PHP","Booking Sales PHP","Walk-In Sales PHP","Gross Profit PHP","Cost Basis"],branches.map(r=>[r.name,r.sales,r.booking,r.walk,r.profit,r.estimated?"Estimated booking costs": "Recorded POS costs"]),periodLabel(branchPeriod,today))}/></>}/></div>
                    <div className="max-h-[248px] min-h-0 overflow-auto"><table className="w-full min-w-[500px] text-center [&_th]:px-2 [&_td]:px-2"><thead className="sticky top-0 bg-[#FFFCF8]"><tr>{["Branch","Total Sales","Booking Sales","Walk-In Sales","Gross Profit"].map(h=><th key={h} className={headerCell}>{h}</th>)}</tr></thead><tbody>{branches.map(r=><tr key={r.id} className="border-t border-[#E9E1EE] hover:bg-[#FBF8FE]"><td className="px-4 py-2 text-left text-[11px] font-semibold text-[#2B174C]">{r.name}</td><td className={bodyCell}>{peso(r.sales)}</td><td className={bodyCell}>{peso(r.booking)}</td><td className={bodyCell}>{peso(r.walk)}</td><td className={bodyCell}>{peso(r.profit)}</td></tr>)}{!branches.length&&<tr><td colSpan={5} className="px-4 py-8 text-xs text-[#86778F]">{loading?"Loading branches...":data?"No branches found.":"Branch sales unavailable."}</td></tr>}</tbody></table></div></section>
            </div>
            {rankError&&<p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{rankError}</p>}
            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">{rankPanels.map(p=><OwnerRankingPanel key={p.title} title={p.title} icon={p.icon} rows={p.rows} countLabel={p.countLabel} period={p.period} onPeriodChange={p.change} onViewAll={()=>router.push("/analytics")} onExport={()=>downloadOwnerReport(p.file+"_"+p.period+".csv",["Rank",p.countLabel==="Bookings"?"Package":"Product",p.countLabel,"Revenue PHP"],(p.rows??[]).slice(0,5).map((r,i)=>[i+1,r.name,r.count,r.revenue]),periodLabel(p.period,today))}/>)}</div>
        </main>{selectedKpi&&<OwnerKpiDetailModal detail={details[selectedKpi]} onClose={()=>setSelectedKpi(null)}/>}</>;
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
/** Export the existing loaded dataset through the same StockNBook PDF module as Staff and Manager. */
function downloadOwnerReport(filename: string, headers: string[], rows: OwnerCsvCell[][], dateRange: string) {
    const reportName = filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim();
    const table: ExportTable = {
        title: reportName,
        headers,
        rows: rows.map(row => row.map(cell => {
            const value = String(cell ?? "");
            // Protect Excel from formulas embedded in text stored in database records.
            return /^[\s]*[=+@\t\r]/.test(value) || /^[\s]*-(?![0-9]+(?:\.[0-9]+)?$)/.test(value) ? "'" + value : value;
        })),
    };
    const context: ExportContext = {
        storeName: getSavedItem("store_name") || getSavedItem("stocknbook_store_name") || "StockNBook",
        branch: "All Branches",
        dateRange,
    };
    const prefix = filename.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    void import("./_shared").then(module => {
        return module.exportTableAsPdf(table, context, prefix);
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

function OwnerPanelTitle({title,subtitle,icon,action}:{title:string;subtitle:string;icon:React.ReactNode;action?:React.ReactNode}) {
    return <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#6D35D4]">{icon}</span>
            <div className="min-w-0"><h3 className="truncate text-[15px] font-bold text-[#1A1220]" title={title}>{title}</h3><p className="truncate text-[11px] text-[#86778F]" title={subtitle}>{subtitle}</p></div>
        </div>{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>;
}
function OwnerFinancialCard({title,value,note,icon,iconTone,onClick}:{title:string;value:string;note:string;icon:React.ReactNode;iconTone:"purple"|"green"|"blue";onClick:()=>void}) {
    const tones={purple:"bg-[#F1ECFF] text-[#5F35D8]",green:"bg-[#E5F8EC] text-[#23834A]",blue:"bg-[#E9F2FF] text-[#1E6FE8]"};
    return <button type="button" onClick={onClick} aria-label={`View how ${title} is calculated`} className="flex min-h-[146px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm transition hover:border-[#CBB8EC] focus-visible:ring-2 focus-visible:ring-[#BFA8E2]">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${tones[iconTone]}`} aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{title}</span><span className={`mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] tabular-nums ${value.startsWith("-")||value.startsWith("−")?"text-[#B42318]":"text-[#1A1220]"}`}>{value}</span><span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{note}</span></span>
    </button>;
}
function OwnerKpiDetailModal({detail,onClose}:{detail:OwnerKpiDetail;onClose:()=>void}) {
    const amountText = (amount:number|null) => amount === null ? "Unavailable" : amount < 0 ? `−${peso(Math.abs(amount))}` : peso(amount);
    return <div role="presentation" className="fixed inset-0 z-[80] flex items-center justify-center bg-[#170B29]/55 p-4" onMouseDown={event => {if(event.target===event.currentTarget)onClose();}}>
        <div role="dialog" aria-modal="true" aria-label={`${detail.title} calculation`} className="w-full max-w-[530px] rounded-2xl border border-[#E7DFEC] bg-white font-sans shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#EEE7F5] px-5 py-4">
                <div><h3 className="text-[17px] font-bold text-[#1A1220]">{detail.title} — Calculation</h3><p className="mt-1 text-[11px] text-[#86778F]">{detail.period}</p></div>
                <button type="button" aria-label="Close calculation" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-[#766484] hover:bg-[#F6F0FC]">×</button>
            </div>
            <div className="space-y-4 px-5 py-4">
                <div className="rounded-xl bg-[#FAF7FC] p-4"><p className="text-[11px] font-semibold text-[#6D35D4]">Formula</p><p className="mt-1 text-[13px] font-semibold text-[#342140]">{detail.formula}</p></div>
                <div className="space-y-3">{detail.items.map(([name,amount])=><div key={name} className="flex items-start justify-between gap-4 text-[12px]"><span className="text-[#6C5E76]">{name}</span><strong className="text-right text-[#342140]">{amountText(amount)}</strong></div>)}</div>
                <div className="flex items-center justify-between border-t border-[#EEE7F5] pt-3 text-[13px]"><strong className="text-[#342140]">{detail.title.startsWith("Gross Profit") ? detail.amount!==null&&detail.amount<0?"Gross Loss (negative profit)":"Gross Profit" : "Total"}</strong><strong className={`text-[18px] ${detail.amount!==null&&detail.amount<0?"text-[#B42318]":"text-[#1A1220]"}`}>{amountText(detail.amount)}</strong></div>
            </div>
            <div className="flex justify-end border-t border-[#EEE7F5] px-5 py-3"><button type="button" onClick={onClose} className="rounded-lg border border-[#E6DDF0] px-4 py-2 text-[12px] font-semibold text-[#2B174C] hover:bg-[#FAF7FE]">Close</button></div>
        </div>
    </div>;
}
function OwnerTableEmpty({connected,empty}:{connected:boolean;empty:string}) {
    return <div className="flex min-h-[150px] items-center justify-center px-4 text-center text-[11px] text-[#86778F]">{connected?empty:"Ranking data unavailable. Refresh to try again."}</div>;
}
type OwnerRankRow = {key:string;name:string;secondary:string;count:number;revenue:number};
function OwnerRankingPanel({title,icon,rows,countLabel,period,onPeriodChange,onViewAll,onExport}:{title:string;icon:React.ReactNode;rows:OwnerRankRow[]|null;countLabel:string;period:PeriodOption;onPeriodChange:(v:PeriodOption)=>void;onViewAll:()=>void;onExport:()=>void}) {
    return <div className="flex min-h-[250px] min-w-0 flex-col overflow-visible rounded-2xl border border-[#E7DFEC] bg-white shadow-sm">
        <div className="flex min-h-[56px] min-w-0 flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
            <div className="flex min-w-0 flex-1 basis-[150px] items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#6D35D4]">{icon}</span>
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