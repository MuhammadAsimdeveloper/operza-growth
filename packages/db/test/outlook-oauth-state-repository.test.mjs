import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresOAuthStateStore} from '../lib/outlook-oauth-state-repository.mjs';

test('Postgres OAuth state stores encrypted PKCE verifier and consumes once in tenant context',async()=>{
  const rows=new Map(),queries=[];
  const client={async query(sql,p=[]){queries.push({sql,p});
    if(sql.startsWith('INSERT INTO provider_oauth_states')){rows.set(p[0],{actor_id:p[3],code_verifier_envelope:p[4],expires_at:p[5]});return{rows:[],rowCount:1};}
    if(sql.startsWith('DELETE FROM provider_oauth_states')){const row=rows.get(p[0]);rows.delete(p[0]);return{rows:row?[row]:[],rowCount:row?1:0};}
    return{rows:[],rowCount:1};},release(){}};
  const store=createPostgresOAuthStateStore({connect:async()=>client},{masterKey:'oauth-test-master-secret-2026'});
  const entry={stateHash:'a'.repeat(64),tenantId:'11111111-1111-4111-8111-111111111111',locationId:'22222222-2222-4222-8222-222222222222',actorId:'actor-1',codeVerifier:'v'.repeat(64),expiresAt:Date.now()+60_000};
  await store.create(entry);
  assert.ok(rows.get(entry.stateHash).code_verifier_envelope.startsWith('v1:'));
  assert.equal((await store.consume(entry)).codeVerifier,entry.codeVerifier);
  assert.equal(await store.consume(entry),null);
  assert.ok(queries.some(q=>q.sql.includes("set_config('app.agency_id'")));
});
