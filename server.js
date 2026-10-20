const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Ensure database and uploads directory exist
const db = require('./src/db');
try {
  const prodCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (prodCount === 0) {
    console.log('📦 Database empty, running seed...');
    const seed = require('./scripts/seed');
    seed();
  }
} catch (e) {
  console.error('Seed check warning:', e.message);
}

const productsRouter = require('./src/routes/products');
const categoriesRouter = require('./src/routes/categories');
const ordersRouter = require('./src/routes/orders');
const reviewsRouter = require('./src/routes/reviews');
const { router: authRouter } = require('./src/routes/auth');
const { router: customersRouter } = require('./src/routes/customers');
const promoRouter = require('./src/routes/promo');
const adminRouter = require('./src/routes/admin');
const paymentsRouter = require('./src/routes/payments');
const analyticsRouter = require('./src/routes/analytics');
const deliveryRouter = require('./src/routes/delivery');
const customRouter = require('./src/routes/custom');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static files
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Uploads
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/auth', authRouter);
app.use('/api/customers', customersRouter);
app.use('/api/promo', promoRouter);
app.use('/api/admin', adminRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/delivery', deliveryRouter);
app.use('/api/custom', customRouter);

// Clean URL routing for HTML pages
const cleanPages = [
  'catalogue',
  'rings',
  'earrings',
  'pendants',
  'bracelets',
  'collaborations',
  'mystery',
  'custom-sups',
  'sizer',
  'buyers',
  'cooperation',
  'privacy',
  'agreement',
  'offer',
  'consent',
  'leave-review',
  'account',
  'admin',
  'order-status',
  'test-payment'
];

cleanPages.forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    const filePath = path.join(publicDir, `${page}.html`);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).sendFile(path.join(publicDir, 'index.html'));
    }
  });
});

// Buyers alias routes for direct topic URLs
const buyerAliases = ['care', 'delivery', 'return', 'returns', 'warranty', 'faq', 'loyalty'];
buyerAliases.forEach(alias => {
  const targetTopic = alias === 'returns' ? 'return' : alias;
  app.get(`/${alias}`, (req, res) => {
    res.redirect(`/buyers?topic=${targetTopic}`);
  });
  app.get(`/buyers/${alias}`, (req, res) => {
    res.redirect(`/buyers?topic=${targetTopic}`);
  });
});

// Fallback to index.html for unknown routes (SPA-style support)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`💎 SUPS Jewelry Store Server running!`);
  console.log(`🚀 URL: http://localhost:${PORT}`);
  console.log(`⚙️  Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`👤 Personal Cabinet: http://localhost:${PORT}/account`);
  console.log(`=========================================`);
});
