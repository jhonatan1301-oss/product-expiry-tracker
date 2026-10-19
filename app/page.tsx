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

type AlertMode = 'expired' | 'critical' | 'soon' | 'normal';

type ProductWithStatus = Product & {
  daysLeft: number;
  status: AlertMode;
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

  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const getAlertState = (daysLeft: number): AlertMode => {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 1) return 'critical';
  if (daysLeft <= 3) return 'soon';
  return 'normal';
};

const getAlertMeta = (status: AlertMode) => {
  switch (status) {
    case 'expired':
      return { label: 'Expired', tone: 'danger' };
    case 'critical':
      return { label: 'Critical', tone: 'danger' };
    case 'soon':
      return { label: 'Soon', tone: 'warning' };
    default:
      return { label: 'Healthy', tone: 'safe' };
  }
};

export default function HomePage() {
  const [pinInput, setPinInput] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AlertMode>('all');
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  const enrichedProducts = useMemo<ProductWithStatus[]>(() => {
    return products
      .map((product) => {
        const daysLeft = getDaysRemaining(product.expiry_date);
        return {
          ...product,
          daysLeft,
          status: getAlertState(daysLeft),
        };
      })
      .sort((a, b) => {
        if (a.status === b.status) {
          return a.daysLeft - b.daysLeft;
        }

        const order: Record<AlertMode, number> = {
          expired: 0,
          critical: 1,
          soon: 2,
          normal: 3,
        };

        return order[a.status] - order[b.status];
      });
  }, [products]);

  const filteredProducts = useMemo(() => {
    return enrichedProducts.filter((product) => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || product.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [enrichedProducts, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    return {
      critical: enrichedProducts.filter((item) => item.status === 'critical').length,
      soon: enrichedProducts.filter((item) => item.status === 'soon').length,
      expired: enrichedProducts.filter((item) => item.status === 'expired').length,
    };
  }, [enrichedProducts]);

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
      <main className="login-page">
        <div className="login-panel">
          <div className="brand-lockup">
            <div className="brand-mark">E</div>
            <div>
              <p className="mini-label">Expiry tracker</p>
              <h1>Team compliance</h1>
            </div>
          </div>

          <div className="login-card">
            <p>Enter the shared PIN to access the product list.</p>

            <form onSubmit={handleSignIn} className="stack">
              <label htmlFor="pin" className="field-label">
                PIN code
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                value={pinInput}
                onChange={(event) => setPinInput(event.target.value)}
                placeholder="Enter 4-digit PIN"
                autoComplete="off"
              />
              <button type="submit" className="primary-button login-button">
                Access dashboard
              </button>
            </form>

            {error ? <div className="error-box">{error}</div> : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="page-header">
        <div>
          <p className="mini-label">Dashboard</p>
          <h1>Product expiry overview</h1>
        </div>
        <button className="secondary-button" onClick={() => setSignedIn(false)}>
          Sign out
        </button>
      </div>

      {isFallback ? <div className="fallback-banner">Local browser mode active</div> : null}

      <section className="stats-grid">
        <div className="stat-card danger">
          <span className="stat-label">Expired</span>
          <strong>{stats.expired}</strong>
        </div>
        <div className="stat-card warning">
          <span className="stat-label">Critical</span>
          <strong>{stats.critical}</strong>
        </div>
        <div className="stat-card safe">
          <span className="stat-label">Soon</span>
          <strong>{stats.soon}</strong>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
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
                rows={4}
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

        <div className="panel">
          <div className="panel-header toolbar">
            <h2>Products</h2>
            <div className="toolbar-actions">
              <input
                aria-label="Search products"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search..."
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | AlertMode)}
              >
                <option value="all">All statuses</option>
                <option value="expired">Expired</option>
                <option value="critical">Critical</option>
                <option value="soon">Soon</option>
                <option value="normal">Healthy</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="muted">Loading products...</p>
          ) : filteredProducts.length === 0 ? (
            <div className="empty-state">
              <h3>No matching products</h3>
              <p>Try another search or add a new product.</p>
            </div>
          ) : (
            <div className="product-list">
              {filteredProducts.map((product) => {
                const meta = getAlertMeta(product.status);

                return (
                  <article key={product.id} className={`product-item ${meta.tone}`}>
                    <div className="product-main">
                      <div className="product-topline">
                        <strong>{product.name}</strong>
                        <span className={`badge ${meta.tone}`}>{meta.label}</span>
                      </div>

                      <div className="meta-row">
                        <span>{formatDate(product.expiry_date)}</span>
                        <span>
                          {product.daysLeft < 0
                            ? `${Math.abs(product.daysLeft)} day${Math.abs(product.daysLeft) === 1 ? '' : 's'} overdue`
                            : product.daysLeft === 0
                              ? 'Expires today'
                              : `In ${product.daysLeft} day${product.daysLeft === 1 ? '' : 's'}`}
                        </span>
                      </div>

                      {product.notes ? <p className="notes">{product.notes}</p> : null}
                    </div>

                    <div className="product-actions">
                      <button type="button" onClick={() => handleEdit(product)}>
                        Edit
                      </button>
                      <button type="button" className="danger" onClick={() => handleDelete(product.id)}>
                        Delete
                      </button>
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
