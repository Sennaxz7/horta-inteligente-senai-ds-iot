import { ArrowDownRight, ArrowRight, Droplet, Gauge, Leaf, Plus, Radio, RefreshCw, Sprout } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResource, useSession } from './session';
import { Badge, date, Empty, Header, label, Panel, percent, Resource } from './ui';

function Metric({ title, value, detail, icon: Icon, tone }) {
  return <article className="metric"><span className={'metric-icon ' + tone}><Icon size={20} /></span><p>{title}</p><strong>{value}</strong><small>{detail}</small></article>;
}

export default function Dashboard() {
  const { usuario } = useSession();
  const resource = useResource('/dashboard?limite=8');
  return <>
    <Header eyebrow="Visão geral" title="Dashboard" action={<button className="button secondary" onClick={resource.refresh} disabled={resource.loading}><RefreshCw size={16} /> Atualizar</button>}>Acompanhe suas plantas, leituras e irrigações em um só lugar.</Header>
    <section className="garden-banner">
      <div><p className="eyebrow"><span className="status-dot" /> SUA HORTA</p><h2>Olá, {usuario?.nome?.trim().split(/\s+/)[0] || 'cultivador'}.</h2><p>Veja como suas plantas estão e registre o próximo passo do cultivo.</p>
        <Link className="button banner-button" to="/plantas?nova=1"><Plus size={17} /> Cadastrar planta</Link></div>
      <div className="banner-art" aria-hidden="true"><Sprout strokeWidth={0.85} /><span /><span /><span /></div>
    </section>
    <Resource resource={resource}>{({ data }) => <>
      <section className="metric-grid" aria-label="Resumo da horta">
        <Metric title="Plantas ativas" value={data.plantas.ativas} detail={data.plantas.arquivadas + ' arquivadas'} icon={Sprout} tone="sage" />
        <Metric title="Espécies confirmadas" value={data.plantas.ativasIdentificadas} detail="Plantas ativas identificadas" icon={Leaf} tone="sage" />
        <Metric title="Dispositivos" value={data.dispositivos.total} detail={data.dispositivos.online + ' com último status online'} icon={Radio} tone="blue" />
        <Metric title="Irrigações recentes" value={data.irrigacoesRecentes.length} detail="Registros exibidos nesta consulta" icon={Droplet} tone="amber" />
      </section>
      <div className="dashboard-grid">
        <Panel title="Últimas leituras" icon={Gauge} action={<Link className="text-link" to="/plantas">Ver plantas <ArrowRight size={15} /></Link>}>
          {data.ultimasLeituras.length ? <div className="table-wrap"><table><thead><tr><th>Planta</th><th>Umidade</th><th>Reservatório</th><th>Medição</th></tr></thead><tbody>
            {data.ultimasLeituras.map(row => <tr key={row.id}><td><Link to={'/plantas/' + row.plantaId}>{row.plantaNome}</Link>{row.simulado && <small>Simulado</small>}</td><td>{percent(row.umidadeSoloPercentual)}</td><td>{percent(row.nivelAguaPercentual)}</td><td>{date(row.medidoEm)}</td></tr>)}
          </tbody></table></div> : <Empty title="Nenhuma leitura recebida" icon={Gauge}>Vincule uma planta a uma zona para acompanhar as medições.</Empty>}
        </Panel>
        <Panel title="Plantas por fase" icon={Sprout}>
          {data.plantas.ativas ? <div className="phase-bars">{Object.entries(data.plantas.ativasPorFase).map(([phase, count]) => <div key={phase}><p><span>{label(phase)}</span><strong>{count}</strong></p><progress value={count} max={data.plantas.ativas} aria-label={label(phase)} /></div>)}</div> : <Empty title="Sem plantas ativas">O resumo será preenchido quando você cadastrar uma planta.</Empty>}
        </Panel>
        <Panel title="Irrigações recentes" icon={Droplet}>
          {data.irrigacoesRecentes.length ? <ul className="records">{data.irrigacoesRecentes.map(row => <li key={row.id}><div><Link to={'/plantas/' + row.plantaId + '?aba=historico'}>{row.plantaNome}</Link><small>{date(row.data)}{row.simulado ? ' · Simulada' : ''}{row.perfilVersao ? ' · Perfil v' + row.perfilVersao : ''}</small></div><Badge value={row.resultado} /></li>)}</ul> : <Empty title="Nenhuma irrigação registrada" icon={Droplet}>As execuções reportadas pelo dispositivo ou simulador aparecem aqui.</Empty>}
        </Panel>
        <Panel title="Dispositivos" icon={Radio} action={<Link className="text-link" to="/dispositivos">Gerenciar <ArrowRight size={15} /></Link>}>
          {data.dispositivos.itens.length ? <ul className="records">{data.dispositivos.itens.map(row => <li key={row.id}><div><Link to={'/dispositivos/' + row.id}>{row.nome}</Link><small>Última mensagem: {date(row.ultimaMensagemEm)}</small></div><Badge value={row.estado} /></li>)}</ul> : <Empty title="Sem dispositivos cadastrados" icon={Radio}>Cadastre um simulador ou dispositivo para acompanhar suas zonas.</Empty>}
        </Panel>
      </div>
    </>}</Resource>
  </>;
}
