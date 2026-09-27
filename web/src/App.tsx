import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { getClient, type Config } from './config';
import { errorMessage, getQuote, readEvents, readState, switchChain, transact, type Quote, type State } from './chain';
import { amount, parseAmount, poolPrice } from './math';

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const Arrow = ({ diagonal = false }: { diagonal?: boolean }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
function External({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}<span className="sr-only"> (opens in a new tab)</span><Arrow diagonal /></a>;
}

export default function App({ config }: { config: Config }) {
  const d = config.deployment;
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [state, setState] = useState<State>();
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(true);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof readEvents>>>();
  const [eventError, setEventError] = useState('');
  const [buy, setBuy] = useState(true);
  const [input, setInput] = useState('');
  const [bps, setBps] = useState(100);
  const [quote, setQuote] = useState<Quote>();
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [bonus, setBonus] = useState<{ input: bigint; value: bigint }>();
  const [review, setReview] = useState<{ quote: Quote; account: Address }>();
  const [busy, setBusy] = useState(false);
  const [txStatus, setTxStatus] = useState('');
  const [txError, setTxError] = useState('');
  const [txHash, setTxHash] = useState<Hex>();
  const [quoteNonce, setQuoteNonce] = useState(0);
  const [now, setNow] = useState(Date.now());
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const correctChain = walletChain === d.chainId;
  const client = useMemo(() => getClient(config, account && correctChain ? window.ethereum : undefined), [config, account, correctChain]);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setReading(true);
    try {
      const next = await readState(client, config, account && correctChain ? account : undefined);
      if (version !== generation.current) return;
      setState(next); setReadError('');
      try {
        const logs = await readEvents(client, config, next.block);
        if (version === generation.current) { setEvents(logs); setEventError(''); }
      } catch (error) { if (version === generation.current) setEventError(errorMessage(error, config)); }
    } catch (error) {
      if (version === generation.current) { setReadError(`Unable to read live pool data. Check your connection and use Refresh pool data to retry. ${errorMessage(error, config)}`); setState(undefined); }
    } finally { if (version === generation.current) setReading(false); }
  }, [client, config, account, correctChain]);
  useEffect(() => {
    setState(undefined); setReview(undefined); setQuote(undefined);
    void refresh(); const timer = setInterval(() => void refresh(), 30000);
    return () => { generation.current++; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const provider = window.ethereum;
    const accountsChanged = (...args: unknown[]) => {
      setAccount((args[0] as Address[])[0]); setReview(undefined); setTxError(''); setQuote(undefined);
    };
    const chainChanged = (...args: unknown[]) => { setWalletChain(Number(args[0])); setReview(undefined); setQuote(undefined); };
    const disconnected = () => { setAccount(undefined); setWalletChain(undefined); setReview(undefined); };
    provider?.on?.('accountsChanged', accountsChanged); provider?.on?.('chainChanged', chainChanged); provider?.on?.('disconnect', disconnected);
    return () => {
      mounted.current = false; clearInterval(timer);
      provider?.removeListener?.('accountsChanged', accountsChanged); provider?.removeListener?.('chainChanged', chainChanged); provider?.removeListener?.('disconnect', disconnected);
    };
  }, []);
  const decimals = buy ? d.network.nativeCurrency.decimals : state?.decimals ?? d.token.decimals;
  let parsed: bigint | undefined, inputError = '';
  if (input) { try { parsed = parseAmount(input, decimals); } catch (error) { inputError = errorMessage(error, config); } }
  useEffect(() => {
    let active = true;
    setQuote(undefined); setReview(undefined); setQuoteError(''); setBonus(undefined);
    if (!parsed || !state) { setQuoting(false); return; }
    setQuoting(true);
    const timer = setTimeout(async () => {
      if (buy) void client.readContract({ address: config.hook.address, abi: config.hook.abi, functionName: 'bonusFor', args: [config.poolId, parsed] })
        .then(value => { if (active) setBonus({ input: parsed, value: value as bigint }); }).catch(() => {});
      try { const next = await getQuote(client, config, parsed, buy, bps); if (active) { setQuote(next); setBonus({ input: parsed, value: next.bonus }); } }
      catch (error) { if (active) setQuoteError(errorMessage(error, config)); }
      finally { if (active) setQuoting(false); }
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [parsed, buy, bps, client, config, quoteNonce, state?.updatedAt]);
  const quoteMatches = quote && quote.input === parsed && quote.buy === buy && quote.bps === bps;
  const fresh = !!quoteMatches && now - quote.createdAt < 45000;
  const stateFresh = !!state && now - state.updatedAt < 60000 && !readError;
  const balance = buy ? state?.ethBalance : state?.tokenBalance;
  const insufficient = parsed !== undefined && balance !== undefined && (buy ? parsed >= balance : parsed > balance);
  const needsApproval = !buy && parsed !== undefined && state?.allowance !== undefined && state.allowance < parsed;
  const eligible = !!account && correctChain && stateFresh && fresh && !insufficient && !inputError && !busy;
  const reviewing = review && review.account === account && quote === review.quote && fresh;
  const bonusValue = buy && bonus && bonus.input === parsed ? bonus.value : undefined;
  const price = state ? poolPrice(state.sqrtPrice, state.decimals) : undefined;
  const explorer = (address: string) => `${d.network.explorer}/address/${address}`;

  async function connect() {
    setWalletError('');
    if (!window.ethereum) { setWalletError('No browser wallet found. Open this page in an Ethereum wallet’s browser or enable its browser extension, then retry.'); return; }
    setWalletBusy(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts[0]) throw new Error('No account selected. Open your wallet and try again.');
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      setAccount(accounts[0]); setWalletChain(Number(chain));
    } catch (error) { setWalletError(errorMessage(error, config)); } finally { setWalletBusy(false); }
  }
  async function changeChain() {
    if (!window.ethereum) return;
    setWalletBusy(true); setWalletError('');
    try { await switchChain(window.ethereum, config); setWalletChain(Number(await window.ethereum.request({ method: 'eth_chainId' }))); }
    catch (error) { setWalletError(errorMessage(error, config)); } finally { setWalletBusy(false); }
  }
  async function send(approval: boolean) {
    if (!eligible || !quote || !account || !window.ethereum || actionLock.current || (!approval && !reviewing)) return;
    actionLock.current = true; setBusy(true); setTxError(''); setTxHash(undefined);
    try {
      await transact(client, config, window.ethereum, account, quote, approval, (text, hash) => {
        if (mounted.current) { setTxStatus(text); if (hash) setTxHash(hash); }
      });
      setReview(undefined); setQuote(undefined); await refresh(); setQuoteNonce(n => n + 1);
    } catch (error) { setTxError(errorMessage(error, config)); setTxStatus(''); setReview(undefined); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header shell">
      <a href="#main" className="wordmark" aria-label="Oneway home"><span className="brand-icon"><Arrow /></span>oneway<span className="wordmark-dot">.</span></a>
      <nav aria-label="Page navigation"><a href="#activity">Activity</a><a href="#about">How it works</a></nav>
      <div className="header-wallet"><span className="network-badge"><span className="status-dot" />{d.network.name} testnet</span>
        {account ? <button className="button small quiet" disabled={busy} onClick={() => { setAccount(undefined); setWalletChain(undefined); setReview(undefined); setTxStatus(''); setTxHash(undefined); }}>Disconnect {short(account)}</button>
        : <button className="button small quiet" disabled={walletBusy} onClick={() => void connect()}>{walletBusy ? 'Connecting…' : 'Connect wallet'}<Arrow /></button>}
      </div>
    </header>
    <main id="main" className="shell">
      <div className="test-notice"><span className="notice-tag">An on-chain experiment</span><span>Test tokens. No monetary value. No promised returns.</span></div>
      <section className="trading-layout" aria-label="Pool and trading">
        <div className="pool-column">
          <div className="intro"><p className="eyebrow">Oneway / ONEW</p><h1>Sells fund<br />the next buy<span>.</span></h1><p className="lede">A 2% sell tax builds a shared ETH pot. Each buy can use up to 1% extra ETH from that pot, automatically.</p></div>
          <div className="rates" role="group" aria-label="Pool fees"><div><span>Buy hook fee</span><strong>0<span>%</span></strong></div><div><span>Sell tax</span><strong>2<span>%</span></strong></div><div><span>LP fee</span><strong>{state ? (state.lpFee / 10000).toLocaleString('en-US') : d.pool.fee / 10000}<span>%</span></strong></div></div>
          <section className="pot-card" aria-labelledby="pot-title"><div className="pot-top"><h2 id="pot-title">The bonus pot</h2><span className="pot-label">Shared by the pool</span></div><p className="pot-value" title={state ? `${formatUnits(state.pot, 18)} ETH` : undefined}>{amount(state?.pot, 18, 7)} <span>ETH</span></p><p>Collected on sells. Added to future buys.</p><div className="pot-bottom"><span>Buy bonus = min(1% of input, pot)</span><span className="pot-arrow" aria-hidden="true"><Arrow diagonal /></span></div></section>
          <div className="market-line"><div><span className="caption">Pool price · StateView</span><p className="market-price">1 ETH <span>≈</span> {price === undefined ? '—' : price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ONEW</p></div><button className="icon-button" onClick={() => void refresh()} disabled={reading || busy} aria-label="Refresh pool data"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M19 10a7 7 0 1 0-1 7M19 4v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button></div>
          <p className="read-state" role="status">{readError ? 'Live reads unavailable. Retry using the refresh control.' : state ? `Read at block ${state.block.toLocaleString()}${reading ? ' · Refreshing…' : ' · Updates every 30 seconds'}` : 'Checking deployment and reading the pool…'}</p>
          {readError && <p className="error" role="alert">{readError}</p>}
        </div>
        <section className="swap-card" aria-labelledby="swap-title">
          <div className="section-top"><h2 id="swap-title">Make a swap</h2><span className="pill">ETH / ONEW</span></div>
          <div className="direction" role="group" aria-label="Swap direction"><button disabled={busy} aria-pressed={buy} onClick={() => { setBuy(true); setInput(''); setTxError(''); setReview(undefined); }}>Buy ONEW<Arrow diagonal /></button><button disabled={busy} aria-pressed={!buy} onClick={() => { setBuy(false); setInput(''); setTxError(''); setReview(undefined); }}>Sell ONEW<Arrow diagonal /></button></div>
          <form noValidate onSubmit={event => { event.preventDefault(); if (eligible && quote && account && !needsApproval) { setReview({ quote, account }); setTxError(''); } }}>
            <div className="amount-field"><div className="field-top"><label htmlFor="swap-amount">You pay</label><span title={balance !== undefined ? formatUnits(balance, decimals) : undefined}>Balance: {amount(balance, decimals, 4)}</span></div><div className="amount-row"><input id="swap-amount" name="amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={input} disabled={busy} aria-invalid={!!inputError || insufficient} aria-describedby="amount-help" onChange={event => { setInput(event.target.value); setReview(undefined); }} /><span className="currency"><span className={buy ? 'coin eth' : 'coin'} aria-hidden="true">{buy ? '◇' : '↗'}</span>{buy ? 'ETH' : 'ONEW'}</span></div></div>
            <p id="amount-help" className={inputError || insufficient ? 'error field-help' : 'field-help'}>{inputError || (insufficient ? `Insufficient ${buy ? 'ETH; leave room for gas' : 'ONEW'}. Enter a smaller amount.` : buy ? 'Pay native Sepolia ETH. Keep some ETH for gas.' : 'Sell ONEW for native Sepolia ETH, after the 2% sell tax.')}</p>
            <div className="receive-box"><span className="caption">You receive · estimate</span><div><strong>{quoting ? '…' : quoteMatches ? amount(quote.output, buy ? d.token.decimals : 18) : '—'}</strong><span>{buy ? 'ONEW' : 'ETH'}</span></div></div>
            <div className="bonus-preview"><span className="bonus-symbol" aria-hidden="true">↗</span><div><strong>{buy ? 'A little extra, from the pot' : 'Your sell contributes to the pot'}</strong><p>{buy ? `${amount(bonusValue, 18, 7)} ETH added to this buy` : '2% of the gross ETH output funds future buys'}</p></div></div>
            <div className="limit-row"><label htmlFor="price-limit">Price movement limit</label><select id="price-limit" value={bps} disabled={busy} onChange={e => { setBps(Number(e.target.value)); setReview(undefined); }}><option value={50}>0.5%</option><option value={100}>1%</option><option value={300}>3%</option></select></div>
            <p className="fine-print">The limit bounds the pool’s price movement, including your swap. PoolSwapTest has no minimum-output or deadline setting. A partial fill reverts.</p>
            <div className="quote-state" role="status">{quoting ? 'Simulating a quote…' : quoteMatches ? fresh ? `Quote at block ${quote.block.toLocaleString()} · includes LP fee${buy ? ' and current bonus' : ' and sell tax'}` : 'Quote expired. Refresh before continuing.' : !parsed ? 'Enter an amount to preview the swap.' : ''}</div>
            {quoteError && <p className="error" role="alert">Quote unavailable: {quoteError}</p>}
            {parsed && <button className="text-button" type="button" disabled={busy || quoting || !stateFresh} onClick={() => setQuoteNonce(n => n + 1)}>Refresh quote</button>}
            {walletError && <p className="error" role="alert">{walletError}</p>}
            {account && !correctChain && <p className="warning">Your wallet is on another network. Switch to {d.network.name} to trade.</p>}
            {account && <p className="connected">Wallet <bdi title={account}>{short(account)}</bdi>{correctChain ? ` · ${d.network.name}` : ' · Wrong network'}</p>}
            {!account ? <button className="button primary" type="button" disabled={walletBusy} onClick={() => void connect()}>{walletBusy ? 'Connecting…' : 'Connect wallet'}<Arrow /></button>
            : !correctChain ? <button className="button primary" type="button" disabled={walletBusy} onClick={() => void changeChain()}>{walletBusy ? 'Switching…' : `Switch to ${d.network.name}`}<Arrow /></button>
            : needsApproval ? <><p className="fine-print approval-note">Step 1 of 2: approve exactly {parsed ? formatUnits(parsed, decimals) : '0'} ONEW for PoolSwapTest. Step 2: review and sign the sell.</p><button className="button primary" type="button" disabled={!eligible} onClick={() => void send(true)}>{busy ? 'Approval in progress…' : 'Approve ONEW'}<Arrow /></button></>
            : <button className="button primary" type="submit" disabled={!eligible || !!reviewing}>{busy ? 'Swap in progress…' : `Review ${buy ? 'buy' : 'sell'}`}<Arrow /></button>}
            {account && correctChain && !stateFresh && <p className="fine-print">Trading waits for verified, current pool data. Refresh to retry.</p>}
          </form>
          {reviewing && <section className="review-box" aria-label="Review swap"><h3>Review {buy ? 'buy' : 'sell'}</h3><p>Pay <strong>{formatUnits(review.quote.input, decimals)} {buy ? 'ETH' : 'ONEW'}</strong> for an estimated <strong>{amount(review.quote.output, buy ? d.token.decimals : 18)} {buy ? 'ONEW' : 'ETH'}</strong>.</p><p className="fine-print">Price movement limit {bps / 100}%. Network gas is extra. The bonus and output can change before confirmation. Quotes expire after 45 seconds.</p><button className="button primary" disabled={!eligible} onClick={() => void send(false)}>{busy ? 'Confirming…' : `Confirm ${buy ? 'buy' : 'sell'}`}<Arrow /></button><button className="text-button" disabled={busy} onClick={() => setReview(undefined)}>Cancel review</button></section>}
          <p className="transaction-status" role="status">{txStatus}</p>
          {txError && <p className="error" role="alert">{txError}</p>}
          {txHash && <External className="transaction-link" href={`${d.network.explorer}/tx/${txHash}`}>View transaction {short(txHash)}</External>}
          <p className="swap-footnote">Uniswap v4 · Exact input · Sepolia only</p>
        </section>
      </section>
      <section id="activity" className="activity-section" aria-labelledby="activity-title"><div className="section-top"><div><p className="eyebrow">Follow the flow</p><h2 id="activity-title">Recent activity</h2></div><span className="caption">SellTaxed & BuyBonus</span></div>
        <p className="activity-window">{events ? `Latest 20 events in blocks ${events.start.toLocaleString()}–${events.end.toLocaleString()}.` : 'Recent pool events will appear here after the connection is verified.'}</p>
        {eventError ? <div className="empty-state"><strong>Activity could not be refreshed</strong><p className="error">{eventError}</p><button className="button quiet" disabled={reading} onClick={() => void refresh()}>Retry activity</button></div>
        : events?.items.length ? <ol className="event-list">{events.items.map(event => <li key={`${event.hash}-${event.index}`}><span className={`event-icon ${event.name === 'BuyBonus' ? 'bonus' : ''}`} aria-hidden="true">{event.name === 'BuyBonus' ? '↗' : '↙'}</span><div className="event-name"><strong>{event.name === 'BuyBonus' ? 'Buy bonus' : 'Sell taxed'}</strong><span>{event.name} · block {event.block.toLocaleString()}</span></div><div className="event-value"><strong>{amount(event.value, 18, 8)} ETH</strong><span>{event.name === 'BuyBonus' ? 'Added to buy' : 'Added to pot'}</span></div><External href={`${d.network.explorer}/tx/${event.hash}`}><span className="sr-only">View {event.name} transaction </span><span className="event-hash">{short(event.hash)}</span></External></li>)}</ol>
        : <div className="empty-state"><span className="empty-arrow" aria-hidden="true">⇄</span><strong>{events ? 'No events in this block window' : 'Waiting for live activity'}</strong><p>{events ? 'The next sell tax or buy bonus will appear here. Refresh to check again.' : 'The feed reads directly from the hook on Sepolia.'}</p></div>}
      </section>
      <section id="about" className="about-section" aria-labelledby="about-title"><div className="section-top"><h2 id="about-title">One pot. A simple cycle.</h2><span className="caption">No admin. Fixed rates.</span></div><div className="explain-grid"><article><span className="step">01</span><h3>Sells fill the pot</h3><p>The hook collects 2% of a sell’s ETH leg as PoolManager claims for this pool.</p></article><article><span className="step">02</span><h3>Buys get a bonus</h3><p>Up to 1% of your ETH input is added to the swap, capped by the pot. You pay only your input plus gas.</p></article><article><span className="step">03</span><h3>Nothing is free profit</h3><p>A round trip pays 2% on the sell and gets at most 1% on the buy, plus LP fees. Washing does not profit.</p></article></div></section>
      <details id="contracts" className="deployment-details"><summary>View contracts & deployment<span>Verified ABI bindings <Arrow diagonal /></span></summary><div className="contract-grid">{[...d.contracts.map(c => [c.name, c.address]), ['PoolManager', d.network.uniswapV4.poolManager], ['PoolSwapTest', d.integration.poolSwapTest], ['StateView', d.network.uniswapV4.stateView], ['Quoter', d.network.uniswapV4.quoter]].map(([name, address]) => <div key={name}><span>{name}</span><External href={explorer(address)}><code>{address}</code></External></div>)}</div><div className="deployment-meta"><p>Pool ID <code>{config.poolId}</code></p><p>Source commit <code>{d.sourceCommit}</code></p><p>Release attestation <code>{d.attestationHash}</code></p><a href="./imd-deployment.json" target="_blank" rel="noreferrer">Open deployment manifest</a><p>ABI hashes are checked locally. Live chain and contract-code checks gate trading; this is not an independent security audit.</p></div></details>
    </main>
    <footer className="shell"><a className="wordmark footer-brand" href="#main">oneway.</a><p>A Sepolia test toy. ONEW and the bonus pot have no value.</p><External href={d.network.faucets[0]}>Get test ETH</External></footer>
  </>;
}
