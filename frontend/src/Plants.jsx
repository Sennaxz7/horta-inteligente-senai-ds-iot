import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArrowRight, Camera, Droplet, History, Leaf, Plus, Search, Sprout } from 'lucide-react';
import { query } from './api';
import { useResource, useSession } from './session';
import { Alert, Back, Badge, date, day, Empty, Feedback, form, Header, label, Loading, number, Pagination, Panel, percent, PhaseSelect, PlantMark, Resource, useAction } from './ui';

export function SpeciesPicker({ value, existing, required = false, allowCreate = false }) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState(value || '');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(null);
  const { request } = useSession();
  const resource = useResource(query('/especies', { busca: search.trim(), limite: 100 }));
  const action = useAction(({ data }) => {
    setAdded(data.especie); setChosen(data.especie.id); setAdding(false); setSearch(''); resource.refresh();
  });
  const choices = [...new Map([existing, added, ...(resource.data?.data || [])].filter(Boolean).map(item => [item.id, item])).values()];
  if (chosen && !choices.some(item => item.id === chosen)) choices.unshift({ id: chosen, nomeCientifico: 'Espécie selecionada' });
  return <div className="species-picker">
    <label>Buscar no catálogo<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome comum ou científico" /></label>
    <label>Espécie<select name="especieId" value={chosen} onChange={event => setChosen(event.target.value)} required={required}>
      <option value="">{required ? 'Selecione uma espécie' : 'Sem identificação'}</option>
      {choices.map(item => <option key={item.id} value={item.id}>{item.nomeComum ? item.nomeComum + ' · ' : ''}{item.nomeCientifico}</option>)}
    </select></label>
    <Alert error={resource.error} onRetry={resource.refresh} />
    {allowCreate && <button type="button" className="button secondary small" onClick={() => setAdding(!adding)}>{adding ? 'Cancelar nova espécie' : 'Cadastrar espécie no catálogo'}</button>}
    {adding && <div className="nested-form">
      <label>Nome científico<input value={search} maxLength={255} onChange={event => setSearch(event.target.value)} /></label>
      <button type="button" className="button secondary small" disabled={search.trim().length < 2 || action.busy} onClick={() => action.run(() => request('/especies', { method: 'POST', body: { nomeCientifico: search.trim() } }), 'Espécie cadastrada.')}>Salvar espécie</button>
    </div>}
    <Feedback action={action} />
  </div>;
}

function PlantFields({ plant }) {
  return <>
    <label>Nome da planta<input name="nome" defaultValue={plant?.nome} placeholder="Ex.: Manjericão da varanda" maxLength={120} required /></label>
    <div className="form-row"><label>Apelido <small>opcional</small><input name="apelido" defaultValue={plant?.apelido || ''} placeholder="Ex.: Vaso 1" maxLength={120} /></label>
      <label>Data de plantio<input name="dataPlantio" type="date" defaultValue={plant?.dataPlantio || ''} /></label></div>
    <label>Grupo de irrigação<select name="grupoIrrigacao" defaultValue={plant?.grupoIrrigacao || ''}>
      <option value="">Sem grupo</option><option value="HORTALICAS">Hortaliças</option>
    </select></label>
  </>;
}

