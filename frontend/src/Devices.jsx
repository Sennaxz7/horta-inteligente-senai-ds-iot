import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, History, Plus, Radio, RefreshCw, Settings2 } from 'lucide-react';
import { query } from './api';
import { useResource, useSession } from './session';
import { Alert, Back, Badge, date, Empty, Feedback, form, Header, label, Pagination, Panel, percent, Resource, useAction } from './ui';

export function Devices() {
  const { request } = useSession();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const resource = useResource(query('/dispositivos', { pagina: page, limite: 12 }));
  const action = useAction(({ data }) => navigate('/dispositivos/' + data.id));
  return <>
    <Header eyebrow="Monitoramento" title="Dispositivos" action={<button className="button primary" onClick={() => setAdding(!adding)}><Plus size={18} /> Novo dispositivo</button>}>Acompanhe o último status informado e organize as zonas da horta.</Header>
    {adding && <Panel title="Cadastrar dispositivo" icon={Radio}><form className="panel-form form-stack" onSubmit={event => {
      event.preventDefault(); const values = form(event);
      action.run(() => request('/dispositivos', { method: 'POST', body: { nome: values.nome.trim(), simulado: values.simulado === 'true' } }));
    }}><label>Nome<input name="nome" maxLength={120} required placeholder="Ex.: Simulador da bancada" /></label><label>Tipo<select name="simulado"><option value="true">Simulador</option><option value="false">Dispositivo físico</option></select></label><Feedback action={action} /><button className="button primary fit" disabled={action.busy}>Cadastrar dispositivo</button></form></Panel>}
    <Resource resource={resource}>{({ data, meta, mqtt }) => <>
      {mqtt && <p className="notice"><Radio size={17} /> MQTT da API: {mqtt.conectado ? 'conectado' : mqtt.habilitado ? 'desconectado' : 'desabilitado'}</p>}
      {data.length ? <div className="plant-grid">{data.map(device => <Link className="plant-card" key={device.id} to={'/dispositivos/' + device.id}><div className="plant-card-top"><span className="plant-mark"><Radio size={23} /></span><Badge value={device.ultimoStatus?.estado || 'SEM_STATUS'} /></div><h2>{device.nome}</h2><p>{device.simulado ? 'Simulador' : 'Dispositivo físico'}</p><footer><span>Última mensagem: {date(device.ultimaMensagemEm)}</span><ArrowRight size={18} /></footer></Link>)}</div> : <Panel title="Dispositivos"><Empty title="Nenhum dispositivo cadastrado" icon={Radio}>Adicione um simulador para testar o fluxo de irrigação.</Empty></Panel>}
      <Pagination meta={meta} page={page} setPage={setPage} />
    </>}</Resource>
  </>;
}

const tabs = { geral: 'Visão geral', zonas: 'Zonas', configuracao: 'Configuração', eventos: 'Eventos' };

export function DeviceDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = Object.hasOwn(tabs, params.get('aba')) ? params.get('aba') : 'geral';
  const device = useResource('/dispositivos/' + id);
  return <><Back to="/dispositivos">Dispositivos</Back><Resource resource={device}>{({ data }) => <>
    <Header eyebrow="Monitoramento / Dispositivo" title={data.nome} action={<Badge value={data.ultimoStatus?.estado || 'SEM_STATUS'} />}>{data.simulado ? 'Dispositivo simulado' : 'Dispositivo físico'} · Última mensagem: {date(data.ultimaMensagemEm)}</Header>
    <nav className="tabs" aria-label="Detalhes do dispositivo">{Object.entries(tabs).map(([key, title]) => <button key={key} className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => setParams({ aba: key })}>{title}</button>)}</nav>
    {tab === 'geral' && <DeviceOverview key={id} device={data} refresh={device.refresh} />}
    {tab === 'zonas' && <Zones key={id} id={id} />}
    {tab === 'configuracao' && <Configuration key={id} device={data} />}
    {tab === 'eventos' && <DeviceHistory key={id} id={id} />}
  </>}</Resource></>;
}

