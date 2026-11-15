import pg from 'pg';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkflowOutboxRepository} from '../../packages/db/lib/outbox-repository.mjs';
import {createPostgresSecretBackend} from '../../packages/db/lib/secret-vault-repository.mjs';
import {createZapierHookRepository} from '../../packages/db/lib/zapier-hook-repository.mjs';
import {createSecretResolver} from '../../packages/platform-core/src/secret-vault.mjs';
import {trustedWorkerHandlers} from '../../packages/platform-core/src/trusted-handlers.mjs';
import {createZapierWebhookHandler} from '../../packages/platform-core/src/zapier-worker-handler.mjs';
import {runOutboxWorker} from '../../packages/platform-core/src/durable-worker.mjs';
const{Pool}=pg;
export async function startDurableWorker({databaseUrl=process.env.WORKER_DATABASE_URL,handlerModule=process.env.WORKFLOW_JOB_MODULE,workerId=process.env.WORKER_ID||'operza-worker-'+randomUUID(),poolOptions={}}={}){
 if(!databaseUrl)throw new Error('WORKER_DATABASE_URL is required; do not use the API application connection string.');
 if(typeof process.env.OPERZA_VAULT_KEY!=='string'||process.env.OPERZA_VAULT_KEY.length<16)throw new Error('OPERZA_VAULT_KEY is required by the worker.');
 let customHandlers={};
 if(handlerModule){const loaded=await import(pathToFileURL(path.resolve(process.cwd(),handlerModule)).href);customHandlers=loaded.handlers||loaded.default?.handlers||{};if(!customHandlers||typeof customHandlers!=='object')throw new Error('Trusted worker module must export a handlers object.');}
 const pool=new Pool({connectionString:databaseUrl,max:Number(process.env.WORKER_DB_POOL_MAX||4),connectionTimeoutMillis:5000,idleTimeoutMillis:30000,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined,...poolOptions});
 const abort=new AbortController();let closing=false;
 try{
  const identity=await pool.query('SELECT current_user AS role');
  if(identity.rows[0]?.role!=='operza_worker')throw new Error('WORKER_DATABASE_URL must authenticate as the separately provisioned operza_worker role.');
  const secretResolver=createSecretResolver({masterKey:process.env.OPERZA_VAULT_KEY,backend:createPostgresSecretBackend(pool)});
  const zapierRepository=createZapierHookRepository(pool);
  const handlers={...trustedWorkerHandlers,...customHandlers,'zapier.webhook.deliver':createZapierWebhookHandler({repository:zapierRepository,secretResolver})};
  for(const[eventType,handler]of Object.entries(handlers))if(!/^[a-z][a-z0-9_.-]{1,120}$/.test(eventType)||typeof handler!=='function')throw new Error('Worker handlers must map safe event types to trusted functions.');
  const shutdown=()=>{if(!closing){closing=true;abort.abort();}};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  console.log(JSON.stringify({level:'INFO',message:'Durable worker started',workerId,handlers:Object.keys(handlers),concurrency:Number(process.env.WORKER_CONCURRENCY||4)}));
  await runOutboxWorker({repository:createWorkflowOutboxRepository(pool),workerId,handlers,pollIntervalMs:Number(process.env.WORKER_POLL_INTERVAL_MS||1000),batchSize:Number(process.env.WORKER_BATCH_SIZE||10),leaseMs:Number(process.env.WORKER_LEASE_MS||30000),concurrency:Number(process.env.WORKER_CONCURRENCY||4),signal:abort.signal,onError:e=>console.error(JSON.stringify({level:'ERROR',message:'Worker batch failed',code:e?.code||'WORKER_BATCH_FAILED'}))});
 }finally{abort.abort();await pool.end();console.log(JSON.stringify({level:'INFO',message:'Durable worker stopped',workerId}));}
}
const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain)startDurableWorker().catch(e=>{console.error(JSON.stringify({level:'ERROR',message:'Worker could not start',code:e?.code||'WORKER_START_FAILED',detail:e.message}));process.exitCode=1;});
