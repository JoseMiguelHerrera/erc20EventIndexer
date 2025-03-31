import { env } from "./env";
import { WebSocketEventListener } from "./services/WebSocketEventListener";
import {ERC20TransferLog,rawLogToEventObject} from './database/models'
import { BullScheduler } from "./services/BullScheduler";

export class RealTimeFill {

  private bullScheduler: BullScheduler;

  constructor(_bullScheduler: BullScheduler) {
    this.bullScheduler = _bullScheduler;
  }

  private eventHandler = async (logs: ERC20TransferLog[]) => {
    await this.bullScheduler.addRealTimeReceiptJob(rawLogToEventObject(logs[0]));
  };

  async start() {
    const webSocketEventListener=new WebSocketEventListener({
      url: env.WS_URL,
    }, this.eventHandler)
  }

}


