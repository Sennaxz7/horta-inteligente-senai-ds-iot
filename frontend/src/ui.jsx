import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Leaf, LoaderCircle, Sprout } from 'lucide-react';

export const phases = { SEMENTE: 'Semente', GERMINACAO: 'Germinação', MUDA: 'Muda', VEGETATIVA: 'Vegetativa', ADULTA: 'Adulta' };
const labels = {
  NAO_IDENTIFICADA: 'Não identificada', IDENTIFICACAO_PENDENTE: 'Aguardando identificação', IDENTIFICADA: 'Identificada',
  CONFIRMADA: 'Confirmada', CONCLUIDA: 'Concluída', PENDENTE: 'Pendente', ENVIADA: 'Enviada', ERRO: 'Erro', FALHA: 'Falha',
  EM_ANDAMENTO: 'Em andamento', VALIDADO: 'Validado', RASCUNHO: 'Rascunho', REFERENCIA: 'Referência', PESSOAL: 'Pessoal',
  ONLINE: 'Online informado', OFFLINE: 'Offline informado', SEM_STATUS: 'Sem status', CRESCIMENTO: 'Crescimento',
  IDENTIFICACAO: 'Identificação', LEITURA: 'Leitura', IRRIGACAO: 'Irrigação', GERAL: 'Geral', MONITORAMENTO: 'Monitoramento',
  SIMULACAO_IRRIGACAO: 'Irrigação simulada',
  HORTALICAS: 'Hortaliças', PADRAO_GRUPO: 'Padrão do grupo', ASSOCIADO: 'Associado manualmente',
  GRAVIMETRICA_BANDEJA: 'Escala gravimétrica da bandeja', CAPACIDADE_RETENCAO: 'Capacidade de retenção do substrato',
  VOLUMETRICA: 'Umidade volumétrica',
  SEM_CALIBRACAO_RESERVATORIO: 'Zona sem calibração do reservatório',
  SEM_PLANTA_ATIVA: 'Zona sem planta ativa', SEM_PERFIL_VINCULADO: 'Planta sem perfil aplicável',
  PERFIL_REQUER_REVISAO: 'Perfil associado requer revisão',
};
export const label = value => phases[value] || labels[value] || value?.replaceAll('_', ' ') || '—';
export const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bahia' }).format(new Date(value)) : '—';
export const day = value => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';
export const number = value => value == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const percent = value => value == null ? '—' : percentFormat.format(value) + '%';
export const form = event => Object.fromEntries(new FormData(event.currentTarget));

export function Brand() {
  return <div className="brand"><img src="/horta.svg" width="39" height="39" alt="" /><span>Horta Inteligente<small>PROJETO SENAI</small></span></div>;
}
export function Header({ eyebrow, title, children, action }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children && <p className="muted subtitle">{children}</p>}</div>{action}</header>;
}
export function Badge({ value, tone }) {
  return <span className={'badge ' + (tone || (['ERRO', 'FALHA', 'OFFLINE'].includes(value) ? 'red' : ['PENDENTE', 'RASCUNHO', 'ENVIADA', 'EM_ANDAMENTO'].includes(value) ? 'amber' : 'sage'))}>{label(value)}</span>;
}
export function Empty({ title = 'Nada por aqui ainda', children, icon: Icon = Sprout }) {
  return <div className="empty"><span className="empty-icon"><Icon size={23} /></span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function Alert({ error, onRetry }) {
  return error && <div className="alert" role="alert"><AlertCircle size={18} /><span>{error.message || error}</span>{onRetry && <button className="button secondary small" onClick={onRetry}>Tentar novamente</button>}</div>;
}
export function Loading() {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={19} /> Carregando…</div>;
}
export function Resource({ resource, children }) {
  if (resource.loading && !resource.data) return <Loading />;
  if (resource.error) return <Alert error={resource.error} onRetry={resource.refresh} />;
  return resource.data ? children(resource.data) : null;
}
export function Pagination({ meta, page, setPage }) {
  if (!meta || (meta.totalPaginas < 2 && page === 1)) return null;
  return <div className="pagination"><button className="button secondary small" onClick={() => setPage(page - 1)} disabled={page <= 1}><ArrowLeft size={15} /> Anterior</button><span>Página {page} de {Math.max(1, meta.totalPaginas)}</span><button className="button secondary small" onClick={() => setPage(page + 1)} disabled={page >= meta.totalPaginas}>Próxima <ArrowRight size={15} /></button></div>;
}
export function Panel({ title, icon: Icon, action, children }) {
  return <section className="panel"><header className="panel-heading"><h2>{Icon && <Icon size={18} />} {title}</h2>{action}</header>{children}</section>;
}
export function PhaseSelect({ name = 'faseAtual', value, allowAll = false, onChange }) {
  return <select name={name} defaultValue={value || (allowAll ? '' : 'MUDA')} onChange={onChange}>{allowAll && <option value="">Todas as fases</option>}{Object.entries(phases).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>;
}
export function Back({ to, children }) {
  return <Link className="back" to={to}><ArrowLeft size={16} />{children}</Link>;
}
export function PlantMark() { return <span className="plant-mark"><Leaf size={24} /></span>; }
export function useAction(onSuccess) {
  const [state, setState] = useState({ busy: false, error: null, notice: '' });
  const run = async (action, notice) => {
    setState({ busy: true, error: null, notice: '' });
    try {
      const result = await action();
      setState({ busy: false, error: null, notice: notice || '' });
      onSuccess?.(result);
      return result;
    } catch (error) { setState({ busy: false, error, notice: '' }); }
  };
  return { ...state, run };
}
export function Feedback({ action }) {
  return <><Alert error={action.error} />{action.notice && <p role="status" className="notice">{action.notice}</p>}</>;
}
