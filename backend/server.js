require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// CORS setup for local frontend and deployed frontend
app.use(cors({
  origin: ['http://localhost:3000', 'https://dgenrand0.vercel.app'], // Allow both local and deployed frontends
  credentials: true
}));

// Middleware to parse JSON and capture raw body for webhooks
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};
app.use(express.json({ verify: rawBodySaver }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  balance: { type: Number, default: 0 },
});

UserSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 10);
};

UserSchema.methods.validatePassword = async function (password) {
  return await bcrypt.compare(password, this.passwordHash);
};

const User = mongoose.model('User', UserSchema);

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authorization header missing' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Routes

app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    let user = await User.findOne({ username });
    if (user) return res.status(400).json({ error: 'Username already taken' });

    user = new User({ username });
    await user.setPassword(password);
    await user.save();

    res.json({ message: 'User created' });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await user.validatePassword(password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, balance: user.balance, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-passwordHash -__v');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      username: user.username,
      balance: user.balance,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/payment/deposit', authMiddleware, async (req, res) => {
  const { amount, currency } = req.body;

  if (!amount || !currency) {
    return res.status(400).json({ error: 'Amount and currency are required' });
  }

  try {
    const order_id = `order_${Date.now()}_${req.userId}`;

    const response = await axios.post(
      'https://api.nowpayments.io/v1/invoice',
      {
        price_amount: amount,
        price_currency: currency.toUpperCase(),
        pay_currency: currency.toUpperCase(),
        order_id: order_id,
        order_description: 'Deposit',
      },
      {
        headers: {
          'x-api-key': process.env.NOWPAYMENTS_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(200).json({
      invoice_url: response.data.invoice_url,
      invoice_id: response.data.id,
    });
  } catch (error) {
    console.error('NOWPAYMENTS error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create invoice with NOWPAYMENTS' });
  }
});

app.post('/api/nowpayments-webhook', async (req, res) => {
  console.log('Received raw body:', req.rawBody);

  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  const signature = req.headers['x-nowpayments-signature'];
  const bodyString = req.rawBody;

  const hash = crypto.createHmac('sha256', ipnSecret).update(bodyString).digest('hex');
  if (signature !== hash) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const data = req.body;
  const { payment_status, order_id, price_amount } = data;

  if (payment_status === 'confirmed' || payment_status === 'finished') {
    try {
      const parts = order_id.split('_');
      const userId = parts.slice(2).join('_');

      if (!userId) {
        return res.status(400).json({ error: 'UserId not found in order_id' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.balance += price_amount;
      await user.save();

      return res.json({ message: 'Balance updated' });
    } catch (err) {
      console.error('Webhook processing error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  res.json({ message: 'Payment status not confirmed, no action taken' });
});

app.post('/api/user/add-balance', authMiddleware, async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance += amount;
    await user.save();

    res.json({ message: 'Balance updated successfully', balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/game/coinflip', authMiddleware, async (req, res) => {
  const { amount, choice } = req.body;
  if (!amount || amount <= 0 || !['heads', 'tails'].includes(choice)) {
    return res.status(400).json({ error: 'Invalid bet' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    const serverSeed = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    const outcome = parseInt(hash.slice(0, 8), 16) % 100 < 47.5 ? 'heads' : 'tails';
    const win = outcome === choice;

    const houseEdge = 0.05;
    const payoutMultiplier = (1 - houseEdge) * 2;

    if (win) {
      user.balance += amount * (payoutMultiplier - 1);
    } else {
      user.balance -= amount;
    }

    await user.save();

    res.json({
      outcome,
      win,
      newBalance: user.balance,
      serverSeed,
      hash
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
