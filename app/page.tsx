'use client';

import { useEffect, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  type Address,
  keccak256,
  stringToBytes,
} from 'viem';
import { base } from 'viem/chains';
import { QRCodeSVG } from 'qrcode.react';

const USDC =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

const PAYMENT_CONTRACT =
  '0x0650a97C4d0a130E8aEa7852fA780B97fED5888C' as Address;

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
  {
    type: 'event',
    name: 'Payment',
    anonymous: false,
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
    stringToBytes(
      `${recipient.toLowerCase()}-${amount}-${memo}`
    )
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdc(amount: bigint) {
  return (Number(amount) / 1_000_000).toFixed(2);
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

type PaymentRecord = {
  linkId: string;
  payer: string;
  recipient: string;
  amount: bigint;
  memo: string;
  txHash: string;
  blockNumber: bigint;
};

export default function Home() {
  const [address, setAddress] = useState<Address>();

  const [amount, setAmount] = useState('1');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState(
    'BasePayLink payment'
  );

  const [status, setStatus] = useState('');
  const [tx, setTx] = useState('');
  const [paymentLink, setPaymentLink] =
    useState('');

  const [paymentSuccess, setPaymentSuccess] =
    useState(false);

  const [isPaymentPage, setIsPaymentPage] =
    useState(false);

  const [copied, setCopied] = useState(false);

  const [payments, setPayments] = useState<
    PaymentRecord[]
  >([]);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyError, setHistoryError] =
    useState('');

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

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

  /*
   * Load Payment History
   */
  const loadPaymentHistory = async () => {
    try {
      setHistoryLoading(true);
      setHistoryError('');

      const logs =
        await publicClient.getLogs({
          address: PAYMENT_CONTRACT,
          event: paymentAbi[1],
          fromBlock: 0n,
          toBlock: 'latest',
        });

      const history: PaymentRecord[] =
        logs
          .map((log) => ({
            linkId: log.args.linkId ?? '',
            payer: log.args.payer ?? '',
            recipient:
              log.args.recipient ?? '',
            amount: log.args.amount ?? 0n,
            memo: log.args.memo ?? '',
            txHash: log.transactionHash,
            blockNumber:
              log.blockNumber ?? 0n,
          }))
          .filter(
            (payment) =>
              payment.linkId &&
              payment.payer &&
              payment.recipient
          )
          .reverse();

      setPayments(history);
    } catch (error) {
      console.error(error);

      setHistoryError(
        'Could not load payment history.'
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadPaymentHistory();
  }, []);

  const connect = async () => {
    if (!window.ethereum) {
      setStatus(
        'No browser wallet found. Install MetaMask or use a compatible wallet.'
      );
      return;
    }

    try {
      await window.ethereum.request({
        method:
          'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }],
      });

      const accounts =
        (await window.ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[];

      if (!accounts[0]) {
        setStatus(
          'No wallet account found.'
        );
        return;
      }

      setAddress(accounts[0] as Address);

      setStatus(
        'Wallet connected to Base Mainnet.'
      );
    } catch (e) {
      setStatus(
        e instanceof Error
          ? e.message
          : 'Wallet connection failed.'
      );
    }
  };

  const createPaymentLink = () => {
    if (
      !/^0x[a-fA-F0-9]{40}$/.test(
        recipient
      )
    ) {
      setStatus(
        'Enter a valid recipient address.'
      );
      return;
    }

    const numericAmount =
      Number(amount);

    if (
      !Number.isFinite(
        numericAmount
      ) ||
      numericAmount <= 0
    ) {
      setStatus(
        'Enter a valid amount.'
      );
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
        `&recipient=${encodeURIComponent(
          recipient
        )}` +
        `&amount=${encodeURIComponent(
          amount
        )}` +
        `&memo=${encodeURIComponent(
          memo
        )}`;

      setPaymentLink(url);
      setCopied(false);

      setStatus(
        'Payment link created.'
      );
    } catch {
      setStatus(
        'Could not create payment link.'
      );
    }
  };

  const copyLink = async () => {
    if (!paymentLink) return;

    try {
      await navigator.clipboard.writeText(
        paymentLink
      );

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setStatus(
        'Could not copy the link.'
      );
    }
  };

  const shareLink = async () => {
    if (!paymentLink) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title:
            'BasePayLink Payment',
          text: `Pay ${amount} USDC on Base`,
          url: paymentLink,
        });
      } else {
        await navigator.clipboard.writeText(
          paymentLink
        );

        setCopied(true);

        setTimeout(() => {
          setCopied(false);
        }, 2000);
      }
    } catch {
      // User cancelled sharing.
    }
  };

  const pay = async () => {
    const contract =
      process.env
        .NEXT_PUBLIC_PAYMENT_CONTRACT as
        | Address
        | undefined;

    const paymentContract =
      contract ||
      PAYMENT_CONTRACT;

    if (!window.ethereum) {
      setStatus(
        'Please install a browser wallet.'
      );
      return;
    }

    if (!address) {
      setStatus(
        'Connect your wallet first.'
      );
      return;
    }

    if (
      !/^0x[a-fA-F0-9]{40}$/.test(
        recipient
      )
    ) {
      setStatus(
        'Invalid recipient address.'
      );
      return;
    }

    const numericAmount =
      Number(amount);

    if (
      !Number.isFinite(
        numericAmount
      ) ||
      numericAmount <= 0
    ) {
      setStatus(
        'Enter a valid amount.'
      );
      return;
    }

    try {
      setPaymentSuccess(false);
      setTx('');

      const wallet =
        createWalletClient({
          chain: base,
          transport:
            custom(
              window.ethereum
            ),
        });

      const value =
        parseUnits(amount, 6);

      const linkId =
        makeLinkId(
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
        args: [
          paymentContract,
          value,
        ],
        account: address,
      });

      setStatus(
        'Step 2/2: Confirm the payment in your wallet...'
      );

      const hash =
        await wallet.writeContract({
          address:
            paymentContract,
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

      /*
       * Refresh history after payment
       */
      setTimeout(() => {
        loadPaymentHistory();
      }, 3000);
    } catch (e) {
      setPaymentSuccess(false);

      setStatus(
        e instanceof Error
          ? e.message
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
    (total, payment) =>
      total + payment.amount,
    0n
  );

  const myPayments = address
    ? payments.filter(
        (payment) =>
          payment.payer.toLowerCase() ===
          address.toLowerCase() ||
          payment.recipient.toLowerCase() ===
          address.toLowerCase()
      )
    : [];

  return (
    <main className="container">
      <div className="badge">
        BASE MAINNET
      </div>

      <h1>BasePayLink</h1>

      <p className="subtitle">
        Simple USDC payments powered by Base.
      </p>

      {isPaymentPage ? (
        <section className="card payment-card">
          <h2>Pay Request</h2>

          <div className="payment-summary">
            <div>
              <span>Amount</span>
              <strong>
                {amount} USDC
              </strong>
            </div>

            <div>
              <span>Recipient</span>
              <strong>
                {shortenAddress(
                  recipient
                )}
              </strong>
            </div>

            <div>
              <span>Memo</span>
              <strong>
                {memo}
              </strong>
            </div>
          </div>

          {!address && (
            <button onClick={connect}>
              Connect Wallet
            </button>
          )}

          {address &&
            !paymentSuccess && (
              <button onClick={pay}>
                Pay {amount} USDC
              </button>
            )}

          {status && (
            <p className="status">
              {status}
            </p>
          )}

          {paymentSuccess && tx && (
            <div className="success">
              <h3>
                ✓ Payment Successful
              </h3>

              <p>
                <strong>
                  {amount} USDC
                </strong>{' '}
                paid successfully.
              </p>

              <p>
                Recipient:{' '}
                {shortenAddress(
                  recipient
                )}
              </p>

              <a
                href={`https://basescan.org/tx/${tx}`}
                target="_blank"
                rel="noreferrer"
              >
                View Transaction on BaseScan →
              </a>

              <button
                onClick={
                  resetPayment
                }
              >
                New Payment
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="card">
            <button onClick={connect}>
              {address
                ? shortenAddress(
                    address
                  )
                : 'Connect Wallet'}
            </button>

            {address && (
              <p className="status">
                Connected to Base Mainnet
              </p>
            )}
          </section>

          <section className="card">
            <h2>
              Create Payment Link
            </h2>

            <label>
              Recipient
            </label>

            <input
              placeholder="0x..."
              value={recipient}
              onChange={(e) =>
                setRecipient(
                  e.target.value
                )
              }
            />

            <label>
              Amount (USDC)
            </label>

            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) =>
                setAmount(
                  e.target.value
                )
              }
            />

            <label>
              Memo
            </label>

            <input
              value={memo}
              onChange={(e) =>
                setMemo(
                  e.target.value
                )
              }
            />

            <button
              onClick={
                createPaymentLink
              }
            >
              Create Payment Link
            </button>

            {paymentLink && (
              <div className="status">
                <p>
                  Payment link created:
                </p>

                <input
                  readOnly
                  value={
                    paymentLink
                  }
                  onFocus={(e) =>
                    e.currentTarget.select()
                  }
                />

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap:
                      'wrap',
                    marginTop:
                      '10px',
                  }}
                >
                  <button
                    onClick={
                      copyLink
                    }
                  >
                    {copied
                      ? '✓ Copied'
                      : 'Copy Link'}
                  </button>

                  <button
                    onClick={
                      shareLink
                    }
                  >
                    Share
                  </button>
                </div>

                <div
                  style={{
                    marginTop:
                      '20px',
                    textAlign:
                      'center',
                  }}
                >
                  <p>
                    <strong>
                      Scan to Pay
                    </strong>
                  </p>

                  <div
                    style={{
                      display:
                        'inline-block',
                      background:
                        '#ffffff',
                      padding:
                        '16px',
                      borderRadius:
                        '12px',
                    }}
                  >
                    <QRCodeSVG
                      value={
                        paymentLink
                      }
                      size={220}
                      level="M"
                    />
                  </div>

                  <p
                    style={{
                      marginTop:
                        '10px',
                    }}
                  >
                    Scan this QR code
                    to open the
                    payment request.
                  </p>
                </div>
              </div>
            )}

            {status && (
              <p className="status">
                {status}
              </p>
            )}
          </section>

          <section className="card">
            <h2>
              Pay USDC
            </h2>

            <label>
              Recipient
            </label>

            <input
              placeholder="0x..."
              value={recipient}
              onChange={(e) =>
                setRecipient(
                  e.target.value
                )
              }
            />

            <label>
              Amount (USDC)
            </label>

            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) =>
                setAmount(
                  e.target.value
                )
              }
            />

            <label>
              Memo
            </label>

            <input
              value={memo}
              onChange={(e) =>
                setMemo(
                  e.target.value
                )
              }
            />

            <button
              disabled={!address}
              onClick={pay}
            >
              Pay USDC
            </button>

            {status && (
              <p className="status">
                {status}
              </p>
            )}

            {paymentSuccess &&
              tx && (
                <div className="success">
                  <h3>
                    ✓ Payment Successful
                  </h3>

                  <p>
                    <strong>
                      {amount} USDC
                    </strong>{' '}
                    paid successfully.
                  </p>

                  <p>
                    Recipient:{' '}
                    {shortenAddress(
                      recipient
                    )}
                  </p>

                  <a
                    href={`https://basescan.org/tx/${tx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Transaction on BaseScan →
                  </a>

                  <button
                    onClick={
                      resetPayment
                    }
                  >
                    Create New Payment
                  </button>
                </div>
              )}
          </section>

          {/* PAYMENT HISTORY */}
          <section className="card">
            <h2>
              Payment History
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '12px',
                marginBottom: '20px',
              }}
            >
              <div
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  border:
                    '1px solid #ddd',
                }}
              >
                <span>
                  Payments
                </span>

                <h3>
                  {payments.length}
                </h3>
              </div>

              <div
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  border:
                    '1px solid #ddd',
                }}
              >
                <span>
                  Total Volume
                </span>

                <h3>
                  {formatUsdc(
                    totalVolume
                  )}{' '}
                  USDC
                </h3>
              </div>

              <div
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  border:
                    '1px solid #ddd',
                }}
              >
                <span>
                  My Payments
                </span>

                <h3>
                  {myPayments.length}
                </h3>
              </div>
            </div>

            <button
              onClick={
                loadPaymentHistory
              }
              disabled={
                historyLoading
              }
            >
              {historyLoading
                ? 'Loading...'
                : 'Refresh History'}
            </button>

            {historyError && (
              <p className="status">
                {historyError}
              </p>
            )}

            {!historyLoading &&
              payments.length === 0 &&
              !historyError && (
                <p className="status">
                  No payments found yet.
                </p>
              )}

            {payments.length > 0 && (
              <div
                style={{
                  marginTop: '20px',
                  overflowX: 'auto',
                }}
              >
                {payments.map(
                  (
                    payment,
                    index
                  ) => (
                    <div
                      key={`${payment.txHash}-${index}`}
                      style={{
                        border:
                          '1px solid #ddd',
                        borderRadius:
                          '12px',
                        padding:
                          '16px',
                        marginBottom:
                          '12px',
                      }}
                    >
                      <div
                        style={{
                          display:
                            'flex',
                          justifyContent:
                            'space-between',
                          gap: '12px',
                          flexWrap:
                            'wrap',
                        }}
                      >
                        <strong>
                          {formatUsdc(
                            payment.amount
                          )}{' '}
                          USDC
                        </strong>

                        <strong>
                          {shortenAddress(
                            payment.recipient
                          )}
                        </strong>
                      </div>

                      <p>
                        <strong>
                          Payer:
                        </strong>{' '}
                        {shortenAddress(
                          payment.payer
                        )}
                      </p>

                      <p>
                        <strong>
                          Memo:
                        </strong>{' '}
                        {payment.memo ||
                          'No memo'}
                      </p>

                      <p>
                        <strong>
                          Link ID:
                        </strong>{' '}
                        {shortenAddress(
                          payment.linkId
                        )}
                      </p>

                      <a
                        href={`https://basescan.org/tx/${payment.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View Transaction →
                      </a>
                    </div>
                  )
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}