import type { Log as ViemLog,Address, Hex} from 'viem';
import {EcoErc20TransferEvent} from "./schema"

export type ERC20TransferLog = ViemLog & {
    args: {
        from: Address;
        to: Address;
        value: bigint;
      },
      topics: Hex[]
}

export type TransferStats = {
    totalEvents: number;
    totalValue: string;
}

export interface InfoResponse {
  currentBlock: number;
  realTimeFill: {
      startBlock: number;
      latestBlock: number;
      blockDelay: number;
  };
  backfill: {
      startBlock: number;
      latestBlock: number;
  };
}

export interface PaginatedResponse<T> {
  events: T[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
  }
}

export function rawLogToEventObject(log: ERC20TransferLog): EcoErc20TransferEvent {
    return {
      transactionHash: log.transactionHash as string,
      from: log.args.from as string,
      to: log.args.to as string,
      value: log.args.value.toString(),
      blockNumber: parseInt((log.blockNumber!.toString())),
      blockHash: log.blockHash as string,
      data: log.data.toString(),
      transactionIndex: log.transactionIndex as number,
      logIndex: log.logIndex as number,
      removed: log.removed
    };
  }