const PlantNetService = require('../../src/services/PlantNetService');
const { testEnvironment } = require('../helpers/fixture');

const env = testEnvironment({ PLANTNET_API_KEY: 'chave-privada-de-teste' });
const sample = { results: [{ score: 0.94, species: {
  scientificNameWithoutAuthor: 'Ocimum basilicum', commonNames: ['Manjericão'],
} }] };

test('PlantNet envia multipart ao endpoint oficial e filtra os dados persistidos', async () => {
  const service = new PlantNetService({ env, fetchImpl: async (url, options) => {
    expect(url.origin).toBe('https://my-api.plantnet.org');
    expect(url.searchParams.get('api-key')).toBe(env.PLANTNET_API_KEY);
    expect(url.searchParams.get('nb-results')).toBe('5');
    expect(options.redirect).toBe('error');
    expect(options.body.get('organs')).toBe('leaf');
    expect(options.body.get('images').type).toBe('image/jpeg');
    return Response.json({ ...sample, query: { apiKey: env.PLANTNET_API_KEY } });
  } });
  const result = await service.identify(Buffer.from('foto'), 'leaf');
  expect(result).toStrictEqual([{ nomeCientifico: 'Ocimum basilicum', nomeComum: 'Manjericão', confianca: 0.94, plantNetId: null }]);
  expect(JSON.stringify(result)).not.toContain(env.PLANTNET_API_KEY);
});

test('PlantNet sem chave não faz chamada externa', async () => {
  const fetchImpl = jest.fn();
  const service = new PlantNetService({ env: testEnvironment(), fetchImpl });
  await expect(service.identify(Buffer.from('foto'), 'auto')).rejects.toMatchObject({ code: 'PLANTNET_NOT_CONFIGURED' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('PlantNet trata ausência de resultado, quota, autenticação e falha externa', async () => {
  for (const [status, code] of [[404, 'PLANTNET_NO_RESULT'], [429, 'PLANTNET_QUOTA_EXCEEDED'],
    [401, 'PLANTNET_AUTH_ERROR'], [503, 'PLANTNET_UNAVAILABLE']]) {
    const service = new PlantNetService({ env, fetchImpl: async () => new Response('erro', { status }) });
    await expect(service.identify(Buffer.from('foto'), 'auto')).rejects.toMatchObject({ code });
  }
});

test('PlantNet valida o resultado e não expõe detalhes de erros de rede', async () => {
  const invalid = new PlantNetService({ env, fetchImpl: async () => Response.json({ results: [{ score: 2 }] }) });
  await expect(invalid.identify(Buffer.from('foto'), 'auto')).rejects.toMatchObject({ code: 'PLANTNET_INVALID_RESPONSE' });
  const malformed = new PlantNetService({ env, fetchImpl: async () => new Response('{invalid') });
  await expect(malformed.identify(Buffer.from('foto'), 'auto')).rejects.toMatchObject({ code: 'PLANTNET_INVALID_RESPONSE' });
  const leak = new PlantNetService({ env, fetchImpl: async () => { throw new Error(`https://url?api-key=${env.PLANTNET_API_KEY}`); } });
  const failure = leak.identify(Buffer.from('foto'), 'auto');
  await expect(failure).rejects.toMatchObject({ code: 'PLANTNET_UNAVAILABLE' });
  await expect(failure).rejects.not.toThrow(env.PLANTNET_API_KEY);
  const timeout = new PlantNetService({ env, fetchImpl: async () => { throw new DOMException('demorou', 'TimeoutError'); } });
  await expect(timeout.identify(Buffer.from('foto'), 'auto')).rejects.toMatchObject({ code: 'PLANTNET_TIMEOUT' });
});

test('PlantNet limita o tamanho da resposta', async () => {
  const service = new PlantNetService({ env, fetchImpl: async () => new Response('x'.repeat(512 * 1024 + 1)) });
  await expect(service.identify(Buffer.from('foto'), 'auto')).rejects.toMatchObject({ code: 'PLANTNET_INVALID_RESPONSE' });
});
