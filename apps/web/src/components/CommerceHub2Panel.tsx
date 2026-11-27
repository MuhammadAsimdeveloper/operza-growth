import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge, Button, Card, EmptyState, Alert } from './ui';

type Tab = 'overview' | 'products' | 'refunds' | 'ledger' | 'reconciliation';

interface ProductItem {
  id: string;
  name: string;
  sku: string;
  price_cents: number;
  currency: string;
  product_type: string;
  status: string;
}

interface RefundItem {
  id: string;
  payment_id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string;
}

function formatMinor(cents: number, cur = 'USD') {
  return `${cur} ${(Number(cents || 0) / 100).toFixed(2)}`;
}

export function CommerceHub2Panel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodPriceCents, setProdPriceCents] = useState('4900');
  const [prodCurrency, setProdCurrency] = useState('USD');
  const [calcResult, setCalcResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const productsQ = useQuery({
    queryKey: ['commerce2', 'products'],
    queryFn: () => request<{ data: ProductItem[] }>('/api/commerce/v2/products'),
    retry: false,
  });

  const refundsQ = useQuery({
    queryKey: ['commerce2', 'refunds'],
    queryFn: () => request<{ data: RefundItem[] }>('/api/commerce/v2/refunds'),
    retry: false,
  });

  const ledgerVerifyQ = useQuery({
    queryKey: ['commerce2', 'ledger-verify'],
    queryFn: () => request<{ valid: boolean; count: number; finalBalanceCents: number }>('/api/commerce/v2/ledger/verify'),
    retry: false,
  });

  const reconciliationQ = useQuery({
    queryKey: ['commerce2', 'reconciliation'],
    queryFn: () => request<{ reconciled: boolean; discrepancies: any[]; checkedPayments: number; checkedInvoices: number }>('/api/commerce/v2/reconciliation'),
    retry: false,
  });

  const createProductMut = useMutation({
    mutationFn: () =>
      request('/api/commerce/v2/products', {
        method: 'POST',
        body: JSON.stringify({
          name: prodName || 'Agency Retainer',
          sku: prodSku || `SKU-${Date.now()}`,
          priceCents: Number(prodPriceCents || 0),
          currency: prodCurrency,
        }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setProdName('');
      setProdSku('');
      qc.invalidateQueries({ queryKey: ['commerce2', 'products'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const calcPreviewMut = useMutation({
    mutationFn: () =>
      request('/api/commerce/v2/orders/calculate', {
        method: 'POST',
        body: JSON.stringify({
          currency: prodCurrency,
          items: [{ quantity: 1, unitPriceCents: Number(prodPriceCents || 0) }],
          coupon: { active: true, discountType: 'percent', discountValue: 10 },
          explicitTaxCents: 0,
        }),
      }),
    onSuccess: (data) => {
      setErrorMsg(null);
      setCalcResult(data);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  return (
    <Card className="p-5" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Commerce, Ledger &amp; Subscription Management 2.0</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
            Minor-unit product catalog, cumulative refund governance, hash-chained ledger verification, and cross-entity reconciliation.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['overview', 'products', 'refunds', 'ledger', 'reconciliation'] as Tab[]).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {errorMsg && <Alert tone="danger" title="Commerce Action Error">{errorMsg}</Alert>}

      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Catalog Products</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{productsQ.data?.data?.length ?? 0}</div>
            </div>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Governed Refunds</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{refundsQ.data?.data?.length ?? 0}</div>
            </div>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Ledger Chain</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{ledgerVerifyQ.data?.valid ? 'Verified' : 'PG Required'}</div>
            </div>
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Reconciliation</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{reconciliationQ.data?.reconciled ? 'Balanced' : 'PG Required'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => calcPreviewMut.mutate()}>
              Test Minor-Unit Order Total (10% Coupon)
            </Button>
            {calcResult && (
              <Badge tone="green">
                Subtotal {formatMinor(calcResult.subtotalCents, calcResult.currency)} − Discount {formatMinor(calcResult.discountCents, calcResult.currency)} = Total {formatMinor(calcResult.totalCents, calcResult.currency)}
              </Badge>
            )}
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input className="input" placeholder="Product name" value={prodName} onChange={(e) => setProdName(e.target.value)} />
            <input className="input" placeholder="SKU" value={prodSku} onChange={(e) => setProdSku(e.target.value)} />
            <input className="input" type="number" placeholder="Price (cents)" value={prodPriceCents} onChange={(e) => setProdPriceCents(e.target.value)} />
            <select className="select" value={prodCurrency} onChange={(e) => setProdCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
            <Button onClick={() => createProductMut.mutate()} disabled={createProductMut.isPending}>Add Product</Button>
          </div>
          {(productsQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="No Commerce 2.0 products" text="Create a minor-unit catalog product above (PostgreSQL required for persistence)." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {productsQ.data?.data.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span><strong>{p.name}</strong> ({p.sku})</span>
                  <Badge tone="default">{formatMinor(p.price_cents, p.currency)}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'refunds' && (
        <div>
          {(refundsQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="No refunds recorded" text="Refund requests enforce cumulative capture caps, approval thresholds, and append-only ledger reversals." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {refundsQ.data?.data.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span>{formatMinor(r.amount_cents, r.currency)} · {r.reason}</span>
                  <Badge tone={r.status === 'succeeded' || r.status === 'approved' ? 'green' : 'default'}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'ledger' && (
        <Alert tone={ledgerVerifyQ.data?.valid ? 'info' : 'warning'} title="Hash-Chained Append-Only Ledger">
          {ledgerVerifyQ.data
            ? `Verified ${ledgerVerifyQ.data.count} immutable entries. Final balance: ${ledgerVerifyQ.data.finalBalanceCents} cents.`
            : 'Connect PostgreSQL to run live SHA-256 hash-chain verification across billing_ledger_entries.'}
        </Alert>
      )}

      {tab === 'reconciliation' && (
        <Alert tone={reconciliationQ.data?.reconciled ? 'info' : 'warning'} title="Cross-Entity Reconciliation">
          {reconciliationQ.data
            ? `Checked ${reconciliationQ.data.checkedPayments} payments and ${reconciliationQ.data.checkedInvoices} paid invoices. Discrepancies: ${reconciliationQ.data.discrepancies.length}.`
            : 'Connect PostgreSQL to reconcile payments, invoices, and ledger entries.'}
        </Alert>
      )}
    </Card>
  );
}
