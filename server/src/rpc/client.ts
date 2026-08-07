import { loadConfig, type Config } from '../config';
import { errMessage } from '../util';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly method?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface VerboseScriptPubKey {
  address?: string;
  addresses?: string[];
  type?: string;
}

export interface VerboseTxInput {
  txid?: string;
  vout?: number;
  prevout?: {
    value?: number;
    scriptPubKey?: VerboseScriptPubKey;
  } | null;
}

export interface VerboseTxOutput {
  value: number;
  n: number;
  scriptPubKey?: VerboseScriptPubKey;
}

export interface VerboseTx {
  txid: string;
  blockhash?: string;
  vin: VerboseTxInput[];
  vout: VerboseTxOutput[];
}

export interface BlockInfo {
  hash: string;
  height: number;
  time?: number;
  tx: string[];
}

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
}

export interface BitcoinRpc {
  getblockchaininfo(): Promise<BlockchainInfo>;
  getrawmempool(): Promise<string[]>;
  getrawtransaction(txid: string): Promise<VerboseTx>;
  getblockhash(height: number): Promise<string>;
  getblock(hash: string): Promise<BlockInfo>;
}

export class BitcoinRpcClient implements BitcoinRpc {
  constructor(
    private readonly config: Config = loadConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const { bitcoindRpcUser, bitcoindRpcPassword } = this.config;
    if (bitcoindRpcUser !== null || bitcoindRpcPassword !== null) {
      const token = Buffer.from(`${bitcoindRpcUser ?? ''}:${bitcoindRpcPassword ?? ''}`).toString('base64');
      headers.authorization = `Basic ${token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.bitcoindRpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '1.0', id: 'chainwatch', method, params }),
      });
    } catch (err) {
      throw new RpcError(`rpc ${method}: network error: ${errMessage(err)}`, method);
    }
    if (!res.ok) {
      throw new RpcError(`rpc ${method}: HTTP ${res.status}`, method, res.status);
    }
    const body = (await res.json()) as { result: T | null; error: { code: number; message: string } | null };
    if (body.error) {
      throw new RpcError(`rpc ${method}: ${body.error.message} (code ${body.error.code})`, method);
    }
    return body.result as T;
  }

  getblockchaininfo(): Promise<BlockchainInfo> {
    return this.call<BlockchainInfo>('getblockchaininfo');
  }

  getrawmempool(): Promise<string[]> {
    return this.call<string[]>('getrawmempool');
  }

  getrawtransaction(txid: string): Promise<VerboseTx> {
    return this.call<VerboseTx>('getrawtransaction', [txid, 2]);
  }

  getblockhash(height: number): Promise<string> {
    return this.call<string>('getblockhash', [height]);
  }

  getblock(hash: string): Promise<BlockInfo> {
    return this.call<BlockInfo>('getblock', [hash, 1]);
  }
}
