import { TonClient, WalletContractV4, toNano, Address, internal } from "@ton/ton";
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

  const wallet = client.open(
    WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
  );

  const seqno = await wallet.getSeqno();

  await wallet.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: toNano(amountTon),
        bounce: false,
      }),
    ],
  });

  const txRef = `seqno-${seqno}-${Date.now()}`;
  logger.info({ to: toAddress, amount: amountTon, seqno, txRef }, "TON transfer sent");

  return { txRef };
}

export async function getWalletAddress(): Promise<string | null> {
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) return null;
  try {
    const words = mnemonic.trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(words);
    const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    return wallet.address.toString({ bounceable: false, testOnly: false });
  } catch {
    return null;
  }
}

export function isTonConfigured(): boolean {
  return !!process.env.TON_WALLET_MNEMONIC;
}
