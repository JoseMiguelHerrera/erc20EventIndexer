import { env } from "../env";

import { integer, text, pgSchema,boolean, primaryKey } from "drizzle-orm/pg-core";

export const schema = pgSchema(env.DB_SCHEMA);

export const ecoErc20TransferEvents = schema.table(
  "eco_erc20_transfer_events",
  {
    transactionHash: text("transaction_hash").notNull(),
    from: text("from").notNull(),
    to: text("to").notNull(),
    value: text("value").notNull(),
    blockNumber: integer("block_number").notNull(),
    blockHash: text("block_hash").notNull(),
    data: text("data").notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    logIndex: integer("log_index").notNull(),
    removed: boolean("removed").notNull(),
    obtainedFrom: text("obtained_from"),
  },
  (table) => ([
    primaryKey({ columns: [table.transactionHash, table.logIndex] }),
  ])
);

export const METADATA_ROW_ID = 'singleton' as const;
export const metadataTable = schema.table("metadata", {
    id: text("id").primaryKey().$defaultFn(() => METADATA_ROW_ID),
    realTimeFillStartBlock: integer("real_time_fill_start_block").notNull().$default(() => 0),
    realTimeFillLatestBlock: integer("real_time_fill_latest_block").notNull().$default(() => 0),
    backFillStartBlock: integer("back_fill_start_block").notNull().$default(() => 0),
    backFillLatestBlock: integer("back_fill_latest_block").notNull().$default(() => 0),
    numberOfEvents: integer("number_of_events").notNull().$default(() => 0),
});

export type EcoErc20TransferEvent = typeof ecoErc20TransferEvents.$inferInsert;
 
