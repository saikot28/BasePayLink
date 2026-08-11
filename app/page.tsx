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

const paymentEventAbi = {
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
} as const;

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

type PaymentRecord = {
  linkId: string;
  payer: string;
  recipient: string;
  amount: bigint;
  memo: string;
  transactionHash: string;
  blockNumber: bigint;
};

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

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUSDC(amount: bigint): string {
  return (Number(amount) / 1_000_000).toFixed(2);
}

export default function Home() {
  const [address, setAddress] =
    useState<Address>();

  const [amount, setAmount] =
    useState('1');

  const [recipient, setRecipient] =
    useState('');

  const [memo, setMemo] =
    useState('BasePayLink payment');

  const [status, setStatus] =
    useState('');

  const [tx, setTx] =
    useState('');

  const [paymentLink, setPaymentLink] =
    useState('');

  const [paymentSuccess, setPaymentSuccess] =
    useState(false);

  const [isPaymentPage, setIsPaymentPage] =
    useState(false);

  const [copied, setCopied] =
    useState(false);

  const [payments, setPayments] =
    useState<PaymentRecord[]>([]);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyError, setHistoryError] =
    useState('');

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

      const accounts =
        (await window.ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[];

      if (!accounts[0]) {
        setStatus('No wallet account found.');
        return;
      }

      setAddress(accounts[0] as Address);
      setStatus('Wallet connected to Base Mainnet.');
    } catch (e) {
      setStatus(
        e instanceof Error
          ? e.message
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

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
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
    if (!paymentLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        paymentLink
      );

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setStatus('Could not copy the link.');
    }
  };

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

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
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
        args: [
          PAYMENT_CONTRACT,
          value,
        ],
        account: address,
      });

      setStatus(
        'Step 2/2: Confirm the payment in your wallet...'
      );

      const hash =
        await wallet.writeContract({
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
      }, 4000);
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

  const loadPaymentHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const latestBlock =
        await publicClient.getBlockNumber();

      const deploymentBlock = 0n;
      const batchSize = 1900n;

      const allLogs: any[] = [];

      let toBlock = latestBlock;

      while (toBlock >= deploymentBlock) {
        const fromBlock =
          toBlock - batchSize >
          deploymentBlock
            ? toBlock - batchSize
            : deploymentBlock;

        const logs =
          await publicClient.getLogs({
            address: PAYMENT_CONTRACT,
            event: paymentEventAbi,
            fromBlock,
            toBlock,
          });

        allLogs.push(...logs);

        if (fromBlock === deploymentBlock) {
          break;
        }

        toBlock = fromBlock - 1n;

        if (allLogs.length >= 100) {
          break;
        }
      }

      const records: PaymentRecord[] =
        allLogs
          .map((log: any) => {
            const args = log.args;

            if (
              !args ||
              !args.linkId ||
              !args.payer ||
              !args.recipient
            ) {
              return null;
            }

            return {
              linkId: args.linkId,
              payer: args.payer,
              recipient: args.recipient,
              amount: args.amount,
              memo: args.memo || '',
              transactionHash:
                log.transactionHash,
              blockNumber:
                log.blockNumber,
            };
          })
          .filter(
            (
              item: PaymentRecord | null
            ): item is PaymentRecord =>
              item !== null
          );

      records.sort((a, b) => {
        if (a.blockNumber === b.blockNumber) {
          return 0;
        }

        return a.blockNumber > b.blockNumber
          ? -1
          : 1;
      });

      setPayments(records.slice(0, 50));
    } catch (e) {
      console.error(
        'Payment history error:',
        e
      );

      setHistoryError(
        'Could not load payment history.'
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const payParam =
      params.get('pay');

    const r =
      params.get('recipient');

    const a =
      params.get('amount');

    const m =
      params.get('memo');

    if (r) {
      setRecipient(r);
    }

    if (a) {
      setAmount(a);
    }

    if (m) {
      setMemo(m);
    }

    if (
      payParam &&
      r &&
      a
    ) {
      setIsPaymentPage(true);
    }

    loadPaymentHistory();
  }, []);

  const totalVolume =
    payments.reduce(
      (
        total,
        payment
      ) => total + payment.amount,
      0n
    );

  const myPayments =
    address
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

      <h1>
        BasePayLink
      </h1>

      <p className="subtitle">
        Simple USDC payments powered by Base.
      </p>

      {isPaymentPage ? (

        <section className="card payment-card">

          <h2>
            Pay Request
          </h2>

          <div className="payment-summary">

            <div>
              <span>
                Amount
              </span>

              <strong>
                {amount} USDC
              </strong>
            </div>

            <div>
              <span>
                Recipient
              </span>

              <strong>
                {shortenAddress(
                  recipient
                )}
              </strong>
            </div>

            <div>
              <span>
                Memo
              </span>

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
                  href={
                    `https://basescan.org/tx/${tx}`
                  }
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

                <button
                  onClick={
                    copyLink
                  }
                >
                  {copied
                    ? '✓ Copied'
                    : 'Copy Link'}
                </button>


                <div
                  style={{
                    marginTop: '20px',
                    textAlign: 'center',
                  }}
                >

                  <QRCodeSVG
                    value={
                      paymentLink
                    }
                    size={220}
                    level="H"
                  />

                  <p>
                    <strong>
                      Scan to Pay
                    </strong>
                  </p>

                  <small>
                    Scan this QR code
                    to open the payment
                    request.
                  </small>

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
                    href={
                      `https://basescan.org/tx/${tx}`
                    }
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


          <section className="card">

            <h2>
              Payment History
            </h2>

            <div
              className="history-stats"
            >

              <div>
                <h3>
                  {payments.length}
                </h3>

                <span>
                  Payments
                </span>
              </div>

              <div>
                <h3>
                  {formatUSDC(
                    totalVolume
                  )}{' '}
                  USDC
                </h3>

                <span>
                  Total Volume
                </span>
              </div>

              <div>
                <h3>
                  {myPayments.length}
                </h3>

                <span>
                  My Payments
                </span>
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
              !historyError &&
              payments.length === 0 && (
                <p className="status">
                  No payments found yet.
                </p>
              )}


            {payments.length > 0 && (

              <div
                style={{
                  marginTop: '20px',
                }}
              >

                {payments.map(
                  (
                    payment,
                    index
                  ) => (

                    <div
                      key={
                        `${payment.transactionHash}-${index}`
                      }
                      style={{
                        border:
                          '1px solid rgba(255,255,255,0.12)',
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
                          gap:
                            '12px',
                          flexWrap:
                            'wrap',
                        }}
                      >

                        <strong>
                          {formatUSDC(
                            payment.amount
                          )}{' '}
                          USDC
                        </strong>

                        <span>
                          {payment.memo}
                        </span>

                      </div>

                      <p>
                        <strong>
                          From:
                        </strong>{' '}
                        {shortenAddress(
                          payment.payer
                        )}
                      </p>

                      <p>
                        <strong>
                          To:
                        </strong>{' '}
                        {shortenAddress(
                          payment.recipient
                        )}
                      </p>

                      <a
                        href={
                          `https://basescan.org/tx/${payment.transactionHash}`
                        }
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