export function Plants() {
  const navigate = useNavigate();
  const { request } = useSession();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ busca: '', fase: '', arquivadas: false });
  const [page, setPage] = useState(1);
  const resource = useResource(query('/plantas', { ...filters, pagina: page, limite: 12 }));
  const create = useAction(({ data }) => navigate('/plantas/' + data.planta.id));
  const newPlant = params.get('nova') === '1';
  return <>
    <Header eyebrow="Cultivo" title="Minhas plantas" action={<button className="button primary" onClick={() => setParams(newPlant ? {} : { nova: 1 })}><Plus size={18} /> Nova planta</button>}>Organize seus vasos, registre o crescimento e acompanhe cada planta.</Header>
    {newPlant && <Panel title="Cadastrar planta" icon={Sprout} action={<button className="button secondary small" onClick={() => setParams({})}>Fechar</button>}>
      <form className="form-stack panel-form" onSubmit={event => {
        event.preventDefault();
        const values = form(event);
        create.run(() => request('/plantas', { method: 'POST', body: {
          ...values, nome: values.nome.trim(), apelido: values.apelido.trim() || null, dataPlantio: values.dataPlantio || null,
          especieId: values.especieId || null, grupoIrrigacao: values.grupoIrrigacao || null,
        } }));
      }}><PlantFields /><label>Fase atual<PhaseSelect /></label><SpeciesPicker allowCreate />
        <Feedback action={create} /><button className="button primary fit" disabled={create.busy}>Salvar planta</button>
      </form>
    </Panel>}
    <form className="filters" onSubmit={event => { event.preventDefault(); const values = form(event); setPage(1); setFilters({ busca: values.busca.trim(), fase: values.fase, arquivadas: values.arquivadas === 'true' }); }}>
      <label>Buscar planta<input type="search" name="busca" placeholder="Nome ou apelido" maxLength={120} /></label>
      <label>Fase<PhaseSelect name="fase" allowAll /></label>
      <label>Situação<select name="arquivadas"><option value="false">Ativas</option><option value="true">Arquivadas</option></select></label>
      <button className="button secondary"><Search size={17} /> Filtrar</button>
    </form>
    <Resource resource={resource}>{({ data, meta }) => <>
      {data.length ? <div className="plant-grid">{data.map(plant => <Link key={plant.id} to={'/plantas/' + plant.id} className="plant-card"><div className="plant-card-top"><PlantMark /><Badge value={plant.faseAtual} /></div><h2>{plant.nome}</h2>
        <p>{plant.especie?.nomeCientifico || plant.apelido || 'Espécie não identificada'}{plant.grupoIrrigacao && ' · ' + label(plant.grupoIrrigacao)}</p><footer><span>{plant.dataPlantio ? 'Plantio: ' + day(plant.dataPlantio) : label(plant.statusIdentificacao)}</span><ArrowRight size={18} /></footer></Link>)}</div> : <Panel title="Plantas"><Empty title="Nenhuma planta encontrada">Cadastre uma planta ou altere os filtros para ampliar a busca.</Empty></Panel>}
      <Pagination meta={meta} page={page} setPage={setPage} />
    </>}</Resource>
  </>;
}

const tabs = { geral: 'Visão geral', fotos: 'Fotos e identificação', crescimento: 'Crescimento', irrigacao: 'Irrigação', historico: 'Histórico' };

export function PlantDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = Object.hasOwn(tabs, params.get('aba')) ? params.get('aba') : 'geral';
  const resource = useResource('/plantas/' + id);
  return <><Back to="/plantas">Minhas plantas</Back><Resource resource={resource}>{({ data: { planta } }) => <>
    <Header eyebrow="Cultivo / Planta" title={planta.nome} action={<Badge value={planta.faseAtual} />}>{planta.especie?.nomeCientifico || 'Espécie não identificada'}{planta.arquivadaEm ? ' · Planta arquivada' : ''}</Header>
    <nav className="tabs" aria-label="Detalhes da planta">{Object.entries(tabs).map(([key, title]) => <button key={key} className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => setParams({ aba: key })}>{title}</button>)}</nav>
    {tab === 'geral' && <PlantOverview key={id} plant={planta} refresh={resource.refresh} />}
    {tab === 'fotos' && <PlantPhotos key={id} plant={planta} refresh={resource.refresh} />}
    {tab === 'crescimento' && <Growth key={id} plant={planta} refresh={resource.refresh} />}
    {tab === 'irrigacao' && <PlantIrrigation key={id} plant={planta} />}
    {tab === 'historico' && <Timeline key={id} id={id} />}
  </>}</Resource></>;
}

function PlantOverview({ plant, refresh }) {
  const { request } = useSession();
  const action = useAction(refresh);
  const route = '/plantas/' + plant.id;
  return <div className="detail-grid">
    <Panel title="Dados da planta" icon={Leaf}>
      <form className="panel-form form-stack" onSubmit={event => {
        event.preventDefault();
        const values = form(event);
        action.run(() => request(route, { method: 'PATCH', body: {
          nome: values.nome.trim(), apelido: values.apelido.trim() || null, dataPlantio: values.dataPlantio || null,
          grupoIrrigacao: values.grupoIrrigacao || null,
        } }), 'Dados salvos.');
      }}><fieldset disabled={!!plant.arquivadaEm || action.busy}><PlantFields plant={plant} />{!plant.arquivadaEm && <button className="button primary fit">Salvar dados</button>}</fieldset></form>
      <div className="panel-form"><Feedback action={action} /></div>
    </Panel>
    <Panel title="Espécie e acompanhamento" icon={Sprout}>
      <div className="panel-form form-stack"><Badge value={plant.statusIdentificacao} />
        {!plant.arquivadaEm && <><form className="form-stack" onSubmit={event => {
          event.preventDefault(); const values = form(event);
          action.run(() => request(route + '/especie', { method: 'PUT', body: { especieId: values.especieId || null } }), 'Espécie atualizada.');
        }}><SpeciesPicker value={plant.especieId} existing={plant.especie} allowCreate /><button className="button secondary fit" disabled={action.busy}>Salvar espécie</button></form>
          <button className="button danger fit" disabled={action.busy} onClick={() => {
            if (window.confirm('Arquivar esta planta? Os registros serão preservados.')) action.run(() => request(route, { method: 'DELETE' }), 'Planta arquivada.');
          }}><Archive size={16} /> Arquivar planta</button></>}
      </div>
    </Panel>
  </div>;
}