function DeviceOverview({ device, refresh }) {
  const { request } = useSession();
  const navigate = useNavigate();
  const path = '/dispositivos/' + device.id;
  const action = useAction(refresh);
  return <div className="detail-grid"><Panel title="Dados do dispositivo" icon={Radio}>
    <form className="panel-form form-stack" onSubmit={event => {
      event.preventDefault(); const { nome } = form(event);
      action.run(() => request(path, { method: 'PATCH', body: { nome: nome.trim() } }), 'Nome atualizado.');
    }}><label>Nome<input name="nome" defaultValue={device.nome} maxLength={120} required /></label><Feedback action={action} /><button className="button primary fit" disabled={action.busy}>Salvar nome</button><button className="button danger fit" type="button" disabled={action.busy} onClick={() => {
      if (window.confirm('Arquivar este dispositivo?')) action.run(async () => { await request(path, { method: 'DELETE' }); navigate('/dispositivos'); });
    }}>Arquivar dispositivo</button></form>
  </Panel><Panel title="Último status informado"><div className="panel-form form-stack"><Badge value={device.ultimoStatus?.estado || 'SEM_STATUS'} /><p className="muted">Este status vem do último evento recebido por MQTT.</p><small>Recebido em: {date(device.ultimoStatus?.recebidoEm)}</small><button className="button secondary fit" onClick={refresh}><RefreshCw size={16} /> Atualizar status</button></div></Panel></div>;
}

function Zones({ id }) {
  const path = '/dispositivos/' + id + '/zonas';
  const { request } = useSession();
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);
  const resource = useResource(query(path, { pagina: page, limite: 12 }));
  const action = useAction(() => { setEditing(null); resource.refresh(); });
  const zone = editing?.new ? null : editing;
  return <>
    <Panel title="Zonas de irrigação" icon={Settings2} action={<button className="button primary small" onClick={() => setEditing({ new: true })}><Plus size={16} /> Nova zona</button>}>
      <Resource resource={resource}>{({ data, meta }) => <>{data.length ? <ul className="records">{data.map(item => <li key={item.id}><div><strong>{item.nome}</strong><small>{item.calibracao ? 'Vazio: ' + item.calibracao.distanciaVazioCm + ' cm · Cheio: ' + item.calibracao.distanciaCheioCm + ' cm' : 'Sem calibração'}</small>{item.plantaId ? <Link className="text-link" to={'/plantas/' + item.plantaId}>Ver planta vinculada</Link> : <small>Sem planta vinculada</small>}</div><button className="button secondary small" onClick={() => setEditing(item)}>Editar zona</button></li>)}</ul> : <Empty title="Nenhuma zona cadastrada" />}<Pagination meta={meta} page={page} setPage={setPage} /></>}</Resource>
    </Panel>
    <Feedback action={action} />
    {editing && <Panel title={zone ? 'Editar zona' : 'Criar zona'} action={<button className="button secondary small" onClick={() => setEditing(null)}>Fechar</button>}>
      <form key={zone?.id || 'nova'} className="panel-form form-stack" onSubmit={event => {
        event.preventDefault(); const values = form(event);
        const calibracao = values.vazio || values.cheio ? { distanciaVazioCm: Number(values.vazio), distanciaCheioCm: Number(values.cheio) } : null;
        action.run(() => request(path + (zone ? '/' + zone.id : ''), { method: zone ? 'PATCH' : 'POST', body: { nome: values.nome.trim(), calibracao } }), 'Zona salva.');
      }}><label>Nome<input name="nome" defaultValue={zone?.nome || ''} maxLength={120} required /></label>
        <div className="form-row"><label>Distância com reservatório vazio (cm)<input type="number" step="any" name="vazio" min="0.001" max="10000" defaultValue={zone?.calibracao?.distanciaVazioCm} /></label><label>Distância com reservatório cheio (cm)<input type="number" step="any" name="cheio" min="0.001" max="10000" defaultValue={zone?.calibracao?.distanciaCheioCm} /></label></div>
        <p className="muted">Preencha as duas distâncias para calibrar. Para vincular uma planta, use a aba Irrigação na página da planta.</p>
        <button className="button primary fit" disabled={action.busy}>Salvar zona</button></form>
    </Panel>}
  </>;
}

