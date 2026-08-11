'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  stringToBytes,
  getAddress,
  type Address,
} from 'viem';
import { base } from 'viem/chains';
import { QRCodeSVG } from 'qrcode.react';

const USDC =
  '0x833589fCD6eDb6E08f4c7C32d4f71b54bdA02913' as Address;

const PAYMENT_CONTRACT =
  (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT ||
    '0x0650a97C4d0a130E8aEa7852fA780B97fED5888C') as Address;

const BASE_RPC = 'https://mainnet.base.org';

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

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

const paymentEvent = {
  type: 'event',
  name: 'Payment',
  inputs: [
    {
      indexed: true,
      name: 'linkId',
      type: 'bytes32',
    },
    {
      indexed: true,
      name: 'payer',
      type: 'address',
    },
    {
      indexed: true,
      name: 'recipient',
      type: 'address',
    },
    {
      indexed: false,
      name: 'amount',
      type: 'uint256',
    },
    {
      indexed: false,
      name: 'memo',
      type: 'string',
    },
  ],
} as const;

type PaymentItem = {
  linkId: `0x${string}`;
  payer: Address;
  recipient: Address;
  amount: bigint;
  memo: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
};

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
    stringToBytes(
      `${recipient.toLowerCase()}-${amount}-${memo}`
    )
  );
}