function PrivatePhoto({ path }) {
  const { request } = useSession();
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl;
    request(path.replace(/^\/api\/v1/, ''), { blob: true, signal: controller.signal }).then(blob => {
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, request]);
  return url ? <img className="photo" src={url} alt="Foto registrada da planta" /> : <div className="photo-placeholder"><Camera size={24} /><span>{failed ? 'Foto indisponível' : 'Carregando foto…'}</span></div>;
}

function PlantPhotos({ plant, refresh }) {
  const { request } = useSession();
  const base = '/plantas/' + plant.id;
  const [photoPage, setPhotoPage] = useState(1);
  const [idPage, setIdPage] = useState(1);
  const photos = useResource(query(base + '/fotos', { pagina: photoPage, limite: 6 }));
  const attempts = useResource(query(base + '/identificacoes', { pagina: idPage, limite: 6 }));
  const action = useAction(() => { photos.refresh(); attempts.refresh(); });
  const confirmation = useAction(() => { attempts.refresh(); refresh(); });
  return <>
    <Panel title="Fotos da planta" icon={Camera}>
      <div className="panel-form"><Feedback action={action} />{!plant.arquivadaEm && <form className="inline-form" onSubmit={event => {
        event.preventDefault(); const element = event.currentTarget; const body = new FormData(element);
        action.run(() => request(base + '/fotos', { method: 'POST', body }), 'Foto salva.').then(result => { if (result) { element.reset(); setPhotoPage(1); } });
      }}><label>Enviar foto<input type="file" name="foto" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Categoria<select name="tipo"><option value="GERAL">Geral</option><option value="CRESCIMENTO">Crescimento</option><option value="IDENTIFICACAO">Identificação</option></select></label><button className="button primary" disabled={action.busy}>Enviar</button></form>}</div>
      <Resource resource={photos}>{({ data, meta }) => <>{data.length ? <div className="photo-grid">{data.map(photo => <article key={photo.id}><PrivatePhoto path={photo.arquivoUrl} /><small>{label(photo.tipo)} · {date(photo.capturadaEm)}</small>{!plant.arquivadaEm && <button className="button secondary small" disabled={action.busy} onClick={() => {
        if (window.confirm('Enviar esta foto ao serviço PlantNet para identificar a espécie?')) action.run(() => request(base + '/identificacoes', { method: 'POST', body: { fotoId: photo.id } }), 'Consulta à PlantNet concluída.').then(result => { if (result) setIdPage(1); });
      }}>Identificar espécie</button>}</article>)}</div> : <Empty title="Nenhuma foto" icon={Camera}>Envie uma foto para registrar a planta ou pedir identificação.</Empty>}<Pagination meta={meta} page={photoPage} setPage={setPhotoPage} /></>}</Resource>
    </Panel>
    <Panel title="Tentativas de identificação" icon={Leaf}><div className="panel-form"><Feedback action={confirmation} /></div>
      <Resource resource={attempts}>{({ data, meta }) => <>{data.length ? <ul className="records stacked">{data.map(item => <li key={item.id}><div className="row"><strong>{date(item.createdAt)}</strong><Badge value={item.status} /></div>
        {item.codigoErro && <small>{label(item.codigoErro)}</small>}
        {!item.candidatos?.length && item.status === 'CONCLUIDA' && <p>Nenhuma espécie sugerida.</p>}
        {item.candidatos?.map((candidate, index) => <div className="candidate" key={index}><div>{candidate.nomeComum || candidate.nomeCientifico}<small>{candidate.nomeCientifico} · {percent(candidate.confianca * 100)}</small></div>
          {item.status === 'CONCLUIDA' && !plant.arquivadaEm && <button className="button secondary small" disabled={confirmation.busy} onClick={() => confirmation.run(() => request(base + '/identificacoes/' + item.id + '/confirmacao', { method: 'POST', body: { candidatoIndice: index } }), 'Espécie confirmada.')}>Confirmar</button>}</div>)}</li>)}</ul> : <Empty title="Nenhuma tentativa registrada" />}
        <Pagination meta={meta} page={idPage} setPage={setIdPage} /></>}</Resource>
    </Panel>
  </>;
}

