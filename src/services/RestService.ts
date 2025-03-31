import express, { Request, Response, RequestHandler } from "express";
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

import { env } from "../env";
import { getPaginatedTransferEvents, getTransferStats } from "../database/operations";
import { Info } from "./Info";

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Transfer Events API',
      version: '1.0.0',
      description: 'API for querying transfer events and statistics',
    },
    servers: [
      {
        url: `http://localhost:${process.env.REST_PORT || 3000}`,
        description: 'Indexer Server',
      },
    ],
  },
  apis: ['./src/services/RestService.ts'], // Path to the API docs
};

/**
 * @swagger
 * components:
 *   schemas:
 *     EcoErc20TransferEvent:
 *       type: object
 *       properties:
 *         transactionHash:
 *           type: string
 *         from:
 *           type: string
 *         to:
 *           type: string
 *         value:
 *           type: string
 *         blockNumber:
 *           type: integer
 *         blockHash:
 *           type: string
 *         data:
 *           type: string
 *         transactionIndex:
 *           type: integer
 *         logIndex:
 *           type: integer
 *         removed:
 *           type: boolean
 *     
 *     InfoResponse:
 *       type: object
 *       properties:
 *         currentBlock:
 *           type: integer
 *         realTimeFill:
 *           type: object
 *           properties:
 *             startBlock:
 *               type: integer
 *             latestBlock:
 *               type: integer
 *             blockDelay:
 *               type: integer
 *         backfill:
 *           type: object
 *           properties:
 *             startBlock:
 *               type: integer
 *             latestBlock:
 *               type: integer
 *     
 *     TransferStats:
 *       type: object
 *       properties:
 *         totalEvents:
 *           type: integer
 *         totalValue:
 *           type: string
 *     
 *     PaginatedResponse:
 *       type: object
 *       properties:
 *         events:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/EcoErc20TransferEvent'
 *         pagination:
 *           type: object
 *           properties:
 *             currentPage:
 *               type: integer
 *             pageSize:
 *               type: integer
 *             totalPages:
 *               type: integer
 *             totalItems:
 *               type: integer
 */

export class ExpressRestService {
  private app;
  private info: Info;
  constructor(
    info: Info
  ) {
    this.app = express();
    this.app.use(express.json());
    
    // Initialize Swagger
    const swaggerSpec = swaggerJsdoc(swaggerOptions);
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    
    //Rate Limiter
    const limiter = rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later',
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    });

    // Apply rate limiting to all routes
    this.app.use(limiter);
    
    this.info = info;
  }

  async start() {
    this.app.listen(env.REST_PORT, () => {
      console.log(`Running on ${env.REST_PORT}...`);
      console.log(
        `For the bullboard UI, open http://localhost:${env.REST_PORT}`
      );
    });

    /**
     * @swagger
     * /socketClient:
     *   get:
     *     summary: Serves the Socket.IO client monitoring interface
     *     description: Returns an HTML page for monitoring Socket.IO events
     *     responses:
     *       200:
     *         description: HTML page successfully served
     */
    this.app.get("/socketClient", (req, res) => {
      res.sendFile("client.html", { root: "./src/public" });
    });

    /**
     * @swagger
     * /stats:
     *   get:
     *     summary: Get transfer statistics
     *     description: Returns transfer statistics and system information
     *     responses:
     *       200:
     *         description: Successfully retrieved stats
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/TransferStats'
     */
    this.app.get("/stats", async (req, res) => {
      const stats = await getTransferStats();
      const info = await this.info.getInfo();
      res.json({
        stats,
        info
      });
    });

    /**
     * @swagger
     * /events:
     *   get:
     *     summary: Get paginated transfer events
     *     description: Returns a paginated list of transfer events with optional filters
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           minimum: 1
     *         description: Page number
     *       - in: query
     *         name: pageSize
     *         schema:
     *           type: integer
     *           minimum: 1
     *         description: Number of items per page
     *       - in: query
     *         name: fromBlock
     *         schema:
     *           type: integer
     *         description: Starting block number
     *       - in: query
     *         name: toBlock
     *         schema:
     *           type: integer
     *         description: Ending block number
     *       - in: query
     *         name: fromAddress
     *         schema:
     *           type: string
     *         description: Source address
     *       - in: query
     *         name: toAddress
     *         schema:
     *           type: string
     *         description: Destination address
     *       - in: query
     *         name: minValue
     *         schema:
     *           type: string
     *         description: Minimum transfer value
     *       - in: query
     *         name: transactionHash
     *         schema:
     *           type: string
     *         description: Specific transaction hash
     *     responses:
     *       200:
     *         description: Successfully retrieved events
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedResponse'
     *       400:
     *         description: Invalid parameters provided
     *       500:
     *         description: Internal server error
     */
    this.app.get("/events", (async (req, res) => {
      try {
        const page = req.query.page ? parseInt(req.query.page as string) : 1;
        const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 1000;

        // Validate input
        if (isNaN(page) || page < 1) {
          return res.status(400).json({ error: "Invalid page number. Must be a positive integer." });
        }

        if (isNaN(pageSize) || pageSize < 1) {
          return res.status(400).json({ error: "Invalid page size. Must be a positive integer." });
        }

        // Build filters object from query parameters
        const filters: {
          fromAddress?: string;
          toAddress?: string;
          minValue?: string;
          transactionHash?: string;
          fromBlock?: number;
          toBlock?: number;
        } = {};

        // Handle block range parameters
        if (req.query.fromBlock) {
          const fromBlock = parseInt(req.query.fromBlock as string);
          if (isNaN(fromBlock)) {
            return res.status(400).json({ error: "Invalid fromBlock. Must be a number." });
          }
          filters.fromBlock = fromBlock;
        }

        if (req.query.toBlock) {
          const toBlock = parseInt(req.query.toBlock as string);
          if (isNaN(toBlock)) {
            return res.status(400).json({ error: "Invalid toBlock. Must be a number." });
          }
          filters.toBlock = toBlock;
        }

        // Validate block range if both are provided
        if (filters.fromBlock !== undefined && 
            filters.toBlock !== undefined && 
            filters.fromBlock > filters.toBlock) {
          return res.status(400).json({ 
            error: "Invalid block range: fromBlock cannot be greater than toBlock" 
          });
        }

        if (req.query.fromAddress) {
          filters.fromAddress = req.query.fromAddress as string;
        }

        if (req.query.toAddress) {
          filters.toAddress = req.query.toAddress as string;
        }

        if (req.query.minValue) {
          filters.minValue = req.query.minValue as string;
        }

        if (req.query.transactionHash) {
          filters.transactionHash = req.query.transactionHash as string;
        }

        const events = await getPaginatedTransferEvents(page, pageSize, 
          Object.keys(filters).length > 0 ? filters : undefined
        );
        
        res.json(events);
      } catch (error) {
        console.error("Error fetching paginated events:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }) as RequestHandler);
  }

  getExpressApp() {
    return this.app;
  }
}
