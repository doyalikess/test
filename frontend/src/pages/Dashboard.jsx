// frontend/src/components/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import API from '../api';

const Dashboard = () => {
  const [balance, setBalance] = useState(0);
  const [depositAmount, setDepositAmount] = useState('');
  const [currency, setCurrency] = useState('usdt');
  
  const fetchBalance = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await API.get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBalance(res.data.balance || 0);
    } catch (err) {
      console.error('Error fetching balance:', err);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  const handleDeposit = async () => {
    if (depositAmount <= 0) {
      alert('Please enter a valid deposit amount.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await API.post('/payment/deposit', { amount: depositAmount, currency }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      // Redirect user to the payment URL
      window.open(res.data.invoice_url, '_blank');

      // After payment, refresh the balance (e.g., wait 5 seconds for payment to be processed)
      setTimeout(fetchBalance, 5000);
    } catch (err) {
      console.error('Error processing deposit:', err);
      alert('Failed to create deposit');
    }
  };

  return (
    <div>
      <h2>Dashboard</h2>
      <p>Balance: ${balance}</p>
      
      <h3>Deposit Funds</h3>
      <input
        type="number"
        placeholder="Amount in USD"
        value={depositAmount}
        onChange={(e) => setDepositAmount(e.target.value)}
      />
      <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
        <option value="usdt">USDT</option>
        <option value="btc">BTC</option>
        <option value="eth">ETH</option>
      </select>
      <button onClick={handleDeposit}>Deposit</button>
    </div>
  );
};

export default Dashboard;
