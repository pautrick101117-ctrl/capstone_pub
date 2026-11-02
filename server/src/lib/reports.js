const columns = (...items) => items.map(([label, key]) => ({ label, key }));
const definition = (label, table, fields, options = {}) => ({ label, table, columns: fields, dateColumn: 'created_at', ...options });
export const REPORTS = {
  residents: definition('Resident Registry', 'users', columns(
    ['Resident ID','id'],['Full Name','full_name'],['Birthdate','birthdate'],['Sex','sex'],['Civil Status','civil_status'],
    ['Citizenship','citizenship'],['Birthplace','place_of_birth'],['Occupation','occupation'],['Purok','purok'],['Address','address'],
    ['Contact Number','contact_number'],['Email','email'],['Resident Since','residency_since'],['Active','is_active'],['Registered','created_at']
  ), { filter: ['role','resident'] }),
  census: definition('Census Households', 'census_households', columns(
    ['Household ID','id'],['Household Reference','household_ref'],['Household Name','household_name'],['Purok','purok'],['Address','address'],
    ['Members','members'],['Contact Number','contact_number'],['Housing Tenure','housing_tenure'],['Resident Since','residency_since'],
    ['Membership Verified','membership_verified'],['Status','status'],['Registered','created_at']
  )),
  members: definition('Census Members', 'household_members', columns(
    ['Member ID','id'],['Household Reference','census_households.household_ref'],['Household Name','census_households.household_name'],
    ['First Name','first_name'],['Middle Name','middle_name'],['Last Name','last_name'],['Suffix','suffix'],['Relationship','relationship'],['Head','is_head'],
    ['Birthdate','birthdate'],['Sex','sex'],['Civil Status','civil_status'],['Occupation','occupation'],['Senior Citizen','is_senior'],['PWD','is_pwd'],
    ['Solo Parent','is_solo_parent'],['4Ps','is_4ps'],['Registered Voter','is_registered_voter'],['Recorded','created_at']
  ), { join: 'census_households(household_ref,household_name)' }),
  requests: definition('Document Requests', 'requests', columns(
    ['Request ID','id'],['Resident','users.full_name'],['Document Type','request_type'],['Details','details'],['Status','status'],['Submitted','created_at']
  ), { join:'users!requests_user_id_fkey(full_name)' }),
  id_requests: definition('Barangay ID Requests', 'id_requests', columns(
    ['Request ID','id'],['Resident','users.full_name'],['Purpose','purpose'],['Pickup Date','preferred_date'],['Time Slot','time_slot'],['Status','status'],['Submitted','created_at']
  ), { join:'users!id_requests_user_id_fkey(full_name)' }),
  concerns: definition('Community Concerns', 'complaints', columns(
    ['Concern ID','id'],['Resident','users.full_name'],['Category','complaint_type'],['Details','details'],['Status','status'],['Submitted','created_at']
  ), { join:'users!complaints_user_id_fkey(full_name)' }),
  borrowing: definition('Resource Borrowing', 'borrowing_requests', columns(
    ['Request ID','id'],['Resident','users.full_name'],['Resource','borrowable_assets.name'],['Quantity','quantity'],['Purpose','purpose'],['Status','status'],['Submitted','created_at']
  ), { join:'users!borrowing_requests_user_id_fkey(full_name),borrowable_assets(name)' }),
  fund_sources: definition('Fund Sources', 'fund_sources', columns(
    ['Source ID','id'],['Name','name'],['Term','term'],['Allocated Amount (PHP)','allocated_amount'],['Recorded','created_at']
  )),
  fund_projects: definition('Fund Expenditures', 'fund_projects', columns(
    ['Project ID','id'],['Name','name'],['Term','term'],['Amount (PHP)','amount'],['Description','description'],['Status','status'],['Project Date','date']
  ), {dateColumn:'date', dateOnly:true}),
  projects: definition('Community Projects', 'community_projects', columns(
    ['Project ID','id'],['Title','title'],['Description','description'],['Status','status'],['Progress (%)','progress_percentage'],['Recorded','created_at']
  )),
  voting: definition('Voting Posts', 'elections', columns(
    ['Election ID','id'],['Title','title'],['Description','description'],['Status','status'],['Starts','starts_at'],['Ends','ends_at'],['Result','result_kind'],['Recorded','created_at']
  )),
  audit: definition('Audit Activity', 'audit_logs', columns(
    ['Event ID','id'],['Date & Time','created_at'],['Actor','actor_name_snapshot'],['Role','actor_role'],['Action','action'],['Module','module'],['Outcome','outcome'],['Target','target_label']
  )),
};

const validDay = (raw) => /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0,10) === raw;
export const reportRange = ({from = '', to = ''} = {}) => {
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) {
    throw Object.assign(new Error('Choose a valid report date range.'), {status:400});
  }
  // Exclusive end includes the entire selected final day in Philippine time.
  const end = to ? new Date(new Date(`${to}T00:00:00+08:00`).getTime()+86400_000).toISOString() : '';
  return {from, to, start:from ? new Date(`${from}T00:00:00+08:00`).toISOString() : '', end};
};

export const reportCell = (row, key) => {
  const value = key.split('.').reduce((object, part) => object?.[part], row);
  if (value && key.endsWith('_at') && !Number.isNaN(Date.parse(value))) return new Intl.DateTimeFormat('en-PH',{
    timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
  }).format(new Date(value));
  return typeof value === 'boolean' ? value ? 'Yes' : 'No' : value ?? '';
};

export const loadReport = async (db, type, filters = {}) => {
  const spec = REPORTS[type];
  if (!spec) throw Object.assign(new Error('Choose a valid report type.'), {status:400});
  const range = reportRange(filters);
  const fields = [...new Set(['id',spec.dateColumn,...spec.columns.map(column=>column.key).filter(key=>!key.includes('.'))])].join(',');
  const select = `${fields}${spec.join ? `,${spec.join}` : ''}`;
  const records = [];
  let expected = null;
  for (let offset=0; expected === null || offset<expected; offset+=500) {
    let query = db.from(spec.table).select(select,{count:'exact'}).order(spec.dateColumn).order('id');
    if (spec.filter) query=query.eq(...spec.filter);
    if (range.from) query=query.gte(spec.dateColumn,spec.dateOnly ? range.from : range.start);
    if (range.to) query=spec.dateOnly ? query.lte(spec.dateColumn,range.to) : query.lt(spec.dateColumn,range.end);
    const {data,error,count} = await query.range(offset,offset+499);
    if (error) throw error;
    if (!Number.isInteger(count)) throw Object.assign(new Error('Unable to verify report completeness.'),{status:503});
    if (count>10000) throw Object.assign(new Error('More than 10,000 records match. Narrow the date range.'),{status:422});
    if (expected !== null && expected !== count) throw Object.assign(new Error('Report data changed. Generate it again.'),{status:409});
    expected=count;
    records.push(...(data || []));
    if (records.length<Math.min(offset+500,expected)) throw Object.assign(new Error('Incomplete report data. Please try again.'),{status:409});
  }
  return {type,title:spec.label,columns:spec.columns.map(column=>column.label),rows:records.map(row=>spec.columns.map(column=>reportCell(row,column.key))),
    from:range.from,to:range.to,total:records.length,generatedAt:new Date().toISOString()};
};

