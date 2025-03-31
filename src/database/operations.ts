import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import { env } from "../env";
import { eq, sql, and } from 'drizzle-orm';
import { TransferStats ,PaginatedResponse} from "./models";
let db: PostgresJsDatabase<typeof schema> | null = null;

export async function getDatabaseConnection(): Promise<
  PostgresJsDatabase<typeof schema>
> {
  if (db) {
    return db;
  }
  let connection: postgres.Sql<{}> | null = null;
  if (env.NODE_ENV === "development") {
    //local defaults for a local db instance
    console.info("connected to local database");
    connection = postgres({
      database: env.DB_NAME,
    });
  } else {
    console.info("connected to ", env.DB_HOST);
    connection = postgres({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      ssl: "prefer",
    });
  }
  db = drizzle(connection, { schema });
  console.info("database connection initialized");
  return db;
}

export type EcoErc20TransferEvent = typeof schema.ecoErc20TransferEvents.$inferInsert;


export async function initializeMetadataTable(): Promise<void> {
  const db = await getDatabaseConnection();
  
  await db
    .insert(schema.metadataTable)
    .values({
      id: schema.METADATA_ROW_ID,
      // All other fields will use their default values (0)
    })
    .onConflictDoNothing({ target: schema.metadataTable.id });
}

export async function addRealTimeErc20TransferEvent(
  event: EcoErc20TransferEvent
): Promise<void> {
  const db = await getDatabaseConnection();

  // First, get the current metadata
  const metadata = await db
    .select()
    .from(schema.metadataTable)
    .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID))
    .then(rows => rows[0]);

  // Start a transaction for atomic updates
  await db.transaction(async (tx) => {
    // Handle realTimeFillStartBlock
    if (metadata.realTimeFillStartBlock === 0 || event.blockNumber < metadata.realTimeFillStartBlock) {
      await tx
        .update(schema.metadataTable)
        .set({ realTimeFillStartBlock: event.blockNumber })
        .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
    }

    // Handle realTimeFillLatestBlock
    if (metadata.realTimeFillLatestBlock === 0 || event.blockNumber > metadata.realTimeFillLatestBlock) {
      await tx
        .update(schema.metadataTable)
        .set({ realTimeFillLatestBlock: event.blockNumber })
        .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
    }

    // Insert the event
    await tx
      .insert(schema.ecoErc20TransferEvents)
      .values({...event, obtainedFrom: "REAL_TIME"})
      .onConflictDoNothing({ 
        target: [
          schema.ecoErc20TransferEvents.transactionHash,
          schema.ecoErc20TransferEvents.logIndex
        ] 
      });

          // Update the total event count
    const result = await tx
    .select({ count: sql`count(*)` })
    .from(schema.ecoErc20TransferEvents)
    .then(rows => rows[0]);

  await tx
    .update(schema.metadataTable)
    .set({ 
      numberOfEvents: result.count as number
    })
    .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
  });
}

export async function addBackFillErc20TransferEvents(
  events: EcoErc20TransferEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const db = await getDatabaseConnection();

  // Get the current metadata
  const metadata = await db
    .select()
    .from(schema.metadataTable)
    .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID))
    .then(rows => rows[0]);

  await db.transaction(async (tx) => {
    // Handle backFillStartBlock
    if (metadata.backFillStartBlock === 0 || events[0].blockNumber < metadata.backFillStartBlock) {
      await tx
        .update(schema.metadataTable)
        .set({ backFillStartBlock: events[0].blockNumber })
        .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
    }

    // Handle backFillLatestBlock
    const lastEvent = events[events.length - 1];
    if (metadata.backFillLatestBlock === 0 || lastEvent.blockNumber > metadata.backFillLatestBlock) {
      await tx
        .update(schema.metadataTable)
        .set({ backFillLatestBlock: lastEvent.blockNumber })
        .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
    }

    // Insert the events
    await tx
      .insert(schema.ecoErc20TransferEvents)
      .values(events.map(event => ({...event, obtainedFrom: "BACK_FILL"})))
      .onConflictDoNothing({
        target: [
          schema.ecoErc20TransferEvents.transactionHash,
          schema.ecoErc20TransferEvents.logIndex
        ]
      });

    // Update the total event count
    const result = await tx
      .select({ count: sql`count(*)` })
      .from(schema.ecoErc20TransferEvents)
      .then(rows => rows[0]);

    await tx
      .update(schema.metadataTable)
      .set({ 
        numberOfEvents: result.count as number
      })
      .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
  });
}

