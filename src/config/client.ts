import { Impit } from 'impit';
import PQueue from 'p-queue';
import type { ImpitOptions, ImpitResponse, RequestInit } from 'impit';

export interface ClientOptions extends ImpitOptions {
  rateLimit?: {
    requestsPerInterval?: number;
    intervalMs?: number;
    concurrency?: number;
  };
}

export class Client {
  private readonly impit: Impit;
  private readonly queue?: PQueue;

  constructor(options: ClientOptions = {}) {
    const { rateLimit, ...impitConfig } = options;
    this.impit = new Impit(impitConfig);

    if (rateLimit) {
      this.queue = new PQueue({
        intervalCap: rateLimit.requestsPerInterval ?? 1,
        interval: rateLimit.intervalMs ?? 1000,
        concurrency: rateLimit.concurrency ?? 1,
        carryoverIntervalCount: false,
      });
    }
  }

  public async fetch(url: string | URL, options: RequestInit): Promise<ImpitResponse> {
    if (this.queue) {
      return this.queue.add(() => this.impit.fetch(url, options));
    }
    return this.impit.fetch(url, options);
  }
}
