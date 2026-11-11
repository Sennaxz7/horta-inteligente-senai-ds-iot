import { useState } from 'react';
import { Copy, Droplet, Plus } from 'lucide-react';
import { query } from './api';
import { useResource, useSession } from './session';
import { SpeciesPicker } from './Plants';
import { Badge, Empty, Feedback, form, Header, Pagination, Panel, percent, PhaseSelect, Resource, useAction } from './ui';

const numeric = [
  ['umidadeMinima', 'Umidade mínima (%)', 0, 100, 'any'],
  ['umidadeAlvo', 'Umidade alvo (%)', 0, 100, 'any'],
  ['duracaoMaximaSegundos', 'Duração máxima (s)', 1, 86400, 1],
  ['intervaloMinimoSegundos', 'Intervalo mínimo (s)', 1, 2147483647, 1],
];

function ProfileForm({ profile, onClose, onSave }) {
  const { request } = useSession();
  const action = useAction(onSave);
  return <Panel title={profile ? 'Editar perfil' : 'Novo perfil'} icon={Droplet} action={<button className="button secondary small" onClick={onClose}>Fechar</button>}>
    <form className="form-stack panel-form" onSubmit={event => {
      event.preventDefault();
      const body = form(event);
      numeric.forEach(([key]) => { body[key] = Number(body[key]); });
      body.observacao = body.observacao.trim() || null;
      action.run(() => request('/perfis-irrigacao' + (profile ? '/' + profile.id : ''), { method: profile ? 'PATCH' : 'POST', body }));
    }}>
      <label>Nome do perfil<input name="nome" defaultValue={profile?.nome || ''} maxLength={120} required /></label>
      <SpeciesPicker value={profile?.especieId} required allowCreate />
      <label>Fase<PhaseSelect name="fase" value={profile?.fase} /></label>
      <div className="form-row">{numeric.map(([key, title, min, max, step]) => <label key={key}>{title}<input name={key} type="number" min={min} max={max} step={step} defaultValue={profile?.[key]} required /></label>)}</div>
      <label>Fonte<textarea name="fonte" defaultValue={profile?.fonte || ''} rows="2" maxLength={4000} required /></label>
      <label>Observação<textarea name="observacao" defaultValue={profile?.observacao || ''} rows="2" maxLength={4000} /></label>
      <Feedback action={action} /><button className="button primary fit" disabled={action.busy}>Salvar perfil</button>
    </form>
  </Panel>;
}

export default function Profiles() {
  const { request } = useSession();
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const resource = useResource(query('/perfis-irrigacao', { tipo: filter, arquivados: archived, pagina: page, limite: 12 }));
  const action = useAction(resource.refresh);
  return <>
    <Header eyebrow="Irrigação" title="Perfis de irrigação" action={<button className="button primary" onClick={() => setEdit({ new: true })}><Plus size={18} /> Novo perfil</button>}>Organize referências e parâmetros por espécie e fase de crescimento.</Header>
    {edit && <ProfileForm key={edit.id || 'new'} profile={edit.new ? null : edit} onClose={() => setEdit(null)} onSave={() => { setEdit(null); setFilter('PESSOAL'); setArchived(false); setPage(1); resource.refresh(); }} />}
    <div className="filters"><label>Tipo<select value={filter} onChange={event => { setPage(1); setFilter(event.target.value); }}><option value="">Todos</option><option value="PESSOAL">Pessoais</option><option value="REFERENCIA">Referências</option></select></label><label>Situação<select value={String(archived)} onChange={event => { setPage(1); setArchived(event.target.value === 'true'); }}><option value="false">Ativos</option><option value="true">Arquivados</option></select></label></div>
    <Feedback action={action} />
    <Resource resource={resource}>{({ data, meta }) => <>
      {data.length ? <div className="plant-grid">{data.map(profile => <article key={profile.id} className="plant-card profile-card">
        <div className="row wrap"><Badge value={profile.tipo} /><Badge value={profile.statusValidacao} /></div>
        <h2>{profile.nome}</h2><p><Badge value={profile.fase} /> · versão {profile.versao}</p>
        <dl className="data-list"><div><dt>Umidade mínima</dt><dd>{percent(profile.umidadeMinima)}</dd></div><div><dt>Umidade alvo</dt><dd>{percent(profile.umidadeAlvo)}</dd></div><div><dt>Duração máxima</dt><dd>{profile.duracaoMaximaSegundos} s</dd></div><div><dt>Intervalo mínimo</dt><dd>{profile.intervaloMinimoSegundos} s</dd></div></dl>
        <small className="muted">Fonte: {profile.fonte}</small>
        {!profile.arquivadoEm && <div className="row wrap profile-actions">{profile.tipo === 'REFERENCIA'
          ? <button className="button secondary small" disabled={action.busy} onClick={() => action.run(() => request('/perfis-irrigacao/' + profile.id + '/copia', { method: 'POST', body: {} }), 'Cópia salva como perfil pessoal.')}><Copy size={15} /> Copiar</button>
          : <><button className="button secondary small" onClick={() => setEdit(profile)}>Editar</button>
            {profile.statusValidacao !== 'VALIDADO' && <button className="button secondary small" disabled={action.busy} onClick={() => {
              if (window.confirm('Confirma que verificou a fonte, os parâmetros e as condições de uso deste perfil?')) action.run(() => request('/perfis-irrigacao/' + profile.id, { method: 'PATCH', body: { statusValidacao: 'VALIDADO' } }), 'Perfil validado.');
            }}>Validar</button>}
            <button className="button danger small" disabled={action.busy} onClick={() => {
              if (window.confirm('Arquivar este perfil?')) action.run(() => request('/perfis-irrigacao/' + profile.id, { method: 'DELETE' }), 'Perfil arquivado.');
            }}>Arquivar</button></>}</div>}
      </article>)}</div> : <Panel title="Perfis"><Empty title="Nenhum perfil neste filtro" icon={Droplet}>Crie um perfil pessoal ou consulte as referências disponíveis.</Empty></Panel>}
      <Pagination meta={meta} page={page} setPage={setPage} />
    </>}</Resource>
  </>;
}
