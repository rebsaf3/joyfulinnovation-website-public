const Stripe = require('stripe');

function createStripeClient(stripeApiKey) {
  const key = stripeApiKey || process.env.STRIPE_API_KEY;
  if (!key) throw new Error('STRIPE_API_KEY not set');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

async function createCheckoutSession({ db, companyId, interval = 'month', successUrl, cancelUrl }) {
  const keyRow = db ? db.prepare("SELECT value FROM settings WHERE key = ?").get("stripe_api_key") : null;
  const stripe = createStripeClient(keyRow?.value || null);
  const company = db.prepare('SELECT monthly_rate_cents, annual_rate_cents, currency FROM companies WHERE id = ?').get(companyId);
  if (!company) throw new Error('Company not found');

  const amount = interval === 'year' ? company.annual_rate_cents : company.monthly_rate_cents;
  if (!amount || amount <= 0) throw new Error('No rate configured for chosen interval');

  let sc = db.prepare('SELECT * FROM stripe_customers WHERE company_id = ?').get(companyId);
  let stripeCustomerId = sc ? sc.stripe_customer_id : null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({ metadata: { companyId } });
    stripeCustomerId = customer.id;
    const id = require('crypto').randomUUID();
    db.prepare('INSERT INTO stripe_customers (id, company_id, stripe_customer_id) VALUES (?, ?, ?)').run(id, companyId, stripeCustomerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: company.currency || 'usd',
        product_data: { name: companyId + ' subscription' },
        unit_amount: amount,
        recurring: { interval: interval === 'year' ? 'year' : 'month' },
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: { metadata: { companyId } },
  });

  return session;
}

module.exports = { createCheckoutSession };
