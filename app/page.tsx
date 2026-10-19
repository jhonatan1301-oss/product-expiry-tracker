'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { APP_PIN, supabase } from '@/lib/supabase';

type Product = {
  id: string;
  name: string;
  expiry_date: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
};

type ProductForm = {
  name: string;
  expiry_date: string;
  notes: string;
};

const emptyForm: ProductForm = {
  name: '',
  expiry_date: '',
  notes: '',
};

const formatDate = (dateString: string) => {
  if (!dateString) return 'No date';
  return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const getDaysRemaining = (dateString: string) => {
  if (!dateString) return Infinity;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(`${dateString}T00:00:00`);
  target.setHours(0, 0, 0, 0);

  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const getAlertLevel = (days: number) => {
  if (days < 0) return { label: 'Expired', tone: 'danger' };
  if (days <= 1) return { label: 'Critical', tone: 'danger' };
  if (days <= 3) return { label: 'Soon', tone: 'warn' };
  return { label: 'Normal', tone: 'safe' };
};

export default function HomePage() {
  const [pinInput, setPinInput] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  const alertSummary = useMemo(() => {
    return products
      .map((product) => {
        const days = getDaysRemaining(product.expiry_date);
        return { ...product, days };
      })
      .sort((a, b) => a.days - b.days);
  }, [products]);

  const loadProducts = async () => {
    if (!supabase) {
      const saved = localStorage.getItem('expiry-products');
      setProducts(saved ? JSON.parse(saved) : []);
      setLoading(false);
      setIsFallback(true);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('expiry_date', { ascending: true });

      if (error) throw error;
      setProducts((data as Product[]) || []);
      setIsFallback(false);
    } catch (err) {
      console.error(err);
      setError('Could not load products. Check Supabase setup.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel('products-shared')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => {
          loadProducts();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const persistProducts = (nextProducts: Product[]) => {
    setProducts(nextProducts);
    if (!supabase) {
      localStorage.setItem('expiry-products', JSON.stringify(nextProducts));
    }
  };

  const handleSignIn = (event: FormEvent) => {
    event.preventDefault();
    if (pinInput.trim() === APP_PIN) {
      setSignedIn(true);
      setError('');
      return;
    }
    setError('Incorrect PIN');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!form.name || !form.expiry_date) {
      setError('Please add a product name and expiry date.');
      return;
    }

    try {
      if (editingId && supabase) {
        const { error } = await supabase
          .from('products')
          .update({
            name: form.name,
            expiry_date: form.expiry_date,
            notes: form.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingId);

        if (error) throw error;
      } else if (supabase) {
        const { error } = await supabase.from('products').insert({
          name: form.name,
          expiry_date: form.expiry_date,
          notes: form.notes,
        });

        if (error) throw error;
      } else {
        const next = [...products];

        if (editingId) {
          const index = next.findIndex((item) => item.id === editingId);
          if (index >= 0) {
            next[index] = {
              ...next[index],
              name: form.name,
              expiry_date: form.expiry_date,
              notes: form.notes,
            };
          }
        } else {
          next.push({
            id: `${Date.now()}`,
            name: form.name,
            expiry_date: form.expiry_date,
            notes: form.notes,
          });
        }

        persistProducts(next);
      }

      setForm(emptyForm);
      setEditingId(null);
      setError('');
      if (!supabase) {
        setLoading(false);
      }
      await loadProducts();
    } catch (err) {
      console.error(err);
      setError('Could not save product.');
    }
  };

  const handleEdit = (product: Product) => {
    setForm({
      name: product.name,
      expiry_date: product.expiry_date,
      notes: product.notes || '',
    });
    setEditingId(product.id);
  };

  const handleDelete = async (id: string) => {
    try {
      if (supabase) {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
      } else {
        const next = products.filter((item) => item.id !== id);
        persistProducts(next);
      }
      setError('');
      await loadProducts();
    } catch (err) {
      console.error(err);
      setError('Could not delete product.');
    }
  };

  if (!signedIn) {
    return (
      <main className="page-shell login-shell">
        <div className="card auth-card">
          <div className="eyebrow">Expiry Tracker</div>
          <h1>Shared team access</h1>
          <p>Enter the team PIN to continue.</p>

          <form onSubmit={handleSignIn} className="stack">
            <label className="field-label" htmlFor="pin">
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pinInput}
              onChange={(event) => setPinInput(event.target.value)}
              placeholder="Enter PIN"
              autoComplete="off"
            />
            <button type="submit" className="primary-button">
              Access products
            </button>
          </form>

          {error ? <div className="error-box">{error}</div> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <div className="topbar">
        <div>
          <div className="eyebrow">Product tracker</div>
          <h1>Expiry overview</h1>
        </div>
        <button className="secondary-button" onClick={() => setSignedIn(false)}>
          Sign out
        </button>
      </div>

      {isFallback ? <div className="fallback-banner">Local browser mode active</div> : null}

      <section className="summary-grid">
        {alertSummary.slice(0, 3).map((item) => {
          const alert = getAlertLevel(item.days);
          return (
            <div key={item.id} className={`summary-card ${alert.tone}`}>
              <span>{alert.label}</span>
              <strong>{item.name}</strong>
              <small>
                {item.days < 0
                  ? `${Math.abs(item.days)} day${Math.abs(item.days) === 1 ? '' : 's'} overdue`
                  : item.days === 0
                    ? 'Expires today'
                    : `In ${item.days} day${item.days === 1 ? '' : 's'}`}
              </small>
            </div>
          );
        })}
      </section>

      <section className="content-grid">
        <div className="card form-card">
          <div className="card-header">
            <h2>{editingId ? 'Edit product' : 'Add product'}</h2>
          </div>

          <form onSubmit={handleSubmit} className="stack">
            <div className="field-group">
              <label htmlFor="name">Product name</label>
              <input
                id="name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Example: Hand soap"
              />
            </div>

            <div className="field-group">
              <label htmlFor="expiry">Expiry date</label>
              <input
                id="expiry"
                type="date"
                value={form.expiry_date}
                onChange={(event) => setForm({ ...form, expiry_date: event.target.value })}
              />
            </div>

            <div className="field-group">
              <label htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Optional notes"
              />
            </div>

            {error ? <div className="error-box">{error}</div> : null}

            <div className="button-row">
              <button type="submit" className="primary-button">
                {editingId ? 'Save changes' : 'Add product'}
              </button>
              {editingId ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm);
                    setError('');
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </div>

        <div className="card list-card">
          <div className="card-header">
            <h2>Products</h2>
            <span>{products.length} total</span>
          </div>

          {loading ? (
            <p className="muted">Loading products...</p>
          ) : products.length === 0 ? (
            <p className="muted">No products yet. Add your first item.</p>
          ) : (
            <div className="product-list">
              {products.map((product) => {
                const days = getDaysRemaining(product.expiry_date);
                const alert = getAlertLevel(days);

                return (
                  <article key={product.id} className={`product-item ${alert.tone}`}>
                    <div className="product-main">
                      <div className="product-topline">
                        <strong>{product.name}</strong>
                        <span className={`badge ${alert.tone}`}>{alert.label}</span>
                      </div>

                      <p className="date-line">{formatDate(product.expiry_date)}</p>
                      {product.notes ? <p className="notes">{product.notes}</p> : null}
                    </div>

                    <div className="product-actions">
                      <small>
                        {days < 0
                          ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
                          : days === 0
                            ? 'Expires today'
                            : `In ${days} day${days === 1 ? '' : 's'}`}
                      </small>

                      <div className="icon-row">
                        <button type="button" onClick={() => handleEdit(product)}>
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => handleDelete(product.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
