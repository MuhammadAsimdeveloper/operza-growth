import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutlookOAuthService,createMemoryOAuthStateStore,OUTLOOK_SCOPES } from '../src/outlook-oauth.mjs';

const config={clientId:'client-id',clientSecret:'client-secret',redirectUri:'https://operza.example/api/platform/oauth/outlook/callback',stateKey:'operza-oauth-test-master-key-2026'};
function resolver(initial={}) {
  const values=new Map(Object.entries(initial));
  return {values,async store(k,v){values.set(k,v);},async resolve(k){return values.get(k)||null;}};
}
const response=(status,data={})=>({ok:status>=200&&status<300,status,json:async()=>data});

test('authorization URL uses PKCE S256 and least-privilege Mail.Send delegated scope',async()=>{
  const secrets=resolver(),states=createMemoryOAuthStateStore();
  const service=createOutlookOAuthService({...config,secretResolver:secrets,stateStore:states});
  const started=await service.begin({tenantId:'agency_123',locationId:'location_123',actorId:'user_123'});
  const url=new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(url.searchParams.get('scope').includes('offline_access'));
  assert.ok(url.searchParams.get('scope').includes('Mail.Send'));
  assert.equal(OUTLOOK_SCOPES.includes('Mail.Read'),false);
});

test('callback exchanges PKCE code, verifies Graph mailbox and stores refresh token in vault',async()=>{
  const secrets=resolver(),states=createMemoryOAuthStateStore(),calls=[];
  const service=createOutlookOAuthService({...config,secretResolver:secrets,stateStore:states,fetchFn:async(url,opts)=>{
    calls.push({url,opts});
    return url.includes('/token')?response(200,{access_token:'access-1',refresh_token:'refresh-1',expires_in:3600}):
      response(200,{id:'graph-user',displayName:'Operza User',mail:'user@outlook.com'});
  }});
  const started=await service.begin({tenantId:'agency_123',locationId:'location_123',actorId:'user_123'});
  const state=new URL(started.authorizationUrl).searchParams.get('state');
  const result=await service.complete({code:'authorization-code-123',state,tenantId:'agency_123',locationId:'location_123',actorId:'user_123'});
  assert.equal(result.email,'user@outlook.com');
  const bundle=JSON.parse(secrets.values.get(result.secretRef));
  assert.equal(bundle.refreshToken,'refresh-1');
  assert.ok(new URLSearchParams(calls[0].opts.body).get('code_verifier').length>=43);
});

test('tampered or cross-tenant OAuth state is rejected before token exchange',async()=>{
  const secrets=resolver();let calls=0;
  const service=createOutlookOAuthService({...config,secretResolver:secrets,fetchFn:async()=>{calls++;return response(200,{})}});
  const started=await service.begin({tenantId:'agency_123',locationId:'location_123',actorId:'user_123'});
  const state=new URL(started.authorizationUrl).searchParams.get('state');
  await assert.rejects(()=>service.complete({code:'authorization-code-123',state:state+'x',tenantId:'agency_123',locationId:'location_123',actorId:'user_123'}),{code:'OUTLOOK_STATE_INVALID'});
  await assert.rejects(()=>service.complete({code:'authorization-code-123',state,tenantId:'other_agency',locationId:'location_123',actorId:'user_123'}),{code:'OUTLOOK_TENANT_CONTEXT_MISMATCH'});
  assert.equal(calls,0);
});

test('OAuth state is consumed once and cannot be replayed',async()=>{
  const secrets=resolver();
  const service=createOutlookOAuthService({...config,secretResolver:secrets,fetchFn:async url=>url.includes('/token')
    ? response(200,{access_token:'a',refresh_token:'r',expires_in:3600}):response(200,{id:'u',mail:'u@example.com'})});
  const started=await service.begin({tenantId:'agency_123',locationId:'location_123',actorId:'user_123'});
  const state=new URL(started.authorizationUrl).searchParams.get('state');
  await service.complete({code:'authorization-code-123',state,tenantId:'agency_123',locationId:'location_123',actorId:'user_123'});
  await assert.rejects(()=>service.complete({code:'authorization-code-123',state,tenantId:'agency_123',locationId:'location_123',actorId:'user_123'}),{code:'OUTLOOK_STATE_REPLAY'});
});

test('refreshes an expired access token and persists the rotated refresh token',async()=>{
  const ref='vault:agency_123/location_123/microsoft-outlook-1';
  const secrets=resolver({[ref]:JSON.stringify({accessToken:'old',refreshToken:'old-refresh',expiresAt:1000})});
  const service=createOutlookOAuthService({...config,secretResolver:secrets,now:()=>2000,fetchFn:async()=>response(200,{access_token:'new',refresh_token:'new-refresh',expires_in:3600})});
  assert.equal(await service.getAccessToken(ref),'new');
  assert.equal(JSON.parse(secrets.values.get(ref)).refreshToken,'new-refresh');
});

test('dispatch rechecks contact consent and only accepts Graph 202',async()=>{
  const ref='vault:agency_123/location_123/microsoft-outlook-1';
  const secrets=resolver({[ref]:JSON.stringify({accessToken:'valid',refreshToken:'refresh',expiresAt:Date.now()+300_000})});
  const calls=[];
  const service=createOutlookOAuthService({...config,secretResolver:secrets,fetchFn:async(url,opts)=>{
    calls.push({url,opts});return response(url.endsWith('/sendMail')?202:200,{id:'user',mail:'user@example.com'});
  }});
  const payload={contactId:'c1',purpose:'transactional',to:'person@example.com',subject:'Welcome',text:'Hello'};
  const consent={status:'granted',channel:'email',contactId:'c1',purpose:'transactional'};
  const denied=await service.adapter.dispatch({secretRef:ref,payload,consent:{...consent,status:'revoked'}});
  assert.equal(denied.code,'CONSENT_REQUIRED');assert.equal(calls.length,0);
  const sent=await service.adapter.dispatch({secretRef:ref,payload,consent});
  assert.equal(sent.ok,true);assert.equal(sent.providerAccepted,true);assert.equal(sent.httpStatus,202);
  assert.equal(calls[0].url,'https://graph.microsoft.com/v1.0/me/sendMail');
  assert.equal(JSON.parse(calls[0].opts.body).message.toRecipients[0].emailAddress.address,'person@example.com');
});
