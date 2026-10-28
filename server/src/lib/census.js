const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const text = (value, label, limit = 160) => {
  const result = String(value || '').trim();
  if (result.length > limit) fail(`${label} is too long.`);
  return result;
};

export const censusDate = (value, label) => {
  if (!value) return null;
  const raw = String(value);
  const date = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) fail(`${label} is invalid.`);
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  if (raw > today) fail(`${label} cannot be in the future.`);
  return raw;
};

export const buildHouseholdMember = (body = {}) => {
  const member = {
    first_name: text(body.firstName, 'First name', 100), middle_name: text(body.middleName, 'Middle name', 100),
    last_name: text(body.lastName, 'Last name', 100), suffix: text(body.suffix, 'Suffix', 20),
    relationship: text(body.relationship, 'Relationship', 80),
    birthdate: censusDate(body.birthdate, 'Birthdate'), sex: body.sex || null,
    civil_status: text(body.civilStatus, 'Civil status', 40) || null,
    occupation: text(body.occupation, 'Occupation') || null,
    user_id: body.userId || null, is_head: body.isHead === true,
    is_senior: body.isSenior === true, is_pwd: body.isPwd === true,
    is_solo_parent: body.isSoloParent === true, is_4ps: body.is4ps === true,
    is_registered_voter: body.isRegisteredVoter === true,
  };
  if (!member.first_name || !member.last_name || !member.relationship) fail('First name, last name and relationship are required for each member.');
  if (!member.birthdate) fail('Birthdate is required for each household member.');
  if (!['male', 'female', 'other', 'prefer_not_to_say'].includes(member.sex)) fail('Select a valid sex for each household member.');
  if (member.user_id && !/^[0-9a-f-]{36}$/i.test(member.user_id)) fail('Select a valid linked resident account.');
  return member;
};

export const buildHouseholdMembers = (rows) => {
  if (!Array.isArray(rows) || rows.length < 1) fail('Record at least the head of household.');
  const members = rows.map(buildHouseholdMember);
  if (members.filter(member => member.is_head).length !== 1) fail('Select exactly one head of household.');
  return members.sort((a, b) => Number(b.is_head) - Number(a.is_head));
};

export const censusConflict = (error) => error?.code === '23505'
  ? Object.assign(new Error('This household reference or household at this address is already registered. Edit the existing record.'), { status: 409, code: 'DUPLICATE_HOUSEHOLD' }) : error;
