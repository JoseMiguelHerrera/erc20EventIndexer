import { Queue, Worker, FlowProducer } from "bullmq";
import IORedis from "ioredis";
import { Express } from "express";
import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { EcoErc20TransferEvent } from "../database/schema";
import {addBackFillErc20TransferEvents, addRealTimeErc20TransferEvent, updateBackFillMetadataOnNoEventsFound } from "../database/operations"
import { BackFill } from "../BackFill";
import { env } from "../env";
import { SocketIOManager } from "./SocketService";

export class BullScheduler {

  //Queue Names
  ecoRealTimeReceiptsQueueName = "ecoRealTimeReceiptsQueue";
  ecoRealTimeInsertionsQueueName = "ecoRealTimeInsertionsQueue";

  ecoBackFillChunkedRequestsQueueName = "ecoBackFillChunkedRequestsQueue";
  ecoBackFillReceiptsQueueName = "ecoBackFillReceiptsQueue";
  ecoBackFillInsertionsQueueName = "ecoBackFillInsertionsQueue";

  private connectionRetries = 10;
  private jobRetryAttempts = 5;
  requestJob = "requestJob";
  receiptJob = "receiptJob";
  insertJob = "insertJob";

  private connection: IORedis | null = null;

  //Queues For Real Time Fill
  ecoRealTimeReceiptsQueue: Queue | null = null;
  ecoRealTimeInsertionsQueue: Queue | null = null;

  //Queues For Back Fill
  ecoBackFillChunkedRequestsQueue: Queue | null = null;
  ecoBackFillReceiptsQueue: Queue | null = null;
  ecoBackFillInsertionsQueue: Queue | null = null;

  //Workers
  ecoRealTimeReceiptsWorker: Worker | null = null;
  ecoRealTimeInsertionsWorker: Worker | null = null;

  ecoBackFillChunkedRequestsWorker: Worker | null = null;
  ecoBackFillReceiptsWorker: Worker | null = null;
  ecoBackFillInsertionsWorker: Worker | null = null;

  backFill: BackFill | null = null;

  private socketIOManager: SocketIOManager | null = null;

