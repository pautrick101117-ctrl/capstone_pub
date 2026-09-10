begin;

-- Fresh start for resident-linked and voting/request activity.
delete from borrowing_requests;
delete from complaints;
-- Keeps admin accounts plus public reference content such as officials, funds, news, and events.

delete from project_completions;
delete from votes;
delete from election_options;
delete from elections;

delete from request_timeline;
delete from id_requests;
delete from project_suggestions;
delete from requests;

delete from notifications;
delete from verification_codes;
delete from audit_logs;

delete from users
where role = 'resident';

update users
set has_voted = false,
    must_change_password = false,
    updated_at = now()
where role = 'admin';

commit;
