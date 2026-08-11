'use client';

import { useEffect, useState } from 'react';
import {
  createWalletClient,
  custom,
  parseUnits,
  type Address,
  keccak256,
  stringToBytes,
} from 'viem';
import { base } from 'viem/chains';

const USDC =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const paymentAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'linkId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [],
  },
] as const;

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
    };
  }
}

function makeLinkId(
  recipient: string,
  amount: string,
  memo: string
): `0x${string}` {
  return keccak256(
    stringToBytes(`${recipient.toLowerCase()}-${amount}-${memo}`)
  );
}

export default function Home() {
  const [address, setAddress] = useState<Address>();
  const [amount, setAmount] = useState('1');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('BasePayLink payment');
  const [status, setStatus] = useState('');
  const [tx, setTx] = useState('');
  const [paymentLink, setPaymentLink] = useState('');

  const connect = async () => {
    if (!window.ethereum) {
      setStatus('Install MetaMask or another browser wallet.');
      return;
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }],
      });

      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      setAddress(accounts[0] as Address);
      setStatus('Wallet connected to Base Mainnet.');
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : 'Connection failed.'
      );
    }
  };

  const createPaymentLink = () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setStatus('Enter a valid recipient address.');
      return;
    }

    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0) {
      setStatus('Enter a valid amount.');
      return;
    }

    const id = makeLinkId(recipient, amount, memo);

    const url =
      `${window.location.origin}/?pay=${id}` +
      `&recipient=${encodeURIComponent(recipient)}` +
      `&amount=${encodeURIComponent(amount)}` +
      `&memo=${encodeURIComponent(memo)}`;

    setPaymentLink(url);
    setStatus('Payment link created.');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const r = params.get('recipient');
    const a = params.get('amount');
    const m = params.get('memo');

    if (r) setRecipient(r);
    if (a) setAmount(a);
    if (m) setMemo(m);
  }, []);

  const pay = async () => {
    const contract =
      process.env.NEXT_PUBLIC_PAYMENT_CONTRACT as Address | undefined;

    if (!window.ethereum || !address) {
      setStatus('Connect wallet first.');
      return;
    }

    if (!contract) {
      setStatus('Payment contract is not configured.');
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setStatus('Enter a valid recipient address.');
      return;
    }

    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0) {
      setStatus('Enter a valid amount.');
      return;
    }

    try {
      const wallet = createWalletClient({
        chain: base,
        transport: custom(window.ethereum),
      });

      const value = parseUnits(amount, 6);

      const linkId = makeLinkId(recipient, amount, memo);

      setStatus('Approve USDC in your wallet...');

      await wallet.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contract, value],
        account: address,
      });

      setStatus('Approval sent. Confirm payment in your wallet...');

      const hash = await wallet.writeContract({
        address: contract,
        abi: paymentAbi,
        functionName: 'pay',
        args: [
          linkId,
          recipient as Address,
          value,
          memo,
        ],
        account: address,
      });

      setTx(hash);
      setStatus('Payment submitted successfully.');
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : 'Payment failed.'
      );
    }
  };

  return (
    <main className="container">
      <div className="badge">BASE MAINNET</div>

      <h1>BasePayLink</h1>

      <p className="subtitle">
        Simple USDC payments powered by Base.
      </p>

      <section className="card">
        <button onClick={connect}>
          {address
            ? `${address.slice(0, 6)}...${address.slice(-4)}`
            : 'Connect Wallet'}
        </button>
      </section>

      <section className="card">
        <h2>Create Payment Link</h2>

        <label>Recipient</label>

        <input
          placeholder="0x..."
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />

        <label>Amount (USDC)</label>

        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label>Memo</label>

        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />

        <button onClick={createPaymentLink}>
          Create Payment Link
        </button>

        {paymentLink && (
          <div className="status">
            <p>Payment link:</p>

            <input
              readOnly
              value={paymentLink}
              onFocus={(e) => e.currentTarget.select()}
            />

            <button
              onClick={() =>
                navigator.clipboard.writeText(paymentLink)
              }
            >
              Copy Link
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Pay USDC</h2>

        <label>Recipient</label>

        <input
          placeholder="0x..."
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />

        <label>Amount (USDC)</label>

        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label>Memo</label>

        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />

        <button disabled={!address} onClick={pay}>
          Pay USDC
        </button>

        {status && (
          <p className="status">{status}</p>
        )}

        {tx && (
          <p>
            Transaction:{' '}
            <a
              href={`https://basescan.org/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
            >
              View on BaseScan
            </a>
          </p>
        )}
      </section>
    </main>
  );
}