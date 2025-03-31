import { env } from "./env";
import { ERC20TransferLog, rawLogToEventObject } from "./database/models";
import { EcoErc20TransferEvent, schema } from "./database/schema";
import { eq } from "drizzle-orm";
import { abi } from "../contracts/erc20";

import {
  Address,
  createPublicClient,
  Log,
  decodeEventLog,
  http,
  GetContractEventsReturnType,
  getContract,
} from "viem";
import { arbitrum } from "viem/chains";
import { BullScheduler } from "./services/BullScheduler";

interface BlockRange {
  fromBlock: number;
  toBlock: number;
}
export class BackFill {
  public _viemClient: ReturnType<typeof createPublicClient>;
  private bullScheduler: BullScheduler;

  constructor(_bullScheduler: BullScheduler, _viemClient: ReturnType<typeof createPublicClient>) {
    this._viemClient = _viemClient;
    this.bullScheduler = _bullScheduler;
  }

  private safeAlchemyBlockLimit = 2000;


  public async getPeriodTransferLogs(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<EcoErc20TransferEvent[]> {
    if (fromBlock > toBlock) {
      throw new Error("from block must be before toBlock");
    }
      const logs = await this._viemClient.getContractEvents({
        address: env.TARGET_CONTRACT_ADDRESS as Address,
        abi: abi,
        eventName: "Transfer",
        fromBlock,
        toBlock,
      });
      
      return logs.map((log) => rawLogToEventObject(log as ERC20TransferLog));
  }

  private async *blockRangeGenerator(startBlock: number, endBlock: number, blockLimit: number): AsyncGenerator<BlockRange> {
    let currentBlock = startBlock;
    while (currentBlock <= endBlock) {
      const nextBlock = Math.min(currentBlock + (blockLimit - 1), endBlock);
      yield {
        fromBlock: currentBlock,
        toBlock: nextBlock
      };
      if (nextBlock === endBlock) break;
      currentBlock = nextBlock + 1;
    }
  }

  public async backfill(totalStartBlock: number, totalEndBlock: number): Promise<void> {
    console.log(`Getting backfill total events from blocks ${totalStartBlock} to ${totalEndBlock}`);
    for await (const { fromBlock, toBlock } of this.blockRangeGenerator(totalStartBlock, totalEndBlock, this.safeAlchemyBlockLimit)) {
      await this.bullScheduler.addBackFillChunkedRequestJob({fromBlock, toBlock});
    }
    console.log(`Backfill complete`);
  }
}