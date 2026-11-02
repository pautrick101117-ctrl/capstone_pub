export const emptyHouseholdMember = (isHead = false) => ({
  firstName:'',middleName:'',lastName:'',suffix:'',relationship:isHead?'Head':'',isHead,
  birthdate:'',sex:'',civilStatus:'',occupation:'',userId:'',
  isSenior:false,isPwd:false,isSoloParent:false,is4ps:false,isRegisteredVoter:false,
});

