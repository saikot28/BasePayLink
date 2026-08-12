'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseUnits,
  stringToBytes,
  type Address,
  type Hash,
} from 'viem';
import { base } from 'viem/chains';
import { Attribution } from 'ox/erc8021';
import { QRCodeSVG } from 'qrcode.react';

/* =========================================================
   CONFIG
========================================================= */

const USDC =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

const PAYMENT_CONTRACT =
  (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT ||
    '0x0650a97C4d0a130E8aEa7852fA780B97fED5888C') as Address;

const BUILDER_CODE = 'bc_0i1qmqg3';

const DATA_SUFFIX = Attribution.toDataSuffix({
  codes: [BUILDER_CODE],
});

const BASE_RPC = 'https://mainnet.base.org';

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

/* =========================================================
   TYPES
========================================================= */

type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type PaymentItem = {
  linkId: `0x${string}`;
  payer: Address;
  recipient: Address;
  amount: bigint;
  memo: string;
  txHash: Hash;
  blockNumber: bigint;
};

/* =========================================================
   ERC20 ABI
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
        name: '',
        type: 'bool',
      },
    ],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      {
        name: 'owner',
        type: 'address',
      },
      {
        name: 'spender',
        type: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      {
        name: 'account',
        type: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],
  },
] as const;

/* =========================================================
   PAYMENT CONTRACT ABI
========================================================= */

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

/* =========================================================
   PAYMENT EVENT
========================================================= */

const paymentEvent = {
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

/* =========================================================
   HELPERS
========================================================= */

function shortAddress(value: string): string {
  if (!value) return '';

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isValidAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function makeLinkId(
  recipient: string,
  amount: string,
  memo: string,
): `0x${string}` {
  return keccak256(
    stringToBytes(
      `${recipient.toLowerCase()}-${amount}-${memo}`,
    ),
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'shortMessage' in error
  ) {
    const value = (
      error as {
        shortMessage?: unknown;
      }
    ).shortMessage;

    if (typeof value === 'string') {
      return value;
    }
  }

  return 'Transaction failed.';
}

/* =========================================================
   WAIT FOR RECEIPT
========================================================= */

async function waitForReceipt(
  provider: EthereumProvider,
  hash: Hash,
  timeoutMs = 180000,
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    });

    if (receipt) {
      return receipt as {
        status?: string;
        blockNumber?: string;
        transactionHash?: string;
      };
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 2000),
    );
  }

  throw new Error(
    'Transaction confirmation timed out. Check BaseScan.',
  );
}

/* =========================================================
   APP
========================================================= */

