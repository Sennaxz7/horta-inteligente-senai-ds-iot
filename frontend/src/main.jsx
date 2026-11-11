import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, LayoutDashboard, Leaf, LogOut, Radio, Settings2, Sprout } from 'lucide-react';
import { SessionProvider, useSession } from './session';
import Auth from './Auth';
import Dashboard from './Dashboard';
import { Plants, PlantDetail } from './Plants';
import Profiles from './Profiles';
import { Devices, DeviceDetail } from './Devices';
import { Alert, Brand, Loading } from './ui';
import './styles.css';

function Protected() {
  const { token, usuario, loading, error, retrySession, logout } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!token) return <Navigate to="/login" replace state={{ next: location.pathname + location.search }} />;
  if (!usuario) return <main className="session-error"><Brand /><Alert error={error || 'Não foi possível validar sua sessão.'} onRetry={retrySession} /><button className="button secondary" onClick={logout}>Voltar ao login</button></main>;
  return <Outlet />;
}

const links = [
  ['/dashboard', LayoutDashboard, 'Dashboard'],
  ['/plantas', Sprout, 'Minhas plantas'],
  ['/perfis-irrigacao', Settings2, 'Perfis de irrigação'],
  ['/dispositivos', Radio, 'Dispositivos'],
];

function Layout() {
  const { usuario, logout } = useSession();
  return <div className="app-layout">
    <a href="#conteudo" className="skip-link">Ir para o conteúdo</a>
    <aside className="sidebar">
      <Link to="/dashboard" className="brand-link"><Brand /></Link>
      <p className="nav-label">ESPAÇO DE CULTIVO</p>
      <nav aria-label="Menu principal">{links.map(([to, Icon, title]) => <NavLink key={to} to={to}><Icon size={19} />{title}<span /></NavLink>)}</nav>
      <div className="sidebar-note"><Leaf size={25} strokeWidth={1.2} /><strong>Cada dado, um cuidado.</strong><p>Seu cultivo acompanhado de perto.</p></div>
      <div className="sidebar-bottom"><div className="avatar">{usuario.nome.charAt(0).toUpperCase()}</div><div><strong>{usuario.nome}</strong><small>Minha conta</small></div><button onClick={logout} aria-label="Sair da conta" title="Sair da conta"><LogOut size={18} /></button></div>
    </aside>
    <div className="app-content"><header className="topbar"><span><span className="status-dot" /> Meu espaço de cultivo</span><span className="topbar-project">HORTA INTELIGENTE <span> / </span> SENAI</span></header>
      <main id="conteudo"><Outlet /></main><footer className="app-footer"><span>Horta Inteligente · Projeto SENAI</span><span>Conhecer para cultivar.</span></footer>
    </div>
  </div>;
}

function NotFound() {
  const { token } = useSession();
  return <main className="not-found"><Brand /><div className="not-found-number">404<Leaf /></div><p className="eyebrow">Fora do canteiro</p><h1>Esta página não foi encontrada.</h1><p className="muted">O endereço pode ter mudado. Volte para continuar acompanhando sua horta.</p><Link className="button primary" to={token ? '/dashboard' : '/login'}><ArrowLeft size={17} />{token ? 'Ir para o dashboard' : 'Ir para o login'}</Link></main>;
}

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="session-error"><Brand /><h1>Não foi possível exibir esta página.</h1><p>Recarregue para tentar novamente.</p><button className="button primary" onClick={() => window.location.reload()}>Recarregar</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode><ErrorBoundary><BrowserRouter><SessionProvider><Routes>
    <Route path="/login" element={<Auth />} /><Route path="/cadastro" element={<Auth register />} />
    <Route element={<Protected />}><Route element={<Layout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/plantas" element={<Plants />} /><Route path="/plantas/:id" element={<PlantDetail />} />
      <Route path="/perfis-irrigacao" element={<Profiles />} />
      <Route path="/dispositivos" element={<Devices />} /><Route path="/dispositivos/:id" element={<DeviceDetail />} />
    </Route></Route>
    <Route path="*" element={<NotFound />} />
  </Routes></SessionProvider></BrowserRouter></ErrorBoundary></React.StrictMode>,
);
