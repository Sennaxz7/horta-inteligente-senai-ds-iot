import { useLocation, useNavigate, Link, Navigate } from 'react-router-dom';
import { ArrowRight, Leaf, Sprout, Droplet, Radio } from 'lucide-react';
import { api } from './api';
import { useSession } from './session';
import { Brand, Feedback, form, useAction } from './ui';

export default function Auth({ register = false }) {
  const { login, token } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const action = useAction(() => navigate(register ? '/login' : (location.state?.next || '/dashboard'), {
    replace: true, state: register ? { registered: true } : null,
  }));
  if (token) return <Navigate to="/dashboard" replace />;
  const submit = event => {
    event.preventDefault();
    const values = form(event);
    action.run(() => register ? api('/auth/register', { method: 'POST', body: values }) : login(values));
  };
  return <main className="auth-page">
    <section className="auth-story">
      <Brand />
      <div className="auth-copy"><div className="auth-kicker"><span /> DO CULTIVO AOS DADOS</div><h1>Cultive com<br />mais <em>clareza.</em></h1>
        <p>Acompanhe o crescimento das suas plantas e entenda o que acontece na sua horta, da primeira muda à última irrigação.</p>
        <div className="auth-features"><span><Sprout /> Plantas</span><span><Droplet /> Irrigação</span><span><Radio /> Sensores</span></div>
      </div>
      <div className="auth-art" aria-hidden="true"><Leaf strokeWidth={0.65} /><span /><span /><span /></div>
      <p className="auth-footer">HORTA INTELIGENTE <span>PROJETO ACADÊMICO · SENAI</span></p>
    </section>
    <section className="auth-form-area">
      <div className="auth-form">
        <p className="eyebrow">{register ? 'Comece seu cultivo' : 'Acesse sua horta'}</p>
        <h2>{register ? 'Crie sua conta' : 'Bem-vindo de volta'}</h2>
        <p className="muted">{register ? 'Cadastre-se para organizar e acompanhar suas plantas.' : 'Entre para acompanhar suas plantas e irrigações.'}</p>
        {!register && location.state?.registered && <p className="notice" role="status">Conta criada. Entre com seu e-mail e senha.</p>}
        <form onSubmit={submit} className="form-stack">
          {register && <label>Nome<input name="nome" autoComplete="name" placeholder="Seu nome" minLength={2} maxLength={120} required /></label>}
          <label>E-mail<input name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" maxLength={254} required /></label>
          <label>Senha<input name="senha" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : undefined} maxLength={72} placeholder={register ? 'Pelo menos 12 caracteres' : 'Sua senha'} required /></label>
          <Feedback action={action} />
          <button className="button primary" disabled={action.busy}>{action.busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar na minha horta'} <ArrowRight size={18} /></button>
        </form>
        <p className="auth-switch">{register ? 'Já tem conta?' : 'Primeira vez por aqui?'} <Link to={register ? '/login' : '/cadastro'}>{register ? 'Entrar' : 'Criar conta'}</Link></p>
      </div>
    </section>
  </main>;
}
