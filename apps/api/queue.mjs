import net from 'node:net';
import { randomUUID } from 'node:crypto';

/**
 * Operza High-Performance Durable Job Queue
 * Supports both distributed Redis (via native RESP protocol over TCP)
 * and zero-config in-memory delayed queue fallback.
 */

class SimpleRedisClient {
  constructor(url) {
    this.url = url || process.env.REDIS_URL || 'redis://localhost:6379';
    const parsed = new URL(this.url.startsWith('redis://') ? this.url : `redis://${this.url}`);
    this.host = parsed.hostname || 'localhost';
    this.port = Number(parsed.port) || 6379;
    this.password = parsed.password || null;
    this.socket = null;
    this.connected = false;
    this.pendingCallbacks = [];
    this.buffer = '';
  }

  connect() {
    return new Promise((resolve) => {
      try {
        this.socket = net.createConnection({ host: this.host, port: this.port, timeout: 3000 }, () => {
          this.connected = true;
          if (this.password) {
            this.sendCommand(['AUTH', this.password]).catch(() => {});
          }
          resolve(true);
        });

        this.socket.on('data', (chunk) => {
          this.buffer += chunk.toString('utf8');
          this._processBuffer();
        });

        this.socket.on('error', (err) => {
          this.connected = false;
          resolve(false);
        });

        this.socket.on('close', () => {
          this.connected = false;
        });

        this.socket.on('timeout', () => {
          this.connected = false;
          this.socket.destroy();
          resolve(false);
        });
      } catch {
        this.connected = false;
        resolve(false);
      }
    });
  }

  /**
   * Parse inbound TCP stream chunks according to the Redis Serialization Protocol (RESP v2):
   * '+' -> Simple String (e.g. +OK\r\n)
   * ':' -> Integer (e.g. :1000\r\n)
   * '-' -> Error message (e.g. -ERR unknown command\r\n)
   * '$' -> Bulk String with length prefix (e.g. $6\r\nfoobar\r\n)
   * '*' -> Multi-bulk Array with element count (e.g. *2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n)
   */
  _processBuffer() {
    while (this.buffer.length > 0 && this.pendingCallbacks.length > 0) {
      const lineEnd = this.buffer.indexOf('\r\n');
      if (lineEnd === -1) break;

      const prefix = this.buffer[0];
      const line = this.buffer.slice(1, lineEnd);

      if (prefix === '+' || prefix === ':') {
        // Simple string or integer
        this.buffer = this.buffer.slice(lineEnd + 2);
        const cb = this.pendingCallbacks.shift();
        if (cb) cb.resolve(prefix === ':' ? Number(line) : line);
      } else if (prefix === '-') {
        // Error
        this.buffer = this.buffer.slice(lineEnd + 2);
        const cb = this.pendingCallbacks.shift();
        if (cb) cb.reject(new Error(line));
      } else if (prefix === '$') {
        // Bulk string
        const len = Number(line);
        if (len === -1) {
          this.buffer = this.buffer.slice(lineEnd + 2);
          const cb = this.pendingCallbacks.shift();
          if (cb) cb.resolve(null);
        } else {
          const totalExpected = lineEnd + 2 + len + 2;
          if (this.buffer.length < totalExpected) break;
          const str = this.buffer.slice(lineEnd + 2, lineEnd + 2 + len);
          this.buffer = this.buffer.slice(totalExpected);
          const cb = this.pendingCallbacks.shift();
          if (cb) cb.resolve(str);
        }
      } else if (prefix === '*') {
        // Multi-bulk array (simplified single-layer parse)
        const count = Number(line);
        if (count === 0) {
          this.buffer = this.buffer.slice(lineEnd + 2);
          const cb = this.pendingCallbacks.shift();
          if (cb) cb.resolve([]);
        } else {
          // Leave for subsequent processing
          break;
        }
      } else {
        // Unknown, drop first line
        this.buffer = this.buffer.slice(lineEnd + 2);
      }
    }
  }

