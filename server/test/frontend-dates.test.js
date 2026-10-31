import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDate,formatDateTime,toManilaDateTimeInput,fromManilaDateTimeInput,countdownText} from '../../client/src/lib/format.js';
test('invalid historical dates cannot crash frontend pages and Manila input conversion rejects nonexistent days',()=>{
 assert.equal(formatDate('not-a-date'),'Invalid date');assert.equal(formatDateTime('not-a-date'),'Invalid date');
 assert.equal(toManilaDateTimeInput('not-a-date'),'');assert.equal(fromManilaDateTimeInput('2026-02-30T10:00'),'');
 assert.equal(fromManilaDateTimeInput('2026-10-31T10:00'),'2026-10-31T02:00:00.000Z');
 assert.equal(countdownText('invalid'),'No deadline');
});
