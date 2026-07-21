import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';

interface AuthenticatedWebSocket extends WebSocket {
  wallet?: string;
}

@WebSocketGateway({ path: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly activeConnections = new Map<string, Set<AuthenticatedWebSocket>>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: AuthenticatedWebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '', 'http://localhost');
    let token = url.searchParams.get('token');

    if (!token) {
      const protocols = req.headers['sec-websocket-protocol'];
      if (protocols) {
        token = (protocols as string).split(',')[0].trim();
      }
    }

    if (!token) {
      this.logger.warn('Connection rejected: missing authentication token');
      client.close(4001, 'Unauthorized: missing token');
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      const wallet = payload.wallet as string | undefined;

      if (!wallet) {
        this.logger.warn('Connection rejected: token payload missing wallet address');
        client.close(4002, 'Unauthorized: missing wallet claim');
        return;
      }

      client.wallet = wallet;
      let connections = this.activeConnections.get(wallet);
      if (!connections) {
        connections = new Set<AuthenticatedWebSocket>();
        this.activeConnections.set(wallet, connections);
      }
      connections.add(client);
      this.logger.log(`Client authenticated successfully for wallet: ${wallet}`);
    } catch (err) {
      this.logger.warn(`Connection rejected: token verification failed: ${err.message}`);
      client.close(4003, 'Unauthorized: invalid token');
    }
  }

  handleDisconnect(client: AuthenticatedWebSocket): void {
    const wallet = client.wallet;
    if (wallet) {
      const connections = this.activeConnections.get(wallet);
      if (connections) {
        connections.delete(client);
        if (connections.size === 0) {
          this.activeConnections.delete(wallet);
        }
      }
      this.logger.log(`Client disconnected for wallet: ${wallet}`);
    }
  }

  sendToUser(walletAddress: string, event: string, payload: unknown): void {
    const connections = this.activeConnections.get(walletAddress);
    if (!connections) return;

    const message = JSON.stringify({ event, payload });
    connections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  getClientsCount(): number {
    let count = 0;
    this.activeConnections.forEach((connections) => {
      count += connections.size;
    });
    return count;
  }
}
