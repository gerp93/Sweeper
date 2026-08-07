import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ImportTransactions from './pages/ImportTransactions';
import Transactions from './pages/Transactions';
import ReconciliationPage from './pages/Reconciliation';
import Accounts from './pages/Accounts';
import Settings from './pages/Settings';
import Layout from './components/Layout';
import { RightSidebarProvider } from './context/RightSidebarContext';
import { ThemeProvider } from './context/ThemeContext';
import './themes.css';

function App() {
  return (
    <ThemeProvider>
      <RightSidebarProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<Transactions />} />
              <Route path="/transactions" element={<Navigate to="/" replace />} />
              <Route path="/import" element={<ImportTransactions />} />
              <Route path="/reconcile" element={<ReconciliationPage />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Layout>
        </Router>
      </RightSidebarProvider>
    </ThemeProvider>
  );
}

export default App;
