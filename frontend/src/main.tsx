import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AppProvider, useApp } from './lib/app'
import { Layout } from './components/Layout'
import ChatPage from './pages/ChatPage'
import LinksPage from './pages/LinksPage'
import LinkDetailPage from './pages/LinkDetailPage'
import MoneyPage from './pages/MoneyPage'
import SettingsPage from './pages/SettingsPage'
import ProductsPage from './pages/ProductsPage'
import ProductDetailPage from './pages/ProductDetailPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import PayPage from './pages/PayPage'
import OnboardingPage from './pages/OnboardingPage'

function MerchantApp() {
  const { settings } = useApp()
  if (!settings.onboarded) return <OnboardingPage />
  return <Layout />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Public customer checkout */}
          <Route path="/p/:id" element={<PayPage />} />
          {/* Merchant app */}
          <Route element={<MerchantApp />}>
            <Route index element={<ChatPage />} />
            <Route path="links" element={<LinksPage />} />
            <Route path="links/:id" element={<LinkDetailPage />} />
            <Route path="money" element={<MoneyPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
)
