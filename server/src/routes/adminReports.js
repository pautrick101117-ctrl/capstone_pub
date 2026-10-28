import express from 'express';
import { requireSupabase } from '../lib/supabase.js';
import { REPORTS, loadReport } from '../lib/reports.js';
import { createWorkbook } from '../lib/auditExcel.js';
import { logAudit } from '../utils/audit.js';

// Mounted inside the authenticated admin router.
const router = express.Router();
router.get('/reports', (_req,res)=>res.json({types:Object.entries(REPORTS).map(([value,spec])=>({value,label:spec.label}))}));
router.get('/reports/:type', async(req,res,next)=>{
  try {
    if (req.query.format && req.query.format !== 'xlsx') throw Object.assign(new Error('Unsupported report format.'),{status:400});
    const report=await loadReport(requireSupabase(),req.params.type,req.query);
    res.setHeader('Cache-Control','no-store');
    await logAudit({actorId:req.currentUser.id,actorRole:req.currentUser.role,actorName:req.currentUser.full_name,
      action:req.query.format==='xlsx'?'export_report':'generate_report',entityType:'report',entityId:report.type,
      module:'reports',eventCategory:'activity',details:{from:report.from,to:report.to,records:report.total},required:true,req});
    if (req.query.format==='xlsx') {
      const workbook=createWorkbook([
        {name:'Report',rows:[report.columns,...report.rows],widths:report.columns.map(()=>24)},
        {name:'Report Details',rows:[['Field','Value'],['Report',report.title],['From',report.from||'All dates'],['To',report.to||'All dates'],
          ['Date Filter Time Zone','Asia/Manila'],['Generated (UTC)',report.generatedAt],['Records',report.total]]},
      ]);
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',`attachment; filename=barangay-${report.type}-${report.generatedAt.slice(0,10)}.xlsx`);
      return res.send(workbook);
    }
    res.json({report});
  }catch(error){next(error);}
});
export default router;
