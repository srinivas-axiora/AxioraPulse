import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
// Target AWS Deployment Account: 847013096108
import PageLoader from "./pages/PageLoader";

// ── Loading context ───────────────────────────────────────────────
import { LoadingProvider, useLoading } from './context/LoadingContext';

// ── Layout & guards ──────────────────────────────────────────────
import DashboardLayout from './components/DashboardLayout';
import ProtectedRoute from './components/ProtectedRoute';

// ── Pages ────────────────────────────────────────────────────────
import LandingPage from './pages/Landing';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import Dashboard from './pages/Dashboard';
import SurveyList from './pages/SurveyList';
import SurveyCreate from './pages/SurveyCreate';
import SurveyEdit from './pages/SurveyEdit';
import SurveyAnalytics from './pages/SurveyAnalytics';
import SurveyRespond from './pages/SurveyRespond';
import EmbedView from './pages/EmbedView';
import TeamManagement from './pages/TeamManagement';
import Settings from './pages/Settings';
import ResetPassword from './pages/ResetPassword';
import UpdatePassword from './pages/UpdatePassword';
import AcceptInvite from './pages/AcceptInvite';
import ComingSoon from './pages/ComingSoon';
import Pricing from './pages/Pricing';
import Billing from './pages/Billing';
import PaymentWall from './components/PaymentWall';

import useAuthStore from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';

// Apply persisted theme before first render
const savedTheme = localStorage.getItem('np-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

/**
 * GlobalSpinner
 * Reads isLoading from context (derived from location.key during render —
 * no effect timing issues) and shows the full-page overlay when true.
 */
function GlobalSpinner() {
  const { isLoading } = useLoading();
  return isLoading ? <PageLoader /> : null;
}

function AppRoutes() {
  const { initialize, initialized, user } = useAuthStore();
  
  useEffect(() => {
    initialize();
  }, [initialize]);

  const isAuth = !!user;

  // Show nothing while initializing if a token exists
  if (!initialized && localStorage.getItem('token')) {
    return <PageLoader label="Resuming session…" />;
  }
 
  return (
    <>
      <GlobalSpinner />
      <PaymentWall />

      <Toaster
        position="bottom-right"
        gutter={10}
        containerStyle={{ bottom: 28, right: 28 }}
        toastOptions={{
          duration: 4000,
          style: {
            /* Warm cream canvas — editorial, not technical */
            fontFamily: 'Syne, sans-serif',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.07em',
            background: 'var(--warm-white, #FFFBF4)',
            color: '#160F08',
            borderRadius: 20,
            padding: '16px 20px 16px 18px',
            boxShadow: '0 2px 0 0 #FF4500, 0 8px 40px rgba(255,69,0,0.18), 0 2px 12px rgba(22,15,8,0.1)',
            border: '1px solid rgba(255,69,0,0.15)',
            maxWidth: 360,
            minWidth: 240,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          },
          success: {
            iconTheme: { primary: '#FF4500', secondary: '#FFFBF4' },
            style: {
              boxShadow: '0 2px 0 0 #FF4500, 0 8px 40px rgba(255,69,0,0.18), 0 2px 12px rgba(22,15,8,0.1)',
            },
          },
          error: {
            iconTheme: { primary: '#D63B1F', secondary: '#FFFBF4' },
            style: {
              boxShadow: '0 2px 0 0 #D63B1F, 0 8px 40px rgba(214,59,31,0.18), 0 2px 12px rgba(22,15,8,0.1)',
              border: '1px solid rgba(214,59,31,0.18)',
            },
          },
        }}
      />

      <Routes>
        {/* ── Public ── */}
        {/* <Route path="/" element={initialized && user ? <Navigate to="/dashboard" replace /> : <LandingPage />} /> */}
        <Route
          path="/"
          element={isAuth ? <Navigate to="/dashboard" replace /> : <LandingPage />}
        />
        <Route path="/coming-soon" element={<ComingSoon />} />
        <Route path="/login" element={isAuth ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/register" element={<Navigate to="/coming-soon" replace />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/update-password" element={<UpdatePassword />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/accept-invite/:token" element={<AcceptInvite />} />

        {/* ── Public survey response (no auth needed) ── */}
        <Route path="/s/:slug" element={<SurveyRespond />} />
        <Route path="/embed/:slug" element={<EmbedView />} />
        <Route path="/pricing" element={<Pricing />} />

        {/* ── Protected app (all children require auth) ── */}
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/surveys" element={<SurveyList />} />
            <Route path="/surveys/new" element={<SurveyCreate />} />
            <Route path="/surveys/:id/edit" element={<SurveyEdit />} />
            <Route path="/surveys/:id/analytics" element={<SurveyAnalytics />} />
            <Route path="/team" element={<TeamManagement />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/billing" element={<Billing />} />
          </Route>
        </Route>

        {/* ── Fallback ── */}
        <Route
          path="*"
          element={
            <Navigate
              to={isAuth ? "/dashboard" : "/"}
              replace
            />

          }
        />      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LoadingProvider>
        <AppRoutes />
      </LoadingProvider>
    </ErrorBoundary>
  );
}
