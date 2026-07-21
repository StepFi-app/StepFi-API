import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';
import { JwtService } from '@nestjs/jwt';
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';

interface AuthenticatedWebSocket extends WebSocket {
  wallet?: string;
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: JwtService;

  const mockJwtService = {
    verifyAsync: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    let mockClient: AuthenticatedWebSocket;
    let mockReq: IncomingMessage;

    beforeEach(() => {
      mockClient = {
        close: jest.fn(),
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        wallet: undefined,
      } as unknown as AuthenticatedWebSocket;

      mockReq = {
        url: '/realtime?token=valid_token',
        headers: {},
      } as unknown as IncomingMessage;
    });

    it('should reject connection when token is missing', async () => {
      mockReq = {
        url: '/realtime',
        headers: {},
      } as unknown as IncomingMessage;

      await gateway.handleConnection(mockClient, mockReq);

      expect(mockClient.close).toHaveBeenCalledWith(4001, 'Unauthorized: missing token');
    });

    it('should reject connection when token fails verification', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));
      await gateway.handleConnection(mockClient, mockReq);

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith('valid_token');
      expect(mockClient.close).toHaveBeenCalledWith(4003, 'Unauthorized: invalid token');
    });

    it('should reject connection when token is valid but has no wallet claim', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({});
      await gateway.handleConnection(mockClient, mockReq);

      expect(mockClient.close).toHaveBeenCalledWith(4002, 'Unauthorized: missing wallet claim');
    });

    it('should accept connection, authenticate wallet, and increment client count', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ wallet: 'wallet123' });
      await gateway.handleConnection(mockClient, mockReq);

      expect(mockClient.wallet).toBe('wallet123');
      expect(gateway.getClientsCount()).toBe(1);
    });

    it('should extract token from sec-websocket-protocol header if query string is empty', async () => {
      mockReq = {
        url: '/realtime',
        headers: {
          'sec-websocket-protocol': 'header_token',
        },
      } as unknown as IncomingMessage;

      mockJwtService.verifyAsync.mockResolvedValue({ wallet: 'wallet123' });

      await gateway.handleConnection(mockClient, mockReq);

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith('header_token');
      expect(mockClient.wallet).toBe('wallet123');
    });
  });

  describe('handleDisconnect', () => {
    it('should cleanly remove connection and decrement client count on disconnect', async () => {
      const mockClient = {
        close: jest.fn(),
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        wallet: 'wallet123',
      } as unknown as AuthenticatedWebSocket;

      const mockReq = {
        url: '/realtime?token=valid_token',
        headers: {},
      } as unknown as IncomingMessage;

      mockJwtService.verifyAsync.mockResolvedValue({ wallet: 'wallet123' });

      await gateway.handleConnection(mockClient, mockReq);
      expect(gateway.getClientsCount()).toBe(1);

      gateway.handleDisconnect(mockClient);
      expect(gateway.getClientsCount()).toBe(0);
    });
  });

  describe('sendToUser', () => {
    it('should deliver event only to the correct authenticated wallet address', async () => {
      const mockClient1 = {
        close: jest.fn(),
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        wallet: 'walletA',
      } as unknown as AuthenticatedWebSocket;

      const mockClient2 = {
        close: jest.fn(),
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        wallet: 'walletB',
      } as unknown as AuthenticatedWebSocket;

      mockJwtService.verifyAsync.mockResolvedValueOnce({ wallet: 'walletA' });
      mockJwtService.verifyAsync.mockResolvedValueOnce({ wallet: 'walletB' });

      await gateway.handleConnection(mockClient1, { url: '/realtime?token=tokA', headers: {} } as unknown as IncomingMessage);
      await gateway.handleConnection(mockClient2, { url: '/realtime?token=tokB', headers: {} } as unknown as IncomingMessage);

      gateway.sendToUser('walletA', 'test_event', { msg: 'hello' });

      expect(mockClient1.send).toHaveBeenCalledWith(
        JSON.stringify({ event: 'test_event', payload: { msg: 'hello' } }),
      );
      expect(mockClient2.send).not.toHaveBeenCalled();
    });
  });
});
