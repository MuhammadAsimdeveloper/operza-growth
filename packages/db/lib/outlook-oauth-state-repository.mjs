import { encryptSecret,decryptSecret } from '../../platform-core/src/secret-vault.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
function assertUuid(value,name){if(typeof value!=='string'||!UUID.test(value))throw Object.assign(new TypeError(name+' must be a UUID'),{code:'INVALID_TENANT_REFERENCE'});}
export function createPostgresOAuthStateStore(pool,{masterKey=process.env.OPERZA_VAULT_KEY}={}){
  if(!pool||typeof pool.connect!=='function')throw new TypeError('A PostgreSQL pool is required');
  if(typeof masterKey!=='string'||masterKey.length<16)throw Object.assign(new Error('OPERZA_VAULT_KEY required'),{code:'OPERZA_VAULT_KEY_REQUIRED'});
  async function withTenant(tenantId,locationId,work){
    assertUuid(tenantId,'tenantId');assertUuid(locationId,'locationId');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id',$1,true),set_config('app.location_id',$2,true)",[tenantId,locationId]);
      const result=await work(client);await client.query('COMMIT');return result;
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  return {
    async create({stateHash,tenantId,locationId,actorId,codeVerifier,expiresAt}){
      if(!HASH.test(stateHash||'')||typeof actorId!=='string'||!actorId||typeof codeVerifier!=='string'||codeVerifier.length<43)throw new TypeError('OAuth state invalid');
      const envelope=encryptSecret(codeVerifier,masterKey);
      return withTenant(tenantId,locationId,client=>client.query(
        'INSERT INTO provider_oauth_states (state_hash,agency_id,location_id,actor_id,code_verifier_envelope,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [stateHash,tenantId,locationId,actorId,envelope,new Date(expiresAt).toISOString()]));
    },
    async consume({stateHash,tenantId,locationId}){
      if(!HASH.test(stateHash||''))return null;
      return withTenant(tenantId,locationId,async client=>{
        const result=await client.query(
          'DELETE FROM provider_oauth_states WHERE state_hash=$1 AND agency_id=$2 AND location_id=$3 RETURNING actor_id,code_verifier_envelope,expires_at',
          [stateHash,tenantId,locationId]);
        const row=result.rows[0];if(!row)return null;
        return {actorId:row.actor_id,codeVerifier:decryptSecret(row.code_verifier_envelope,masterKey),expiresAt:new Date(row.expires_at).getTime()};
      });
    }
  };
}