export default function Home() {
  const [address, setAddress] =
    useState<Address | undefined>();

  const [recipient, setRecipient] =
    useState('');

  const [amount, setAmount] =
    useState('1');

  const [memo, setMemo] =
    useState('BasePayLink payment');

  const [paymentLink, setPaymentLink] =
    useState('');

  const [status, setStatus] =
    useState('');

  const [txHash, setTxHash] =
    useState<Hash | ''>('');

  const [paymentBusy, setPaymentBusy] =
    useState(false);

  const [paymentSuccess, setPaymentSuccess] =
    useState(false);

  const [payments, setPayments] =
    useState<PaymentItem[]>([]);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyError, setHistoryError] =
    useState('');

  const [historyLoaded, setHistoryLoaded] =
    useState(false);

  const [copied, setCopied] =
    useState(false);

  const [isPaymentPage, setIsPaymentPage] =
    useState(false);

  /* =======================================================
     PAYMENT LINK PAGE
  ======================================================= */

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search,
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

  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus(
        'No compatible wallet found. Please install MetaMask or another Base-compatible wallet.',
      );
      return;
    }

    try {
      try {
        await window.ethereum.request({
          method:
            'wallet_switchEthereumChain',
          params: [
            {
              chainId: '0x2105',
            },
          ],
        });
      } catch (switchError) {
        const errorCode =
          typeof switchError === 'object' &&
          switchError !== null &&
          'code' in switchError
            ? Number(
                (
                  switchError as {
                    code?: unknown;
                  }
                ).code,
              )
            : 0;

        if (errorCode === 4902) {
          await window.ethereum.request({
            method:
              'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x2105',
                chainName:
                  'Base Mainnet',
                nativeCurrency: {
                  name: 'Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: [
                  BASE_RPC,
                ],
                blockExplorerUrls: [
                  'https://basescan.org',
                ],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }

      const accounts =
        (await window.ethereum.request({
          method:
            'eth_requestAccounts',
        })) as string[];

      if (!accounts[0]) {
        throw new Error(
          'No wallet account selected.',
        );
      }

      const walletAddress =
        getAddress(accounts[0]);

      setAddress(walletAddress);

      setStatus(
        '✓ Wallet connected to Base Mainnet.',
      );
    } catch (error) {
      setStatus(
        getErrorMessage(error),
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
        'Enter a valid recipient address.',
      );
      return;
    }

    const numericAmount =
      Number(amount);

    if (
      !Number.isFinite(
        numericAmount,
      ) ||
      numericAmount <= 0
    ) {
      setStatus(
        'Enter a valid USDC amount.',
      );
      return;
    }

    const linkId =
      makeLinkId(
        recipient,
        amount,
        memo,
      );

    const url =
      `${window.location.origin}/?pay=${linkId}` +
      `&recipient=${encodeURIComponent(
        recipient,
      )}` +
      `&amount=${encodeURIComponent(
        amount,
      )}` +
      `&memo=${encodeURIComponent(
        memo,
      )}`;

    setPaymentLink(url);

    setStatus(
      '✓ Payment link created.',
    );
  };

  /* =======================================================
     COPY
  ======================================================= */

  const copyPaymentLink = async () => {
    if (!paymentLink) return;

    try {
      await navigator.clipboard.writeText(
        paymentLink,
      );

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setStatus(
        'Could not copy payment link.',
      );
    }
  };

  /* =======================================================
     PAYMENT HISTORY
  ======================================================= */

  const loadPaymentHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const latestBlock =
        await publicClient.getBlockNumber();

      /*
       * Search only recent blocks.
       *
       * This avoids unnecessarily large
       * eth_getLogs requests.
       */
      const RECENT_BLOCKS = 30_000n;
      const CHUNK_SIZE = 9_000n;

      const startBlock =
        latestBlock > RECENT_BLOCKS
          ? latestBlock -
            RECENT_BLOCKS
          : 0n;

      const decodedPayments: PaymentItem[] =
        [];

      let fromBlock =
        startBlock;

      while (
        fromBlock <=
        latestBlock
      ) {
        const toBlock =
          fromBlock +
            CHUNK_SIZE -
            1n <
          latestBlock
            ? fromBlock +
              CHUNK_SIZE -
              1n
            : latestBlock;

        const logs =
          await publicClient.getLogs({
            address:
              PAYMENT_CONTRACT,
            fromBlock,
            toBlock,
          });

        for (const log of logs) {
          if (
            !log.transactionHash ||
            log.blockNumber === null
          ) {
            continue;
          }

          try {
            /*
             * IMPORTANT:
             * log.topics is readonly.
             * Spread it into a normal array.
             */
            const decoded =
              decodeEventLog({
                abi: [
                  paymentEvent,
                ],
                data: log.data,
                topics: [
                  ...log.topics,
                ],
              });

            if (
              decoded.eventName !==
              'Payment'
            ) {
              continue;
            }

            const args =
              decoded.args;

            decodedPayments.push({
              linkId:
                args.linkId,
              payer:
                args.payer,
              recipient:
                args.recipient,
              amount:
                args.amount,
              memo:
                args.memo || '',
              txHash:
                log.transactionHash,
              blockNumber:
                log.blockNumber,
            });
          } catch (decodeError) {
            console.warn(
              'Payment event decode failed:',
              decodeError,
            );
          }
        }

        if (
          toBlock >=
          latestBlock
        ) {
          break;
        }

        fromBlock =
          toBlock + 1n;
      }

      decodedPayments.sort(
        (a, b) => {
          if (
            a.blockNumber >
            b.blockNumber
          ) {
            return -1;
          }

          if (
            a.blockNumber <
            b.blockNumber
          ) {
            return 1;
          }

          return 0;
        },
      );

      setPayments(
        decodedPayments,
      );

      setHistoryLoaded(true);
    } catch (error) {
      console.error(
        'Payment history error:',
        error,
      );

      setHistoryError(
        getErrorMessage(error),
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  /* =======================================================
     INITIAL HISTORY
  ======================================================= */

  useEffect(() => {
    void loadPaymentHistory();
  }, []);

  /* =======================================================
     PAY USDC
  ======================================================= */

  const payUSDC = async () => {
    if (paymentBusy) {
      return;
    }

    if (!window.ethereum) {
      setStatus(
        'Please install a compatible wallet.',
      );
      return;
    }

    if (!address) {
      setStatus(
        'Connect Wallet First.',
      );
      return;
    }

    if (!isValidAddress(recipient)) {
      setStatus(
        'Enter a valid recipient address.',
      );
      return;
    }

    const numericAmount =
      Number(amount);

    if (
      !Number.isFinite(
        numericAmount,
      ) ||
      numericAmount <= 0
    ) {
      setStatus(
        'Enter a valid USDC amount.',
      );
      return;
    }

    setPaymentBusy(true);
    setPaymentSuccess(false);
    setTxHash('');
    setStatus('');

    try {
      /* -----------------------------------------------
         Make sure wallet is on Base
      ------------------------------------------------ */

      try {
        await window.ethereum.request({
          method:
            'wallet_switchEthereumChain',
          params: [
            {
              chainId: '0x2105',
            },
          ],
        });
      } catch (switchError) {
        const errorCode =
          typeof switchError === 'object' &&
          switchError !== null &&
          'code' in switchError
            ? Number(
                (
                  switchError as {
                    code?: unknown;
                  }
                ).code,
              )
            : 0;

        if (errorCode === 4902) {
          await window.ethereum.request({
            method:
              'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x2105',
                chainName:
                  'Base Mainnet',
                nativeCurrency: {
                  name: 'Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: [
                  BASE_RPC,
                ],
                blockExplorerUrls: [
                  'https://basescan.org',
                ],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }

      const walletClient =
        createWalletClient({
          chain: base,
          transport:
            custom(
              window.ethereum,
            ),
          dataSuffix:
            DATA_SUFFIX,
        });

      const value =
        parseUnits(
          amount,
          6,
        );

      const checksumRecipient =
        getAddress(
          recipient,
        );

      const linkId =
        makeLinkId(
          recipient,
          amount,
          memo,
        );

      /* -----------------------------------------------
         Balance
      ------------------------------------------------ */

      setStatus(
        'Checking USDC balance...',
      );

      const balance =
        await publicClient.readContract(
          {
            address: USDC,
            abi: erc20Abi,
            functionName:
              'balanceOf',
            args: [
              address,
            ],
          },
        );

      if (balance < value) {
        throw new Error(
          `Insufficient USDC balance. You need ${amount} USDC.`,
        );
      }

      /* -----------------------------------------------
         Allowance
      ------------------------------------------------ */

      setStatus(
        'Checking USDC approval...',
      );

      const allowance =
        await publicClient.readContract(
          {
            address: USDC,
            abi: erc20Abi,
            functionName:
              'allowance',
            args: [
              address,
              PAYMENT_CONTRACT,
            ],
          },
        );

      /* -----------------------------------------------
         Approve
      ------------------------------------------------ */

      if (allowance < value) {
        setStatus(
          'Step 1/2: Confirm USDC approval in your wallet...',
        );

        const approvalHash =
          await walletClient.writeContract(
            {
              address: USDC,
              abi: erc20Abi,
              functionName:
                'approve',
              args: [
                PAYMENT_CONTRACT,
                value,
              ],
              account:
                address,
            },
          );

        setStatus(
          'Waiting for approval confirmation...',
        );

        const approvalReceipt =
          await waitForReceipt(
            window.ethereum,
            approvalHash,
          );

        if (
          approvalReceipt.status ===
          '0x0'
        ) {
          throw new Error(
            'USDC approval transaction failed.',
          );
        }
      }

      /* -----------------------------------------------
         Simulate
      ------------------------------------------------ */

      setStatus(
        'Checking payment transaction...',
      );

      await publicClient.simulateContract(
        {
          address:
            PAYMENT_CONTRACT,
          abi: paymentAbi,
          functionName:
            'pay',
          args: [
            linkId,
            checksumRecipient,
            value,
            memo,
          ],
          account:
            address,
        },
      );

      /* -----------------------------------------------
         Payment
      ------------------------------------------------ */

      setStatus(
        'Step 2/2: Confirm USDC payment in your wallet...',
      );

      const hash =
        await walletClient.writeContract(
          {
            address:
              PAYMENT_CONTRACT,
            abi: paymentAbi,
            functionName:
              'pay',
            args: [
              linkId,
              checksumRecipient,
              value,
              memo,
            ],
            account:
              address,
          },
        );

      setTxHash(hash);

      setStatus(
        'Payment submitted. Waiting for confirmation...',
      );

      /*
       * IMPORTANT:
       *
       * Do NOT use publicClient.waitForTransactionReceipt()
       * here because some public RPCs can return:
       *
       * "Archive requests require a personal token"
       *
       * Instead use the connected wallet RPC.
       */
      const receipt =
        await waitForReceipt(
          window.ethereum,
          hash,
        );

      if (
        receipt.status ===
        '0x0'
      ) {
        throw new Error(
          'Payment transaction reverted. Check BaseScan.',
        );
      }

      setPaymentSuccess(true);

      setStatus(
        '✓ Payment confirmed on Base Mainnet.',
      );

      /*
       * Give the RPC a moment before
       * refreshing history.
       */
      setTimeout(() => {
        void loadPaymentHistory();
      }, 3000);
    } catch (error) {
      console.error(
        'USDC payment error:',
        error,
      );

      setStatus(
        getErrorMessage(error),
      );

      setPaymentSuccess(false);
    } finally {
      setPaymentBusy(false);
    }
  };

  /* =======================================================
     STATS
  ======================================================= */

  const totalVolume =
    useMemo(() => {
      return payments.reduce(
        (sum, payment) =>
          sum + payment.amount,
        0n,
      );
    }, [payments]);

  const myPayments =
    address
      ? payments.filter(
          (payment) =>
            payment.payer.toLowerCase() ===
            address.toLowerCase(),
        )
      : [];

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <main className="container">
      <div className="badge">
        BASE MAINNET
      </div>

      <h1>
        BasePayLink
      </h1>

      <p className="subtitle">
        Simple USDC payments powered by
        Base.
      </p>

      {/* =================================================
          PAYMENT LINK PAGE
      ================================================= */}

      {isPaymentPage ? (
        <section className="card payment-card">
          <div className="section-number">
            PAYMENT REQUEST
          </div>

          <div className="section-label">
            USDC PAYMENT
          </div>

          <h2>
            Pay USDC
          </h2>

          <div className="payment-summary">
            <div>
              <span>
                Recipient
              </span>

              <strong>
                {shortAddress(
                  recipient,
                )}
              </strong>
            </div>

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
                Memo
              </span>

              <strong>
                {memo}
              </strong>
            </div>
          </div>

          {!address && (
            <button
              onClick={
                connectWallet
              }
            >
              Connect Wallet
            </button>
          )}

          {address &&
            !paymentSuccess && (
              <button
                onClick={payUSDC}
                disabled={
                  paymentBusy
                }
              >
                {paymentBusy
                  ? 'Processing...'
                  : `Pay ${amount} USDC`}
              </button>
            )}

          {status && (
            <p className="status">
              {status}
            </p>
          )}

          {paymentSuccess &&
            txHash && (
              <div className="success">
                <h3>
                  ✓ Payment Successful
                </h3>

                <p>
                  {amount} USDC paid
                  successfully.
                </p>

                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Transaction on
                  BaseScan →
                </a>
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
              onClick={
                connectWallet
              }
            >
              {address
                ? shortAddress(
                    address,
                  )
                : 'Connect Wallet'}
            </button>

            {address && (
              <p className="status">
                ✓ Connected to Base
                Mainnet
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
              value={recipient}
              placeholder="0x..."
              onChange={(event) =>
                setRecipient(
                  event.target.value,
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
              onChange={(event) =>
                setAmount(
                  event.target.value,
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
                  event.target.value,
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
              <div className="link-result">
                <p>
                  Payment link created:
                </p>

                <input
                  readOnly
                  value={
                    paymentLink
                  }
                />

                <button
                  onClick={
                    copyPaymentLink
                  }
                >
                  {copied
                    ? '✓ Copied'
                    : 'Copy Link'}
                </button>

                <div className="qr-box">
                  <h3>
                    Scan to Pay
                  </h3>

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
              03 DIRECT PAYMENT
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
              value={recipient}
              placeholder="0x..."
              onChange={(event) =>
                setRecipient(
                  event.target.value,
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
              onChange={(event) =>
                setAmount(
                  event.target.value,
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
                  event.target.value,
                )
              }
            />

            <button
              disabled={
                !address ||
                paymentBusy
              }
              onClick={payUSDC}
            >
              {!address
                ? 'Connect Wallet First'
                : paymentBusy
                  ? 'Processing...'
                  : 'Pay USDC'}
            </button>

            {status && (
              <p className="status">
                {status}
              </p>
            )}

            {paymentSuccess &&
              txHash && (
                <div className="success">
                  <h3>
                    ✓ Payment Successful
                  </h3>

                  <p>
                    {amount} USDC paid
                    successfully.
                  </p>

                  <a
                    href={`https://basescan.org/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Transaction on
                    BaseScan →
                  </a>
                </div>
              )}
          </section>

          {/* =================================================
              04 HISTORY
          ================================================= */}

          <section className="card history-card">
            <div className="section-number">
              04
            </div>

            <div className="section-label">
              ACTIVITY
            </div>

            <div className="history-header">
              <div>
                <h2>
                  Payment History
                </h2>

                <p>
                  On-chain USDC payment
                  activity
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

            {historyError && (
              <div className="error-box">
                <strong>
                  Could not load payment
                  history.
                </strong>

                <p>
                  {historyError}
                </p>

                <button
                  onClick={
                    loadPaymentHistory
                  }
                >
                  Try Again
                </button>
              </div>
            )}

            {historyLoading && (
              <div className="loading">
                Loading payment history...
              </div>
            )}

            {!historyLoading &&
              !historyError &&
              historyLoaded && (
                <>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span>
                        Payments
                      </span>

                      <strong>
                        {payments.length}
                      </strong>
                    </div>

                    <div className="stat-card">
                      <span>
                        Total Volume
                      </span>

                      <strong>
                        {formatUnits(
                          totalVolume,
                          6,
                        )}{' '}
                        USDC
                      </strong>
                    </div>

                    <div className="stat-card">
                      <span>
                        My Payments
                      </span>

                      <strong>
                        {
                          myPayments.length
                        }
                      </strong>
                    </div>
                  </div>

                  {payments.length ===
                  0 ? (
                    <div className="empty">
                      <h3>
                        No payments yet
                      </h3>

                      <p>
                        On-chain BasePayLink
                        payments will appear
                        here.
                      </p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
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
                              index,
                            ) => (
                              <tr
                                key={`${payment.txHash}-${index}`}
                              >
                                <td>
                                  <strong>
                                    {formatUnits(
                                      payment.amount,
                                      6,
                                    )}{' '}
                                    USDC
                                  </strong>
                                </td>

                                <td>
                                  {shortAddress(
                                    payment.payer,
                                  )}
                                </td>

                                <td>
                                  {shortAddress(
                                    payment.recipient,
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
                                    View on BaseScan
                                    →
                                  </a>
                                </td>
                              </tr>
                            ),
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

      <footer>
        <span>
          BasePayLink
        </span>

        <span>
          Built on Base Mainnet
        </span>

        <span>
          Builder Code:{' '}
          {BUILDER_CODE}
        </span>
      </footer>
    </main>
  );
}