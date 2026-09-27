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
import LandingPage from './pages/LandingPage'

/** First visit: the landing page explains the product, then onboarding. */
function MerchantApp() {
  const { settings } = useApp()
  if (!settings.onboarded) return <Navigate to="/welcome" replace />
  return <Layout />
}

function Onboarding() {
  const { settings } = useApp()
  if (settings.onboarded) return <Navigate to="/" replace />
  return <OnboardingPage />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Public customer checkout */}
          <Route path="/p/:id" element={<PayPage />} />
          {/* Public landing page + first-run setup */}
          <Route path="/welcome" element={<LandingPage />} />
          <Route path="/onboarding" element={<Onboarding />} />
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
