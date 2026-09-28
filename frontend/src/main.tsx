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
import AuthPage from './pages/AuthPage'
import AdminPage from './pages/AdminPage'
import { Spinner } from './components/ui'
import LandingPage from './pages/LandingPage'

function Loading() {
  return (
    <div className="flex h-[100dvh] items-center justify-center">
      <Spinner className="h-10 w-10" />
    </div>
  )
}

/** Seller app: logged-out visitors see the landing page first. */
function MerchantApp() {
  const { me } = useApp()
  if (me === undefined) return <Loading />
  if (!me) return <Navigate to="/welcome" replace />
  return <Layout />
}

/** Sign up / log in are only for logged-out visitors. */
function Guest({ mode }: { mode: 'signup' | 'login' }) {
  const { me } = useApp()
  if (me === undefined) return <Loading />
  if (me) return <Navigate to="/" replace />
  return <AuthPage mode={mode} />
}

/** Platform owner only (email in ADMIN_EMAILS on the server). */
function Admin() {
  const { me } = useApp()
  if (me === undefined) return <Loading />
  if (!me) return <Navigate to="/login" replace />
  if (!me.is_admin) return <Navigate to="/" replace />
  return <AdminPage />
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
          <Route path="/signup" element={<Guest mode="signup" />} />
          <Route path="/login" element={<Guest mode="login" />} />
          <Route path="/onboarding" element={<Navigate to="/signup" replace />} />
          <Route path="/admin/*" element={<Admin />} />
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
