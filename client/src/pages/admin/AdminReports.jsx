import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { downloadReport, printReport } from '../../lib/reportOutput';
import { formatDateTime } from '../../lib/format';
import { useAuth } from '../../context/auth';
import { useToast } from '../../context/toast';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SelectInput, TableShell, TextInput } from '../../components/ui';

const pageSize=25;
const AdminReports = () => {
  const {token}=useAuth();
  const toast=useToast();
  const [types,setTypes]=useState([]);
  const [filters,setFilters]=useState({type:'residents',from:'',to:''});
  const [report,setReport]=useState(null);
  const [loading,setLoading]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [error,setError]=useState('');
  const [page,setPage]=useState(1);
  const requestId=useRef(0);
  useEffect(()=>{
    let active=true;
    api('/admin/reports',{token}).then(data=>{if(active)setTypes(data.types || []);}).catch(err=>{if(active)setError(err.message);});
    return ()=>{active=false;};
  },[token]);
  const changeFilter=(key,value)=>{
    requestId.current++;
    setFilters(current=>({...current,[key]:value}));setReport(null);setLoading(false);setError('');setPage(1);
  };
  const generate=async(event)=>{
    event?.preventDefault();
    const id=++requestId.current;
    setLoading(true);setError('');setReport(null);
    try {
      const query=new URLSearchParams({from:filters.from,to:filters.to});
      const data=await api(`/admin/reports/${filters.type}?${query}`,{token});
      if(id===requestId.current){setReport(data.report);setPage(1);}
    }catch(err){if(id===requestId.current)setError(err.message);}
    finally{if(id===requestId.current)setLoading(false);}
  };
  const exportExcel=async()=>{
    setExporting(true);
    try{await downloadReport(report.type,{from:report.from,to:report.to},token);toast.success('Excel report downloaded.');}
    catch(err){toast.error(err.message);}
    finally{setExporting(false);}
  };
  const print=()=>{try{printReport(report);}catch(err){toast.error(err.message);}};
  const retry=event=>{
    if(types.length)return generate(event);
    setError('');
    api('/admin/reports',{token}).then(data=>setTypes(data.types || [])).catch(err=>setError(err.message));
  };
  return <div className="space-y-6">
    <PageHeader eyebrow="Barangay Records" title="Reports" description="Generate a report, review all matching records, then print or export to Excel." actions={<>
      <Button variant="secondary" disabled={!report || loading} onClick={print}><Printer className="h-4 w-4"/>Print Report</Button>
      <Button variant="secondary" disabled={!report || loading} loading={exporting} onClick={exportExcel}><Download className="h-4 w-4"/>Export Excel</Button>
    </>}/>
    <Card><form onSubmit={generate} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SelectInput label="Report Type" value={filters.type} onChange={e=>changeFilter('type',e.target.value)} disabled={!types.length}>
        {!types.length?<option value="residents">Loading report types...</option>:types.map(type=><option key={type.value} value={type.value}>{type.label}</option>)}
      </SelectInput>
      <TextInput label="From (optional)" type="date" max={filters.to || undefined} value={filters.from} onChange={e=>changeFilter('from',e.target.value)}/>
      <TextInput label="To (optional)" type="date" min={filters.from || undefined} value={filters.to} onChange={e=>changeFilter('to',e.target.value)}/>
      <div className="flex items-end"><Button type="submit" loading={loading} disabled={!types.length}><FileSpreadsheet className="h-4 w-4"/>Generate Report</Button></div>
    </form><p className="mt-3 text-xs text-stone-500">Date filters use Philippine time. Leave dates blank for all records. Print and Excel include every matching record, across all preview pages.</p></Card>
    {error?<ErrorState description={error} onRetry={retry}/>:loading?<LoadingState rows={5}/>:!report?<EmptyState title="Choose a report" description="Select a record type and optional date range, then generate your report."/>:
      <Card><div className="mb-4"><h2 className="text-xl font-bold text-[var(--brand-900)]">{report.title}</h2><p className="mt-1 text-sm text-stone-500">{report.total} records · Generated {formatDateTime(report.generatedAt)}</p></div>
        {!report.rows.length?<EmptyState title="No matching records" description="Try another report type or date range."/>:<>
          <TableShell><table className="min-w-full text-left text-sm"><thead className="bg-stone-50"><tr>{report.columns.map((column,i)=><th key={i} className="whitespace-nowrap px-4 py-3">{column}</th>)}</tr></thead>
            <tbody>{report.rows.slice((page-1)*pageSize,page*pageSize).map((row,index)=><tr key={index} className="border-t border-stone-100">{row.map((value,i)=><td key={i} className="max-w-xs whitespace-pre-wrap break-words px-4 py-3">{String(value ?? '')}</td>)}</tr>)}</tbody>
          </table></TableShell><Pagination page={page} totalPages={Math.max(1,Math.ceil(report.total/pageSize))} onPageChange={setPage}/>
        </>}
      </Card>}
  </div>;
};
export default AdminReports;
