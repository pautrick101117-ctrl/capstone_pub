import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../supabase-v4-reports-registration-fixes.sql',import.meta.url),'utf8');
const phase=readFileSync(new URL('../supabase-v4-phase10-5-data-security.sql',import.meta.url),'utf8');
const createDatabase=async()=>{
  const db=new PGlite();
  await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;
    create table users(id uuid primary key default gen_random_uuid(),role text);
    create table announcements(id uuid primary key default gen_random_uuid(),type text,created_at timestamptz default now());
    create table census_households(id uuid primary key default gen_random_uuid(),household_ref text,household_name text,purok text,address text,house_number text,
      members integer default 0,status text default 'active',contact_number text default '',housing_tenure text,residency_since date,
      membership_verified boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());`);
  await db.exec(phase.slice(phase.indexOf('CREATE TABLE IF NOT EXISTS public.household_members'),phase.indexOf('-- Disable the obsolete destructive RPC')));
  return db;
};
const household={household_ref:'HH-001',household_name:'Cruz Household',purok:'Purok 1',address:'12 Main Street',contact_number:'09171234567',housing_tenure:'owned',residency_since:'2020-01-01'};
const head={first_name:'Ana',last_name:'Cruz',relationship:'Head',birthdate:'1990-01-01',sex:'female',is_head:true,occupation:'Teacher'};
const child={first_name:'Ben',last_name:'Cruz',relationship:'Child',birthdate:'2015-01-01',sex:'male',is_head:false};

test('SQL enforces unique household identity and registers all members atomically',async()=>{
  const db=await createDatabase();
  try{
    await db.exec(sql);await db.exec(sql);
    const register=async(h,m)=>(await db.query('select * from bgy_register_census_household($1::jsonb,$2::jsonb)',[JSON.stringify(h),JSON.stringify(m)])).rows[0];
    const saved=await register(household,[child,head]);
    assert.equal(saved.members,2);assert.equal(saved.membership_verified,true);assert.equal(saved.contact_number,household.contact_number);
    await assert.rejects(register({...household,household_ref:' hh-001 ',address:'Other'},[head]),error=>error.code==='23505');
    await assert.rejects(register({...household,household_ref:'HH-002',household_name:' CRUZ  HOUSEHOLD ',address:'12  MAIN Street'},[head]),error=>error.code==='23505');
    const other=await register({...household,household_ref:'HH-002',household_name:'Reyes Household'},[head]);
    assert.equal(other.members,1);
    await assert.rejects(register({...household,household_ref:'HH-003',address:'Other'},[head,{...child,sex:''}]),error=>error.code==='22023');
    assert.equal((await db.query('select count(*)::int as count from census_households')).rows[0].count,2);
    await assert.rejects(db.query('update census_households set household_ref=$1 where id=$2',['hh-001',other.id]),error=>error.code==='23505');
    assert.equal((await db.query("select has_function_privilege('anon','bgy_register_census_household(jsonb,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select count(*)::int as count from pg_indexes where indexname in ('census_households_normalized_ref_uidx','census_households_identity_uidx')")).rows[0].count,2);
  }finally{await db.close();}
});

test('SQL preserves legacy duplicates and prevents additional duplicates',async()=>{
  const db=await createDatabase();
  try{
    await db.exec(`insert into census_households(household_ref,household_name,purok,address) values
      ('HH-X','Cruz Household','Purok 1','12 Main Street'),(' hh-x ','CRUZ  HOUSEHOLD','purok 1','12  MAIN Street');`);
    const result=await db.exec(sql);
    assert.equal(result.at(-1).rows.length,2);
    assert.equal((await db.query('select count(*)::int as count from census_households')).rows[0].count,2);
    await db.exec("update census_households set contact_number='09170000000'");
    await assert.rejects(db.exec("insert into census_households(household_ref,household_name,purok,address) values('HH-Y','Cruz Household','Purok 1','12 Main Street')"),error=>error.code==='23505');
  }finally{await db.close();}
});

test('persistent SQL rate window permits ten attempts and rejects the eleventh',async()=>{
  const db=await createDatabase();
  try{
    await db.exec(phase.slice(phase.indexOf('-- Persistent, atomic rate windows'),phase.indexOf('-- No new duplicate active requests')));
    const key='a'.repeat(64);
    const check=async(increment=true)=>(await db.query('select * from bgy_p105_rate_check($1,10,900,$2)',[key,increment])).rows[0];
    for(let attempt=1;attempt<=10;attempt++)assert.deepEqual(await check(),{allowed:true,retry_after:0,used:attempt});
    const blocked=await check();assert.equal(blocked.allowed,false);assert.ok(blocked.retry_after>0);assert.equal(blocked.used,10);
    assert.equal((await check(false)).allowed,false);
    await db.query('select bgy_p105_rate_clear($1)',[key]);assert.equal((await check()).used,1);
    await db.query("update bgy_rate_limit_counters set window_ends_at=now()-interval '1 second'");
    assert.equal((await check()).used,1);
  }finally{await db.close();}
});

