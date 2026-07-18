import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const port = Number(this.configService.get<number>('WEBSOCKET_PORT', 3005));
    this.wss = new WebSocketServer({ port });
    this.logger.log(`WebSocket Gateway initialized on port ${port}`);

    this.wss.on('connection', (ws: WebSocket) => {
      this.logger.log('Client connected to WebSocket Gateway');

      ws.on('error', (err) => {
        this.logger.error(`WebSocket error: ${err.message}`);
      });

      ws.on('close', () => {
        this.logger.log('Client disconnected');
      });
    });
  }

  onModuleDestroy() {
    if (this.wss) {
      this.wss.close(() => {
        this.logger.log('WebSocket Gateway server closed');
      });
    }
  }

  broadcast(event: string, payload: unknown): void {
    if (!this.wss) return;
    const message = JSON.stringify({ event, payload });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  getClientsCount(): number {
    return this.wss ? this.wss.clients.size : 0;
  }
}
