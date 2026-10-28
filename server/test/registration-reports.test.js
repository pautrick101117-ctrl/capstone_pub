import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildHouseholdMembers, censusDate } from '../src/lib/census.js';
import { publicationDate } from '../src/lib/publication.js';
import { loadReport, reportRange, reportCell } from '../src/lib/reports.js';
import { createWorkbook } from '../src/lib/auditExcel.js';
import { toManilaDateTimeInput, fromManilaDateTimeInput } from '../../client/src/lib/format.js';

const person = {firstName:'Ana',lastName:'Cruz',relationship:'Head',birthdate:'1990-01-01',sex:'female',isHead:true};
test('census registration validates all people, permits minors, and requires exactly one head',()=>{
  const child={...person,firstName:'Ben',birthdate:'2015-01-01',relationship:'Child',isHead:false,isPwd:'false'};
  const members=buildHouseholdMembers([child,person]);
  assert.equal(members[0].is_head,true);
  assert.equal(members[1].birthdate,'2015-01-01');
  assert.equal(members[1].is_pwd,false);
  assert.throws(()=>buildHouseholdMembers([]),/at least/);
  assert.throws(()=>buildHouseholdMembers([{...person,isHead:false}]),/exactly one/);
  assert.throws(()=>buildHouseholdMembers([person,person]),/exactly one/);
  assert.throws(()=>buildHouseholdMembers([{...person,sex:''}]),/valid sex/);
  assert.throws(()=>buildHouseholdMembers([{...person,birthdate:''}]),/Birthdate is required/);
  assert.throws(()=>censusDate('2025-02-29','Birthdate'),/invalid/);
  assert.throws(()=>censusDate('9999-01-01','Birthdate'),/future/);
  assert.equal(censusDate('','Resident since'),null);
});

test('news supports past publication dates, rejects future/invalid dates, and preserves Philippine time',()=>{
  const now=new Date('2026-10-28T10:00:00Z');
  assert.equal(publicationDate('',now),now.toISOString());
  assert.equal(publicationDate('2026-10-01',now),'2026-09-30T16:00:00.000Z');
  assert.equal(publicationDate('2026-10-01T15:30:00+08:00',now),'2026-10-01T07:30:00.000Z');
  assert.throws(()=>publicationDate('2026-02-31',now),/valid publication/);
  assert.throws(()=>publicationDate('2026-11-01',now),/past or present/);
  assert.throws(()=>publicationDate('2026-10-01T12:00',now),/time zone/);
  const input=toManilaDateTimeInput('2026-10-27T23:30:00Z');
  assert.equal(input,'2026-10-28T07:30');
  assert.equal(fromManilaDateTimeInput(input),'2026-10-27T23:30:00.000Z');
});

test('report range includes the entire final day in Philippine time',()=>{
  assert.deepEqual(reportRange({from:'2026-10-01',to:'2026-10-28'}),{
    from:'2026-10-01',to:'2026-10-28',start:'2026-09-30T16:00:00.000Z',end:'2026-10-28T16:00:00.000Z',
  });
  assert.throws(()=>reportRange({from:'2026-02-30'}),/valid report/);
  assert.throws(()=>reportRange({from:'2026-10-28',to:'2026-10-01'}),/valid report/);
  assert.equal(reportCell({is_active:false},'is_active'),'No');
  assert.equal(reportCell({users:{full_name:'Ana'}},'users.full_name'),'Ana');
});

const database = ({rows=Array.from({length:750},(_,id)=>({id,full_name:`Resident ${id}`})),count=rows.length,short=false}={}) => {
  const calls=[];
  return {calls,from(table){
    const query={select(fields){assert.ok(!fields.includes('*')&&!fields.includes('password'));calls.push({table,fields});return query;},
      order(){return query;},eq(){return query;},gte(){return query;},lt(){return query;},lte(){return query;},
      async range(from,to){return {data:rows.slice(from,short?from+1:to+1),count,error:null};}};
    return query;
  }};
};
test('reports fetch all pages and reject unknown, oversized, or incomplete results',async()=>{
  const db=database();
  const report=await loadReport(db,'residents');
  assert.equal(report.rows.length,750);
  assert.equal(db.calls.length,2);
  assert.equal(report.rows[749][1],'Resident 749');
  await assert.rejects(loadReport(db,'unknown'),error=>error.status===400);
  await assert.rejects(loadReport(database({count:10001}),'residents'),error=>error.status===422);
  await assert.rejects(loadReport(database({short:true}),'residents'),error=>error.status===409);
  await assert.rejects(loadReport(database({count:null}),'residents'),error=>error.status===503);
});

const unzip = (buffer) => {
  const files={};let position=0;
  while(buffer.readUInt32LE(position)===0x04034b50){
    const size=buffer.readUInt32LE(position+18),nameLength=buffer.readUInt16LE(position+26),extraLength=buffer.readUInt16LE(position+28);
    const name=buffer.subarray(position+30,position+30+nameLength).toString();
    const start=position+30+nameLength+extraLength;
    files[name]=inflateRawSync(buffer.subarray(start,start+size)).toString();position=start+size;
  }
  return files;
};
test('Excel reports contain every row, real numeric cells, and inert text rather than formulas',()=>{
  const workbook=createWorkbook([{name:'Report',rows:[['Name','Amount'],['=HYPERLINK("bad")',125.5],['<script>',0]]},
    {name:'Report Details',rows:[['Count'],[2]]}]);
  const files=unzip(workbook);
  assert.match(files['xl/workbook.xml'],/name="Report Details"/);
  const sheet=files['xl/worksheets/sheet1.xml'];
  assert.match(sheet,/<v>125\.5<\/v>/);
  assert.match(sheet,/&apos;=HYPERLINK/);
  assert.match(sheet,/&lt;script&gt;/);
  assert.doesNotMatch(sheet,/<f>/);
  assert.equal((sheet.match(/<row /g)||[]).length,3);
});