function shortAddress(address: string) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function Home() {
  const [address, setAddress] = useState<Address>();

  const [amount, setAmount] = useState('1');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('BasePayLink payment');

  const [status, setStatus] = useState('');
  const [tx, setTx] = useState('');

  const [paymentLink, setPaymentLink] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const [isPaymentPage, setIsPaymentPage] = useState(false);
  const [copied, setCopied] = useState(false);

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const pay = params.get('pay');
    const r = params.get('recipient');
    const a = params.get('amount');
    const m = params.get('memo');

    if (r) setRecipient(r);
    if (a) setAmount(a);
    if (m) setMemo(m);

    if (pay && r && a) {
      setIsPaymentPage(true);
    }
  }, []);

  const connect = async () => {
    if (!window.ethereum) {
      setStatus(
        'No browser wallet found. Install MetaMask or another compatible wallet.'
      );
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

      if (!accounts[0]) {
        setStatus('No wallet account found.');
        return;
      }

      setAddress(getAddress(accounts[0]));
      setStatus('Wallet connected to Base Mainnet.');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Wallet connection failed.'
      );
    }
  };

  const createPaymentLink = () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setStatus('Enter a valid recipient address.');
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setStatus('Enter a valid amount.');
      return;
    }

    try {
      const linkId = makeLinkId(recipient, amount, memo);

      const url =
        `${window.location.origin}/?pay=${linkId}` +
        `&recipient=${encodeURIComponent(recipient)}` +
        `&amount=${encodeURIComponent(amount)}` +
        `&memo=${encodeURIComponent(memo)}`;

      setPaymentLink(url);
      setStatus('Payment link created.');
    } catch {
      setStatus('Could not create payment link.');
    }
  };

  const copyLink = async () => {
    if (!paymentLink) return;

    try {
      await navigator.clipboard.writeText(paymentLink);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setStatus('Could not copy the link.');
    }
  };

  /*
   * Load history in chunks of <= 10,000 blocks.
   * This avoids Base RPC eth_getLogs range errors.
   */
  const loadPaymentHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const latestBlock = await publicClient.getBlockNumber();

      const CHUNK_SIZE = 10_000n;
      const SEARCH_BLOCKS = 3_000_000n;

      const startBlock =
        latestBlock > SEARCH_BLOCKS
          ? latestBlock - SEARCH_BLOCKS
          : 0n;

      const allLogs: Awaited<
        ReturnType<typeof publicClient.getLogs<typeof paymentEvent>>
      > = [];

      let fromBlock = startBlock;

      while (fromBlock <= latestBlock) {
        const toBlock =
          fromBlock + CHUNK_SIZE - 1n > latestBlock
            ? latestBlock
            : fromBlock + CHUNK_SIZE - 1n;

        const logs = await publicClient.getLogs({
          address: PAYMENT_CONTRACT,
          event: paymentEvent,
          fromBlock,
          toBlock,
        });

        allLogs.push(...logs);

        fromBlock = toBlock + 1n;
      }

      const items: PaymentItem[] = [];

      for (const log of allLogs) {
        const payer = log.args.payer;
        const recipient = log.args.recipient;
        const amount = log.args.amount;
        const linkId = log.args.linkId;
        const memo = log.args.memo;

        if (
          !payer ||
          !recipient ||
          amount === undefined ||
          !linkId ||
          !log.transactionHash
        ) {
          continue;
        }

        items.push({
          linkId,
          payer,
          recipient,
          amount,
          memo: memo || '',
          txHash: log.transactionHash,
          blockNumber: log.blockNumber || 0n,
        });
      }

      items.sort((a, b) => {
        if (a.blockNumber > b.blockNumber) return -1;
        if (a.blockNumber < b.blockNumber) return 1;
        return 0;
      });

      setPayments(items);
    } catch (error) {
      console.error('Payment history error:', error);

      setHistoryError(
        error instanceof Error
          ? error.message
          : 'Could not load payment history.'
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadPaymentHistory();
  }, []);

  const pay = async () => {
    if (!window.ethereum) {
      setStatus('Please install a browser wallet.');
      return;
    }

    if (!address) {
      setStatus('Connect your wallet first.');
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setStatus('Invalid recipient address.');
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setStatus('Enter a valid amount.');
      return;
    }

    try {
      setPaymentSuccess(false);
      setTx('');

      const wallet = createWalletClient({
        chain: base,
        transport: custom(window.ethereum),
      });

      const value = parseUnits(amount, 6);

      const linkId = makeLinkId(
        recipient,
        amount,
        memo
      );

      setStatus(
        'Step 1/2: Approve USDC in your wallet...'
      );

      const approveHash = await wallet.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PAYMENT_CONTRACT, value],
        account: address,
      });

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });

      setStatus(
        'Step 2/2: Confirm the payment in your wallet...'
      );

      const hash = await wallet.writeContract({
        address: PAYMENT_CONTRACT,
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

      await publicClient.waitForTransactionReceipt({
        hash,
      });

      setTx(hash);
      setPaymentSuccess(true);
      setStatus('');

      setTimeout(() => {
        loadPaymentHistory();
      }, 3000);
    } catch (error) {
      setPaymentSuccess(false);

      setStatus(
        error instanceof Error
          ? error.message
          : 'Payment failed.'
      );
    }
  };

  const resetPayment = () => {
    setPaymentSuccess(false);
    setTx('');
    setStatus('');
  };

  const totalVolume = useMemo(() => {
    return payments.reduce(
      (total, payment) => total + payment.amount,
      0n
    );
  }, [payments]);

  const myPayments = useMemo(() => {
    if (!address) return [];

    return payments.filter(
      (payment) =>
        payment.payer.toLowerCase() ===
        address.toLowerCase()
    );
  }, [payments, address]);

  /*
   * Payment request page
   */
  if (isPaymentPage) {
    return (
      <main className="app-shell">
        <div className="top-badge">BASE MAINNET</div>

        <header className="hero">
          <h1>BasePayLink</h1>
          <p>Simple USDC payments powered by Base.</p>
        </header>

        <section className="card payment-request">
          <div className="section-title">
            <div>
              <span className="eyebrow">PAYMENT REQUEST</span>
              <h2>Pay Request</h2>
            </div>
          </div>

          <div className="request-grid">
            <div className="request-item">
              <span>Amount</span>
              <strong>{amount} USDC</strong>
            </div>

            <div className="request-item">
              <span>Recipient</span>
              <strong>{shortAddress(recipient)}</strong>
            </div>

            <div className="request-item full">
              <span>Memo</span>
              <strong>{memo}</strong>
            </div>
          </div>

          {!address && (
            <button className="primary-btn" onClick={connect}>
              Connect Wallet
            </button>
          )}

          {address && !paymentSuccess && (
            <button className="primary-btn" onClick={pay}>
              Pay {amount} USDC
            </button>
          )}

          {status && <div className="notice">{status}</div>}

          {paymentSuccess && tx && (
            <div className="success-box">
              <div className="success-icon">✓</div>

              <h3>Payment Successful</h3>

              <p>
                {amount} USDC paid successfully.
              </p>

              <p>
                Recipient: {shortAddress(recipient)}
              </p>

              <a
                href={`https://basescan.org/tx/${tx}`}
                target="_blank"
                rel="noreferrer"
                className="tx-link"
              >
                View Transaction on BaseScan →
              </a>

              <button
                className="secondary-btn"
                onClick={resetPayment}
              >
                New Payment
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="top-badge">BASE MAINNET</div>

      <header className="hero">
        <h1>BasePayLink</h1>
        <p>Simple USDC payments powered by Base.</p>
      </header>

      {/* WALLET */}
      <section className="card">
        <div className="section-title">
          <div>
            <span className="step">01</span>
            <div>
              <span className="eyebrow">WALLET</span>
              <h2>Connect Wallet</h2>
            </div>
          </div>

          <button className="primary-btn compact" onClick={connect}>
            {address
              ? shortAddress(address)
              : 'Connect Wallet'}
          </button>
        </div>

        {address && (
          <div className="connected">
            <span className="dot" />
            Connected to Base Mainnet
          </div>
        )}

        {status && !paymentLink && (
          <div className="notice">{status}</div>
        )}
      </section>

      {/* CREATE PAYMENT LINK */}
      <section className="card">
        <div className="section-title">
          <div>
            <span className="step">02</span>
            <div>
              <span className="eyebrow">
                PAYMENT LINK
              </span>
              <h2>Create Payment Link</h2>
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Recipient</label>
            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) =>
                setRecipient(event.target.value)
              }
            />
          </div>

          <div className="field">
            <label>Amount (USDC)</label>
            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value)
              }
            />
          </div>

          <div className="field full">
            <label>Memo</label>
            <input
              value={memo}
              onChange={(event) =>
                setMemo(event.target.value)
              }
            />
          </div>
        </div>

        <button
          className="primary-btn"
          onClick={createPaymentLink}
        >
          Create Payment Link
        </button>

        {paymentLink && (
          <div className="link-result">
            <div className="link-header">
              <div>
                <span className="eyebrow">
                  PAYMENT LINK READY
                </span>
                <h3>Share this payment request</h3>
              </div>

              <span className="ready-badge">
                READY
              </span>
            </div>

            <input
              className="link-input"
              readOnly
              value={paymentLink}
              onFocus={(event) =>
                event.currentTarget.select()
              }
            />

            <div className="link-actions">
              <button
                className="secondary-btn"
                onClick={copyLink}
              >
                {copied ? '✓ Copied' : 'Copy Link'}
              </button>

              <button
                className="secondary-btn"
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: 'BasePayLink Payment',
                      text: `Pay ${amount} USDC`,
                      url: paymentLink,
                    });
                  } else {
                    copyLink();
                  }
                }}
              >
                Share
              </button>
            </div>

            <div className="qr-box">
              <QRCodeSVG
                value={paymentLink}
                size={200}
                level="M"
              />
              <p>Scan to open payment request</p>
            </div>
          </div>
        )}

        {status && paymentLink && (
          <div className="notice">{status}</div>
        )}
      </section>

      {/* DIRECT PAYMENT */}
      <section className="card">
        <div className="section-title">
          <div>
            <span className="step">03</span>
            <div>
              <span className="eyebrow">
                USDC PAYMENT
              </span>
              <h2>Pay USDC</h2>
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Recipient</label>
            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) =>
                setRecipient(event.target.value)
              }
            />
          </div>

          <div className="field">
            <label>Amount (USDC)</label>
            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value)
              }
            />
          </div>

          <div className="field full">
            <label>Memo</label>
            <input
              value={memo}
              onChange={(event) =>
                setMemo(event.target.value)
              }
            />
          </div>
        </div>

        <button
          className="primary-btn"
          disabled={!address}
          onClick={pay}
        >
          {address
            ? `Pay ${amount} USDC`
            : 'Connect Wallet First'}
        </button>

        {status && !paymentLink && (
          <div className="notice">{status}</div>
        )}

        {paymentSuccess && tx && (
          <div className="success-box">
            <div className="success-icon">✓</div>

            <h3>Payment Successful</h3>

            <p>
              {amount} USDC paid successfully.
            </p>

            <a
              href={`https://basescan.org/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
              className="tx-link"
            >
              View Transaction on BaseScan →
            </a>

            <button
              className="secondary-btn"
              onClick={resetPayment}
            >
              Create New Payment
            </button>
          </div>
        )}
      </section>

      {/* PAYMENT HISTORY */}
      <section className="card history-card">
        <div className="section-title">
          <div>
            <span className="step">04</span>
            <div>
              <span className="eyebrow">
                ACTIVITY
              </span>
              <h2>Payment History</h2>
            </div>
          </div>

          <button
            className="secondary-btn compact"
            onClick={loadPaymentHistory}
            disabled={historyLoading}
          >
            {historyLoading
              ? 'Loading...'
              : 'Refresh History'}
          </button>
        </div>

        {historyError && (
          <div className="error-box">
            <strong>
              Could not load payment history.
            </strong>

            <p>{historyError}</p>

            <button
              className="secondary-btn"
              onClick={loadPaymentHistory}
            >
              Try Again
            </button>
          </div>
        )}

        {!historyError && historyLoading && (
          <div className="empty-state">
            Loading payment history...
          </div>
        )}

        {!historyError &&
          !historyLoading && (
            <>
              <div className="stats-grid">
                <div className="stat">
                  <span>Payments</span>
                  <strong>{payments.length}</strong>
                </div>

                <div className="stat">
                  <span>Total Volume</span>
                  <strong>
                    {formatUnits(
                      totalVolume,
                      6
                    )}{' '}
                    USDC
                  </strong>
                </div>

                <div className="stat">
                  <span>My Payments</span>
                  <strong>
                    {myPayments.length}
                  </strong>
                </div>
              </div>

              {payments.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">↔</div>
                  <h3>No payments yet</h3>
                  <p>
                    Payments made through the
                    BasePayLink contract will
                    appear here.
                  </p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="payment-table">
                    <thead>
                      <tr>
                        <th>Amount</th>
                        <th>Payer</th>
                        <th>Recipient</th>
                        <th>Memo</th>
                        <th>Transaction</th>
                      </tr>
                    </thead>

                    <tbody>
                      {payments.map(
                        (payment, index) => (
                          <tr
                            key={`${payment.txHash}-${index}`}
                          >
                            <td>
                              <strong>
                                {formatUnits(
                                  payment.amount,
                                  6
                                )}{' '}
                                USDC
                              </strong>
                            </td>

                            <td>
                              {shortAddress(
                                payment.payer
                              )}
                            </td>

                            <td>
                              {shortAddress(
                                payment.recipient
                              )}
                            </td>

                            <td>
                              {payment.memo || '—'}
                            </td>

                            <td>
                              <a
                                href={`https://basescan.org/tx/${payment.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="tx-link"
                              >
                                View →
                              </a>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </section>

      <footer>
        <span>BasePayLink</span>
        <span>USDC • Base Mainnet</span>
      </footer>
    </main>
  );
}