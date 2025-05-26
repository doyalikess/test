// frontend/src/api.js
import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:5000/api',  // Replace with your backend URL
  timeout: 10000,
});

export default API;