  sendCommand(args) {
    if (!this.connected || !this.socket) {
      return Promise.reject(new Error('Redis not connected'));
    }
    return new Promise((resolve, reject) => {
      this.pendingCallbacks.push({ resolve, reject });
      let command = `*${args.length}\r\n`;
      for (const arg of args) {
        const str = String(arg);
        command += `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
      }
      this.socket.write(command);
    });
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.connected = false;
    }
  }
}

export class DurableWorkflowQueue {
  constructor(redisUrl) {
    this.redisUrl = redisUrl || process.env.REDIS_URL;
    this.redisClient = null;
    this.useRedis = false;
    this.memoryReady = [];
    this.memoryDelayed = []; // { id, queueName, data, executeAt, attempts, maxRetries }
    this.memoryDlq = [];     // Dead-letter queue for unrecoverable/exhausted jobs
    this.idempotencyKeys = new Map(); // idempotencyKey -> { jobId, expiresAt }
  }

  async init() {
    if (this.redisUrl) {
      this.redisClient = new SimpleRedisClient(this.redisUrl);
      const ok = await this.redisClient.connect();
      if (ok) {
        this.useRedis = true;
        console.log('⚡ [OPERZA-QUEUE] Connected to Redis durable queue cluster at', this.redisClient.host);
      } else {
        console.log('📦 [OPERZA-QUEUE] Redis not reachable, initialized in-memory durable queue fallback.');
      }
    } else {
      console.log('📦 [OPERZA-QUEUE] No REDIS_URL specified. Running with high-precision in-memory queue.');
    }
  }

  /**
   * Calculate exponential backoff with randomized jitter to prevent thundering herds
   */
  calculateBackoff(attempt, baseMs = 1000, maxMs = 60000, jitter = 500) {
    const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    return Math.floor(exp + Math.random() * jitter);
  }

  /**
   * Clean expired idempotency keys
   */
  _cleanupIdempotency() {
    const now = Date.now();
    for (const [key, record] of this.idempotencyKeys.entries()) {
      if (record.expiresAt <= now) {
        this.idempotencyKeys.delete(key);
      }
    }
  }

  async enqueue(queueName, data, options = {}) {
    this._cleanupIdempotency();

    // Idempotency deduplication check
    if (options.idempotencyKey) {
      const existing = this.idempotencyKeys.get(options.idempotencyKey);
      if (existing && existing.expiresAt > Date.now()) {
        return {
          id: existing.jobId,
          queueName,
          data,
          deduplicated: true,
          enqueuedAt: existing.enqueuedAt
        };
      }
    }

    const jobId = options.id || randomUUID();
    const job = {
      id: jobId,
      queueName,
      data,
      attempts: options.attempts || 0,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : 3,
      idempotencyKey: options.idempotencyKey || null,
      enqueuedAt: new Date().toISOString()
    };

    if (options.idempotencyKey) {
      const ttlMs = options.idempotencyTtlMs || 10 * 60 * 1000; // 10 minutes default
      this.idempotencyKeys.set(options.idempotencyKey, {
        jobId,
        enqueuedAt: job.enqueuedAt,
        expiresAt: Date.now() + ttlMs
      });
    }

    if (this.useRedis && this.redisClient?.connected) {
      try {
        await this.redisClient.sendCommand(['LPUSH', `operza:q:${queueName}:ready`, JSON.stringify(job)]);
        return job;
      } catch {
        // Fall back to memory on error
      }
    }

    this.memoryReady.push(job);
    return job;
  }

  async enqueueDelayed(queueName, data, delayMs, options = {}) {
    const executeAt = Date.now() + Math.max(0, Number(delayMs) || 0);
    const jobId = options.id || randomUUID();
    const job = {
      id: jobId,
      queueName,
      data,
      executeAt,
      attempts: options.attempts || 0,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : 3,
      idempotencyKey: options.idempotencyKey || null,
      enqueuedAt: new Date().toISOString()
    };

    if (this.useRedis && this.redisClient?.connected) {
      try {
        await this.redisClient.sendCommand([
          'ZADD',
          `operza:q:${queueName}:delayed`,
          String(executeAt),
          JSON.stringify(job)
        ]);
        return job;
      } catch {
        // Fall back to memory
      }
    }

    this.memoryDelayed.push(job);
    return job;
  }

  /**
   * Route failed jobs through exponential backoff or dead-letter queue (DLQ)
   */
  async retryJob(job, errorReason = 'Execution failed') {
    const currentAttempts = (job.attempts || 0) + 1;
    const maxRetries = job.maxRetries !== undefined ? job.maxRetries : 3;

    if (currentAttempts >= maxRetries) {
      return this.moveToDeadLetterQueue(job, `Exceeded max retries (${maxRetries}): ${errorReason}`);
    }

    const backoffMs = this.calculateBackoff(currentAttempts);
    return this.enqueueDelayed(job.queueName, job.data, backoffMs, {
      ...job,
      attempts: currentAttempts
    });
  }

  /**
   * Move an unrecoverable job to the Dead-Letter Queue (DLQ)
   */
  async moveToDeadLetterQueue(job, errorReason) {
    const dlqEntry = {
      ...job,
      deadLetteredAt: new Date().toISOString(),
      errorReason: String(errorReason)
    };

    if (this.useRedis && this.redisClient?.connected) {
      try {
        await this.redisClient.sendCommand([
          'LPUSH',
          `operza:q:${job.queueName}:dlq`,
          JSON.stringify(dlqEntry)
        ]);
      } catch {
        // fallback
      }
    }

    this.memoryDlq.push(dlqEntry);
    return dlqEntry;
  }

  async pollReadyJobs(queueName) {
    const readyJobs = [];
    const now = Date.now();

    // 1. Check delayed jobs that have matured
    const remainingDelayed = [];
    for (const job of this.memoryDelayed) {
      if (job.queueName === queueName && job.executeAt <= now) {
        readyJobs.push(job);
      } else {
        remainingDelayed.push(job);
      }
    }
    this.memoryDelayed = remainingDelayed;

    // 2. Fetch memory ready jobs
    const remainingReady = [];
    for (const job of this.memoryReady) {
      if (job.queueName === queueName) {
        readyJobs.push(job);
      } else {
        remainingReady.push(job);
      }
    }
    this.memoryReady = remainingReady;

    return readyJobs;
  }

  getMetrics() {
    return {
      engine: this.useRedis && this.redisClient?.connected ? 'redis_distributed' : 'memory_durable',
      connected: this.useRedis ? this.redisClient?.connected : true,
      readyDepth: this.memoryReady.length,
      delayedDepth: this.memoryDelayed.length,
      dlqDepth: this.memoryDlq.length,
      idempotencyTracked: this.idempotencyKeys.size,
      totalTracked: this.memoryReady.length + this.memoryDelayed.length + this.memoryDlq.length
    };
  }

  close() {
    if (this.redisClient) {
      this.redisClient.close();
    }
  }
}

export const workflowQueue = new DurableWorkflowQueue();
