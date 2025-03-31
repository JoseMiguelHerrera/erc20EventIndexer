import { env } from './env'
import { initializeMetadataTable, waitForRealTimeFillStart, getMetadata } from './database/operations';
import { RealTimeFill } from './RealtimeFill'
import { BackFill } from './BackFill'
import { ExpressRestService } from "./services/RestService";
import { BullScheduler } from "./services/BullScheduler";
import { arbitrum } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import { Info } from './services/Info';

async function main() {
  await initializeMetadataTable();
  const bullScheduler = new BullScheduler();
  const viemHttpClient = createPublicClient({
    chain: arbitrum,
    transport: http(env.PROVIDER_URL),
  });
  const info = new Info(viemHttpClient);
  const restService = new ExpressRestService(info);
  await restService.start();
  const app = restService.getExpressApp();

  await bullScheduler.init(env.REDIS_CONNECTION_STRING, env.REDIS_USE_TLS, app);

  const metadataBeforeStart = await getMetadata();

  console.log(`Starting real time fill`);
  const realTimeFill = new RealTimeFill(bullScheduler);
  await realTimeFill.start();
  let realtimeFillStartBlock = await waitForRealTimeFillStart();

  if (!realtimeFillStartBlock) {
    console.log("No real time fill event ocurred in time window, starting backfill from latest block");
    realtimeFillStartBlock = await info.getCurrentBlock();
  } else {
    console.log(`Real time fill caputed first event at block ${realtimeFillStartBlock}, starting backfill from there`);
  }
  const backFillStartBlock = metadataBeforeStart.backFillLatestBlock == 0 ? parseInt(env.BLOCK_START_NUMBER) : metadataBeforeStart.backFillLatestBlock;
  const backFillEndBlock = realtimeFillStartBlock - 1;

  console.log(`Starting backfill from block ${backFillStartBlock} to ${backFillEndBlock}`);
  const backFill = new BackFill(bullScheduler, viemHttpClient);
  await bullScheduler.setBackFill(backFill);

  await backFill.backfill(backFillStartBlock, backFillEndBlock);

  // Add process termination handlers
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal. Cleaning up...');
    await bullScheduler.cleanup();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal. Cleaning up...');
    await bullScheduler.cleanup();
    process.exit(0);
  });

}




main();