function Configuration({ device }) {
  const { request } = useSession();
  const [selected, setSelected] = useState('');
  const zones = useResource('/dispositivos/' + device.id + '/zonas?limite=100');
  const zone = zones.data?.data.find(item => item.id === selected);
  const root = zone ? '/dispositivos/' + device.id + '/zonas/' + zone.id : null;
  const config = useResource(root && root + '/configuracao');
  const action = useAction(config.refresh);
  const pending = ['ENVIADA', 'PENDENTE'].includes(config.data?.data?.status);
  const refresh = config.refresh;
  useEffect(() => {
    if (!pending || !root) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [pending, root, refresh]);
  return <Panel title="Sincronização da zona" icon={Settings2}>
    <div className="panel-form form-stack">
      <Resource resource={zones}>{({ data }) => data.length ? <label>Zona<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Selecione uma zona</option>{data.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label> : <Empty title="Nenhuma zona cadastrada">Crie uma zona antes de sincronizar.</Empty>}</Resource>
      {zone && <><form key={zone.id} className="inline-form" onSubmit={event => {
        event.preventDefault(); const values = form(event);
        action.run(() => request(root + '/sincronizacao', { method: 'POST', body: {
          intervaloLeituraSegundos: Number(values.intervalo), automacaoHabilitada: false,
          calibracaoReservatorio: zone.calibracao ?? null, modo: values.modo,
        } }), 'Solicitação enviada. Acompanhe a confirmação abaixo.');
      }}><label>Modo<select name="modo"><option value="MONITORAMENTO">Monitoramento</option>{device.simulado && <option value="SIMULACAO_IRRIGACAO">Irrigação simulada</option>}</select></label>
        <label>Intervalo das leituras (s)<input name="intervalo" type="number" min="2" max="86400" defaultValue="5" required /></label><button className="button primary" disabled={action.busy}>Sincronizar</button></form>
        <Feedback action={action} /><Resource resource={config}>{({ data }) => data ? <div className="config-summary"><div className="row wrap"><strong>Última configuração</strong><Badge value={data.status} /></div><p>{label(data.dados?.modo || 'MONITORAMENTO')}{data.dados?.irrigacao ? ' · ' + (data.dados.irrigacao.perfilNome || 'Perfil') + ' v' + data.dados.irrigacao.perfilVersao : ''}</p>
          {data.dados?.irrigacao && <p>Mínima {percent(data.dados.irrigacao.umidadeMinima)} · Alvo {percent(data.dados.irrigacao.umidadeAlvo)}{data.dados.irrigacao.escalaUmidade && ' · ' + label(data.dados.irrigacao.escalaUmidade)}</p>}
          {data.dados?.motivoMonitoramento && <Alert error={label(data.dados.motivoMonitoramento)} />}
          <small>Enviada: {date(data.createdAt)} · Confirmada: {date(data.confirmadaEm)}</small></div> : <Empty title="Nenhuma configuração enviada" />}</Resource>
        <button className="button secondary fit" onClick={config.refresh}><RefreshCw size={16} /> Atualizar confirmação</button>
        <p className="muted">A irrigação simulada só está disponível para dispositivos simulados. A configuração não aciona uma bomba.</p></>}
    </div>
  </Panel>;
}

function DeviceHistory({ id }) {
  const [type, setType] = useState('eventos');
  const [page, setPage] = useState(1);
  const resource = useResource(query('/dispositivos/' + id + '/' + type, { pagina: page }));
  return <Panel title="Histórico do dispositivo" icon={History} action={<select aria-label="Tipo de histórico" value={type} onChange={event => { setPage(1); setType(event.target.value); }}><option value="eventos">Eventos</option><option value="leituras">Leituras</option><option value="status">Status</option></select>}>
    <Resource resource={resource}>{({ data, meta }) => <>{data.length ? <ul className="records">{data.map(item => <li key={item.id}><div><strong>{type === 'leituras' ? 'Solo: ' + percent(item.dados.umidadeSoloPercentual) + ' · Reservatório: ' + percent(item.dados.nivelAguaPercentual) : label(item.dados.tipo || item.dados.estado)}</strong><small>{date(item.medidoEm)}{item.dados.simulado ? ' · Simulado' : ''}</small></div></li>)}</ul> : <Empty title="Nenhum registro encontrado" />}<Pagination meta={meta} page={page} setPage={setPage} /></>}</Resource>
  </Panel>;
}
