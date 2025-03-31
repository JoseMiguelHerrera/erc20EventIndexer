import { Block, createPublicClient } from "viem";
import { getMetadata } from "../database/operations";
import { InfoResponse } from "../database/models";

/*

*/


export class Info {


    private viemClient: ReturnType<typeof createPublicClient>;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(viemClient: ReturnType<typeof createPublicClient>) {
        this.viemClient = viemClient;
    }

    async getCurrentBlock(): Promise<number> {
        const currentBlock = await this.viemClient.getBlockNumber();
        return parseInt(currentBlock.toString());
    }

    async getBlockNumberFromTimestamp(timestamp:number) {
        try {
          const result: Block = await this.viemClient.transport.request({
            method: 'eth_getBlockByTimestamp',
            params: [
              `0x${timestamp.toString(16)}`, // Convert timestamp to hex
              false // We only need the block number, not the full block details
            ]
          });

          if(!result.number) {
            throw new Error('No block number returned from RPC call');
          }

          return parseInt(result.number.toString());
        } catch (error) {
          console.error('Error with direct RPC call:', error);
          
          // If the method is not supported, fall back to an alternative approach
          console.log('Falling back to alternative method...');
          
          // Get blocks using another publicly available endpoint or service
          // This could be a call to a block explorer API, etc.
          
          throw new Error('Unable to get block number from timestamp. The node provider may not support the eth_getBlockByTimestamp method.');
        }
      }


    public stopPeriodicInfoPrinting() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Stopped periodic info printing');
        }
    }

    async getInfo(): Promise<InfoResponse> {
        try {
            const metadata = await getMetadata();
            const currentBlock = await this.getCurrentBlock();

            return {
                currentBlock,
                realTimeFill: {
                    startBlock: metadata.realTimeFillStartBlock,
                    latestBlock: metadata.realTimeFillLatestBlock,
                    blockDelay: currentBlock - metadata.realTimeFillLatestBlock
                },
                backfill: {
                    startBlock: metadata.backFillStartBlock,
                    latestBlock: metadata.backFillLatestBlock,
                },
            } as InfoResponse;
        } catch (error) {
            console.error("Error getting info data");
            console.error(error);
            throw error; // Re-throw to let caller handle the error
        }
    }
}
