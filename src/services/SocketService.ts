import { Express } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';

export class SocketIOManager {
  private server: http.Server;
  private io: Server | null = null;
  private pubClient: IORedis;
  private subClient: IORedis;
  private connectedUsers: number = 0;
  
  /**
   * Constructor accepting an Express app and a Redis client
   * The sub client will be created by duplicating the pub client
   */
  constructor(app: Express, redisClient: IORedis) {
    this.server = http.createServer(app);
    this.pubClient = redisClient;
    this.subClient = redisClient.duplicate();
  }

  /**
   * Initialize and start the Socket.IO server with Redis adapter
   */
  public initialize(options: {
    corsOrigin?: string;
  } = {}): Server {
    try {
      const { corsOrigin = '*' } = options;
      
      // Initialize Socket.IO with Redis adapter
      this.io = new Server(this.server, {
        cors: {
          origin: corsOrigin,
          methods: ['GET', 'POST']
        }
      });
      
      // Apply Redis adapter
      this.io.adapter(createAdapter(this.pubClient, this.subClient));
      
      // Set up connection/disconnection tracking
      this.setupConnectionHandlers();
      
      return this.io;
    } catch (error) {
      console.error('Failed to initialize Socket.IO with Redis:', error);
      throw error;
    }
  }
  
  /**
   * Set up connection/disconnection handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.io) {
      throw new Error('Socket.IO server not initialized');
    }
    
    this.io.on('connection', (socket: Socket) => {
      this.connectedUsers++;
      console.log(`Client connected. Total connected: ${this.connectedUsers}`);
        socket.emit("welcome", "Welcome to the server");
      socket.on('disconnect', () => {
        this.connectedUsers--;
        console.log(`Client disconnected. Total connected: ${this.connectedUsers}`);
      });
    });
  }
  
  /**
   * Broadcast a message to all connected clients
   */
  public broadcast(eventName: string, data: any): void {
    if (!this.io) {
      throw new Error('Socket.IO server not initialized');
    }
    this.io.sockets.emit(eventName, data);
  }
  
  /**
   * Get the HTTP server instance
   */
  public getServer(): http.Server {
    return this.server;
  }
  
  /**
   * Get the Socket.IO server instance
   */
  public getIO(): Server | null {
    return this.io;
  }
  
  /**
   * Get the number of connected clients
   */
  public getConnectedCount(): number {
    return this.connectedUsers;
  }
  
  /**
   * Start the HTTP server on the specified port
   */
  
  public listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        console.log(`Server listening on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Clean up resources on shutdown
   */
  public shutdown(): void {
    console.log('Shutting down Socket.IO manager...');
    
    if (this.io) {
      this.io.close();
      this.io = null;
    }
    
    // Only disconnect the subscriber client as the publisher is managed externally
    this.subClient.disconnect();
    
    console.log('Socket.IO manager shut down successfully');
  }
}