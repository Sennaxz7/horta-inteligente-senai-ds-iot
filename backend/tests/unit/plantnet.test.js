const { test } = require('node:test');
const assert = require('node:assert/strict');
const PlantNetService = require('../../src/services/PlantNetService');
const { testEnvironment } = require('../helpers/fixture');

const env = testEnvironment({ PLANTNET_API_KEY: 'chave-privada-de-teste' });
const sample = { results: [{ score: 0.94, species: {
  scientificNameWithoutAuthor: 'Ocimum basilicum', commonNames: ['Manjericão'],
} }] };

test('PlantNet envia multipart ao endpoint oficial e filtra os dados persistidos', async () => {
  const service = new PlantNetService({ env, fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://my-api.plantnet.org');
    assert.equal(url.searchParams.get('api-key'), env.PLANTNET_API_KEY);
    assert.equal(url.searchParams.get('nb-results'), '5');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('organs'), 'leaf');
    assert.equal(options.body.get('images').type, 'image/jpeg');
    return Response.json({ ...sample, query: { apiKey: env.PLANTNET_API_KEY } });
  } });
  const result = await service.identify(Buffer.from('foto'), 'leaf');
  assert.deepEqual(result, [{ nomeCientifico: 'Ocimum basilicum', nomeComum: 'Manjericão', confianca: 0.94, plantNetId: null }]);
  assert.equal(JSON.stringify(result).includes(env.PLANTNET_API_KEY), false);
});

test('PlantNet sem chave não faz chamada externa', async () => {
  const service = new PlantNetService({ env: testEnvironment(), fetchImpl: () => assert.fail('Não deve chamar a rede.') });
  await assert.rejects(() => service.identify(Buffer.from('foto'), 'auto'), { code: 'PLANTNET_NOT_CONFIGURED' });
});

test('PlantNet trata ausência de resultado, quota, autenticação e falha externa', async () => {
  for (const [status, code] of [[404, 'PLANTNET_NO_RESULT'], [429, 'PLANTNET_QUOTA_EXCEEDED'],
    [401, 'PLANTNET_AUTH_ERROR'], [503, 'PLANTNET_UNAVAILABLE']]) {
    const service = new PlantNetService({ env, fetchImpl: async () => new Response('erro', { status }) });
    await assert.rejects(() => service.identify(Buffer.from('foto'), 'auto'), { code });
  }
});

test('PlantNet valida o resultado e não expõe detalhes de erros de rede', async () => {
  const invalid = new PlantNetService({ env, fetchImpl: async () => Response.json({ results: [{ score: 2 }] }) });
  await assert.rejects(() => invalid.identify(Buffer.from('foto'), 'auto'), { code: 'PLANTNET_INVALID_RESPONSE' });
  const malformed = new PlantNetService({ env, fetchImpl: async () => new Response('{invalid') });
  await assert.rejects(() => malformed.identify(Buffer.from('foto'), 'auto'), { code: 'PLANTNET_INVALID_RESPONSE' });
  const leak = new PlantNetService({ env, fetchImpl: async () => { throw new Error(`https://url?api-key=${env.PLANTNET_API_KEY}`); } });
  await assert.rejects(() => leak.identify(Buffer.from('foto'), 'auto'), (error) => {
    assert.equal(error.code, 'PLANTNET_UNAVAILABLE');
    assert.equal(error.message.includes(env.PLANTNET_API_KEY), false);
    return true;
  });
  const timeout = new PlantNetService({ env, fetchImpl: async () => { throw new DOMException('demorou', 'TimeoutError'); } });
  await assert.rejects(() => timeout.identify(Buffer.from('foto'), 'auto'), { code: 'PLANTNET_TIMEOUT' });
});

test('PlantNet limita o tamanho da resposta', async () => {
  const service = new PlantNetService({ env, fetchImpl: async () => new Response('x'.repeat(512 * 1024 + 1)) });
  await assert.rejects(() => service.identify(Buffer.from('foto'), 'auto'), { code: 'PLANTNET_INVALID_RESPONSE' });
});
