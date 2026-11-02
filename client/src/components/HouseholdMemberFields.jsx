import { SelectInput, TextInput } from './ui';
import { useState } from 'react';
import OccupationSelect from './OccupationSelect';

export const HouseholdMemberFields = ({value,onChange,residents=[],allowHeadChange=true}) => {
  const [today] = useState(()=>new Date(Date.now()+8*3600_000).toISOString().slice(0,10));
  const change=(key,next)=>onChange({...value,[key]:next});
  return <>
    <TextInput label="First Name" required maxLength={100} value={value.firstName} onChange={e=>change('firstName',e.target.value)}/>
    <TextInput label="Middle Name" maxLength={100} value={value.middleName} onChange={e=>change('middleName',e.target.value)}/>
    <TextInput label="Last Name" required maxLength={100} value={value.lastName} onChange={e=>change('lastName',e.target.value)}/>
    <TextInput label="Suffix" maxLength={20} value={value.suffix} onChange={e=>change('suffix',e.target.value)}/>
    <TextInput label="Relationship to Head" required maxLength={80} readOnly={value.isHead} value={value.relationship} placeholder="Spouse, Child, Parent..." onChange={e=>change('relationship',e.target.value)}/>
    <TextInput label="Birthdate" type="date" required max={today} value={value.birthdate} onChange={e=>change('birthdate',e.target.value)}/>
    <SelectInput label="Sex" required value={value.sex} onChange={e=>change('sex',e.target.value)}><option value="">Select sex</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></SelectInput>
    <SelectInput label="Civil Status (optional)" value={value.civilStatus} onChange={e=>change('civilStatus',e.target.value)}><option value="">Not specified</option>{['Single','Married','Widowed','Separated','Other'].map(status=><option key={status} value={status}>{status}</option>)}</SelectInput>
    <OccupationSelect label="Occupation (optional)" value={value.occupation} onChange={(occupation) => change('occupation', occupation)} />
    <SelectInput label="Link to resident account (optional)" value={value.userId} onChange={e=>change('userId',e.target.value)}><option value="">No account / minor</option>{residents.filter(person=>person.role==='resident').map(person=><option key={person.id} value={person.id}>{person.fullName} ({person.username})</option>)}</SelectInput>
    <div className="sm:col-span-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{[
      ['isSenior','Senior citizen'],['isPwd','PWD'],['isSoloParent','Solo parent'],['is4ps','4Ps beneficiary'],['isRegisteredVoter','Registered voter'],
    ].map(([key,label])=><label key={key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(value[key])} onChange={e=>change(key,e.target.checked)}/>{label}</label>)}</div>
    {allowHeadChange?<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.isHead} onChange={e=>onChange({...value,isHead:e.target.checked,relationship:e.target.checked?'Head':value.relationship==='Head'?'':value.relationship})}/>Head of household (one only)</label>:null}
  </>;
};


