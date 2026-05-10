import {
  TonClient,
  WalletContractV4,
  WalletContractV3R2,
  WalletContractV5R1,
  toNano,
  Address,
  internal,
  SendMode,
} from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { logger } from "./logger";

function getClient(): TonClient {
  const apiKey = process.env.TON_API_KEY;
  const endpoint =
    process.env.TON_ENDPOINT || "https://toncenter.com/api/v2/jsonRPC";
  return new TonClient({ endpoint, ...(apiKey ? { apiKey } : {}) });
}

// Wallet versions to probe in priority order
const WALLET_VERSIONS = ["V5R1", "V4", "V3R2"] as const;

function buildContracts(publicKey: Buffer) {
  return {
    V5R1: WalletContractV5R1.create({ publicKey, workchain: 0 }),
    V4:   WalletContractV4.create({ publicKey, workchain: 0 }),
    V3R2: WalletContractV3R2.create({ publicKey, workchain: 0 }),
  };
}

async function detectWallet(client: TonClient, publicKey: Buffer) {
  const contracts = buildContracts(publicKey);
  for (const ver of WALLET_VERSIONS) {
    const c = contracts[ver];
    if (await client.isContractDeployed(c.address)) {
      logger.info({ version: ver, address: c.address.toString({ bounceable: false }) }, "Detected wallet version");
      return { contract: c, version: ver };
    }
  }
  // None deployed — check V5R1 balance (newest default)
  const c = contracts.V5R1;
  const balance = await client.getBalance(c.address);
  if (balance === 0n) {
    throw new Error(
      `Hot wallet not funded. Send TON to: ${c.address.toString({ bounceable: false })}`
    );
  }
  logger.info({ version: "V5R1", address: c.address.toString({ bounceable: false }) }, "Wallet not deployed yet — will deploy on first send");
  return { contract: c, version: "V5R1" };
}

export interface TonSendResult {
  txRef: string;
}

export async function sendTon(
  toAddress: string,
  amountTon: string
): Promise<TonSendResult> {
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error("TON_WALLET_MNEMONIC not configured");

  const words = mnemonic.trim().split(/\s+/);
  if (words.length < 12) throw new Error("Invalid mnemonic (too short)");

  const keyPair = await mnemonicToPrivateKey(words);
  const client = getClient();

  const { contract, version } = await detectWallet(client, keyPair.publicKey);

  type OpenedWallet =
    | ReturnType<typeof client.open<WalletContractV5R1>>
    | ReturnType<typeof client.open<WalletContractV4>>
    | ReturnType<typeof client.open<WalletContractV3R2>>;

  let wallet: OpenedWallet;
  if (version === "V5R1") {
    wallet = client.open(contract as WalletContractV5R1);
  } else if (version === "V4") {
    wallet = client.open(contract as WalletContractV4);
  } else {
    wallet = client.open(contract as WalletContractV3R2);
  }

  let seqno = 0;
  try {
    seqno = await wallet.getSeqno();
  } catch {
    seqno = 0;
  }

  logger.info({ to: toAddress, amount: amountTon, seqno }, "Sending TON transfer");

  await wallet.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: toNano(amountTon),
        bounce: false,
        body: "@Jojox1bot",
      }),
    ],
  });

  const txRef = `seqno-${seqno}-${Date.now()}`;
  logger.info({ to: toAddress, amount: amountTon, seqno, txRef }, "TON transfer submitted");

  return { txRef };
}

export async function getWalletAddress(): Promise<string | null> {
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) return null;
  try {
    const words = mnemonic.trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(words);
    const client = getClient();
    const { contract } = await detectWallet(client, keyPair.publicKey).catch(() => {
      // If not funded, still return V5R1 address
      const contracts = buildContracts(keyPair.publicKey);
      return { contract: contracts.V5R1, version: "V5R1" };
    });
    return contract.address.toString({ bounceable: false, testOnly: false });
  } catch {
    return null;
  }
}

export async function getWalletBalance(): Promise<string | null> {
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) return null;
  try {
    const words = mnemonic.trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(words);
    const client = getClient();
    const contracts = buildContracts(keyPair.publicKey);
    // Check all versions and sum (realistically only one is deployed)
    for (const ver of WALLET_VERSIONS) {
      const c = contracts[ver];
      if (await client.isContractDeployed(c.address)) {
        const balance = await client.getBalance(c.address);
        return (Number(balance) / 1e9).toFixed(4);
      }
    }
    // None deployed — return V5R1 balance (likely 0)
    const balance = await client.getBalance(contracts.V5R1.address);
    return (Number(balance) / 1e9).toFixed(4);
  } catch {
    return null;
  }
}

export function isTonConfigured(): boolean {
  return !!process.env.TON_WALLET_MNEMONIC;
}
