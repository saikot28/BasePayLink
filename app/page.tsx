'use client';

import { useEffect, useState } from 'react';
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
} from 'viem';
import type { Address, Hex } from 'viem';
import { base } from 'viem/chains';
import { QRCodeSVG } from 'qrcode.react';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

const PAYMENT_CONTRACT = (
  process.env.NEXT_PUBLIC_PAYMENT_CONTRACT ||
  '0x0650a97C4d0a130E8aEa7852fA780B97fED5888C'
) as Address;

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
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

const paymentEventAbi = [paymentEvent] as const;

type PaymentItem = {
  linkId: Hex;
  payer: Address;
  recipient: Address;
  amount: bigint;
  memo: string;
  txHash: Hex;
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
): Hex {
  return keccak256(
    stringToBytes(
      `${recipient.toLowerCase()}-${amount}-${memo}`
    )
  );
}

function shortAddress(address: string): string {
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
  const [historyLoaded, setHistoryLoaded] = useState(false);

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
      const linkId = makeLinkId(
        recipient,
        amount,
        memo
      );

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

  const loadPaymentHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const latestBlock = await publicClient.getBlockNumber();

      /*
       * Base RPC eth_getLogs allows a maximum 10,000 block range.
       * We therefore split the search into chunks.
       */
      const CHUNK_SIZE = 9_000n;
      const SEARCH_BLOCKS = 300_000n;

      const startBlock =
        latestBlock > SEARCH_BLOCKS
          ? latestBlock - SEARCH_BLOCKS
          : 0n;

      const allLogs: any[] = [];

      let fromBlock = startBlock;

      while (fromBlock <= latestBlock) {
        const toBlock =
          fromBlock + CHUNK_SIZE > latestBlock
            ? latestBlock
            : fromBlock + CHUNK_SIZE;

        const logs = await publicClient.getLogs({
          address: PAYMENT_CONTRACT,
          events: paymentEventAbi,
          fromBlock,
          toBlock,
        });

        allLogs.push(...logs);

        if (toBlock >= latestBlock) {
          break;
        }

        fromBlock = toBlock + 1n;
      }

      const items: PaymentItem[] = [];

      for (const log of allLogs) {
        /*
         * Viem's inferred log type can vary depending on ABI inference.
         * We safely read args through a local cast.
         */
        const args = (log as any).args;

        if (!args) {
          continue;
        }

        const payer = args.payer as Address | undefined;
        const logRecipient =
          args.recipient as Address | undefined;
        const logAmount =
          args.amount as bigint | undefined;
        const linkId = args.linkId as Hex | undefined;
        const logMemo = args.memo as string | undefined;

        if (
          !payer ||
          !logRecipient ||
          logAmount === undefined ||
          !linkId ||
          !log.transactionHash
        ) {
          continue;
        }

        items.push({
          linkId,
          payer,
          recipient: logRecipient,
          amount: logAmount,
          memo: logMemo || '',
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
      setHistoryLoaded(true);
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

      await wallet.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PAYMENT_CONTRACT, value],
        account: address,
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

      setTx(hash);
      setPaymentSuccess(true);
      setStatus('');

      setTimeout(() => {
        loadPaymentHistory();
      }, 5000);
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

  const totalVolume = payments.reduce(
    (total, payment) => total + payment.amount,
    0n
  );

  const myPayments = address
    ? payments.filter(
        (payment) =>
          payment.payer.toLowerCase() ===
          address.toLowerCase()
      )
    : [];

  return (
    <main className="container">
      <div className="badge">BASE MAINNET</div>

      <h1>BasePayLink</h1>

      <p className="subtitle">
        Simple USDC payments powered by Base.
      </p>

      {isPaymentPage ? (
        <section className="card payment-card">
          <div className="section-number">PAY REQUEST</div>

          <h2>Pay Request</h2>

          <div className="payment-summary">
            <div>
              <span>Amount</span>
              <strong>{amount} USDC</strong>
            </div>

            <div>
              <span>Recipient</span>
              <strong>{shortAddress(recipient)}</strong>
            </div>

            <div>
              <span>Memo</span>
              <strong>{memo}</strong>
            </div>
          </div>

          {!address && (
            <button onClick={connect}>
              Connect Wallet
            </button>
          )}

          {address && !paymentSuccess && (
            <button onClick={pay}>
              Pay {amount} USDC
            </button>
          )}

          {status && (
            <p className="status">{status}</p>
          )}

          {paymentSuccess && tx && (
            <div className="success">
              <h3>✓ Payment Successful</h3>

              <p>
                <strong>{amount} USDC</strong>{' '}
                paid successfully.
              </p>

              <p>
                Recipient: {shortAddress(recipient)}
              </p>

              <a
                href={`https://basescan.org/tx/${tx}`}
                target="_blank"
                rel="noreferrer"
              >
                View Transaction on BaseScan →
              </a>

              <button onClick={resetPayment}>
                New Payment
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          {/* WALLET */}
          <section className="card">
            <div className="section-number">01</div>
            <div className="section-label">WALLET</div>

            <h2>Connect Wallet</h2>

            <button onClick={connect}>
              {address
                ? shortAddress(address)
                : 'Connect Wallet'}
            </button>

            {address && (
              <p className="status">
                Connected to Base Mainnet
              </p>
            )}
          </section>

          {/* CREATE PAYMENT LINK */}
          <section className="card">
            <div className="section-number">02</div>
            <div className="section-label">
              PAYMENT LINK
            </div>

            <h2>Create Payment Link</h2>

            <label>Recipient</label>

            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) =>
                setRecipient(event.target.value)
              }
            />

            <label>Amount (USDC)</label>

            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value)
              }
            />

            <label>Memo</label>

            <input
              value={memo}
              onChange={(event) =>
                setMemo(event.target.value)
              }
            />

            <button onClick={createPaymentLink}>
              Create Payment Link
            </button>

            {paymentLink && (
              <div className="link-result">
                <p className="result-title">
                  Payment link created
                </p>

                <input
                  readOnly
                  value={paymentLink}
                  onFocus={(event) =>
                    event.currentTarget.select()
                  }
                />

                <div className="button-row">
                  <button onClick={copyLink}>
                    {copied ? '✓ Copied' : 'Copy Link'}
                  </button>

                  <button
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({
                          title:
                            'BasePayLink Payment',
                          text:
                            `Pay ${amount} USDC`,
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
                  <strong>Scan to Pay</strong>

                  <p>
                    Scan this QR code to open the
                    payment request.
                  </p>

                  <QRCodeSVG
                    value={paymentLink}
                    size={220}
                    level="M"
                  />
                </div>
              </div>
            )}

            {status && (
              <p className="status">{status}</p>
            )}
          </section>

          {/* DIRECT PAYMENT */}
          <section className="card">
            <div className="section-number">03</div>
            <div className="section-label">
              USDC PAYMENT
            </div>

            <h2>Pay USDC</h2>

            <label>Recipient</label>

            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) =>
                setRecipient(event.target.value)
              }
            />

            <label>Amount (USDC)</label>

            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value)
              }
            />

            <label>Memo</label>

            <input
              value={memo}
              onChange={(event) =>
                setMemo(event.target.value)
              }
            />

            <button
              disabled={!address}
              onClick={pay}
            >
              {address
                ? 'Pay USDC'
                : 'Connect Wallet First'}
            </button>

            {status && (
              <p className="status">{status}</p>
            )}

            {paymentSuccess && tx && (
              <div className="success">
                <h3>✓ Payment Successful</h3>

                <p>
                  <strong>{amount} USDC</strong>{' '}
                  paid successfully.
                </p>

                <p>
                  Recipient:{' '}
                  {shortAddress(recipient)}
                </p>

                <a
                  href={`https://basescan.org/tx/${tx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Transaction on BaseScan →
                </a>

                <button onClick={resetPayment}>
                  Create New Payment
                </button>
              </div>
            )}
          </section>

          {/* PAYMENT HISTORY */}
          <section className="card history-card">
            <div className="history-header">
              <div>
                <div className="section-number">04</div>
                <div className="section-label">
                  ACTIVITY
                </div>
                <h2>Payment History</h2>
              </div>

              <button
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

                <button onClick={loadPaymentHistory}>
                  Try Again
                </button>
              </div>
            )}

            {!historyError &&
              historyLoading && (
                <div className="loading-box">
                  Loading payment history...
                </div>
              )}

            {!historyError &&
              !historyLoading &&
              historyLoaded && (
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
                    <div className="empty-box">
                      <h3>No payments yet</h3>

                      <p>
                        Payments made through this
                        BasePayLink contract will
                        appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
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
                                  >
                                    View on BaseScan →
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
        </>
      )}
    </main>
  );
}