export async function updateBackFillMetadataOnNoEventsFound(fromBlock:number,toBlock:number){
  const db = await getDatabaseConnection();
  // Get the current metadata
  const metadata = await db
    .select()
    .from(schema.metadataTable)
    .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID))
    .then(rows => rows[0]);

  await db.transaction(async (tx) => {
    // Handle backFillStartBlock
    if (metadata.backFillStartBlock === 0 || fromBlock < metadata.backFillStartBlock) {
      await tx
        .update(schema.metadataTable)
        .set({ backFillStartBlock: fromBlock })
        .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
    }

    // Handle backFillLatestBlock
    if (metadata.backFillLatestBlock === 0 || toBlock > metadata.backFillLatestBlock) {
      await tx
        .update(schema.metadataTable)
        .set({ backFillLatestBlock: toBlock })
        .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
    }
  });
}

export async function getRealTimeFillStartBlock(): Promise<number> {
  const db = await getDatabaseConnection();
  
  const metadata = await db
    .select({ 
      startBlock: schema.metadataTable.realTimeFillStartBlock 
    })
    .from(schema.metadataTable)
    .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID))
    .then(rows => rows[0]);

  return metadata.startBlock;
}

export async function waitForRealTimeFillStart(
  pollIntervalMs: number = 1000,
  timeoutMs: number = 1 * 60 * 1000 // 5 minutes default timeout
): Promise<number|null> {
  console.log("Waiting for first real time fill event to be captured to start backfill with perfect sync")
  const startTime = Date.now();
  
  while (true) {
    const startBlock = await getRealTimeFillStartBlock();
    
    if (startBlock !== 0) {
      return startBlock;
    }

    if (timeoutMs && Date.now() - startTime > timeoutMs) {
      return null;
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

export async function getMetadata() {
  const db = await getDatabaseConnection();
  
  const metadata = await db
    .select()
    .from(schema.metadataTable)
    .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID))
    .then(rows => rows[0]);

  if (!metadata) {
    throw new Error('Metadata row not found');
  }

  return metadata;
}

export async function deleteAllData(): Promise<void> {
  const db = await getDatabaseConnection();

  await db.transaction(async (tx) => {
    // Delete all events
    await tx
      .delete(schema.ecoErc20TransferEvents);

    // Reset metadata counters to 0
    await tx
      .update(schema.metadataTable)
      .set({
        realTimeFillStartBlock: 0,
        realTimeFillLatestBlock: 0,
        backFillStartBlock: 0,
        backFillLatestBlock: 0
      })
      .where(eq(schema.metadataTable.id, schema.METADATA_ROW_ID));
  });

  console.log('All data deleted and metadata reset');
}

export async function getTransferStats(): Promise<TransferStats> {
  const db = await getDatabaseConnection();
  
  const stats = await db
    .select({
      totalEvents: sql`count(*)`,
      totalValue: sql`sum(CAST(value AS NUMERIC(78, 0)))`
    })
    .from(schema.ecoErc20TransferEvents)
    .then(rows => rows[0]);

  return {
    totalEvents: Number(stats.totalEvents),
    totalValue: stats.totalValue as string || "0" // Handle case where there are no events
  };
}

export async function getPaginatedTransferEvents(
  page: number = 1,
  pageSize: number = 1000,
  filters?: {
    fromAddress?: string;
    toAddress?: string;
    minValue?: string;
    transactionHash?: string;
    fromBlock?: number;
    toBlock?: number;
  }
): Promise<PaginatedResponse<EcoErc20TransferEvent>> {
  const db = await getDatabaseConnection();
  
  // Calculate offset
  const offset = (page - 1) * pageSize;
  
  // Build the where conditions based on provided filters
  let conditions = [];
  if (filters?.fromAddress) {
    conditions.push(eq(schema.ecoErc20TransferEvents.from, filters.fromAddress));
  }
  if (filters?.toAddress) {
    conditions.push(eq(schema.ecoErc20TransferEvents.to, filters.toAddress));
  }
  if (filters?.minValue) {
    conditions.push(sql`CAST(${schema.ecoErc20TransferEvents.value} AS NUMERIC(78, 0)) >= CAST(${filters.minValue} AS NUMERIC(78, 0))`);
  }
  if (filters?.transactionHash) {
    conditions.push(eq(schema.ecoErc20TransferEvents.transactionHash, filters.transactionHash));
  }
  if (filters?.fromBlock !== undefined) {
    conditions.push(sql`${schema.ecoErc20TransferEvents.blockNumber} >= ${filters.fromBlock}`);
  }
  if (filters?.toBlock !== undefined) {
    conditions.push(sql`${schema.ecoErc20TransferEvents.blockNumber} <= ${filters.toBlock}`);
  }

  // Get the events for the current page with filters
  const events = await db
    .select()
    .from(schema.ecoErc20TransferEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(pageSize)
    .offset(offset)
    .orderBy(schema.ecoErc20TransferEvents.blockNumber);

  // Get total count for pagination metadata with the same filters
  const totalCount = await db
    .select({ count: sql`count(*)` })
    .from(schema.ecoErc20TransferEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .then(rows => Number(rows[0].count));

  return {
    events,
    pagination: {
      currentPage: page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      totalItems: totalCount
    }
  };
}