  async init(connectionString: string, useTLS: boolean, app: Express) {
    this.connection = new IORedis(connectionString, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 1000, 30000);
        console.log(`Redis connection attempt ${times}, retrying in ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      reconnectOnError: (err) => {
        console.log('Redis reconnectOnError:', err);
        return true;
      },
      tls: useTLS
        ? {
          rejectUnauthorized: false,
        }
        : undefined,
    });

    this.socketIOManager = new SocketIOManager(app, this.connection);

    this.socketIOManager.initialize();
    await this.socketIOManager.listen(env.REST_PORT+2);

    this.connection.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    this.connection.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });

    this.connection.on('ready', () => {
      console.log('Redis connection ready');
    });

    //Queue set ups
    this.ecoRealTimeReceiptsQueue = new Queue(this.ecoRealTimeReceiptsQueueName, {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 1 * 3600, // Keep completed jobs for one hour
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 1 * 3600, // Keep failed jobs for one hour
        },
        attempts: this.jobRetryAttempts,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });

    this.ecoRealTimeInsertionsQueue = new Queue(this.ecoRealTimeInsertionsQueueName, {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 1 * 3600, // Keep completed jobs for one hour
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 1 * 3600, // Keep failed jobs for one hour
        },
        attempts: this.jobRetryAttempts,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });

    this.ecoBackFillChunkedRequestsQueue = new Queue(this.ecoBackFillChunkedRequestsQueueName, {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 1 * 24 * 3600, // Keep completed jobs for 1 day
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 1 * 24 * 3600, // Keep failed jobs for 1 day
        },
        attempts: this.jobRetryAttempts,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });

 
    this.ecoBackFillInsertionsQueue = new Queue(this.ecoBackFillInsertionsQueueName, {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 1 * 24 * 3600, // Keep completed jobs for 1 day
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 3 * 24 * 3600, // Keep failed jobs for 3 days
        },
        attempts: this.jobRetryAttempts,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });

    // Ensure queues are ready
    await this.ecoRealTimeReceiptsQueue.waitUntilReady();
    await this.ecoRealTimeInsertionsQueue.waitUntilReady();
    await this.ecoBackFillChunkedRequestsQueue.waitUntilReady();
    await this.ecoBackFillInsertionsQueue.waitUntilReady();

    //Real time workers
    this.ecoRealTimeReceiptsWorker = new Worker(
      this.ecoRealTimeReceiptsQueueName,
      async (job) => {
        switch (job.name) {
          case this.receiptJob:
            await this.addRealTimeInsertionJob(job.data)
            break;
        }
      },
      {
        connection: this.connection,
        concurrency: 1000,
        limiter: { //1000 jobs per second
          max: 2000,
          duration: 1000,
        },
      }
    );

    this.ecoRealTimeInsertionsWorker = new Worker(
      this.ecoRealTimeInsertionsQueueName,
      async (job) => {
        switch (job.name) {
          case this.insertJob:
            await addRealTimeErc20TransferEvent(job.data as EcoErc20TransferEvent)
            break;
        }
      },
      {
        connection: this.connection,
        concurrency: 50,
        limiter: { //100 jobs per second
          max: 100,
          duration: 1000,
        },
      }
    );


    //back fill workers
    this.ecoBackFillChunkedRequestsWorker = new Worker(
      this.ecoBackFillChunkedRequestsQueueName,
      async (job) => {
        switch (job.name) {
          case this.requestJob:
            const result: EcoErc20TransferEvent[] | undefined = await this.backFill?.getPeriodTransferLogs(BigInt(job.data.fromBlock), BigInt(job.data.toBlock));
            if (result) {
              if(result.length==0){
                console.log(`No events found for blocks ${job.data.fromBlock} to ${job.data.toBlock}, updating metadata`);
                await updateBackFillMetadataOnNoEventsFound(job.data.fromBlock,job.data.toBlock);
              }else{
                console.log(`Found ${result.length} events for blocks ${job.data.fromBlock} to ${job.data.toBlock}`);
                await this.addBackFillInsertionJob(result)
              }
            }
            return {
              processedBlocks: {
                from: job.data.fromBlock,
                to: job.data.toBlock
              },
              eventsFound: result?.length || 0,
              events: result || []
            };
        }
      },
      {//Limits according to my alchemy account limits
        connection: this.connection,
        concurrency: 25,
        limiter: { //10 jobs per second
          max: 10,
          duration: 1000,
        },
      }
    );

    this.ecoBackFillInsertionsWorker = new Worker(
      this.ecoBackFillInsertionsQueueName,
      async (job) => {
        switch (job.name) {
          case this.insertJob:
            await addBackFillErc20TransferEvents(job.data as EcoErc20TransferEvent[])
            break;
        }
      },
      {
        connection: this.connection,
        concurrency: 1000,
        limiter: { //100 jobs per second
          max: 1000,
          duration: 1000,
        },
      }
    );

    // Wait for connection to be ready
    await this.connection.ping();

    console.log("Bull scheduler started");

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath("/bullboard");

    app.use("/bullboard", serverAdapter.getRouter());

    const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard(
      {
        queues: [new BullMQAdapter(this.ecoRealTimeReceiptsQueue), new BullMQAdapter(this.ecoRealTimeInsertionsQueue), new BullMQAdapter(this.ecoBackFillInsertionsQueue), new BullMQAdapter(this.ecoBackFillChunkedRequestsQueue)],
        serverAdapter: serverAdapter,
      }
    );

  }


  async cleanAllQueues() {
    await this.ecoRealTimeReceiptsQueue?.drain()
    await this.ecoRealTimeInsertionsQueue?.drain();
    await this.ecoBackFillChunkedRequestsQueue?.drain();
    await this.ecoBackFillInsertionsQueue?.drain();
  }

  async cleanup(): Promise<void> {
    await this.cleanAllQueues();
    console.log("Starting redis/bull cleanup process...");
    try {
      // Force close everything with a timeout
      await Promise.race([
        Promise.all([
          this.ecoRealTimeReceiptsWorker?.close(),
          this.ecoRealTimeInsertionsWorker?.close(),
          this.ecoBackFillChunkedRequestsWorker?.close(),
          this.ecoBackFillInsertionsWorker?.close(),
          this.connection?.quit(),
        ]),
        new Promise((resolve) => setTimeout(resolve, 3000)), // 3s timeout
      ]);
      this.socketIOManager?.shutdown();
    } catch (error) {
      console.error("Error during cleanup:", error);
    } finally {
      // Force disconnect if still connected
      this.connection?.disconnect();
      this.ecoRealTimeReceiptsWorker = null;
      this.ecoRealTimeInsertionsWorker = null;
      this.ecoBackFillChunkedRequestsWorker = null;
      this.ecoBackFillInsertionsWorker = null;
      this.connection = null;
      console.log("Cleanup completed");
    }
  }

  async setBackFill(backFill: BackFill) {
    this.backFill = backFill;
  }

  async addRealTimeReceiptJob(jobData: EcoErc20TransferEvent) {
    await this.ecoRealTimeReceiptsQueue?.add(this.receiptJob, jobData);
  }

  async addRealTimeInsertionJob(jobData: EcoErc20TransferEvent) {
    this.socketIOManager?.broadcast("ecoRealTimeInsertions", jobData);
    await this.ecoRealTimeInsertionsQueue?.add(this.insertJob, jobData);
  }

  async addBackFillChunkedRequestJob(jobData: {fromBlock: number, toBlock: number}) {
    await this.ecoBackFillChunkedRequestsQueue?.add(this.requestJob, jobData);
  }

  async addBackFillReceiptJob(jobData: EcoErc20TransferEvent[]) {
    await this.ecoBackFillReceiptsQueue?.add(this.receiptJob, jobData);
  }

  async addBackFillInsertionJob(jobData: EcoErc20TransferEvent[]) {
    this.socketIOManager?.broadcast("ecoBackFillInsertions", jobData);
    await this.ecoBackFillInsertionsQueue?.add(this.insertJob, jobData);
  }
}
