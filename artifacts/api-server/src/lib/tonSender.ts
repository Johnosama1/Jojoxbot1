import {
  TonClient,
  WalletContractV4,
  WalletContractV3R2,
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

  // Try V4 first, fallback to V3R2
  const contractV4 = WalletContractV4.create({
    publicKey: keyPair.publicKey,
    workchain: 0,
  });
  const contractV3 = WalletContractV3R2.create({
    publicKey: keyPair.publicKey,
    workchain: 0,
  });

  // Detect which wallet version is deployed
  let walletContract: typeof contractV4 | typeof contractV3 = contractV4;
  const isV4Deployed = await client.isContractDeployed(contractV4.address);
  if (!isV4Deployed) {
    const isV3Deployed = await client.isContractDeployed(contractV3.address);
    if (isV3Deployed) {
      walletContract = contractV3;
      logger.info("Using WalletV3R2");
    } else {
      // Neither deployed — check balance and attempt deploy via V4
      const balance = await client.getBalance(contractV4.address);
      if (balance === 0n) {
        throw new Error(
          `Hot wallet not funded. Send TON to: ${contractV4.address.toString({ bounceable: false })}`
        );
      }
      logger.info("Hot wallet not yet deployed — will deploy on first send");
      walletContract = contractV4;
    }
  }

  const wallet = client.open(walletContract as typeof contractV4);

  // seqno — 0 means undeployed (will deploy on send)
  let seqno = 0;
  try {
    seqno = await wallet.getSeqno();
  } catch {
    seqno = 0;
  }

  logger.info(
    { to: toAddress, amount: amountTon, seqno, walletVersion: isV4Deployed ? "V4" : "V3R2" },
    "Sending TON transfer"
  );

  await wallet.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: toNano(amountTon),
        bounce: false,
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
    const v4 = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    const v3 = WalletContractV3R2.create({ publicKey: keyPair.publicKey, workchain: 0 });
    const isV4 = await client.isContractDeployed(v4.address);
    const contract = isV4 ? v4 : v3;
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
    const v4 = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    const v3 = WalletContractV3R2.create({ publicKey: keyPair.publicKey, workchain: 0 });
    const isV4 = await client.isContractDeployed(v4.address);
    const addr = isV4 ? v4.address : v3.address;
    const balance = await client.getBalance(addr);
    return (Number(balance) / 1e9).toFixed(4);
  } catch {
    return null;
  }
}

export function isTonConfigured(): boolean {
  return !!process.env.TON_WALLET_MNEMONIC;
}
