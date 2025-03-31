import {
    Address,
    createPublicClient,
    Log,
    webSocket,
    GetContractEventsReturnType,
    parseAbi
  } from "viem";
  import { arbitrum, arbitrumSepolia } from "viem/chains";
  import { env } from "../env";
  import {abi} from "../../contracts/erc20";
  //import { type BullScheduler } from "./BullScheduler";
  //import { ethers } from "ethers";
  //import EventFilter from "./EventFilter"; //TODO: add event filter
  import IORedis from "ioredis";

    interface WebSocketEventListenerParams {
    url: string;
    //bullScheduler: BullScheduler;
  }
    
  export class WebSocketEventListener {


    private _viemClient: ReturnType<typeof createPublicClient>;
    //private _bullScheduler: BullScheduler;
    //public eventFilter: EventFilter;
  
    private eventHandler: (logs: any[]) => Promise<void>;
  
    constructor(opts: WebSocketEventListenerParams, eventHandler: (logs: any[]) => Promise<void>, redisConnection?: IORedis) {
      this._viemClient = this._init(opts);
      this.eventHandler = eventHandler;
  
      console.log(
        "WebSocketProvider initialized on chain: ",
        this._viemClient.chain!.name
      );
      this._connect(opts);
    }
  
    private _init = (opts: WebSocketEventListenerParams) => {
      return createPublicClient({
        chain: arbitrum,
        transport: webSocket(opts.url),
      });
    };
  
    private _connect = async (opts: WebSocketEventListenerParams) => {
      console.log("Connecting to WebSocket provider...");
  
      // NOTE: Pulled this from a converation to help keep connections alive by
      // fetching a block every 5 minutes
      // https://github.com/wevm/viem/discussions/2011#discussioncomment-9607609
      const provider = await this._viemClient.transport.getRpcClient();
  
      const heartbeat = () => {
        this._viemClient
          .getBlockNumber()
          .then((_) => {
            //do nothing on heartbeat
          })
          .catch((err) => console.error("Error fetching blockNumber: ", err));
      };
      let intervalId: NodeJS.Timeout | null = null;
      intervalId = setInterval(heartbeat, 3 * 60 * 1000); // 3 minutes
  
      // NOTE: Logging all messages
      const onOpen = (_: Event) => {
        console.info("Websocket connection opened!");
      };
  
      const onMessage = (m: MessageEvent<any>) => {
        //optionally log the raw message
      };
  
      const onError = (ev: ErrorEvent) => {
        console.error("WebSocket Error:", {
          message: ev.message || "Unknown error",
          type: ev.type,
          error: ev instanceof ErrorEvent ? ev.error : null,
          timestamp: new Date().toISOString(),
        });
      };
      
      //TODO: add ability to get missed blocks on a reconnect
      const onClose = async () => {
        console.warn("Websocket connection closed!");
        provider.socket.removeEventListener("open", onOpen);
        provider.socket.removeEventListener("message", onMessage);
        provider.socket.removeEventListener("error", onError);
        provider.socket.removeEventListener("close", onClose);
        // NOTE: IMPORTANT: invalidate viem's socketClientCache! When close
        // happens on socket level, the same socketClient with the closed websocket will be
        // re-used from cache leading to 'Socket is closed.' error.
        provider.close();
  
        clearInterval(intervalId as NodeJS.Timeout);
  
        this._viemClient = this._init(opts);
        console.info("Re-establishing connection!");
        this._connect(opts);
      };
  
      const setupEventListeners = () => {
        provider.socket.addEventListener("open", onOpen);
        provider.socket.addEventListener("message", onMessage);
        provider.socket.addEventListener("error", onError);
        provider.socket.addEventListener("close", onClose);
      };
  
      setupEventListeners();
      heartbeat();
  
      this._watchAssetTransfer();
    };
  
    private _watchAssetTransfer = async () => {
      // Get current block on start/reconnect
      const currentBlock = await this._viemClient.getBlockNumber();
      console.log("Watching Assets transfers from block:", currentBlock);
  
      const unwatch = this._viemClient.watchContractEvent({
        address: env.TARGET_CONTRACT_ADDRESS as Address,
        abi,//TODO: get the abi more intelligently
        eventName: env.TARGET_CONTRACT_EVENT_NAME as string,
        onLogs: (logs) => this.eventHandler(logs),
        onError: (error) => {
          console.error("Error watching asset transfer", error);
          unwatch();
        },
      });
    };
  
  }
  