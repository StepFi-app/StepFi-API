import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';
import { WebSocketServer, WebSocket } from 'ws';

jest.mock('ws');

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let configService: ConfigService;

  const mockConfig = {
    get: jest.fn().mockReturnValue(3005),
  };

  const mockWss = {
    on: jest.fn(),
    close: jest.fn((cb) => cb && cb()),
    clients: new Set<any>(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockWss.clients.clear();
    (WebSocketServer as unknown as jest.Mock).mockReturnValue(mockWss);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should initialize WebSocketServer on module init', () => {
    gateway.onModuleInit();
    expect(WebSocketServer).toHaveBeenCalledWith({ port: 3005 });
    expect(mockWss.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('should close WebSocketServer on module destroy', () => {
    gateway.onModuleInit();
    gateway.onModuleDestroy();
    expect(mockWss.close).toHaveBeenCalled();
  });

  it('should broadcast event to all open clients', () => {
    gateway.onModuleInit();

    const mockClient1 = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
    };
    const mockClient2 = {
      readyState: WebSocket.CLOSED,
      send: jest.fn(),
    };
    mockWss.clients.add(mockClient1);
    mockWss.clients.add(mockClient2);

    gateway.broadcast('test_event', { key: 'value' });

    expect(mockClient1.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'test_event', payload: { key: 'value' } }),
    );
    expect(mockClient2.send).not.toHaveBeenCalled();
  });

  it('should return clients count', () => {
    gateway.onModuleInit();
    expect(gateway.getClientsCount()).toBe(0);

    mockWss.clients.add({ readyState: WebSocket.OPEN });
    expect(gateway.getClientsCount()).toBe(1);
  });
});
