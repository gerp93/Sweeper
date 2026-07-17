import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ImportTransactions from './pages/ImportTransactions';
import Transactions from './pages/Transactions';
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
              <Route path="/" element={<Dashboard />} />
              <Route path="/import" element={<ImportTransactions />} />
              <Route path="/transactions" element={<Transactions />} />
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