function Growth({ plant, refresh }) {
  const { request } = useSession();
  const [page, setPage] = useState(1);
  const path = '/plantas/' + plant.id + '/crescimento';
  const resource = useResource(query(path, { pagina: page }));
  const action = useAction(() => { resource.refresh(); refresh(); });
  return <Panel title="Crescimento" icon={Sprout}>
    {!plant.arquivadaEm && <form className="panel-form form-stack" onSubmit={event => {
      event.preventDefault(); const element = event.currentTarget; const values = form(event);
      action.run(() => request(path, { method: 'POST', body: { fase: values.fase, alturaCm: values.alturaCm ? Number(values.alturaCm) : null, observacao: values.observacao.trim() || null } }), 'Crescimento registrado.').then(result => { if (result) { element.reset(); setPage(1); } });
    }}><div className="form-row"><label>Fase<PhaseSelect name="fase" value={plant.faseAtual} /></label><label>Altura em cm<input type="number" name="alturaCm" step="any" min="0" max="10000" /></label></div>
      <label>Observação<textarea name="observacao" rows="3" maxLength={2000} /></label><Feedback action={action} /><button className="button primary fit" disabled={action.busy}>Registrar crescimento</button></form>}
    <Resource resource={resource}>{({ data, meta }) => <>{data.length ? <ul className="records">{data.map(item => <li key={item.id}><div><strong>{label(item.fase)}{item.alturaCm == null ? '' : ' · ' + number(item.alturaCm) + ' cm'}</strong><small>{date(item.registradoEm)}{item.observacao ? ' · ' + item.observacao : ''}</small></div></li>)}</ul> : <Empty title="Nenhum registro de crescimento" />}<Pagination meta={meta} page={page} setPage={setPage} /></>}</Resource>
  </Panel>;
}

