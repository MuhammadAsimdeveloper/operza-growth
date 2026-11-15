import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const OUTLOOK_SCOPES = Object.freeze(['openid','profile','email','offline_access','User.Read','Mail.Send']);
const AUTHORITY = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const STATE_TTL = 10 * 60 * 1000;
const sha = value => createHash('sha256').update(value).digest('hex');
const error = (message, code) => Object.assign(new Error(message), { code });

export function createMemoryOAuthStateStore() {
  const entries = new Map();
  return {
    async create(entry) { if (entries.has(entry.stateHash)) throw error('State already exists','OUTLOOK_STATE_REPLAY'); entries.set(entry.stateHash,{...entry}); },
    async consume({stateHash,tenantId,locationId}) {
      const entry=entries.get(stateHash);
      if (!entry || entry.tenantId!==tenantId || entry.locationId!==locationId) return null;
      entries.delete(stateHash); return {...entry};
    }
  };
}

function parseState(state,key,now) {
  if (typeof state!=='string' || state.length>4096) throw error('Invalid OAuth state','OUTLOOK_STATE_INVALID');
  const parts=state.split('.');
  if(parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) throw error('Invalid OAuth state','OUTLOOK_STATE_INVALID');
  const expected=createHmac('sha256',key).update(parts[0]).digest('hex');
  const a=Buffer.from(parts[1],'hex'), b=Buffer.from(expected,'hex');
  if(a.length!==b.length || !timingSafeEqual(a,b)) throw error('Invalid OAuth state signature','OUTLOOK_STATE_INVALID');
  let payload; try { payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')); } catch { throw error('Malformed OAuth state','OUTLOOK_STATE_INVALID'); }
  if(!payload.tenantId || !payload.locationId || !payload.actorId || !payload.nonce || payload.expiresAt<=now) throw error('OAuth state expired','OUTLOOK_STATE_EXPIRED');
  return payload;
}

async function jsonResponse(response) {
  return typeof response?.json==='function' ? response.json().catch(()=>({})) : {};
}
const emailRecipients = value => (Array.isArray(value)?value:[value]).flatMap(item => {
  const email=typeof item==='string'?item:item?.email;
  return typeof email==='string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim())
    ? [{emailAddress:{address:email.trim()}}] : [];
});
const allowedConsent = (consent,payload) =>
  consent?.status==='granted' && consent.channel==='email' &&
  typeof payload.contactId==='string' && consent.contactId===payload.contactId &&
  (!payload.purpose || consent.purpose===payload.purpose);

export function createOutlookOAuthService({
  clientId=process.env.MICROSOFT_CLIENT_ID,
  clientSecret=process.env.MICROSOFT_CLIENT_SECRET,
  redirectUri=process.env.MICROSOFT_REDIRECT_URI,
  tenant=process.env.MICROSOFT_TENANT_ID || 'common',
  stateKey=process.env.OPERZA_VAULT_KEY,
  secretResolver,
  stateStore=createMemoryOAuthStateStore(),
  fetchFn=globalThis.fetch,
  now=()=>Date.now()
}={}) {
  const configured=Boolean(clientId && clientSecret && redirectUri && typeof stateKey==='string' && stateKey.length>=16 &&
    typeof secretResolver?.store==='function' && typeof secretResolver?.resolve==='function' &&
    typeof stateStore?.create==='function' && typeof stateStore?.consume==='function');
  const locks=new Map();
  function assertConfigured() {
    if(!configured) throw error('Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI and OPERZA_VAULT_KEY','OUTLOOK_OAUTH_NOT_CONFIGURED');
  }
  async function request(url,options) {
    if(typeof fetchFn!=='function') throw error('Network client unavailable','OUTLOOK_NETWORK_UNAVAILABLE');
    const response=await fetchFn(url,{...options,redirect:'error',signal:AbortSignal.timeout(10_000)});
    return {response,data:await jsonResponse(response)};
  }
  async function tokenRequest(form) {
    const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,scope:OUTLOOK_SCOPES.join(' '),...form});
    const {response,data}=await request(`${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()
    });
    if(!response.ok || typeof data.access_token!=='string') throw error('Microsoft token request failed','OUTLOOK_TOKEN_EXCHANGE_FAILED');
    return data;
  }
  function parseBundle(serialized) {
    let bundle; try { bundle=JSON.parse(serialized); } catch { throw error('Invalid token bundle','OUTLOOK_TOKEN_BUNDLE_INVALID'); }
    if(!bundle || typeof bundle.accessToken!=='string' || typeof bundle.refreshToken!=='string' || !Number.isFinite(bundle.expiresAt))
      throw error('Incomplete token bundle','OUTLOOK_TOKEN_BUNDLE_INVALID');
    return bundle;
  }
  async function freshBundle(secretRef) {
    const value=await secretResolver.resolve(secretRef);
    if(typeof value!=='string') throw error('Outlook tokens not found','OUTLOOK_TOKEN_NOT_FOUND');
    const current=parseBundle(value);
    if(current.expiresAt>now()+60_000) return current;
    if(locks.has(secretRef)) return locks.get(secretRef);
    const pending=(async()=>{
      const rotated=await tokenRequest({grant_type:'refresh_token',refresh_token:current.refreshToken});
      const next={...current,accessToken:rotated.access_token,refreshToken:rotated.refresh_token||current.refreshToken,
        expiresAt:now()+Math.max(60,Number(rotated.expires_in)||3600)*1000,
        scopes:typeof rotated.scope==='string'?rotated.scope.split(' '):current.scopes,updatedAt:new Date(now()).toISOString()};
      await secretResolver.store(secretRef,JSON.stringify(next)); return next;
    })();
    locks.set(secretRef,pending);
    try { return await pending; } finally { locks.delete(secretRef); }
  }
  async function getAccessToken(secretRef) {
    if(typeof secretRef!=='string' || !/^vault:[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) throw error('Invalid Outlook secret reference','OUTLOOK_SECRET_REFERENCE_INVALID');
    return (await freshBundle(secretRef)).accessToken;
  }
  async function graphMe(accessToken) {
    const {response,data}=await request(`${GRAPH}/me?$select=id,displayName,mail,userPrincipalName`,{method:'GET',headers:{Authorization:`Bearer ${accessToken}`}});
    if(!response.ok || typeof data.id!=='string') throw error('Microsoft Graph mailbox verification failed','OUTLOOK_GRAPH_PROFILE_FAILED');
    return {id:data.id,displayName:data.displayName||'',email:data.mail||data.userPrincipalName||''};
  }
  async function begin({tenantId,locationId,actorId}={}) {
    assertConfigured();
    if(![tenantId,locationId,actorId].every(x=>typeof x==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/.test(x)))
      throw error('Operza tenant, location and actor context required','OUTLOOK_TENANT_CONTEXT_REQUIRED');
    const verifier=randomBytes(48).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const expiresAt=now()+STATE_TTL;
    const payload={tenantId,locationId,actorId,nonce:randomBytes(24).toString('base64url'),expiresAt};
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const state=`${encoded}.${createHmac('sha256',stateKey).update(encoded).digest('hex')}`;
    await stateStore.create({stateHash:sha(state),tenantId,locationId,actorId,codeVerifier:verifier,expiresAt});
    const auth=new URL(`${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`);
    auth.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectUri,response_mode:'query',
      scope:OUTLOOK_SCOPES.join(' '),state,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
    return {authorizationUrl:auth.toString(),expiresAt:new Date(expiresAt).toISOString()};
  }
  async function complete({code,state,tenantId,locationId,actorId}={}) {
    assertConfigured();
    if(typeof code!=='string' || code.length<8 || code.length>4096) throw error('Authorization code invalid','OUTLOOK_CODE_INVALID');
    const signed=parseState(state,stateKey,now());
    if(signed.tenantId!==tenantId || signed.locationId!==locationId || signed.actorId!==actorId)
      throw error('OAuth state does not match the signed-in Operza context','OUTLOOK_TENANT_CONTEXT_MISMATCH');
    const pending=await stateStore.consume({stateHash:sha(state),tenantId,locationId});
    if(!pending || pending.actorId!==actorId || pending.expiresAt<=now()) throw error('OAuth state expired or already consumed','OUTLOOK_STATE_REPLAY');
    const token=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:pending.codeVerifier});
    if(typeof token.refresh_token!=='string') throw error('Microsoft did not return a refresh token; grant offline_access','OUTLOOK_REFRESH_TOKEN_MISSING');
    const profile=await graphMe(token.access_token);
    const secretRef=`vault:${tenantId}/${locationId}/microsoft-outlook-${randomUUID()}`;
    await secretResolver.store(secretRef,JSON.stringify({
      accessToken:token.access_token,refreshToken:token.refresh_token,
      expiresAt:now()+Math.max(60,Number(token.expires_in)||3600)*1000,
      scopes:typeof token.scope==='string'?token.scope.split(' '):OUTLOOK_SCOPES,mailbox:profile
    }));
    return {secretRef,accountId:profile.id,email:profile.email,displayName:profile.displayName,scopes:OUTLOOK_SCOPES};
  }
  async function verifyMailbox(secretRef) { return graphMe(await getAccessToken(secretRef)); }
  async function sendMail({secretRef,payload={},consent}={}) {
    if(!allowedConsent(consent,payload)) return {ok:false,code:'CONSENT_REQUIRED',httpStatus:0};
    const toRecipients=emailRecipients(payload.to||payload.recipient||payload.email);
    const subject=String(payload.subject||'').trim();
    const text=typeof payload.text==='string'?payload.text:'';
    const html=typeof payload.html==='string'?payload.html:'';
    if(!toRecipients.length || toRecipients.length>50) return {ok:false,code:'INVALID_RECIPIENTS',httpStatus:0};
    if(!subject || subject.length>255 || /[\r\n]/.test(subject)) return {ok:false,code:'INVALID_SUBJECT',httpStatus:0};
    if((!text&&!html) || text.length>100_000 || html.length>100_000) return {ok:false,code:'INVALID_MESSAGE_BODY',httpStatus:0};
    try {
      const accessToken=await getAccessToken(secretRef);
      const {response}=await request(`${GRAPH}/me/sendMail`,{
        method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
        body:JSON.stringify({message:{subject,body:{contentType:html?'HTML':'Text',content:html||text},toRecipients},saveToSentItems:true})
      });
      return response.status===202
        ? {ok:true,providerAccepted:true,provider:'microsoft_graph',providerMessageId:null,httpStatus:202,status:'accepted_by_provider'}
        : {ok:false,code:'OUTLOOK_SEND_REJECTED',httpStatus:response.status};
    } catch(err) { return {ok:false,code:err?.code||'OUTLOOK_SEND_FAILED',httpStatus:0}; }
  }
  const adapter=Object.freeze({
    id:'adapter-microsoft-outlook-graph-v1',providerKey:'email.microsoft_graph',channel:'email',
    async verify({secretRef}={}) {
      if(!secretRef) return {verified:false,code:'OUTLOOK_SECRET_REFERENCE_REQUIRED'};
      try { const profile=await verifyMailbox(secretRef); return {verified:true,accountId:profile.id}; }
      catch { return {verified:false,code:'OUTLOOK_MAILBOX_VERIFICATION_FAILED'}; }
    },
    async dispatch({secretRef,payload,consent}={}) { return sendMail({secretRef,payload,consent}); }
  });
  return {get isConfigured(){return configured;},begin,complete,getAccessToken,verifyMailbox,sendMail,adapter};
}
