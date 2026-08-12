'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  type Address,
  keccak256,
  stringToBytes,
  formatUnits,
  getAddress,
  decodeEventLog,
} from 'viem';
import { base } from 'viem/chains';
import { QRCodeSVG } from 'qrcode.react';
import { Attribution } from 'ox/erc8021';

/* =========================================================
   CONFIG
========================================================= */

const USDC =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

const PAYMENT_CONTRACT =
  (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT ||
    '0x0650a97C4d0a130E8aEa7852fA780B97fED5888C') as Address;

/*
 * Base Builder Code
 *
 * Your Builder Code:
 * bc_0i1qmqg3
 */
const BUILDER_CODE = 'bc_0i1qmqg3';

const DATA_SUFFIX = Attribution.toDataSuffix({
  codes: [BUILDER_CODE],
});

/*
 * For production, you can put your own RPC in .env.local:
 *
 * NEXT_PUBLIC_BASE_RPC_URL=https://your-rpc-url
 *
 * PublicNode is used as the default instead of
 * mainnet.base.org because the latter was rate-limiting
 * your eth_getLogs requests.
 */
const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  'https://base-rpc.publicnode.com';

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

/* =========================================================
   ABI
========================================================= */

const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'spender',
        type: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
      },
    ],
    outputs: [
      {
        type: 'bool',
      },
    ],
  },
] as const;

const paymentAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'linkId',
        type: 'bytes32',
      },
      {
        name: 'recipient',
        type: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
      },
      {
        name: 'memo',
        type: 'string',
      },
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

/* =========================================================
   TYPES
========================================================= */

type HexString = `0x${string}`;