function PlantIrrigation({ plant }) {
  const { request } = useSession();
  const [device, setDevice] = useState('');
  const path = '/plantas/' + plant.id;
  const binding = useResource(path + '/perfil-irrigacao');
  const profiles = useResource(plant.especieId && !plant.arquivadaEm ? query('/perfis-irrigacao', { plantaId: plant.id, statusValidacao: 'VALIDADO', limite: 100 }) : null);
  const devices = useResource(plant.arquivadaEm ? null : '/dispositivos?limite=100');
  const zones = useResource(device ? '/dispositivos/' + device + '/zonas?limite=100' : null);
  const profileAction = useAction(binding.refresh);
  const zoneAction = useAction(zones.refresh);
  return <div className="detail-grid">
    <Panel title="Perfil de irrigação" icon={Droplet}>
      <div className="panel-form form-stack">
        <Resource resource={binding}>{({ data }) => <>
          {data.perfilAplicado ? <div className="config-summary">
            <div className="row wrap"><strong>{data.perfilAplicado.nome}</strong><Badge value={data.origem} /></div>
            <p>Mínima {percent(data.perfilAplicado.umidadeMinima)} · Alvo {percent(data.perfilAplicado.umidadeAlvo)}</p>
            {data.perfilAplicado.escalaUmidade && <small>{label(data.perfilAplicado.escalaUmidade)} · </small>}
            <small>Versão {data.perfilAplicado.versao} · Aplicado ao dispositivo na próxima sincronização.</small>
          </div> : <p className="muted">Sem perfil aplicável. A zona fica em monitoramento.</p>}
          {data.necessitaRevisao && <Alert error={'Revise o perfil associado: ' + data.motivos.map(label).join(', ')} />}
        </>}</Resource>
        {!plant.especieId && !plant.arquivadaEm && <p className="muted">Confirme a espécie para associar um perfil manualmente.</p>}
        <Resource resource={profiles}>{({ data }) => data.length ? <form className="form-stack" onSubmit={event => {
          event.preventDefault(); const { perfilIrrigacaoId } = form(event);
          profileAction.run(() => request(path + '/perfil-irrigacao', { method: 'PUT', body: { perfilIrrigacaoId } }), 'Perfil associado.');
        }}><label>Perfil compatível<select name="perfilIrrigacaoId">{data.map(item => <option value={item.id} key={item.id}>{item.nome} · v{item.versao}</option>)}</select></label><button className="button primary fit" disabled={profileAction.busy}>Associar perfil</button></form> : <p className="muted">Nenhum perfil validado para esta espécie e fase.</p>}</Resource>
        {!plant.arquivadaEm && binding.data?.data.vinculo && <button className="button secondary fit" disabled={profileAction.busy} onClick={() => profileAction.run(() => request(path + '/perfil-irrigacao', { method: 'PUT', body: { perfilIrrigacaoId: null } }), 'Perfil desvinculado.')}>Desvincular perfil</button>}
        <Feedback action={profileAction} /><Link className="text-link" to="/perfis-irrigacao">Ver perfis de irrigação <ArrowRight size={15} /></Link>
      </div>
    </Panel>
    <Panel title="Zona de irrigação" icon={Droplet}>
      <div className="panel-form form-stack">
        <Resource resource={devices}>{({ data }) => <label>Dispositivo<select value={device} onChange={event => setDevice(event.target.value)}><option value="">Selecione um dispositivo</option>{data.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>}</Resource>
        <Resource resource={zones}>{({ data }) => <form className="form-stack" onSubmit={event => {
          event.preventDefault(); const { zonaId } = form(event);
          zoneAction.run(() => request(path + '/zona', { method: 'PUT', body: { dispositivoId: device, zonaId } }), 'Zona vinculada.');
        }}><label>Zona<select name="zonaId" required><option value="">Selecione uma zona</option>{data.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.plantaId && item.plantaId !== plant.id)}>{item.nome}{item.plantaId === plant.id ? ' · Vinculada' : item.plantaId ? ' · Ocupada' : ''}</option>)}</select></label><button className="button primary fit" disabled={zoneAction.busy}>Vincular zona</button></form>}</Resource>
        <button className="button secondary fit" disabled={zoneAction.busy} onClick={() => {
          if (window.confirm('Desvincular a zona desta planta?')) zoneAction.run(() => request(path + '/zona', { method: 'DELETE' }), 'Planta sem zona vinculada.');
        }}>Desvincular zona atual</button>
        <Feedback action={zoneAction} /><Link className="text-link" to={device ? '/dispositivos/' + device + '?aba=configuracao' : '/dispositivos'}>Ver dispositivos e sincronização <ArrowRight size={15} /></Link>
      </div>
    </Panel>
  </div>;
}

function Timeline({ id }) {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const resource = useResource(query('/plantas/' + id + '/historico', { tipo: type, pagina: page }), page === 1 ? 5000 : 0);
  return <Panel title="Linha do tempo" icon={History} action={<select aria-label="Tipo de evento" value={type} onChange={event => { setPage(1); setType(event.target.value); }}><option value="">Todos os registros</option>{['CRESCIMENTO','IDENTIFICACAO','LEITURA','IRRIGACAO'].map(key => <option key={key} value={key}>{label(key)}</option>)}</select>}>
    <Resource resource={resource}>{({ data, meta }) => <>{data.length ? <ul className="records timeline">{data.map(item => {
      const d = item.dados;
      const summary = item.tipo === 'CRESCIMENTO' ? [label(d.fase), d.alturaCm != null && number(d.alturaCm) + ' cm', d.observacao] :
        item.tipo === 'IDENTIFICACAO' ? [label(d.status)] : item.tipo === 'LEITURA' ? ['Solo: ' + percent(d.umidadeSoloPercentual), d.escalaUmidade && label(d.escalaUmidade), 'Reservatório: ' + percent(d.nivelAguaPercentual), d.simulado && 'Simulada'] :
        [label(d.resultado), d.duracaoSegundos != null && d.duracaoSegundos + ' s', d.simulado && 'Simulada', d.perfilNome, d.perfilVersao && 'Perfil v' + d.perfilVersao, d.motivoFalha];
      return <li key={item.tipo + item.id}><div><Badge value={item.tipo} /><p>{summary.filter(Boolean).join(' · ')}</p></div><small>{date(item.data)}</small></li>;
    })}</ul> : <Empty title="Nenhum registro neste filtro" icon={History} />}<Pagination meta={meta} page={page} setPage={setPage} /></>}</Resource>
  </Panel>;
}
