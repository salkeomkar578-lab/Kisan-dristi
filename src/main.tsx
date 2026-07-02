import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx'
import Login from './pages/Login';
import CattleList from './pages/Cattle';
import ScanPage from './pages/Scan';
import SyncTest from './pages/SyncTest';
import ProtectedRoute from './components/ProtectedRoute';
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><App /></ProtectedRoute>} />
        <Route path="/cattle" element={<ProtectedRoute><CattleList /></ProtectedRoute>} />
        <Route path="/scan" element={<ProtectedRoute><ScanPage /></ProtectedRoute>} />
        <Route path="/debug/sync-test" element={<ProtectedRoute><SyncTest /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