type PaymentItem = {
  linkId: HexString;
  payer: Address;
  recipient: Address;
  amount: bigint;
  memo: string;
  txHash: HexString;
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

/* =========================================================
   HELPERS
========================================================= */

function makeLinkId(
  recipient: string,
  amount: string,
  memo: string
): HexString {
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

function isValidAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidAmount(amount: string) {
  try {
    const value = parseUnits(amount, 6);
    return value > 0n;
  } catch {
    return false;
  }
}

/* =========================================================
   HOME
========================================================= */

export default function Home() {
  /* -------------------------------------------------------
     Wallet
  ------------------------------------------------------- */

  const [address, setAddress] = useState<Address>();

  /* -------------------------------------------------------
     Payment form
  ------------------------------------------------------- */

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('1');
  const [memo, setMemo] = useState(
    'BasePayLink payment'
  );

  /* -------------------------------------------------------
     Status
  ------------------------------------------------------- */

  const [status, setStatus] = useState('');
  const [tx, setTx] = useState('');

  /* -------------------------------------------------------
     Payment link
  ------------------------------------------------------- */

  const [paymentLink, setPaymentLink] = useState('');
  const [copied, setCopied] = useState(false);

  /* -------------------------------------------------------
     Payment success
  ------------------------------------------------------- */

  const [paymentSuccess, setPaymentSuccess] =
    useState(false);

  /* -------------------------------------------------------
     Payment request page
  ------------------------------------------------------- */

  const [isPaymentPage, setIsPaymentPage] =
    useState(false);

  /* -------------------------------------------------------
     History
  ------------------------------------------------------- */

  const [payments, setPayments] =
    useState<PaymentItem[]>([]);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyError, setHistoryError] =
    useState('');

  const [historyLoaded, setHistoryLoaded] =
    useState(false);

  /* =======================================================
     URL PAYMENT REQUEST
  ======================================================= */

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

    const pay = params.get('pay');
    const r = params.get('recipient');
    const a = params.get('amount');
    const m = params.get('memo');

    if (r) {
      setRecipient(r);
    }

    if (a) {
      setAmount(a);
    }

    if (m) {
      setMemo(m);
    }

    if (pay && r && a) {
      setIsPaymentPage(true);
    }
  }, []);

  /* =======================================================
     CONNECT WALLET
  ======================================================= */

  const connect = async () => {
    if (!window.ethereum) {
      setStatus(
        'No browser wallet found. Install MetaMask or another compatible wallet.'
      );

      return;
    }

    try {
      /*
       * Switch to Base Mainnet
       */
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [
            {
              chainId: '0x2105',
            },
          ],
        });
      } catch (switchError) {
        console.error(
          'Network switch error:',
          switchError
        );

        /*
         * If Base is not added to wallet, try adding it.
         */
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x2105',
                chainName: 'Base',
                nativeCurrency: {
                  name: 'Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: [
                  'https://mainnet.base.org',
                ],
                blockExplorerUrls: [
                  'https://basescan.org',
                ],
              },
            ],
          });
        } catch {
          throw switchError;
        }
      }

      /*
       * Request account
       */
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

      const connected =
        getAddress(accounts[0]);

      setAddress(connected);

      setStatus(
        'Wallet connected to Base Mainnet.'
      );
    } catch (error) {
      console.error(error);

      setStatus(
        error instanceof Error
          ? error.message
          : 'Wallet connection failed.'
      );
    }
  };

  /* =======================================================
     CREATE PAYMENT LINK
  ======================================================= */

  const createPaymentLink = () => {
    setStatus('');

    if (!isValidAddress(recipient)) {
      setStatus(
        'Enter a valid recipient address.'
      );

      return;
    }

    if (!isValidAmount(amount)) {
      setStatus(
        'Enter a valid USDC amount.'
      );

      return;
    }

    try {
      const linkId = makeLinkId(
        recipient,
        amount,
        memo
      );

      const params = new URLSearchParams({
        pay: linkId,
        recipient,
        amount,
        memo,
      });

      const url =
        `${window.location.origin}/?${params.toString()}`;

      setPaymentLink(url);

      setStatus(
        'Payment link created successfully.'
      );
    } catch (error) {
      console.error(error);

      setStatus(
        'Could not create payment link.'
      );
    }
  };

  /* =======================================================
     COPY LINK
  ======================================================= */

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
      setStatus(
        'Could not copy the payment link.'
      );
    }
  };

  /* =======================================================
     LOAD PAYMENT HISTORY
     
     IMPORTANT:
     - Does NOT scan millions of blocks.
     - Searches only recent blocks.
     - Uses small chunks.
     - Avoids Base public RPC eth_getLogs range limits.
  ======================================================= */

  const loadPaymentHistory = async () => {
    if (historyLoading) {
      return;
    }

    setHistoryLoading(true);
    setHistoryError('');

    try {
      const latestBlock =
        await publicClient.getBlockNumber();

      /*
       * Search only recent 50,000 blocks.
       *
       * Base produces blocks very quickly, so this is
       * intentionally limited for an MVP.
       *
       * Increase this later if you need older history.
       */
      const SEARCH_BLOCKS = 50_000n;

      const CHUNK_SIZE = 5_000n;

      const earliestBlock =
        latestBlock > SEARCH_BLOCKS
          ? latestBlock - SEARCH_BLOCKS
          : 0n;

      const allLogs: any[] = [];

      /*
       * Sequential chunks.
       *
       * We intentionally DO NOT Promise.all() these
       * requests because parallel eth_getLogs calls can
       * trigger RPC rate limits.
       */
      for (
        let fromBlock = earliestBlock;
        fromBlock <= latestBlock;
        fromBlock += CHUNK_SIZE
      ) {
        const toBlock =
          fromBlock + CHUNK_SIZE - 1n >
          latestBlock
            ? latestBlock
            : fromBlock +
              CHUNK_SIZE -
              1n;

        try {
          const logs =
            await publicClient.getLogs({
              address: PAYMENT_CONTRACT,
              event: paymentEvent,
              fromBlock,
              toBlock,
            });

          allLogs.push(...logs);
        } catch (chunkError) {
          console.warn(
            'History chunk failed:',
            {
              fromBlock: fromBlock.toString(),
              toBlock: toBlock.toString(),
              error: chunkError,
            }
          );

          /*
           * Continue with the next chunk instead of
           * completely failing the history page.
           */
        }
      }

      const items: PaymentItem[] = [];

      /*
       * Decode logs manually.
       *
       * This avoids the TypeScript problem:
       *
       * Property 'args' does not exist on type 'Log'
       */
      for (const log of allLogs) {
        try {
          if (
            !log.transactionHash ||
            log.blockNumber === null
          ) {
            continue;
          }

          const decoded =
            decodeEventLog({
              abi: paymentEventAbi,
              data: log.data,
              topics: log.topics,
            });

          if (
            decoded.eventName !== 'Payment'
          ) {
            continue;
          }

          const args =
            decoded.args as {
              linkId: HexString;
              payer: Address;
              recipient: Address;
              amount: bigint;
              memo: string;
            };

          if (
            !args.linkId ||
            !args.payer ||
            !args.recipient ||
            args.amount === undefined
          ) {
            continue;
          }

          items.push({
            linkId: args.linkId,
            payer: args.payer,
            recipient: args.recipient,
            amount: args.amount,
            memo: args.memo || '',
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        } catch (decodeError) {
          console.warn(
            'Could not decode Payment event:',
            decodeError
          );
        }
      }

      /*
       * Remove duplicate transactions/logs.
       */
      const unique =
        new Map<string, PaymentItem>();

      for (const item of items) {
        unique.set(
          `${item.txHash}-${item.linkId}`,
          item
        );
      }

      const finalItems =
        Array.from(unique.values());

      /*
       * Newest first
       */
      finalItems.sort(
        (a, b) =>
          Number(
            b.blockNumber -
              a.blockNumber
          )
      );

      setPayments(finalItems);
      setHistoryLoaded(true);

      /*
       * If chunks succeeded but no payments exist,
       * that's not an error.
       */
      if (finalItems.length === 0) {
        setHistoryError('');
      }
    } catch (error) {
      console.error(
        'Payment history error:',
        error
      );

      setHistoryError(
        error instanceof Error
          ? error.message
          : 'Could not load payment history.'
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  /* =======================================================
     LOAD HISTORY ON PAGE LOAD
  ======================================================= */

  useEffect(() => {
    loadPaymentHistory();
  }, []);

  /* =======================================================
     PAY USDC
  ======================================================= */

  const pay = async () => {
    setStatus('');

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

    if (!isValidAddress(recipient)) {
      setStatus(
        'Invalid recipient address.'
      );

      return;
    }

    if (!isValidAmount(amount)) {
      setStatus(
        'Enter a valid USDC amount.'
      );

      return;
    }

    try {
      setPaymentSuccess(false);
      setTx('');

      /*
       * Make sure wallet is on Base.
       */
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [
            {
              chainId: '0x2105',
            },
          ],
        });
      } catch {
        /*
         * If switch fails, continue because some wallets
         * already report the correct network.
         */
      }

      /*
       * Wallet client with Builder Code attribution.
       *
       * DATA_SUFFIX is generated by:
       *
       * Attribution.toDataSuffix({
       *   codes: ['bc_0i1qmqg3']
       * })
       */
      const wallet =
        createWalletClient({
          account: address,
          chain: base,
          transport: custom(
            window.ethereum
          ),
          dataSuffix: DATA_SUFFIX,
        });

      /*
       * Convert USDC amount to 6 decimals.
       */
      const value = parseUnits(
        amount,
        6
      );

      /*
       * Generate payment link ID.
       */
      const linkId = makeLinkId(
        recipient,
        amount,
        memo
      );

      /*
       * Step 1
       *
       * Approve payment contract to spend USDC.
       */
      setStatus(
        'Step 1/2: Approve USDC in your wallet...'
      );

      const approvalHash =
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

      /*
       * Wait for approval confirmation.
       *
       * This is important because sending pay() immediately
       * after approval can sometimes race the RPC.
       */
      setStatus(
        'Waiting for USDC approval confirmation...'
      );

      await publicClient.waitForTransactionReceipt(
        {
          hash: approvalHash,
        }
      );

      /*
       * Step 2
       */
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
            getAddress(recipient),
            value,
            memo,
          ],
          account: address,
        });

      setTx(hash);

      setStatus(
        'Payment submitted. Waiting for confirmation...'
      );

      /*
       * Wait for payment confirmation.
       */
      await publicClient.waitForTransactionReceipt(
        {
          hash,
        }
      );

      setPaymentSuccess(true);
      setStatus(
        'Payment confirmed successfully.'
      );

      /*
       * Give RPC/indexer a little time before history
       * refresh.
       */
      setTimeout(() => {
        loadPaymentHistory();
      }, 3000);
    } catch (error) {
      console.error(
        'Payment error:',
        error
      );

      setPaymentSuccess(false);

      setStatus(
        error instanceof Error
          ? error.message
          : 'Payment failed.'
      );
    }
  };

  /* =======================================================
     RESET PAYMENT
  ======================================================= */

  const resetPayment = () => {
    setPaymentSuccess(false);
    setTx('');
    setStatus('');
  };

  /* =======================================================
     SHARE
  ======================================================= */

  const sharePaymentLink = async () => {
    if (!paymentLink) {
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title:
            'BasePayLink Payment',
          text:
            `Pay ${amount} USDC`,
          url: paymentLink,
        });
      } else {
        await copyLink();
      }
    } catch {
      /*
       * User cancelled share dialog.
       */
    }
  };

  /* =======================================================
     STATISTICS
  ======================================================= */

  const totalVolume = useMemo(
    () =>
      payments.reduce(
        (total, payment) =>
          total + payment.amount,
        0n
      ),
    [payments]
  );

  const myPayments = useMemo(
    () =>
      address
        ? payments.filter(
            (payment) =>
              payment.payer.toLowerCase() ===
              address.toLowerCase()
          )
        : [],
    [payments, address]
  );

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <main className="container">

      {/* =================================================
          HEADER
      ================================================= */}

      <div className="badge">
        BASE MAINNET
      </div>

      <h1>BasePayLink</h1>

      <p className="subtitle">
        Simple USDC payments powered by Base.
      </p>

      {/* =================================================
          BUILDER CODE
      ================================================= */}

      <div
        className="builder-badge"
        style={{
          marginBottom: '24px',
          textAlign: 'center',
          opacity: 0.8,
          fontSize: '13px',
        }}
      >
        Builder Code: {BUILDER_CODE}
      </div>

      {/* =================================================
          PAYMENT REQUEST PAGE
      ================================================= */}

      {isPaymentPage ? (
        <section className="card payment-card">

          <div className="section-number">
            PAYMENT REQUEST
          </div>

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
                {shortAddress(
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
            <button
              onClick={connect}
            >
              Connect Wallet
            </button>
          )}

          {address &&
            !paymentSuccess && (
              <button
                onClick={pay}
              >
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
                  {shortAddress(
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
          {/* =================================================
              01 WALLET
          ================================================= */}

          <section className="card">

            <div className="section-number">
              01
            </div>

            <div className="section-label">
              WALLET
            </div>

            <h2>
              Connect Wallet
            </h2>

            <button
              onClick={connect}
            >
              {address
                ? shortAddress(
                    address
                  )
                : 'Connect Wallet'}
            </button>

            {address && (
              <p className="status">
                ✓ Connected to Base Mainnet
              </p>
            )}

          </section>

          {/* =================================================
              02 PAYMENT LINK
          ================================================= */}

          <section className="card">

            <div className="section-number">
              02
            </div>

            <div className="section-label">
              PAYMENT LINK
            </div>

            <h2>
              Create Payment Link
            </h2>

            <label>
              Recipient
            </label>

            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) =>
                setRecipient(
                  event.target.value
                )
              }
            />

            <label>
              Amount (USDC)
            </label>

            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(
                  event.target.value
                )
              }
            />

            <label>
              Memo
            </label>

            <input
              value={memo}
              onChange={(event) =>
                setMemo(
                  event.target.value
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
              <div
                className="link-box"
                style={{
                  marginTop: '20px',
                }}
              >

                <p>
                  <strong>
                    Payment Link
                  </strong>
                </p>

                <input
                  readOnly
                  value={paymentLink}
                  onFocus={(event) =>
                    event.currentTarget.select()
                  }
                />

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap: 'wrap',
                    marginTop: '10px',
                  }}
                >

                  <button
                    onClick={copyLink}
                  >
                    {copied
                      ? '✓ Copied'
                      : 'Copy Link'}
                  </button>

                  <button
                    onClick={
                      sharePaymentLink
                    }
                  >
                    Share
                  </button>

                </div>

                <div
                  style={{
                    marginTop: '20px',
                    textAlign: 'center',
                  }}
                >

                  <p>
                    <strong>
                      Scan to Pay
                    </strong>
                  </p>

                  <QRCodeSVG
                    value={
                      paymentLink
                    }
                    size={220}
                    level="M"
                  />

                </div>

              </div>
            )}

            {status && (
              <p className="status">
                {status}
              </p>
            )}

          </section>

          {/* =================================================
              03 DIRECT USDC PAYMENT
          ================================================= */}

          <section className="card">

            <div className="section-number">
              03
            </div>

            <div className="section-label">
              USDC PAYMENT
            </div>

            <h2>
              Pay USDC
            </h2>

            <label>
              Recipient
            </label>

            <input
              placeholder="0x..."
              value={recipient}
              onChange={(event) =>
                setRecipient(
                  event.target.value
                )
              }
            />

            <label>
              Amount (USDC)
            </label>

            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={amount}
              onChange={(event) =>
                setAmount(
                  event.target.value
                )
              }
            />

            <label>
              Memo
            </label>

            <input
              value={memo}
              onChange={(event) =>
                setMemo(
                  event.target.value
                )
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
                    {shortAddress(
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

          {/* =================================================
              04 PAYMENT HISTORY
          ================================================= */}

          <section className="card">

            <div className="section-number">
              04
            </div>

            <div className="section-label">
              ACTIVITY
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >

              <div>
                <h2>
                  Payment History
                </h2>

                <p
                  style={{
                    marginTop: '4px',
                    opacity: 0.7,
                  }}
                >
                  On-chain USDC payment activity
                </p>
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

            </div>

            {/* HISTORY ERROR */}

            {historyError && (
              <div
                className="history-error"
                style={{
                  marginTop: '20px',
                }}
              >

                <p>
                  <strong>
                    Could not load payment history.
                  </strong>
                </p>

                <p>
                  {historyError}
                </p>

                <button
                  onClick={
                    loadPaymentHistory
                  }
                  disabled={
                    historyLoading
                  }
                >
                  {historyLoading
                    ? 'Retrying...'
                    : 'Try Again'}
                </button>

              </div>
            )}

            {/* HISTORY LOADING */}

            {!historyError &&
              historyLoading && (
                <p className="status">
                  Loading payment history...
                </p>
              )}

            {/* HISTORY */}

            {!historyError &&
              !historyLoading &&
              historyLoaded && (
                <>

                  {/* STATISTICS */}

                  <div
                    className="payment-summary"
                    style={{
                      marginTop: '20px',
                    }}
                  >

                    <div>
                      <span>
                        Payments
                      </span>

                      <strong>
                        {payments.length}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Total Volume
                      </span>

                      <strong>
                        {formatUnits(
                          totalVolume,
                          6
                        )}{' '}
                        USDC
                      </strong>
                    </div>

                    <div>
                      <span>
                        My Payments
                      </span>

                      <strong>
                        {myPayments.length}
                      </strong>
                    </div>

                  </div>

                  {/* EMPTY */}

                  {payments.length === 0 ? (
                    <div
                      className="status"
                      style={{
                        marginTop: '20px',
                      }}
                    >

                      <p>
                        No recent payments found.
                      </p>

                      <p>
                        Payment history currently
                        searches the latest 50,000
                        Base blocks.
                      </p>

                    </div>
                  ) : (
                    <div
                      className="table-wrapper"
                      style={{
                        marginTop: '20px',
                        overflowX: 'auto',
                      }}
                    >

                      <table
                        className="payment-table"
                        style={{
                          width: '100%',
                          borderCollapse:
                            'collapse',
                        }}
                      >

                        <thead>
                          <tr>
                            <th>
                              Amount
                            </th>

                            <th>
                              Payer
                            </th>

                            <th>
                              Recipient
                            </th>

                            <th>
                              Memo
                            </th>

                            <th>
                              Transaction
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {payments.map(
                            (
                              payment,
                              index
                            ) => (
                              <tr
                                key={`${payment.txHash}-${payment.linkId}-${index}`}
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
                                  {payment.memo ||
                                    '—'}
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